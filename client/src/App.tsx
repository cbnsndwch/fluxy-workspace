// oxlint-disable no-console
import { useEffect, useState } from "react";
import { Outlet, redirect, useLoaderData } from "react-router";

import { useAuthStore, type AuthUser } from "./store/auth";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/Layout/DashboardLayout";
import { WorkspaceExtensionsProvider } from "./lib/workspaceExtensions";

// ── Loader ─────────────────────────────────────────────────────────────────────
// Runs before the layout renders. Checks auth + loads settings.
// Any redirect thrown here is handled by react-router automatically.
export async function rootLoader({ request }: { request: Request }) {
  const url = new URL(request.url);

  // Capture the session token embedded in the redirect URL after GitHub OAuth.
  // The token is stored in localStorage so the fetch interceptor (main.tsx) can
  // attach it as an Authorization header — necessary because the WS proxy never
  // forwards browser cookies.
  const inboundToken = url.searchParams.get("_t");
  if (inboundToken) {
    localStorage.setItem("session_token", inboundToken);
    url.searchParams.delete("_t");
    throw redirect(url.pathname + (url.search || ""));
  }

  const authError = url.searchParams.get("auth_error");

  // Explicitly pass the stored token in case the fetch interceptor hasn't
  // wrapped the WS proxy yet at this point in the load sequence.
  const token = localStorage.getItem("session_token");
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const [authRes, settingsRes] = await Promise.allSettled([
    fetch("/app/api/auth/me", { headers: authHeaders }),
    fetch("/app/api/settings"),
  ]);

  const user: AuthUser | null =
    authRes.status === "fulfilled" && authRes.value.ok ? await authRes.value.json() : null;

  if (!user) {
    throw redirect(authError ? "/login?auth_error=1" : "/login");
  }

  const settings: { onboard_complete: string } | null =
    settingsRes.status === "fulfilled" && settingsRes.value.ok
      ? await settingsRes.value.json()
      : null;

  return { user, settings };
}

// ── Error fallback ─────────────────────────────────────────────────────────────
export function DashboardError() {
  return (
    <div
      style={{
        background: "#222122",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100dvh",
        width: "100vw",
        position: "fixed",
        inset: 0,
        zIndex: 50,
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: "center",
        padding: "24px",
      }}
    >
      <video
        src="/fluxy_say_hi.webm"
        autoPlay
        loop
        muted
        playsInline
        style={{
          height: 120,
          width: 120,
          borderRadius: "50%",
          objectFit: "cover",
          marginBottom: 32,
        }}
      />
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Your app crashed</h1>
      <p
        style={{
          fontSize: 14,
          color: "rgba(255,255,255,0.5)",
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        Ask the agent to fix it using the chat.
      </p>
    </div>
  );
}

// ── Root Layout ────────────────────────────────────────────────────────────────
// Rendered once the loader succeeds (user is authenticated).
// Handles: DashboardLayout shell, onboarding iframe, rebuild overlay, HMR messages.
export default function RootLayout() {
  const { user, settings } = useLoaderData() as {
    user: AuthUser;
    settings: { onboard_complete: string } | null;
  };
  const { setUser, setLoading } = useAuthStore();

  const [showOnboard, setShowOnboard] = useState(settings?.onboard_complete !== "true");
  const [rebuildState, setRebuildState] = useState<"idle" | "rebuilding" | "error">("idle");
  const [buildError, setBuildError] = useState("");

  // Sync loader user into Zustand so sidebar/avatar components can read it.
  // Legitimate: syncing loader data into an external store.
  useEffect(() => {
    setUser(user);
    setLoading(false);
  }, [user, setUser, setLoading]);

  // Listen for rebuild / HMR messages from the Fluxy iframe.
  // Legitimate: subscribing to external DOM events (postMessage).
  useEffect(() => {
    let safetyTimer: ReturnType<typeof setTimeout>;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "fluxy:rebuilding") {
        setRebuildState("rebuilding");
        setBuildError("");
        clearTimeout(safetyTimer);
        safetyTimer = setTimeout(() => location.reload(), 60_000);
      } else if (e.data?.type === "fluxy:rebuilt") {
        clearTimeout(safetyTimer);
        setRebuildState("idle");
        location.reload();
      } else if (e.data?.type === "fluxy:build-error") {
        clearTimeout(safetyTimer);
        setRebuildState("error");
        setBuildError(e.data.error || "Build failed");
        setTimeout(() => setRebuildState("idle"), 5000);
      } else if (e.data?.type === "fluxy:onboard-complete") {
        setShowOnboard(false);
      } else if (e.data?.type === "fluxy:hmr-update") {
        console.log("[dashboard] File changed — Vite HMR will handle it");
      }
    };
    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      clearTimeout(safetyTimer);
    };
  }, []);

  return (
    <>
      <ErrorBoundary fallback={<DashboardError />}>
        <WorkspaceExtensionsProvider>
          <DashboardLayout>
            <Outlet />
          </DashboardLayout>
        </WorkspaceExtensionsProvider>
      </ErrorBoundary>

      {showOnboard ? (
        <iframe
          title="Onboarding"
          src="/fluxy/onboard.html"
          style={{
            position: "fixed",
            inset: 0,
            width: "100vw",
            height: "100dvh",
            border: "none",
            zIndex: 200,
          }}
        />
      ) : null}

      {rebuildState !== "idle" ? (
        <div className="fixed inset-0 z-49 flex flex-col items-center justify-center bg-background/90">
          <video
            src="/fluxy_tilts.webm"
            autoPlay
            loop
            muted
            playsInline
            className="h-24 w-24 rounded-full object-cover"
          />
          <p className="mt-4 text-sm text-muted-foreground">
            {rebuildState === "rebuilding" ? "Rebuilding app..." : buildError}
          </p>
        </div>
      ) : null}
    </>
  );
}
