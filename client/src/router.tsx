import { createBrowserRouter } from 'react-router';

import RootLayout, { DashboardError, rootLoader } from './App';

import AnalyticsPage from './components/Analytics/AnalyticsPage';
import AppIdeasPage from './components/AppIdeas/AppIdeasPage';
import DashboardPage, {
    loader as dashboardLoader,
} from './components/Dashboard/DashboardPage';
import DBViewerPage, {
    loader as dbViewerLoader,
} from './components/DBViewer/DBViewerPage';
import DeepResearchPage, {
    loader as deepResearchLoader,
} from './components/DeepResearch/DeepResearchPage';
import SharedReportPage from './components/DeepResearch/SharedReportPage';
import DocsPage, { loader as docsLoader } from './components/Docs/DocsPage';
import FlowCaptureListPage from './components/FlowCapture/FlowCaptureListPage';
import FlowCapturePage from './components/FlowCapture/FlowCapturePage';
import GitViewerPage from './components/GitViewer/GitViewerPage';
import IcebreakerPage from './components/Icebreaker/IcebreakerPage';
import MusicologiaAdminPage from './components/Musicologia/MusicologiaAdminPage';
import MusicologiaPage from './components/Musicologia/MusicologiaPage';
import MusicologiaTrackPage from './components/Musicologia/MusicologiaTrackPage';
import ImmersivePlayer from './components/Musicologia/ImmersivePlayer';
import ImageGenPage, {
    loader as imageGenLoader,
} from './components/ImageGen/ImageGenPage';
import UploadsPage from './components/ImageViewer/ImageViewerPage';
import LoginPage from './components/Login/LoginPage';
import MarbleStudioPage, {
    MarbleStudioIndexRoute,
    MarbleStudioNewRoute,
    MarbleStudioSettingsRoute,
    MarbleStudioWorldRoute,
} from './components/MarbleStudio/MarbleStudioPage';
import MarketplacePage from './components/Marketplace/MarketplacePage';
import SchedulesPage from './components/Schedules/SchedulesPage';
import { redirectTo } from './components/RedirectTo';
import UserManagementPage, {
    loader as usersLoader,
} from './components/UserManagement/UserManagementPage';
import WorkflowsPage, {
    loader as workflowsLoader,
} from './components/Workflows/WorkflowsPage';
import WorkspaceIssuesPage, {
    loader as issuesLoader,
} from './components/WorkspaceIssues/WorkspaceIssuesPage';

export const router = createBrowserRouter([
    {
        // Unauthenticated route — no loader required
        path: '/login',
        Component: LoginPage,
    },
    {
        path: '/share/:token',
        Component: SharedReportPage,
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
                loader: dashboardLoader,
            },
            { path: 'app-ideas', Component: AppIdeasPage },
            {
                path: 'image-studio',
                children: [
                    {
                        index: true,
                        Component: redirectTo('canvas', /* replace */ true),
                    },
                    {
                        path: ':viewMode',
                        Component: ImageGenPage,
                        loader: imageGenLoader,
                    },
                ],
            },
            {
                path: 'issues',
                children: [
                    {
                        index: true,
                        Component: WorkspaceIssuesPage,
                        loader: issuesLoader,
                    },
                    {
                        path: ':issueId',
                        Component: WorkspaceIssuesPage,
                        loader: issuesLoader,
                    },
                ],
            },
            {
                path: 'db-viewer',
                children: [
                    {
                        index: true,
                        Component: DBViewerPage,
                        loader: dbViewerLoader,
                    },
                    {
                        path: ':tableName',
                        Component: DBViewerPage,
                        loader: dbViewerLoader,
                    },
                ],
            },
            { path: 'docs/*', Component: DocsPage, loader: docsLoader },
            {
                path: 'workflows',
                Component: WorkflowsPage,
                loader: workflowsLoader,
            },
            { path: 'workflows/:id', Component: WorkflowsPage },
            {
                path: 'users',
                Component: UserManagementPage,
                loader: usersLoader,
            },
            {
                path: 'deep-research',
                Component: DeepResearchPage,
                loader: deepResearchLoader,
            },
            {
                path: 'flow-capture',
                children: [
                    { index: true, Component: FlowCaptureListPage },
                    { path: ':sessionId', Component: FlowCapturePage },
                ],
            },
            {
                path: 'marble-studio',
                Component: MarbleStudioPage,
                children: [
                    { index: true, Component: MarbleStudioIndexRoute },
                    { path: 'new', Component: MarbleStudioNewRoute },
                    {
                        path: 'settings',
                        Component: MarbleStudioSettingsRoute,
                    },
                    {
                        path: 'worlds/:worldId',
                        Component: MarbleStudioWorldRoute,
                    },
                ],
            },
            { path: 'marketplace', Component: MarketplacePage },
            { path: 'analytics', Component: AnalyticsPage },
            {
                path: 'git-viewer',
                children: [
                    {
                        index: true,
                        Component: redirectTo('log', /* replace */ true),
                    },
                    { path: 'log', Component: GitViewerPage },
                    { path: 'log/uncommitted', Component: GitViewerPage },
                    { path: 'log/commit/:sha', Component: GitViewerPage },
                    { path: 'branches', Component: GitViewerPage },
                    { path: 'worktrees', Component: GitViewerPage },
                ],
            },
            { path: 'uploads', Component: UploadsPage },
            { path: 'icebreaker', Component: IcebreakerPage },
            {
                path: 'musicologia',
                children: [
                    { index: true, Component: MusicologiaPage },
                    { path: 'admin', Component: MusicologiaAdminPage },
                    { path: 'tracks/:artistSlug/:trackSlug', Component: ImmersivePlayer },
                    { path: 'tracks-classic/:artistSlug/:trackSlug', Component: MusicologiaTrackPage },
                ],
            },
            { path: 'schedules', Component: SchedulesPage },
            { path: '*', Component: redirectTo('/') },
        ],
    },
]);
