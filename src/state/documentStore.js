/**
 * Document store (pure reducer + selectors).
 *
 * State shape:
 *   {
 *     status: 'idle' | 'loading' | 'ready' | 'error',
 *     activeDocumentId: string | null,
 *     order: string[],
 *     documents: {
 *       [documentId]: {
 *         id, source, loadedAt, content, model, graph, extractionReport,
 *         validation, warnings, error, extracting, stages, stageSummary
 *       }
 *     },
 *     notices: [{ id, level, message, at, scope }],
 *     ai: { provider, model, ready, detail }
 *   }
 *
 * The reducer is pure: no fetching, no Date.now() inside state transitions
 * except through the action payload, which keeps it trivially testable.
 */

export const initialState = Object.freeze({
  status: 'idle',
  activeDocumentId: null,
  order: [],
  documents: {},
  notices: [],
  ai: { provider: 'mock', model: null, ready: true, detail: null },
});

export const ACTIONS = Object.freeze({
  DEMO_LOADED: 'demo/loaded',
  EXTRACTION_STARTED: 'extraction/started',
  EXTRACTION_STAGE: 'extraction/stage',
  EXTRACTION_COMPLETED: 'extraction/completed',
  EXTRACTION_FAILED: 'extraction/failed',
  DOCUMENT_SELECTED: 'document/selected',
  DOCUMENT_REMOVED: 'document/removed',
  NOTICE_PUSHED: 'notice/pushed',
  NOTICE_DISMISSED: 'notice/dismissed',
  NOTICES_CLEARED: 'notice/cleared',
  AI_STATUS_UPDATED: 'ai/status-updated',
  STATE_RESET: 'state/reset',
});

let noticeCounter = 0;

/** Action creators. */
export const actions = {
  demoLoaded: (entry) => ({ type: ACTIONS.DEMO_LOADED, entry }),
  extractionStarted: (documentId) => ({ type: ACTIONS.EXTRACTION_STARTED, documentId }),
  extractionStage: (documentId, { stages, summary = null }) => ({
    type: ACTIONS.EXTRACTION_STAGE,
    documentId,
    stages,
    summary,
  }),
  extractionCompleted: (documentId, { model, graph, report, validation, content, stages, summary }) => ({
    type: ACTIONS.EXTRACTION_COMPLETED,
    documentId,
    model,
    graph,
    report,
    validation,
    content,
    stages,
    summary,
  }),
  extractionFailed: (documentId, error) => ({ type: ACTIONS.EXTRACTION_FAILED, documentId, error }),
  documentSelected: (documentId) => ({ type: ACTIONS.DOCUMENT_SELECTED, documentId }),
  documentRemoved: (documentId) => ({ type: ACTIONS.DOCUMENT_REMOVED, documentId }),
  noticePushed: (notice) => ({
    type: ACTIONS.NOTICE_PUSHED,
    notice: { id: `notice-${(noticeCounter += 1)}`, at: notice.at ?? null, ...notice },
  }),
  noticeDismissed: (noticeId) => ({ type: ACTIONS.NOTICE_DISMISSED, noticeId }),
  noticesCleared: () => ({ type: ACTIONS.NOTICES_CLEARED }),
  aiStatusUpdated: (ai) => ({ type: ACTIONS.AI_STATUS_UPDATED, ai }),
  reset: () => ({ type: ACTIONS.STATE_RESET }),
};

function upsertDocument(state, documentId, patch) {
  const existing = state.documents[documentId] ?? { id: documentId };
  return {
    ...state.documents,
    [documentId]: { ...existing, ...patch, id: documentId },
  };
}

export function documentStoreReducer(state = initialState, action) {
  switch (action?.type) {
    case ACTIONS.DEMO_LOADED: {
      const { entry } = action;
      const documentId = entry.content?.documentId ?? entry.id;
      const alreadyLoaded = Boolean(state.documents[documentId]);
      return {
        ...state,
        status: 'ready',
        activeDocumentId: documentId,
        order: alreadyLoaded ? state.order : [...state.order, documentId],
        documents: upsertDocument(state, documentId, {
          source: entry.source ?? 'demo',
          loadedAt: entry.loadedAt ?? null,
          content: entry.content,
          model: entry.model ?? null,
          graph: entry.graph ?? null,
          extractionReport: entry.report ?? null,
          validation: entry.validation ?? null,
          warnings: entry.content?.warnings ?? [],
          stages: entry.stages ?? [],
          stageSummary: entry.summary ?? null,
          error: null,
        }),
      };
    }

    case ACTIONS.EXTRACTION_STARTED:
      return {
        ...state,
        status: 'loading',
        documents: upsertDocument(state, action.documentId, { error: null, extracting: true }),
      };

    case ACTIONS.EXTRACTION_STAGE:
      return {
        ...state,
        documents: upsertDocument(state, action.documentId, {
          stages: action.stages ?? state.documents[action.documentId]?.stages ?? [],
          stageSummary: action.summary ?? state.documents[action.documentId]?.stageSummary ?? null,
        }),
      };

    case ACTIONS.EXTRACTION_COMPLETED: {
      const documentId = action.documentId;
      return {
        ...state,
        status: 'ready',
        order: state.order.includes(documentId) ? state.order : [...state.order, documentId],
        documents: upsertDocument(state, documentId, {
          content: action.content ?? state.documents[documentId]?.content ?? null,
          model: action.model ?? null,
          graph: action.graph ?? null,
          extractionReport: action.report ?? null,
          validation: action.validation ?? null,
          stages: action.stages ?? state.documents[documentId]?.stages ?? [],
          stageSummary: action.summary ?? state.documents[documentId]?.stageSummary ?? null,
          extracting: false,
          error: null,
        }),
      };
    }

    case ACTIONS.EXTRACTION_FAILED:
      return {
        ...state,
        status: 'error',
        documents: upsertDocument(state, action.documentId, {
          extracting: false,
          error: action.error ?? 'Extraction failed.',
        }),
      };

    case ACTIONS.DOCUMENT_SELECTED:
      if (!state.documents[action.documentId]) return state;
      return { ...state, activeDocumentId: action.documentId };

    case ACTIONS.DOCUMENT_REMOVED: {
      const documents = { ...state.documents };
      delete documents[action.documentId];
      const order = state.order.filter((id) => id !== action.documentId);
      return {
        ...state,
        documents,
        order,
        activeDocumentId:
          state.activeDocumentId === action.documentId ? order[0] ?? null : state.activeDocumentId,
        status: order.length === 0 ? 'idle' : state.status,
      };
    }

    case ACTIONS.NOTICE_PUSHED:
      return { ...state, notices: [action.notice, ...state.notices].slice(0, 50) };

    case ACTIONS.NOTICE_DISMISSED:
      return { ...state, notices: state.notices.filter((notice) => notice.id !== action.noticeId) };

    case ACTIONS.NOTICES_CLEARED:
      return { ...state, notices: [] };

    case ACTIONS.AI_STATUS_UPDATED:
      return { ...state, ai: { ...state.ai, ...action.ai } };

    case ACTIONS.STATE_RESET:
      return { ...initialState, documents: {}, order: [], notices: [] };

    default:
      return state;
  }
}
