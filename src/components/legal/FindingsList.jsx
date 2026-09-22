/**
 * FindingsList — risk signals and inconsistencies.
 *
 * Both are AI-proposed judgements about the document, so each entry shows its
 * severity, category and the cited text. Risk signals describe what is written,
 * not what a reader should do about it.
 */

import { AlertTriangle, Scale } from 'lucide-react';
import { Badge, severityTone } from '../ui/Badge.jsx';
import { EvidenceList } from './EvidenceList.jsx';
import { clauseReference, severityRank } from './presentation.js';

export function RiskList({ rows = [], clauseNumberById = null }) {
  const sorted = [...rows].sort(
    (a, b) => severityRank(a.risk?.severity) - severityRank(b.risk?.severity),
  );
  if (sorted.length === 0) {
    return <p className="text-sm text-ink-600">No risk signals were flagged for this document.</p>;
  }
  return (
    <ul className="space-y-3">
      {sorted.map(({ risk, clause }) => (
        <li key={risk.id} className="rounded border border-ink-200 bg-surface p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-signal-500" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900">{risk.title}</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {risk.category?.replace(/-/g, ' ') ?? 'uncategorised'} ·{' '}
                  {clauseReference(clause)}
                </p>
              </div>
            </div>
            <Badge tone={severityTone(risk.severity)}>{risk.severity}</Badge>
          </div>
          {risk.explanation ? (
            <p className="mt-2 text-sm text-ink-700">{risk.explanation}</p>
          ) : null}
          <div className="mt-2">
            <EvidenceList evidence={risk.evidence} clauseNumberById={clauseNumberById} compact />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function InconsistencyList({ rows = [], clauseNumberById = null }) {
  const sorted = [...rows].sort(
    (a, b) => severityRank(a.inconsistency?.severity) - severityRank(b.inconsistency?.severity),
  );
  if (sorted.length === 0) {
    return (
      <p className="text-sm text-ink-600">
        No inconsistencies were detected between the extracted clauses.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {sorted.map(({ inconsistency, clauses }) => (
        <li key={inconsistency.id} className="rounded border border-flag-500/40 bg-flag-50/60 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <Scale aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-flag-500" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900">{inconsistency.title}</p>
                <p className="mt-0.5 text-xs text-ink-600">
                  {inconsistency.inconsistencyType?.replace(/-/g, ' ') ?? 'unspecified type'}
                  {clauses.length > 0
                    ? ` · ${clauses.map((clause) => clauseReference(clause)).join(' ↔ ')}`
                    : ''}
                </p>
              </div>
            </div>
            <Badge tone={severityTone(inconsistency.severity)}>{inconsistency.severity}</Badge>
          </div>
          {inconsistency.description ? (
            <p className="mt-2 text-sm text-ink-800">{inconsistency.description}</p>
          ) : null}
          <div className="mt-2">
            <EvidenceList
              evidence={inconsistency.evidence}
              clauseNumberById={clauseNumberById}
              compact
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
