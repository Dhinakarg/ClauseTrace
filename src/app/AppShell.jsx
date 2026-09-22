/**
 * AppShell.
 *
 * Layout + chrome only: responsive sidebar, top bar, breadcrumbs, document
 * context, page header and the mobile navigation drawer. Pages render into the
 * outlet and own all of their own data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Sidebar } from '../components/layout/Sidebar.jsx';
import { TopBar } from '../components/layout/TopBar.jsx';
import { DocumentContextBar } from '../components/layout/DocumentContextBar.jsx';
import { Breadcrumbs, PageHeader } from '../components/ui/PageHeader.jsx';
import { DISCLAIMER_SHORT } from '../content/notices.js';
import { buildBreadcrumbs, describeRoute, parseWorkspacePath } from './navigation.js';
import { useAppState, useAppStore } from './AppProvider.jsx';
import { selectActiveEntry } from '../state/selectors.js';

export function AppShell() {
  const location = useLocation();
  const state = useAppStore();
  const { reanalyzeDocument } = useAppState();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  const entry = selectActiveEntry(state);
  const activeDocumentId = parseWorkspacePath(location.pathname).documentId;
  const documentTitle =
    activeDocumentId && state.documents[activeDocumentId]
      ? state.documents[activeDocumentId].model?.documents?.[0]?.title ??
        state.documents[activeDocumentId].content?.fileName ??
        null
      : entry?.model?.documents?.[0]?.title ?? null;

  const crumbs = buildBreadcrumbs(location.pathname, { documentTitle });
  const header = describeRoute(location.pathname, { documentTitle });

  // Close the drawer and scroll to top whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname]);

  const handleReanalyze = useCallback(async () => {
    if (!activeDocumentId) return;
    setReanalyzing(true);
    try {
      await reanalyzeDocument(activeDocumentId);
    } finally {
      setReanalyzing(false);
    }
  }, [activeDocumentId, reanalyzeDocument]);

  return (
    <div className="flex min-h-full bg-canvas">
      <aside className="hidden w-72 shrink-0 border-r border-ink-200 lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar />
        </div>
      </aside>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="absolute inset-0 bg-ink-950/30"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[85vw] border-r border-ink-200 bg-canvas shadow-overlay">
            <Sidebar variant="mobile" onNavigate={() => setMobileNavOpen(false)} onClose={() => setMobileNavOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onReanalyze={activeDocumentId ? handleReanalyze : null}
          reanalyzing={reanalyzing}
        />
        <DocumentContextBar />

        <main className="flex-1 px-4 py-5 sm:px-6">
          <Breadcrumbs crumbs={crumbs} />
          <div className="mt-3">
            <PageHeader
              eyebrow={header.eyebrow}
              title={header.title}
              subtitle={header.subtitle}
            />
          </div>
          <div className="mt-5 pb-10">
            <Outlet />
          </div>
        </main>

        <footer className="border-t border-accent-300 bg-accent-50/80 px-4 py-3 text-xs font-medium text-accent-950">
          <div className="flex items-center gap-2 max-w-7xl">
            <ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-accent-700" />
            <span>{DISCLAIMER_SHORT}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default AppShell;
