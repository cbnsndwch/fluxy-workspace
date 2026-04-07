import { createBrowserRouter, Navigate } from 'react-router';

import RootLayout, { rootLoader, DashboardError } from './App';
import LoginPage from './components/Login/LoginPage';

import AppIdeasPage from './components/AppIdeas/AppIdeasPage';
import DashboardPage, { loader as dashboardLoader } from './components/Dashboard/DashboardPage';
import DBViewerPage, { loader as dbViewerLoader } from './components/DBViewer/DBViewerPage';
import DeepResearchPage, { loader as deepResearchLoader } from './components/DeepResearch/DeepResearchPage';
import DocsPage, { loader as docsLoader } from './components/Docs/DocsPage';
import ImageGenPage, { loader as imageGenLoader } from './components/ImageGen/ImageGenPage';
import UserManagementPage, { loader as usersLoader } from './components/UserManagement/UserManagementPage';
import WorkflowsPage, { loader as workflowsLoader } from './components/Workflows/WorkflowsPage';
import WorkspaceIssuesPage, { loader as issuesLoader } from './components/WorkspaceIssues/WorkspaceIssuesPage';
import MarketplacePage from './components/Marketplace/MarketplacePage';
import AnalyticsPage from './components/Analytics/AnalyticsPage';
import FlowCapturePage from './components/FlowCapture/FlowCapturePage';
import FlowCaptureListPage from './components/FlowCapture/FlowCaptureListPage';
import SharedReportPage from './components/DeepResearch/SharedReportPage';
import GitViewerPage from './components/GitViewer/GitViewerPage';
import MarbleStudioPage, {
    MarbleStudioIndexRoute,
    MarbleStudioNewRoute,
    MarbleStudioSettingsRoute,
    MarbleStudioWorldRoute,
} from './components/MarbleStudio/MarbleStudioPage';

export const router = createBrowserRouter([
    {
        // Unauthenticated route — no loader required
        path: '/login',
        element: <LoginPage />,
    },
    {
        path: '/share/:token',
        element: <SharedReportPage />,
    },
    {
        // Authenticated shell — rootLoader gates access
        path: '/',
        element: <RootLayout />,
        loader: rootLoader,
        errorElement: <DashboardError />,
        children: [
            { index: true,              element: <DashboardPage />,       loader: dashboardLoader },
            { path: 'app-ideas',        element: <AppIdeasPage /> },
            { path: 'image-studio', children: [
                { index: true,              element: <Navigate to="canvas" replace /> },
                { path: ':viewMode',        element: <ImageGenPage />,        loader: imageGenLoader },
            ]},
            { path: 'issues', children: [
                { index: true,          element: <WorkspaceIssuesPage />, loader: issuesLoader },
                { path: ':issueId',     element: <WorkspaceIssuesPage />, loader: issuesLoader },
            ]},
            { path: 'db-viewer', children: [
                { index: true,              element: <DBViewerPage />,        loader: dbViewerLoader },
                { path: ':tableName',       element: <DBViewerPage />,        loader: dbViewerLoader },
            ]},
            { path: 'docs/*',           element: <DocsPage />,            loader: docsLoader },
            { path: 'workflows',        element: <WorkflowsPage />,       loader: workflowsLoader },
            { path: 'workflows/:id',    element: <WorkflowsPage /> },
            { path: 'users',            element: <UserManagementPage />,  loader: usersLoader },
            { path: 'deep-research',    element: <DeepResearchPage />,    loader: deepResearchLoader },
            { path: 'flow-capture',      children: [
                { index: true,               element: <FlowCaptureListPage /> },
                { path: ':sessionId',        element: <FlowCapturePage /> },
            ]},
            { path: 'marble-studio', element: <MarbleStudioPage />, children: [
                { index: true,                   element: <MarbleStudioIndexRoute /> },
                { path: 'new',                   element: <MarbleStudioNewRoute /> },
                { path: 'settings',              element: <MarbleStudioSettingsRoute /> },
                { path: 'worlds/:worldId',       element: <MarbleStudioWorldRoute /> },
            ]},
            { path: 'marketplace',      element: <MarketplacePage /> },
            { path: 'analytics',        element: <AnalyticsPage /> },
            { path: 'git-viewer', children: [
                { index: true,                      element: <Navigate to="log" replace /> },
                { path: 'log',                      element: <GitViewerPage /> },
                { path: 'log/uncommitted',          element: <GitViewerPage /> },
                { path: 'log/commit/:sha',          element: <GitViewerPage /> },
                { path: 'branches',                 element: <GitViewerPage /> },
                { path: 'worktrees',                element: <GitViewerPage /> },
            ]},
            { path: '*',                element: <Navigate to="/" /> },
        ],
    },
]);
