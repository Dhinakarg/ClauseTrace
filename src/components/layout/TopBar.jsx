/**
 * StatusArea and TopBar.
 *
 * The top bar holds the document search entry point, the mobile navigation
 * trigger and the status area. Status is plain disclosure: which provider is in
 * use, what the pipeline accepted or rejected, and any notices raised.
 */

import { useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Info, Menu, RotateCw } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { CommandBar } from './CommandBar.jsx';
import { useAppState, useAppStore } from '../../app/AppProvider.jsx';
import { selectNotices, selectTrustSummary } from '../../state/selectors.js';
import { ResetModal } from '../common/ResetModal.jsx';

const LEVEL_STYLES = {
  info: { icon: Info, className: 'text-accent-600' },
  warning: { icon: AlertTriangle, className: 'text-signal-500' },
  error: { icon: AlertTriangle, className: 'text-flag-500' },
  success: { icon: CheckCircle2, className: 'text-positive-500' },
};

export function StatusArea() {
  const state = useAppStore();
  const { clearNotices, dismissNotice, resetWorkspace } = useAppState();
  const [resetOpen, setResetOpen] = useState(false);
  const notices = selectNotices(state);
  const trust = selectTrustSummary(state);
  const [open, setOpen] = useState(false);

  const errorCount = notices.filter((notice) => notice.level === 'error').length;
  const warningCount = notices.filter((notice) => notice.level === 'warning').length;

  return (
    <div className="flex items-center gap-2">
      <Badge tone={state.ai?.ready ? 'positive' : 'warning'} title={state.ai?.detail ?? undefined}>
        {state.ai?.label ?? 'AI status unknown'}
      </Badge>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="relative flex items-center gap-1.5 rounded border border-ink-200 bg-surface px-2 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
          aria-expanded={open}
          aria-label="Notifications and status"
        >
          <Bell aria-hidden="true" className="h-4 w-4" />
          Status
          {notices.length > 0 ? (
            <span
              className={[
                'ml-0.5 rounded-sm px-1 text-2xs',
                errorCount > 0
                  ? 'bg-flag-50 text-flag-700'
                  : warningCount > 0
                    ? 'bg-signal-50 text-signal-700'
                    : 'bg-ink-100 text-ink-700',
              ].join(' ')}
            >
              {notices.length}
            </span>
          ) : null}
        </button>

        {open ? (
          <div className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[90vw] rounded border border-ink-200 bg-surface shadow-overlay">
            <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
              <p className="text-sm font-semibold text-ink-900">Status</p>
              <div className="flex items-center gap-1">
                {notices.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={clearNotices}>
                    Clear
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            </div>

            <dl className="border-b border-ink-200 px-3 py-2 text-xs text-ink-600">
              <div className="flex justify-between gap-2 py-0.5">
                <dt>Provider</dt>
                <dd className="font-medium text-ink-800">
                  {trust.provider?.name ?? state.ai?.provider ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-2 py-0.5">
                <dt>Extraction accepted</dt>
                <dd className="font-medium text-ink-800">
                  {trust.accepted === null || trust.accepted === undefined
                    ? '—'
                    : trust.accepted
                      ? 'yes'
                      : 'no (see report)'}
                </dd>
              </div>
              <div className="flex justify-between gap-2 py-0.5">
                <dt>Facts rejected on evidence</dt>
                <dd className="font-medium text-ink-800">{trust.evidence?.rejectedEntities ?? 0}</dd>
              </div>
              <div className="flex justify-between gap-2 py-0.5">
                <dt>Validation warnings</dt>
                <dd className="font-medium text-ink-800">{trust.validation?.warningCount ?? 0}</dd>
              </div>
            </dl>

            <ul className="max-h-72 overflow-y-auto px-2 py-2">
              {notices.length === 0 ? (
                <li className="px-2 py-3 text-sm text-ink-500">No notices.</li>
              ) : (
                notices.map((notice) => {
                  const style = LEVEL_STYLES[notice.level] ?? LEVEL_STYLES.info;
                  const Icon = style.icon;
                  return (
                    <li key={notice.id} className="flex items-start gap-2 rounded px-2 py-1.5">
                      <Icon
                        aria-hidden="true"
                        className={['mt-0.5 h-4 w-4 shrink-0', style.className].join(' ')}
                      />
                      <span className="min-w-0 flex-1 text-xs text-ink-700">{notice.message}</span>
                      <button
                        type="button"
                        onClick={() => dismissNotice(notice.id)}
                        className="text-2xs uppercase tracking-label text-ink-400 hover:text-ink-700"
                      >
                        dismiss
                      </button>
                    </li>
                  );
                })
              )}
            </ul>

            <div className="border-t border-ink-200 p-2 text-right">
              <Button
                size="sm"
                variant="danger"
                icon={RotateCw}
                onClick={() => {
                  setOpen(false);
                  setResetOpen(true);
                }}
              >
                Reset workspace
              </Button>
            </div>
          </div>
        ) : null}

        <ResetModal open={resetOpen} onClose={() => setResetOpen(false)} onConfirm={resetWorkspace} />
      </div>
    </div>
  );
}

export function TopBar({ onOpenMobileNav, onReanalyze, reanalyzing = false }) {
  const state = useAppStore();
  const hasDocument = Boolean(state.activeDocumentId);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-surface px-4 py-2.5">
      <button
        type="button"
        onClick={onOpenMobileNav}
        className="rounded border border-ink-200 p-1.5 text-ink-600 hover:bg-ink-50 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu aria-hidden="true" className="h-4 w-4" />
      </button>

      <CommandBar />

      <div className="ml-auto flex items-center gap-2">
        {onReanalyze ? (
          <Button
            size="sm"
            variant="quiet"
            icon={RotateCw}
            onClick={onReanalyze}
            disabled={!hasDocument || reanalyzing}
            title="Re-run extraction and re-verify every citation"
          >
            {reanalyzing ? 'Re-analysing…' : 'Re-analyse'}
          </Button>
        ) : null}
        <StatusArea />
      </div>
    </div>
  );
}

export default TopBar;
