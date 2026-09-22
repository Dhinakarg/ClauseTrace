/**
 * TimelinePage — the classified schedule, plus the obligations and rights boards.
 *
 * Three readings of the same validated timing facts, switched from the URL:
 *  - `schedule` (the default): the classified timeline — every timing fact is
 *    typed (payment, renewal, notice, termination window, other deadline) and
 *    bucketed into already passed / due soon / later / no date resolved;
 *  - `obligations`: the duty cards, grouped by urgency, filterable by group,
 *    responsible party and free text;
 *  - `rights`: the same clauses read from the side of the party that may act.
 *
 * Relative wording is never converted into a date the document does not support:
 * it is kept verbatim and labelled as such.
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, CalendarClock, ClipboardCheck } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState, Panel } from '../components/ui/Panel.jsx';
import { ObligationBoard } from '../components/legal/ObligationBoard.jsx';
import { TimelineBoard } from '../components/legal/TimelineBoard.jsx';
import { clauseNumberMap } from '../components/legal/presentation.js';
import { EMPTY_STATES } from '../content/notices.js';
import { useAppStore } from '../app/AppProvider.jsx';
import {
  selectObligationBoard,
  selectRightsBoard,
  selectTimelineView,
  selectWorkspaceSummary,
} from '../state/selectors.js';

/** The three readings offered on this route, in tab order. */
export const TIMELINE_MODES = Object.freeze([
  {
    id: 'schedule',
    label: 'Classified timeline',
    icon: CalendarClock,
    description: 'Every timing fact, typed and bucketed.',
  },
  {
    id: 'obligations',
    label: 'My obligations',
    icon: ClipboardCheck,
    description: 'What this document requires, of whom, by when.',
  },
  {
    id: 'rights',
    label: 'Rights',
    icon: ArrowLeftRight,
    description: 'Who may act, against whom, and subject to what.',
  },
]);

/** Maps a board's change patch onto the URL parameter that carries it. */
const PATCH_PARAMS = Object.freeze({
  view: 'view',
  kind: 'kind',
  bucket: 'bucket',
  groupId: 'group',
  partyId: 'party',
  query: 'q',
});

export function TimelinePage() {
  const state = useAppStore();
  const [params, setParams] = useSearchParams();

  const summary = selectWorkspaceSummary(state);
  const timelineView = selectTimelineView(state);
  const board = selectObligationBoard(state);
  const rightsBoard = selectRightsBoard(state);
  const clauseNumbers = useMemo(() => clauseNumberMap(summary.model), [summary.model]);

  const requestedMode = params.get('view');
  const mode = TIMELINE_MODES.some((entry) => entry.id === requestedMode) ? requestedMode : 'schedule';
  const kind = params.get('kind') || null;
  const bucket = params.get('bucket') || null;
  const groupId = params.get('group') || null;
  const partyId = params.get('party') || null;
  const query = params.get('q') ?? '';

  const applyPatch = useCallback(
    (patch) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch ?? {})) {
            const paramKey = PATCH_PARAMS[key] ?? key;
            if (value === null || value === undefined || value === '') next.delete(paramKey);
            else next.set(paramKey, String(value));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  if (!summary.ready || !timelineView) {
    return <EmptyState icon={CalendarClock} message={EMPTY_STATES.noModel} />;
  }

  const activeMode = TIMELINE_MODES.find((entry) => entry.id === mode) ?? TIMELINE_MODES[0];

  return (
    <div className="space-y-5">
      <Panel
        title="Reading the schedule"
        subtitle={activeMode.description}
        actions={
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Timeline view">
            {TIMELINE_MODES.map((entry) => (
              <Button
                key={entry.id}
                size="sm"
                variant={mode === entry.id ? 'primary' : 'quiet'}
                aria-pressed={mode === entry.id}
                onClick={() => applyPatch({ view: entry.id === 'schedule' ? '' : entry.id })}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        }
      >
        <p className="text-sm text-ink-700">
          {mode === 'schedule'
            ? `${timelineView.counts.total} timing fact(s) were found: ${timelineView.counts.dated} carry a resolved date, ${timelineView.counts.relative} keep relative wording, and ${timelineView.counts.undated} have no timing at all.`
            : mode === 'obligations'
              ? `${board?.counts.total ?? 0} obligation(s), of which ${board?.counts.unresolved ?? 0} still have a deadline the document does not date.`
              : `${rightsBoard?.counts.total ?? 0} right(s), of which ${rightsBoard?.counts.withoutCounterparty ?? 0} do not name the party they are held against.`}
        </p>
      </Panel>

      {mode === 'schedule' ? (
        <TimelineBoard
          view={timelineView}
          clauseNumberById={clauseNumbers}
          kind={kind}
          bucket={bucket}
          query={query}
          onChange={applyPatch}
        />
      ) : (
        <ObligationBoard
          board={board}
          rightsBoard={rightsBoard}
          model={summary.model}
          view={mode}
          groupId={groupId}
          partyId={partyId}
          query={query}
          onChange={applyPatch}
        />
      )}
    </div>
  );
}

export default TimelinePage;
