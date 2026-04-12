import {
    Brain,
    ArrowLeft,
    Download,
    Zap,
    MessageSquare,
    GitBranch,
    FileText,
    ShieldCheck,
    Activity,
    Waypoints,
    Layers,
    ClipboardList
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import {
    Outlet,
    useParams,
    useNavigate,
    useLocation,
    Navigate,
    NavLink
} from 'react-router';

import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';

import type { OntologicaContext } from './context';
import type { OntologicaProject } from './OntologicaPage';

const TABS = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'graph', label: 'Graph', icon: GitBranch },
    { id: 'force-graph', label: 'Force Graph', icon: Waypoints },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'review', label: 'Review', icon: ShieldCheck },
    { id: 'pipeline', label: 'Pipeline', icon: Activity },
    { id: 'proposals', label: 'Proposals', icon: ClipboardList },
    { id: 'layers', label: 'Layers', icon: Layers }
] as const;

export function ProjectLayout() {
    const { projectId: rawId } = useParams<{ projectId: string }>();
    const projectId = Number(rawId);
    const navigate = useNavigate();
    const location = useLocation();

    const [project, setProject] = useState<OntologicaProject | null>(null);
    const [nodes, setNodes] = useState<any[]>([]);
    const [edges, setEdges] = useState<any[]>([]);
    const [docs, setDocs] = useState<any[]>([]);
    const [jobs, setJobs] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [layers, setLayers] = useState<any[]>([]);
    const [extracting, setExtracting] = useState(false);
    const [proposalsPending, setProposalsPending] = useState(0);

    const loadProject = useCallback(async () => {
        const res = await fetch(`/app/api/ontologica/projects/${projectId}`);
        if (res.ok) setProject(await res.json());
    }, [projectId]);

    const loadGraph = useCallback(async () => {
        const [nRes, eRes] = await Promise.all([
            fetch(`/app/api/ontologica/projects/${projectId}/nodes`),
            fetch(`/app/api/ontologica/projects/${projectId}/edges`)
        ]);
        if (nRes.ok) setNodes(await nRes.json());
        if (eRes.ok) setEdges(await eRes.json());
    }, [projectId]);

    const loadDocs = useCallback(async () => {
        const res = await fetch(
            `/app/api/ontologica/projects/${projectId}/documents`
        );
        if (res.ok) setDocs(await res.json());
    }, [projectId]);

    const loadJobs = useCallback(async () => {
        const res = await fetch(
            `/app/api/ontologica/projects/${projectId}/jobs`
        );
        if (res.ok) setJobs(await res.json());
    }, [projectId]);

    const loadStats = useCallback(async () => {
        const res = await fetch(
            `/app/api/ontologica/projects/${projectId}/stats`
        );
        if (res.ok) setStats(await res.json());
    }, [projectId]);

    const loadLayers = useCallback(async () => {
        const res = await fetch(
            `/app/api/ontologica/projects/${projectId}/layers`
        );
        if (res.ok) setLayers(await res.json());
    }, [projectId]);

    const loadProposalCount = useCallback(async () => {
        const res = await fetch(
            `/app/api/ontologica/projects/${projectId}/proposals?status=pending`
        );
        if (res.ok) {
            const data = await res.json();
            setProposalsPending(data.length);
        }
    }, [projectId]);

    useEffect(() => {
        loadProject();
        loadGraph();
        loadDocs();
        loadJobs();
        loadStats();
        loadLayers();
        loadProposalCount();
    }, [
        loadProject,
        loadGraph,
        loadDocs,
        loadJobs,
        loadStats,
        loadLayers,
        loadProposalCount
    ]);

    // Poll jobs while any are running
    useEffect(() => {
        const hasRunning = jobs.some(
            j => j.status === 'queued' || j.status === 'running'
        );
        if (!hasRunning) return;
        const interval = setInterval(() => {
            loadJobs();
            loadGraph();
            loadStats();
        }, 3000);
        return () => clearInterval(interval);
    }, [jobs, loadJobs, loadGraph, loadStats]);

    const navigateToTab = useCallback(
        (tab: string) => {
            navigate(`/ontologica/${projectId}/${tab}`);
        },
        [navigate, projectId]
    );

    const extractAll = useCallback(async () => {
        setExtracting(true);
        const res = await fetch(
            `/app/api/ontologica/projects/${projectId}/extract`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            }
        );
        if (res.ok) {
            loadJobs();
            navigateToTab('pipeline');
        }
        setExtracting(false);
    }, [projectId, loadJobs, navigateToTab]);

    const extractDocument = useCallback(
        async (docId: number) => {
            await fetch(`/app/api/ontologica/projects/${projectId}/extract`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ document_id: docId })
            });
            loadJobs();
            navigateToTab('pipeline');
        },
        [projectId, loadJobs, navigateToTab]
    );

    const handleExport = () => {
        window.open(
            `/app/api/ontologica/projects/${projectId}/export?format=turtle`,
            '_blank'
        );
    };

    const pendingCount = stats?.pendingReview
        ? stats.pendingReview.nodes + stats.pendingReview.edges
        : 0;

    // If we're at /ontologica/:projectId with no sub-route, redirect to /chat
    const isExactProjectPath =
        location.pathname === `/ontologica/${projectId}` ||
        location.pathname === `/ontologica/${projectId}/`;
    if (isExactProjectPath) {
        return <Navigate to="chat" replace />;
    }

    const ctx: OntologicaContext = {
        projectId,
        project,
        nodes,
        edges,
        docs,
        jobs,
        stats,
        layers,
        extracting,
        loadProject,
        loadGraph,
        loadDocs,
        loadJobs,
        loadStats,
        loadLayers,
        navigateToTab,
        extractAll,
        extractDocument
    };

    // Figure out active tab from the URL
    const pathSegments = location.pathname.split('/');
    const activeTab = pathSegments[3] || 'chat';

    return (
        <AppLayout
            icon={<Brain size={20} />}
            iconClassName="bg-emerald-500/10 text-emerald-500"
            title={project?.name || 'Loading...'}
            subtitle={
                project?.domain_hint
                    ? `Domain: ${project.domain_hint}`
                    : project?.description || ''
            }
            actions={
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate('/ontologica')}
                    >
                        <ArrowLeft size={16} className="mr-1" /> Back
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExport}
                        disabled={nodes.length === 0}
                    >
                        <Download size={16} className="mr-1" /> Export OWL
                    </Button>
                    <Button
                        size="sm"
                        onClick={extractAll}
                        disabled={extracting || docs.length === 0}
                    >
                        <Zap size={16} className="mr-1" />
                        {extracting ? 'Starting...' : 'Extract All'}
                    </Button>
                </div>
            }
        >
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Tab bar */}
                <div className="px-6 border-b">
                    <nav className="flex gap-0 -mb-px">
                        {TABS.map(tab => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            let badge: React.ReactNode = null;

                            if (tab.id === 'graph')
                                badge = (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                        ({nodes.length})
                                    </span>
                                );
                            if (tab.id === 'documents')
                                badge = (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                        ({docs.length})
                                    </span>
                                );
                            if (tab.id === 'pipeline')
                                badge = (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                        ({jobs.length})
                                    </span>
                                );
                            if (
                                tab.id === 'proposals' &&
                                proposalsPending > 0
                            ) {
                                badge = (
                                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-violet-500/20 text-violet-400 rounded-full">
                                        {proposalsPending}
                                    </span>
                                );
                            }
                            if (tab.id === 'review' && pendingCount > 0) {
                                badge = (
                                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded-full">
                                        {pendingCount}
                                    </span>
                                );
                            }

                            return (
                                <NavLink
                                    key={tab.id}
                                    to={tab.id}
                                    replace
                                    className={`inline-flex items-center px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                                        isActive
                                            ? 'border-emerald-500 text-foreground'
                                            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                                    }`}
                                >
                                    <Icon size={14} className="mr-1.5" />
                                    {tab.label}
                                    {badge}
                                </NavLink>
                            );
                        })}
                    </nav>
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-hidden min-h-0 relative flex flex-col">
                    <Outlet context={ctx} />
                </div>
            </div>
        </AppLayout>
    );
}
