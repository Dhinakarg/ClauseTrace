/**
 * Sidebar.
 *
 * Two groups: workspace-level destinations, and destinations for the active
 * document. The document group is hidden until a document exists, because none
 * of those views can say anything useful without one.
 */

import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { FileText, X } from 'lucide-react';
import { PRIMARY_NAV, isActivePath, routeBuilders, workspaceLinks } from '../../app/navigation.js';
import { APP_NAME, APP_TAGLINE } from '../../content/notices.js';
import { selectActiveEntry, selectDocumentSummaries } from '../../state/selectors.js';
import { useAppState } from '../../app/AppProvider.jsx';
import { ResetModal } from '../common/ResetModal.jsx';

function navClass(active) {
  return [
    'flex items-start gap-2.5 rounded px-2.5 py-2 text-sm transition-colors text-left w-full',
    active ? 'bg-accent-50 text-accent-700' : 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
  ].join(' ');
}

export function Sidebar({ onNavigate = null, onClose = null, variant = 'desktop' }) {
  const location = useLocation();
  const { state, selectDocument, resetWorkspace } = useAppState();
  const [resetOpen, setResetOpen] = useState(false);
  const entry = selectActiveEntry(state);
  const documents = selectDocumentSummaries(state);
  const links = workspaceLinks(entry?.id ?? '');
  const showDocumentNav = Boolean(entry?.id);

  const handleNavigate = () => {
    if (onNavigate) onNavigate();
  };

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex items-start justify-between gap-2 border-b border-ink-200 px-4 py-4">
        <div className="min-w-0">
          <p className="font-serif text-lg leading-tight text-ink-900">{APP_NAME}</p>
          <p className="mt-0.5 text-xs text-ink-500">{APP_TAGLINE}</p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
            aria-label={variant === 'mobile' ? 'Close navigation' : 'Collapse navigation'}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
        <ul className="space-y-1">
          {PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(location.pathname, item.to, { exact: Boolean(item.exact) });
            return (
              <li key={item.id}>
                <NavLink to={item.to} className={navClass(active)} onClick={handleNavigate}>
                  <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-xs font-normal text-ink-500">
                      {item.description}
                    </span>
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ul>

        {showDocumentNav ? (
          <>
            <p className="mt-5 px-2.5 label-eyebrow">This document</p>
            <ul className="mt-2 space-y-1">
              {links.map((item) => {
                const Icon = item.icon;
                const active = isActivePath(location.pathname, item.to, { exact: item.id !== 'graph' });
                return (
                  <li key={item.id}>
                    <NavLink to={item.to} className={navClass(active)} onClick={handleNavigate}>
                      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium">{item.label}</span>
                        <span className="mt-0.5 block text-xs font-normal text-ink-500">
                          {item.description}
                        </span>
                      </span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        {documents.length > 1 ? (
          <>
            <p className="mt-5 px-2.5 label-eyebrow">Loaded documents</p>
            <ul className="mt-2 space-y-1">
              {documents.map((document) => (
                <li key={document.id}>
                  <button
                    type="button"
                    onClick={() => {
                      selectDocument(document.id);
                      handleNavigate();
                    }}
                    className={navClass(document.id === entry?.id)}
                  >
                    <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{document.title}</span>
                      <span className="mt-0.5 block text-xs font-normal text-ink-500">
                        {document.pageCount ?? '—'} page(s)
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </nav>

      <footer className="border-t border-ink-200 px-4 py-3 text-2xs text-ink-500">
        <p>
          Verification only: ClauseTrace reports what the document states. It does not give legal
          advice.
        </p>
        <p className="mt-1 flex flex-wrap gap-3">
          <NavLink to={routeBuilders.documents()} className="underline hover:text-ink-700">
            Manage documents
          </NavLink>
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            className="underline hover:text-flag-600"
          >
            Reset workspace
          </button>
        </p>
        <ResetModal open={resetOpen} onClose={() => setResetOpen(false)} onConfirm={resetWorkspace} />
      </footer>
    </div>
  );
}

export default Sidebar;
