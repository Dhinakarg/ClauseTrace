/**
 * ClauseOutline and PartyList.
 *
 * The outline is the parser's result, not the model's: it shows the clause
 * structure that was detected in the text, and marks which clauses carry
 * extracted facts so a reader can see where the model looked.
 */

import { Badge } from '../ui/Badge.jsx';
import { clauseReference } from './presentation.js';

export function ClauseOutline({ clauses = [], activeClauseId = null, onSelect = null }) {
  if (clauses.length === 0) {
    return <p className="text-sm text-ink-600">No clause structure was detected in this document.</p>;
  }
  return (
    <div className="max-h-96 overflow-y-auto pr-1 min-h-0">
      <ul className="space-y-1">
        {clauses.map((clause) => {
          const isActive = clause.id === activeClauseId;
          return (
            <li key={clause.id}>
              <button
                type="button"
                onClick={onSelect ? () => onSelect(clause) : undefined}
                disabled={!onSelect}
                className={[
                  'flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm',
                  onSelect ? 'hover:bg-ink-50' : 'cursor-default',
                  isActive ? 'bg-accent-50' : '',
                ]
                  .join(' ')
                  .trim()}
                style={{ paddingLeft: `${0.5 + Math.min(clause.level ?? 1, 4) * 0.75}rem` }}
              >
                <span className="w-12 shrink-0 font-mono text-xs text-ink-500">
                  {clause.number ?? '·'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink-800 break-words">
                    {clause.heading ?? 'Text block'}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-500 break-words">
                    page {clause.page ?? '—'} · {clause.charCount.toLocaleString()} chars
                    {clause.crossReferenceCount > 0
                      ? ` · ${clause.crossReferenceCount} cross-reference(s)`
                      : ''}
                  </span>
                </span>
                {clause.hasObligations ? <Badge tone="accent" className="shrink-0">cited</Badge> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PartyList({ rows = [], obligations = [], activePartyId = null, onSelect = null }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-600">No parties were identified in this document.</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map(({ party }) => {
        const obligationsForParty = obligations.filter(
          (row) => row.obligation.obligorPartyId === party.id,
        );
        return (
          <li
            key={party.id}
            className={[
              'rounded border p-2.5',
              party.id === activePartyId ? 'border-accent-300 bg-accent-50' : 'border-ink-200 bg-surface',
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-900">{party.name}</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {party.role?.replace(/-/g, ' ') ?? 'role unknown'}
                  {party.jurisdiction ? ` · ${party.jurisdiction}` : ''}
                </p>
              </div>
              <Badge tone="neutral">{obligationsForParty.length} obligation(s)</Badge>
            </div>
            {party.aliases?.length > 0 ? (
              <p className="mt-1.5 text-xs text-ink-500">
                Also called: {party.aliases.join(', ')}
              </p>
            ) : null}
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(party)}
                className="mt-1.5 text-xs font-medium text-accent-600 hover:text-accent-700"
              >
                Show relationships for {party.name}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function DefinitionList({ definitions = [] }) {
  if (definitions.length === 0) {
    return <p className="text-sm text-ink-600">No defined terms were extracted from this document.</p>;
  }
  return (
    <div className="max-h-80 overflow-y-auto pr-1 min-h-0">
      <dl className="space-y-2">
        {definitions.map((definition) => (
          <div key={definition.id} className="rounded border border-ink-200 bg-surface p-2.5">
            <dt className="text-sm font-semibold text-ink-900 break-words">{definition.term}</dt>
            <dd className="mt-0.5 text-sm text-ink-700 break-words">{definition.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function RightList({ rights = [], partiesById = new Map() }) {
  if (rights.length === 0) {
    return <p className="text-sm text-ink-600">No rights were extracted from this document.</p>;
  }
  return (
    <div className="max-h-80 overflow-y-auto pr-1 min-h-0">
      <ul className="space-y-2">
        {rights.map((right) => (
          <li key={right.id} className="rounded border border-ink-200 bg-surface p-2.5">
            <p className="text-sm text-ink-800 break-words">{right.summary}</p>
            <p className="mt-1 text-xs text-ink-500 break-words">
              held by {partiesById.get(right.holderPartyId)?.name ?? 'not identified'}
              {right.counterpartyPartyId
                ? ` against ${partiesById.get(right.counterpartyPartyId)?.name ?? 'not identified'}`
                : ''}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { clauseReference };
