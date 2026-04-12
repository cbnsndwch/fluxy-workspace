/**
 * Shared LLM client — all AI calls go through here.
 * Uses direct fetch to Anthropic API with OAuth Bearer token
 * from ~/.claude/.credentials.json (same credentials the supervisor/worker use).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type Model = 'fast' | 'smart' | 'haiku' | 'opus';

const MODEL_MAP: Record<Model, string> = {
  haiku: 'claude-haiku-4-5',
  fast: 'claude-sonnet-4-20250514',
  smart: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-5',
};

const API_URL = 'https://api.anthropic.com/v1/messages';

// ── Quota callback — set by quota.ts to capture rate-limit headers ───────────
let _quotaCallback: ((headers: Record<string, string>, model: string) => void) | null = null;
export function setQuotaCallback(cb: typeof _quotaCallback) { _quotaCallback = cb; }

/** Read OAuth token from ~/.claude/.credentials.json (Claude Code's credential store) */
export function readClaudeToken(): string {
  try {
    const credFile = path.join(os.homedir(), '.claude', '.credentials.json');
    const creds = JSON.parse(fs.readFileSync(credFile, 'utf-8'));
    const oauth = creds.claudeAiOauth ?? creds;
    if (oauth.accessToken && (!oauth.expiresAt || Date.now() < oauth.expiresAt)) {
      return oauth.accessToken as string;
    }
  } catch {}
  throw new Error('No valid Claude OAuth token found in ~/.claude/.credentials.json');
}

// Generous retry config — OAuth tokens have lower rate limits
const MAX_RETRIES = 12;
const INITIAL_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 120_000; // 2 minutes max wait

/** Sleep helper */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface RetryEvent {
  attempt: number;
  maxRetries: number;
  waitMs: number;
  status: number;
}

interface FetchOptions {
  /** Called before each retry sleep — use to update UI/logs */
  onRetry?: (event: RetryEvent) => void;
}

/** Make a direct API call to Anthropic with Bearer auth + retry on rate limits */
async function anthropicFetch(body: Record<string, any>, opts?: FetchOptions): Promise<any> {
  const token = readClaudeToken();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      body: JSON.stringify(body),
    });

    // Capture ALL rate-limit headers on EVERY response (success, 429, 529, etc.)
    if (_quotaCallback) {
      const allHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => { allHeaders[k] = v; });
      try { _quotaCallback(allHeaders, body.model); } catch {}
    }

    if (resp.ok) return resp.json();

    const errText = await resp.text();

    // Retry on rate limit (429) or overloaded (529)
    if ((resp.status === 429 || resp.status === 529) && attempt < MAX_RETRIES) {
      const retryAfter = resp.headers.get('retry-after');
      const rawWait = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : INITIAL_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 2000;
      const waitMs = Math.min(rawWait, MAX_BACKOFF_MS);

      console.warn(`[llm] ${resp.status} rate limited — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(waitMs / 1000)}s`);

      // Notify caller so they can update pipeline status
      opts?.onRetry?.({ attempt: attempt + 1, maxRetries: MAX_RETRIES, waitMs, status: resp.status });

      await sleep(waitMs);
      continue;
    }

    throw new Error(`Anthropic API ${resp.status} ${errText}`);
  }

  throw new Error('Anthropic API: max retries exhausted');
}

/**
 * Single-turn LLM call with JSON output.
 * Returns the raw text response — caller is responsible for JSON.parse().
 */
export async function llmCall(
  systemPrompt: string,
  userPrompt: string,
  opts: {
    model?: Model;
    maxTokens?: number;
    temperature?: number;
    onRetry?: (event: RetryEvent) => void;
  } = {}
): Promise<string> {
  const { model = 'fast', maxTokens = 4096, temperature = 0.3, onRetry } = opts;
  const start = Date.now();

  try {
    const resp = await anthropicFetch({
      model: MODEL_MAP[model],
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }, { onRetry });

    const text = resp.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    console.log(`[llm] ${MODEL_MAP[model]} call done in ${Date.now() - start}ms`);
    return text;
  } catch (err: any) {
    console.error(`[llm] call FAILED after ${Date.now() - start}ms:`, err.message);
    throw err;
  }
}

/**
 * Multi-turn chat completion — for conversational UIs.
 * Accepts a message history array.
 */
export async function llmChat(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  opts: {
    model?: Model;
    maxTokens?: number;
    temperature?: number;
    onRetry?: (event: RetryEvent) => void;
  } = {}
): Promise<string> {
  const { model = 'smart', maxTokens = 4096, temperature = 0.4, onRetry } = opts;
  const start = Date.now();

  try {
    const resp = await anthropicFetch({
      model: MODEL_MAP[model],
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages,
    }, { onRetry });

    const text = resp.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    console.log(`[llm] chat ${MODEL_MAP[model]} done in ${Date.now() - start}ms`);
    return text;
  } catch (err: any) {
    console.error(`[llm] chat FAILED after ${Date.now() - start}ms:`, err.message);
    throw err;
  }
}

/**
 * Extract JSON from Claude's response.
 * Claude sometimes wraps JSON in markdown code fences — this strips them.
 */
export function extractJSON(text: string): string {
  // Strip markdown code fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Try to find raw JSON object/array
  const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return match ? match[1] : text;
}
