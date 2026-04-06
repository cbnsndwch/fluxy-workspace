/**
 * AnalyticsProvider — wraps the entire app and dispatches tracking events
 * to our own backend. Zero third-party tracking.
 *
 * Usage: wrap your root component with <AnalyticsProvider>.
 * In any child: const { trackEvent } = useTracking();
 */
import { useCallback } from "react";
import { track } from "@cbnsndwch/react-tracking";

// Session ID — stable per browser tab, regenerated on new tab
const SESSION_ID = (() => {
  const key = "analytics_session";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
})();

// Flush queue to backend — batched, fire-and-forget
const queue: object[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (!queue.length) return;
  const batch = queue.splice(0, queue.length);
  fetch("/app/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(batch),
  }).catch(() => {
    // Silently drop — analytics should never break the app
  });
}

function dispatch(data: object) {
  queue.push({ ...data, session_id: SESSION_ID });
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 800);
}

// Tracked root — all children inherit the tracking context
const TrackedApp = track(
  {},
  { dispatch },
)(function AnalyticsProviderInner({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
});

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  return <TrackedApp>{children}</TrackedApp>;
}

// Convenience hook for app-level tracking
export function useAppTracking(appId: string) {
  const trackPageView = useCallback(() => {
    dispatch({ app: appId, event: "pageview", page: appId });
  }, [appId]);

  const trackAction = useCallback(
    (event: string, meta?: Record<string, unknown>) => {
      dispatch({ app: appId, event, page: appId, meta });
    },
    [appId],
  );

  return { trackPageView, trackAction };
}
