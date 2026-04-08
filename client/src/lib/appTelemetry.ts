/**
 * appTelemetry — opt-in SDK for error reporting and usage telemetry.
 *
 * Apps installed from the Fluxy Marketplace can call these functions to
 * report errors and events back to the marketplace owner. All functions
 * are silent no-ops when the workspace owner has not opted in — they
 * never throw, never block, and never affect app behaviour.
 *
 * Usage (in any app component):
 *
 *   import { reportError, trackEvent } from '@/lib/appTelemetry';
 *
 *   // In an error boundary or catch block:
 *   reportError('my-app', error, { userId, action: 'save' });
 *
 *   // For usage events:
 *   trackEvent('my-app', 'contact.created', { method: 'manual' });
 */

interface TelemetrySettings {
    error_tracking_enabled: boolean;
    telemetry_enabled: boolean;
    workspace_id: string;
}

// Simple in-memory cache — settings are stable for a session
let cachedSettings: TelemetrySettings | null = null;
let settingsFetchPromise: Promise<TelemetrySettings> | null = null;

async function fetchSettings(): Promise<TelemetrySettings> {
    if (cachedSettings) return cachedSettings;
    if (settingsFetchPromise) return settingsFetchPromise;

    settingsFetchPromise = fetch('/app/api/marketplace/settings')
        .then(r => (r.ok ? r.json() : null))
        .then((data: TelemetrySettings | null) => {
            cachedSettings = data ?? {
                error_tracking_enabled: false,
                telemetry_enabled: false,
                workspace_id: 'unknown',
            };
            settingsFetchPromise = null;
            return cachedSettings;
        })
        .catch(() => {
            settingsFetchPromise = null;
            return {
                error_tracking_enabled: false,
                telemetry_enabled: false,
                workspace_id: 'unknown',
            };
        });

    return settingsFetchPromise;
}

/** Invalidate the cached settings (e.g. after the user changes opt-in settings). */
export function invalidateTelemetryCache() {
    cachedSettings = null;
    settingsFetchPromise = null;
}

/**
 * Report an error from an installed app back to the marketplace owner.
 * No-op if error tracking is not enabled by the workspace owner.
 *
 * @param appId     — The app's marketplace ID (e.g. "crm", "deep-research")
 * @param error     — The error object (or any Error-like object)
 * @param context   — Optional additional context (user action, record ID, etc.)
 */
export async function reportError(
    appId: string,
    error: Error | unknown,
    context?: Record<string, unknown>,
): Promise<void> {
    try {
        const settings = await fetchSettings();
        if (!settings.error_tracking_enabled) return;

        const err = error instanceof Error ? error : new Error(String(error));

        await fetch('/app/api/marketplace/report-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appId,
                workspaceId: settings.workspace_id,
                errorMessage: err.message,
                errorStack: err.stack,
                context,
            }),
        });
    } catch {
        // Never throw from telemetry — it must be invisible to the app
    }
}

/**
 * Track a usage event from an installed app.
 * No-op if telemetry is not enabled by the workspace owner.
 *
 * @param appId      — The app's marketplace ID
 * @param eventType  — Dot-namespaced event name (e.g. "contact.created", "report.generated")
 * @param payload    — Optional structured data about the event
 */
export async function trackEvent(
    appId: string,
    eventType: string,
    payload?: Record<string, unknown>,
): Promise<void> {
    try {
        const settings = await fetchSettings();
        if (!settings.telemetry_enabled) return;

        await fetch('/app/api/marketplace/telemetry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appId,
                workspaceId: settings.workspace_id,
                eventType,
                payload,
            }),
        });
    } catch {
        // Never throw from telemetry
    }
}
