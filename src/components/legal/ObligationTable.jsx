/**
 * ObligationTable.
 *
 * One row per obligation with its obligor, clause, deadline and deterministic
 * status. Rows keep the assessment reason available so a status is never shown
 * without the basis for it.
 */

import { Badge, obligationStatusTone } from '../ui/Badge.jsx';
import { EvidenceList } from './EvidenceList.jsx';
import {
  clauseReference,
  describeDueIn,
  formatDate,
  obligationStatusLabel,
} from './presentation.js';

export function ObligationTable({ rows = [], clauseNumberById = null, showEvidence = false }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-600">No obligations are recorded for this document.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="table-base min-w-[52rem]">
        <caption className="sr-only">
          Obligations extracted from the document with their parties, clauses and deadlines
        </caption>
        <thead>
          <tr>
            <th scope="col">Obligation</th>
            <th scope="col">Who</th>
            <th scope="col">Clause</th>
            <th scope="col">Timing</th>
            <th scope="col">Basis</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { obligation, assessment, obligor, obligee, clause, deadline } = row;
            const status = assessment?.status ?? 'unknown';
            return (
              <tr key={obligation.id}>
                <td className="max-w-xl">
                  <p className="font-medium text-ink-900">{obligation.summary}</p>
                  {obligation.standard && obligation.standard !== 'unknown' ? (
                    <p className="mt-0.5 text-xs text-ink-500">
                      Standard: {obligation.standard.replace(/-/g, ' ')}
                    </p>
                  ) : null}
                  {showEvidence ? (
                    <div className="mt-2">
                      <EvidenceList
                        evidence={obligation.evidence}
                        clauseNumberById={clauseNumberById}
                        compact
                      />
                    </div>
                  ) : null}
                </td>
                <td className="whitespace-nowrap">
                  <p className="text-ink-800">{obligor?.name ?? 'not identified'}</p>
                  <p className="text-xs text-ink-500">
                    owed to {obligee?.name ?? 'not identified'}
                  </p>
                </td>
                <td className="whitespace-nowrap text-ink-700">{clauseReference(clause)}</td>
                <td className="whitespace-nowrap">
                  <Badge tone={obligationStatusTone(status)}>{obligationStatusLabel(status)}</Badge>
                  <p className="mt-1 text-xs text-ink-600">
                    {deadline
                      ? `${formatDate(assessment?.dueDate)} (${describeDueIn(assessment?.daysUntilDue)})`
                      : 'no deadline on record'}
                  </p>
                </td>
                <td className="max-w-sm text-xs text-ink-600">{assessment?.reason ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default ObligationTable;
