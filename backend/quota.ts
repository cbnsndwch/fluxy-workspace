/**
 * API Quota Tracker — Claude Code MAX (Unified Quotas)
 *
 * Anthropic's OAuth-based plans use a "unified" rate-limit system with:
 *   - 5-hour rolling window (tight constraint)
 *   - 7-day rolling window (weekly budget)
 *   - Fallback capacity (burst headroom)
 *   - Overage bucket (paid extra capacity)
 *
 * Headers look like:
 *   anthropic-ratelimit-unified-5h-utilization: 0.75
 *   anthropic-ratelimit-unified-5h-status: allowed
 *   anthropic-ratelimit-unified-5h-reset: 1775811600  (unix epoch)
 *   anthropic-ratelimit-unified-7d-utilization: 0.35
 *   anthropic-ratelimit-unified-7d-status: allowed
 *   anthropic-ratelimit-unified-fallback: available
 *   anthropic-ratelimit-unified-overage-utilization: 0.0
 *   anthropic-ratelimit-unified-status: allowed|allowed_warning|throttled
 *   anthropic-ratelimit-unified-representative-claim: five_hour
 *
 * We capture these on EVERY LLM call (passive) and via periodic probes.
 * Agents check GET /api/quota to decide how aggressive to be.
 */

import type Database from 'better-sqlite3';
import { Router, type Request, type Response } from 'express';
import { setQuotaCallback } from './llm.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UnifiedQuotaSnapshot {
  id?: number;
  model: string;
  // Overall status
  unified_status: string | null;          // allowed | allowed_warning | throttled
  representative_claim: string | null;    // which window is the binding constraint
  // 5-hour window
  five_h_utilization: number | null;      // 0.0 – 1.0+
  five_h_status: string | null;           // allowed | allowed_warning | throttled
  five_h_reset: number | null;            // unix epoch seconds
  five_h_surpassed_threshold: number | null; // e.g. 0.9
  // 7-day window
  seven_d_utilization: number | null;
  seven_d_status: string | null;
  seven_d_reset: number | null;
  // Fallback
  fallback_available: string | null;      // available | unavailable
  fallback_percentage: number | null;     // 0.0 – 1.0
  // Overage
  overage_in_use: boolean | null;
  overage_status: string | null;
  overage_utilization: number | null;
  overage_reset: number | null;
  // Upgrade paths
  upgrade_paths: string | null;
  // Meta
  source: 'passive' | 'probe';
  captured_at: string;
}

export type Recommendation = 'aggressive' | 'moderate' | 'cautious' | 'pause';

// ── Header parsing ───────────────────────────────────────────────────────────

function parseUnifiedHeaders(allHeaders: Record<string, string>, model: string): UnifiedQuotaSnapshot {
  const h = (key: string) => allHeaders[`anthropic-ratelimit-unified-${key}`] ?? null;
  const hNum = (key: string) => { const v = h(key); return v != null ? parseFloat(v) : null; };
  const hInt = (key: string) => { const v = h(key); return v != null ? parseInt(v, 10) : null; };

  return {
    model,
    unified_status: allHeaders['anthropic-ratelimit-unified-status'] ?? null,
    representative_claim: allHeaders['anthropic-ratelimit-unified-representative-claim'] ?? null,
    five_h_utilization: hNum('5h-utilization'),
    five_h_status: h('5h-status'),
    five_h_reset: hInt('5h-reset'),
    five_h_surpassed_threshold: hNum('5h-surpassed-threshold'),
    seven_d_utilization: hNum('7d-utilization'),
    seven_d_status: h('7d-status'),
    seven_d_reset: hInt('7d-reset'),
    fallback_available: h('fallback'),
    fallback_percentage: hNum('fallback-percentage'),
    overage_in_use: h('overage-in-use') === 'true',
    overage_status: h('overage-status'),
    overage_utilization: hNum('overage-utilization'),
    overage_reset: hInt('overage-reset'),
    upgrade_paths: allHeaders['anthropic-ratelimit-unified-upgrade-paths'] ?? null,
    source: 'passive',
    captured_at: new Date().toISOString(),
  };
}

