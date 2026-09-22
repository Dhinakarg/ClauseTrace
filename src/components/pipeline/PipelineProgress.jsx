/**
 * PipelineProgress.
 *
 * Renders the ingestion stages as they happen. The point of this component is
 * to avoid the "spinner implies success" problem: each stage states what it did,
 * with numbers where they exist, and a stage that failed or was never attempted
 * says so instead of quietly disappearing.
 */

import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { STAGE_STATUS } from '../../documents/stages.js';

const STATUS_META = {
  [STAGE_STATUS.PENDING]: { icon: Circle, className: 'text-ink-300', label: 'Waiting' },
  [STAGE_STATUS.ACTIVE]: { icon: Loader2, className: 'animate-spin text-accent-500', label: 'Working' },
  [STAGE_STATUS.DONE]: { icon: CheckCircle2, className: 'text-positive-500', label: 'Done' },
  [STAGE_STATUS.FAILED]: { icon: XCircle, className: 'text-flag-500', label: 'Stopped' },
  [STAGE_STATUS.SKIPPED]: { icon: MinusCircle, className: 'text-ink-300', label: 'Not attempted' },
};

/** Compact, factual summary of a stage's metrics. Pure and testable. */
export function formatStageMetrics(stage) {
  const metrics = stage?.metrics;
  if (!metrics || typeof metrics !== 'object') return null;
  const parts = [];
  const push = (label, value) => {
    if (value === null || value === undefined) return;
    parts.push(`${label} ${value}`);
  };

  switch (stage.id) {
    case 'received':
      push('file', metrics.name ?? null);
      push('', metrics.fileTypeLabel ?? null);
      break;
    case 'text-extracted':
      push('pages', metrics.pageCount ?? null);
      push('chars', metrics.charCount ?? null);
      push('words', metrics.wordCount ?? null);
      break;
    case 'clauses-identified':
      push('clauses', metrics.clauses ?? null);
      push('chunks', metrics.chunks ?? null);
      if (metrics.truncatedChunks) push('truncated', metrics.truncatedChunks);
      break;
    case 'entities-extracted':
      push('facts proposed', metrics.draftItems ?? null);
      if (metrics.repairedChunks) push('repaired responses', metrics.repairedChunks);
      if (metrics.injectionWarnings) push('instruction-like passages', metrics.injectionWarnings);
      break;
    case 'relationships-built':
      push('derived', metrics.derivedRelationships ?? null);
      if (metrics.rejectedRelationships) push('rejected', metrics.rejectedRelationships);
      break;
    case 'evidence-validated':
      push('checked', metrics.checkedEntities ?? null);
      push('verified', metrics.verifiedEntities ?? null);
      if (metrics.rejectedEntities) push('withheld', metrics.rejectedEntities);
      break;
    case 'workspace-ready':
      push('clauses', metrics.clauses ?? null);
      push('facts', metrics.facts ?? null);
      push('verified', metrics.verified ?? null);
      break;
    default:
      break;
  }

  if (stage.id === 'received' && metrics.sizeBytes) {
    parts.push(`${Math.max(1, Math.round(metrics.sizeBytes / 1024))} KB`);
  }

  const text = parts.filter((part) => part && part.trim() !== '').join(' · ');
  return text.length > 0 ? text : null;
}

export function PipelineProgress({ stages = [], title = 'Processing the document', showDetails = true }) {
  if (!Array.isArray(stages) || stages.length === 0) return null;

  return (
    <section className="panel" aria-label={title}>
      <header className="panel-header">
        <div>
          <h2 className="panel-title">{title}</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Each step reports what it actually did. Nothing is shown in the workspace until the
            evidence step has passed.
          </p>
        </div>
      </header>
      <ol className="divide-y divide-ink-100">
        {stages.map((stage) => {
          const meta = STATUS_META[stage.status] ?? STATUS_META.pending;
          const Icon = meta.icon;
          const metrics = formatStageMetrics(stage);
          return (
            <li key={stage.id} className="flex items-start gap-2.5 px-4 py-2.5">
              <Icon aria-hidden="true" className={['mt-0.5 h-4 w-4 shrink-0', meta.className].join(' ')} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">{stage.label}</p>
                  <span className="text-2xs font-semibold uppercase tracking-label text-ink-500">
                    {meta.label}
                  </span>
                </div>
                {showDetails ? (
                  <p className="mt-0.5 text-xs text-ink-500">{stage.message ?? stage.detail}</p>
                ) : null}
                {metrics ? <p className="mt-0.5 text-xs text-ink-700">{metrics}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default PipelineProgress;
