import React, { type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { useWorkspaceExtensions } from '@/lib/workspaceExtensions';

interface AppLayoutProps {
    /** Icon element to render inside the colored badge */
    icon: ReactNode;
    /** Tailwind classes for the icon wrapper — e.g. "bg-violet-500/10 text-violet-500" */
    iconClassName?: string;
    /** App title — string or inline ReactNode for editable titles */
    title: React.ReactNode;
    /** Optional subtitle / status line below the title */
    subtitle?: ReactNode;
    /** Optional actions to render on the right side of the header (app-owned) */
    actions?: ReactNode;
    /** Page content — rendered in a flex-1 overflow-hidden container */
    children: ReactNode;
    className?: string;
}

/**
 * AppLayout — canonical app page wrapper.
 *
 * Structure:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ [icon]  Title            [workspace actions] │ [actions] │  ← header (border-b)
 *   │         subtitle                                         │
 *   ├──────────────────────────────────────────────────────────┤
 *   │                                                          │
 *   │  children  (flex-1, overflow-hidden)                     │
 *   │                                                          │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The header has two action slots:
 *   - `actions`         — app-owned buttons (e.g. "New Topic", "Export")
 *   - workspace slot    — framework-injected actions (e.g. "Report Issue")
 *                         populated via WorkspaceExtensionsProvider in the root layout
 *
 * Individual apps never need to know about workspace-injected actions.
 *
 * Use this as the default layout for all new apps unless the design explicitly
 * calls for something different (e.g. a full-canvas tool like Image Studio).
 */
export function AppLayout({
    icon,
    iconClassName,
    title,
    subtitle,
    actions,
    children,
    className,
}: AppLayoutProps) {
    // Workspace-injected actions (e.g. "Report Issue" button from the Issues app).
    // Returns null when the provider isn't present or when on the Issues page itself.
    const { headerActions } = useWorkspaceExtensions();

    const hasRightSection = headerActions || actions;

    return (
        <div className={cn('flex flex-col h-full', className)}>
            {/* ── Header ──────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 shrink-0">
                <div className={cn('p-2.5 rounded-lg shrink-0', iconClassName)}>
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <h1 className="text-lg font-semibold leading-tight">
                        {title}
                    </h1>
                    {subtitle && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                            {subtitle}
                        </div>
                    )}
                </div>
                {hasRightSection && (
                    <div className="flex items-center gap-2 shrink-0">
                        {/* App-owned actions */}
                        {actions}
                        {/* Visual separator when both slots are populated */}
                        {headerActions && actions && (
                            <div className="w-px h-5 rounded-full bg-border/60" />
                        )}
                        {/* Workspace-injected actions (framework slot) */}
                        {headerActions}
                    </div>
                )}
            </div>

            {/* ── Content ─────────────────────────────────────────────── */}
            <div className="flex-1 overflow-hidden flex flex-col">
                {children}
            </div>
        </div>
    );
}
