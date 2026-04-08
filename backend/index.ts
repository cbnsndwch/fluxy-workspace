// oxlint-disable no-console
// Patch BigInt so JSON.stringify doesn't throw — DuckDB returns BigInt for COUNT()
(BigInt.prototype as unknown as Record<string, unknown>).toJSON = function () { return Number(this); };

import 'dotenv/config';
import express from 'express';
import { db, WORKSPACE } from './db.js';
import { createRouter as authRouter } from './auth/index.js';
import { createRouter as appIdeasRouter } from './apps/app-ideas/index.js';
import { createRouter as issuesRouter } from './apps/issues/index.js';
import { createRouter as dbViewerRouter } from './apps/db-viewer/index.js';
import { createRouter as docsRouter } from './apps/docs/index.js';
import { createRouter as imageGenRouter } from './apps/image-gen/index.js';
import { createRouter as workflowsRouter } from './apps/workflows/index.js';
import { createRouter as usersRouter } from './apps/users/index.js';
import { createRouter as researchRouter } from './apps/research/index.js';
import { createRouter as analyticsRouter } from './apps/analytics/index.js';
import { createRouter as flowCaptureRouter } from './apps/flow-capture/index.js';
import { createRouter as marbleStudioRouter } from './apps/marble-studio/index.js';
import { createRouter as gitViewerRouter } from './apps/git-viewer/index.js';
import { initIcebreaker } from './icebreaker.js';
import { createRouter as marketplaceRouter } from './apps/marketplace/index.js';

const PORT = parseInt(process.env.BACKEND_PORT || '3004', 10);

const app = express();
app.use(express.json({ limit: '20mb' }));

// ── Core ──────────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });
app.get('/api/settings', (_req, res) => { res.json({ onboard_complete: 'true' }); });

// ── App Routers ───────────────────────────────────────────────────────────────
app.use(authRouter(db));
app.use(appIdeasRouter(db));
app.use(issuesRouter(db, WORKSPACE));
app.use(dbViewerRouter(db));
app.use(docsRouter(WORKSPACE));
app.use(imageGenRouter(db, WORKSPACE));
app.use(workflowsRouter(db));
app.use(usersRouter(db));
app.use(researchRouter(db));
app.use(analyticsRouter(WORKSPACE));
app.use(flowCaptureRouter(db));
app.use(marbleStudioRouter(db));
app.use(gitViewerRouter(WORKSPACE));
initIcebreaker(app, db);
app.use(marketplaceRouter(db));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });

// ── Server Lifecycle ──────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`[backend] Listening on port ${PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[backend] Server error: ${err.message}`);
    process.exit(1);
});

process.on('unhandledRejection', err => {
    console.error('[backend] Unhandled rejection:', err);
});

function shutdown() {
    console.log('[backend] Shutting down...');
    server.close(() => {
        db.close();
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
