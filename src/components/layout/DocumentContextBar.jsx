/**
 * DocumentContextBar.
 *
 * Persistent strip showing which document is active and the state of its data:
 * parsed size, evidence coverage, provider in use, and any gaps. It exists so
 * that no screen can be read without knowing where its numbers came from.
 */

import { Link } from 'react-router-dom';
import { AlertTriangle, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { Badge, severityTone } from '../ui/Badge.jsx';
import { routeBuilders } from '../../app/navigation.js';
import { DEMO_BANNER } from '../../content/notices.js';
import { selectActiveEntry, selectWorkspaceSummary } from '../../state/selectors.js';
import { useAppStore } from '../../app/AppProvider.jsx';

export function DocumentContextBar() {
  const state = useAppStore();
  const entry = selectActiveEntry(state);
  const summary = selectWorkspaceSummary(state);

  if (!entry) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-surface px-4 py-2 text-xs text-ink-500">
        <FileText aria-hidden="true" className="h-3.5 w-3.5" />
        No document is loaded. Demo data is fictional; demo extraction uses bundled data, not a live AI service.
      </div>
    );
  }

  const fileName = entry.content?.fileName ?? entry.id;
  const documentId = entry.id;
  const coverage = summary.coverage;
  const isDemo = entry.source === 'demo';

  return (
    <div className="border-b border-ink-200 bg-surface px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-600">
        <span className="flex items-center gap-1.5 font-medium text-ink-800">
          <FileText aria-hidden="true" className="h-3.5 w-3.5 text-accent-500" />
          <Link to={routeBuilders.workspace(documentId)} className="hover:text-accent-700">
            {fileName}
          </Link>
        </span>

        {entry.extracting ? (
          <span className="flex items-center gap-1.5">
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-accent-500" />
            analysing…
          </span>
        ) : null}

        {entry.content ? (
          <span>
            {entry.content.pageCount} page(s) · {entry.content.charCount.toLocaleString()} chars
          </span>
        ) : null}

        {coverage ? (
          <span className="flex items-center gap-1.5">
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-positive-500" />
            {coverage.verified}/{coverage.total} facts with a verified citation
          </span>
        ) : null}

        {state.ai?.provider ? (
          <Badge tone={state.ai.ready ? 'accent' : 'warning'} title={state.ai.detail ?? undefined}>
            {state.ai.provider === 'mock' ? 'demo extraction' : state.ai.provider}
          </Badge>
        ) : null}

        {summary.counts ? (
          <span className="hidden sm:inline">
            {summary.counts.obligations} obligation(s) · {summary.counts.risks} risk signal(s) ·{' '}
            {summary.counts.inconsistencies} inconsistency(ies)
          </span>
        ) : null}

        {summary.gaps?.length > 0 ? (
          <Link
            to={routeBuilders.prepare(documentId)}
            className="flex items-center gap-1.5 font-medium text-signal-700 hover:text-signal-500"
          >
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
            {summary.gaps.length} open gap(s) to review
          </Link>
        ) : null}
      </div>

      {isDemo ? (
        <p className="mt-1.5 flex items-center gap-2 text-2xs text-ink-500">
          <Badge tone={severityTone('info')}>demo</Badge>
          {DEMO_BANNER}
        </p>
      ) : null}
    </div>
  );
}

export default DocumentContextBar;
