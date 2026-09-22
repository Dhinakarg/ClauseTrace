/**
 * TimelineBoard — the schedule the document actually states.
 *
 * Entries are grouped into what has passed, what is coming up, what is later and
 * what could not be dated. Every entry says which kind of timing fact it is
 * (payment, renewal, notice, termination, other), keeps relative wording as
 * written when no date can be resolved, and shows the citation behind it.
 */

import { Banknote, Bell, Ban, CalendarClock, Info, RefreshCw } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { Callout, Panel, StatTile } from '../ui/Panel.jsx';
import { EvidenceList } from '../legal/EvidenceList.jsx';
import { describeDueIn, formatDate } from '../legal/presentation.js';

const KIND_ICONS = Object.freeze({
  payment: Banknote,
  renewal: RefreshCw,
  notice: Bell,
  termination: Ban,
  deadline: CalendarClock,
});

const BUCKET_LABELS = Object.freeze({
  past: 'past',
  'due-soon': 'due soon',
  future: 'future',
  undated: 'no date resolved',
});

export function TimelineKindIcon({ kind, className = 'h-4 w-4' }) {
  const Icon = KIND_ICONS[kind] ?? CalendarClock;
  return <Icon aria-hidden="true" className={className} />;
}

function TimelineEntry({ entry, clauseNumberById }) {
  const tone =
    entry.bucket === 'past' ? 'critical' : entry.bucket === 'due-soon' ? 'warning' : 'accent';
  return (
    <li className="border-l border-ink-200 pb-4 pl-4 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <TimelineKindIcon kind={entry.kind} />
          {entry.date ? formatDate(entry.date) : entry.relative ? 'Relative deadline' : 'No date'}
          {entry.date ? (
            <span className="text-xs font-normal text-ink-500">{describeDueIn(entry.daysUntil)}</span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{BUCKET_LABELS[entry.bucket]}</Badge>
          <Badge tone="neutral">{entry.kindLabel}</Badge>
          {entry.clauseNumber ? <Badge tone="muted">§{entry.clauseNumber}</Badge> : null}
        </div>
      </div>
      <p className="mt-1 text-sm text-ink-800">{entry.title}</p>
      {entry.relativeExpression ? (
        <p className="mt-1 text-sm text-signal-700">Kept as written: “{entry.relativeExpression}”</p>
      ) : null}
      {entry.obligationSummary ? (
        <p className="mt-0.5 text-xs text-ink-600">Relates to: {entry.obligationSummary}</p>
      ) : null}
      {entry.responsibleName ? (
        <p className="mt-0.5 text-xs text-ink-600">Responsible: {entry.responsibleName}</p>
      ) : null}
      {entry.resolutionNote ? (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-ink-500">
          <Info aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
          {entry.resolutionNote}
        </p>
      ) : null}
      <div className="mt-2">
        <EvidenceList evidence={entry.evidence} clauseNumberById={clauseNumberById} compact />
      </div>
    </li>
  );
}

export function TimelineBoard({
  view: timelineView,
  clauseNumberById = new Map(),
  kind = null,
  bucket = null,
  query = '',
  onChange,
}) {
  if (!timelineView) {
    return (
      <Callout tone="info" title="No document loaded">
        Load a document to see the schedule its deadlines describe.
      </Callout>
    );
  }

  const needle = String(query ?? '').trim().toLowerCase();
  const visibleItems = timelineView.items.filter((item) => {
    if (kind && item.kind !== kind) return false;
    if (bucket && item.bucket !== bucket) return false;
    if (!needle) return true;
    return [item.title, item.kindLabel, item.clauseLabel, item.responsibleName, item.relativeExpression]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });
  const groups = timelineView.groups
    .map((group) => ({ ...group, entries: visibleItems.filter((item) => item.bucket === group.id) }))
    .filter((group) => group.entries.length > 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Entries" value={timelineView.counts.total} hint="Every timing fact found" />
        <StatTile
          label="Past"
          value={timelineView.counts.byBucket.past ?? 0}
          tone={(timelineView.counts.byBucket.past ?? 0) > 0 ? 'critical' : 'neutral'}
          hint="Dates that have already passed"
        />
        <StatTile
          label="Coming up"
          value={timelineView.counts.byBucket['due-soon'] ?? 0}
          tone={(timelineView.counts.byBucket['due-soon'] ?? 0) > 0 ? 'warning' : 'neutral'}
          hint={`Within ${timelineView.dueSoonDays} days`}
        />
        <StatTile
          label="Relative wording kept"
          value={timelineView.counts.relative}
          hint="No calendar date was invented"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={kind ? 'quiet' : 'primary'}
          onClick={() => onChange?.({ kind: null })}
        >
          All kinds
        </Button>
        {timelineView.kinds.map((entry) => (
          <Button
            key={entry.id}
            size="sm"
            variant={kind === entry.id ? 'primary' : 'quiet'}
            onClick={() => onChange?.({ kind: entry.id })}
            title={entry.description}
          >
            <TimelineKindIcon kind={entry.id} className="mr-1 h-3.5 w-3.5" />
            {entry.label} ({entry.count})
          </Button>
        ))}
        <label className="sr-only" htmlFor="timeline-search">
          Search the timeline
        </label>
        <input
          id="timeline-search"
          type="search"
          className="rounded border border-ink-200 bg-surface px-2 py-1 text-sm text-ink-800"
          placeholder="Search dates, clauses and parties"
          value={query}
          onChange={(event) => onChange?.({ query: event.target.value })}
        />
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-ink-600">Nothing matches this filter.</p>
      ) : (
        groups.map((group) => (
          <Panel
            key={group.id}
            title={group.label}
            subtitle={`${group.entries.length} entr${group.entries.length === 1 ? 'y' : 'ies'}`}
          >
            <ul>
              {group.entries.map((entry) => (
                <TimelineEntry key={entry.id} entry={entry} clauseNumberById={clauseNumberById} />
              ))}
            </ul>
          </Panel>
        ))
      )}

      <Callout tone="warning" title="How dates are resolved">
        {timelineView.disclaimer} Recurring deadlines are projected forward from their anchor only when
        the document states one.
      </Callout>
    </div>
  );
}

export default TimelineBoard;
