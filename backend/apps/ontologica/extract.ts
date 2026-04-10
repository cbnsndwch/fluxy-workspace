/**
 * Ontologica Extraction Pipeline
 *
 * 7-stage AI pipeline inspired by OntoGen (RSC 2026) + Ontogenia (ESWC 2025):
 *
 *   1. CHUNK      — Split document into semantic chunks
 *   2. TERMS      — Extract candidate terms/entities from chunks
 *   3. CLASSIFY   — Categorize terms into classes vs instances
 *   4. TAXONOMY   — Build IS-A hierarchy between classes
 *   5. RELATIONS  — Extract non-taxonomic relationships
 *   6. VALIDATE   — Run consistency checks (Ontogenia metacognitive eval)
 *   7. MERGE      — Merge into existing project graph (entity resolution)
 *
 * Each stage uses structured JSON output from Claude Sonnet for quality,
 * with the Ontogenia metacognitive loop applied at validation stage.
 */

import type Database from 'better-sqlite3';
import { llmCall, extractJSON, type RetryEvent } from '../../llm.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExtractedTerm {
  name: string;
  description: string;
  type: 'class' | 'individual';
  confidence: number;
  source_chunk: number;
}

interface ExtractedRelation {
  source: string;
  target: string;
  relation_type: 'is_a' | 'object_property' | 'data_property';
  relation_name: string;
  description: string;
  confidence: number;
}

interface ValidationIssue {
  type: 'hallucinated_ref' | 'bad_domain_range' | 'shallow_hierarchy' | 'duplicate' | 'circular';
  entity: string;
  description: string;
  severity: 'error' | 'warning';
  suggested_fix: string;
}

// ── Logging ──────────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'milestone';

