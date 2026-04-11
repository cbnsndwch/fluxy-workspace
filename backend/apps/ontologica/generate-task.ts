/**
 * Ontologica Task File Generator
 *
 * Generates a task .md file + oneShot CRON entry for a Claude agent
 * to execute the extraction pipeline autonomously.
 *
 * The agent IS the extraction engine — it reads documents, performs
 * all 7 stages of ontology extraction itself, and writes structured
 * results back to the DB via REST API. No separate Anthropic API calls.
 */

import type Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const WORKSPACE = path.resolve(import.meta.dirname, '../../..');
const TASKS_DIR = path.join(WORKSPACE, 'tasks');
const CRONS_PATH = path.join(WORKSPACE, 'CRONS.json');
const BACKEND_URL = 'http://localhost:3004';

/**
 * Generate a task file and register a oneShot CRON for the extraction pipeline.
 * Returns the CRON ID for tracking.
 */
export function generateExtractionTask(db: Database.Database, jobId: number): string {
  const job = db.prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?').get(jobId) as any;
  if (!job) throw new Error(`Job ${jobId} not found`);

  const project = db.prepare('SELECT * FROM onto_projects WHERE id = ?').get(job.project_id) as any;
  if (!project) throw new Error(`Project ${job.project_id} not found`);

  // Gather documents
  let documents: any[];
  if (job.document_id) {
    const doc = db.prepare('SELECT * FROM onto_documents WHERE id = ?').get(job.document_id);
    documents = doc ? [doc] : [];
  } else {
    documents = db.prepare(
      'SELECT * FROM onto_documents WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC'
    ).all(job.project_id) as any[];
  }

  if (documents.length === 0) {
    db.prepare(`UPDATE onto_extraction_jobs SET status = 'failed', error = 'No documents to process' WHERE id = ?`).run(jobId);
    throw new Error('No documents to process');
  }

  // Existing terms for deduplication
  const existingNodes = db.prepare('SELECT name FROM onto_nodes WHERE project_id = ?').all(job.project_id) as any[];
  const existingTerms = existingNodes.map((n: any) => n.name);

  const totalWords = documents.reduce((sum: number, d: any) => sum + (d.content_text || '').split(/\s+/).length, 0);
  const domainHint = project.domain_hint || project.name;

  // Build document text block
  const docTextBlock = documents.map((d: any, i: number) =>
    `### Document ${i + 1}: ${d.filename} (ID: ${d.id}, ${d.word_count || '?'} words)\n\n${d.content_text}`
  ).join('\n\n---\n\n');

  // Generate the task file
  const cronId = `onto-pipeline-${jobId}`;
  const taskContent = buildTaskMarkdown({
    jobId,
    projectId: project.id,
    projectName: project.name,
    domainHint,
    baseUri: project.base_uri || 'http://ontologica.local/',
    docCount: documents.length,
    totalWords,
    documentText: docTextBlock,
    existingTerms,
    documentIds: documents.map((d: any) => d.id),
  });

  // Write task file
  if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });
  fs.writeFileSync(path.join(TASKS_DIR, `${cronId}.md`), taskContent, 'utf-8');

  // Register oneShot CRON — fire within 1 minute
  const crons = JSON.parse(fs.readFileSync(CRONS_PATH, 'utf-8'));
  // Remove any stale entry for this job
  const filtered = crons.filter((c: any) => c.id !== cronId);
  filtered.push({
    id: cronId,
    schedule: '* * * * *',
    task: `Run Ontologica extraction pipeline for job #${jobId}, project "${project.name}". See tasks/${cronId}.md for full instructions.`,
    enabled: true,
    oneShot: true,
  });
  fs.writeFileSync(CRONS_PATH, JSON.stringify(filtered, null, 2), 'utf-8');

  // Update job status
  db.prepare(`UPDATE onto_extraction_jobs SET status = 'queued', current_step = 'Agent dispatched — waiting for CRON pickup...' WHERE id = ?`).run(jobId);

  console.log(`[ontologica] Generated task ${cronId}.md + oneShot CRON for job #${jobId}`);
  return cronId;
}

// ── Task File Template ──────────────────────────────────────────────────────

