/**
 * DocumentNavigator — left pane of the workspace.
 *
 * Shows the parser's clause skeleton with the extracted-fact count per clause,
 * and lets a reader filter by type or by "has extracted facts". The numbers here
 * come from deterministic code, not from the model's self-assessment.
 */

import { Search } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { clauseTypeLabel } from '../../legal/clauseTypes.js';
import { clauseTypeFilters, filterClauses } from './sourceView.js';

export function DocumentNavigator({
  clauses = [],
  factsByClause = null,
  activeClauseId = null,
  onSelect = null,
  query = '',
  onQueryChange = null,
  selectedTypes = [],
  onToggleType = null,
  onlyWithFacts = false,
  onToggleOnlyWithFacts = null,
  stats = null,
}) {
  const filters = clauseTypeFilters(clauses);
  const visible = filterClauses(clauses, {
    query,
    types: selectedTypes,
    onlyWithFacts,
    factsByClause,
  });

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="space-y-2 border-b border-ink-200 px-3 py-3 shrink-0 bg-surface">
        <label className="sr-only" htmlFor="clause-search">
          Search clauses
        </label>
        <div className="relative">
          <Search aria-hidden="true" className="absolute left-2 top-2.5 h-3.5 w-3.5 text-ink-400" />
          <input
            id="clause-search"
            className="input pl-7 text-xs"
            placeholder="Search clause text"
            value={query}
            onChange={(event) => onQueryChange?.(event.target.value)}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <select
            className="input text-xs py-1 flex-1 bg-surface"
            value={selectedTypes[0] ?? ''}
            onChange={(event) => {
              const val = event.target.value;
              if (!val) {
                // Clear selected types
                if (selectedTypes.length > 0 && onToggleType) {
                  selectedTypes.forEach((t) => onToggleType(t));
                }
              } else {
                // Select only this type
                if (selectedTypes.length > 0 && onToggleType) {
                  selectedTypes.forEach((t) => onToggleType(t));
                }
                onToggleType?.(val);
              }
            }}
            aria-label="Filter clauses by type"
          >
            <option value="">All clause types ({clauses.length})</option>
            {filters.map((filter) => (
              <option key={filter.type} value={filter.type}>
                {clauseTypeLabel(filter.type)} ({filter.count})
              </option>
            ))}
          </select>
          {selectedTypes.length > 0 ? (
            <button
              type="button"
              onClick={() => selectedTypes.forEach((t) => onToggleType?.(t))}
              className="text-2xs text-accent-700 hover:underline px-1 shrink-0"
            >
              Clear
            </button>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-xs text-ink-600">
          <input
            type="checkbox"
            checked={onlyWithFacts}
            onChange={(event) => onToggleOnlyWithFacts?.(event.target.checked)}
          />
          Only clauses with extracted facts
        </label>

        {stats ? (
          <p className="text-2xs text-ink-500">
            {stats.clauseCount} clauses · {stats.factCount} extracted facts
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {visible.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ink-500">
            No clause matches the current filters. Clearing them restores the full outline.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {visible.map((clause) => {
              const factCount = Number(factsByClause?.get?.(clause.id) ?? 0);
              const isActive = clause.id === activeClauseId;
              return (
                <li key={clause.id}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(clause)}
                    className={[
                      'flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm',
                      isActive ? 'bg-accent-50' : 'hover:bg-ink-50',
                    ].join(' ')}
                    style={{ paddingLeft: `${0.5 + Math.min(clause.level ?? 1, 4) * 0.6}rem` }}
                  >
                    <span className="w-10 shrink-0 font-mono text-xs text-ink-500">
                      {clause.number ?? '·'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-ink-800">
                        {clause.heading ?? 'Text block'}
                      </span>
                      <span className="mt-0.5 block text-2xs text-ink-500">
                        p. {clause.page ?? '—'} · {clauseTypeLabel(clause.clauseType)}
                      </span>
                    </span>
                    {factCount > 0 ? <Badge tone="accent">{factCount}</Badge> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default DocumentNavigator;
