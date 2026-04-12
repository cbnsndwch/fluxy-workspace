/**
 * Shared LLM client for Ontologica
 *
 * Delegates to the global backend/llm.ts which uses Claude OAuth token
 * from ~/.claude/.credentials.json (Claude MAX subscription — no API key needed).
 */

import { llmCall, extractJSON, type RetryEvent } from '../../llm.js';

/**
 * Always available — uses OAuth token, not API key.
 */
export function isAvailable(): boolean {
    return true;
}

/**
 * Send a structured JSON prompt to Claude and parse the response.
 * Expects the model to return valid JSON.
 */
export async function jsonCompletion<T = any>(opts: {
    prompt: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    onRetry?: (event: RetryEvent) => void;
}): Promise<T> {
    const raw = await llmCall(
        'You are an ontology expert. Always respond with valid JSON only, no markdown fences or explanations.',
        opts.prompt,
        {
            model: 'fast',
            maxTokens: opts.maxTokens || 4096,
            temperature: opts.temperature ?? 0.1,
            onRetry: opts.onRetry
        }
    );

    const jsonStr = extractJSON(raw);
    return JSON.parse(jsonStr) as T;
}

/**
 * Simple text completion (non-JSON).
 */
export async function textCompletion(opts: {
    prompt: string;
    system?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    onRetry?: (event: RetryEvent) => void;
}): Promise<string> {
    return llmCall(opts.system || 'You are a helpful assistant.', opts.prompt, {
        model: 'fast',
        maxTokens: opts.maxTokens || 4096,
        temperature: opts.temperature ?? 0.3,
        onRetry: opts.onRetry
    });
}
