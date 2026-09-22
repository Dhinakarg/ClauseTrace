/**
 * Ingestion pipeline.
 *
 * One function that takes a file (or already-parsed content) and walks it
 * through every stage to a published legal model:
 *
 *   received → text extracted → clauses → entities → relationships → evidence → ready
 *
 * Two rules shape the design:
 *   1. The stages are a report. Each one is only marked done when its work
 *      actually finished; a rejected upload fails at stage one and the rest are
 *      explicitly skipped rather than implied.
 *   2. The pipeline never throws at the caller. Every failure is a value:
 *      `{ ok: false, rejected }` or `{ ok: false, error }`. Callers decide how to
 *      tell the user; nothing here decides that silently.
 */

import { PIPELINE_STAGES, STAGE_IDS, STAGE_STATUS, createStageTracker } from './stages.js';
import {
  describeParsedContent,
  nonBlockingWarnings,
  validateParsedContent,
  validateUploadFile,
} from './upload.js';
import { parseDocumentFile } from './parser.js';
import { runExtraction } from '../ai/extractionService.js';

/** The stages the UI shows before a run starts (all pending). */
export function pendingStages() {
  return PIPELINE_STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    detail: stage.detail,
    status: STAGE_STATUS.PENDING,
    metrics: null,
    message: null,
    startedAt: null,
    endedAt: null,
  }));
}

/**
 * Runs the pipeline for one document.
 *
 * @param {object} args
 * @param {File|null} args.file        uploaded file (optional when content is supplied)
 * @param {object|null} args.content   already-parsed content (demo path)
 * @param {object} args.provider       AI provider implementing extractLegalFacts
 * @param {object} args.options        forwarded to runExtraction
 * @param {(stage: object) => void} args.onStage  stage listener for the UI
 */
