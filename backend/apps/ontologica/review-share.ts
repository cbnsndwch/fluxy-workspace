import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import OpenAI from 'openai';

export function registerReviewShareRoutes(r: Router, db: Database.Database) {

  // ── Export: Generate self-contained HTML review file (Story Mode) ───────────
  r.get('/api/ontologica/projects/:projectId/review-export', async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const project = db.prepare('SELECT * FROM onto_projects WHERE id = ?').get(projectId) as any;
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const nodes = db.prepare('SELECT * FROM onto_nodes WHERE project_id = ?').all(projectId) as any[];
    const edges = db.prepare('SELECT * FROM onto_edges WHERE project_id = ?').all(projectId) as any[];
    const docs = db.prepare('SELECT id, filename FROM onto_documents WHERE project_id = ?').all(projectId) as any[];
    const layers = db.prepare(`
      SELECT bl.*, pl.project_id FROM onto_base_layers bl
      JOIN onto_project_layers pl ON pl.layer_id = bl.id
      WHERE pl.project_id = ?
    `).all(projectId) as any[];

    const nodeMap: Record<number, string> = {};
    nodes.forEach(n => { nodeMap[n.id] = n.name; });

    // Use AI to group nodes into business-meaningful categories
    let categories: StoryCategory[];
    try {
      categories = await groupIntoStories(nodes, edges, project);
    } catch (e: any) {
      console.error('[review-share] AI grouping failed, falling back to type-based:', e.message);
      categories = fallbackGrouping(nodes);
    }

    const data = {
      project: { id: project.id, name: project.name, description: project.description, domain_hint: project.domain_hint },
      categories,
      nodes: nodes.map(n => ({
        id: n.id, name: n.name, node_type: n.node_type, description: n.description,
        confidence: n.confidence, status: n.status, layer_id: n.layer_id,
        source_document_id: n.source_document_id,
      })),
      edges: edges.map(e => ({
        id: e.id, name: e.name, edge_type: e.edge_type, description: e.description,
        confidence: e.confidence, status: e.status, layer_id: e.layer_id,
        source_document_id: e.source_document_id,
        source_node_id: e.source_node_id, target_node_id: e.target_node_id, target_value: e.target_value,
        source_name: nodeMap[e.source_node_id] || '?',
        target_name: nodeMap[e.target_node_id] || e.target_value || '?',
      })),
      docs: docs.map(d => ({ id: d.id, filename: d.filename })),
      layers: layers.map(l => ({ id: l.id, name: l.name, slug: l.slug })),
      exportedAt: new Date().toISOString(),
    };

    const html = generateStoryHtml(data);
    const filename = `${project.name.replace(/\s+/g, '-')}-review.html`;
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  });

  // ── Import: Apply decisions from review file ────────────────────────────────
  r.post('/api/ontologica/projects/:projectId/review-import', (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { decisions, reclassifications } = req.body as { decisions: ReviewDecision[], reclassifications?: { nodeId: number, to: string }[] };
    if (!Array.isArray(decisions)) return res.status(400).json({ error: 'decisions array required' });

    const project = db.prepare('SELECT id FROM onto_projects WHERE id = ?').get(projectId) as any;
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const updateNode = db.prepare('UPDATE onto_nodes SET status = ? WHERE id = ? AND project_id = ?');
    const updateEdge = db.prepare('UPDATE onto_edges SET status = ? WHERE id = ? AND project_id = ?');

    try { db.prepare('SELECT review_comment FROM onto_nodes LIMIT 1').get(); } catch {
      db.exec('ALTER TABLE onto_nodes ADD COLUMN review_comment TEXT');
    }
    try { db.prepare('SELECT review_comment FROM onto_edges LIMIT 1').get(); } catch {
      db.exec('ALTER TABLE onto_edges ADD COLUMN review_comment TEXT');
    }

    const updateNodeComment = db.prepare('UPDATE onto_nodes SET review_comment = ? WHERE id = ? AND project_id = ?');
    const updateEdgeComment = db.prepare('UPDATE onto_edges SET review_comment = ? WHERE id = ? AND project_id = ?');

    let applied = 0;
    let skipped = 0;
    let reclassified = 0;

    const updateNodeType = db.prepare('UPDATE onto_nodes SET node_type = ? WHERE id = ? AND project_id = ?');

    const tx = db.transaction(() => {
      for (const d of decisions) {
        if (!d.action || d.action === 'pending') { skipped++; continue; }
        const status = d.action === 'approve' ? 'approved' : 'rejected';
        if (d.type === 'node') {
          const r = updateNode.run(status, d.id, projectId);
          if (r.changes > 0) {
            applied++;
            if (d.comment) updateNodeComment.run(d.comment, d.id, projectId);
          } else { skipped++; }
        } else if (d.type === 'edge') {
          const r = updateEdge.run(status, d.id, projectId);
          if (r.changes > 0) {
            applied++;
            if (d.comment) updateEdgeComment.run(d.comment, d.id, projectId);
          } else { skipped++; }
        }
      }
      // Apply reclassifications (category ↔ example)
      if (reclassifications?.length) {
        for (const rc of reclassifications) {
          const r = updateNodeType.run(rc.to, rc.nodeId, projectId);
          if (r.changes > 0) reclassified++;
        }
      }
    });
    tx();

    res.json({ applied, skipped, reclassified, total: decisions.length });
  });
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ReviewDecision {
  type: 'node' | 'edge';
  id: number;
  action: 'approve' | 'reject' | 'pending';
  comment?: string;
}