function createLogger(db: Database.Database, jobId: number) {
  const insert = db.prepare(
    `INSERT INTO onto_pipeline_logs (job_id, stage, level, title, detail, meta) VALUES (?, ?, ?, ?, ?, ?)`
  );

  return function log(
    stage: string,
    level: LogLevel,
    title: string,
    detail?: string,
    meta?: Record<string, unknown>
  ) {
    insert.run(jobId, stage, level, title, detail ?? null, meta ? JSON.stringify(meta) : null);
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'milestone' ? '🎯' : level === 'success' ? '✅' : '📋';
    console.log(`[ontologica] Job #${jobId} [${stage}] ${prefix} ${title}`);
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize a term name for deduplication: lowercase, trim, collapse whitespace */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function updateJob(db: Database.Database, jobId: number, updates: Record<string, unknown>) {
  const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE onto_extraction_jobs SET ${sets} WHERE id = ?`).run(
    ...Object.values(updates), jobId
  );
}

function addStageComplete(db: Database.Database, jobId: number, stage: string) {
  const job = db.prepare('SELECT stages_complete FROM onto_extraction_jobs WHERE id = ?').get(jobId) as any;
  const stages = JSON.parse(job?.stages_complete || '[]');
  stages.push(stage);
  updateJob(db, jobId, { stages_complete: JSON.stringify(stages) });
}

/** LLM call with rate-limit awareness — logs backoffs to the pipeline timeline */
async function pipelineLLM(
  systemPrompt: string,
  userPrompt: string,
  ctx?: { log: ReturnType<typeof createLogger>; db: Database.Database; jobId: number; stage: string }
): Promise<string> {
  const onRetry = ctx ? (event: RetryEvent) => {
    const waitSec = Math.round(event.waitMs / 1000);
    ctx.log(ctx.stage, 'warn', `Rate limited — backing off ${waitSec}s`,
      `Attempt ${event.attempt}/${event.maxRetries} (HTTP ${event.status})`,
      { attempt: event.attempt, maxRetries: event.maxRetries, waitMs: event.waitMs }
    );
    updateJob(ctx.db, ctx.jobId, {
      current_step: `⏳ Rate limited — waiting ${waitSec}s before retry (${event.attempt}/${event.maxRetries})...`
    });
  } : undefined;

  const raw = await llmCall(
    systemPrompt + '\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown, no explanation, just the JSON object.',
    userPrompt,
    { model: 'fast', maxTokens: 4096, temperature: 0.3, onRetry }
  );
  return extractJSON(raw);
}

// ── Pipeline Stages ───────────────────────────────────────────────────────────

/**
 * Stage 1: CHUNK — Split document into semantic chunks
 */
function chunkDocument(text: string, maxWords = 500): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let current = '';
  let wordCount = 0;

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).length;
    if (wordCount + paraWords > maxWords && current) {
      chunks.push(current.trim());
      current = para;
      wordCount = paraWords;
    } else {
      current += '\n\n' + para;
      wordCount += paraWords;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  if (chunks.length === 0 && text.trim()) {
    chunks.push(text.trim());
  }

  return chunks;
}

/**
 * Stage 2: TERMS — Extract candidate terms/entities from each chunk
 */
async function extractTerms(
  chunks: string[],
  domainHint: string,
  existingTerms: string[],
  log: ReturnType<typeof createLogger>,
  db: Database.Database,
  jobId: number,
  ctx: { log: ReturnType<typeof createLogger>; db: Database.Database; jobId: number; stage: string }
): Promise<ExtractedTerm[]> {
  const allTerms: ExtractedTerm[] = [];

  for (let i = 0; i < chunks.length; i++) {
    log('terms', 'info', `Processing chunk ${i + 1} of ${chunks.length}`, `${chunks[i].split(/\s+/).length} words`, { chunk: i + 1, total: chunks.length });

    // Granular per-chunk progress: 10% (start) → 25% (end of terms)
    const chunkProgress = Math.round(10 + ((i + 1) / chunks.length) * 15);
    updateJob(db, jobId, {
      progress_pct: chunkProgress,
      current_step: `Extracting terms from chunk ${i + 1}/${chunks.length}...`
    });

    const existingContext = existingTerms.length > 0
      ? `\nAlready known terms in this domain (avoid duplicates): ${existingTerms.join(', ')}`
      : '';

    const result = await pipelineLLM(
      `You are an ontology engineer extracting domain concepts from text.
Your task: identify ALL meaningful domain concepts, entities, and terms from the given text.
For each term, determine if it's a CLASS (a category/type of thing) or an INDIVIDUAL (a specific instance).

Domain context: ${domainHint || 'general'}${existingContext}

Rules:
- Extract concrete, meaningful terms — not generic words like "system" or "process" unless domain-specific
- Prefer noun phrases over single words when they carry more meaning
- Classify as CLASS if it represents a category (e.g., "Customer", "Invoice", "Product Type")
- Classify as INDIVIDUAL if it's a specific named instance (e.g., "Acme Corp", "Invoice #1234")
- Confidence: 0.0-1.0 based on how clearly the text supports this term being a domain concept
- Do NOT fabricate terms not present or clearly implied by the text`,

      `Extract all domain terms from this text chunk (chunk ${i + 1} of ${chunks.length}):

---
${chunks[i]}
---

Respond with JSON: { "terms": [{ "name": "...", "description": "...", "type": "class"|"individual", "confidence": 0.0-1.0 }] }`,
      ctx
    );

    try {
      const parsed = JSON.parse(result);
      const chunkTerms = parsed.terms || [];
      for (const t of chunkTerms) {
        allTerms.push({ ...t, source_chunk: i });
      }
      log('terms', 'success', `Chunk ${i + 1}: found ${chunkTerms.length} terms`,
        chunkTerms.map((t: any) => t.name).join(', '),
        { chunk: i + 1, count: chunkTerms.length }
      );
    } catch {
      log('terms', 'warn', `Chunk ${i + 1}: failed to parse LLM response`, result.slice(0, 200));
    }
  }

  return allTerms;
}

/**
 * Stage 3: CLASSIFY — Refine term classifications with full context
 */
async function classifyTerms(
  terms: ExtractedTerm[],
  domainHint: string,
  ctx?: { log: ReturnType<typeof createLogger>; db: Database.Database; jobId: number; stage: string }
): Promise<ExtractedTerm[]> {
  const termNames = terms.map(t => `${t.name} (${t.type}, confidence: ${t.confidence})`).join('\n');

  const result = await pipelineLLM(
    `You are an ontology engineer refining term classifications.
Review the following list of extracted domain terms and their initial classifications.
Some terms that were classified as INDIVIDUAL might actually be CLASSes, and vice versa.
Some terms might be duplicates with different surface forms — flag these.

Domain: ${domainHint || 'general'}

Rules:
- A CLASS represents a category: "Customer", "Product", "Order"
- An INDIVIDUAL represents a specific instance: "Acme Corp", "iPhone 15", "Order #1234"
- Merge duplicate terms (e.g., "Customer" and "Customers" → keep "Customer" as class)
- Adjust confidence based on your review`,

    `Review and refine these extracted terms:

${termNames}

Respond with JSON: { "terms": [{ "name": "...", "description": "...", "type": "class"|"individual", "confidence": 0.0-1.0, "merged_from": ["original_name_1"] }] }`,
    ctx
  );

  try {
    const parsed = JSON.parse(result);
    return (parsed.terms || terms).map((t: any, i: number) => ({
      ...t,
      source_chunk: terms[i]?.source_chunk ?? 0,
    }));
  } catch { return terms; }
}

/**
 * Stage 4: TAXONOMY — Build IS-A hierarchy between classes
 */
async function buildTaxonomy(
  classes: ExtractedTerm[],
  domainHint: string,
  ctx?: { log: ReturnType<typeof createLogger>; db: Database.Database; jobId: number; stage: string }
): Promise<{ child: string; parent: string; confidence: number }[]> {
  const classNames = classes.map(c => c.name).join(', ');

  const result = await pipelineLLM(
    `You are an ontology engineer building a class taxonomy (IS-A hierarchy).
Given a list of domain classes, determine which classes are subclasses of which.

Domain: ${domainHint || 'general'}

Rules:
- Only create IS-A (subclass) relationships that are semantically correct
- "Dog IS-A Animal" is correct. "Dog IS-A Cat" is not.
- Build a proper hierarchy — avoid flat structures. Think about intermediate classes.
- Not every class needs a parent — top-level domain concepts are root classes
- Avoid circular hierarchies (A → B → A)
- Confidence: how certain you are about this specific relationship`,

    `Build the IS-A taxonomy for these classes:
${classNames}

Respond with JSON: { "taxonomy": [{ "child": "ClassName", "parent": "ParentClassName", "confidence": 0.0-1.0 }] }`,
    ctx
  );

  try {
    return JSON.parse(result).taxonomy || [];
  } catch { return []; }
}

/**
 * Stage 5: RELATIONS — Extract non-taxonomic relationships
 */
async function extractRelations(
  terms: ExtractedTerm[],
  chunks: string[],
  domainHint: string,
  ctx?: { log: ReturnType<typeof createLogger>; db: Database.Database; jobId: number; stage: string }
): Promise<ExtractedRelation[]> {
  const termNames = terms.map(t => `${t.name} (${t.type})`).join(', ');
  const allText = chunks.join('\n\n---\n\n');
  const textSample = allText.length > 6000 ? allText.slice(0, 6000) + '\n...[truncated]' : allText;

  const result = await pipelineLLM(
    `You are an ontology engineer extracting relationships between domain concepts.
Given domain terms and source text, identify meaningful relationships BEYOND the IS-A hierarchy.

Domain: ${domainHint || 'general'}

Relationship types:
- object_property: links two entities (e.g., Customer PLACES Order, Product BELONGS_TO Category)
- data_property: an entity has a data attribute (e.g., Customer HAS_NAME string, Order HAS_DATE date)

Rules:
- Only extract relationships clearly supported by the text
- Name relationships with clear, verb-based names (hasCustomer, placedBy, belongsTo)
- For data_property, the target is a data type description, not another entity
- Confidence: how clearly the text supports this relationship`,

    `Extract relationships from the text using these domain terms:

Terms: ${termNames}

Source text:
${textSample}

Respond with JSON: { "relations": [{ "source": "TermName", "target": "TermName or data type", "relation_type": "object_property"|"data_property", "relation_name": "verbBasedName", "description": "...", "confidence": 0.0-1.0 }] }`,
    ctx
  );

  try {
    return JSON.parse(result).relations || [];
  } catch { return []; }
}

/**
 * Stage 6: VALIDATE — Ontogenia-inspired metacognitive validation
 */
async function validateOntology(
  terms: ExtractedTerm[],
  taxonomy: { child: string; parent: string; confidence: number }[],
  relations: ExtractedRelation[],
  domainHint: string,
  ctx?: { log: ReturnType<typeof createLogger>; db: Database.Database; jobId: number; stage: string }
): Promise<{ issues: ValidationIssue[]; suggestions: ExtractedTerm[]; fixedRelations: ExtractedRelation[] }> {
  const ontologySummary = `
CLASSES: ${terms.filter(t => t.type === 'class').map(t => t.name).join(', ')}
INDIVIDUALS: ${terms.filter(t => t.type === 'individual').map(t => t.name).join(', ')}
TAXONOMY: ${taxonomy.map(t => `${t.child} IS-A ${t.parent}`).join(', ')}
RELATIONS: ${relations.map(r => `${r.source} --${r.relation_name}--> ${r.target}`).join(', ')}
  `.trim();

  const result = await pipelineLLM(
    `You are a senior ontology engineer performing quality validation.
Apply the Ontogenia metacognitive evaluation to the extracted ontology:

1. INTERPRETATION — Do the concepts accurately represent the domain "${domainHint || 'general'}"?
2. REFLECTION — Are there obvious gaps? Missing intermediate classes? Missing key relationships?
3. EVALUATION — Check for: circular hierarchies, duplicate concepts, orphaned individuals, overly shallow hierarchy, hallucinated references
4. TESTING — Would domain experts accept this ontology? What would they challenge?

For each issue found, classify as:
- hallucinated_ref: concept doesn't belong in this domain
- bad_domain_range: relationship connects wrong types
- shallow_hierarchy: missing intermediate classes
- duplicate: two terms mean the same thing
- circular: circular IS-A chain`,

    `Validate this ontology:

${ontologySummary}

Respond with JSON: {
  "issues": [{ "type": "...", "entity": "affected concept name", "description": "...", "severity": "error"|"warning", "suggested_fix": "..." }],
  "missing_concepts": [{ "name": "...", "description": "...", "type": "class"|"individual", "confidence": 0.0-1.0 }],
  "fixed_relations": [{ "source": "...", "target": "...", "relation_type": "...", "relation_name": "...", "description": "...", "confidence": 0.0-1.0, "fix_description": "what was fixed" }]
}`,
    ctx
  );

  try {
    const parsed = JSON.parse(result);
    return {
      issues: parsed.issues || [],
      suggestions: (parsed.missing_concepts || []).map((t: any) => ({ ...t, source_chunk: -1 })),
      fixedRelations: parsed.fixed_relations || [],
    };
  } catch {
    return { issues: [], suggestions: [], fixedRelations: [] };
  }
}

/**
 * Stage 7: MERGE — Write extracted ontology to database with entity resolution
 *
 * Deduplication strategy:
 *   - Nodes: match by normalized name (trim + collapse whitespace + lowercase) within project
 *   - Edges: match by (edge_type, name, source_node_id, target_node_id/target_value)
 *   - Post-merge: deduplicate any existing duplicate nodes from prior runs
 */
function mergeIntoGraph(
  db: Database.Database,
  projectId: number,
  jobId: number,
  documentId: number | null,
  terms: ExtractedTerm[],
  taxonomy: { child: string; parent: string; confidence: number }[],
  relations: ExtractedRelation[]
): { nodesCreated: number; edgesCreated: number; nodesDeduplicated: number; edgesSkipped: number } {
  const insertNode = db.prepare(`
    INSERT INTO onto_nodes (project_id, node_type, name, description, uri, confidence, status, source_document_id, extraction_job_id, pos_x, pos_y, metadata)
    VALUES (?, ?, ?, ?, ?, ?, 'suggested', ?, ?, ?, ?, '{}')
  `);
  const insertEdge = db.prepare(`
    INSERT INTO onto_edges (project_id, edge_type, name, source_node_id, target_node_id, target_value, description, confidence, status, source_document_id, extraction_job_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?, '{}')
  `);

  // Load ALL existing nodes for this project (normalized name → id) for robust dedup
  const allExistingNodes = db.prepare('SELECT id, name, node_type FROM onto_nodes WHERE project_id = ?').all(projectId) as { id: number; name: string; node_type: string }[];
  const existingNodeMap = new Map<string, number>();
  for (const n of allExistingNodes) {
    const key = normalizeName(n.name);
    // Keep the lowest ID (oldest) as the canonical one
    if (!existingNodeMap.has(key)) {
      existingNodeMap.set(key, n.id);
    }
  }

  // Edge dedup: check if edge already exists
  const findEdgeObj = db.prepare(
    'SELECT id FROM onto_edges WHERE project_id = ? AND edge_type = ? AND LOWER(name) = LOWER(?) AND source_node_id = ? AND target_node_id = ?'
  );
  const findEdgeData = db.prepare(
    'SELECT id FROM onto_edges WHERE project_id = ? AND edge_type = ? AND LOWER(name) = LOWER(?) AND source_node_id = ? AND target_value = ?'
  );

  let nodesCreated = 0;
  let edgesCreated = 0;
  let edgesSkipped = 0;
  const nodeIdMap = new Map<string, number>();

  const tx = db.transaction(() => {
    const classes = terms.filter(t => t.type === 'class');
    const individuals = terms.filter(t => t.type === 'individual');
    const cols = Math.max(4, Math.ceil(Math.sqrt(classes.length)));

    for (let i = 0; i < terms.length; i++) {
      const t = terms[i];
      const normalized = normalizeName(t.name);

      // Check against all existing nodes (normalized)
      const existingId = existingNodeMap.get(normalized);
      if (existingId) {
        nodeIdMap.set(normalized, existingId);
        continue;
      }

      const isClass = t.type === 'class';
      const idx = isClass ? classes.indexOf(t) : individuals.indexOf(t);
      const posX = (idx % cols) * 250;
      const posY = isClass ? Math.floor(idx / cols) * 180 : (Math.ceil(classes.length / cols) + 1) * 180 + Math.floor(idx / cols) * 150;

      const result = insertNode.run(
        projectId, t.type, t.name, t.description,
        null, t.confidence, documentId, jobId,
        posX, posY
      );
      const newId = Number(result.lastInsertRowid);
      nodeIdMap.set(normalized, newId);
      existingNodeMap.set(normalized, newId);
      nodesCreated++;
    }

    for (const rel of taxonomy) {
      const childId = nodeIdMap.get(normalizeName(rel.child));
      const parentId = nodeIdMap.get(normalizeName(rel.parent));
      if (childId && parentId && childId !== parentId) {
        // Check for existing edge
        const existing = findEdgeObj.get(projectId, 'is_a', 'subClassOf', childId, parentId) as { id: number } | undefined;
        if (existing) {
          edgesSkipped++;
          continue;
        }
        db.prepare('UPDATE onto_nodes SET parent_id = ? WHERE id = ?').run(parentId, childId);
        insertEdge.run(projectId, 'is_a', 'subClassOf', childId, parentId, null, `${rel.child} IS-A ${rel.parent}`, rel.confidence, documentId, jobId);
        edgesCreated++;
      }
    }

    for (const rel of relations) {
      const sourceId = nodeIdMap.get(normalizeName(rel.source));
      const targetId = nodeIdMap.get(normalizeName(rel.target));

      if (rel.relation_type === 'data_property') {
        if (sourceId) {
          const existing = findEdgeData.get(projectId, 'data_property', rel.relation_name, sourceId, rel.target) as { id: number } | undefined;
          if (existing) { edgesSkipped++; continue; }
          insertEdge.run(projectId, 'data_property', rel.relation_name, sourceId, null, rel.target, rel.description, rel.confidence, documentId, jobId);
          edgesCreated++;
        }
      } else if (rel.relation_type === 'object_property') {
        if (sourceId && targetId) {
          const existing = findEdgeObj.get(projectId, 'object_property', rel.relation_name, sourceId, targetId) as { id: number } | undefined;
          if (existing) { edgesSkipped++; continue; }
          insertEdge.run(projectId, 'object_property', rel.relation_name, sourceId, targetId, null, rel.description, rel.confidence, documentId, jobId);
          edgesCreated++;
        }
      }
    }
  });

  tx();

  // Post-merge: deduplicate existing nodes from prior runs
  const nodesDeduplicated = deduplicateExistingNodes(db, projectId);

  return { nodesCreated, edgesCreated, nodesDeduplicated, edgesSkipped };
}

/**
 * Post-pipeline cleanup: merge duplicate nodes that share the same normalized name + type.
 * Keeps the oldest node (lowest ID), reassigns all edges to it, deletes the duplicates.
 * Exported so it can also be called via API for manual cleanup.
 */
export function deduplicateExistingNodes(db: Database.Database, projectId: number): number {
  const allNodes = db.prepare(
    'SELECT id, name, node_type FROM onto_nodes WHERE project_id = ? ORDER BY id ASC'
  ).all(projectId) as { id: number; name: string; node_type: string }[];

  // Group by normalized name + type
  const groups = new Map<string, number[]>();
  for (const node of allNodes) {
    const key = `${normalizeName(node.name)}::${node.node_type}`;
    const ids = groups.get(key) || [];
    ids.push(node.id);
    groups.set(key, ids);
  }

  let totalMerged = 0;

  const tx = db.transaction(() => {
    for (const [, ids] of groups) {
      if (ids.length <= 1) continue;

      const canonical = ids[0]; // oldest (lowest ID)
      const duplicates = ids.slice(1);

      for (const dupId of duplicates) {
        // Reassign edges: source_node_id
        db.prepare('UPDATE onto_edges SET source_node_id = ? WHERE source_node_id = ? AND project_id = ?')
          .run(canonical, dupId, projectId);
        // Reassign edges: target_node_id
        db.prepare('UPDATE onto_edges SET target_node_id = ? WHERE target_node_id = ? AND project_id = ?')
          .run(canonical, dupId, projectId);
        // Reassign parent_id references
        db.prepare('UPDATE onto_nodes SET parent_id = ? WHERE parent_id = ? AND project_id = ?')
          .run(canonical, dupId, projectId);
        // Delete the duplicate node
        db.prepare('DELETE FROM onto_nodes WHERE id = ?').run(dupId);
        totalMerged++;
      }
    }

    // Clean up any duplicate edges that resulted from reassignment
    // (same edge_type + name + source + target/value)
    const dupeEdges = db.prepare(`
      SELECT MIN(id) as keep_id, edge_type, name, source_node_id, target_node_id, target_value, COUNT(*) as cnt
      FROM onto_edges WHERE project_id = ?
      GROUP BY edge_type, LOWER(name), source_node_id, target_node_id, target_value
      HAVING cnt > 1
    `).all(projectId) as any[];

    for (const group of dupeEdges) {
      db.prepare(`
        DELETE FROM onto_edges WHERE project_id = ? AND edge_type = ? AND LOWER(name) = LOWER(?)
        AND source_node_id = ? AND (target_node_id IS ? OR (target_node_id IS NULL AND ? IS NULL))
        AND (target_value IS ? OR (target_value IS NULL AND ? IS NULL))
        AND id != ?
      `).run(
        projectId, group.edge_type, group.name, group.source_node_id,
        group.target_node_id, group.target_node_id,
        group.target_value, group.target_value,
        group.keep_id
      );
    }
  });

  tx();
  return totalMerged;
}

// ── Main Pipeline ─────────────────────────────────────────────────────────────

export async function runExtractionPipeline(db: Database.Database, jobId: number) {
  const log = createLogger(db, jobId);
  log('pipeline', 'milestone', 'Pipeline started', `Job #${jobId}`);

  const job = db.prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?').get(jobId) as any;
  if (!job) {
    log('pipeline', 'error', 'Job not found');
    throw new Error(`Job ${jobId} not found`);
  }

  const project = db.prepare('SELECT * FROM onto_projects WHERE id = ?').get(job.project_id) as any;
  if (!project) {
    log('pipeline', 'error', 'Project not found', `Project #${job.project_id}`);
    throw new Error(`Project ${job.project_id} not found`);
  }

  // Gather text
  let documents: any[];
  if (job.document_id) {
    const doc = db.prepare('SELECT * FROM onto_documents WHERE id = ?').get(job.document_id);
    documents = doc ? [doc] : [];
  } else {
    documents = db.prepare('SELECT * FROM onto_documents WHERE project_id = ?').all(job.project_id) as any[];
  }

  if (documents.length === 0) {
    log('pipeline', 'error', 'No documents to process');
    updateJob(db, jobId, { status: 'failed', error: 'No documents to process' });
    return;
  }

  const fullText = documents.map((d: any) => d.content_text).join('\n\n---\n\n');
  const domainHint = project.domain_hint || project.name;
  const totalWords = fullText.split(/\s+/).length;

  // Get existing terms for dedup — include type so LLM can better avoid re-extracting
  const existingNodes = db.prepare('SELECT name, node_type FROM onto_nodes WHERE project_id = ?').all(job.project_id) as { name: string; node_type: string }[];
  // Deduplicate by normalized name before passing to LLM
  const seenNormalized = new Set<string>();
  const existingTerms: string[] = [];
  for (const n of existingNodes) {
    const norm = normalizeName(n.name);
    if (!seenNormalized.has(norm)) {
      seenNormalized.add(norm);
      existingTerms.push(`${n.name} (${n.node_type})`);
    }
  }

  updateJob(db, jobId, { status: 'running', started_at: new Date().toISOString(), pipeline_stage: 'chunk' });
  log('pipeline', 'info', 'Processing documents', `${documents.length} document(s), ${totalWords.toLocaleString()} words, domain: "${domainHint}"`, {
    docCount: documents.length,
    totalWords,
    domain: domainHint,
    existingTerms: existingTerms.length
  });

  try {
    // ── Stage 1: CHUNK ───────────────────────────────────────────────────────
    updateJob(db, jobId, { pipeline_stage: 'chunk', current_step: 'Splitting documents into semantic chunks...', progress_pct: 5 });
    log('chunk', 'info', 'Splitting documents into semantic chunks');

    const chunks = chunkDocument(fullText);

    for (const doc of documents) {
      const docChunks = chunkDocument(doc.content_text);
      db.prepare('UPDATE onto_documents SET chunk_count = ?, status = ? WHERE id = ?')
        .run(docChunks.length, 'processed', doc.id);
    }

    log('chunk', 'success', `Created ${chunks.length} chunks`, `Average ~${Math.round(totalWords / chunks.length)} words per chunk`, { chunkCount: chunks.length });
    addStageComplete(db, jobId, 'chunk');

    // ── Stage 2: EXTRACT TERMS ───────────────────────────────────────────────
    updateJob(db, jobId, { pipeline_stage: 'terms', current_step: `Extracting terms from ${chunks.length} chunks...`, progress_pct: 10 });
    log('terms', 'milestone', `Starting term extraction`, `${chunks.length} chunks to process with AI`);

    const makeCtx = (stage: string) => ({ log, db, jobId, stage });

    let terms = await extractTerms(chunks, domainHint, existingTerms, log, db, jobId, makeCtx('terms'));

    const classes = terms.filter(t => t.type === 'class');
    const individuals = terms.filter(t => t.type === 'individual');
    log('terms', 'success', `Extracted ${terms.length} raw terms`, `${classes.length} classes, ${individuals.length} individuals`, {
      total: terms.length, classes: classes.length, individuals: individuals.length
    });
    addStageComplete(db, jobId, 'terms');

    // ── Stage 3: CLASSIFY ────────────────────────────────────────────────────
    updateJob(db, jobId, { pipeline_stage: 'classify', current_step: `Refining classification of ${terms.length} terms...`, progress_pct: 30 });
    log('classify', 'milestone', 'Refining term classifications', `Sending ${terms.length} terms for AI review`);

    const termsBefore = terms.length;
    terms = await classifyTerms(terms, domainHint, makeCtx('classify'));

    const merged = termsBefore - terms.length;
    const reclassified = terms.filter((t, i) => {
      const before = i < classes.length ? 'class' : 'individual';
      return t.type !== before;
    }).length;
    log('classify', 'success', `Refined to ${terms.length} terms`, merged > 0 ? `Merged ${merged} duplicates` : 'No duplicates found', {
      finalCount: terms.length, merged, reclassified
    });
    addStageComplete(db, jobId, 'classify');

    // ── Stage 4: TAXONOMY ────────────────────────────────────────────────────
    const classesForTax = terms.filter(t => t.type === 'class');
    updateJob(db, jobId, { pipeline_stage: 'taxonomy', current_step: `Building taxonomy from ${classesForTax.length} classes...`, progress_pct: 45 });
    log('taxonomy', 'milestone', 'Building IS-A hierarchy', `${classesForTax.length} classes to organize`);

    const taxonomy = await buildTaxonomy(classesForTax, domainHint, makeCtx('taxonomy'));

    const rootClasses = classesForTax.length - new Set(taxonomy.map(t => t.child)).size;
    log('taxonomy', 'success', `Built ${taxonomy.length} IS-A relationships`, `${rootClasses} root classes, max depth estimable from hierarchy`, {
      relationships: taxonomy.length, rootClasses
    });
    addStageComplete(db, jobId, 'taxonomy');

    // ── Stage 5: RELATIONS ───────────────────────────────────────────────────
    updateJob(db, jobId, { pipeline_stage: 'relations', current_step: 'Extracting relationships...', progress_pct: 60 });
    log('relations', 'milestone', 'Extracting non-taxonomic relationships', `Between ${terms.length} terms`);

    let relations = await extractRelations(terms, chunks, domainHint, makeCtx('relations'));

    const objProps = relations.filter(r => r.relation_type === 'object_property').length;
    const dataProps = relations.filter(r => r.relation_type === 'data_property').length;
    log('relations', 'success', `Found ${relations.length} relationships`, `${objProps} object properties, ${dataProps} data properties`, {
      total: relations.length, objectProperties: objProps, dataProperties: dataProps
    });
    addStageComplete(db, jobId, 'relations');

    // ── Stage 6: VALIDATE ────────────────────────────────────────────────────
    updateJob(db, jobId, { pipeline_stage: 'validate', current_step: 'Running metacognitive validation...', progress_pct: 75 });
    log('validate', 'milestone', 'Running Ontogenia metacognitive validation', 'Checking interpretation, reflection, evaluation, and testing');

    const validation = await validateOntology(terms, taxonomy, relations, domainHint, makeCtx('validate'));

    if (validation.issues.length > 0) {
      const errors = validation.issues.filter(i => i.severity === 'error').length;
      const warnings = validation.issues.filter(i => i.severity === 'warning').length;
      log('validate', errors > 0 ? 'warn' : 'info', `Found ${validation.issues.length} validation issues`,
        validation.issues.map(i => `[${i.severity}] ${i.entity}: ${i.description}`).join('\n'),
        { errors, warnings, issues: validation.issues }
      );
    } else {
      log('validate', 'success', 'Validation passed with no issues');
    }

    if (validation.suggestions.length > 0) {
      terms = [...terms, ...validation.suggestions];
      log('validate', 'info', `Added ${validation.suggestions.length} suggested concepts`,
        validation.suggestions.map(s => s.name).join(', '),
        { count: validation.suggestions.length }
      );
    }
    if (validation.fixedRelations.length > 0) {
      relations = [...relations, ...validation.fixedRelations];
      log('validate', 'info', `Applied ${validation.fixedRelations.length} relation fixes`,
        validation.fixedRelations.map((r: any) => r.fix_description || `${r.source} → ${r.target}`).join(', ')
      );
    }

    updateJob(db, jobId, {
      config: JSON.stringify({
        ...JSON.parse(job.config || '{}'),
        validation_issues: validation.issues,
        terms_count: terms.length,
        relations_count: relations.length,
        taxonomy_count: taxonomy.length,
      }),
    });
    addStageComplete(db, jobId, 'validate');

    // ── Stage 7: MERGE ──────────────────────────────────────────────────────
    updateJob(db, jobId, { pipeline_stage: 'merge', current_step: 'Merging into knowledge graph...', progress_pct: 90 });
    log('merge', 'milestone', 'Merging into knowledge graph', `${terms.length} terms + ${taxonomy.length} taxonomy + ${relations.length} relations`);

    const { nodesCreated, edgesCreated, nodesDeduplicated, edgesSkipped } = mergeIntoGraph(
      db, job.project_id, jobId,
      job.document_id, terms, taxonomy, relations
    );
    addStageComplete(db, jobId, 'merge');

    const dedupParts = [];
    if (terms.length - nodesCreated > 0) dedupParts.push(`${terms.length - nodesCreated} terms matched existing nodes`);
    if (edgesSkipped > 0) dedupParts.push(`${edgesSkipped} duplicate edges skipped`);
    if (nodesDeduplicated > 0) dedupParts.push(`${nodesDeduplicated} prior duplicate nodes merged`);
    const dedupMsg = dedupParts.length > 0 ? dedupParts.join(', ') : 'No duplicates found';

    log('merge', 'success', `Created ${nodesCreated} nodes and ${edgesCreated} edges`,
      dedupMsg,
      { nodesCreated, edgesCreated, edgesSkipped, nodesDeduplicated, deduplicated: terms.length - nodesCreated }
    );

    // ── Done! ────────────────────────────────────────────────────────────────
    updateJob(db, jobId, {
      status: 'completed',
      pipeline_stage: 'done',
      current_step: `Extracted ${nodesCreated} concepts and ${edgesCreated} relationships`,
      progress_pct: 100,
      nodes_created: nodesCreated,
      edges_created: edgesCreated,
      completed_at: new Date().toISOString(),
    });

    const nc = (db.prepare('SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ?').get(job.project_id) as any).c;
    const ec = (db.prepare('SELECT COUNT(*) as c FROM onto_edges WHERE project_id = ?').get(job.project_id) as any).c;
    db.prepare('UPDATE onto_projects SET node_count = ?, edge_count = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(nc, ec, job.project_id);

    const elapsed = job.started_at ? Math.round((Date.now() - new Date(job.started_at).getTime()) / 1000) : 0;
    log('pipeline', 'milestone', 'Pipeline complete!',
      `${nodesCreated} concepts, ${edgesCreated} relationships extracted in ~${elapsed}s`,
      { nodesCreated, edgesCreated, elapsedSeconds: elapsed, totalNodes: nc, totalEdges: ec }
    );

  } catch (err: any) {
    log('pipeline', 'error', 'Pipeline failed', err.message || String(err), { stack: err.stack });
    console.error(`[ontologica] Job ${jobId} failed:`, err);
    updateJob(db, jobId, {
      status: 'failed',
      error: err.message || String(err),
      completed_at: new Date().toISOString(),
    });
  }
}