interface TaskParams {
  jobId: number;
  projectId: number;
  projectName: string;
  domainHint: string;
  baseUri: string;
  docCount: number;
  totalWords: number;
  documentText: string;
  existingTerms: string[];
  documentIds: number[];
}

function buildTaskMarkdown(p: TaskParams): string {
  const API = BACKEND_URL;
  const existingTermsList = p.existingTerms.length > 0
    ? p.existingTerms.join(', ')
    : '(none — this is a fresh project)';

  return `# Ontologica Extraction Pipeline — Job #${p.jobId}

You are running the ontology extraction pipeline for an AI-powered knowledge mapping system.
Your job: read the documents below, extract a structured ontology (concepts, taxonomy, relationships),
and write the results to the database via REST API.

**You ARE the extraction engine.** Do not call any external LLM APIs. Use your own intelligence
to perform each stage of extraction. Write results back via curl commands.

## Job Context

| Field | Value |
|-------|-------|
| Job ID | ${p.jobId} |
| Project ID | ${p.projectId} |
| Project | ${p.projectName} |
| Domain | ${p.domainHint} |
| Documents | ${p.docCount} (${p.totalWords.toLocaleString()} words) |

## Step 0 — Check Quota

\`\`\`bash
curl -s ${API}/api/quota
\`\`\`

Read the \`recommendation\` field:
- **aggressive** → Full speed ahead. No delays needed.
- **moderate** → Proceed normally. The pipeline doesn't make API calls anyway.
- **cautious** → Proceed. You're not consuming API quota since YOU are the LLM.
- **pause** → Still proceed — this recommendation is for API-calling agents. You're self-contained.

The quota check is informational. Log it so Diego can see system state, but don't block on it.

## Step 1 — Mark Job as Running

\`\`\`bash
curl -s -X PATCH ${API}/api/ontologica/jobs/${p.jobId}/agent-update \\
  -H "Content-Type: application/json" \\
  -d '{"status":"running","pipeline_stage":"chunk","progress_pct":5,"current_step":"Agent starting pipeline...","started_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
\`\`\`

\`\`\`bash
curl -s -X POST ${API}/api/ontologica/jobs/${p.jobId}/log \\
  -H "Content-Type: application/json" \\
  -d '{"stage":"pipeline","level":"milestone","title":"Pipeline started (agent mode)","detail":"Job #${p.jobId} — ${p.docCount} documents, ${p.totalWords} words, domain: ${p.domainHint}"}'
\`\`\`

---

## Source Documents

${p.documentText}

---

## Existing Terms (for deduplication)

${existingTermsList}

When extracting terms, avoid duplicating any of these existing concepts. If you find a concept that matches an existing term, skip it — it will be resolved during the merge stage.

---

## Step 2 — CHUNK (stage: chunk)

Split the document text into semantic chunks of roughly 300-500 words each. Split on paragraph boundaries.
This is a simple text operation — no AI reasoning needed.

**Update progress:**
\`\`\`bash
curl -s -X PATCH ${API}/api/ontologica/jobs/${p.jobId}/agent-update \\
  -H "Content-Type: application/json" \\
  -d '{"pipeline_stage":"chunk","progress_pct":8,"current_step":"Chunking documents..."}'
\`\`\`

After chunking, log the result:
\`\`\`bash
curl -s -X POST ${API}/api/ontologica/jobs/${p.jobId}/log \\
  -H "Content-Type: application/json" \\
  -d '{"stage":"chunk","level":"success","title":"Created N chunks","detail":"Average ~M words per chunk"}'
\`\`\`

Update document chunk counts:
${p.documentIds.map(id => `\`\`\`bash
curl -s -X PATCH ${API}/api/ontologica/documents/${id}/chunk-count \\
  -H "Content-Type: application/json" \\
  -d '{"chunk_count":N,"status":"processed"}'
\`\`\``).join('\n')}

