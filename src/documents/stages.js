/**
 * Pipeline stages.
 *
 * One vocabulary for the ingestion pipeline, shared by the AI layer (which
 * reports the stages it owns) and the UI (which renders them). Deliberately
 * dependency-free so nothing has to import the extraction service just to name
 * a stage.
 *
 * The stages are a *report*, not a promise: a stage only reaches `done` when the
 * work it names actually finished. Anything skipped or failed stays visible.
 */

/** Ordered stages of the ingestion pipeline. */
export const PIPELINE_STAGES = Object.freeze([
  {
    id: 'received',
    label: 'Document received',
    detail: 'File type, size and page count checked before anything is read.',
  },
  {
    id: 'text-extracted',
    label: 'Text extracted',
    detail: 'Text layer normalized; page and character offsets recorded.',
  },
  {
    id: 'clauses-identified',
    label: 'Clauses identified',
    detail: 'Deterministic segmentation into clauses, typed and chunked for the model.',
  },
  {
    id: 'entities-extracted',
    label: 'Entities extracted',
    detail: 'The model proposes structured facts; unknown fields and invalid items are dropped.',
  },
  {
    id: 'relationships-built',
    label: 'Relationships built',
    detail: 'Proposed edges validated against real ids, then the rest derived deterministically.',
  },
  {
    id: 'evidence-validated',
    label: 'Evidence validated',
    detail: 'Every quoted citation is checked against the document; unverifiable facts are withheld.',
  },
  {
    id: 'workspace-ready',
    label: 'Workspace ready',
    detail: 'Model validated and published to the workspace.',
  },
]);

/** Named stage ids, so callers never pass a typo'd or missing string. */
export const STAGE_IDS = Object.freeze({
  RECEIVED: 'received',
  TEXT_EXTRACTED: 'text-extracted',
  CLAUSES_IDENTIFIED: 'clauses-identified',
  ENTITIES_EXTRACTED: 'entities-extracted',
  RELATIONSHIPS_BUILT: 'relationships-built',
  EVIDENCE_VALIDATED: 'evidence-validated',
  WORKSPACE_READY: 'workspace-ready',
});

export const STAGE_STATUS = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

/** Index of a stage id, used to keep the list monotonic. */
export function stageIndex(stageId) {
  return PIPELINE_STAGES.findIndex((stage) => stage.id === stageId);
}

export function stageDefinition(stageId) {
  return PIPELINE_STAGES.find((stage) => stage.id === stageId) ?? null;
}

/**
 * Tracks stage state for one pipeline run.
 * Pure bookkeeping: no rendering, no timers beyond an injectable clock, so it
 * can be asserted in tests without fake timers.
 */
export function createStageTracker({ onStage = null, now = () => Date.now() } = {}) {
  const states = PIPELINE_STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    detail: stage.detail,
    status: STAGE_STATUS.PENDING,
    metrics: null,
    message: null,
    startedAt: null,
    endedAt: null,
  }));

  const find = (stageId) => states.find((state) => state.id === stageId) ?? null;

  const tracker = {
    /** Records a stage transition and notifies the listener. */
    report(stageId, { status = STAGE_STATUS.DONE, metrics = null, message = null } = {}) {
      const state = find(stageId);
      if (!state) return null;
      state.status = status;
      if (metrics !== null) state.metrics = metrics;
      state.message = message ?? state.message;
      if (status === STAGE_STATUS.ACTIVE) state.startedAt = now();
      if (status === STAGE_STATUS.DONE || status === STAGE_STATUS.FAILED) state.endedAt = now();
      const snapshot = { ...state };
      onStage?.(snapshot);
      return snapshot;
    },
    /** Marks every remaining pending stage as skipped (used on hard failure). */
    skipRemaining(fromStageId, message = null) {
      const from = stageIndex(fromStageId);
      for (const state of states) {
        if (stageIndex(state.id) > from && state.status === STAGE_STATUS.PENDING) {
          state.status = STAGE_STATUS.SKIPPED;
          state.message = message;
          onStage?.({ ...state });
        }
      }
    },
    get(stageId) {
      return find(stageId) ? { ...find(stageId) } : null;
    },
    snapshot() {
      return states.map((state) => ({ ...state }));
    },
    /** Summary counts for the report and the UI header. */
    summary() {
      return states.reduce(
        (summary, state) => {
          summary[state.status] = (summary[state.status] ?? 0) + 1;
          return summary;
        },
        { pending: 0, active: 0, done: 0, failed: 0, skipped: 0 },
      );
    },
  };

  return tracker;
}
