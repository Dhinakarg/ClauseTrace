/**
 * ClauseReader — center pane header for the selected clause.
 *
 * The text shown here is the parser's own slice of the document (clause.text),
 * not a model summary. Offsets and page come from the parser, so a reader can
 * always tell where the passage sits in the source.
 */

import { ArrowLeft, ArrowRight, Crosshair } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { clauseTypeLabel } from '../../legal/clauseTypes.js';

export function ClauseReader({
  clause = null,
  facts = [],
  clauseNumberById = null,
  onFocusSource = null,
  onPrevious = null,
  onNext = null,
  position = null,
}) {
  if (!clause) {
    return (
      <div className="border-b border-ink-200 px-4 py-3">
        <p className="text-sm text-ink-600">
          Select a clause to read it against the document and see the facts that cite it.
        </p>
      </div>
    );
  }

  const crossReferences = (clause.crossReferences ?? [])
    .map((id) => clauseNumberById?.get?.(id) ?? null)
    .filter(Boolean);

  return (
    <div className="border-b border-ink-200 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-ink-500">{clause.number ?? 'unnumbered'}</span>
            <Badge tone="accent">{clauseTypeLabel(clause.clauseType)}</Badge>
            <Badge tone="muted">
              {clause.clauseTypeSource === 'ai' ? 'type from model' : 'type from parser'}
            </Badge>
            <Badge tone="muted">p. {clause.page ?? '—'}</Badge>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-ink-900 break-words">
            {clause.heading ?? 'Text block'}
          </h3>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {position ? (
            <span className="text-2xs text-ink-500">
              clause {position.index + 1} of {position.total}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onPrevious}
            disabled={!onPrevious}
            className="rounded border border-ink-200 p-1 text-ink-700 disabled:opacity-40"
            title="Previous clause"
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext}
            className="rounded border border-ink-200 p-1 text-ink-700 disabled:opacity-40"
            title="Next clause"
          >
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <blockquote className="quote-block mt-2 break-words max-h-40 overflow-y-auto">{clause.text}</blockquote>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-500">
        <span>
          chars {clause.startOffset ?? '—'}–{clause.endOffset ?? '—'}
        </span>
        <span>{facts.length} extracted fact(s)</span>
        {crossReferences.length > 0 ? (
          <span>refers to §{crossReferences.join(', §')}</span>
        ) : null}
        {clause.sectionPath?.length > 0 ? <span>in {clause.sectionPath.join(' › ')}</span> : null}
        {onFocusSource ? (
          <button
            type="button"
            onClick={() => onFocusSource(clause)}
            className="inline-flex items-center gap-1 font-medium text-accent-600 hover:text-accent-700"
          >
            <Crosshair aria-hidden="true" className="h-3 w-3" />
            Highlight in the document
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default ClauseReader;
