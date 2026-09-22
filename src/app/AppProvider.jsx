/**
 * App state provider.
 *
 * Owns the single store instance and exposes intent-level operations to the UI
 * (`loadDemoWorkspace`, `importFile`, `selectDocument`). Components never fetch,
 * never call providers directly and never mutate state.
 *
 * This is the ONLY module in the app shell that talks to the AI layer, which
 * keeps AI calls out of navigation and presentation components.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { documentStoreReducer, initialState, actions } from '../state/documentStore.js';
import { buildGraph } from '../legal/graphEngine.js';
import { runDocumentPipeline } from '../documents/pipeline.js';
import { DEMO_NOTES, createDemoProvider, loadDemoDocument } from '../data/demo/index.js';
import { describeAIStatus, getAIConfig, getProviderName } from '../ai/config.js';
import { createProvider } from '../ai/provider.js';
import { answerDocumentQuestion } from '../ai/askService.js';
import { createDocumentId, isSupportedFile } from '../documents/parser.js';
import { LIMITS } from '../security/limits.js';

const STORAGE_KEY = 'clausegraph_state_v1';

function loadInitialState() {
  if (typeof window === 'undefined') return initialState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.documents) {
        return {
          ...initialState,
          documents: parsed.documents || {},
          activeDocumentId: parsed.activeDocumentId || null,
        };
      }
    }
  } catch {
    // Ignore storage parse errors
  }
  return initialState;
}

const AppStateContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(documentStoreReducer, null, loadInitialState);
  const providerRef = useRef(null);
  const extractionRunsRef = useRef(new Set());

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          documents: state.documents,
          activeDocumentId: state.activeDocumentId,
        }),
      );
    } catch {
      // Ignore quota errors
    }
  }, [state.documents, state.activeDocumentId]);

  /** Lazily resolves the configured provider, defaulting to the demo provider. */
  const getProvider = useCallback(async () => {
    if (providerRef.current) return providerRef.current;
    const config = getAIConfig();
    providerRef.current =
      getProviderName() === 'mock' ? createDemoProvider() : await createProvider(config);
    const status = describeAIStatus(config);
    dispatch(
      actions.aiStatusUpdated({
        provider: status.provider,
        model: config.model,
        ready: status.ready,
        detail: status.detail,
        label: status.label,
      }),
    );
    return providerRef.current;
  }, []);

  const pushNotice = useCallback((notice) => {
    dispatch(actions.noticePushed({ level: 'info', ...notice }));
  }, []);

  /**
   * Runs the ingestion pipeline and publishes the outcome.
   *
   * Every transition is forwarded to the caller (for the staged UI) and recorded
   * on the document entry, so the workspace can show how a document was
   * processed after the fact. A rejected upload never enters the store: there is
   * nothing to show, and a card for an unreadable file would imply there is.
   */
  const runPipeline = useCallback(
    async ({ file = null, content = null, hints = {}, source = 'upload', onStage = null } = {}) => {
      const expectedDocumentId = content?.documentId ?? (file ? createDocumentId(file.name, file.size) : null);
      const stageLog = [];
      let parsed = Boolean(content);

      const handleStage = (snapshot) => {
        stageLog.push(snapshot);
        onStage?.(snapshot);
        if (expectedDocumentId) {
          dispatch(
            actions.extractionStage(expectedDocumentId, { stages: [...stageLog], summary: null }),
          );
        }
      };

      if (expectedDocumentId) dispatch(actions.extractionStarted(expectedDocumentId));

      let provider = null;
      try {
        provider = await getProvider();
      } catch (error) {
        pushNotice({ level: 'error', message: `AI provider unavailable: ${error?.message}` });
      }

      const result = await runDocumentPipeline({
        file,
        content,
        provider,
        options: { documentHints: hints },
        onStage: handleStage,
      });

      // The document itself is real as soon as a text layer exists, even if the
      // extraction that follows is refused. Publishing it keeps the library
      // honest about what was read.
      const parsedContent = result.content;
      if (!parsed && parsedContent?.text && parsedContent.documentId) {
        dispatch(
          actions.demoLoaded({
            content: parsedContent,
            source,
            loadedAt: new Date().toISOString(),
            warnings: parsedContent.warnings,
          }),
        );
        parsed = true;
      }

      for (const notice of result.notices ?? []) pushNotice(notice);

      const documentId = parsedContent?.documentId ?? expectedDocumentId;
      if (!result.ok) {
        const message = result.rejected?.message ?? result.error ?? 'The document could not be analysed.';
        if (parsed && documentId) {
          dispatch(actions.extractionFailed(documentId, message));
        }
        pushNotice({ level: 'warning', message });
        return result;
      }

      const graph = result.model ? buildGraph(result.model, { documentId }) : null;
      dispatch(
        actions.extractionCompleted(documentId, {
          model: result.model,
          graph,
          report: result.report,
          validation: result.validation,
          content: parsedContent,
          stages: result.stages,
          summary: result.summary,
        }),
      );

      if (result.report?.evidence?.rejectedEntities > 0) {
        pushNotice({
          level: 'warning',
          message: `${result.report.evidence.rejectedEntities} proposed fact(s) were withheld because their quoted text could not be verified against the document.`,
        });
      }

      return result;
    },
    [getProvider, pushNotice],
  );

  /** Loads the bundled demo document, extracts it and publishes the model. */
  const loadDemoWorkspace = useCallback(
    async ({ onStage = null } = {}) => {
      const demo = loadDemoDocument();
      const result = await runPipeline({
        content: demo.content,
        hints: {
          title: demo.meta.title,
          documentType: demo.meta.documentType,
          effectiveDate: demo.meta.effectiveDate,
        },
        source: 'demo',
        onStage,
      });

      if (demo.problems.length > 0) {
        pushNotice({
          level: 'warning',
          message: `The demo fixture quotes ${demo.problems.length} passage(s) that no longer match the demo document text.`,
        });
      }
      for (const note of DEMO_NOTES) pushNotice({ level: 'info', message: note });
      return demo.content.documentId ?? result.content?.documentId ?? null;
    },
    [pushNotice, runPipeline],
  );

  /** Runs a user-supplied file through the full pipeline. */
  const importFile = useCallback(
    async (file, { onStage = null } = {}) => {
      if (!file) return null;
      if (!isSupportedFile(file)) {
        pushNotice({
          level: 'warning',
          message: `Unsupported file "${file.name}". ClauseGraph reads PDF, TXT and Markdown documents.`,
        });
        return null;
      }
      if (file.size > LIMITS.MAX_FILE_BYTES) {
        pushNotice({
          level: 'warning',
          message: `"${file.name}" is larger than the ${Math.round(LIMITS.MAX_FILE_BYTES / (1024 * 1024))} MB limit.`,
        });
        return null;
      }

      const result = await runPipeline({
        file,
        hints: { title: file.name },
        source: 'upload',
        onStage,
      });
      return result.content?.documentId ?? null;
    },
    [pushNotice, runPipeline],
  );

  /** Re-runs extraction for a loaded document, guarded against double runs. */
  const reanalyzeDocument = useCallback(
    async (documentId, { onStage = null } = {}) => {
      const entry = documentId ? state.documents[documentId] : null;
      if (!entry?.content) return null;
      if (extractionRunsRef.current.has(entry.id)) return null;
      extractionRunsRef.current.add(entry.id);
      try {
        return await runPipeline({
          content: entry.content,
          hints: entry.model?.documents?.[0]?.title ? { title: entry.model.documents[0].title } : { title: entry.content.fileName },
          source: entry.source ?? 'upload',
          onStage,
        });
      } finally {
        extractionRunsRef.current.delete(entry.id);
      }
    },
    [runPipeline, state.documents],
  );

  const selectDocument = useCallback((documentId) => {
    dispatch(actions.documentSelected(documentId));
  }, []);
  /**
   * Answers a question over one loaded document.
   *
   * This is the only place the Ask route reaches the AI layer: the question, the
   * retrieved clauses, the provider call and the validation all live behind this
   * one call, so the page stays presentational.
   */
  const askDocument = useCallback(
    async ({ documentId = null, question, signal = null, maxMatches = 3 } = {}) => {
      const id = documentId ?? state.activeDocumentId;
      const entry = id ? state.documents[id] : null;
      if (!entry?.model) return null;

      let provider = null;
      try {
        provider = await getProvider();
      } catch (error) {
        pushNotice({ level: 'error', message: `AI provider unavailable: ${error?.message}` });
      }

      return answerDocumentQuestion({
        model: entry.model,
        content: entry.content ?? null,
        question,
        documentId: id,
        provider,
        signal,
        maxMatches,
      });
    },
    [getProvider, pushNotice, state.activeDocumentId, state.documents],
  );
  const removeDocument = useCallback((documentId) => {
    dispatch(actions.documentRemoved(documentId));
  }, []);

  const dismissNotice = useCallback((noticeId) => {
    dispatch(actions.noticeDismissed(noticeId));
  }, []);

  const clearNotices = useCallback(() => {
    dispatch(actions.noticesCleared());
  }, []);

  const resetWorkspace = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.clear();
      } catch (err) {
        // ignore storage errors
      }
    }
    dispatch(actions.reset());
    pushNotice({ level: 'info', message: 'Workspace reset to initial clean state.' });
  }, [pushNotice]);

  // Resolve the provider (and its readiness label) once on mount.
  useEffect(() => {
    getProvider().catch((error) => {
      pushNotice({ level: 'error', message: `AI provider unavailable: ${error?.message}` });
    });
  }, [getProvider, pushNotice]);

  const value = useMemo(
    () => ({
      state,
      dispatch,
      loadDemoWorkspace,
      importFile,
      reanalyzeDocument,
      askDocument,
      selectDocument,
      removeDocument,
      pushNotice,
      dismissNotice,
      clearNotices,
      resetWorkspace,
    }),
    [
      state,
      loadDemoWorkspace,
      importFile,
      reanalyzeDocument,
      askDocument,
      selectDocument,
      removeDocument,
      pushNotice,
      dismissNotice,
      clearNotices,
      resetWorkspace,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) throw new Error('useAppState must be used inside <AppProvider>.');
  return context;
}

/** Convenience hook for read-only state access. */
export function useAppStore() {
  return useAppState().state;
}