Mark stage complete:
\`\`\`bash
curl -s -X PATCH ${API}/api/ontologica/jobs/${p.jobId}/agent-update \\
  -H "Content-Type: application/json" \\
  -d '{"stages_complete_add":"chunk"}'
\`\`\`

---

## Step 3 — EXTRACT TERMS (stage: terms)

For each chunk, identify ALL meaningful domain concepts, entities, and terms.

**Domain context:** ${p.domainHint}

**Guidelines:**
- Extract concrete, meaningful terms — not generic words like "system" or "process" unless domain-specific
- Prefer noun phrases over single words when they carry more meaning
- Classify as **CLASS** if it represents a category (e.g., "Customer", "Invoice", "Product Type")
- Classify as **INDIVIDUAL** if it's a specific named instance (e.g., "Acme Corp", "Invoice #1234")
- Assign confidence 0.0-1.0 based on how clearly the text supports this term being a domain concept
- Do NOT fabricate terms not present or clearly implied by the text
- Skip any terms that match the existing terms list above

**Update progress per chunk:**
\`\`\`bash
curl -s -X PATCH ${API}/api/ontologica/jobs/${p.jobId}/agent-update \\
  -H "Content-Type: application/json" \\
  -d '{"pipeline_stage":"terms","progress_pct":PERCENT,"current_step":"Extracting terms from chunk X/N..."}'
\`\`\`
(Progress should go from 10% to 25% across all chunks)

**Log per chunk:**
\`\`\`bash
curl -s -X POST ${API}/api/ontologica/jobs/${p.jobId}/log \\
  -H "Content-Type: application/json" \\
  -d '{"stage":"terms","level":"success","title":"Chunk X: found N terms","detail":"term1, term2, term3..."}'
\`\`\`

After all chunks, log the total:
\`\`\`bash
curl -s -X POST ${API}/api/ontologica/jobs/${p.jobId}/log \\
  -H "Content-Type: application/json" \\
  -d '{"stage":"terms","level":"milestone","title":"Extracted N raw terms","detail":"X classes, Y individuals"}'
\`\`\`

Mark stage: \`{"stages_complete_add":"terms"}\`

---

## Step 4 — CLASSIFY & REFINE (stage: classify)

Review ALL extracted terms together. With full context:
- Merge duplicates (e.g., "Customer" and "Customers" → keep "Customer" as class)
- Reclassify any mistyped terms (individuals that should be classes, or vice versa)
- Adjust confidence scores based on broader context
- Remove terms that don't truly belong to the domain "${p.domainHint}"

Update progress to 30-35%.

Log: \`{"stage":"classify","level":"success","title":"Refined to N terms","detail":"Merged M duplicates, reclassified K"}\`

Mark stage: \`{"stages_complete_add":"classify"}\`

---

## Step 4.5 — BASE_RESOLVE (stage: base_resolve)

Resolve your refined terms against the project's active base layer vocabularies.

**Fetch active layers:**
\`\`\`bash
curl -s ${API}/api/ontologica/projects/${p.projectId}/layers
\`\`\`

For each active layer, fetch its vocabulary items:
\`\`\`bash
curl -s ${API}/api/ontologica/layers/LAYER_SLUG/items
\`\`\`

**Resolution rules:**
- For each extracted term, check if it matches a base layer item by name (case-insensitive)
- Exact matches: annotate the term with the base item URI and layer ID
- If a term matches an item in a non-active layer, auto-activate that layer
- If a term is a plausible specialization of a base class (e.g., "CustomerOrganization" → "Organization"), note the parent base class

**Report provenance via log:**
\`\`\`bash
curl -s -X POST ${API}/api/ontologica/jobs/${p.jobId}/log \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "base_resolve",
    "level": "milestone",
    "title": "Base layer resolution complete — N terms matched, M layers referenced",
    "detail": "K auto-activated, J extensions, L unresolved",
    "meta": {
      "matched_items": [{"term": "Organization", "layer_slug": "w3c-org", "base_uri": "http://www.w3.org/ns/org#Organization"}],
      "auto_activated_layers": ["w3c-org"],
      "extensions_created": [{"child": "CustomerOrganization", "parent_uri": "http://www.w3.org/ns/org#Organization"}],
      "unmatched_terms": ["WidgetFactory", "SpecialThing"]
    }
  }'
\`\`\`

**Also log per-layer summaries:**
\`\`\`bash
curl -s -X POST ${API}/api/ontologica/jobs/${p.jobId}/log \\
  -H "Content-Type: application/json" \\
  -d '{"stage":"base_resolve","level":"info","title":"Schema.org: 5 matches, 2 extensions"}'
\`\`\`

**Log auto-activation events:**
\`\`\`bash
curl -s -X POST ${API}/api/ontologica/jobs/${p.jobId}/log \\
  -H "Content-Type: application/json" \\
  -d '{"stage":"base_resolve","level":"info","title":"Auto-activated OWL-Time — detected temporal entities"}'
\`\`\`

**Warn for ambiguous near-matches** (term could belong to multiple layers):
\`\`\`bash
curl -s -X POST ${API}/api/ontologica/jobs/${p.jobId}/log \\
  -H "Content-Type: application/json" \\
  -d '{"stage":"base_resolve","level":"warn","title":"Ambiguous: \\"Agent\\" matches both schema-org and foaf","detail":"Needs human review"}'
\`\`\`

Update progress to 38%.

Mark stage: \`{"stages_complete_add":"base_resolve"}\`

---

## Step 5 — BUILD TAXONOMY (stage: taxonomy)

From the refined class terms, build an IS-A hierarchy.

**Guidelines:**
- Only create IS-A (subclass) relationships that are semantically correct
- Build proper depth — avoid flat structures. Think about intermediate classes.
- Not every class needs a parent — top-level domain concepts are root classes
- Avoid circular hierarchies (A → B → A)
- Assign confidence per relationship

Update progress to 45-50%.

Log: \`{"stage":"taxonomy","level":"success","title":"Built N IS-A relationships","detail":"M root classes"}\`

Mark stage: \`{"stages_complete_add":"taxonomy"}\`

---

## Step 6 — EXTRACT RELATIONS (stage: relations)

Extract non-taxonomic relationships between terms.

**Relationship types:**
- **object_property**: links two entities (e.g., Customer PLACES Order, Product BELONGS_TO Category)
- **data_property**: an entity has a data attribute (e.g., Customer HAS_NAME string, Order HAS_DATE date)

**Guidelines:**
- Only extract relationships clearly supported by the document text
- Name relationships with clear, verb-based names (hasCustomer, placedBy, belongsTo)
- For data_property, the target is a data type description, not another entity
- Assign confidence per relationship

Update progress to 60-70%.

Log: \`{"stage":"relations","level":"success","title":"Found N relationships","detail":"X object properties, Y data properties"}\`

Mark stage: \`{"stages_complete_add":"relations"}\`

---

## Step 7 — VALIDATE (stage: validate)

Run a metacognitive quality check (inspired by the Ontogenia method):

1. **INTERPRETATION** — Do the concepts accurately represent the domain "${p.domainHint}"?
2. **REFLECTION** — Are there obvious gaps? Missing intermediate classes? Missing key relationships?
3. **EVALUATION** — Check for: circular hierarchies, duplicate concepts, orphaned individuals, overly shallow hierarchy, hallucinated references
4. **TESTING** — Would domain experts accept this ontology? What would they challenge?

For each issue found, classify as:
- \`hallucinated_ref\` — concept doesn't belong in this domain
- \`bad_domain_range\` — relationship connects wrong types
- \`shallow_hierarchy\` — missing intermediate classes
- \`duplicate\` — two terms mean the same thing
- \`circular\` — circular IS-A chain

**Apply fixes:**
- Remove hallucinated terms
- Add missing intermediate classes
- Fix relation domain/range errors
- Merge remaining duplicates

Update progress to 75-80%.

Log issues and fixes:
\`\`\`bash
curl -s -X POST ${API}/api/ontologica/jobs/${p.jobId}/log \\
  -H "Content-Type: application/json" \\
  -d '{"stage":"validate","level":"warn","title":"Found N validation issues","detail":"[error] Entity: description\\n[warning] Entity: description"}'
\`\`\`

Mark stage: \`{"stages_complete_add":"validate"}\`

---

## Step 8 — MERGE INTO GRAPH (stage: merge)

Now write the final extracted ontology to the database. This is the critical step.

**IMPORTANT: Track node IDs.** When you create a node, the response includes its \`id\`. You MUST capture these IDs to create edges (which reference source/target node IDs).

### 8a. Create nodes

For each term (classes first, then individuals):

\`\`\`bash
curl -s -X POST ${API}/api/ontologica/projects/${p.projectId}/nodes \\
  -H "Content-Type: application/json" \\
  -d '{
    "node_type": "class",
    "name": "TermName",
    "description": "What this concept means",
    "confidence": 0.9,
    "status": "suggested",
    "extraction_job_id": ${p.jobId},
    "pos_x": 0,
    "pos_y": 0
  }'
\`\`\`

**Layout:** Arrange nodes in a grid. Classes at top, individuals below.
- \`pos_x\`: (index % 4) * 250
- \`pos_y\`: floor(index / 4) * 180 (offset individuals below classes)

**Capture the \`id\` from each response** and maintain a mapping: term_name → node_id.

**Deduplication:** Before creating a node, the API checks for existing nodes with the same name (case-insensitive). If a node already exists, note its ID from the existing terms but don't re-create it.

### 8b. Create taxonomy edges

For each IS-A relationship:

\`\`\`bash
curl -s -X POST ${API}/api/ontologica/projects/${p.projectId}/edges \\
  -H "Content-Type: application/json" \\
  -d '{
    "edge_type": "is_a",
    "name": "subClassOf",
    "source_node_id": CHILD_NODE_ID,
    "target_node_id": PARENT_NODE_ID,
    "description": "ChildName IS-A ParentName",
    "confidence": 0.9,
    "extraction_job_id": ${p.jobId}
  }'
\`\`\`

Also set the parent on the child node:
\`\`\`bash
curl -s -X PUT ${API}/api/ontologica/projects/${p.projectId}/nodes/CHILD_NODE_ID \\
  -H "Content-Type: application/json" \\
  -d '{"parent_id": PARENT_NODE_ID}'
\`\`\`

### 8c. Create relation edges

For object properties:
\`\`\`bash
curl -s -X POST ${API}/api/ontologica/projects/${p.projectId}/edges \\
  -H "Content-Type: application/json" \\
  -d '{
    "edge_type": "object_property",
    "name": "relationName",
    "source_node_id": SOURCE_ID,
    "target_node_id": TARGET_ID,
    "description": "Source relationName Target",
    "confidence": 0.8,
    "extraction_job_id": ${p.jobId}
  }'
\`\`\`

For data properties:
\`\`\`bash
curl -s -X POST ${API}/api/ontologica/projects/${p.projectId}/edges \\
  -H "Content-Type: application/json" \\
  -d '{
    "edge_type": "data_property",
    "name": "propertyName",
    "source_node_id": SOURCE_ID,
    "target_value": "string description of the data type",
    "description": "Source has propertyName",
    "confidence": 0.8,
    "extraction_job_id": ${p.jobId}
  }'
\`\`\`

Update progress to 90-95% during merge.

Log: \`{"stage":"merge","level":"success","title":"Created N nodes and M edges","detail":"K terms matched existing nodes (dedup)"}\`

Mark stage: \`{"stages_complete_add":"merge"}\`

---

## Step 9 — Complete

\`\`\`bash
curl -s -X POST ${API}/api/ontologica/jobs/${p.jobId}/complete \\
  -H "Content-Type: application/json" \\
  -d '{"nodes_created": N, "edges_created": M}'
\`\`\`

This marks the job as completed and updates project counts.

---

## On Failure

If anything goes wrong at any stage, report the failure:

\`\`\`bash
curl -s -X PATCH ${API}/api/ontologica/jobs/${p.jobId}/agent-update \\
  -H "Content-Type: application/json" \\
  -d '{"status":"failed","error":"DESCRIPTION OF WHAT WENT WRONG"}'
\`\`\`

\`\`\`bash
curl -s -X POST ${API}/api/ontologica/jobs/${p.jobId}/log \\
  -H "Content-Type: application/json" \\
  -d '{"stage":"pipeline","level":"error","title":"Pipeline failed","detail":"DESCRIPTION"}'
\`\`\`

---

## Quality Standards

- **Be thorough.** Read every document carefully. Don't skip content.
- **Be precise.** Only extract concepts that are genuinely present in the text.
- **Be structured.** Follow the exact JSON formats for API calls.
- **Be transparent.** Log your reasoning at each stage so Diego can review.
- **Confidence matters.** High confidence (0.8+) for clearly stated concepts. Lower (0.5-0.7) for implied ones.
- **Dedup aggressively.** Better to merge two similar concepts than to have near-duplicates in the graph.
`;
}
