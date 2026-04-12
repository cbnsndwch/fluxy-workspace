/**
 * Pipeline Proposals — Unified CRUD
 *
 * Every pipeline type produces proposals. The difference is just the approval flow:
 * - automated: proposals → immediately applied (decided_by = 'system')
 * - supervised: proposals → shown in UI → human approves/rejects
 * - external: proposals → packaged for external review → responses parsed → applied
 */

import type Database from 'better-sqlite3';
import type { Router, Request, Response } from 'express';

export function registerProposalRoutes(r: Router, db: Database.Database) {
    // ── List proposals for a job ────────────────────────────────────────────────
    r.get(
        '/api/ontologica/jobs/:jobId/proposals',
        (req: Request, res: Response) => {
            const { status, type } = req.query;
            let sql = 'SELECT * FROM onto_pipeline_proposals WHERE job_id = ?';
            const params: any[] = [req.params.jobId];

            if (status) {
                sql += ' AND status = ?';
                params.push(status);
            }
            if (type) {
                sql += ' AND proposal_type = ?';
                params.push(type);
            }
            sql += ' ORDER BY id ASC';

            res.json(db.prepare(sql).all(...params));
        }
    );

    // ── List proposals for a project (across all jobs) ──────────────────────────
    r.get(
        '/api/ontologica/projects/:projectId/proposals',
        (req: Request, res: Response) => {
            const { status, type, job_type } = req.query;
            let sql =
                'SELECT p.*, j.type as job_type FROM onto_pipeline_proposals p JOIN onto_extraction_jobs j ON j.id = p.job_id WHERE p.project_id = ?';
            const params: any[] = [req.params.projectId];

            if (status) {
                sql += ' AND p.status = ?';
                params.push(status);
            }
            if (type) {
                sql += ' AND p.proposal_type = ?';
                params.push(type);
            }
            if (job_type) {
                sql += ' AND j.type = ?';
                params.push(job_type);
            }
            sql += ' ORDER BY p.id DESC';

            res.json(db.prepare(sql).all(...params));
        }
    );

    // ── Get single proposal ─────────────────────────────────────────────────────
    r.get('/api/ontologica/proposals/:id', (req: Request, res: Response) => {
        const proposal = db
            .prepare('SELECT * FROM onto_pipeline_proposals WHERE id = ?')
            .get(req.params.id);
        if (!proposal)
            return res.status(404).json({ error: 'Proposal not found' });
        res.json(proposal);
    });

    // ── Decide on a single proposal ─────────────────────────────────────────────
    r.patch(
        '/api/ontologica/proposals/:id/decide',
        (req: Request, res: Response) => {
            const { status, decided_by } = req.body;
            if (
                !status ||
                !['approved', 'rejected', 'skipped'].includes(status)
            ) {
                return res.status(400).json({
                    error: 'status must be approved, rejected, or skipped'
                });
            }

            const proposal = db
                .prepare('SELECT * FROM onto_pipeline_proposals WHERE id = ?')
                .get(req.params.id) as any;
            if (!proposal)
                return res.status(404).json({ error: 'Proposal not found' });

            db.prepare(`
      UPDATE onto_pipeline_proposals
      SET status = ?, decided_by = ?, decided_at = datetime('now')
      WHERE id = ?
    `).run(status, decided_by || 'human', req.params.id);

            res.json({ ok: true });
        }
    );

    // ── Bulk decide on proposals ────────────────────────────────────────────────
    r.post(
        '/api/ontologica/proposals/bulk-decide',
        (req: Request, res: Response) => {
            const { proposal_ids, status, decided_by } = req.body;
            if (!Array.isArray(proposal_ids) || proposal_ids.length === 0) {
                return res
                    .status(400)
                    .json({ error: 'proposal_ids array required' });
            }
            if (
                !status ||
                !['approved', 'rejected', 'skipped'].includes(status)
            ) {
                return res.status(400).json({
                    error: 'status must be approved, rejected, or skipped'
                });
            }

            const stmt = db.prepare(`
      UPDATE onto_pipeline_proposals
      SET status = ?, decided_by = ?, decided_at = datetime('now')
      WHERE id = ?
    `);

            const tx = db.transaction(() => {
                for (const id of proposal_ids) {
                    stmt.run(status, decided_by || 'human', id);
                }
            });
            tx();

            res.json({ ok: true, updated: proposal_ids.length });
        }
    );

    // ── Apply approved proposals for a job ──────────────────────────────────────
    r.post(
        '/api/ontologica/jobs/:jobId/apply-proposals',
        (req: Request, res: Response) => {
            const jobId = req.params.jobId;
            const job = db
                .prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?')
                .get(jobId) as any;
            if (!job) return res.status(404).json({ error: 'Job not found' });

            const approved = db
                .prepare(
                    "SELECT * FROM onto_pipeline_proposals WHERE job_id = ? AND status = 'approved'"
                )
                .all(jobId) as any[];

            if (approved.length === 0) {
                return res.json({
                    ok: true,
                    applied: 0,
                    message: 'No approved proposals to apply'
                });
            }

            let applied = 0;
            const errors: string[] = [];

            const tx = db.transaction(() => {
                for (const proposal of approved) {
                    try {
                        const payload = JSON.parse(proposal.payload);
                        applyProposal(db, proposal, payload);
                        db.prepare(
                            "UPDATE onto_pipeline_proposals SET status = 'applied', applied_at = datetime('now') WHERE id = ?"
                        ).run(proposal.id);
                        applied++;
                    } catch (err: any) {
                        errors.push(`Proposal #${proposal.id}: ${err.message}`);
                    }
                }
            });
            tx();

            // Update project counts
            const nc = (
                db
                    .prepare(
                        'SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ?'
                    )
                    .get(job.project_id) as any
            ).c;
            const ec = (
                db
                    .prepare(
                        'SELECT COUNT(*) as c FROM onto_edges WHERE project_id = ?'
                    )
                    .get(job.project_id) as any
            ).c;
            db.prepare(
                "UPDATE onto_projects SET node_count = ?, edge_count = ?, updated_at = datetime('now') WHERE id = ?"
            ).run(nc, ec, job.project_id);

            res.json({
                ok: true,
                applied,
                errors: errors.length > 0 ? errors : undefined
            });
        }
    );

    // ── Proposal stats for a job ────────────────────────────────────────────────
    r.get(
        '/api/ontologica/jobs/:jobId/proposal-stats',
        (req: Request, res: Response) => {
            const stats = db
                .prepare(`
      SELECT
        status,
        proposal_type,
        COUNT(*) as count
      FROM onto_pipeline_proposals
      WHERE job_id = ?
      GROUP BY status, proposal_type
    `)
                .all(req.params.jobId);

            const total = db
                .prepare(
                    'SELECT COUNT(*) as c FROM onto_pipeline_proposals WHERE job_id = ?'
                )
                .get(req.params.jobId) as any;

            res.json({ total: total.c, breakdown: stats });
        }
    );

    // ── Create manual proposal (human override) ─────────────────────────────────
    r.post(
        '/api/ontologica/projects/:projectId/proposals/manual',
        (req: Request, res: Response) => {
            const projectId = Number(req.params.projectId);
            const { node_id, item_id, proposal_type, apply_immediately } =
                req.body;

            if (!node_id || !item_id || !proposal_type) {
                return res.status(400).json({
                    error: 'node_id, item_id, and proposal_type are required'
                });
            }
            if (!['link_to_base', 'subclass_of'].includes(proposal_type)) {
                return res.status(400).json({
                    error: 'proposal_type must be link_to_base or subclass_of'
                });
            }

            // Look up node and base item
            const node = db
                .prepare(
                    'SELECT * FROM onto_nodes WHERE id = ? AND project_id = ?'
                )
                .get(node_id, projectId) as any;
            if (!node) return res.status(404).json({ error: 'Node not found' });

            const item = db
                .prepare(`
      SELECT bli.*, bl.name as layer_name, bl.slug as layer_slug
      FROM onto_base_layer_items bli
      JOIN onto_base_layers bl ON bl.id = bli.layer_id
      WHERE bli.id = ?
    `)
                .get(item_id) as any;
            if (!item)
                return res
                    .status(404)
                    .json({ error: 'Base layer item not found' });

            const payload = {
                node_id: node.id,
                node_name: node.name,
                node_description: node.description,
                item_id: item.id,
                layer_id: item.layer_id,
                layer_name: item.layer_name,
                layer_slug: item.layer_slug,
                base_item_uri: item.uri,
                base_item_name: item.label || item.local_name,
                base_item_description: item.description,
                match_type: 'same',
                llm_confidence: 1.0,
                manual: true
            };

            const status = apply_immediately ? 'approved' : 'pending';
            const decided_by = apply_immediately ? 'human' : null;
            const decided_at = apply_immediately
                ? new Date().toISOString()
                : null;

            const result = db
                .prepare(`
      INSERT INTO onto_pipeline_proposals
        (job_id, project_id, proposal_type, source_id, target_id, payload, confidence, status, decided_by, decided_at)
      VALUES (0, ?, ?, ?, ?, ?, 1.0, ?, ?, ?)
    `)
                .run(
                    projectId,
                    proposal_type,
                    node_id,
                    item.id,
                    JSON.stringify(payload),
                    status,
                    decided_by,
                    decided_at
                );

            const proposalId = result.lastInsertRowid;

            // If apply_immediately, apply it right now
            if (apply_immediately) {
                try {
                    const proposal = db
                        .prepare(
                            'SELECT * FROM onto_pipeline_proposals WHERE id = ?'
                        )
                        .get(proposalId) as any;
                    applyProposal(db, proposal, payload);
                    db.prepare(
                        "UPDATE onto_pipeline_proposals SET status = 'applied', applied_at = datetime('now') WHERE id = ?"
                    ).run(proposalId);

                    // Update project counts
                    const nc = (
                        db
                            .prepare(
                                'SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ?'
                            )
                            .get(projectId) as any
                    ).c;
                    const ec = (
                        db
                            .prepare(
                                'SELECT COUNT(*) as c FROM onto_edges WHERE project_id = ?'
                            )
                            .get(projectId) as any
                    ).c;
                    db.prepare(
                        "UPDATE onto_projects SET node_count = ?, edge_count = ?, updated_at = datetime('now') WHERE id = ?"
                    ).run(nc, ec, projectId);

                    res.json({ ok: true, id: proposalId, status: 'applied' });
                } catch (err: any) {
                    res.status(500).json({
                        error: `Failed to apply: ${err.message}`
                    });
                }
            } else {
                res.json({ ok: true, id: proposalId, status: 'pending' });
            }
        }
    );

    // ── Update proposal target (change mapping) ─────────────────────────────────
    r.patch(
        '/api/ontologica/proposals/:id/override',
        (req: Request, res: Response) => {
            const { item_id, proposal_type } = req.body;
            if (!item_id)
                return res.status(400).json({ error: 'item_id required' });

            const proposal = db
                .prepare('SELECT * FROM onto_pipeline_proposals WHERE id = ?')
                .get(req.params.id) as any;
            if (!proposal)
                return res.status(404).json({ error: 'Proposal not found' });

            const item = db
                .prepare(`
      SELECT bli.*, bl.name as layer_name, bl.slug as layer_slug
      FROM onto_base_layer_items bli
      JOIN onto_base_layers bl ON bl.id = bli.layer_id
      WHERE bli.id = ?
    `)
                .get(item_id) as any;
            if (!item)
                return res
                    .status(404)
                    .json({ error: 'Base layer item not found' });

            // Update the payload
            const oldPayload = JSON.parse(proposal.payload);
            const newPayload = {
                ...oldPayload,
                item_id: item.id,
                layer_id: item.layer_id,
                layer_name: item.layer_name,
                layer_slug: item.layer_slug,
                base_item_uri: item.uri,
                base_item_name: item.label || item.local_name,
                base_item_description: item.description,
                overridden: true,
                original_item_id: oldPayload.item_id,
                original_item_name: oldPayload.base_item_name
            };

            db.prepare(`
      UPDATE onto_pipeline_proposals
      SET target_id = ?, payload = ?, proposal_type = ?, confidence = 1.0, status = 'pending', decided_by = NULL, decided_at = NULL
      WHERE id = ?
    `).run(
                item.id,
                JSON.stringify(newPayload),
                proposal_type || proposal.proposal_type,
                proposal.id
            );

            res.json({ ok: true });
        }
    );
}

