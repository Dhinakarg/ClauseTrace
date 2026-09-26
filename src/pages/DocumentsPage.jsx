/**
 * DocumentsPage — the library, and the way in.
 *
 * Loading is where trust starts: the accepted types and limits are stated before
 * a file is chosen, the staged pipeline reports what each step actually did, and
 * a rejected file is explained instead of leaving an empty workspace behind.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePlus2, FileText, RefreshCw, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { Badge, severityTone } from '../components/ui/Badge.jsx';
import { Callout, EmptyState, Panel, ProgressMeter } from '../components/ui/Panel.jsx';
import { DocumentDropzone } from '../components/upload/DocumentDropzone.jsx';
import { PipelineProgress } from '../components/pipeline/PipelineProgress.jsx';
import { APP_NAME, EMPTY_STATES } from '../content/notices.js';
import { AI_PROVIDERS } from '../ai/config.js';
import { formatDate } from '../components/legal/presentation.js';
import { pendingStages } from '../documents/pipeline.js';
import { routeBuilders } from '../app/navigation.js';
import { useAppState, useAppStore } from '../app/AppProvider.jsx';
import { selectDocumentSummaries } from '../state/selectors.js';
import { ResetModal } from '../components/common/ResetModal.jsx';

export function DocumentsPage() {
  const state = useAppStore();
  const { importFile, loadDemoWorkspace, removeDocument, reanalyzeDocument, selectDocument, resetWorkspace } =
    useAppState();
  const navigate = useNavigate();

  const [run, setRun] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const documents = selectDocumentSummaries(state);

  /** Starts a pipeline run and mirrors its stages into local state. */
  const startRun = async ({ kind, label, documentId = null, execute }) => {
    setRun({ kind, label, documentId, stages: pendingStages(), result: null, finished: false });
    const onStage = (snapshot) => {
      setRun((current) =>
        current
          ? {
              ...current,
              stages: current.stages.map((stage) => (stage.id === snapshot.id ? snapshot : stage)),
            }
          : current,
      );
    };

    try {
      const result = await execute(onStage);
      setRun((current) => (current ? { ...current, result, finished: true } : current));
      return result;
    } catch (error) {
      setRun((current) =>
        current ? { ...current, finished: true, result: { error: error?.message } } : current,
      );
      return null;
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    const result = await startRun({
      kind: 'upload',
      label: `Processing ${file.name}`,
      execute: (onStage) => importFile(file, { onStage }),
    });
    const documentId = result?.content?.documentId;
    if (documentId && result?.ok) {
      selectDocument(documentId);
      navigate(routeBuilders.workspace(documentId));
    }
  };

  const handleDemo = async () => {
    const result = await startRun({
      kind: 'demo',
      label: 'Loading the demo agreement',
      execute: (onStage) => loadDemoWorkspace({ onStage }),
    });
    const documentId = result?.content?.documentId;
    if (documentId && result?.ok) {
      selectDocument(documentId);
      navigate(routeBuilders.workspace(documentId));
    }
  };

  const handleReanalyze = async (document) => {
    const result = await startRun({
      kind: 'reanalyze',
      label: `Re-analysing ${document.title}`,
      documentId: document.id,
      execute: (onStage) => reanalyzeDocument(document.id, { onStage }),
    });
    if (result?.ok) navigate(routeBuilders.workspace(document.id));
  };

  const busy = Boolean(run) && !run.finished;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Add a document" className="lg:col-span-2">
          <DocumentDropzone
            onFile={handleFile}
            busy={busy}
            busyLabel={run?.label ?? 'Working…'}
            disabled={busy}
          />

          <div className="mt-4 rounded border border-ink-200 p-3">
            <p className="text-sm font-semibold text-ink-900">Start with the demo agreement</p>
            <p className="mt-1 text-xs text-ink-600">
              A fictional Master Services Agreement with three parties, payment and confidentiality
              obligations, renewal conditions, deadlines, a consequence and one deliberate
              contradiction between clauses. It runs through exactly the same pipeline as an upload.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={FilePlus2}
                onClick={handleDemo}
                disabled={busy}
              >
                Load the demo agreement
              </Button>
              <Button
                variant="ghost"
                icon={RotateCcw}
                onClick={() => setResetOpen(true)}
                disabled={busy}
              >
                Reset workspace
              </Button>
            </div>
            <ResetModal
              open={resetOpen}
              onClose={() => setResetOpen(false)}
              onConfirm={() => {
                resetWorkspace();
                navigate(routeBuilders.home());
              }}
            />
          </div>

          <div className="mt-4">
            <Callout tone="info" title="What happens after you load a document">
              Text is parsed with page coordinates, clauses are segmented and typed deterministically,
              an AI provider proposes structured facts, and code verifies every citation before
              anything is shown. Facts that fail verification are listed in the extraction report and
              excluded from the workspace.
            </Callout>
          </div>
        </Panel>

        <Panel title="Provider">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ink-600">Selected provider</dt>
              <dd className="font-medium text-ink-900">{state.ai?.provider ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ink-600">Ready</dt>
              <dd>
                <Badge tone={state.ai?.ready ? 'positive' : 'warning'}>
                  {state.ai?.ready ? 'yes' : 'no'}
                </Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ink-600">Model</dt>
              <dd className="font-medium text-ink-900">{state.ai?.model ?? '—'}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-500">{state.ai?.detail}</p>
          <p className="mt-3 text-xs text-ink-500">
            {APP_NAME} never sends a document to a provider you have not configured; the default is
            the bundled offline mock provider.
          </p>
        </Panel>
      </div>

      {run ? (
        <div className="space-y-3">
          <PipelineProgress
            stages={run.stages}
            title={run.finished ? `${run.label} — finished` : run.label}
          />
          {run.finished && run.result?.rejected ? (
            <Callout tone="warning" title="This document was not accepted">
              {run.result.rejected.message}
            </Callout>
          ) : null}
          {run.finished && run.result?.ok === false && !run.result.rejected ? (
            <Callout tone="warning" title="Extraction refused">
              <p>{run.result.error ?? run.result.report?.statusReason ?? 'Nothing was published.'}</p>
              {state.ai?.provider === AI_PROVIDERS.MOCK ? (
                <p className="mt-1 text-xs text-ink-600">
                  The bundled offline provider only holds the demo agreement, so it returns nothing
                  for other files. Configure a provider before uploading your own documents.
                </p>
              ) : null}
            </Callout>
          ) : null}
        </div>
      ) : null}

      <Panel title="Loaded documents" subtitle={`${documents.length} in this session`}>
        {documents.length === 0 ? (
          <EmptyState icon={FileText} message={EMPTY_STATES.noDocuments} />
        ) : (
          <ul className="space-y-4">
            {documents.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                busy={busy}
                onOpen={() => {
                  selectDocument(document.id);
                  navigate(routeBuilders.workspace(document.id));
                }}
                onReanalyze={() => handleReanalyze(document)}
                onRemove={() => removeDocument(document.id)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function DocumentCard({ document, busy, onOpen, onReanalyze, onRemove }) {
  const coverage = document.coverage;
  const validation = document.report?.validation;

  return (
    <li className="rounded border border-ink-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-ink-900">{document.title}</h3>
            <Badge tone={document.source === 'demo' ? 'accent' : 'neutral'}>{document.source}</Badge>
            {document.extracting ? <Badge tone="warning">working</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-ink-600">
            {document.documentType?.replace(/-/g, ' ')} · {formatDate(document.effectiveDate)} ·{' '}
            {document.pageCount ?? '—'} page(s) · {(document.charCount ?? 0).toLocaleString()} characters
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onOpen}>
            Open
          </Button>
          <Button
            size="sm"
            icon={RefreshCw}
            disabled={busy}
            onClick={onReanalyze}
            title="Re-run extraction and re-verify citations"
          >
            Re-analyse
          </Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <ProgressMeter
          value={coverage?.coverageRatio ?? 0}
          label="Citations verified"
          tone={(coverage?.coverageRatio ?? 0) < 0.6 ? 'warning' : 'accent'}
        />
        <div className="text-xs text-ink-600">
          <p>
            {document.counts?.obligations ?? 0} obligation(s) · {document.counts?.risks ?? 0} risk
            signal(s)
          </p>
          <p className="mt-0.5">
            {document.counts?.inconsistencies ?? 0} inconsistency(ies) ·{' '}
            {document.counts?.relationships ?? 0} relationship(s)
          </p>
        </div>
        <div className="text-xs text-ink-600">
          {validation ? (
            <>
              <p>
                Validation:{' '}
                {validation.errorCount === 0 ? 'passed' : `${validation.errorCount} error(s)`} ·{' '}
                {validation.warningCount} warning(s)
              </p>
              <p className="mt-0.5">
                Evidence rejected: {document.report?.evidence?.rejectedEntities ?? 0}
              </p>
            </>
          ) : (
            <p>{document.extracting ? 'Extraction in progress…' : 'No report yet.'}</p>
          )}
        </div>
      </div>

      {document.warnings?.length > 0 ? (
        <div className="mt-3 space-y-1">
          {document.warnings.map((warning, index) => (
            <p
              key={`${document.id}-warning-${index}`}
              className="flex items-start gap-2 text-xs text-signal-700"
            >
              <Badge tone={severityTone('warning')}>parser</Badge>
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      {document.error ? (
        <p className="mt-3 text-xs text-flag-700">Extraction error: {document.error}</p>
      ) : null}

      {document.stages?.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-accent-600">
            How this document was processed
          </summary>
          <div className="mt-2">
            <PipelineProgress stages={document.stages} title="Ingestion stages" />
          </div>
        </details>
      ) : null}
    </li>
  );
}

export default DocumentsPage;