export async function runDocumentPipeline({
  file = null,
  content = null,
  provider = null,
  options = {},
  onStage = null,
  now,
} = {}) {
  const tracker = createStageTracker({ onStage, now: now ?? (() => Date.now()) });
  const notices = [];
  let resolvedContent = content ?? null;
  let uploadReport = null;

  const fail = (stage, message, extra = {}) => {
    tracker.report(stage, { status: STAGE_STATUS.FAILED, message });
    tracker.skipRemaining(stage, 'Not attempted because an earlier stage failed.');
    return {
      ok: false,
      content: resolvedContent,
      model: null,
      report: null,
      validation: null,
      rejected: { stage, message, ...extra },
      error: null,
      notices,
      stages: tracker.snapshot(),
      summary: tracker.summary(),
    };
  };

  /* Stage 1: received ------------------------------------------------------ */
  tracker.report(STAGE_IDS.RECEIVED, { status: STAGE_STATUS.ACTIVE, message: 'Checking the file.' });

  if (file) {
    uploadReport = validateUploadFile(file, options.limits ? { limits: options.limits } : {});
    if (!uploadReport.ok) {
      return fail(STAGE_IDS.RECEIVED, uploadReport.message, {
        code: uploadReport.code,
        severity: uploadReport.severity,
        file: uploadReport.file,
      });
    }
    tracker.report(STAGE_IDS.RECEIVED, {
      metrics: {
        name: uploadReport.file.name,
        sizeBytes: uploadReport.file.sizeBytes,
        fileType: uploadReport.file.fileType,
        fileTypeLabel: uploadReport.file.fileTypeLabel,
      },
    });
  } else if (resolvedContent) {
    const metrics = describeParsedContent(resolvedContent);
    tracker.report(STAGE_IDS.RECEIVED, {
      metrics: {
        name: metrics?.fileName ?? null,
        sizeBytes: metrics?.byteSize ?? null,
        fileType: metrics?.fileType ?? null,
        fileTypeLabel: metrics?.fileTypeLabel ?? null,
      },
      message: 'Content supplied directly (no file to check).',
    });
  } else {
    return fail(STAGE_IDS.RECEIVED, 'Nothing was supplied to analyse.', {
      code: 'upload.no-file',
    });
  }

  /* Stage 2: text extracted ----------------------------------------------- */
  tracker.report(STAGE_IDS.TEXT_EXTRACTED, {
    status: STAGE_STATUS.ACTIVE,
    message: file ? 'Reading the document.' : 'Using supplied content.',
  });

  if (file) {
    try {
      resolvedContent = await parseDocumentFile(file, options.parseOptions ?? {});
    } catch (error) {
      return fail(
        STAGE_IDS.TEXT_EXTRACTED,
        `The document could not be read: ${error?.message ?? 'unknown error'}`,
        { code: 'upload.unreadable' },
      );
    }
  }

  const contentCheck = validateParsedContent(
    resolvedContent,
    options.limits ? { limits: options.limits } : {},
  );
  if (!contentCheck.ok) {
    return fail(STAGE_IDS.TEXT_EXTRACTED, contentCheck.message, {
      code: contentCheck.code,
      severity: contentCheck.severity,
      warnings: contentCheck.warnings,
      metrics: contentCheck.metrics,
    });
  }

  notices.push(
    ...nonBlockingWarnings(resolvedContent).map((message) => ({ level: 'warning', message })),
  );
  tracker.report(STAGE_IDS.TEXT_EXTRACTED, { metrics: contentCheck.metrics });

  /* Stages 3-6: extraction, reported by the extraction service -------------- */
  let extraction;
  try {
    extraction = await runExtraction({
      content: resolvedContent,
      provider,
      options: {
        ...options,
        onStage: (patch) => {
          const { stage, status = STAGE_STATUS.DONE, metrics = null, message = null } = patch ?? {};
          if (stage) tracker.report(stage, { status, metrics, message });
        },
      },
    });
  } catch (error) {
    const message = `Extraction failed: ${error?.message ?? 'unknown error'}`;
    const failedStage =
      tracker.snapshot().find((stage) => stage.status === STAGE_STATUS.ACTIVE)?.id ??
      STAGE_IDS.ENTITIES_EXTRACTED;
    tracker.report(failedStage, { status: STAGE_STATUS.FAILED, message });
    tracker.skipRemaining(failedStage, 'Not attempted because extraction failed.');
    return {
      ok: false,
      content: resolvedContent,
      model: null,
      report: null,
      validation: null,
      rejected: null,
      error: message,
      notices,
      stages: tracker.snapshot(),
      summary: tracker.summary(),
    };
  }

  const { model, report, validation } = extraction;
  // A model that validates but was produced without a single usable provider
  // response is not a ready workspace: the report says the extraction failed, so
  // the pipeline must not imply otherwise.
  const accepted =
    Boolean(model) && Boolean(validation?.valid) && report?.status !== 'failed';

  /* Stage 7: workspace ready ---------------------------------------------- */
  if (!accepted) {
    tracker.report(STAGE_IDS.WORKSPACE_READY, {
      status: STAGE_STATUS.FAILED,
      message:
        report?.statusReason ??
        'The extraction did not pass validation, so nothing was published to the workspace.',
      metrics: { accepted: false, status: report?.status ?? 'failed' },
    });
  } else {
    tracker.report(STAGE_IDS.WORKSPACE_READY, {
      metrics: {
        accepted: true,
        clauses: report?.clauseCount ?? model?.clauses?.length ?? 0,
        facts: report?.evidenceIndex?.facts ?? 0,
        verified: report?.evidenceIndex?.verified ?? 0,
        unverifiable: report?.evidenceIndex?.missingCitations ?? 0,
      },
    });
  }

  return {
    ok: accepted,
    content: resolvedContent,
    model,
    report,
    validation,
    extracted: extraction,
    rejected: null,
    error: null,
    notices,
    stages: tracker.snapshot(),
    summary: tracker.summary(),
  };
}
