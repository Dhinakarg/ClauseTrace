/**
 * Evidence mapping.
 *
 * Verification answers "is this quote in the document?". Mapping answers the
 * other direction: given a clause (or a fact), which extracted facts cite it, and
 * where exactly in the source does a citation point? The workspace depends on
 * both, so both are covered here.
 */

import { describe, expect, it } from 'vitest';
import {
  FACT_COLLECTIONS,
  collectFacts,
  factClauseIds,
  factsForClause,
  factsForEntity,
  indexClauseFacts,
  mapReferenceToSource,
  summarizeClauseEvidence,
  verifyModelEvidence,
} from '../evidence.js';
import { buildTestContent, buildValidModel, TEST_DOCUMENT_ID } from '../../legal/__tests__/fixtures.js';
import { createClausesFromSections, segmentIntoClauses } from '../chunker.js';

const content = buildTestContent();
// Facts only count as verified once the real verifier has run, so the mapping
// tests use a model that has been through it.
const model = verifyModelEvidence(buildValidModel(), content).model;
const clauses = createClausesFromSections(content.documentId, segmentIntoClauses(content).sections);

describe('evidence mapping: fact collection', () => {
  it('covers the AI-proposed collections only', () => {
    expect(FACT_COLLECTIONS).toContain('obligations');
    expect(FACT_COLLECTIONS).toContain('parties');
    expect(FACT_COLLECTIONS).not.toContain('clauses');
    expect(FACT_COLLECTIONS).not.toContain('documents');
    expect(FACT_COLLECTIONS).not.toContain('relationships');
  });

  it('flattens the model into facts with their citations', () => {
    const facts = collectFacts(model);
    expect(facts.length).toBeGreaterThan(5);
    const obligation = facts.find((fact) => fact.entityType === 'obligation');
    expect(obligation.references.length).toBeGreaterThan(0);
    expect(obligation.clauseIds).toContain(obligation.entity.clauseId);
    expect(collectFacts(null)).toEqual([]);
  });

  it('collects clause anchors from fields, lists and citations', () => {
    const ids = factClauseIds({
      clauseId: 'cl_1',
      clauseIds: ['cl_2', 'cl_2'],
      evidence: [{ clauseId: 'cl_3' }, {}],
    });
    expect([...ids].sort()).toEqual(['cl_1', 'cl_2', 'cl_3']);
    expect(factClauseIds(null).size).toBe(0);
  });
});

describe('evidence mapping: clause index', () => {
  it('maps facts onto the clauses they cite', () => {
    const index = indexClauseFacts(model);
    expect(index.byClause.size).toBeGreaterThan(0);
    expect(index.facts.length).toBe(collectFacts(model).length);
    for (const [clauseId, facts] of index.byClause.entries()) {
      expect(clauseId).toBeTruthy();
      expect(facts.length).toBeGreaterThan(0);
    }
  });

  it('returns the facts for one clause and nothing for an unknown clause', () => {
    const payment = model.clauses.find((clause) => clause.number === '1.1');
    const facts = factsForClause(model, payment.id);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((fact) => fact.entity.id === 'obl_payment')).toBe(true);
    expect(factsForClause(model, 'cl_nope')).toEqual([]);
    expect(factsForClause(model, null)).toEqual([]);
  });

  it('reports facts that cite no clause as orphans instead of dropping them', () => {
    const index = indexClauseFacts({ obligations: [{ id: 'obl_x', evidence: [] }] });
    expect(index.byClause.size).toBe(0);
    expect(index.orphans).toHaveLength(1);
  });

  it('rolls up verification counts per clause', () => {
    const summary = summarizeClauseEvidence(model);
    const payment = model.clauses.find((clause) => clause.number === '1.1');
    const entry = summary.byClause.get(payment.id);

    expect(entry.facts).toBeGreaterThan(0);
    expect(entry.byType.obligation ?? entry.byType.party).toBeGreaterThan(0);
    expect(summary.totals.facts).toBeGreaterThan(0);
    expect(summary.totals.verified).toBeGreaterThan(0);
  });

  it('returns one fact with its verification roll-up', () => {
    const fact = factsForEntity(model, 'obl_payment');
    expect(fact.entity.id).toBe('obl_payment');
    expect(fact.verifiedCount).toBeGreaterThan(0);
    expect(fact.coverageRatio).toBeGreaterThan(0);
    expect(factsForEntity(model, 'nope')).toBeNull();
  });
});

describe('evidence mapping: reference to source', () => {
  it('resolves a citation to page, paragraph, clause and status', () => {
    const obligation = model.obligations.find((entry) => entry.id === 'obl_payment');
    const mapped = mapReferenceToSource(obligation.evidence[0], { content, clauses });

    expect(mapped.referenceId).toBe(obligation.evidence[0].id);
    expect(mapped.page).toBe(1);
    expect(mapped.clauseNumber).toBe('1.1');
    expect(mapped.inDocument).toBe(true);
    expect(mapped.paragraphIndex).not.toBeNull();
    expect(mapped.sourceText.length).toBeGreaterThan(0);
  });

  it('finds the source text when a reference has no offsets', () => {
    const mapped = mapReferenceToSource(
      { sourceText: 'within thirty (30) days of the invoice date', clauseId: null },
      { content, clauses },
    );
    expect(mapped.inDocument).toBe(true);
    expect(mapped.clauseNumber).toBe('1.1');
    expect(mapped.startOffset).toBeNull();
  });

  it('reports a citation that is not in the document instead of inventing a location', () => {
    const mapped = mapReferenceToSource(
      { sourceText: 'a clause that does not exist', verified: false, status: 'text-mismatch' },
      { content, clauses },
    );
    expect(mapped.inDocument).toBe(false);
    expect(mapped.status).toBe('text-mismatch');
    expect(mapReferenceToSource(null)).toBeNull();
  });

  it('works with the fixture document id it was built for', () => {
    expect(model.documentId).toBe(TEST_DOCUMENT_ID);
    expect(content.documentId).toBe(TEST_DOCUMENT_ID);
  });
});
