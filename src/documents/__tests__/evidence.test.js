import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_STATUS,
  buildEvidenceContext,
  createEvidenceReference,
  evidenceCitation,
  normalizeEvidenceList,
  normalizeEvidenceReference,
  normalizeForComparison,
  stampEvidenceReference,
  summarizeEvidenceCoverage,
  verifyEvidenceReference,
  verifyModelEvidence,
} from '../evidence.js';
import { TEST_DOCUMENT_ID, buildTestContent, buildValidModel } from '../../legal/__tests__/fixtures.js';

const content = buildTestContent();
const clauseIds = buildValidModel().clauses.map((clause) => clause.id);
const context = buildEvidenceContext(content, { clauseIds });

describe('evidence: references', () => {
  it('creates a reference with a deterministic id', () => {
    const input = {
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
      sourceText: 'The Customer shall pay each undisputed invoice',
      startOffset: 12,
      endOffset: 60,
    };
    const reference = createEvidenceReference(input);
    expect(reference.id.startsWith('ev_')).toBe(true);
    expect(reference.verified).toBe(false);
    expect(reference.status).toBe(EVIDENCE_STATUS.UNVERIFIED);
    expect(createEvidenceReference(input).id).toBe(reference.id);
  });

  it('normalizes loosely typed provider input', () => {
    const reference = normalizeEvidenceReference(
      { clauseId: '', page: '2', sourceText: 42, startOffset: 'oops', endOffset: -5 },
      { documentId: TEST_DOCUMENT_ID },
    );
    expect(reference.documentId).toBe(TEST_DOCUMENT_ID);
    expect(reference.clauseId).toBeNull();
    expect(reference.page).toBe(2);
    expect(reference.startOffset).toBeNull();
    expect(reference.endOffset).toBeNull();
    expect(normalizeEvidenceReference(null)).toBeNull();
    expect(normalizeEvidenceList([null, { sourceText: 'x' }])).toHaveLength(1);
    expect(normalizeEvidenceList('nope')).toEqual([]);
  });

  it('compares text ignoring case, whitespace and quote style', () => {
    expect(normalizeForComparison('  The   Customer\u2019s  Invoice ')).toBe("the customer's invoice");
  });

  it('renders a compact citation', () => {
    const reference = createEvidenceReference({
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
      section: '1.1',
      page: 2,
      sourceText: 'thirty (30) days',
    });
    expect(evidenceCitation(reference)).toBe('\u00a71.1 \u00b7 p. 2');
    expect(evidenceCitation(null)).toBe('No source');
  });
});

