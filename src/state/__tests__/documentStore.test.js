import { describe, expect, it } from 'vitest';
import { ACTIONS, actions, documentStoreReducer, initialState } from '../documentStore.js';
import { selectDocumentSummaries, selectTrustSummary, selectWorkspaceSummary } from '../selectors.js';
import { buildGraph } from '../../legal/graphEngine.js';
import { TEST_DOCUMENT_ID, buildTestContent, buildValidModel } from '../../legal/__tests__/fixtures.js';

const content = buildTestContent();
const model = buildValidModel();

function withDocument() {
  return documentStoreReducer(
    initialState,
    actions.demoLoaded({
      content,
      loadedAt: '2026-09-19T00:00:00.000Z',
      model,
      graph: buildGraph(model, { documentId: TEST_DOCUMENT_ID }),
      report: { provider: { name: 'mock' }, accepted: true, validation: { errorCount: 0, warningCount: 0 } },
      validation: { valid: true, summary: { errorCount: 0, warningCount: 0 }, warnings: [], issues: [] },
    }),
  );
}

describe('documentStore: reducer', () => {
  it('starts empty', () => {
    expect(initialState.activeDocumentId).toBeNull();
    expect(initialState.order).toEqual([]);
    expect(selectDocumentSummaries(initialState)).toEqual([]);
  });

  it('loads a document and makes it active', () => {
    const state = withDocument();
    expect(state.status).toBe('ready');
    expect(state.activeDocumentId).toBe(TEST_DOCUMENT_ID);
    expect(state.order).toEqual([TEST_DOCUMENT_ID]);
    expect(state.documents[TEST_DOCUMENT_ID].model).toBe(model);
  });

  it('does not duplicate a document that is loaded twice', () => {
    const twice = documentStoreReducer(withDocument(), actions.demoLoaded({ content }));
    expect(twice.order).toEqual([TEST_DOCUMENT_ID]);
  });

  it('tracks an extraction in progress and its failure', () => {
    const started = documentStoreReducer(withDocument(), actions.extractionStarted(TEST_DOCUMENT_ID));
    expect(started.status).toBe('loading');
    expect(started.documents[TEST_DOCUMENT_ID].extracting).toBe(true);

    const failed = documentStoreReducer(started, actions.extractionFailed(TEST_DOCUMENT_ID, 'boom'));
    expect(failed.status).toBe('error');
    expect(failed.documents[TEST_DOCUMENT_ID].extracting).toBe(false);
    expect(failed.documents[TEST_DOCUMENT_ID].error).toBe('boom');
  });

  it('publishes a completed extraction', () => {
    const state = documentStoreReducer(
      documentStoreReducer(initialState, actions.extractionStarted('doc_new')),
      actions.extractionCompleted('doc_new', {
        model,
        graph: null,
        report: null,
        validation: null,
        content,
      }),
    );
    expect(state.order).toEqual(['doc_new']);
    expect(state.status).toBe('ready');
    expect(state.documents.doc_new.error).toBeNull();
  });

  it('selects, removes and re-points the active document', () => {
    const two = documentStoreReducer(
      withDocument(),
      actions.demoLoaded({ content: { ...content, documentId: 'doc_second' } }),
    );
    expect(two.order).toEqual([TEST_DOCUMENT_ID, 'doc_second']);
    expect(two.activeDocumentId).toBe('doc_second');

    const selected = documentStoreReducer(two, actions.documentSelected(TEST_DOCUMENT_ID));
    expect(selected.activeDocumentId).toBe(TEST_DOCUMENT_ID);
    expect(
      documentStoreReducer(selected, actions.documentSelected('missing')).activeDocumentId,
    ).toBe(TEST_DOCUMENT_ID);

    const removed = documentStoreReducer(selected, actions.documentRemoved(TEST_DOCUMENT_ID));
    expect(removed.order).toEqual(['doc_second']);
    expect(removed.activeDocumentId).toBe('doc_second');

    const emptied = documentStoreReducer(removed, actions.documentRemoved('doc_second'));
    expect(emptied.status).toBe('idle');
    expect(emptied.activeDocumentId).toBeNull();
  });

  it('handles notices with a bounded history', () => {
    let state = initialState;
    for (let index = 0; index < 55; index += 1) {
      state = documentStoreReducer(state, actions.noticePushed({ message: `notice ${index}` }));
    }
    expect(state.notices.length).toBe(50);
    const firstId = state.notices[0].id;
    const dismissed = documentStoreReducer(state, actions.noticeDismissed(firstId));
    expect(dismissed.notices.find((notice) => notice.id === firstId)).toBeUndefined();
    expect(documentStoreReducer(dismissed, actions.noticesCleared()).notices).toEqual([]);
  });

  it('updates the AI status and resets the store', () => {
    const updated = documentStoreReducer(
      withDocument(),
      actions.aiStatusUpdated({ provider: 'gemini', ready: false, detail: 'not configured' }),
    );
    expect(updated.ai).toMatchObject({ provider: 'gemini', ready: false });

    const reset = documentStoreReducer(updated, actions.reset());
    expect(reset.order).toEqual([]);
    expect(reset.documents).toEqual({});
    expect(reset.notices).toEqual([]);
  });

  it('ignores unknown actions', () => {
    expect(documentStoreReducer(initialState, { type: 'nope' })).toBe(initialState);
    expect(documentStoreReducer(initialState, undefined)).toBe(initialState);
  });

  it('never mutates the previous state', () => {
    const before = withDocument();
    const snapshot = JSON.stringify(before.documents[TEST_DOCUMENT_ID].model);
    documentStoreReducer(before, actions.extractionStarted(TEST_DOCUMENT_ID));
    expect(JSON.stringify(before.documents[TEST_DOCUMENT_ID].model)).toBe(snapshot);
    expect(ACTIONS.EXTRACTION_STARTED).toBe('extraction/started');
  });
});

describe('selectors', () => {
  const state = withDocument();

  it('summarises loaded documents', () => {
    const [summary] = selectDocumentSummaries(state);
    expect(summary.id).toBe(TEST_DOCUMENT_ID);
    expect(summary.title).toBe('Test Agreement');
    expect(summary.counts.obligations).toBe(2);
    expect(summary.coverage.total).toBeGreaterThan(0);
  });

  it('builds the workspace summary with gaps', () => {
    const summary = selectWorkspaceSummary(state, { today: new Date('2026-09-19T00:00:00Z') });
    expect(summary.ready).toBe(true);
    expect(summary.counts.clauses).toBe(3);
    expect(summary.graphStats.relationshipCount).toBeGreaterThan(0);
    expect(summary.timeline.entries.length).toBeGreaterThan(0);
    expect(summary.gaps.map((gap) => gap.code)).toContain('gap.no-deadline');
  });

  it('returns an empty summary when nothing is loaded', () => {
    const empty = selectWorkspaceSummary(initialState);
    expect(empty.ready).toBe(false);
    expect(empty.gaps).toEqual([]);
  });

  it('summarises trust data', () => {
    const trust = selectTrustSummary(state);
    expect(trust.provider.name).toBe('mock');
    expect(trust.accepted).toBe(true);
    expect(trust.validation.errorCount).toBe(0);
  });
});
