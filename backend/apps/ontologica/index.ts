import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { chat as aiChat, queryOntology } from './chat.js';
import { deduplicateExistingNodes } from './extract.js';

export function createRouter(db: Database.Database): Router {
  const r = Router();

  // ── Migration: add sort_order to onto_documents if missing ──────────────────
  try {
    db.prepare("SELECT sort_order FROM onto_documents LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE onto_documents ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }

  // ── Zombie job cleanup on startup ───────────────────────────────────────────
  // Jobs in 'running' status at startup may be stale (from before backend restart).
  // Agent-dispatched jobs run externally so they're fine — only mark truly dead ones.
  // Jobs queued but never dispatched get marked as failed so user can retry.
  const zombies = db.prepare(
    `UPDATE onto_extraction_jobs SET status = 'failed', error = 'Backend restarted — retry to re-dispatch to agent.', completed_at = datetime('now') WHERE status = 'running' AND current_step NOT LIKE '%Agent%'`
  ).run();
  if (zombies.changes > 0) {
    console.log(`[ontologica] Cleaned up ${zombies.changes} zombie extraction job(s)`);
  }

  // ── Projects CRUD ──────────────────────────────────────────────────────────

  r.get('/api/ontologica/projects', (_req: Request, res: Response) => {
    const rows = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM onto_documents WHERE project_id = p.id) AS doc_count,
        (SELECT COUNT(*) FROM onto_nodes WHERE project_id = p.id) AS node_count,
        (SELECT COUNT(*) FROM onto_edges WHERE project_id = p.id) AS edge_count
      FROM onto_projects p ORDER BY p.updated_at DESC
    `).all();
    res.json(rows);
  });

  r.post('/api/ontologica/projects', (req: Request, res: Response) => {
    const { name, description, domain_hint, base_uri } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = db.prepare(
      `INSERT INTO onto_projects (name, description, domain_hint, base_uri) VALUES (?, ?, ?, ?)`
    ).run(name, description || null, domain_hint || null, base_uri || 'http://ontologica.local/');
    const project = db.prepare('SELECT * FROM onto_projects WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(project);
  });

  r.get('/api/ontologica/projects/:id', (req: Request, res: Response) => {
    const project = db.prepare('SELECT * FROM onto_projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json(project);
  });

  r.put('/api/ontologica/projects/:id', (req: Request, res: Response) => {
    const { name, description, domain_hint, base_uri, status } = req.body;
    db.prepare(`
      UPDATE onto_projects SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        domain_hint = COALESCE(?, domain_hint),
        base_uri = COALESCE(?, base_uri),
        status = COALESCE(?, status),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(name, description, domain_hint, base_uri, status, req.params.id);
    const project = db.prepare('SELECT * FROM onto_projects WHERE id = ?').get(req.params.id);
    res.json(project);
  });

  r.delete('/api/ontologica/projects/:id', (req: Request, res: Response) => {
    db.prepare('DELETE FROM onto_projects WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── Documents ──────────────────────────────────────────────────────────────

  r.get('/api/ontologica/projects/:projectId/documents', (req: Request, res: Response) => {
    const docs = db.prepare(
      'SELECT id, project_id, filename, mime_type, status, chunk_count, word_count, sort_order, created_at FROM onto_documents WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC'
    ).all(req.params.projectId);
    res.json(docs);
  });

  r.post('/api/ontologica/projects/:projectId/documents', (req: Request, res: Response) => {
    const { filename, content_text, mime_type } = req.body;
    if (!filename || !content_text) return res.status(400).json({ error: 'filename and content_text required' });
    const wordCount = content_text.split(/\s+/).filter(Boolean).length;
    const result = db.prepare(
      `INSERT INTO onto_documents (project_id, filename, content_text, mime_type, word_count, status) VALUES (?, ?, ?, ?, ?, 'uploaded')`
    ).run(req.params.projectId, filename, content_text, mime_type || 'text/plain', wordCount);
    const doc = db.prepare('SELECT * FROM onto_documents WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(doc);
  });

  r.get('/api/ontologica/documents/:id', (req: Request, res: Response) => {
    const doc = db.prepare('SELECT * FROM onto_documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  });

  r.delete('/api/ontologica/documents/:id', (req: Request, res: Response) => {
    db.prepare('DELETE FROM onto_documents WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Reorder documents
  r.put('/api/ontologica/projects/:projectId/documents/reorder', (req: Request, res: Response) => {
    const { order } = req.body; // array of doc IDs in desired order
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
    const stmt = db.prepare('UPDATE onto_documents SET sort_order = ? WHERE id = ? AND project_id = ?');
    const tx = db.transaction(() => {
      order.forEach((id: number, idx: number) => stmt.run(idx, id, req.params.projectId));
    });
    tx();
    res.json({ ok: true });
  });

  // ── Nodes (Classes + Individuals) ──────────────────────────────────────────

  r.get('/api/ontologica/projects/:projectId/nodes', (req: Request, res: Response) => {
    const { type, status } = req.query;
    let sql = 'SELECT * FROM onto_nodes WHERE project_id = ?';
    const params: unknown[] = [req.params.projectId];
    if (type) { sql += ' AND node_type = ?'; params.push(type); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at ASC';
    res.json(db.prepare(sql).all(...params));
  });

  r.post('/api/ontologica/projects/:projectId/nodes', (req: Request, res: Response) => {
    const { node_type, name, description, uri, parent_id, confidence, status, source_document_id, extraction_job_id, pos_x, pos_y, metadata } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = db.prepare(`
      INSERT INTO onto_nodes (project_id, node_type, name, description, uri, parent_id, confidence, status, source_document_id, extraction_job_id, pos_x, pos_y, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.projectId,
      node_type || 'class', name, description || null, uri || null,
      parent_id || null, confidence ?? 0.0, status || 'suggested',
      source_document_id || null, extraction_job_id || null,
      pos_x ?? 0, pos_y ?? 0,
      JSON.stringify(metadata || {})
    );
    res.status(201).json(db.prepare('SELECT * FROM onto_nodes WHERE id = ?').get(result.lastInsertRowid));
  });

  r.put('/api/ontologica/projects/:projectId/nodes/:nodeId', (req: Request, res: Response) => {
    const { name, description, node_type, uri, parent_id, confidence, status, pos_x, pos_y, metadata } = req.body;
    db.prepare(`
      UPDATE onto_nodes SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        node_type = COALESCE(?, node_type),
        uri = COALESCE(?, uri),
        parent_id = ?,
        confidence = COALESCE(?, confidence),
        status = COALESCE(?, status),
        pos_x = COALESCE(?, pos_x),
        pos_y = COALESCE(?, pos_y),
        metadata = COALESCE(?, metadata)
      WHERE id = ? AND project_id = ?
    `).run(
      name, description, node_type, uri,
      parent_id !== undefined ? parent_id : null,
      confidence, status, pos_x, pos_y,
      metadata ? JSON.stringify(metadata) : null,
      req.params.nodeId, req.params.projectId
    );
    res.json(db.prepare('SELECT * FROM onto_nodes WHERE id = ?').get(req.params.nodeId));
  });

  r.delete('/api/ontologica/projects/:projectId/nodes/:nodeId', (req: Request, res: Response) => {
    db.prepare('DELETE FROM onto_nodes WHERE id = ? AND project_id = ?').run(req.params.nodeId, req.params.projectId);
    res.json({ ok: true });
  });

  // ── Edges (Relationships) ─────────────────────────────────────────────────

  r.get('/api/ontologica/projects/:projectId/edges', (req: Request, res: Response) => {
    const { type, status } = req.query;
    let sql = 'SELECT * FROM onto_edges WHERE project_id = ?';
    const params: unknown[] = [req.params.projectId];
    if (type) { sql += ' AND edge_type = ?'; params.push(type); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at ASC';
    res.json(db.prepare(sql).all(...params));
  });

  r.post('/api/ontologica/projects/:projectId/edges', (req: Request, res: Response) => {
    const { edge_type, name, source_node_id, target_node_id, target_value, description, confidence, status, source_document_id, extraction_job_id, metadata } = req.body;
    if (!source_node_id) return res.status(400).json({ error: 'source_node_id required' });
    const result = db.prepare(`
      INSERT INTO onto_edges (project_id, edge_type, name, source_node_id, target_node_id, target_value, description, confidence, status, source_document_id, extraction_job_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.projectId,
      edge_type || 'is_a', name || null, source_node_id,
      target_node_id || null, target_value || null,
      description || null, confidence ?? 0.0, status || 'suggested',
      source_document_id || null, extraction_job_id || null,
      JSON.stringify(metadata || {})
    );
    res.status(201).json(db.prepare('SELECT * FROM onto_edges WHERE id = ?').get(result.lastInsertRowid));
  });

  r.put('/api/ontologica/projects/:projectId/edges/:edgeId', (req: Request, res: Response) => {
    const { edge_type, name, source_node_id, target_node_id, target_value, description, confidence, status, metadata } = req.body;
    db.prepare(`
      UPDATE onto_edges SET
        edge_type = COALESCE(?, edge_type),
        name = COALESCE(?, name),
        source_node_id = COALESCE(?, source_node_id),
        target_node_id = ?,
        target_value = COALESCE(?, target_value),
        description = COALESCE(?, description),
        confidence = COALESCE(?, confidence),
        status = COALESCE(?, status),
        metadata = COALESCE(?, metadata)
      WHERE id = ? AND project_id = ?
    `).run(
      edge_type, name, source_node_id,
      target_node_id !== undefined ? target_node_id : null,
      target_value, description, confidence, status,
      metadata ? JSON.stringify(metadata) : null,
      req.params.edgeId, req.params.projectId
    );
    res.json(db.prepare('SELECT * FROM onto_edges WHERE id = ?').get(req.params.edgeId));
  });

  r.delete('/api/ontologica/projects/:projectId/edges/:edgeId', (req: Request, res: Response) => {
    db.prepare('DELETE FROM onto_edges WHERE id = ? AND project_id = ?').run(req.params.edgeId, req.params.projectId);
    res.json({ ok: true });
  });

  // ── Bulk review (approve/reject multiple items) ────────────────────────────

  r.post('/api/ontologica/projects/:projectId/review', (req: Request, res: Response) => {
    const { node_ids, edge_ids, action } = req.body;
    if (!action || !['approved', 'rejected'].includes(action)) {
      return res.status(400).json({ error: 'action must be approved or rejected' });
    }
    const updateNodes = db.prepare('UPDATE onto_nodes SET status = ? WHERE id = ? AND project_id = ?');
    const updateEdges = db.prepare('UPDATE onto_edges SET status = ? WHERE id = ? AND project_id = ?');
    const tx = db.transaction(() => {
      for (const id of (node_ids || [])) updateNodes.run(action, id, req.params.projectId);
      for (const id of (edge_ids || [])) updateEdges.run(action, id, req.params.projectId);
    });
    tx();
    res.json({ ok: true, reviewed: (node_ids?.length || 0) + (edge_ids?.length || 0) });
  });

  // ── Extraction — CRON Agent Dispatch ────────────────────────────────────────
  // Instead of running the pipeline in-process (which blocks the event loop and
  // dies on rate limits), we generate a task file + oneShot CRON. A Claude agent
  // picks it up, performs the extraction itself, and writes results back via API.

  async function dispatchJob(jobId: number) {
    try {
      const mod = await import('./generate-task.js');
      mod.generateExtractionTask(db, jobId);
    } catch (err: any) {
      console.error(`[ontologica] Failed to dispatch job #${jobId}:`, err);
      db.prepare(`UPDATE onto_extraction_jobs SET status = 'failed', error = ? WHERE id = ?`)
        .run(`Dispatch failed: ${err.message}`, jobId);
    }
  }

  // ── Agent-facing API routes ───────────────────────────────────────────────

  /**
   * PATCH /api/ontologica/jobs/:jobId/agent-update
   * Agent writes progress updates: status, stage, progress, current_step, etc.
   */
  r.patch('/api/ontologica/jobs/:jobId/agent-update', (req: Request, res: Response) => {
    const job = db.prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?').get(req.params.jobId) as any;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { status, pipeline_stage, progress_pct, current_step, error, started_at, stages_complete_add } = req.body;

    const updates: string[] = [];
    const values: any[] = [];

    if (status) { updates.push('status = ?'); values.push(status); }
    if (pipeline_stage) { updates.push('pipeline_stage = ?'); values.push(pipeline_stage); }
    if (progress_pct != null) { updates.push('progress_pct = ?'); values.push(progress_pct); }
    if (current_step) { updates.push('current_step = ?'); values.push(current_step); }
    if (error) { updates.push('error = ?'); values.push(error); }
    if (started_at) { updates.push('started_at = ?'); values.push(started_at); }
    if (status === 'failed') { updates.push("completed_at = datetime('now')"); }

    // Append a stage to stages_complete without requiring the agent to track the full list
    if (stages_complete_add) {
      const current = JSON.parse(job.stages_complete || '[]');
      if (!current.includes(stages_complete_add)) {
        current.push(stages_complete_add);
        updates.push('stages_complete = ?');
        values.push(JSON.stringify(current));
      }
    }

    if (updates.length > 0) {
      values.push(req.params.jobId);
      db.prepare(`UPDATE onto_extraction_jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    res.json({ ok: true });
  });

  /**
   * POST /api/ontologica/jobs/:jobId/log
   * Agent writes timeline entries for the pipeline UI.
   */
  r.post('/api/ontologica/jobs/:jobId/log', (req: Request, res: Response) => {
    const job = db.prepare('SELECT id FROM onto_extraction_jobs WHERE id = ?').get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { stage, level, title, detail, meta } = req.body;
    if (!stage || !title) return res.status(400).json({ error: 'stage and title required' });

    db.prepare(
      `INSERT INTO onto_pipeline_logs (job_id, stage, level, title, detail, meta) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.params.jobId, stage, level || 'info', title, detail || null, meta ? JSON.stringify(meta) : null);

    res.json({ ok: true });
  });

  /**
   * POST /api/ontologica/jobs/:jobId/complete
   * Agent finalizes the job — sets status to completed, updates project counts.
   */
  r.post('/api/ontologica/jobs/:jobId/complete', (req: Request, res: Response) => {
    const job = db.prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?').get(req.params.jobId) as any;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { nodes_created, edges_created } = req.body;

    db.prepare(`
      UPDATE onto_extraction_jobs SET
        status = 'completed', pipeline_stage = 'done', progress_pct = 100,
        current_step = ?,
        nodes_created = ?, edges_created = ?,
        completed_at = datetime('now')
      WHERE id = ?
    `).run(
      `Extracted ${nodes_created || 0} concepts and ${edges_created || 0} relationships`,
      nodes_created || 0, edges_created || 0, req.params.jobId
    );

    // Insert completion log
    db.prepare(
      `INSERT INTO onto_pipeline_logs (job_id, stage, level, title, detail) VALUES (?, 'pipeline', 'milestone', 'Pipeline complete!', ?)`
    ).run(req.params.jobId, `${nodes_created || 0} concepts, ${edges_created || 0} relationships`);

    // Update project counts
    const nc = (db.prepare('SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ?').get(job.project_id) as any).c;
    const ec = (db.prepare('SELECT COUNT(*) as c FROM onto_edges WHERE project_id = ?').get(job.project_id) as any).c;
    db.prepare("UPDATE onto_projects SET node_count = ?, edge_count = ?, updated_at = datetime('now') WHERE id = ?")
      .run(nc, ec, job.project_id);

    res.json({ ok: true, nodes_created, edges_created });
  });

  /**
   * PATCH /api/ontologica/documents/:id/chunk-count
   * Agent updates document chunk count after chunking stage.
   */
  r.patch('/api/ontologica/documents/:id/chunk-count', (req: Request, res: Response) => {
    const { chunk_count, status } = req.body;
    db.prepare('UPDATE onto_documents SET chunk_count = ?, status = COALESCE(?, status) WHERE id = ?')
      .run(chunk_count ?? 0, status || null, req.params.id);
    res.json({ ok: true });
  });

  // ── Extraction Jobs ────────────────────────────────────────────────────────

  r.get('/api/ontologica/projects/:projectId/jobs', (req: Request, res: Response) => {
    const jobs = db.prepare(
      'SELECT * FROM onto_extraction_jobs WHERE project_id = ? ORDER BY created_at DESC'
    ).all(req.params.projectId);
    res.json(jobs);
  });

  r.post('/api/ontologica/projects/:projectId/extract', (req: Request, res: Response) => {
    const { document_id, config } = req.body;
    const result = db.prepare(`
      INSERT INTO onto_extraction_jobs (project_id, document_id, pipeline_stage, status, config)
      VALUES (?, ?, 'pending', 'queued', ?)
    `).run(req.params.projectId, document_id || null, JSON.stringify(config || {}));

    const jobId = Number(result.lastInsertRowid);
    dispatchJob(jobId);

    res.status(201).json(db.prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?').get(jobId));
  });

  r.get('/api/ontologica/jobs/:jobId', (req: Request, res: Response) => {
    const job = db.prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?').get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(job);
  });

  // Retry a stuck/failed job
  r.post('/api/ontologica/jobs/:jobId/retry', (req: Request, res: Response) => {
    const job = db.prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?').get(req.params.jobId) as any;
    if (!job) return res.status(404).json({ error: 'Not found' });

    // Reset job state
    db.prepare(`UPDATE onto_extraction_jobs SET status = 'queued', pipeline_stage = 'pending', progress_pct = 0, current_step = NULL, stages_complete = '[]', nodes_created = 0, edges_created = 0, error = NULL, started_at = NULL, completed_at = NULL WHERE id = ?`)
      .run(job.id);

    // Clear old logs for this job
    db.prepare('DELETE FROM onto_pipeline_logs WHERE job_id = ?').run(job.id);

    // Clear any nodes/edges from previous partial run
    db.prepare('DELETE FROM onto_edges WHERE extraction_job_id = ?').run(job.id);
    db.prepare('DELETE FROM onto_nodes WHERE extraction_job_id = ?').run(job.id);

    dispatchJob(job.id);
    res.json({ message: 'Job dispatched to agent', jobId: job.id });
  });

  // Delete a single job (and its logs, nodes, edges)
  r.delete('/api/ontologica/jobs/:jobId', (req: Request, res: Response) => {
    const job = db.prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?').get(req.params.jobId) as any;
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (job.status === 'running' || job.status === 'queued') {
      return res.status(409).json({ error: 'Cannot delete a running or queued job' });
    }
    db.prepare('DELETE FROM onto_pipeline_logs WHERE job_id = ?').run(job.id);
    db.prepare('DELETE FROM onto_edges WHERE extraction_job_id = ?').run(job.id);
    db.prepare('DELETE FROM onto_nodes WHERE extraction_job_id = ?').run(job.id);
    db.prepare('DELETE FROM onto_extraction_jobs WHERE id = ?').run(job.id);
    res.json({ ok: true });
  });

  // Clear all failed jobs for a project
  r.delete('/api/ontologica/projects/:projectId/jobs/failed', (req: Request, res: Response) => {
    const pid = req.params.projectId;
    const failedJobs = db.prepare(
      "SELECT id FROM onto_extraction_jobs WHERE project_id = ? AND status = 'failed'"
    ).all(pid) as any[];
    for (const j of failedJobs) {
      db.prepare('DELETE FROM onto_pipeline_logs WHERE job_id = ?').run(j.id);
      db.prepare('DELETE FROM onto_edges WHERE extraction_job_id = ?').run(j.id);
      db.prepare('DELETE FROM onto_nodes WHERE extraction_job_id = ?').run(j.id);
    }
    const result = db.prepare(
      "DELETE FROM onto_extraction_jobs WHERE project_id = ? AND status = 'failed'"
    ).run(pid);
    res.json({ ok: true, deleted: result.changes });
  });

  // ── Pipeline Logs ──────────────────────────────────────────────────────────

  r.get('/api/ontologica/jobs/:jobId/logs', (req: Request, res: Response) => {
    const logs = db.prepare(
      'SELECT * FROM onto_pipeline_logs WHERE job_id = ? ORDER BY id ASC'
    ).all(req.params.jobId);
    res.json(logs);
  });

  // ── Stats ──────────────────────────────────────────────────────────────────

  r.get('/api/ontologica/projects/:projectId/stats', (req: Request, res: Response) => {
    const pid = req.params.projectId;
    const nodesByType = db.prepare(
      `SELECT node_type, status, COUNT(*) as count FROM onto_nodes WHERE project_id = ? GROUP BY node_type, status`
    ).all(pid);
    const edgesByType = db.prepare(
      `SELECT edge_type, status, COUNT(*) as count FROM onto_edges WHERE project_id = ? GROUP BY edge_type, status`
    ).all(pid);
    const docCount = (db.prepare('SELECT COUNT(*) as c FROM onto_documents WHERE project_id = ?').get(pid) as any).c;
    const jobCount = (db.prepare('SELECT COUNT(*) as c FROM onto_extraction_jobs WHERE project_id = ?').get(pid) as any).c;
    const pendingReview = {
      nodes: (db.prepare(`SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ? AND status = 'suggested'`).get(pid) as any).c,
      edges: (db.prepare(`SELECT COUNT(*) as c FROM onto_edges WHERE project_id = ? AND status = 'suggested'`).get(pid) as any).c,
    };
    res.json({ nodesByType, edgesByType, docCount, jobCount, pendingReview });
  });

  // ── AI Chat ────────────────────────────────────────────────────────────────

  r.get('/api/ontologica/projects/:projectId/conversations', (req: Request, res: Response) => {
    const conversations = db.prepare(
      'SELECT * FROM onto_conversations WHERE project_id = ? ORDER BY created_at ASC'
    ).all(req.params.projectId);
    res.json(conversations);
  });

  r.post('/api/ontologica/projects/:projectId/chat', async (req: Request, res: Response) => {
    try {
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ error: 'message required' });

      const result = await aiChat(db, Number(req.params.projectId), message.trim());
      res.json(result);
    } catch (err: any) {
      console.error('[ontologica] chat error:', err);
      res.status(500).json({ error: err.message || 'Chat failed' });
    }
  });

  r.post('/api/ontologica/projects/:projectId/query', async (req: Request, res: Response) => {
    try {
      const { question } = req.body;
      if (!question?.trim()) return res.status(400).json({ error: 'question required' });

      const result = await queryOntology(db, Number(req.params.projectId), question.trim());
      res.json(result);
    } catch (err: any) {
      console.error('[ontologica] query error:', err);
      res.status(500).json({ error: err.message || 'Query failed' });
    }
  });

  r.delete('/api/ontologica/projects/:projectId/conversations', (req: Request, res: Response) => {
    db.prepare('DELETE FROM onto_conversations WHERE project_id = ?').run(req.params.projectId);
    res.json({ ok: true });
  });

  // ── Export (OWL/Turtle) ────────────────────────────────────────────────────

  r.get('/api/ontologica/projects/:projectId/export', (req: Request, res: Response) => {
    const pid = req.params.projectId;
    const project = db.prepare('SELECT * FROM onto_projects WHERE id = ?').get(pid) as any;
    if (!project) return res.status(404).json({ error: 'Not found' });

    const nodes = db.prepare(
      `SELECT * FROM onto_nodes WHERE project_id = ? AND status = 'approved' ORDER BY id`
    ).all(pid) as any[];
    const edges = db.prepare(
      `SELECT * FROM onto_edges WHERE project_id = ? AND status = 'approved' ORDER BY id`
    ).all(pid) as any[];

    const format = req.query.format || 'turtle';
    if (format === 'json') {
      return res.json({ project, nodes, edges });
    }

    // Generate Turtle/OWL
    const baseUri = project.base_uri || 'http://ontologica.local/';
    const lines: string[] = [
      `@prefix : <${baseUri}> .`,
      `@prefix owl: <http://www.w3.org/2002/07/owl#> .`,
      `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`,
      `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`,
      `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`,
      ``,
      `<${baseUri}> rdf:type owl:Ontology ;`,
      `    rdfs:label "${project.name}" .`,
      ``,
    ];

    const toUri = (name: string) => ':' + name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Declare classes
    for (const n of nodes.filter(n => n.node_type === 'class')) {
      lines.push(`${toUri(n.name)} rdf:type owl:Class ;`);
      lines.push(`    rdfs:label "${n.name}" .`);
      if (n.description) {
        lines[lines.length - 1] = lines[lines.length - 1].replace(' .', ` ;\n    rdfs:comment "${n.description.replace(/"/g, '\\"')}" .`);
      }
      if (n.parent_id && nodeMap.has(n.parent_id)) {
        const parent = nodeMap.get(n.parent_id)!;
        lines[lines.length - 1] = lines[lines.length - 1].replace(' .', ` ;\n    rdfs:subClassOf ${toUri(parent.name)} .`);
      }
      lines.push('');
    }

    // Declare individuals
    for (const n of nodes.filter(n => n.node_type === 'individual')) {
      const classNode = n.parent_id ? nodeMap.get(n.parent_id) : null;
      if (classNode) {
        lines.push(`${toUri(n.name)} rdf:type ${toUri(classNode.name)} ;`);
      } else {
        lines.push(`${toUri(n.name)} rdf:type owl:NamedIndividual ;`);
      }
      lines.push(`    rdfs:label "${n.name}" .`);
      lines.push('');
    }

    // Declare properties and relationships
    for (const e of edges) {
      if (e.edge_type === 'object_property' && e.name) {
        const src = nodeMap.get(e.source_node_id);
        const tgt = nodeMap.get(e.target_node_id);
        if (src && tgt) {
          lines.push(`${toUri(e.name)} rdf:type owl:ObjectProperty ;`);
          lines.push(`    rdfs:label "${e.name}" ;`);
          lines.push(`    rdfs:domain ${toUri(src.name)} ;`);
          lines.push(`    rdfs:range ${toUri(tgt.name)} .`);
          lines.push('');
        }
      } else if (e.edge_type === 'data_property' && e.name) {
        const src = nodeMap.get(e.source_node_id);
        if (src) {
          lines.push(`${toUri(e.name)} rdf:type owl:DatatypeProperty ;`);
          lines.push(`    rdfs:label "${e.name}" ;`);
          lines.push(`    rdfs:domain ${toUri(src.name)} ;`);
          lines.push(`    rdfs:range xsd:string .`);
          lines.push('');
        }
      }
    }

    const turtle = lines.join('\n');
    res.setHeader('Content-Type', 'text/turtle');
    res.setHeader('Content-Disposition', `attachment; filename="${project.name.replace(/\s/g, '_')}.ttl"`);
    res.send(turtle);
  });

  // ── Manual Deduplication ────────────────────────────────────────────────────

  r.post('/api/ontologica/projects/:projectId/deduplicate', (req: Request, res: Response) => {
    const pid = Number(req.params.projectId);
    const project = db.prepare('SELECT * FROM onto_projects WHERE id = ?').get(pid);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const nodesBefore = (db.prepare('SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ?').get(pid) as any).c;
    const nodesMerged = deduplicateExistingNodes(db, pid);
    const nodesAfter = (db.prepare('SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ?').get(pid) as any).c;
    const edgesAfter = (db.prepare('SELECT COUNT(*) as c FROM onto_edges WHERE project_id = ?').get(pid) as any).c;

    // Update project counts
    db.prepare('UPDATE onto_projects SET node_count = ?, edge_count = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(nodesAfter, edgesAfter, pid);

    res.json({ nodesBefore, nodesAfter, nodesMerged, edgesAfter });
  });

  return r;
}
