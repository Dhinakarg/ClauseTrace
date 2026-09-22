/**
 * ChangeList.
 *
 * The middle column of the comparison: every filtered change, grouped by the
 * scope it belongs to, with the kind of change and a one-line reading of it.
 * Rows are buttons so the detail panel follows the keyboard as well as the mouse.
 */

import { Badge } from '../ui/Badge.jsx';
import { EmptyState } from '../ui/Panel.jsx';
import { changeTone, changeTypeLabel } from '../../legal/compareView.js';

function ChangeRow({ change, selected, onSelect }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(change.id)}
        aria-current={selected ? 'true' : undefined}
        className={[
          'w-full rounded border px-2.5 py-2 text-left transition-colors',
          selected
            ? 'border-accent-300 bg-accent-50'
            : 'border-ink-100 bg-surface hover:bg-ink-50',
        ].join(' ')}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="min-w-0 text-sm font-medium text-ink-900">{change.label}</span>
          <Badge tone={changeTone(change.changeType)}>{changeTypeLabel(change.changeType)}</Badge>
        </span>
        <span className="mt-1 block truncate text-xs text-ink-600">{change.summary}</span>
        {change.note ? <span className="mt-0.5 block text-xs text-ink-500">{change.note}</span> : null}
      </button>
    </li>
  );
}

export function ChangeList({
  groups = [],
  selectedChangeId = null,
  onSelectChange,
  emptyMessage = 'No changes match the current filters.',
}) {
  if (groups.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.scope}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-900">{group.label}</h3>
            <span className="text-xs text-ink-500">{group.changes.length}</span>
          </div>
          {group.description ? (
            <p className="mb-2 text-xs text-ink-500">{group.description}</p>
          ) : null}
          <ul className="space-y-1.5">
            {group.changes.map((change) => (
              <ChangeRow
                key={change.id}
                change={change}
                selected={change.id === selectedChangeId}
                onSelect={onSelectChange}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default ChangeList;
