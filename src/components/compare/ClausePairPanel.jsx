/**
 * ClausePairPanel — the clause side-by-side reading aid.
 *
 * This is the original comparison tool: two clauses of the same document beside
 * each other with the facts extracted from each and the cited text behind them.
 * It now sits underneath the version comparison, because reading one clause from
 * each version next to each other is often what follows a version diff.
 *
 * It never decides which clause governs; it shows what each version records.
 */

import { useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { Callout, EmptyState, Panel } from '../ui/Panel.jsx';
import { EvidenceList } from '../legal/EvidenceList.jsx';
import { clauseNumberMap, clauseReference } from '../legal/presentation.js';
import { InconsistencyList } from '../legal/FindingsList.jsx';
import { EMPTY_STATES } from '../../content/notices.js';
import { useAppStore } from '../../app/AppProvider.jsx';
import { selectAllObligationRows, selectWorkspaceSummary } from '../../state/selectors.js';

/** Simple shared-term overlap between two clauses, ignoring short words. */
export function sharedTerms(textA, textB, { limit = 8 } = {}) {
  const tokens = (text) =>
    new Set(
      String(text ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 3),
    );
  const a = tokens(textA);
  const b = tokens(textB);
  return [...a].filter((token) => b.has(token)).slice(0, limit);
}

function ClauseColumn({ clause, facts, clauseNumberById }) {
  if (!clause) {
    return <p className="text-sm text-ink-500">Choose a clause to compare.</p>;
  }
  return (
    <div className="space-y-3">
      <div>
        <p className="font-mono text-xs text-ink-500">{clause.number ?? '·'}</p>
        <p className="text-sm font-semibold text-ink-900">{clause.heading ?? 'Text block'}</p>
        <p className="mt-0.5 text-xs text-ink-500">
          page {clause.page ?? '—'} · chars {clause.startOffset ?? '—'}–{clause.endOffset ?? '—'}
        </p>
      </div>
      <blockquote className="quote-block max-h-72 overflow-y-auto">{clause.text}</blockquote>

      <div>
        <p className="label-eyebrow">Extracted facts</p>
        {facts.length === 0 ? (
          <p className="mt-1 text-sm text-ink-600">No facts were extracted from this clause.</p>
        ) : (
          <ul className="mt-1 space-y-1.5 text-sm text-ink-700">
            {facts.map((row) => (
              <li key={row.obligation.id} className="rounded border border-ink-100 bg-ink-50/50 p-2">
                {row.obligation.summary}
                <span className="mt-1 block text-xs text-ink-500">
                  obligor: {row.obligor?.name ?? 'not identified'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {clause.crossReferences?.length > 0 ? (
        <div>
          <p className="label-eyebrow">Cross references</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {clause.crossReferences.map((id) => (
              <li key={id}>
                <Badge tone="muted">{clauseNumberById.get(id) ?? id}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="label-eyebrow">Source excerpt recorded for this clause</p>
        <div className="mt-1">
          <EvidenceList evidence={clause.evidence} clauseNumberById={clauseNumberById} compact />
        </div>
      </div>
    </div>
  );
}

export function ClausePairPanel() {
  const state = useAppStore();
  const summary = selectWorkspaceSummary(state);
  const obligations = selectAllObligationRows(state);
  const clauses = summary.model?.clauses ?? [];
  const clauseNumbers = useMemo(() => clauseNumberMap(summary.model), [summary.model]);

  const [leftId, setLeftId] = useState(() => clauses[0]?.id ?? '');
  const [rightId, setRightId] = useState(() => clauses[1]?.id ?? '');

  const left = clauses.find((clause) => clause.id === leftId) ?? clauses[0] ?? null;
  const right = clauses.find((clause) => clause.id === rightId) ?? clauses[1] ?? null;
  const shared = useMemo(
    () => (left && right ? sharedTerms(left.text, right.text) : []),
    [left, right],
  );

  if (!summary.ready) {
    return (
      <Panel title="Read two clauses side by side">
        <EmptyState icon={ArrowLeftRight} message={EMPTY_STATES.noModel} />
      </Panel>
    );
  }

  if (clauses.length === 0) {
    return (
      <Panel title="Read two clauses side by side">
        <EmptyState icon={ArrowLeftRight} message={EMPTY_STATES.noClauses} />
      </Panel>
    );
  }

  const factsFor = (clauseId) =>
    obligations.filter((row) => row.obligation.clauseId === clauseId);

  return (
    <div className="space-y-5">
      <Panel
        title="Read two clauses side by side"
        subtitle="Both sides show the clause text as parsed, unmodified"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="compare-left" className="field-label">
              Left clause
            </label>
            <select
              id="compare-left"
              className="input"
              value={left?.id ?? ''}
              onChange={(event) => setLeftId(event.target.value)}
            >
              {clauses.map((clause) => (
                <option key={clause.id} value={clause.id}>
                  {clauseReference(clause)}
                  {clause.heading ? ` — ${clause.heading}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="compare-right" className="field-label">
              Right clause
            </label>
            <select
              id="compare-right"
              className="input"
              value={right?.id ?? ''}
              onChange={(event) => setRightId(event.target.value)}
            >
              {clauses.map((clause) => (
                <option key={clause.id} value={clause.id}>
                  {clauseReference(clause)}
                  {clause.heading ? ` — ${clause.heading}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {shared.length > 0 ? (
          <p className="mt-3 text-xs text-ink-600">
            Overlapping terms:{' '}
            {shared.map((term) => (
              <span key={term} className="mr-1 inline-block rounded-sm bg-ink-100 px-1.5 py-0.5">
                {term}
              </span>
            ))}
          </p>
        ) : null}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={left ? clauseReference(left) : 'Left clause'} subtitle="Left side">
          <ClauseColumn clause={left} facts={factsFor(left?.id)} clauseNumberById={clauseNumbers} />
        </Panel>
        <Panel title={right ? clauseReference(right) : 'Right clause'} subtitle="Right side">
          <ClauseColumn
            clause={right}
            facts={factsFor(right?.id)}
            clauseNumberById={clauseNumbers}
          />
        </Panel>
      </div>

      {shared.length >= 5 ? (
        <Callout tone="warning" title="Substantial overlap detected">
          These clauses share a large amount of vocabulary, which is often where contradictions hide.
          Check whether they impose different periods, thresholds or remedies.
        </Callout>
      ) : null}

      <Panel
        title="Detected inconsistencies"
        subtitle="Proposals that passed citation checks — review each against its sources"
      >
        <InconsistencyList rows={summary.inconsistencies} clauseNumberById={clauseNumbers} />
      </Panel>
    </div>
  );
}

export default ClausePairPanel;