describe('evidence: verification', () => {
  it('verifies a passage that exists at the cited offsets', () => {
    const start = content.text.indexOf('thirty (30) days');
    const reference = createEvidenceReference({
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
      sourceText: 'thirty (30) days',
      startOffset: start,
      endOffset: start + 'thirty (30) days'.length,
    });
    const result = verifyEvidenceReference(reference, context);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(EVIDENCE_STATUS.VERIFIED);
  });

  it('verifies a passage by text match when offsets are absent', () => {
    const reference = createEvidenceReference({
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
      sourceText: 'keep the Disclosing Party\u2019s',
    });
    const result = verifyEvidenceReference(reference, {
      ...context,
      clauseIds: new Set(['cl_payment']),
    });
    expect(result.status).toBe(EVIDENCE_STATUS.VERIFIED);
  });

  it('rejects a quote that is not in the document', () => {
    const reference = createEvidenceReference({
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
      sourceText: 'The Customer shall pay interest at 12% per annum',
    });
    const result = verifyEvidenceReference(reference, context);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(EVIDENCE_STATUS.TEXT_MISMATCH);
  });

  it('rejects a quote that does not match its cited range', () => {
    const reference = createEvidenceReference({
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
      sourceText: 'totally different wording',
      startOffset: 0,
      endOffset: 10,
    });
    expect(verifyEvidenceReference(reference, context).status).toBe(EVIDENCE_STATUS.TEXT_MISMATCH);
  });

  it('rejects an invalid or out-of-range character range', () => {
    const bad = createEvidenceReference({
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
      sourceText: 'x',
      startOffset: 30,
      endOffset: 5,
    });
    expect(verifyEvidenceReference(bad, context).status).toBe(EVIDENCE_STATUS.RANGE_MISMATCH);

    const beyond = createEvidenceReference({
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
      sourceText: 'x',
      startOffset: 0,
      endOffset: content.charCount + 500,
    });
    expect(verifyEvidenceReference(beyond, context).status).toBe(EVIDENCE_STATUS.RANGE_MISMATCH);
  });

  it('rejects evidence citing a clause the model does not contain', () => {
    const reference = createEvidenceReference({
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_nope',
      sourceText: 'anything',
    });
    expect(verifyEvidenceReference(reference, context).status).toBe(EVIDENCE_STATUS.UNKNOWN_CLAUSE);
  });

  it('rejects evidence citing the wrong document', () => {
    const reference = createEvidenceReference({
      documentId: 'doc_other',
      clauseId: 'cl_payment',
      sourceText: 'thirty (30) days',
    });
    expect(verifyEvidenceReference(reference, context).status).toBe(EVIDENCE_STATUS.MISSING_SOURCE);
  });

  it('rejects evidence with no quoted text', () => {
    const reference = createEvidenceReference({
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
    });
    expect(verifyEvidenceReference(reference, context).status).toBe(EVIDENCE_STATUS.MISSING_SOURCE);
  });

  it('reports when there is no parsed content to check against', () => {
    const reference = createEvidenceReference({
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
      sourceText: 'thirty (30) days',
    });
    expect(verifyEvidenceReference(reference, { documentId: TEST_DOCUMENT_ID }).status).toBe(
      EVIDENCE_STATUS.UNVERIFIED,
    );
  });

  it('rejects a page reference outside the document', () => {
    const reference = {
      ...createEvidenceReference({
        documentId: TEST_DOCUMENT_ID,
        clauseId: 'cl_payment',
        sourceText: 'thirty (30) days',
      }),
      page: 5,
    };
    expect(verifyEvidenceReference(reference, context).status).toBe(EVIDENCE_STATUS.UNKNOWN_CLAUSE);
  });

  it('stamps verification onto a copy without mutating the input', () => {
    const start = content.text.indexOf('thirty (30) days');
    const reference = createEvidenceReference({
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
      sourceText: 'thirty (30) days',
      startOffset: start,
      endOffset: start + 'thirty (30) days'.length,
    });
    const { reference: stamped, result } = stampEvidenceReference(reference, context);
    expect(result.ok).toBe(true);
    expect(stamped.verified).toBe(true);
    expect(reference.verified).toBe(false);
  });
});

describe('evidence: model-level verification', () => {
  it('verifies every fact in a well-formed model', () => {
    const { model, report } = verifyModelEvidence(buildValidModel(), content);
    expect(report.rejectedEntities).toBe(0);
    expect(report.verifiedEntities).toBeGreaterThan(0);
    expect(report.rejectedRelationships).toBe(0);
    const obligation = model.obligations.find((entry) => entry.id === 'obl_payment');
    expect(obligation.evidence[0].verified).toBe(true);
    expect(obligation.verification.status).toBe(EVIDENCE_STATUS.VERIFIED);
    expect(model.meta.evidenceVerifiedAt).toBeTruthy();
  });

  it('drops a fact whose quote cannot be found and prunes its relationships', () => {
    const model = buildValidModel();
    model.obligations = model.obligations.map((obligation) =>
      obligation.id === 'obl_payment'
        ? { ...obligation, evidence: [{ ...obligation.evidence[0], sourceText: 'invented clause text' }] }
        : obligation,
    );
    const { model: verified, report } = verifyModelEvidence(model, content);
    expect(report.rejectedEntities).toBe(1);
    expect(report.rejectedIds).toContain('obl_payment');
    expect(verified.obligations.map((entry) => entry.id)).not.toContain('obl_payment');
    expect(verified.relationships).toHaveLength(0);
    expect(report.rejectedRelationships).toBe(1);
  });

  it('keeps rejected facts when asked not to drop them', () => {
    const model = buildValidModel();
    model.risks = model.risks.map((risk) => ({ ...risk, evidence: [] }));
    const { model: verified, report } = verifyModelEvidence(model, content, { dropUnverified: false });
    expect(report.rejectedEntities).toBe(1);
    expect(verified.risks).toHaveLength(1);
    expect(verified.risks[0].verification.status).toBe(EVIDENCE_STATUS.MISSING_SOURCE);
  });

  it('handles an empty model', () => {
    const { report } = verifyModelEvidence(null, content);
    expect(report.issues[0].status).toBe(EVIDENCE_STATUS.UNVERIFIED);
  });

  it('summarises coverage', () => {
    const { model } = verifyModelEvidence(buildValidModel(), content);
    const summary = summarizeEvidenceCoverage(model);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.verified).toBeGreaterThan(0);
    expect(summary.coverageRatio).toBeGreaterThan(0.5);
    expect(summarizeEvidenceCoverage(null).coverageRatio).toBe(0);
  });
});
