import { describe, expect, it } from 'vitest';
import {
  ENTITY_TYPES,
  MODEL_COLLECTION_KEYS,
  createClause,
  createEntityId,
  createLegalModel,
  createObligation,
  createParty,
  createRelationship,
  emptyLegalModel,
  entityLabel,
  getEntity,
  getEntitiesByType,
  indexEntities,
  isLegalModelLike,
  modelCounts,
  slugify,
  stableHash,
} from '../schema.js';

describe('schema: identifiers', () => {
  it('produces stable, readable ids for the same input', () => {
    const first = createEntityId(ENTITY_TYPES.OBLIGATION, 'doc_1:pay invoices');
    const second = createEntityId(ENTITY_TYPES.OBLIGATION, 'doc_1:pay invoices');
    expect(first).toBe(second);
    expect(first.startsWith('obl_')).toBe(true);
  });

  it('produces different ids for different hints and types', () => {
    expect(createEntityId(ENTITY_TYPES.PARTY, 'a')).not.toBe(createEntityId(ENTITY_TYPES.PARTY, 'b'));
    expect(createEntityId(ENTITY_TYPES.PARTY, 'a')).not.toBe(createEntityId(ENTITY_TYPES.CLAUSE, 'a'));
  });

  it('slugifies and hashes deterministically', () => {
    expect(slugify('Section 3.1 — Payment Terms')).toBe('section-3-1-payment-terms');
    expect(slugify('   ')).toBe('item');
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
  });
});

describe('schema: model container', () => {
  it('creates an empty model with every collection present', () => {
    const model = emptyLegalModel('doc_1');
    expect(model.documentId).toBe('doc_1');
    for (const key of MODEL_COLLECTION_KEYS) {
      expect(Array.isArray(model[key])).toBe(true);
    }
    expect(isLegalModelLike(model)).toBe(true);
  });

  it('copies partial collections without sharing the array reference', () => {
    const clause = createClause({ id: 'cl_1', documentId: 'doc_1', text: 'Payment terms.' });
    const source = [clause];
    const model = createLegalModel({ documentId: 'doc_1', clauses: source });
    expect(model.clauses).toHaveLength(1);
    expect(model.clauses).not.toBe(source);
    source.push(createClause({ id: 'cl_2', documentId: 'doc_1', text: 'Extra.' }));
    expect(model.clauses).toHaveLength(1);
    expect(isLegalModelLike({ documentId: 'x' })).toBe(false);
  });

  it('indexes, looks up and counts entities', () => {
    const party = createParty({ id: 'party_1', documentId: 'doc_1', name: 'Acme', role: 'customer' });
    const model = createLegalModel({ documentId: 'doc_1', parties: [party] });
    const index = indexEntities(model);
    expect(index.get('party_1').entityType).toBe(ENTITY_TYPES.PARTY);
    expect(getEntity(model, 'party_1').name).toBe('Acme');
    expect(getEntitiesByType(model, ENTITY_TYPES.PARTY)).toHaveLength(1);
    expect(getEntity(model, 'missing')).toBeNull();
    expect(modelCounts(model).parties).toBe(1);
  });

  it('tolerates malformed models without throwing', () => {
    expect(indexEntities(null).size).toBe(0);
    expect(indexEntities({ documentId: 'x' }).size).toBe(0);
    expect(getEntitiesByType(null, ENTITY_TYPES.PARTY)).toEqual([]);
    expect(modelCounts(null).clauses).toBe(0);
  });
});

describe('schema: factories', () => {
  it('applies defaults and keeps caller values', () => {
    const obligation = createObligation({
      id: 'obl_1',
      documentId: 'doc_1',
      summary: 'Pay invoices',
      clauseId: 'cl_1',
      standard: 'strict',
      evidence: [],
    });
    expect(obligation.type).toBe(ENTITY_TYPES.OBLIGATION);
    expect(obligation.provenance).toBe('ai');
    expect(obligation.confidence).toBe('unknown');
    expect(obligation.informational).toBe(false);
    expect(obligation.standard).toBe('strict');
  });

  it('deep-copies array fields so inputs are not mutated', () => {
    const evidence = [{ id: 'ev_1', documentId: 'doc_1' }];
    const party = createParty({
      id: 'party_1',
      documentId: 'doc_1',
      name: 'Acme',
      evidence,
    });
    evidence.push({ id: 'ev_2', documentId: 'doc_1' });
    expect(party.evidence).toHaveLength(1);
    expect(party.aliases).toEqual([]);
  });

  it('creates relationships with endpoint types and a deterministic id', () => {
    const relationship = createRelationship({
      type: 'clause-imposes-obligation',
      fromId: 'cl_1',
      fromType: ENTITY_TYPES.CLAUSE,
      toId: 'obl_1',
      toType: ENTITY_TYPES.OBLIGATION,
    });
    expect(relationship.id.startsWith('rel_')).toBe(true);
    expect(relationship.directed).toBe(true);
    expect(relationship.provenance).toBe('derived');
  });
});

describe('schema: labels', () => {
  it('labels every entity type readably', () => {
    expect(entityLabel(createClause({ id: 'c', documentId: 'd', number: '3.1', heading: 'Payment', text: 'x' }))).toBe(
      '3.1 Payment',
    );
    expect(entityLabel(createParty({ id: 'p', documentId: 'd', name: 'Acme' }))).toBe('Acme');
    expect(entityLabel(null)).toBe('Unknown');
  });
});