interface StoryCategory {
  name: string;
  emoji: string;
  description: string;       // plain-English 1-2 sentences
  whyItMatters: string;      // why reviewing this is important
  nodeIds: number[];
  edgeIds: number[];
}

// ── AI Grouping ──────────────────────────────────────────────────────────────

async function groupIntoStories(nodes: any[], edges: any[], project: any): Promise<StoryCategory[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Build a compact summary of nodes for the prompt
  const nodeSummary = nodes.map(n =>
    `[${n.id}] ${n.name} (${n.node_type}) — ${(n.description || '').slice(0, 80)}`
  ).join('\n');

  const edgeSummary = edges.slice(0, 100).map(e => {
    const src = nodes.find(n => n.id === e.source_node_id);
    const tgt = nodes.find(n => n.id === e.target_node_id);
    return `[${e.id}] ${src?.name || '?'} → ${e.name || e.edge_type} → ${tgt?.name || e.target_value || '?'}`;
  }).join('\n');

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are organizing a business knowledge map for a non-technical business owner.

Given a list of extracted concepts from their business, group them into 5-8 natural business categories.

Rules:
- Category names should be in plain English, like a business owner would say them: "Products & Services", "Your Team & Roles", "How Work Gets Done", "Your Software & Tools", "Your Clients & Relationships", etc.
- Use "Products & Services" (not just "Services") for the service/product category — this supports any business type.
- Be strict about category fit: only include items that genuinely belong. A "CRM" or "Email Agent" is a software tool, NOT a service. A "Workflow Step" is a process, NOT a service. Group items by what they ARE, not by what they're vaguely related to.
- Each category needs a single emoji, a 1-2 sentence description of what it covers, and a "whyItMatters" sentence explaining why confirming these items helps build better software for them.
- Every node ID must appear in exactly one category. Don't miss any.
- Assign edges to the category of their source node. If you can't determine source category, put edges in the most relevant category.
- Merge small categories (< 5 items) into related larger ones.
- Order categories from most concrete/tangible (services, people, tools) to most abstract (processes, relationships, market context).

Return JSON: { "categories": [{ "name": string, "emoji": string, "description": string, "whyItMatters": string, "nodeIds": number[], "edgeIds": number[] }] }`
      },
      {
        role: 'user',
        content: `Business: ${project.name}${project.description ? ' — ' + project.description : ''}${project.domain_hint ? '\nDomain: ' + project.domain_hint : ''}

NODES (${nodes.length} total):
${nodeSummary}

EDGES (showing first 100 of ${edges.length}):
${edgeSummary}

Group ALL ${nodes.length} nodes and ALL ${edges.length} edges into categories.`
      }
    ]
  });

  const parsed = JSON.parse(resp.choices[0].message.content || '{}');
  const cats: StoryCategory[] = parsed.categories || [];

  // Validate: ensure every node is assigned
  const assignedNodeIds = new Set(cats.flatMap(c => c.nodeIds));
  const missingNodes = nodes.filter(n => !assignedNodeIds.has(n.id));
  if (missingNodes.length > 0) {
    // Put unassigned nodes in an "Other" category
    const assignedEdgeIds = new Set(cats.flatMap(c => c.edgeIds));
    const missingEdges = edges.filter(e => !assignedEdgeIds.has(e.id));
    cats.push({
      name: 'Other Items',
      emoji: '📋',
      description: 'Additional items that didn\'t fit neatly into the other categories.',
      whyItMatters: 'These might be less central to your day-to-day, but confirming them helps complete the picture.',
      nodeIds: missingNodes.map(n => n.id),
      edgeIds: missingEdges.map(e => e.id),
    });
  }

  // Also ensure all edges are assigned
  const assignedEdgeIds = new Set(cats.flatMap(c => c.edgeIds));
  const missingEdges = edges.filter(e => !assignedEdgeIds.has(e.id));
  if (missingEdges.length > 0) {
    // Add missing edges to the category of their source node
    for (const edge of missingEdges) {
      const cat = cats.find(c => c.nodeIds.includes(edge.source_node_id));
      if (cat) {
        cat.edgeIds.push(edge.id);
      } else if (cats.length > 0) {
        cats[cats.length - 1].edgeIds.push(edge.id);
      }
    }
  }

  return cats;
}

function fallbackGrouping(nodes: any[]): StoryCategory[] {
  const classes = nodes.filter(n => n.node_type === 'class');
  const individuals = nodes.filter(n => n.node_type === 'individual');

  const cats: StoryCategory[] = [];
  if (classes.length) {
    cats.push({
      name: 'Business Concepts',
      emoji: '🏢',
      description: 'The core concepts, processes, and structures that define how your business operates.',
      whyItMatters: 'Confirming these ensures we understand the building blocks of your business correctly.',
      nodeIds: classes.map(n => n.id),
      edgeIds: [],
    });
  }
  if (individuals.length) {
    cats.push({
      name: 'Specific Items & People',
      emoji: '👤',
      description: 'The specific tools, people, and instances that are part of your business.',
      whyItMatters: 'These are the concrete things we\'ll connect to automations and workflows.',
      nodeIds: individuals.map(n => n.id),
      edgeIds: [],
    });
  }
  return cats;
}

// ── HTML Generation ──────────────────────────────────────────────────────────

function generateStoryHtml(data: any): string {
  const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsonData = JSON.stringify(data).replace(/<\/script/g, '<\\/script');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.project.name)} — Business Review</title>
<style>
  :root {
    --bg: #f8fafc; --surface: #fff; --border: #e2e8f0; --text: #1e293b;
    --muted: #64748b; --accent: #059669; --accent-light: #ecfdf5;
    --reject: #dc2626; --reject-light: #fef2f2;
    --blue: #3b82f6; --blue-light: #eff6ff;
    --violet: #7c3aed; --violet-light: #f5f3ff;
    --amber: #d97706; --amber-light: #fffbeb;
    --radius: 16px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; }

  /* ── Welcome Screen ── */
  .welcome { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 32px; text-align: center; }
  .welcome h1 { font-size: 2rem; font-weight: 800; margin-bottom: 8px; }
  .welcome .subtitle { color: var(--muted); font-size: 1.1rem; margin-bottom: 32px; max-width: 500px; }
  .welcome .stats { display: flex; gap: 24px; margin-bottom: 40px; }
  .welcome .stat-pill { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 24px; text-align: center; }
  .welcome .stat-num { font-size: 1.5rem; font-weight: 700; }
  .welcome .stat-label { font-size: 0.8rem; color: var(--muted); }
  .how-it-works { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px 32px; text-align: left; max-width: 480px; margin-bottom: 32px; }
  .how-it-works h3 { font-size: 0.9rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 12px; }
  .how-it-works ol { padding-left: 20px; }
  .how-it-works li { margin-bottom: 6px; font-size: 0.95rem; }
  .how-it-works li strong { color: var(--accent); }

  /* ── Buttons ── */
  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; border-radius: 12px; font-size: 1rem; font-weight: 600; border: 2px solid transparent; cursor: pointer; transition: all 0.2s; user-select: none; }
  .btn:active { transform: scale(0.97); }
  .btn-primary { background: var(--accent); color: white; }
  .btn-primary:hover { filter: brightness(0.92); }
  .btn-outline { background: transparent; border-color: var(--border); color: var(--text); }
  .btn-outline:hover { border-color: var(--accent); color: var(--accent); }
  .btn-approve { background: var(--accent); color: white; font-size: 1.1rem; padding: 14px 36px; }
  .btn-approve:hover { filter: brightness(0.92); }
  .btn-review { background: var(--amber-light); color: var(--amber); border-color: var(--amber); font-size: 1.1rem; padding: 14px 36px; }
  .btn-review:hover { filter: brightness(0.92); }
  .btn-sm { padding: 8px 16px; font-size: 0.85rem; border-radius: 10px; }
  .btn-ghost { background: transparent; border: none; color: var(--muted); padding: 8px 12px; }
  .btn-ghost:hover { color: var(--text); }

  /* ── Slideshow ── */
  .slideshow { max-width: 720px; margin: 0 auto; padding: 24px; min-height: 100vh; display: flex; flex-direction: column; }
  .slide-progress { display: flex; gap: 4px; margin-bottom: 24px; padding: 0 4px; }
  .slide-dot { flex: 1; height: 4px; border-radius: 2px; background: var(--border); transition: background 0.3s; }
  .slide-dot.done { background: var(--accent); }
  .slide-dot.active { background: var(--violet); }
  .slide-dot.current { background: var(--blue); }

  .slide-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; flex: 1; display: flex; flex-direction: column; animation: fadeIn 0.3s ease; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

  .slide-emoji { font-size: 3rem; margin-bottom: 8px; }
  .slide-title { font-size: 1.6rem; font-weight: 800; margin-bottom: 4px; }
  .slide-count { font-size: 0.85rem; color: var(--muted); margin-bottom: 12px; }
  .slide-desc { font-size: 1rem; color: var(--muted); margin-bottom: 8px; }
  .slide-why { font-size: 0.9rem; color: var(--violet); background: var(--violet-light); border-radius: 10px; padding: 10px 14px; margin-bottom: 20px; }

  .concept-list { flex: 1; overflow-y: auto; margin-bottom: 20px; }
  .concept-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; margin: 3px; font-size: 0.85rem; transition: all 0.2s; }
  .concept-chip.is-individual { border-color: var(--violet); background: var(--violet-light); }
  .concept-chip .chip-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .concept-chip .chip-dot.class { background: var(--accent); }
  .concept-chip .chip-dot.individual { background: var(--violet); }

  .slide-actions { display: flex; gap: 12px; justify-content: center; padding-top: 16px; border-top: 1px solid var(--border); }
  .slide-nav { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }

  /* ── Category status badges ── */
  .cat-status { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 8px; font-size: 0.8rem; font-weight: 600; }
  .cat-status.approved { background: var(--accent-light); color: var(--accent); }
  .cat-status.reviewing { background: var(--amber-light); color: var(--amber); }

  /* ── Tinder Mode ── */
  .tinder-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.6); backdrop-filter: blur(4px); z-index: 100; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s ease; }
  .tinder-container { width: 100%; max-width: 480px; padding: 24px; }
  .tinder-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .tinder-header h3 { color: white; font-size: 1rem; font-weight: 600; }
  .tinder-progress { color: rgba(255,255,255,0.6); font-size: 0.85rem; }
  .tinder-close { color: white; background: rgba(255,255,255,0.1); border: none; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 0.85rem; }
  .tinder-close:hover { background: rgba(255,255,255,0.2); }

  .tinder-card { background: var(--surface); border-radius: var(--radius); padding: 32px; text-align: center; animation: cardIn 0.3s ease; min-height: 320px; display: flex; flex-direction: column; justify-content: center; }
  @keyframes cardIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }

  .tinder-card .t-type { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 8px; }
  .tinder-card .t-name { font-size: 1.5rem; font-weight: 800; margin-bottom: 12px; }
  .tinder-card .t-desc { font-size: 1rem; color: var(--muted); margin-bottom: 20px; line-height: 1.6; }
  .tinder-card .t-edge-path { font-size: 1.1rem; margin-bottom: 12px; }
  .tinder-card .t-edge-path .rel { color: var(--accent); font-weight: 700; }
  .tinder-card .t-edge-path .arrow { color: var(--muted); margin: 0 8px; }

  .tinder-actions { display: flex; gap: 16px; justify-content: center; margin-top: 20px; }
  .tinder-btn { width: 64px; height: 64px; border-radius: 50%; border: 2px solid var(--border); background: var(--surface); display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1.5rem; transition: all 0.2s; }
  .tinder-btn:hover { transform: scale(1.1); }
  .tinder-btn.approve { border-color: var(--accent); color: var(--accent); }
  .tinder-btn.approve:hover { background: var(--accent); color: white; }
  .tinder-btn.reject { border-color: var(--reject); color: var(--reject); }
  .tinder-btn.reject:hover { background: var(--reject); color: white; }
  .tinder-btn.skip { border-color: var(--muted); color: var(--muted); font-size: 1rem; }

  /* ── Reject Reason Modal ── */
  .reason-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.7); backdrop-filter: blur(4px); z-index: 200; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.15s ease; }
  .reason-card { background: var(--surface); border-radius: var(--radius); padding: 28px; max-width: 420px; width: 100%; margin: 24px; }
  .reason-card h3 { font-size: 1.1rem; font-weight: 700; margin-bottom: 4px; }
  .reason-card .reason-sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 16px; }
  .reason-card textarea { width: 100%; min-height: 100px; border: 2px solid var(--border); border-radius: 10px; padding: 12px; font-family: inherit; font-size: 0.95rem; resize: vertical; outline: none; transition: border-color 0.2s; }
  .reason-card textarea:focus { border-color: var(--reject); }
  .reason-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }

  /* ── Finish Screen ── */
  .finish { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 32px; text-align: center; }
  .finish h1 { font-size: 2rem; font-weight: 800; margin-bottom: 8px; }
  .finish .subtitle { color: var(--muted); font-size: 1.1rem; margin-bottom: 32px; max-width: 500px; }
  .finish-stats { display: flex; gap: 24px; margin-bottom: 40px; flex-wrap: wrap; justify-content: center; }
  .finish-stat { text-align: center; min-width: 100px; }
  .finish-stat .num { font-size: 2rem; font-weight: 800; }
  .finish-stat .label { font-size: 0.8rem; color: var(--muted); }
  .finish-stat .num.green { color: var(--accent); }
  .finish-stat .num.red { color: var(--reject); }
  .finish-stat .num.gray { color: var(--muted); }

  /* ── Sections within slides ── */
  .slide-section { margin-bottom: 12px; }
  .slide-section-header { display: flex; align-items: center; gap: 8px; padding: 6px 0 4px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .slide-section-header .section-icon { font-size: 0.85rem; }
  .slide-section-header .section-count { font-weight: 400; opacity: 0.7; }
  .slide-section-body { min-height: 32px; padding: 4px 0; border-radius: 8px; transition: background 0.2s; }
  .slide-section-body.drag-over { background: var(--blue-light); outline: 2px dashed var(--blue); }
  .slide-section-body:empty::after { content: 'Drag items here'; color: var(--muted); font-size: 0.8rem; font-style: italic; display: block; padding: 8px 12px; }

  .concept-chip[draggable=true] { cursor: grab; user-select: none; }
  .concept-chip[draggable=true]:active { cursor: grabbing; }
  .concept-chip.dragging { opacity: 0.3; }

  /* Sub-class parent reference */
  .chip-parent { font-size: 0.75rem; color: var(--muted); margin-left: 2px; }
  .chip-parent::before { content: '← '; }

  /* Connection chips — friendly format */
  .connection-chip { display: inline-flex; align-items: center; gap: 5px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; margin: 3px; font-size: 0.85rem; }
  .connection-chip .conn-subject { font-weight: 600; }
  .connection-chip .conn-rel { color: var(--accent); font-size: 0.8rem; }
  .connection-chip .conn-object { font-weight: 600; }

  @media (max-width: 640px) {
    .welcome .stats { flex-direction: column; gap: 12px; }
    .slide-card { padding: 20px; }
    .slide-actions { flex-direction: column; }
    .tinder-container { padding: 16px; }
  }
</style>
</head>
<body>

<div id="app"></div>

<script>
const DATA = ${jsonData};

// ── State ────────────────────────────────────────────────────────────────────
const nodeById = {};
DATA.nodes.forEach(n => nodeById[n.id] = n);
const edgeById = {};
DATA.edges.forEach(e => edgeById[e.id] = e);

// Decisions: { 'node-123': { action: 'pending'|'approve'|'reject', comment: '' } }
const decisions = {};
DATA.nodes.forEach(n => {
  decisions['node-' + n.id] = { type: 'node', id: n.id, action: 'pending', comment: '' };
});
DATA.edges.forEach(e => {
  decisions['edge-' + e.id] = { type: 'edge', id: e.id, action: 'pending', comment: '' };
});

// Category approval status
const catStatus = {}; // catIndex -> 'pending' | 'approved' | 'reviewed'
DATA.categories.forEach((_, i) => catStatus[i] = 'pending');

let currentSlide = 0;
let screen = 'welcome'; // 'welcome' | 'slideshow' | 'tinder' | 'finish'
let tinderCatIndex = -1;
let tinderItems = [];
let tinderPos = 0;
let showReasonModal = false;
let reasonItemKey = '';

// ── Reclassification & structure ─────────────────────────────────────────────
const nodeOverrides = {}; // nodeId -> 'class' | 'individual' (user corrections)

function getNodeType(n) { return nodeOverrides[n.id] || n.node_type; }

function friendlyEdge(t) {
  const m = {
    subClassOf:'is a type of', hasProperty:'has', belongsTo:'belongs to',
    manages:'manages', creates:'creates', uses:'uses', contains:'contains',
    assignedTo:'is assigned to', coversService:'covers', hasFrequency:'runs on',
    storedIn:'is stored in', downloads:'downloads', managesClient:'manages',
    managesTask:'manages', hasSubscription:'subscribes to',
  };
  return m[t] || t.replace(/_/g,' ').replace(/([A-Z])/g,' $1').toLowerCase().trim();
}

function getCategoryStructure(cat) {
  const catNodeSet = new Set(cat.nodeIds);
  // Find subClassOf edges
  const subOfEdges = cat.edgeIds.map(id => edgeById[id]).filter(e => e && (e.edge_type === 'subClassOf' || e.name === 'subClassOf'));
  const parentMap = {};
  subOfEdges.forEach(e => { if (catNodeSet.has(e.source_node_id)) parentMap[e.source_node_id] = e.target_node_id; });

  const topLevel = [], subClasses = [], examples = [];
  cat.nodeIds.forEach(id => {
    const n = nodeById[id]; if (!n) return;
    const t = getNodeType(n);
    if (t === 'individual') { examples.push(n); }
    else if (parentMap[id] && catNodeSet.has(parentMap[id])) {
      subClasses.push({ ...n, _parentId: parentMap[id], _parentName: nodeById[parentMap[id]]?.name || '?' });
    } else { topLevel.push(n); }
  });
  // Non-subClassOf edges only
  const connections = cat.edgeIds.map(id => edgeById[id]).filter(e => e && e.edge_type !== 'subClassOf' && e.name !== 'subClassOf');
  return { topLevel, subClasses, examples, connections };
}

// ── Drag and drop ────────────────────────────────────────────────────────────
let dragNodeId = null;
let dragSourceSection = null;

function onDragStart(ev, nodeId, section) {
  dragNodeId = nodeId; dragSourceSection = section;
  ev.dataTransfer.effectAllowed = 'move';
  ev.target.classList.add('dragging');
}
function onDragEnd(ev) {
  ev.target.classList.remove('dragging');
  dragNodeId = null; dragSourceSection = null;
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}
function onSectionDragOver(ev) { ev.preventDefault(); ev.currentTarget.classList.add('drag-over'); }
function onSectionDragLeave(ev) { ev.currentTarget.classList.remove('drag-over'); }
function onSectionDrop(ev, targetSection) {
  ev.preventDefault(); ev.currentTarget.classList.remove('drag-over');
  if (!dragNodeId || dragSourceSection === targetSection) return;
  if (targetSection === 'examples') nodeOverrides[dragNodeId] = 'individual';
  else nodeOverrides[dragNodeId] = 'class';
  render();
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render() {
  const app = document.getElementById('app');
  if (screen === 'welcome') app.innerHTML = renderWelcome();
  else if (screen === 'slideshow') app.innerHTML = renderSlideshow();
  else if (screen === 'finish') app.innerHTML = renderFinish();

  // Tinder overlay renders on top
  if (screen === 'tinder') {
    app.innerHTML = renderSlideshow() + renderTinder();
  }
  if (showReasonModal) {
    app.innerHTML += renderReasonModal();
  }
}

function renderWelcome() {
  const totalItems = DATA.nodes.length + DATA.edges.length;
  const numCats = DATA.categories.length;
  return '<div class="welcome">' +
    '<div class="slide-emoji" style="font-size:4rem">🔍</div>' +
    '<h1>Business Review</h1>' +
    '<div class="subtitle">We\\'ve mapped out how <strong>' + esc(DATA.project.name) + '</strong> works. ' +
    'Before we build anything, we need to make sure we got it right.</div>' +
    '<div class="stats">' +
      '<div class="stat-pill"><div class="stat-num">' + numCats + '</div><div class="stat-label">Categories</div></div>' +
      '<div class="stat-pill"><div class="stat-num">' + totalItems + '</div><div class="stat-label">Items to Review</div></div>' +
    '</div>' +
    '<div class="how-it-works">' +
      '<h3>How this works</h3>' +
      '<ol>' +
        '<li>We\\'ll show you <strong>' + numCats + ' categories</strong> of things we found about your business</li>' +
        '<li>If a category looks right, tap <strong>"Looks Good"</strong> to approve everything in it</li>' +
        '<li>If something\\'s off, tap <strong>"Review Items"</strong> to go through them one by one</li>' +
        '<li>When you\\'re done, download your feedback and send it back to us</li>' +
      '</ol>' +
    '</div>' +
    '<button class="btn btn-primary" onclick="startReview()" style="font-size:1.1rem;padding:16px 40px">Let\\'s Start →</button>' +
  '</div>';
}

function renderSlideshow() {
  const cat = DATA.categories[currentSlide];
  const itemCount = cat.nodeIds.length + cat.edgeIds.length;
  const status = catStatus[currentSlide];

  // Compute sectioned structure
  const struct = getCategoryStructure(cat);

  function nodeChip(n, section) {
    const isInd = getNodeType(n) === 'individual';
    return '<span class="concept-chip' + (isInd ? ' is-individual' : '') + '" draggable="true" ' +
      'ondragstart="onDragStart(event,' + n.id + ',\\'' + section + '\\')" ondragend="onDragEnd(event)">' +
      '<span class="chip-dot ' + (isInd ? 'individual' : 'class') + '"></span>' +
      esc(n.name) +
    '</span>';
  }

  const topChips = struct.topLevel.map(n => nodeChip(n, 'topLevel')).join('');
  const subChips = struct.subClasses.map(n =>
    '<span class="concept-chip" draggable="true" ' +
    'ondragstart="onDragStart(event,' + n.id + ',\\'subClasses\\')" ondragend="onDragEnd(event)">' +
    '<span class="chip-dot class"></span>' +
    esc(n.name) + '<span class="chip-parent">' + esc(n._parentName) + '</span>' +
    '</span>'
  ).join('');
  const exChips = struct.examples.map(n => nodeChip(n, 'examples')).join('');
  const connChips = struct.connections.slice(0, 40).map(e =>
    '<span class="connection-chip">' +
    '<span class="conn-subject">' + esc(e.source_name) + '</span> ' +
    '<span class="conn-rel">' + esc(friendlyEdge(e.edge_type || e.name)) + '</span> ' +
    '<span class="conn-object">' + esc(e.target_name) + '</span>' +
    '</span>'
  ).join('');

  // Progress dots
  let dots = '';
  DATA.categories.forEach((_, i) => {
    let cls = 'slide-dot';
    if (catStatus[i] === 'approved' || catStatus[i] === 'reviewed') cls += ' done';
    if (i === currentSlide) cls += ' current';
    dots += '<div class="' + cls + '"></div>';
  });

  // Status badge
  let statusBadge = '';
  if (status === 'approved') statusBadge = '<span class="cat-status approved">✓ Approved</span>';
  else if (status === 'reviewed') statusBadge = '<span class="cat-status approved">✓ Reviewed</span>';

  // Check if all done
  const allDone = DATA.categories.every((_, i) => catStatus[i] !== 'pending');

  let html = '<div class="slideshow">';
  html += '<div class="slide-progress">' + dots + '</div>';

  html += '<div class="slide-card">';
  html += '<div class="slide-emoji">' + esc(cat.emoji) + '</div>';
  html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">';
  html += '<div class="slide-title">' + esc(cat.name) + '</div>';
  html += statusBadge;
  html += '</div>';
  html += '<div class="slide-count">' + itemCount + ' items</div>';
  html += '<div class="slide-desc">' + esc(cat.description) + '</div>';
  html += '<div class="slide-why">💡 ' + esc(cat.whyItMatters) + '</div>';

  html += '<div class="concept-list">';
  // Section 1: Categories (top-level classes)
  if (struct.topLevel.length) {
    html += '<div class="slide-section">';
    html += '<div class="slide-section-header"><span class="section-icon">◉</span> Categories <span class="section-count">(' + struct.topLevel.length + ')</span></div>';
    html += '<div class="slide-section-body" ondragover="onSectionDragOver(event)" ondragleave="onSectionDragLeave(event)" ondrop="onSectionDrop(event,\\'topLevel\\')">' + topChips + '</div>';
    html += '</div>';
  }
  // Section 2: Sub-categories
  if (struct.subClasses.length) {
    html += '<div class="slide-section">';
    html += '<div class="slide-section-header"><span class="section-icon">◈</span> Sub-categories <span class="section-count">(' + struct.subClasses.length + ')</span></div>';
    html += '<div class="slide-section-body" ondragover="onSectionDragOver(event)" ondragleave="onSectionDragLeave(event)" ondrop="onSectionDrop(event,\\'subClasses\\')">' + subChips + '</div>';
    html += '</div>';
  }
  // Section 3: Examples (individuals)
  if (struct.examples.length) {
    html += '<div class="slide-section">';
    html += '<div class="slide-section-header"><span class="section-icon">◆</span> Examples <span class="section-count">(' + struct.examples.length + ')</span></div>';
    html += '<div class="slide-section-body" ondragover="onSectionDragOver(event)" ondragleave="onSectionDragLeave(event)" ondrop="onSectionDrop(event,\\'examples\\')">' + exChips + '</div>';
    html += '</div>';
  }
  // Section 4: Connections (non-subClassOf edges)
  if (struct.connections.length) {
    html += '<div class="slide-section">';
    html += '<div class="slide-section-header"><span class="section-icon">⟷</span> Connections <span class="section-count">(' + struct.connections.length + ')</span></div>';
    html += '<div class="slide-section-body">' + connChips;
    if (struct.connections.length > 40) html += '<span class="connection-chip" style="color:var(--muted);border-style:dashed">+' + (struct.connections.length - 40) + ' more</span>';
    html += '</div></div>';
  }
  // Show empty sections as drop targets when dragging
  if (!struct.topLevel.length || !struct.examples.length) {
    if (!struct.topLevel.length) {
      html += '<div class="slide-section"><div class="slide-section-header"><span class="section-icon">◉</span> Categories</div>';
      html += '<div class="slide-section-body" ondragover="onSectionDragOver(event)" ondragleave="onSectionDragLeave(event)" ondrop="onSectionDrop(event,\\'topLevel\\')"></div></div>';
    }
    if (!struct.examples.length) {
      html += '<div class="slide-section"><div class="slide-section-header"><span class="section-icon">◆</span> Examples</div>';
      html += '<div class="slide-section-body" ondragover="onSectionDragOver(event)" ondragleave="onSectionDragLeave(event)" ondrop="onSectionDrop(event,\\'examples\\')"></div></div>';
    }
  }
  html += '</div>';

  html += '<div class="slide-actions">';
  if (status === 'pending') {
    html += '<button class="btn btn-approve" onclick="approveCategory(' + currentSlide + ')">✓ Looks Good</button>';
    html += '<button class="btn btn-review" onclick="startTinder(' + currentSlide + ')">Review Items</button>';
  } else {
    html += '<button class="btn btn-outline btn-sm" onclick="startTinder(' + currentSlide + ')">Review Again</button>';
  }
  html += '</div>';
  html += '</div>'; // slide-card

  html += '<div class="slide-nav">';
  html += currentSlide > 0
    ? '<button class="btn btn-ghost" onclick="prevSlide()">← Back</button>'
    : '<span></span>';
  if (currentSlide < DATA.categories.length - 1) {
    html += '<button class="btn btn-outline btn-sm" onclick="nextSlide()">Next →</button>';
  } else if (allDone) {
    html += '<button class="btn btn-primary btn-sm" onclick="showFinish()">Finish Review →</button>';
  } else {
    html += '<button class="btn btn-outline btn-sm" onclick="nextSlide()" style="opacity:0.5">Next →</button>';
  }
  html += '</div>';

  html += '</div>'; // slideshow
  return html;
}

function renderTinder() {
  if (tinderPos >= tinderItems.length) return ''; // done

  const item = tinderItems[tinderPos];
  const key = item.type + '-' + item.id;
  const d = decisions[key];

  let cardContent = '';
  if (item.type === 'node') {
    const n = nodeById[item.id];
    const tLabel = getNodeType(n) === 'individual' ? 'example' : 'category';
    cardContent = '<div class="t-type">' + esc(tLabel) + '</div>' +
      '<div class="t-name">' + esc(n.name) + '</div>' +
      (n.description ? '<div class="t-desc">' + esc(n.description) + '</div>' : '');
  } else {
    const e = edgeById[item.id];
    cardContent = '<div class="t-type">connection</div>' +
      '<div class="t-edge-path"><span>' + esc(e.source_name) + '</span><span class="arrow"> </span><span class="rel">' + esc(friendlyEdge(e.edge_type || e.name)) + '</span><span class="arrow"> </span><span>' + esc(e.target_name) + '</span></div>' +
      (e.description ? '<div class="t-desc">' + esc(e.description) + '</div>' : '');
  }

  // Show existing decision if any
  let decisionBadge = '';
  if (d.action === 'approve') decisionBadge = '<div style="color:var(--accent);font-weight:600;margin-top:8px">✓ Approved</div>';
  if (d.action === 'reject') decisionBadge = '<div style="color:var(--reject);font-weight:600;margin-top:8px">✗ Rejected' + (d.comment ? ': ' + esc(d.comment) : '') + '</div>';

  return '<div class="tinder-overlay">' +
    '<div class="tinder-container">' +
      '<div class="tinder-header">' +
        '<h3>' + esc(DATA.categories[tinderCatIndex].emoji + ' ' + DATA.categories[tinderCatIndex].name) + '</h3>' +
        '<div class="tinder-progress">' + (tinderPos + 1) + ' / ' + tinderItems.length + '</div>' +
        '<button class="tinder-close" onclick="closeTinder()">Done</button>' +
      '</div>' +
      '<div class="tinder-card">' + cardContent + decisionBadge + '</div>' +
      '<div class="tinder-actions">' +
        '<button class="tinder-btn reject" onclick="tinderReject()" title="Remove">✗</button>' +
        '<button class="tinder-btn skip" onclick="tinderSkip()" title="Skip">→</button>' +
        '<button class="tinder-btn approve" onclick="tinderApprove()" title="Approve">✓</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function renderReasonModal() {
  return '<div class="reason-overlay">' +
    '<div class="reason-card">' +
      '<h3>Why doesn\\'t this belong?</h3>' +
      '<div class="reason-sub">Help us understand so we can get it right.</div>' +
      '<textarea id="reasonInput" placeholder="e.g. We don\\'t use this anymore, This is incorrect, We call this something else..." autofocus></textarea>' +
      '<div class="reason-actions">' +
        '<button class="btn btn-outline btn-sm" onclick="cancelReason()">Cancel</button>' +
        '<button class="btn btn-sm" style="background:var(--reject);color:white" onclick="confirmReject()">Remove</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function renderFinish() {
  const vals = Object.values(decisions);
  const approved = vals.filter(d => d.action === 'approve').length;
  const rejected = vals.filter(d => d.action === 'reject').length;
  const pending = vals.filter(d => d.action === 'pending').length;

  return '<div class="finish">' +
    '<div class="slide-emoji" style="font-size:4rem">🎉</div>' +
    '<h1>Review Complete!</h1>' +
    '<div class="subtitle">Thanks for going through this. Here\\'s a summary of your feedback.</div>' +
    '<div class="finish-stats">' +
      '<div class="finish-stat"><div class="num green">' + approved + '</div><div class="label">Approved</div></div>' +
      '<div class="finish-stat"><div class="num red">' + rejected + '</div><div class="label">Removed</div></div>' +
      '<div class="finish-stat"><div class="num gray">' + pending + '</div><div class="label">Skipped</div></div>' +
    '</div>' +
    '<button class="btn btn-primary" onclick="exportDecisions()" style="font-size:1.1rem;padding:16px 40px;margin-bottom:12px">📥 Download Feedback</button>' +
    '<div style="color:var(--muted);font-size:0.85rem;max-width:400px">Send this file back to us and we\\'ll apply your changes.</div>' +
    '<button class="btn btn-ghost" onclick="screen=\\'slideshow\\';render()" style="margin-top:24px">← Back to Review</button>' +
  '</div>';
}

// ── Actions ──────────────────────────────────────────────────────────────────

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function startReview() { screen = 'slideshow'; currentSlide = 0; render(); }

function approveCategory(idx) {
  const cat = DATA.categories[idx];
  cat.nodeIds.forEach(id => { decisions['node-' + id].action = 'approve'; });
  cat.edgeIds.forEach(id => { decisions['edge-' + id].action = 'approve'; });
  catStatus[idx] = 'approved';
  // Auto-advance
  if (idx < DATA.categories.length - 1) {
    currentSlide = idx + 1;
  }
  render();
}

function startTinder(idx) {
  tinderCatIndex = idx;
  const cat = DATA.categories[idx];
  tinderItems = [
    ...cat.nodeIds.map(id => ({ type: 'node', id })),
    ...cat.edgeIds.map(id => ({ type: 'edge', id })),
  ];
  tinderPos = 0;
  screen = 'tinder';
  render();
}

function tinderApprove() {
  const item = tinderItems[tinderPos];
  decisions[item.type + '-' + item.id].action = 'approve';
  advanceTinder();
}

function tinderReject() {
  const item = tinderItems[tinderPos];
  reasonItemKey = item.type + '-' + item.id;
  showReasonModal = true;
  render();
  setTimeout(() => { const el = document.getElementById('reasonInput'); if (el) el.focus(); }, 50);
}

function cancelReason() {
  showReasonModal = false;
  reasonItemKey = '';
  render();
}

function confirmReject() {
  const el = document.getElementById('reasonInput');
  const reason = el ? el.value.trim() : '';
  if (!reason) { el.style.borderColor = 'var(--reject)'; el.placeholder = 'Please tell us why...'; return; }
  decisions[reasonItemKey].action = 'reject';
  decisions[reasonItemKey].comment = reason;
  showReasonModal = false;
  reasonItemKey = '';
  advanceTinder();
}

function tinderSkip() { advanceTinder(); }

function advanceTinder() {
  tinderPos++;
  if (tinderPos >= tinderItems.length) {
    // Done with this category
    catStatus[tinderCatIndex] = 'reviewed';
    screen = 'slideshow';
    // Auto-advance
    if (tinderCatIndex < DATA.categories.length - 1) {
      currentSlide = tinderCatIndex + 1;
    }
  }
  render();
}

function closeTinder() {
  // Mark as reviewed if any decisions were made
  const cat = DATA.categories[tinderCatIndex];
  const anyDecision = [...cat.nodeIds, ...cat.edgeIds].some(id => {
    const nk = 'node-' + id, ek = 'edge-' + id;
    return (decisions[nk] && decisions[nk].action !== 'pending') || (decisions[ek] && decisions[ek].action !== 'pending');
  });
  if (anyDecision) catStatus[tinderCatIndex] = 'reviewed';
  screen = 'slideshow';
  render();
}

function prevSlide() { if (currentSlide > 0) { currentSlide--; render(); } }
function nextSlide() { if (currentSlide < DATA.categories.length - 1) { currentSlide++; render(); } }
function showFinish() { screen = 'finish'; render(); }

function exportDecisions() {
  const out = [];
  Object.values(decisions).forEach(d => {
    if (d.action !== 'pending') {
      out.push({ type: d.type, id: d.id, action: d.action, comment: d.comment || undefined });
    }
  });

  // Include reclassification decisions
  const reclassifications = [];
  Object.entries(nodeOverrides).forEach(([id, newType]) => {
    const n = nodeById[parseInt(id)];
    if (n && n.node_type !== newType) {
      reclassifications.push({ nodeId: parseInt(id), name: n.name, from: n.node_type, to: newType });
    }
  });

  const payload = {
    projectId: DATA.project.id,
    projectName: DATA.project.name,
    exportedAt: DATA.exportedAt,
    reviewedAt: new Date().toISOString(),
    decisions: out,
    reclassifications: reclassifications.length ? reclassifications : undefined,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = DATA.project.name.replace(/\\s+/g, '-') + '-feedback.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Keyboard nav
document.addEventListener('keydown', (e) => {
  if (showReasonModal) {
    if (e.key === 'Escape') cancelReason();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmReject(); }
    return;
  }
  if (screen === 'tinder') {
    if (e.key === 'ArrowRight' || e.key === 'l') tinderApprove();
    else if (e.key === 'ArrowLeft' || e.key === 'h') tinderReject();
    else if (e.key === 'ArrowDown' || e.key === 'j') tinderSkip();
    else if (e.key === 'Escape') closeTinder();
    return;
  }
  if (screen === 'slideshow') {
    if (e.key === 'ArrowRight') nextSlide();
    else if (e.key === 'ArrowLeft') prevSlide();
  }
});

render();
<\/script>
</body>
</html>`;
}
