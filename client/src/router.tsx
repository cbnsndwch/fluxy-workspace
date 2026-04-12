import { createBrowserRouter } from 'react-router';

import AnalyticsPage from './apps/Analytics/AnalyticsPage';
import AppIdeasPage from './apps/AppIdeas/AppIdeasPage';
import DashboardPage, {
    loader as dashboardLoader
} from './apps/Dashboard/DashboardPage';
import DBViewerPage, {
    loader as dbViewerLoader
} from './apps/DBViewer/DBViewerPage';
import DeepResearchPage, {
    loader as deepResearchLoader
} from './apps/DeepResearch/DeepResearchPage';
import SharedReportPage from './apps/DeepResearch/SharedReportPage';
import DocsPage, { loader as docsLoader } from './apps/Docs/DocsPage';
import FlowCaptureListPage from './apps/FlowCapture/FlowCaptureListPage';
import FlowCapturePage from './apps/FlowCapture/FlowCapturePage';
import GitViewerPage from './apps/GitViewer/GitViewerPage';
import IcebreakerPage from './apps/Icebreaker/IcebreakerPage';
import ImageGenPage, {
    loader as imageGenLoader
} from './apps/ImageGen/ImageGenPage';
import UploadsPage from './apps/ImageViewer/ImageViewerPage';
import MarbleStudioPage, {
    MarbleStudioIndexRoute,
    MarbleStudioNewRoute,
    MarbleStudioSettingsRoute,
    MarbleStudioWorldRoute
} from './apps/MarbleStudio/MarbleStudioPage';
import MarketplacePage from './apps/Marketplace/MarketplacePage';
import ImmersivePlayer from './apps/Musicologia/ImmersivePlayer';
import MusicologiaAdminPage from './apps/Musicologia/MusicologiaAdminPage';
import MusicologiaFeedPage from './apps/Musicologia/MusicologiaFeedPage';
import MusicologiaPage from './apps/Musicologia/MusicologiaPage';
import MusicologiaTrackPage from './apps/Musicologia/MusicologiaTrackPage';
import { ChatTab } from './apps/Ontologica/ChatTab';
import CommonsPage from './apps/Ontologica/CommonsPage';
import OntologicaPage from './apps/Ontologica/OntologicaPage';
import { OntologyGraph } from './apps/Ontologica/OntologyGraph';
import { ProjectLayout } from './apps/Ontologica/ProjectLayout';
import { DocumentsTab } from './apps/Ontologica/Tabs/DocumentsTab';
import { ForceGraphTab } from './apps/Ontologica/Tabs/ForceGraphTab';
import { JobsTab } from './apps/Ontologica/Tabs/JobsTab';
import LayersTab from './apps/Ontologica/Tabs/LayersTab';
import { ProposalsTab } from './apps/Ontologica/Tabs/ProposalsTab';
import { ReviewTab } from './apps/Ontologica/Tabs/ReviewTab';
import SchedulesPage from './apps/Schedules/SchedulesPage';
import UserManagementPage, {
    loader as usersLoader
} from './apps/UserManagement/UserManagementPage';
import WorkflowsPage, {
    loader as workflowsLoader
} from './apps/Workflows/WorkflowsPage';
import WorkspaceIssuesPage, {
    loader as issuesLoader
} from './apps/WorkspaceIssues/WorkspaceIssuesPage';
import LoginPage from './components/Login/LoginPage';
import { redirectTo } from './components/RedirectTo';
import RootLayout, { DashboardError, rootLoader } from './RootLayout';

