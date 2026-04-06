import { Router } from 'express';
import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import path from 'path';

// ── DuckDB singleton ────────────────────────────────────────────────────────
let _connPromise: Promise<DuckDBConnection> | null = null;

function getConn(workspace: string): Promise<DuckDBConnection> {
    if (!_connPromise) {
        _connPromise = DuckDBInstance.create(path.join(workspace, 'analytics.duckdb'))
            .then(inst => inst.connect())
            .then(async conn => {
                await conn.run(`
                    CREATE TABLE IF NOT EXISTS analytics_events (
                        id         BIGINT,
                        app        VARCHAR NOT NULL,
                        event      VARCHAR NOT NULL,
                        page       VARCHAR,
                        meta       VARCHAR,
                        session_id VARCHAR,
                        user_id    INTEGER,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );
                    CREATE SEQUENCE IF NOT EXISTS analytics_events_id_seq START 1;
                `);
                return conn;
            });
    }
    return _connPromise;
}

// ── Router ──────────────────────────────────────────────────────────────────
export function createRouter(workspace: string) {
    const router = Router();

    // ── Ingest ─────────────────────────────────────────────────────────────
    router.post('/api/analytics/events', async (req, res) => {
        try {
            const conn = await getConn(workspace);
            const events = Array.isArray(req.body) ? req.body : [req.body];
            for (const e of events) {
                await conn.run(
                    `INSERT INTO analytics_events (id, app, event, page, meta, session_id, user_id)
                     VALUES (nextval('analytics_events_id_seq'), ?, ?, ?, ?, ?, ?)`,
                    [
                        e.app || 'unknown',
                        e.event || 'unknown',
                        e.page ?? null,
                        e.meta ? JSON.stringify(e.meta) : null,
                        e.session_id ?? null,
                        e.user_id ?? null,
                    ],
                );
            }
            res.status(201).json({ ok: true, count: events.length });
        } catch (err) {
            console.error('[analytics] ingest error:', err);
            res.status(500).json({ error: 'Failed to ingest events' });
        }
    });

    // ── Overview stats ─────────────────────────────────────────────────────
    router.get('/api/analytics/overview', async (_req, res) => {
        try {
            const conn = await getConn(workspace);

            const [totRow, sessRow, todayRow, last7Row, byApp, byDay, topEvents] = await Promise.all([
                conn.runAndReadAll(`SELECT COUNT(*) AS n FROM analytics_events`),
                conn.runAndReadAll(`SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE session_id IS NOT NULL`),
                conn.runAndReadAll(`SELECT COUNT(*) AS n FROM analytics_events WHERE created_at >= current_date`),
                conn.runAndReadAll(`SELECT COUNT(*) AS n FROM analytics_events WHERE created_at >= now() - INTERVAL '7 days'`),
                conn.runAndReadAll(`
                    SELECT app, COUNT(*) AS count
                    FROM analytics_events
                    GROUP BY app
                    ORDER BY count DESC
                `),
                conn.runAndReadAll(`
                    SELECT strftime(created_at, '%Y-%m-%d') AS day, COUNT(*) AS count
                    FROM analytics_events
                    WHERE created_at >= now() - INTERVAL '14 days'
                    GROUP BY day
                    ORDER BY day
                `),
                conn.runAndReadAll(`
                    SELECT app, event, COUNT(*) AS count
                    FROM analytics_events
                    GROUP BY app, event
                    ORDER BY count DESC
                    LIMIT 20
                `),
            ]);

            const numify = (rows: any[]) =>
                rows.map(r => Object.fromEntries(
                    Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])
                ));

            res.json({
                totalEvents:    Number((totRow.getRowObjects()[0] as any)?.n ?? 0),
                uniqueSessions: Number((sessRow.getRowObjects()[0] as any)?.n ?? 0),
                today:          Number((todayRow.getRowObjects()[0] as any)?.n ?? 0),
                last7d:         Number((last7Row.getRowObjects()[0] as any)?.n ?? 0),
                byApp:          numify(byApp.getRowObjects()),
                byDay:          numify(byDay.getRowObjects()),
                topEvents:      numify(topEvents.getRowObjects()),
            });
        } catch (err) {
            console.error('[analytics] overview error:', err);
            res.status(500).json({ error: 'Failed to fetch overview' });
        }
    });

    // ── Per-app breakdown ──────────────────────────────────────────────────
    router.get('/api/analytics/apps/:appId', async (req, res) => {
        try {
            const conn = await getConn(workspace);
            const { appId } = req.params;
            const daysInt = Math.min(Math.max(parseInt((req.query.days as string) || '7', 10) || 7, 1), 90);
            const interval = `INTERVAL '${daysInt} days'`;

            const [totRow, eventBreakdown, byDay] = await Promise.all([
                conn.runAndReadAll(
                    `SELECT COUNT(*) AS n FROM analytics_events WHERE app=? AND created_at >= now() - ${interval}`,
                    [appId],
                ),
                conn.runAndReadAll(
                    `SELECT event, COUNT(*) AS count
                     FROM analytics_events
                     WHERE app=? AND created_at >= now() - ${interval}
                     GROUP BY event
                     ORDER BY count DESC`,
                    [appId],
                ),
                conn.runAndReadAll(
                    `SELECT strftime(created_at, '%Y-%m-%d') AS day, COUNT(*) AS count
                     FROM analytics_events
                     WHERE app=? AND created_at >= now() - ${interval}
                     GROUP BY day
                     ORDER BY day`,
                    [appId],
                ),
            ]);

            const numify = (rows: any[]) =>
                rows.map(r => Object.fromEntries(
                    Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])
                ));

            res.json({
                app:            appId,
                total:          Number((totRow.getRowObjects()[0] as any)?.n ?? 0),
                eventBreakdown: numify(eventBreakdown.getRowObjects()),
                byDay:          numify(byDay.getRowObjects()),
            });
        } catch (err) {
            console.error('[analytics] per-app error:', err);
            res.status(500).json({ error: 'Failed to fetch app analytics' });
        }
    });

    // ── Live feed ──────────────────────────────────────────────────────────
    router.get('/api/analytics/feed', async (req, res) => {
        try {
            const conn = await getConn(workspace);
            const n = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 200);
            const after = req.query.after as string | undefined;

            const result = after
                ? await conn.runAndReadAll(
                      `SELECT * FROM analytics_events WHERE id > ? ORDER BY id DESC LIMIT ?`,
                      [after, n],
                  )
                : await conn.runAndReadAll(
                      `SELECT * FROM analytics_events ORDER BY id DESC LIMIT ?`,
                      [n],
                  );

            const rows = result.getRowObjects().map((r: any) =>
                Object.fromEntries(
                    Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])
                )
            );
            res.json(rows);
        } catch (err) {
            console.error('[analytics] feed error:', err);
            res.status(500).json({ error: 'Failed to fetch feed' });
        }
    });

    return router;
}
