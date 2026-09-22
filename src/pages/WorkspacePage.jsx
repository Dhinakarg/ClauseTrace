/**
 * WorkspacePage — the document workspace.
 *
 * Two views over one document:
 *   • Reading (default): left = clause navigator and filters, centre = the
 *     document's own text with the selected clause and evidence highlighted,
 *     right = the facts extracted for the selection, each with its citations.
 *   • Brief: the Phase 1 summary panels, unchanged.
 *
 * Selection lives in the URL (`?clause=…&fact=…&view=…`), so a link to a clause
 * or a single extracted fact can be shared or reloaded.
 */

import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileSearch } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState, Panel } from '../components/ui/Panel.jsx';
import { ClauseReader } from '../components/workspace/ClauseReader.jsx';
import { DocumentBrief } from '../components/workspace/DocumentBrief.jsx';
import { DocumentNavigator } from '../components/workspace/DocumentNavigator.jsx';
import { IntelligencePanel } from '../components/workspace/IntelligencePanel.jsx';
import {
  SourceViewProvider,
  SourceViewer,
  useSourceView,
} from '../components/workspace/SourceViewer.jsx';
import {
  clauseHighlight,
  evidenceHighlights,
  summarizeSource,
} from '../components/workspace/sourceView.js';
import { clauseNumberMap } from '../components/legal/presentation.js';
import { indexClauseFacts } from '../documents/evidence.js';
import { EMPTY_STATES } from '../content/notices.js';
import { routeBuilders } from '../app/navigation.js';
import { useAppStore } from '../app/AppProvider.jsx';
import { selectActiveEntry } from '../state/selectors.js';

export function WorkspacePage() {
  const state = useAppStore();
  const entry = selectActiveEntry(state);
  const navigate = useNavigate();

  if (!entry?.model) {
    return (
      <EmptyState
        icon={FileSearch}
        message={entry?.extracting ? 'Extracting facts from this document…' : EMPTY_STATES.noModel}
        action={
          <Button variant="primary" onClick={() => navigate(routeBuilders.documents())}>
            Go to documents
          </Button>
        }
      />
    );
  }

  return (
    <SourceViewProvider>
      <WorkspaceBody entry={entry} />
    </SourceViewProvider>
  );
}