export const router = createBrowserRouter([
    {
        // Unauthenticated route — no loader required
        path: '/login',
        Component: LoginPage
    },
    {
        path: '/share/:token',
        Component: SharedReportPage
    },
    {
        // Authenticated shell — rootLoader gates access
        path: '/',
        Component: RootLayout,
        loader: rootLoader,
        ErrorBoundary: DashboardError,
        children: [
            {
                index: true,
                Component: DashboardPage,
                loader: dashboardLoader
            },
            { path: 'app-ideas', Component: AppIdeasPage },
            {
                path: 'image-studio',
                children: [
                    {
                        index: true,
                        Component: redirectTo('canvas', /* replace */ true)
                    },
                    {
                        path: ':viewMode',
                        Component: ImageGenPage,
                        loader: imageGenLoader
                    }
                ]
            },
            {
                path: 'issues',
                children: [
                    {
                        index: true,
                        Component: WorkspaceIssuesPage,
                        loader: issuesLoader
                    },
                    {
                        path: ':issueId',
                        Component: WorkspaceIssuesPage,
                        loader: issuesLoader
                    }
                ]
            },
            {
                path: 'db-viewer',
                children: [
                    {
                        index: true,
                        Component: DBViewerPage,
                        loader: dbViewerLoader
                    },
                    {
                        path: ':tableName',
                        Component: DBViewerPage,
                        loader: dbViewerLoader
                    }
                ]
            },
            { path: 'docs/*', Component: DocsPage, loader: docsLoader },
            {
                path: 'workflows',
                Component: WorkflowsPage,
                loader: workflowsLoader
            },
            { path: 'workflows/:id', Component: WorkflowsPage },
            {
                path: 'users',
                Component: UserManagementPage,
                loader: usersLoader
            },
            {
                path: 'deep-research',
                children: [
                    {
                        index: true,
                        Component: DeepResearchPage,
                        loader: deepResearchLoader
                    },
                    {
                        path: ':topicId',
                        Component: DeepResearchPage,
                        loader: deepResearchLoader
                    }
                ]
            },
            {
                path: 'flow-capture',
                children: [
                    { index: true, Component: FlowCaptureListPage },
                    { path: ':sessionId', Component: FlowCapturePage }
                ]
            },
            {
                path: 'marble-studio',
                Component: MarbleStudioPage,
                children: [
                    { index: true, Component: MarbleStudioIndexRoute },
                    { path: 'new', Component: MarbleStudioNewRoute },
                    {
                        path: 'settings',
                        Component: MarbleStudioSettingsRoute
                    },
                    {
                        path: 'worlds/:worldId',
                        Component: MarbleStudioWorldRoute
                    }
                ]
            },
            { path: 'marketplace', Component: MarketplacePage },
            { path: 'analytics', Component: AnalyticsPage },
            {
                path: 'git-viewer',
                children: [
                    {
                        index: true,
                        Component: redirectTo('log', /* replace */ true)
                    },
                    { path: 'log', Component: GitViewerPage },
                    { path: 'log/uncommitted', Component: GitViewerPage },
                    { path: 'log/commit/:sha', Component: GitViewerPage },
                    { path: 'branches', Component: GitViewerPage },
                    { path: 'worktrees', Component: GitViewerPage }
                ]
            },
            { path: 'uploads', Component: UploadsPage },
            { path: 'icebreaker', Component: IcebreakerPage },
            {
                path: 'musicologia',
                children: [
                    { index: true, Component: MusicologiaPage },
                    { path: 'feed', Component: MusicologiaFeedPage },
                    { path: 'admin', Component: MusicologiaAdminPage },
                    {
                        path: 'tracks/:artistSlug/:trackSlug',
                        Component: ImmersivePlayer
                    },
                    {
                        path: 'tracks-classic/:artistSlug/:trackSlug',
                        Component: MusicologiaTrackPage
                    }
                ]
            },
            { path: 'schedules', Component: SchedulesPage },
            { path: 'ontologica', Component: OntologicaPage },
            { path: 'ontologica/commons', Component: CommonsPage },
            {
                path: 'ontologica/:projectId',
                Component: ProjectLayout,
                children: [
                    { path: 'chat', Component: ChatTab },
                    { path: 'graph', Component: OntologyGraph },
                    { path: 'force-graph', Component: ForceGraphTab },
                    { path: 'documents', Component: DocumentsTab },
                    { path: 'review', Component: ReviewTab },
                    { path: 'pipeline', Component: JobsTab },
                    { path: 'layers', Component: LayersTab },
                    { path: 'proposals', Component: ProposalsTab }
                ]
            },
            { path: '*', Component: redirectTo('/') }
        ]
    }
]);
