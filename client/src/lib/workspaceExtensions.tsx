import { createContext, useContext, type ReactNode } from "react";
import { useLocation } from "react-router";
import { APPS } from "@/lib/appRegistry";
import { ReportIssueAction } from "@/components/WorkspaceIssues/ReportIssueAction";

/**
 * Workspace Extensions — decoupled composition layer.
 *
 * This module lets the workspace framework inject functionality into app headers
 * without creating dependencies between individual apps.
 *
 * Architecture:
 *   - WorkspaceExtensionsProvider  wraps the root layout (App.tsx)
 *   - AppLayout                    consumes the context via useWorkspaceExtensions()
 *   - Individual apps              never import from each other
 *
 * The framework (this file) is the only place that knows about cross-app features.
 * To add a new workspace-wide header action, register it here.
 */

// ── Context ─────────────────────────────────────────────────────────────────────
interface WorkspaceExtensionsValue {
  /** Extra action nodes injected into the current app's header by the workspace framework */
  headerActions: ReactNode;
}

const WorkspaceExtensionsContext = createContext<WorkspaceExtensionsValue>({
  headerActions: null,
});

export function useWorkspaceExtensions() {
  return useContext(WorkspaceExtensionsContext);
}

// ── Route → App resolver ─────────────────────────────────────────────────────────
function useCurrentApp() {
  const { pathname } = useLocation();
  return APPS.find((a) => pathname === a.path || pathname.startsWith(a.path + "/")) ?? null;
}

// ── Provider ─────────────────────────────────────────────────────────────────────
export function WorkspaceExtensionsProvider({ children }: { children: ReactNode }) {
  const app = useCurrentApp();

  // Build the set of workspace-injected header actions for the current app.
  // Add future cross-app actions here (e.g. a "Bookmark" button, a "Share" button).
  //
  // The Issues app is excluded — it already has its own "New issue" button.
  const headerActions = app && app.id !== "issues" ? <ReportIssueAction appId={app.id} /> : null;

  return (
    <WorkspaceExtensionsContext.Provider value={{ headerActions }}>
      {children}
    </WorkspaceExtensionsContext.Provider>
  );
}
