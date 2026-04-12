import { Router } from 'express';

import type Database from 'better-sqlite3';

export function createRouter(db: InstanceType<typeof Database>) {
    const router = Router();

    router.get('/api/db/tables', (_req, res) => {
        const tables = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
            )
            .all() as { name: string }[];

        const result = tables.map(({ name }) => {
            const columns = db
                .prepare(`PRAGMA table_info(${JSON.stringify(name)})`)
                .all() as {
                name: string;
                type: string;
                notnull: number;
                pk: number;
                dflt_value: string | null;
            }[];
            const { n } = db
                .prepare(`SELECT COUNT(*) as n FROM ${JSON.stringify(name)}`)
                .get() as {
                n: number;
            };
            return { name, rowCount: n, columns };
        });
        res.json(result);
    });

    router.get('/api/db/:table/rows', (req, res) => {
        const { table } = req.params;
        const exists = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
            )
            .get(table);
        if (!exists) return res.status(404).json({ error: 'Table not found' });

        const page = parseInt(String(req.query.page || '0'), 10);
        const limit = Math.min(
            parseInt(String(req.query.limit || '50'), 10),
            200
        );
        const offset = page * limit;

        const rows = db
            .prepare(`SELECT * FROM ${JSON.stringify(table)} LIMIT ? OFFSET ?`)
            .all(limit, offset);
        const { n: total } = db
            .prepare(`SELECT COUNT(*) as n FROM ${JSON.stringify(table)}`)
            .get() as {
            n: number;
        };
        res.json({ rows, total, page, limit });
    });

    router.post('/api/db/:table/rows', (req, res) => {
        const { table } = req.params;
        const exists = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
            )
            .get(table);
        if (!exists) return res.status(404).json({ error: 'Table not found' });

        const body = req.body as Record<string, string>;
        const cols = Object.keys(body).filter(k => k !== 'id');
        if (cols.length === 0)
            return res.status(400).json({ error: 'No columns provided' });

        const placeholders = cols.map(() => '?').join(',');
        const colList = cols.map(c => JSON.stringify(c)).join(',');
        try {
            const r = db
                .prepare(
                    `INSERT INTO ${JSON.stringify(table)} (${colList}) VALUES (${placeholders})`
                )
                .run(...cols.map(c => (body[c] === '' ? null : body[c])));
            res.status(201).json(
                db
                    .prepare(
                        `SELECT * FROM ${JSON.stringify(table)} WHERE rowid=?`
                    )
                    .get(r.lastInsertRowid)
            );
        } catch (e: unknown) {
            res.status(400).json({
                error: e instanceof Error ? e.message : String(e)
            });
        }
    });

    router.put('/api/db/:table/rows/:id', (req, res) => {
        const { table, id } = req.params;
        const exists = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
            )
            .get(table);
        if (!exists) return res.status(404).json({ error: 'Table not found' });

        const body = req.body as Record<string, string>;
        const cols = Object.keys(body).filter(
            k => k !== 'id' && k !== 'created_at' && k !== 'updated_at'
        );
        if (cols.length === 0)
            return res.status(400).json({ error: 'No columns provided' });

        const setClause = cols.map(c => `${JSON.stringify(c)}=?`).join(',');
        const colInfo = db
            .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
            .all() as {
            name: string;
        }[];
        const hasUpdated = colInfo.some(c => c.name === 'updated_at');
        const finalSet = hasUpdated
            ? `${setClause},updated_at=datetime('now')`
            : setClause;
        try {
            db.prepare(
                `UPDATE ${JSON.stringify(table)} SET ${finalSet} WHERE id=?`
            ).run(...cols.map(c => (body[c] === '' ? null : body[c])), id);
            res.json(
                db
                    .prepare(
                        `SELECT * FROM ${JSON.stringify(table)} WHERE id=?`
                    )
                    .get(id)
            );
        } catch (e: unknown) {
            res.status(400).json({
                error: e instanceof Error ? e.message : String(e)
            });
        }
    });

    router.delete('/api/db/:table/rows/:id', (req, res) => {
        const { table, id } = req.params;
        const exists = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
            )
            .get(table);
        if (!exists) return res.status(404).json({ error: 'Table not found' });
        try {
            db.prepare(`DELETE FROM ${JSON.stringify(table)} WHERE id=?`).run(
                id
            );
            res.json({ ok: true });
        } catch (e: unknown) {
            res.status(400).json({
                error: e instanceof Error ? e.message : String(e)
            });
        }
    });

    return router;
}
