/**
 * ChangeDetail.
 *
 * The full reading of one change: what moved, the before and after of every
 * compared field, the clause the record hangs off, the citations from both
 * versions, and (below it, in the page) what the change reaches.
 */

import { AlertTriangle, Link2, Minus, Plus } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { Panel } from '../ui/Panel.jsx';
import { EvidenceList } from '../legal/EvidenceList.jsx';

const MISSING = 'not recorded';

function FieldRow({ field }) {
  return (
    <li className="rounded border border-ink-100 bg-surface p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-800">{field.label}</span>
        {field.changed ? <Badge tone="warning">changed</Badge> : <Badge tone="muted">same</Badge>}
      </div>
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
        <p className={['text-xs', field.beforeMissing ? 'text-ink-400' : 'text-ink-700'].join(' ')}>
          <span className="label-eyebrow block">Before (version A)</span>
          {field.before ?? MISSING}
        </p>
        <p className={['text-xs', field.afterMissing ? 'text-ink-400' : 'text-ink-700'].join(' ')}>
          <span className="label-eyebrow block">After (version B)</span>
          {field.after ?? MISSING}
        </p>
      </div>
    </li>
  );
}

export function ChangeDetail({ detail, clauseNumberById = null }) {
  if (!detail) {
    return (
      <Panel title="Change detail">
        <p className="text-sm text-ink-500">
          Nothing is selected. Choose a change from the list to read it in full.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title={detail.title}
      subtitle={`${detail.scopeLabel} · ${detail.entityTypeLabel}`}
      actions={<Badge tone={detail.tone}>{detail.changeTypeLabel}</Badge>}
    >
      <p className="text-sm text-ink-800">{detail.summary}</p>

      {detail.reading ? (
        <div className="mt-3 rounded border border-ink-100 bg-ink-50/50 p-2.5">
          <p className="flex items-center gap-1.5 text-xs text-ink-600">
            <Link2 aria-hidden="true" className="h-3.5 w-3.5" />
            The link as each version records it
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-700">
            <Minus aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0 text-flag-500" />
            {detail.reading.before}
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-700">
            <Plus aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0 text-positive-500" />
            {detail.reading.after}
          </p>
        </div>
      ) : null}

      {detail.periodNote ? (
        <p className="mt-3 flex items-start gap-1.5 rounded border border-signal-300 bg-signal-50 px-2.5 py-2 text-sm text-signal-700">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {detail.periodNote}
        </p>
      ) : null}

      <div className="mt-4">
        <p className="label-eyebrow">What changed</p>
        {detail.fields.length === 0 ? (
          <p className="mt-1 text-sm text-ink-600">
            No compared field changed — the record reads the same in both versions.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {detail.fields.map((field) => (
              <FieldRow key={field.field} field={field} />
            ))}
          </ul>
        )}
      </div>

      {detail.clauseLinks.length > 0 ? (
        <div className="mt-4">
          <p className="label-eyebrow">Related clauses</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {detail.clauseLinks.map((link) => (
              <li key={link.id}>
                <Badge tone="neutral">{link.label}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div>
          <p className="label-eyebrow">
            Citations in version A ({detail.evidence.beforeSummary.verified} verified)
          </p>
          <div className="mt-1.5">
            <EvidenceList
              evidence={detail.evidence.before}
              clauseNumberById={clauseNumberById}
              compact
            />
          </div>
        </div>
        <div>
          <p className="label-eyebrow">
            Citations in version B ({detail.evidence.afterSummary.verified} verified)
          </p>
          <div className="mt-1.5">
            <EvidenceList
              evidence={detail.evidence.after}
              clauseNumberById={clauseNumberById}
              compact
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}

export default ChangeDetail;
