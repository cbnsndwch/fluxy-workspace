/**
 * Shared LLM client — all AI calls go through here.
 * Uses direct fetch to Anthropic API with OAuth Bearer token
 * from ~/.claude/.credentials.json (same credentials the supervisor/worker use).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type Model = 'fast' | 'smart' | 'haiku' | 'opus';

const MODEL_MAP: Record<Model, string> = {
    haiku: 'claude-haiku-4-5',
    fast: 'claude-sonnet-4-20250514',
    smart: 'claude-sonnet-4-20250514',
    opus: 'claude-opus-4-5'
};

const API_URL = 'https://api.anthropic.com/v1/messages';

// ── Quota callback — set by quota.ts to capture rate-limit headers ───────────
let _quotaCallback:
    | ((headers: Record<string, string>, model: string) => void)
    | null = null;
export function setQuotaCallback(cb: typeof _quotaCallback) {
    _quotaCallback = cb;
}

/** Read OAuth token from ~/.claude/.credentials.json (Claude Code's credential store) */
export function readClaudeToken(): string {
    try {
        const credFile = path.join(
            os.homedir(),
            '.claude',
            '.credentials.json'
        );
        const creds = JSON.parse(fs.readFileSync(credFile, 'utf-8'));
        const oauth = creds.claudeAiOauth ?? creds;
        if (
            oauth.accessToken &&
            (!oauth.expiresAt || Date.now() < oauth.expiresAt)
        ) {
            return oauth.accessToken as string;
        }
    } catch {}
    throw new Error(
        'No valid Claude OAuth token found in ~/.claude/.credentials.json'
    );
}

// Retry config — OAuth tokens have lower rate limits and return NO timing headers.
// Anthropic OAuth 429s only return `x-should-retry: true` — no retry-after, no reset timestamps.
// We MUST wait long enough for the window to reset (~60s) or we just burn retries.
const MAX_RETRIES = 8;
const RATE_LIMIT_BACKOFF_MS = 60_000; // 429: start at 60s — this is a minute-window rate limit
const OVERLOAD_INITIAL_MS = 5_000; // 529: start at 5s — transient, recovers fast
const OVERLOAD_MAX_MS = 30_000; // 529: cap at 30s

/** Sleep helper */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface RetryEvent {
    attempt: number;
    maxRetries: number;
    waitMs: number;
    status: number;
    /** All response headers from the rate-limited response (includes x-ratelimit-* headers) */
    headers: Record<string, string>;
}

interface FetchOptions {
    /** Called before each retry sleep — use to update UI/logs */
    onRetry?: (event: RetryEvent) => void;
}