// ── Recommendation engine ────────────────────────────────────────────────────

function computeRecommendation(snap: UnifiedQuotaSnapshot | null): { recommendation: Recommendation; reason: string; details: Record<string, any> } {
  if (!snap) {
    return { recommendation: 'aggressive', reason: 'No quota data — assume fresh capacity', details: {} };
  }

  const capturedISO = snap.captured_at.endsWith('Z') ? snap.captured_at : snap.captured_at + 'Z';
  const ageMs = Date.now() - new Date(capturedISO).getTime();
  const ageMins = Math.round(ageMs / 60_000);

  // If data is very stale (>15 min), probably no recent activity
  const stale = ageMins > 15;

  const details: Record<string, any> = {
    data_age_mins: ageMins,
    stale,
  };

  // Check unified status first — Anthropic tells us directly
  if (snap.unified_status === 'throttled') {
    const resetAt = snap.five_h_reset ? new Date(snap.five_h_reset * 1000) : null;
    const minsUntilReset = resetAt ? Math.max(0, Math.round((resetAt.getTime() - Date.now()) / 60_000)) : null;
    details.reset_in_mins = minsUntilReset;
    return {
      recommendation: 'pause',
      reason: `Throttled by Anthropic${minsUntilReset ? ` — resets in ${minsUntilReset}min` : ''}`,
      details,
    };
  }

  // Get the binding constraint
  const fiveH = snap.five_h_utilization;
  const sevenD = snap.seven_d_utilization;
  details.five_h_utilization = fiveH;
  details.seven_d_utilization = sevenD;
  details.fallback_available = snap.fallback_available;
  details.overage_in_use = snap.overage_in_use;

  // 5h window is the tight one — use it as primary signal
  if (fiveH != null) {
    const pctUsed = Math.round(fiveH * 100);
    details.five_h_pct_used = pctUsed;

    if (snap.five_h_status === 'allowed_warning') {
      // We've crossed the warning threshold (usually 90%)
      if (snap.fallback_available === 'available') {
        return {
          recommendation: 'cautious',
          reason: `5h window at ${pctUsed}% (warning) — fallback available but pace yourself`,
          details,
        };
      }
      return {
        recommendation: 'pause',
        reason: `5h window at ${pctUsed}% (warning) — no fallback, wait for reset`,
        details,
      };
    }

    // Normal allowed status — calibrate by utilization
    if (fiveH < 0.4) {
      return { recommendation: 'aggressive', reason: `5h window at ${pctUsed}% — plenty of headroom`, details };
    }
    if (fiveH < 0.7) {
      return { recommendation: 'moderate', reason: `5h window at ${pctUsed}% — pace yourself`, details };
    }
    if (fiveH < 0.9) {
      return { recommendation: 'cautious', reason: `5h window at ${pctUsed}% — approaching warning threshold`, details };
    }
    // >90% but still allowed (shouldn't happen with warning, but defensive)
    return { recommendation: 'cautious', reason: `5h window at ${pctUsed}% — very close to limit`, details };
  }

  // If stale, assume capacity has recovered
  if (stale) {
    return { recommendation: 'aggressive', reason: `No recent API activity (${ageMins}min ago) — capacity likely refreshed`, details };
  }

  return { recommendation: 'moderate', reason: 'Quota data present but utilization unknown', details };
}

// ── Time-of-day awareness ────────────────────────────────────────────────────

function getActivityContext(): { period: 'active' | 'quiet' | 'sleeping'; hint: string } {
  const hour = new Date().getHours();
  if (hour >= 23 || hour < 7) return { period: 'sleeping', hint: 'Human likely asleep — prime time for batch work' };
  if (hour >= 9 && hour < 18) return { period: 'active', hint: 'Human likely active — share quota conservatively' };
  return { period: 'quiet', hint: 'Outside core hours — moderate batch work OK' };
}

