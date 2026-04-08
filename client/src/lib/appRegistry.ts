import {
    BarChart2,
    BookOpen,
    Database,
    FlaskConical,
    GitBranch,
    Globe2,
    History,
    ImageIcon,
    Images,
    Lightbulb,
    MessageSquarePlus,
    Music,
    Paperclip,
    ShieldCheck,
    Store,
    TriangleAlert,
    Workflow,
    type LucideIcon,
} from 'lucide-react';

export interface AppConfig {
    id: string;
    /** Full display name — used in dashboard cards and app headers */
    name: string;
    /** Short label for sidebar nav — defaults to name if omitted */
    navLabel?: string;
    description: string;
    icon: LucideIcon;
    /** Tailwind classes: 'bg-{color}-500/10 text-{color}-500' */
    color: string;
    path: string;
    /** Sidebar section. 'main' = top group, 'workspace' = bottom group under "Workspace" heading */
    section: 'main' | 'workspace';
}

/**
 * Single source of truth for all apps in the workspace.
 * Add an entry here when building a new app — never duplicate this data elsewhere.
 */
export const APPS: AppConfig[] = [
    {
        id: 'appideas',
        name: 'App Ideas',
        description: 'Canvas for planning and tracking app ideas',
        icon: Lightbulb,
        color: 'bg-violet-500/10 text-violet-500',
        path: '/app-ideas',
        section: 'main',
    },
    {
        id: 'imagegen',
        name: 'Image Studio',
        description: 'Generate images with DALL-E 3 & Imagen 4',
        icon: ImageIcon,
        color: 'bg-pink-500/10 text-pink-500',
        path: '/image-studio',
        section: 'main',
    },
    {
        id: 'workflows',
        name: 'Workflows',
        description: 'Build and run visual automation workflows',
        icon: Workflow,
        color: 'bg-orange-500/10 text-orange-500',
        path: '/workflows',
        section: 'main',
    },
    {
        id: 'flow-capture',
        name: 'Flow Capture',
        description: 'Speak your user flow — AI renders it as a live Mermaid diagram',
        icon: GitBranch,
        color: 'bg-purple-500/10 text-purple-500',
        path: '/flow-capture',
        section: 'main',
    },
    {
        id: 'deep-research',
        name: 'Deep Research',
        description: 'Web research engine — topics, reports & ongoing tracking',
        icon: FlaskConical,
        color: 'bg-cyan-500/10 text-cyan-500',
        path: '/deep-research',
        section: 'main',
    },
    {
        id: 'marble-studio',
        name: 'Marble Studio',
        description: 'Generate immersive 3D worlds with World Labs Marble AI',
        icon: Globe2,
        color: 'bg-green-500/10 text-green-500',
        path: '/marble-studio',
        section: 'main',
    },
    {
        id: 'users',
        name: 'User Management',
        navLabel: 'Users',
        description: 'Manage users, roles & app permissions',
        icon: ShieldCheck,
        color: 'bg-teal-500/10 text-teal-500',
        path: '/users',
        section: 'workspace',
    },
    {
        id: 'issues',
        name: 'Workspace Improvements',
        navLabel: 'Improvements',
        description: 'Collect issues, track work, document fixes',
        icon: TriangleAlert,
        color: 'bg-amber-500/10 text-amber-500',
        path: '/issues',
        section: 'workspace',
    },
    {
        id: 'dbviewer',
        name: 'DB Viewer',
        description: 'Browse and manage SQLite tables',
        icon: Database,
        color: 'bg-emerald-500/10 text-emerald-500',
        path: '/db-viewer',
        section: 'workspace',
    },
    {
        id: 'docs',
        name: 'Docs',
        description: 'Author and browse workspace documentation',
        icon: BookOpen,
        color: 'bg-sky-500/10 text-sky-500',
        path: '/docs',
        section: 'workspace',
    },
    {
        id: 'marketplace',
        name: 'App Marketplace',
        navLabel: 'Marketplace',
        description: 'Bundle & sell your apps to other Fluxy users',
        icon: Store,
        color: 'bg-rose-500/10 text-rose-500',
        path: '/marketplace',
        section: 'workspace',
    },
    {
        id: 'analytics',
        name: 'Analytics',
        description: 'Usage insights and activity across all apps',
        icon: BarChart2,
        color: 'bg-indigo-500/10 text-indigo-500',
        path: '/analytics',
        section: 'workspace',
    },
    {
        id: 'git-viewer',
        name: 'Workspace Versions',
        navLabel: 'Versions',
        description: 'Read-only git history — commits, branches, worktrees & uncommitted changes',
        icon: History,
        color: 'bg-lime-500/10 text-lime-500',
        path: '/git-viewer',
        section: 'workspace',
    },
    {
        id: 'uploads',
        name: 'Uploads',
        description: 'Browse all files uploaded via chat — images and documents',
        icon: Paperclip,
        color: 'bg-blue-500/10 text-blue-500',
        path: '/uploads',
        section: 'workspace',
    },
    {
        id: 'icebreaker',
        name: 'Hack Night Icebreakers',
        navLabel: 'Icebreakers',
        description: 'AI-generated conversation starters from live tech headlines',
        icon: MessageSquarePlus,
        color: 'bg-red-500/10 text-red-500',
        path: '/icebreaker',
        section: 'main',
    },
    {
        id: 'musicologia',
        name: 'Musicologia',
        description: 'Track library with DNA stats, lore, and lyrics',
        icon: Music,
        color: 'bg-purple-500/10 text-purple-500',
        path: '/musicologia',
        section: 'main',
    },
];

export const mainApps = APPS.filter((a) => a.section === 'main');
export const workspaceApps = APPS.filter((a) => a.section === 'workspace');