/** Make a direct API call to Anthropic with Bearer auth + retry on rate limits */
async function anthropicFetch(
    body: Record<string, any>,
    opts?: FetchOptions
): Promise<any> {
    const token = readClaudeToken();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const resp = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'oauth-2025-04-20'
            },
            body: JSON.stringify(body)
        });

        // Capture ALL rate-limit headers on EVERY response (success, 429, 529, etc.)
        if (_quotaCallback) {
            const allHeaders: Record<string, string> = {};
            resp.headers.forEach((v, k) => {
                allHeaders[k] = v;
            });
            try {
                _quotaCallback(allHeaders, body.model);
            } catch {}
        }

        if (resp.ok) return resp.json();

        const errText = await resp.text();

        // Retry on rate limit (429) or overloaded (529)
        if (
            (resp.status === 429 || resp.status === 529) &&
            attempt < MAX_RETRIES
        ) {
            // Capture ALL response headers for debugging
            const allHeaders: Record<string, string> = {};
            resp.headers.forEach((v, k) => {
                allHeaders[k] = v;
            });

            // Log all headers on first rate-limit hit so we know what the API sends
            if (attempt === 0) {
                console.warn(
                    `[llm] ${resp.status} — ALL response headers:`,
                    JSON.stringify(allHeaders, null, 2)
                );
            }

            // Try multiple sources for retry timing:
            // 1. retry-after header (seconds)
            // 2. x-ratelimit-reset-requests / x-ratelimit-reset-tokens (ISO timestamps)
            // 3. Error body may contain retry info
            // 4. Exponential backoff as last resort
            const retryAfter = resp.headers.get('retry-after');
            const resetRequests = resp.headers.get(
                'x-ratelimit-reset-requests'
            );
            const resetTokens = resp.headers.get('x-ratelimit-reset-tokens');

            let waitMs: number;
            let strategy: string;

            if (retryAfter) {
                // retry-after can be seconds or an HTTP-date — trust it completely
                const seconds = parseInt(retryAfter, 10);
                if (!isNaN(seconds)) {
                    waitMs = seconds * 1000 + 500;
                } else {
                    waitMs =
                        Math.max(
                            new Date(retryAfter).getTime() - Date.now(),
                            1000
                        ) + 500;
                }
                strategy = `retry-after: ${retryAfter}`;
            } else if (resetRequests || resetTokens) {
                const resets = [resetRequests, resetTokens]
                    .filter(Boolean)
                    .map(t => new Date(t!).getTime());
                const furthest = Math.max(...resets);
                waitMs = Math.max(furthest - Date.now(), 1000) + 500;
                strategy = `reset header: ${Math.round(waitMs / 1000)}s`;
            } else if (resp.status === 429) {
                // 429 with NO timing headers (Anthropic OAuth) — minute-window rate limit.
                // Waiting less than 60s just burns retries. Add jitter to avoid thundering herd.
                const jitter = Math.random() * 5000;
                waitMs = RATE_LIMIT_BACKOFF_MS + jitter;
                strategy = `429 fixed wait ${Math.round(waitMs / 1000)}s (OAuth — no timing headers)`;
            } else {
                // 529 overloaded — transient, exponential backoff is appropriate
                waitMs = Math.min(
                    OVERLOAD_INITIAL_MS * Math.pow(2, attempt) +
                        Math.random() * 2000,
                    OVERLOAD_MAX_MS
                );
                strategy = `529 exponential backoff ${Math.round(waitMs / 1000)}s`;
            }

            console.warn(
                `[llm] ${resp.status} rate limited — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(waitMs / 1000)}s (${strategy})`
            );

            // Notify caller so they can update pipeline status
            opts?.onRetry?.({
                attempt: attempt + 1,
                maxRetries: MAX_RETRIES,
                waitMs,
                status: resp.status,
                headers: allHeaders
            });

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
    const {
        model = 'fast',
        maxTokens = 4096,
        temperature = 0.3,
        onRetry
    } = opts;
    const start = Date.now();

    try {
        const resp = await anthropicFetch(
            {
                model: MODEL_MAP[model],
                max_tokens: maxTokens,
                temperature,
                system: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }]
            },
            { onRetry }
        );

        const text = resp.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('');

        console.log(
            `[llm] ${MODEL_MAP[model]} call done in ${Date.now() - start}ms`
        );
        return text;
    } catch (err: any) {
        console.error(
            `[llm] call FAILED after ${Date.now() - start}ms:`,
            err.message
        );
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
    const {
        model = 'smart',
        maxTokens = 4096,
        temperature = 0.4,
        onRetry
    } = opts;
    const start = Date.now();

    try {
        const resp = await anthropicFetch(
            {
                model: MODEL_MAP[model],
                max_tokens: maxTokens,
                temperature,
                system: systemPrompt,
                messages
            },
            { onRetry }
        );

        const text = resp.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('');

        console.log(
            `[llm] chat ${MODEL_MAP[model]} done in ${Date.now() - start}ms`
        );
        return text;
    } catch (err: any) {
        console.error(
            `[llm] chat FAILED after ${Date.now() - start}ms:`,
            err.message
        );
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