// ── DB operations ────────────────────────────────────────────────────────────

function writeSnapshot(db: Database.Database, snap: UnifiedQuotaSnapshot) {
  db.prepare(`
    INSERT INTO api_quota (
      model, unified_status, representative_claim,
      five_h_utilization, five_h_status, five_h_reset, five_h_surpassed_threshold,
      seven_d_utilization, seven_d_status, seven_d_reset,
      fallback_available, fallback_percentage,
      overage_in_use, overage_status, overage_utilization, overage_reset,
      upgrade_paths, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snap.model,
    snap.unified_status, snap.representative_claim,
    snap.five_h_utilization, snap.five_h_status, snap.five_h_reset, snap.five_h_surpassed_threshold,
    snap.seven_d_utilization, snap.seven_d_status, snap.seven_d_reset,
    snap.fallback_available, snap.fallback_percentage,
    snap.overage_in_use ? 1 : 0, snap.overage_status, snap.overage_utilization, snap.overage_reset,
    snap.upgrade_paths, snap.source
  );

  // Prune — keep last 1000 rows
  db.prepare(`DELETE FROM api_quota WHERE id NOT IN (SELECT id FROM api_quota ORDER BY id DESC LIMIT 1000)`).run();
}

function getLatest(db: Database.Database): UnifiedQuotaSnapshot | null {
  return db.prepare(`SELECT * FROM api_quota ORDER BY id DESC LIMIT 1`).get() as UnifiedQuotaSnapshot | null;
}

function getHistory(db: Database.Database, limit = 100): UnifiedQuotaSnapshot[] {
  return db.prepare(`SELECT * FROM api_quota ORDER BY id DESC LIMIT ?`).all(limit) as UnifiedQuotaSnapshot[];
}

// ── Probe ────────────────────────────────────────────────────────────────────

const PROBE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
let probeTimer: ReturnType<typeof setInterval> | null = null;

async function runProbe(db: Database.Database) {
  try {
    const { readClaudeToken } = await import('./llm.js');
    const token = readClaudeToken();

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: '1' }],
      }),
    });

    // Gather all headers
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => { headers[k] = v; });

    // Check if we got unified headers
    const hasUnified = Object.keys(headers).some(k => k.startsWith('anthropic-ratelimit-unified'));

    if (hasUnified) {
      const snap = parseUnifiedHeaders(headers, 'claude-haiku-4-5');
      snap.source = 'probe';
      writeSnapshot(db, snap);

      const u5h = snap.five_h_utilization != null ? `${Math.round(snap.five_h_utilization * 100)}%` : '?';
      const u7d = snap.seven_d_utilization != null ? `${Math.round(snap.seven_d_utilization * 100)}%` : '?';
      console.log(`[quota] Probe: 5h=${u5h} 7d=${u7d} status=${snap.unified_status} fallback=${snap.fallback_available}`);
    } else {
      console.log(`[quota] Probe: no unified headers (status ${resp.status})`);
    }
  } catch (err: any) {
    console.warn(`[quota] Probe failed: ${err.message}`);
  }
}

// ── Init & Router ────────────────────────────────────────────────────────────

export function initQuota(db: Database.Database): Router {
  const r = Router();

  // Recreate table with new schema (drop old one if it has wrong columns)
  try {
    db.prepare("SELECT unified_status FROM api_quota LIMIT 1").get();
  } catch {
    // Old schema or doesn't exist — recreate
    db.exec(`DROP TABLE IF EXISTS api_quota`);
    db.exec(`
      CREATE TABLE api_quota (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        model                    TEXT NOT NULL,
        unified_status           TEXT,
        representative_claim     TEXT,
        five_h_utilization       REAL,
        five_h_status            TEXT,
        five_h_reset             INTEGER,
        five_h_surpassed_threshold REAL,
        seven_d_utilization      REAL,
        seven_d_status           TEXT,
        seven_d_reset            INTEGER,
        fallback_available       TEXT,
        fallback_percentage      REAL,
        overage_in_use           INTEGER,
        overage_status           TEXT,
        overage_utilization      REAL,
        overage_reset            INTEGER,
        upgrade_paths            TEXT,
        source                   TEXT NOT NULL DEFAULT 'passive',
        captured_at              TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_api_quota_time ON api_quota(captured_at DESC);
    `);
    console.log('[quota] Created api_quota table with unified schema');
  }

  // Wire up passive capture from llm.ts
  setQuotaCallback((headers: Record<string, string>, model: string) => {
    // Build full header map from the Response
    const hasUnified = Object.keys(headers).some(k => k.startsWith('anthropic-ratelimit-unified'));
    if (hasUnified) {
      const snap = parseUnifiedHeaders(headers, model);
      snap.source = 'passive';
      writeSnapshot(db, snap);
    }
  });

  // Start background probe
  probeTimer = setInterval(() => runProbe(db), PROBE_INTERVAL_MS);
  setTimeout(() => runProbe(db), 5000);
  console.log(`[quota] Background probe every ${PROBE_INTERVAL_MS / 1000}s`);

  // ── Routes ───────────────────────────────────────────────────────────────

  /**
   * GET /api/quota
   * The main endpoint agents check. Returns current state + recommendation.
   */
  r.get('/api/quota', (_req: Request, res: Response) => {
    const latest = getLatest(db);
    const { recommendation, reason, details } = computeRecommendation(latest);
    const activity = getActivityContext();

    // captured_at is stored via SQLite datetime('now') which is UTC — append Z for correct parsing
    const capturedISO = latest?.captured_at?.endsWith('Z') ? latest.captured_at : latest?.captured_at + 'Z';
    const ageMs = latest ? Date.now() - new Date(capturedISO).getTime() : null;

    res.json({
      recommendation,
      reason,
      activity,
      details: {
        ...details,
        five_h_reset_at: latest?.five_h_reset ? new Date(latest.five_h_reset * 1000).toISOString() : null,
        seven_d_reset_at: latest?.seven_d_reset ? new Date(latest.seven_d_reset * 1000).toISOString() : null,
      },
      current: latest ? {
        unified_status: latest.unified_status,
        representative_claim: latest.representative_claim,
        five_h: {
          utilization: latest.five_h_utilization,
          status: latest.five_h_status,
          reset: latest.five_h_reset,
          reset_at: latest.five_h_reset ? new Date(latest.five_h_reset * 1000).toISOString() : null,
          surpassed_threshold: latest.five_h_surpassed_threshold,
        },
        seven_d: {
          utilization: latest.seven_d_utilization,
          status: latest.seven_d_status,
          reset: latest.seven_d_reset,
          reset_at: latest.seven_d_reset ? new Date(latest.seven_d_reset * 1000).toISOString() : null,
        },
        fallback: {
          available: latest.fallback_available,
          percentage: latest.fallback_percentage,
        },
        overage: {
          in_use: latest.overage_in_use,
          status: latest.overage_status,
          utilization: latest.overage_utilization,
          reset: latest.overage_reset,
        },
      } : null,
      last_updated: latest?.captured_at ?? null,
      stale: ageMs != null ? ageMs > 5 * 60_000 : true,
      source: latest?.source ?? null,
    });
  });

  /**
   * GET /api/quota/history
   * For graphing utilization over time.
   */
  r.get('/api/quota/history', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    res.json(getHistory(db, limit));
  });

  /**
   * POST /api/quota/probe
   * Force a probe now (for testing or on-demand refresh).
   */
  r.post('/api/quota/probe', async (_req: Request, res: Response) => {
    await runProbe(db);
    const latest = getLatest(db);
    const { recommendation, reason } = computeRecommendation(latest);
    res.json({ ok: true, recommendation, reason, latest });
  });

  return r;
}

// Cleanup
process.on('SIGTERM', () => { if (probeTimer) clearInterval(probeTimer); });
process.on('SIGINT', () => { if (probeTimer) clearInterval(probeTimer); });
