/**
 * ImpactPanel.
 *
 * What the selected change is wired to: the record itself, then every record the
 * engine reached, one step at a time. Text is structural — "this change reaches
 * the obligation “…”" — and never rates the change or advises on it.
 */

import { ArrowDown, Info, TriangleAlert } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { Callout, Panel } from '../ui/Panel.jsx';
import { EvidenceList } from '../legal/EvidenceList.jsx';

function ImpactRecord({ record, clauseNumberById }) {
  return (
    <li className="rounded border border-ink-100 bg-surface p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{record.kindLabel}</Badge>
        <span className="text-sm font-medium text-ink-900">{record.label}</span>
        <Badge tone="muted">{record.distance === 1 ? 'one step' : `${record.distance} steps`}</Badge>
      </div>
      <p className="mt-1 text-xs text-ink-600">{record.statement}</p>
      {record.clauseIds?.length > 0 && clauseNumberById ? (
        <p className="mt-1 text-xs text-ink-500">
          Clauses:{' '}
          {record.clauseIds
            .map((id) => clauseNumberById.get(id) ?? id)
            .filter(Boolean)
            .join(', ')}
        </p>
      ) : null}
      {record.evidence?.length > 0 ? (
        <div className="mt-2">
          <EvidenceList
            evidence={record.evidence}
            clauseNumberById={clauseNumberById}
            compact
          />
        </div>
      ) : null}
    </li>
  );
}

export function ImpactPanel({ impact, clauseNumberById = null, title = 'Downstream impact' }) {
  if (!impact) {
    return (
      <Panel title={title} subtitle="What this change is wired to">
        <p className="text-sm text-ink-500">Select a change to see what it reaches.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title={title}
      subtitle="Records reached through the references and relationships the model records"
      actions={
        <Badge tone={impact.affected.length > 0 ? 'accent' : 'muted'}>
          {impact.affected.length} reached
        </Badge>
      }
    >
      {impact.summary ? <p className="text-sm text-ink-800">{impact.summary}</p> : null}

      {impact.origin ? (
        <div className="mt-3 rounded border border-accent-200 bg-accent-50 p-2.5">
          <p className="label-eyebrow">The record that changed</p>
          <p className="mt-0.5 text-sm text-ink-800">{impact.origin.statement}</p>
        </div>
      ) : null}

      {impact.affected.length > 0 ? (
        <>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
            <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
            Reached from there
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {impact.affected.map((record) => (
              <ImpactRecord key={record.id} record={record} clauseNumberById={clauseNumberById} />
            ))}
          </ul>
        </>
      ) : (
        <Callout tone="info" className="mt-3">
          No other record in either version is wired to this one, so the change stops here.
        </Callout>
      )}

      {impact.disclaimer ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
          <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {impact.disclaimer}
        </p>
      ) : null}
    </Panel>
  );
}

/** Compact strip of impact totals for the page summary. */
export function ImpactTotals({ totals }) {
  if (!totals) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
      <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />
      <span>
        {totals.changesWithImpact} changed record(s) reach {totals.affectedRecordCount} other record(s).
      </span>
      {totals.byKindList?.map((entry) => (
        <Badge key={entry.kind} tone="muted">
          {entry.label} {entry.count}
        </Badge>
      ))}
    </div>
  );
}

export default ImpactPanel;
