import React from 'react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface AppLayoutProps {
    /** Icon element to render inside the colored badge */
    icon: ReactNode;
    /** Tailwind classes for the icon wrapper — e.g. "bg-violet-500/10 text-violet-500" */
    iconClassName?: string;
    /** App title — string or inline ReactNode for editable titles */
    title: React.ReactNode;
    /** Optional subtitle / status line below the title */
    subtitle?: ReactNode;
    /** Optional actions to render on the right side of the header */
    actions?: ReactNode;
    /** Page content — rendered in a flex-1 overflow-hidden container */
    children: ReactNode;
    className?: string;
}

/**
 * AppLayout — canonical app page wrapper.
 *
 * Structure:
 *   ┌──────────────────────────────────────────┐
 *   │ [icon]  Title                 [actions]  │  ← header (border-b)
 *   │         subtitle                         │
 *   ├──────────────────────────────────────────┤
 *   │                                          │
 *   │  children  (flex-1, overflow-hidden)     │
 *   │                                          │
 *   └──────────────────────────────────────────┘
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
    return (
        <div className={cn('flex flex-col h-full', className)}>
            {/* ── Header ──────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 flex-shrink-0">
                <div className={cn('p-2.5 rounded-lg flex-shrink-0', iconClassName)}>
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <h1 className="text-lg font-semibold leading-tight">{title}</h1>
                    {subtitle && (
                        <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
                    )}
                </div>
                {actions && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {actions}
                    </div>
                )}
            </div>

            {/* ── Content ─────────────────────────────────────────────── */}
            <div className="flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
