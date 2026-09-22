/**
 * App — routes.
 *
 * Every route from the plan is registered here. The workspace routes are
 * document-scoped; `WorkspaceLayout` resolves the :documentId, keeps the store's
 * active document in sync with the URL and renders "not found" states honestly
 * instead of silently redirecting.
 */

import { useEffect } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppProvider, useAppState, useAppStore } from './app/AppProvider.jsx';
import { AppShell } from './app/AppShell.jsx';
import { ErrorBoundary } from './app/ErrorBoundary.jsx';
import { ROUTES, routeBuilders } from './app/navigation.js';
import { Callout, Panel } from './components/ui/Panel.jsx';
import { Button } from './components/ui/Button.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { DocumentsPage } from './pages/DocumentsPage.jsx';
import { WorkspacePage } from './pages/WorkspacePage.jsx';
import { GraphPage } from './pages/GraphPage.jsx';
import { TimelinePage } from './pages/TimelinePage.jsx';
import { ComparePage } from './pages/ComparePage.jsx';
import { AskPage } from './pages/AskPage.jsx';
import { PreparePage } from './pages/PreparePage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

/** Keeps the store's active document aligned with the URL document id. */
function WorkspaceLayout() {
  const { documentId } = useParams();
  const state = useAppStore();
  const { selectDocument, loadDemoWorkspace } = useAppState();
  const isLoaded = Boolean(documentId && state.documents[documentId]);

  useEffect(() => {
    if (isLoaded && state.activeDocumentId !== documentId) selectDocument(documentId);
  }, [documentId, isLoaded, selectDocument, state.activeDocumentId]);

  if (isLoaded) {
    return (
      <Routes>
        <Route index element={<WorkspacePage />} />
        <Route path="graph" element={<GraphPage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="ask" element={<AskPage />} />
        <Route path="prepare" element={<PreparePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    );
  }

  return (
    <Panel title="This document is not loaded">
      <Callout tone="warning">
        <p>
          No parsed document matches this link. Documents live in memory for the current session, so
          a bookmarked workspace link stops working after a reload.
        </p>
      </Callout>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => loadDemoWorkspace()}>
          Load the demo agreement
        </Button>
        <Button onClick={() => window.location.assign(routeBuilders.documents())}>
          Go to documents
        </Button>
      </div>
    </Panel>
  );
}

/** Redirects workspace URLs without an id to the active document, or home. */
function WorkspaceRedirect() {
  const state = useAppStore();
  const target = state.activeDocumentId
    ? routeBuilders.workspace(state.activeDocumentId)
    : routeBuilders.documents();
  return <Navigate to={target} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path={ROUTES.home} element={<HomePage />} />
            <Route path={ROUTES.documents} element={<DocumentsPage />} />
            <Route path="/workspace" element={<WorkspaceRedirect />} />
            <Route path="/workspace/:documentId/*" element={<WorkspaceLayout />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AppProvider>
    </ErrorBoundary>
  );
}

export { WorkspaceLayout, WorkspaceRedirect };
