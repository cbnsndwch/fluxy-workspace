import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';

// ── Embedding Pipeline (shared with dedup.ts via same singleton) ─────────────

let extractorPromise: Promise<any> | null = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      console.log('[layer-suggest] Loading embedding model...');
      const ext = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        dtype: 'fp32',
      });
      console.log('[layer-suggest] Embedding model ready');
      return ext;
    })();
  }
  return extractorPromise;
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface LayerSuggestion {
  node_id: number;
  node_name: string;
  node_description: string | null;
  node_type: string;
  match: {
    item_id: number;
    layer_id: number;
    layer_name: string;
    layer_slug: string;
    uri: string;
    label: string;
    local_name: string;
    description: string | null;
    item_type: string;
    parent_uri: string | null;
  };
  similarity: number;
}

// ── Dismissals table ────────────────────────────────────────────────────────

function ensureDismissalsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS onto_layer_suggestion_dismissals (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
      node_id    INTEGER NOT NULL,
      item_id    INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, node_id, item_id)
    )
  `);
}

// ── Core Logic ──────────────────────────────────────────────────────────────

async function findLayerSuggestions(
  db: Database.Database,
  projectId: number,
  threshold: number = 0.70
): Promise<LayerSuggestion[]> {
  // Get custom nodes (no layer_id — these are extracted, not from base layers)
  const customNodes = db.prepare(
    `SELECT id, name, description, node_type
     FROM onto_nodes
     WHERE project_id = ? AND layer_id IS NULL`
  ).all(projectId) as Array<{ id: number; name: string; description: string | null; node_type: string }>;

  if (customNodes.length === 0) return [];

  // Get base layer items from activated layers for this project
  const baseItems = db.prepare(
    `SELECT bli.id as item_id, bli.layer_id, bli.item_type, bli.uri, bli.local_name,
            bli.label, bli.description, bli.parent_uri,
            bl.name as layer_name, bl.slug as layer_slug
     FROM onto_base_layer_items bli
     JOIN onto_project_layers pl ON pl.layer_id = bli.layer_id AND pl.project_id = ?
     JOIN onto_base_layers bl ON bl.id = bli.layer_id
     WHERE bli.item_type IN ('class', 'individual')`
  ).all(projectId) as any[];

  if (baseItems.length === 0) return [];

  // Load dismissals
  ensureDismissalsTable(db);
  const dismissals = db.prepare(
    `SELECT node_id, item_id FROM onto_layer_suggestion_dismissals WHERE project_id = ?`
  ).all(projectId) as Array<{ node_id: number; item_id: number }>;
  const dismissedSet = new Set(dismissals.map(d => `${d.node_id}-${d.item_id}`));

  // Build text arrays for embedding
  const nodeTexts = customNodes.map(n => n.description ? `${n.name}: ${n.description}` : n.name);
  const itemTexts = baseItems.map((i: any) => i.description ? `${i.label || i.local_name}: ${i.description}` : (i.label || i.local_name));

  const allTexts = [...nodeTexts, ...itemTexts];

  // Get embeddings in one batch
  const extractor = await getExtractor();
  const output = await extractor(allTexts, { pooling: 'mean', normalize: true });

  const data = output.data as Float32Array;
  const dims = output.dims as number[];
  const embDim = dims[1];

  // Split embeddings
  const nodeEmbeddings: number[][] = [];
  for (let i = 0; i < customNodes.length; i++) {
    nodeEmbeddings.push(Array.from(data.slice(i * embDim, (i + 1) * embDim)));
  }
  const itemEmbeddings: number[][] = [];
  const offset = customNodes.length;
  for (let i = 0; i < baseItems.length; i++) {
    itemEmbeddings.push(Array.from(data.slice((offset + i) * embDim, (offset + i + 1) * embDim)));
  }

  // Find best match for each custom node
  const suggestions: LayerSuggestion[] = [];

  for (let ni = 0; ni < customNodes.length; ni++) {
    const node = customNodes[ni];
    let bestSim = 0;
    let bestIdx = -1;

    for (let ii = 0; ii < baseItems.length; ii++) {
      // Skip dismissed pairs
      if (dismissedSet.has(`${node.id}-${baseItems[ii].item_id}`)) continue;

      const sim = dotProduct(nodeEmbeddings[ni], itemEmbeddings[ii]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = ii;
      }
    }

    if (bestIdx >= 0 && bestSim >= threshold) {
      const item = baseItems[bestIdx];
      suggestions.push({
        node_id: node.id,
        node_name: node.name,
        node_description: node.description,
        node_type: node.node_type,
        match: {
          item_id: item.item_id,
          layer_id: item.layer_id,
          layer_name: item.layer_name,
          layer_slug: item.layer_slug,
          uri: item.uri,
          label: item.label,
          local_name: item.local_name,
          description: item.description,
          item_type: item.item_type,
          parent_uri: item.parent_uri,
        },
        similarity: Math.round(bestSim * 1000) / 1000,
      });
    }
  }

  // Sort by similarity descending
  suggestions.sort((a, b) => b.similarity - a.similarity);
  return suggestions;
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerLayerSuggestionRoutes(r: Router, db: Database.Database): void {
  ensureDismissalsTable(db);

  // Scan for custom nodes that match base layer items
  r.get('/api/ontologica/projects/:projectId/layer-suggestions', async (req: Request, res: Response) => {
    try {
      const projectId = Number(req.params.projectId);
      const threshold = Number(req.query.threshold) || 0.70;
      const project = db.prepare('SELECT id FROM onto_projects WHERE id = ?').get(projectId);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const suggestions = await findLayerSuggestions(db, projectId, Math.max(0.5, Math.min(0.99, threshold)));
      res.json({ suggestions, threshold, computed_at: new Date().toISOString() });
    } catch (err: any) {
      console.error('[layer-suggest] Scan error:', err);
      res.status(500).json({ error: err.message || 'Layer suggestion scan failed' });
    }
  });

  // Accept suggestion: link custom node to base layer item
  r.post('/api/ontologica/projects/:projectId/layer-suggestions/accept', (req: Request, res: Response) => {
    try {
      const projectId = Number(req.params.projectId);
      const { node_id, item_id, layer_id, base_item_uri } = req.body;
      if (!node_id || !item_id) return res.status(400).json({ error: 'node_id and item_id required' });

      db.prepare(
        `UPDATE onto_nodes SET layer_id = ?, base_item_uri = ?, updated_at = datetime('now')
         WHERE id = ? AND project_id = ?`
      ).run(layer_id, base_item_uri, node_id, projectId);

      const node = db.prepare('SELECT * FROM onto_nodes WHERE id = ?').get(node_id);
      res.json({ ok: true, node });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mark as subclass: create is_a edge from custom node to a new node representing the base item
  r.post('/api/ontologica/projects/:projectId/layer-suggestions/subclass', (req: Request, res: Response) => {
    try {
      const projectId = Number(req.params.projectId);
      const { node_id, item_id, layer_id, base_item_uri, base_item_name } = req.body;
      if (!node_id || !item_id) return res.status(400).json({ error: 'node_id and item_id required' });

      const tx = db.transaction(() => {
        // Check if a node for this base item already exists in the project
        let parentNode = db.prepare(
          `SELECT id FROM onto_nodes WHERE project_id = ? AND base_item_uri = ?`
        ).get(projectId, base_item_uri) as any;

        if (!parentNode) {
          // Create a node for the base layer item
          const result = db.prepare(
            `INSERT INTO onto_nodes (project_id, node_type, name, description, uri, confidence, status, layer_id, base_item_uri)
             VALUES (?, 'class', ?, ?, ?, 1.0, 'approved', ?, ?)`
          ).run(projectId, base_item_name, `Standard vocabulary term from base layer`, base_item_uri, layer_id, base_item_uri);
          parentNode = { id: result.lastInsertRowid };
        }

        // Set the custom node's parent to the base item node
        db.prepare(
          `UPDATE onto_nodes SET parent_id = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`
        ).run(parentNode.id, node_id, projectId);

        // Create is_a edge if it doesn't exist
        const existingEdge = db.prepare(
          `SELECT id FROM onto_edges WHERE project_id = ? AND source_node_id = ? AND target_node_id = ? AND edge_type = 'is_a'`
        ).get(projectId, node_id, parentNode.id);

        if (!existingEdge) {
          db.prepare(
            `INSERT INTO onto_edges (project_id, edge_type, name, source_node_id, target_node_id, confidence, status)
             VALUES (?, 'is_a', 'subClassOf', ?, ?, 1.0, 'approved')`
          ).run(projectId, node_id, parentNode.id);
        }

        // Update counts
        const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ?').get(projectId) as any).c;
        const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM onto_edges WHERE project_id = ?').get(projectId) as any).c;
        db.prepare("UPDATE onto_projects SET node_count = ?, edge_count = ?, updated_at = datetime('now') WHERE id = ?")
          .run(nodeCount, edgeCount, projectId);
      });

      tx();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dismiss suggestion: don't show this pair again
  r.post('/api/ontologica/projects/:projectId/layer-suggestions/dismiss', (req: Request, res: Response) => {
    try {
      const projectId = Number(req.params.projectId);
      const { node_id, item_id } = req.body;
      if (!node_id || !item_id) return res.status(400).json({ error: 'node_id and item_id required' });

      db.prepare(
        `INSERT OR IGNORE INTO onto_layer_suggestion_dismissals (project_id, node_id, item_id) VALUES (?, ?, ?)`
      ).run(projectId, node_id, item_id);

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clear all suggestion dismissals
  r.delete('/api/ontologica/projects/:projectId/layer-suggestions/dismissals', (req: Request, res: Response) => {
    try {
      const projectId = Number(req.params.projectId);
      const result = db.prepare('DELETE FROM onto_layer_suggestion_dismissals WHERE project_id = ?').run(projectId);
      res.json({ ok: true, cleared: result.changes });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
