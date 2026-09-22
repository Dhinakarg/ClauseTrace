import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, AlertTriangle, ShieldCheck, Cpu, GitBranch } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { getProviderDisplayName } from '../../ai/config.js';

export function AITracePanel({ summary, trust, error = null, className = '' }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const providerName = trust?.provider?.name ?? summary?.entry?.extractionReport?.provider?.name ?? trust?.ai?.provider;
  const displayProvider = getProviderDisplayName(providerName);

  const report = summary?.entry?.extractionReport ?? null;
  const ready = summary?.ready ?? false;
  const failed = Boolean(error || (report && report.accepted === false));

  const draftItemCount = report?.draftItemCount ?? trust?.counts?.draftItemCount ?? 0;
  const verifiedCount = summary?.coverage?.verified ?? (report?.evidence ? report.evidence.checkedEntities - report.evidence.rejectedEntities : 0);
  const rejectedCount = trust?.evidence?.rejectedEntities ?? report?.evidence?.rejectedEntities ?? 0;
  const proposalCount = draftItemCount || (verifiedCount + rejectedCount);

  const model = summary?.model;
  const partiesCount = model?.parties?.length ?? summary?.counts?.parties ?? 0;
  const obligationsCount = model?.obligations?.length ?? summary?.counts?.obligations ?? 0;
  const deadlinesCount = model?.deadlines?.length ?? summary?.timeline?.counts?.dated ?? 0;
  const rightsCount = model?.rights?.length ?? 0;

  if (failed) {
    return (
      <div className={`rounded-lg border border-flag-200 bg-flag-50/50 p-4 ${className}`}>
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-flag-600" aria-hidden="true" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-flag-900">AI extraction could not be completed</h3>
            <p className="text-xs text-flag-700">
              The document was not added to the validated legal model.
            </p>
            <p className="mt-1 text-xs font-mono text-flag-800">
              Reason: {error ?? report?.statusReason ?? 'Provider response could not be validated.'}
            </p>
            <p className="mt-2 text-2xs text-ink-500">
              Provider: <span className="font-medium">{displayProvider}</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-ink-200 bg-surface shadow-xs ${className}`}>
      <div className="border-b border-ink-100 bg-ink-50/50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent-600" aria-hidden="true" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-700">
              AI Document Analysis & Verification Trace
            </h3>
          </div>
          <Badge tone={displayProvider === 'Gemini' ? 'positive' : 'accent'}>
            Provider: {displayProvider}
          </Badge>
        </div>

        <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="flex items-center gap-1.5 text-xs text-ink-800">
            <CheckCircle2 className="h-4 w-4 text-positive-500 shrink-0" aria-hidden="true" />
            <span>Document parsed</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-ink-800">
            <CheckCircle2 className="h-4 w-4 text-positive-500 shrink-0" aria-hidden="true" />
            <span>AI extraction completed</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-ink-800">
            <CheckCircle2 className="h-4 w-4 text-positive-500 shrink-0" aria-hidden="true" />
            <span>Evidence verification completed</span>
          </div>
        </div>

        {ready ? (
          <div className="mt-2 flex flex-wrap gap-4 text-xs font-medium text-ink-700">
            <span className="text-positive-700">{verifiedCount} facts verified</span>
            {rejectedCount > 0 ? (
              <span className="text-signal-700">{rejectedCount} proposals rejected</span>
            ) : (
              <span className="text-ink-500">0 proposals rejected</span>
            )}
          </div>
        ) : null}
      </div>

      <div className="grid border-b border-ink-100 divide-y divide-ink-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-3 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-ink-900">
            <Cpu className="h-3.5 w-3.5 text-accent-600" aria-hidden="true" />
            <span>AI extraction</span>
          </div>
          <p className="mt-0.5 text-2xs text-ink-500">Semantic document understanding</p>
        </div>
        <div className="p-3 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-ink-900">
            <ShieldCheck className="h-3.5 w-3.5 text-positive-600" aria-hidden="true" />
            <span>Evidence verification</span>
          </div>
          <p className="mt-0.5 text-2xs text-ink-500">Source text validation</p>
        </div>
        <div className="p-3 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-ink-900">
            <GitBranch className="h-3.5 w-3.5 text-ink-600" aria-hidden="true" />
            <span>Deterministic analysis</span>
          </div>
          <p className="mt-0.5 text-2xs text-ink-500">Graph, obligations, timeline and comparison</p>
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-bold text-ink-900">AI extraction</h4>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between py-0.5">
              <dt className="text-ink-600">Document</dt>
              <dd className="font-medium text-ink-900 truncate max-w-[180px]">
                {model?.documents?.[0]?.title ?? 'Contract'}
              </dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-ink-600">AI provider</dt>
              <dd className="font-medium text-ink-900">{displayProvider}</dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-ink-600">Structured proposals</dt>
              <dd className="font-medium text-ink-900">{proposalCount}</dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-ink-600">Evidence verified</dt>
              <dd className="font-medium text-positive-700">{verifiedCount}</dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-ink-600">Rejected</dt>
              <dd className="font-medium text-ink-900">{rejectedCount}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h4 className="text-xs font-bold text-ink-900">Evidence verification</h4>
          <ul className="mt-2 space-y-1.5 text-xs text-ink-700">
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-positive-500 shrink-0" aria-hidden="true" />
              <span>Source clause exists</span>
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-positive-500 shrink-0" aria-hidden="true" />
              <span>Quoted text matches source</span>
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-positive-500 shrink-0" aria-hidden="true" />
              <span>Character offsets verified</span>
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-positive-500 shrink-0" aria-hidden="true" />
              <span>Unsupported claims rejected</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-ink-100 bg-ink-50/30 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setDetailsOpen((prev) => !prev)}
          aria-expanded={detailsOpen}
          className="flex w-full items-center justify-between text-xs font-semibold text-accent-700 hover:text-accent-800"
        >
          <span>View extraction details</span>
          {detailsOpen ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
        </button>

        {detailsOpen ? (
          <div className="mt-3 space-y-2 rounded border border-ink-200 bg-surface p-3 text-xs">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded bg-ink-50 p-2 text-center">
                <p className="text-2xs font-semibold uppercase text-ink-500">Parties</p>
                <p className="mt-0.5 text-sm font-bold text-ink-900">{partiesCount} extracted</p>
              </div>
              <div className="rounded bg-ink-50 p-2 text-center">
                <p className="text-2xs font-semibold uppercase text-ink-500">Obligations</p>
                <p className="mt-0.5 text-sm font-bold text-ink-900">{obligationsCount} extracted</p>
              </div>
              <div className="rounded bg-ink-50 p-2 text-center">
                <p className="text-2xs font-semibold uppercase text-ink-500">Deadlines</p>
                <p className="mt-0.5 text-sm font-bold text-ink-900">{deadlinesCount} extracted</p>
              </div>
              <div className="rounded bg-ink-50 p-2 text-center">
                <p className="text-2xs font-semibold uppercase text-ink-500">Rights</p>
                <p className="mt-0.5 text-sm font-bold text-ink-900">{rightsCount} extracted</p>
              </div>
            </div>
            <div className="rounded border border-positive-200 bg-positive-50/50 p-2 text-xs text-ink-700">
              <span className="font-semibold text-positive-800">EVIDENCE:</span> {verifiedCount} verified, {rejectedCount} rejected.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default AITracePanel;
