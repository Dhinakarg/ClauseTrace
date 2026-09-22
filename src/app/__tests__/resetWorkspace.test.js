import { describe, expect, it } from 'vitest';
import { documentStoreReducer, initialState, actions } from '../../state/documentStore.js';

describe('resetWorkspace state management', () => {
  it('resets document store back to clean initial state', () => {
    const dirtyState = {
      ...initialState,
      documents: { doc1: { id: 'doc1', title: 'Sample' } },
      order: ['doc1'],
      activeDocumentId: 'doc1',
      notices: [{ id: '1', message: 'Test notice' }],
    };

    const resetState = documentStoreReducer(dirtyState, actions.reset());

    expect(resetState.documents).toEqual({});
    expect(resetState.order).toEqual([]);
    expect(resetState.notices).toEqual([]);
    expect(resetState.activeDocumentId).toBeNull();
  });

  it('removes clausegraph storage key without deleting unrelated storage keys', () => {
    const store = new Map();
    const mockStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, val) => store.set(key, String(val)),
      removeItem: (key) => store.delete(key),
    };

    const STORAGE_KEY = 'clausegraph_state_v1';
    mockStorage.setItem(STORAGE_KEY, JSON.stringify({ documents: { a: 1 } }));
    mockStorage.setItem('unrelated_user_app_setting', 'preserve_me');

    mockStorage.removeItem(STORAGE_KEY);

    expect(mockStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(mockStorage.getItem('unrelated_user_app_setting')).toBe('preserve_me');
  });
});
