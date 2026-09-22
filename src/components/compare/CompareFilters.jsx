/**
 * CompareFilters.
 *
 * The comparison has three filter dimensions: which layer to read (changes, text,
 * structure or the graph diff), which scope to narrow to, and which kind of
 * change to show. Chips carry their counts so the reader can see the size of what
 * they are hiding before they hide it.
 */

import { Badge } from '../ui/Badge.jsx';

const CHIP_BASE =
  'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs font-medium transition-colors';
const CHIP_ACTIVE = 'border-accent-300 bg-accent-50 text-accent-700';
const CHIP_IDLE = 'border-ink-200 bg-surface text-ink-600 hover:bg-ink-50';

function Chip({ label, count = null, active = false, title = null, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? undefined}
      aria-pressed={active}
      className={[CHIP_BASE, active ? CHIP_ACTIVE : CHIP_IDLE].join(' ')}
    >
      {label}
      {count === null ? null : (
        <span className={active ? 'text-accent-700' : 'text-ink-400'}>{count}</span>
      )}
    </button>
  );
}

function ChipGroup({ id, legend, hint = null, children }) {
  return (
    <div>
      <p className="label-eyebrow" id={`${id}-legend`}>
        {legend}
        {hint ? <span className="ml-1.5 normal-case tracking-normal text-ink-400">{hint}</span> : null}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby={`${id}-legend`}>
        {children}
      </div>
    </div>
  );
}

export function CompareFilters({
  views = [],
  view,
  onSelectView,
  viewCounts = {},
  scopeFilters = [],
  scopeId,
  onSelectScope,
  changeTypeFilters = [],
  changeType,
  onSelectChangeType,
}) {
  return (
    <div className="panel space-y-4 p-4">
      <ChipGroup id="compare-view" legend="Layer">
        {views.map((entry) => (
          <Chip
            key={entry.id}
            label={entry.label}
            title={entry.description}
            count={viewCounts[entry.id] ?? 0}
            active={entry.id === view}
            onClick={() => onSelectView?.(entry.id)}
          />
        ))}
      </ChipGroup>

      <ChipGroup id="compare-scope" legend="Scope">
        {scopeFilters.map((filter) => (
          <Chip
            key={filter.id}
            label={filter.label}
            title={filter.description}
            count={filter.count}
            active={filter.id === scopeId}
            onClick={() => onSelectScope?.(filter.id)}
          />
        ))}
      </ChipGroup>

      <ChipGroup id="compare-kind" legend="Change" hint="unchanged records are hidden unless asked for">
        {changeTypeFilters.map((filter) => (
          <Chip
            key={filter.id}
            label={filter.label}
            count={filter.count}
            active={filter.id === changeType}
            onClick={() => onSelectChangeType?.(filter.id)}
          />
        ))}
      </ChipGroup>
    </div>
  );
}

/** Small legend explaining the tone of each change kind. */
export function ChangeKindLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-500">
      <li className="inline-flex items-center gap-1.5">
        <Badge tone="accent">added</Badge> recorded in version B only
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Badge tone="critical">removed</Badge> recorded in version A only
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Badge tone="warning">modified</Badge> wording or values moved
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Badge tone="accent">relationship changed</Badge> the records are wired differently
      </li>
    </ul>
  );
}

export default CompareFilters;
