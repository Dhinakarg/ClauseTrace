/**
 * Text and structure layers of the comparison.
 *
 * TextDiffPanel shows the word-level difference for clauses whose wording moved:
 * removed words struck through, added words highlighted, everything else left
 * plain. StructureDiffPanel shows the legal skeleton the document states
 * ("1.1 PAYMENT → 30 days" before, "→ 15 days" after).
 */

import { AlertTriangle, Equal, FileDiff, ListTree } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { EmptyState, Panel } from '../ui/Panel.jsx';

function Segment({ segment }) {
  return <span className={segment.className}>{segment.text} </span>;
}

function SideBySideRedline({ row }) {
  const beforeSegments = (row.segments ?? []).filter((s) => s.kind !== 'added');
  const afterSegments = (row.segments ?? []).filter((s) => s.kind !== 'removed');

  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <div className="rounded border border-rose-200 bg-rose-50/40 p-3">
        <div className="flex items-center justify-between pb-1.5 border-b border-rose-200/60 mb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-rose-800">Version A (Original)</span>
          {row.beforeEvidence?.[0]?.startOffset !== undefined ? (
            <span className="text-2xs text-rose-700 font-mono">
              chars {row.beforeEvidence[0].startOffset}–{row.beforeEvidence[0].endOffset}
            </span>
          ) : null}
        </div>
        <div className="text-xs leading-relaxed text-ink-800 font-serif">
          {beforeSegments.length > 0 ? (
            beforeSegments.map((seg, i) => (
              <span
                key={i}
                className={
                  seg.kind === 'removed'
                    ? 'bg-rose-200 text-rose-950 line-through px-1 rounded font-medium'
                    : ''
                }
              >
                {seg.text}{' '}
              </span>
            ))
          ) : (
            <span className="italic text-ink-400">Clause not present in Version A</span>
          )}
        </div>
      </div>

      <div className="rounded border border-emerald-200 bg-emerald-50/40 p-3">
        <div className="flex items-center justify-between pb-1.5 border-b border-emerald-200/60 mb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">Version B (Redline)</span>
          {row.afterEvidence?.[0]?.startOffset !== undefined ? (
            <span className="text-2xs text-emerald-700 font-mono">
              chars {row.afterEvidence[0].startOffset}–{row.afterEvidence[0].endOffset}
            </span>
          ) : null}
        </div>
        <div className="text-xs leading-relaxed text-ink-800 font-serif">
          {afterSegments.length > 0 ? (
            afterSegments.map((seg, i) => (
              <span
                key={i}
                className={
                  seg.kind === 'added'
                    ? 'bg-emerald-200 text-emerald-950 font-bold px-1 rounded'
                    : ''
                }
              >
                {seg.text}{' '}
              </span>
            ))
          ) : (
            <span className="italic text-ink-400">Clause deleted in Version B</span>
          )}
        </div>
      </div>
    </div>
  );
}

function TextRow({ row }) {
  return (
    <li className="rounded-lg border border-ink-200 bg-surface p-3.5 shadow-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-ink-900">{row.label}</p>
        <div className="flex items-center gap-2">
          <Badge tone={row.tone}>{row.changeTypeLabel}</Badge>
          <span className="text-xs font-mono font-medium text-ink-600">
            +{row.stats.added} / −{row.stats.removed} word(s)
          </span>
        </div>
      </div>

      <SideBySideRedline row={row} />

      {row.truncated ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-signal-700">
          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
          Passage is long, shown as complete block diff.
        </p>
      ) : null}
    </li>
  );
}

export function TextDiffPanel({ rows = [] }) {
  return (
    <Panel
      title="Text differences"
      subtitle="Word-level differences between the passages each version records"
      actions={<FileDiff aria-hidden="true" className="h-4 w-4 text-ink-400" />}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={Equal}
          message="No clause wording moved between the two versions, so there is nothing to diff here."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <TextRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function StructureRow({ row, clauseNumberById }) {
  return (
    <li className="rounded border border-ink-100 bg-surface p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink-900">{row.kindLabel}</p>
        <Badge tone={row.tone}>{row.changeTypeLabel}</Badge>
      </div>
      <p className="mt-1.5 text-sm text-ink-700">
        <span className="text-ink-400">before: </span>
        {row.beforeText ?? 'not recorded'}
      </p>
      <p className="mt-0.5 text-sm text-ink-700">
        <span className="text-ink-400">after: </span>
        {row.afterText ?? 'not recorded'}
      </p>
      {row.note ? <p className="mt-1 text-xs text-signal-700">{row.note}</p> : null}
      {row.clauseIds?.length > 0 && clauseNumberById ? (
        <p className="mt-1 text-xs text-ink-500">
          Clauses: {row.clauseIds.map((id) => clauseNumberById.get(id) ?? id).join(', ')}
        </p>
      ) : null}
    </li>
  );
}

export function StructureDiffPanel({ rows = [], clauseNumberById = null }) {
  return (
    <Panel
      title="Structure differences"
      subtitle="Which clause or obligation states which timing, date or trigger"
      actions={<ListTree aria-hidden="true" className="h-4 w-4 text-ink-400" />}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={Equal}
          message="The two versions state the same timing, dates and triggers, so the legal skeleton did not move."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <StructureRow key={row.id} row={row} clauseNumberById={clauseNumberById} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default TextDiffPanel;
