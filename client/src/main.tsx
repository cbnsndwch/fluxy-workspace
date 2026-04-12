import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';

import { AnalyticsProvider } from './apps/Analytics/AnalyticsProvider';
import { queryClient } from './lib/queryClient';
import { router } from './router';
import './styles/globals.css';

// ── Auth token injection ────────────────────────────────────────────────────
// The WebSocket API proxy (app-ws.js) only forwards headers from init.headers —
// it never forwards browser cookies. We store the session token in localStorage
// and inject it as an Authorization header so WS-proxied requests authenticate.
//
// TIMING PROBLEM: app-ws.js is injected dynamically by widget.js, which runs as
// a regular blocking <script> AFTER main.tsx (a deferred module). Depending on
// load order, app-ws.js may replace window.fetch AFTER our interceptor is
// installed, effectively evicting it.
//
// FIX: Use Object.defineProperty with a getter/setter. When app-ws.js (or
// anything else) does `window.fetch = ws_proxy`, we intercept the assignment and
// update our "upstream" reference instead of losing the wrapper entirely.
// window.fetch always returns our authFetch, which calls whichever upstream
// was most recently installed — so the chain is always correct:
//   authFetch → (latest upstream, e.g. ws_proxy) → backend
(function installAuthInterceptor() {
    let upstream: typeof window.fetch = window.fetch.bind(window);

    function authFetch(
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> {
        const url =
            typeof input === 'string'
                ? input
                : input instanceof Request
                  ? input.url
                  : String(input);

        if (url.includes('/app/api')) {
            const token = localStorage.getItem('session_token');
            if (token) {
                const headers = new Headers(init?.headers || {});
                if (!headers.has('Authorization')) {
                    headers.set('Authorization', `Bearer ${token}`);
                }
                init = { ...init, headers };
            }
        }

        return upstream(input, init);
    }

    // Replace window.fetch with a property whose setter updates our upstream
    // reference rather than replacing the wrapper itself.
    Object.defineProperty(window, 'fetch', {
        get() {
            return authFetch;
        },
        set(fn: typeof window.fetch) {
            // app-ws.js (and anything else) can "replace" window.fetch freely —
            // we just update what authFetch delegates to.
            upstream = fn;
        },
        configurable: true
    });
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <AnalyticsProvider>
                <RouterProvider router={router} />
                <Toaster
                    position="bottom-right"
                    theme="dark"
                    richColors
                    closeButton
                />
            </AnalyticsProvider>
        </QueryClientProvider>
    </React.StrictMode>
);