function WorkspaceBody({ entry }) {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'brief' ? 'brief' : 'reading';
  const clauseId = params.get('clause');
  const factId = params.get('fact');

  const model = entry.model;
  const clauses = useMemo(() => model?.clauses ?? [], [model]);
  const clauseNumbers = useMemo(() => clauseNumberMap(model), [model]);

  const index = useMemo(() => indexClauseFacts(model), [model]);
  const factsByClause = useMemo(() => {
    const counts = new Map();
    for (const [id, facts] of index.byClause.entries()) counts.set(id, facts.length);
    return counts;
  }, [index]);

  const activeClause =
    clauses.find((clause) => clause.id === clauseId) ?? clauses.find(() => true) ?? null;
  const clauseFacts = useMemo(
    () => (activeClause ? index.byClause.get(activeClause.id) ?? [] : index.facts),
    [activeClause, index],
  );
  const selectedFact = useMemo(
    () => clauseFacts.find((fact) => fact.entity.id === factId) ?? null,
    [clauseFacts, factId],
  );

  const highlights = useMemo(() => {
    const ranges = [];
    if (activeClause) ranges.push(clauseHighlight(activeClause));
    if (selectedFact) ranges.push(...evidenceHighlights(selectedFact.references));
    return ranges.filter(Boolean);
  }, [activeClause, selectedFact]);

  const stats = useMemo(
    () => summarizeSource(entry.content, clauses, index.facts),
    [entry.content, clauses, index.facts],
  );

  const setSelection = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const clauseIndex = activeClause
    ? clauses.findIndex((clause) => clause.id === activeClause.id)
    : -1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded border border-ink-200 bg-surface p-0.5">
            {[
              { id: 'reading', label: 'Read with facts' },
              { id: 'brief', label: 'Document brief' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelection({ view: tab.id })}
                className={[
                  'rounded px-3 py-1.5 text-sm font-medium',
                  view === tab.id ? 'bg-accent-50 text-accent-700' : 'text-ink-600 hover:bg-ink-50',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="hidden sm:inline-block text-xs text-accent-700 font-medium bg-accent-50 px-2.5 py-1 rounded border border-accent-200">
            Interactive reader: Select any clause to view its verified facts alongside the document text.
          </span>
        </div>

        <p className="text-xs text-ink-500">
          {stats.pageCount} page(s) · {stats.charCount.toLocaleString()} characters ·{' '}
          {stats.clauseCount} clauses · {stats.factCount} extracted facts
        </p>
      </div>

      {view === 'brief' ? (
        <DocumentBrief />
      ) : (
        <ReadingView
          clauses={clauses}
          factsByClause={factsByClause}
          activeClause={activeClause}
          clauseFacts={clauseFacts}
          selectedFact={selectedFact}
          highlights={highlights}
          content={entry.content}
          clauseNumbers={clauseNumbers}
          partyName={(id) =>
            id ? model.parties?.find((party) => party.id === id)?.name ?? null : null
          }
          stats={stats}
          position={clauseIndex >= 0 ? { index: clauseIndex, total: clauses.length } : null}
          onSelectClause={(clause) => setSelection({ clause: clause.id, fact: null })}
          onSelectFact={(fact) => setSelection({ fact: fact?.entity?.id ?? null })}
          onPrevious={
            clauseIndex > 0
              ? () => setSelection({ clause: clauses[clauseIndex - 1].id, fact: null })
              : null
          }
          onNext={
            clauseIndex >= 0 && clauseIndex < clauses.length - 1
              ? () => setSelection({ clause: clauses[clauseIndex + 1].id, fact: null })
              : null
          }
        />
      )}
    </div>
  );
}

function ReadingView({
  clauses,
  factsByClause,
  activeClause,
  clauseFacts,
  selectedFact,
  highlights,
  content,
  clauseNumbers,
  partyName,
  stats,
  position,
  onSelectClause,
  onSelectFact,
  onPrevious,
  onNext,
}) {
  const { focusClause, focusEvidence, clearFocus } = useSourceView();

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
      <Panel
        className="min-h-0 xl:h-[75vh]"
        noPadding
        title="Clauses"
        subtitle="Parser output, typed deterministically"
      >
        <DocumentNavigator
          clauses={clauses}
          factsByClause={factsByClause}
          activeClauseId={activeClause?.id ?? null}
          onSelect={(clause) => {
            onSelectClause(clause);
            focusClause(clause.id);
          }}
          stats={stats}
        />
      </Panel>

      <div className="min-w-0">
        <div className="panel flex flex-col xl:h-[75vh] min-h-0 overflow-hidden">
          <div className="shrink-0">
            <ClauseReader
              clause={activeClause}
              facts={clauseFacts}
              clauseNumberById={clauseNumbers}
              position={position}
              onPrevious={onPrevious}
              onNext={onNext}
              onFocusSource={(clause) => focusClause(clause.id)}
            />
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2 text-xs text-ink-500 bg-surface border-b border-ink-100">
            <span>Source text, with the selected range highlighted.</span>
            <button
              type="button"
              onClick={clearFocus}
              className="font-medium text-accent-600 hover:text-accent-700"
            >
              Show the whole document
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <SourceViewer content={content} clauses={clauses} highlights={highlights} maxHeightClass="h-full" />
          </div>
        </div>
      </div>

      <Panel
        className="min-h-0 xl:h-[75vh]"
        noPadding
        title="Extracted intelligence"
        subtitle={activeClause ? `Clause ${activeClause.number ?? '—'}` : 'Whole document'}
      >
        <IntelligencePanel
          facts={clauseFacts}
          clauseNumberById={clauseNumbers}
          partyName={partyName}
          selectedEntityId={selectedFact?.entity.id ?? null}
          onSelect={onSelectFact}
          onShowSource={({ clauseId, reference }) =>
            focusEvidence({ clauseId: clauseId ?? activeClause?.id ?? null, reference })
          }
          scopeLabel={
            activeClause
              ? `facts citing clause ${activeClause.number ?? activeClause.id}`
              : 'facts across the document'
          }
          emptyMessage={
            activeClause
              ? 'No extracted fact cites this clause.'
              : 'No facts were extracted from this document.'
          }
        />
      </Panel>
    </div>
  );
}

export default WorkspacePage;
