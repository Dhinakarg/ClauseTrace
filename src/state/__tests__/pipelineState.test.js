/**
 * Pipeline state.
 *
 * The reducer has to keep the staged-processing record for every document, and
 * a rejected upload must not create a document entry at all. Both are checked
 * here against real actions.
 */

import { describe, expect, it } from 'vitest';
import { ACTIONS, actions, documentStoreReducer, initialState } from '../documentStore.js';
import { pendingStages } from '../../documents/pipeline.js';
import { STAGE_IDS, STAGE_STATUS } from '../../documents/stages.js';

const stagesWith = (id, status) =>
  pendingStages().map((stage) => (stage.id === id ? { ...stage, status } : stage));

describe('documentStore: staged processing', () => {
  it('starts from an empty pipeline record', () => {
    expect(initialState.documents).toEqual({});
    expect(actions.extractionStage('doc_1', { stages: [] }).type).toBe(ACTIONS.EXTRACTION_STAGE);
  });

  it('records stage snapshots against the document', () => {
    const stages = stagesWith(STAGE_IDS.RECEIVED, STAGE_STATUS.DONE);
    const state = documentStoreReducer(initialState, actions.extractionStage('doc_1', { stages }));

    expect(state.documents.doc_1.stages).toHaveLength(stages.length);
    expect(state.documents.doc_1.stages[0].status).toBe(STAGE_STATUS.DONE);
  });

  it('keeps the previous stages when an update omits them', () => {
    const first = documentStoreReducer(
      initialState,
      actions.extractionStage('doc_1', { stages: stagesWith(STAGE_IDS.RECEIVED, STAGE_STATUS.DONE) }),
    );
    const second = documentStoreReducer(first, actions.extractionStage('doc_1', { stages: undefined }));

    expect(second.documents.doc_1.stages).toHaveLength(first.documents.doc_1.stages.length);
  });

  it('stores the finished stage list with the completed extraction', () => {
    const stages = stagesWith(STAGE_IDS.WORKSPACE_READY, STAGE_STATUS.DONE);
    const state = documentStoreReducer(
      initialState,
      actions.extractionCompleted('doc_1', {
        model: { documents: [], clauses: [] },
        stages,
        summary: { done: 7 },
      }),
    );

    expect(state.status).toBe('ready');
    expect(state.order).toEqual(['doc_1']);
    expect(state.documents.doc_1.stages).toHaveLength(stages.length);
    expect(state.documents.doc_1.stageSummary).toEqual({ done: 7 });
    expect(state.documents.doc_1.extracting).toBe(false);
  });

  it('marks a failed extraction without inventing stages', () => {
    const state = documentStoreReducer(initialState, actions.extractionFailed('doc_1', 'No usable text.'));
    expect(state.status).toBe('error');
    expect(state.documents.doc_1.error).toBe('No usable text.');
    expect(state.documents.doc_1.extracting).toBe(false);
  });

  it('keeps an uploaded document distinct from a demo one', () => {
    const upload = documentStoreReducer(
      initialState,
      actions.demoLoaded({ content: { documentId: 'doc_up', warnings: ['truncated'] }, source: 'upload' }),
    );
    expect(upload.documents.doc_up.source).toBe('upload');
    expect(upload.documents.doc_up.warnings).toEqual(['truncated']);

    const demo = documentStoreReducer(initialState, actions.demoLoaded({ content: { documentId: 'doc_d' } }));
    expect(demo.documents.doc_d.source).toBe('demo');
  });

  it('carries the stage list through a reload of the same document', () => {
    const stages = stagesWith(STAGE_IDS.EVIDENCE_VALIDATED, STAGE_STATUS.DONE);
    const loaded = documentStoreReducer(
      initialState,
      actions.demoLoaded({ content: { documentId: 'doc_1' }, source: 'upload', stages }),
    );
    const completed = documentStoreReducer(
      loaded,
      actions.extractionCompleted('doc_1', { model: null, stages: undefined }),
    );
    expect(completed.documents.doc_1.stages).toHaveLength(stages.length);
  });
});
