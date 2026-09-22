/**
 * EvidenceList.
 *
 * Renders the citations attached to a fact. This component is the visible half
 * of the "AI proposes, code verifies" contract: every citation shows its
 * verification status, and a fact with no verified citation is labelled as such
 * rather than being presented as settled.
 *
 * Text is rendered through React (escaped), never as HTML.
 */

import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { Badge, evidenceStatusTone } from '../ui/Badge.jsx';
import { evidenceCitation } from '../../documents/evidence.js';

const STATUS_LABELS = {
  verified: 'verified',
  'text-mismatch': 'quote not found',
  'range-mismatch': 'range mismatch',
  'unknown-clause': 'unknown clause',
  'missing-source': 'no source',
  unverified: 'unverified',
};

function StatusIcon({ status }) {
  if (status === 'verified') {
    return <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-positive-500" />;
  }
  if (status === 'unverified') {
    return <HelpCircle aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />;
  }
  return <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 text-flag-500" />;
}

export function EvidenceList({ evidence = [], clauseNumberById = null, compact = false }) {
  const references = Array.isArray(evidence) ? evidence : [];
  if (references.length === 0) {
    return (
      <p className="text-xs text-ink-500">
        No source excerpt was recorded for this entry, so it cannot be checked against the document.
      </p>
    );
  }

  return (
    <ul className={compact ? 'space-y-2' : 'space-y-3'}>
      {references.map((reference) => {
        const clauseNumber = reference.clauseId
          ? clauseNumberById?.get(reference.clauseId) ?? null
          : null;
        const verification = reference.verified
          ? 'verified'
          : reference.status ?? 'unverified';
        return (
          <li key={reference.id} className="rounded border border-ink-100 bg-ink-50/40 p-2.5">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <StatusIcon status={verification} />
              <Badge tone={evidenceStatusTone(verification)}>
                {STATUS_LABELS[verification] ?? verification}
              </Badge>
              <span className="text-xs text-ink-500">
                {evidenceCitation(reference, { clauseNumber })}
              </span>
              {Number.isInteger(reference.startOffset) && Number.isInteger(reference.endOffset) ? (
                <span className="text-xs text-ink-400">
                  chars {reference.startOffset}–{reference.endOffset}
                </span>
              ) : null}
            </div>
            <blockquote className="quote-block break-words">{reference.sourceText}</blockquote>
          </li>
        );
      })}
    </ul>
  );
}

export default EvidenceList;