// ── Apply a single proposal based on its type ─────────────────────────────────

function applyProposal(db: Database.Database, proposal: any, payload: any) {
    switch (proposal.proposal_type) {
        case 'merge': {
            // Merge duplicate nodes: redirect edges from duplicates to canonical, delete duplicates
            const { canonical_id, duplicate_ids } = payload;
            if (!canonical_id || !duplicate_ids?.length)
                throw new Error(
                    'merge requires canonical_id and duplicate_ids'
                );

            for (const dupId of duplicate_ids) {
                // Redirect edges pointing to duplicate
                db.prepare(
                    'UPDATE onto_edges SET source_node_id = ? WHERE source_node_id = ? AND project_id = ?'
                ).run(canonical_id, dupId, proposal.project_id);
                db.prepare(
                    'UPDATE onto_edges SET target_node_id = ? WHERE target_node_id = ? AND project_id = ?'
                ).run(canonical_id, dupId, proposal.project_id);
                // Redirect parent references
                db.prepare(
                    'UPDATE onto_nodes SET parent_id = ? WHERE parent_id = ? AND project_id = ?'
                ).run(canonical_id, dupId, proposal.project_id);
                // Delete duplicate node
                db.prepare(
                    'DELETE FROM onto_nodes WHERE id = ? AND project_id = ?'
                ).run(dupId, proposal.project_id);
            }

            // Deduplicate edges (same source+target+type after redirect)
            db.prepare(`
        DELETE FROM onto_edges WHERE id NOT IN (
          SELECT MIN(id) FROM onto_edges
          WHERE project_id = ?
          GROUP BY source_node_id, target_node_id, edge_type
        ) AND project_id = ?
      `).run(proposal.project_id, proposal.project_id);

            // Record dismissals so future dedup scans skip these
            const insertDismissal = db.prepare(
                'INSERT OR IGNORE INTO onto_dedup_dismissals (project_id, node_a_id, node_b_id) VALUES (?, ?, ?)'
            );
            for (const dupId of duplicate_ids) {
                const [a, b] = [canonical_id, dupId].sort(
                    (x: number, y: number) => x - y
                );
                insertDismissal.run(proposal.project_id, a, b);
            }
            break;
        }

        case 'link_to_base': {
            // Link a custom node directly to a base layer item
            const { node_id, layer_id, base_item_uri } = payload;
            if (!node_id || !layer_id || !base_item_uri)
                throw new Error(
                    'link_to_base requires node_id, layer_id, base_item_uri'
                );
            db.prepare(
                "UPDATE onto_nodes SET layer_id = ?, base_item_uri = ?, updated_at = datetime('now') WHERE id = ?"
            ).run(layer_id, base_item_uri, node_id);
            break;
        }

        case 'subclass_of': {
            // Create an is_a edge from custom node to a base layer class
            const { node_id, base_item_uri, base_item_name, layer_id } =
                payload;
            if (!node_id || !base_item_uri)
                throw new Error(
                    'subclass_of requires node_id and base_item_uri'
                );

            // Check if parent node for this base item already exists
            let parentId: number | null = null;
            const existing = db
                .prepare(
                    'SELECT id FROM onto_nodes WHERE project_id = ? AND base_item_uri = ? AND layer_id = ?'
                )
                .get(proposal.project_id, base_item_uri, layer_id) as any;

            if (existing) {
                parentId = existing.id;
            } else {
                // Create the base layer node
                const result = db
                    .prepare(`
          INSERT INTO onto_nodes (project_id, node_type, name, description, uri, confidence, status, layer_id, base_item_uri)
          VALUES (?, 'class', ?, ?, ?, 1.0, 'approved', ?, ?)
        `)
                    .run(
                        proposal.project_id,
                        base_item_name ||
                            base_item_uri.split(/[/#]/).pop() ||
                            base_item_uri,
                        `Base layer class from ${base_item_uri}`,
                        base_item_uri,
                        layer_id,
                        base_item_uri
                    );
                parentId = Number(result.lastInsertRowid);
            }

            // Set parent and create is_a edge
            db.prepare(
                "UPDATE onto_nodes SET parent_id = ?, updated_at = datetime('now') WHERE id = ?"
            ).run(parentId, node_id);
            db.prepare(`
        INSERT INTO onto_edges (project_id, edge_type, name, source_node_id, target_node_id, confidence, status, layer_id, base_item_uri)
        VALUES (?, 'is_a', 'is a', ?, ?, 0.9, 'approved', ?, ?)
      `).run(proposal.project_id, node_id, parentId, layer_id, base_item_uri);
            break;
        }

        case 'not_duplicate': {
            // Record that two nodes are NOT duplicates (dismiss from future scans)
            const { node_ids } = payload;
            if (!node_ids?.length || node_ids.length < 2)
                throw new Error('not_duplicate requires at least 2 node_ids');
            const insertDismissal = db.prepare(
                'INSERT OR IGNORE INTO onto_dedup_dismissals (project_id, node_a_id, node_b_id) VALUES (?, ?, ?)'
            );
            for (let i = 0; i < node_ids.length; i++) {
                for (let j = i + 1; j < node_ids.length; j++) {
                    const [a, b] = [node_ids[i], node_ids[j]].sort(
                        (x: number, y: number) => x - y
                    );
                    insertDismissal.run(proposal.project_id, a, b);
                }
            }
            break;
        }

        case 'no_match': {
            // Record that a node doesn't match a base layer item
            const { node_id, item_id } = payload;
            if (!node_id || !item_id)
                throw new Error('no_match requires node_id and item_id');
            db.prepare(
                'INSERT OR IGNORE INTO onto_layer_suggestion_dismissals (project_id, node_id, item_id) VALUES (?, ?, ?)'
            ).run(proposal.project_id, node_id, item_id);
            break;
        }

        case 'approve':
        case 'reject': {
            // Change node/edge status
            const { node_ids, edge_ids } = payload;
            const newStatus =
                proposal.proposal_type === 'approve' ? 'approved' : 'rejected';
            if (node_ids?.length) {
                const stmt = db.prepare(
                    "UPDATE onto_nodes SET status = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?"
                );
                for (const id of node_ids)
                    stmt.run(newStatus, id, proposal.project_id);
            }
            if (edge_ids?.length) {
                const stmt = db.prepare(
                    'UPDATE onto_edges SET status = ? WHERE id = ? AND project_id = ?'
                );
                for (const id of edge_ids)
                    stmt.run(newStatus, id, proposal.project_id);
            }
            break;
        }

        case 'edit': {
            // Edit a node's name/description
            const { node_id, name, description } = payload;
            if (!node_id) throw new Error('edit requires node_id');
            const updates: string[] = [];
            const values: any[] = [];
            if (name != null) {
                updates.push('name = ?');
                values.push(name);
            }
            if (description != null) {
                updates.push('description = ?');
                values.push(description);
            }
            if (updates.length > 0) {
                updates.push("updated_at = datetime('now')");
                values.push(node_id, proposal.project_id);
                db.prepare(
                    `UPDATE onto_nodes SET ${updates.join(', ')} WHERE id = ? AND project_id = ?`
                ).run(...values);
            }
            break;
        }

        default:
            throw new Error(`Unknown proposal type: ${proposal.proposal_type}`);
    }
}
