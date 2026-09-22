/**
 * GraphListView — the accessible view of the same graph.
 *
 * One row per node: name, type, its relationships in words, the citations behind
 * it and the actions a reader can take. Arrow keys move between rows, Enter
 * selects, and the search box filters without hiding anything silently.
 *
 * This view is not a fallback: it is the guarantee that every fact in the picture
 * can also be read as text.
 */

import { useMemo, useRef } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { Panel } from '../ui/Panel.jsx';
import { EvidenceList } from '../legal/EvidenceList.jsx';
import { clauseNumberMap } from '../legal/presentation.js';

export function GraphListView({ view, model, focusNodeId, onSelectNode, query, onQueryChange }) {
  const rows = view?.listRows ?? [];
  const clauseNumbers = useMemo(() => clauseNumberMap(model), [model]);
  const listRef = useRef(null);

  const moveFocus = (index, delta) => {
    const next = rows[(index + delta + rows.length) % rows.length];
    if (!next) return;
    onSelectNode?.(next.id);
    const element = listRef.current?.querySelector(`[data-row-id="${next.id}"]`);
    element?.focus();
  };

  return (
    <Panel
      title="Accessible list view"
      subtitle={`${rows.length} entit${rows.length === 1 ? 'y' : 'ies'} in the current filters`}
      actions={
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="graph-list-search">
            Search entities
          </label>
          <div className="flex items-center gap-2 rounded border border-ink-200 px-2 py-1">
            <Search aria-hidden="true" className="h-4 w-4 text-ink-500" />
            <input
              id="graph-list-search"
              type="search"
              value={query ?? ''}
              onChange={(event) => onQueryChange?.(event.target.value)}
              placeholder="Filter by name, type or relationship"
              className="w-56 bg-transparent text-sm text-ink-800 outline-none"
            />
          </div>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-ink-600">
          No entity matches this search. Clear the search box or switch a filter group back on.
        </p>
      ) : (
        <ul ref={listRef} className="space-y-3" aria-label="Graph entities">
          {rows.map((row, index) => (
            <GraphListRow
              key={row.id}
              row={row}
              index={index}
              selected={row.id === focusNodeId}
              firstWithoutSelection={!focusNodeId && index === 0}
              clauseNumberById={clauseNumbers}
              onSelectNode={onSelectNode}
              onMove={moveFocus}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function GraphListRow({ row, index, selected, firstWithoutSelection, clauseNumberById, onSelectNode, onMove }) {
  return (
    <li
      data-row-id={row.id}
      tabIndex={selected || firstWithoutSelection ? 0 : -1}
      aria-current={selected ? 'true' : undefined}
      aria-label={row.ariaLabel}
      onFocus={() => onSelectNode?.(row.id)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          onMove(index, 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          onMove(index, -1);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectNode?.(row.id);
        }
      }}
      className={`rounded border p-3 ${selected ? 'border-accent-400 bg-accent-50/50' : 'border-ink-200'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{row.typeLabel}</Badge>
          <span className="text-sm font-semibold text-ink-900">{row.label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={row.provenance === 'derived' ? 'muted' : 'neutral'}>{row.provenance}</Badge>
          <Badge tone="neutral">
            {row.evidenceCount} citation{row.evidenceCount === 1 ? '' : 's'}
          </Badge>
          <Button
            size="sm"
            variant={selected ? 'primary' : 'default'}
            onClick={() => onSelectNode?.(row.id)}
          >
            {selected ? 'Selected' : 'Select'}
          </Button>
        </div>
      </div>

      {row.relationships.length ? (
        <ul className="mt-2 space-y-1">
          {row.relationships.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
              <Badge tone="neutral">{entry.phrase}</Badge>
              <button
                type="button"
                className="text-left text-accent-700 underline-offset-2 hover:underline"
                onClick={() => onSelectNode?.(entry.otherId)}
              >
                {entry.otherLabel}
              </button>
              <span className="text-xs text-ink-500">{entry.otherTypeLabel}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-500">No relationship recorded for this entity.</p>
      )}

      {row.evidence.length ? (
        <div className="mt-2">
          <EvidenceList evidence={row.evidence} clauseNumberById={clauseNumberById} compact />
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-500">
          No citation on record — this entity was not verified against the text.
        </p>
      )}
    </li>
  );
}

export default GraphListView;
