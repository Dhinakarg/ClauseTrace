import { describe, expect, it } from 'vitest';
import {
  ISSUE_CODES,
  ISSUE_SEVERITY,
  ValidationError,
  assertValidModel,
  groupIssuesByCode,
  summarizeIssues,
  validateEntity,
  validateLegalModel,
  validateRelationship,
} from '../validators.js';
import { ENTITY_TYPES, createObligation } from '../schema.js';
import { TEST_DOCUMENT_ID, buildTestContent, buildValidModel, quote } from './fixtures.js';

const content = buildTestContent();
const codes = (report) => report.issues.map((entry) => entry.code);

describe('validators: a correct model', () => {
  it('passes with no errors', () => {
    const report = validateLegalModel(buildValidModel(), { documentContent: content });
    expect(report.valid).toBe(true);
    expect(report.summary.errorCount).toBe(0);
    expect(report.summary.checkedEntityCount).toBeGreaterThan(10);
  });

  it('can be asserted without throwing', () => {
    expect(() => assertValidModel(buildValidModel(), { documentContent: content })).not.toThrow();
  });
});

describe('validators: entity shape', () => {
  it('rejects a missing id', () => {
    const issues = validateEntity({
      type: ENTITY_TYPES.PARTY,
      documentId: 'd',
      name: 'x',
      role: 'customer',
    });
    expect(issues.map((entry) => entry.code)).toContain(ISSUE_CODES.ENTITY_MISSING_ID);
  });

  it('rejects an unknown entity type', () => {
    const issues = validateEntity({ id: 'x', type: 'wibble', documentId: 'd' }, { entityType: 'wibble' });
    expect(issues.map((entry) => entry.code)).toContain(ISSUE_CODES.ENTITY_UNKNOWN_TYPE);
  });

  it('reports a collection/type mismatch', () => {
    const issues = validateEntity(
      { id: 'x', type: ENTITY_TYPES.PARTY, documentId: 'd', name: 'x', role: 'customer' },
      { entityType: ENTITY_TYPES.PARTY, collectionKey: 'clauses' },
    );
    expect(issues.map((entry) => entry.code)).toContain(ISSUE_CODES.ENTITY_TYPE_MISMATCH);
  });

  it('rejects an entity missing a required field', () => {
    const obligation = createObligation({
      id: 'obl_x',
      documentId: TEST_DOCUMENT_ID,
      clauseId: 'cl_payment',
    });
    const issues = validateEntity(obligation, {
      entityType: ENTITY_TYPES.OBLIGATION,
      collectionKey: 'obligations',
    });
    expect(issues.map((entry) => entry.code)).toContain(ISSUE_CODES.ENTITY_MISSING_FIELD);
  });

  it('warns about unknown enum values', () => {
    const obligation = createObligation({
      id: 'obl_x',
      documentId: TEST_DOCUMENT_ID,
      summary: 'Pay',
      clauseId: 'cl_payment',
      standard: 'whenever',
      evidence: [quote('thirty (30) days', { clauseId: 'cl_payment' })],
    });
    const issues = validateEntity(obligation, {
      entityType: ENTITY_TYPES.OBLIGATION,
      collectionKey: 'obligations',
    });
    expect(issues.map((entry) => entry.code)).toContain(ISSUE_CODES.ENTITY_INVALID_ENUM);
  });

  it('requires evidence on fact entities', () => {
    const withoutEvidence = createObligation({
      id: 'obl_x',
      documentId: TEST_DOCUMENT_ID,
      summary: 'Pay',
      clauseId: 'cl_payment',
    });
    const issues = validateEntity(withoutEvidence, {
      entityType: ENTITY_TYPES.OBLIGATION,
      collectionKey: 'obligations',
    });
    expect(issues.map((entry) => entry.code)).toContain(ISSUE_CODES.ENTITY_MISSING_EVIDENCE);
  });
});

describe('validators: model integrity', () => {
  it('detects duplicate ids across collections', () => {
    const model = buildValidModel();
    model.parties = [...model.parties, { ...model.parties[0] }];
    const report = validateLegalModel(model, { documentContent: content });
    expect(codes(report)).toContain(ISSUE_CODES.ENTITY_DUPLICATE_ID);
    expect(report.valid).toBe(false);
  });

  it('detects a broken reference', () => {
    const model = buildValidModel();
    model.obligations[0] = { ...model.obligations[0], clauseId: 'cl_does_not_exist' };
    const report = validateLegalModel(model, { documentContent: content });
    expect(codes(report)).toContain(ISSUE_CODES.REF_BROKEN);
  });

  it('detects a reference of the wrong entity type', () => {
    const model = buildValidModel();
    model.obligations[0] = { ...model.obligations[0], obligorPartyId: 'cl_payment' };
    const report = validateLegalModel(model, { documentContent: content });
    expect(codes(report)).toContain(ISSUE_CODES.REF_TYPE_MISMATCH);
  });

  it('detects evidence pointing at an unknown clause', () => {
    const model = buildValidModel();
    model.obligations[0] = {
      ...model.obligations[0],
      evidence: [{ ...model.obligations[0].evidence[0], clauseId: 'cl_missing' }],
    };
    const report = validateLegalModel(model, { documentContent: content });
    expect(codes(report)).toContain(ISSUE_CODES.EVIDENCE_BAD_CLAUSE_REF);
  });

  it('detects evidence citing a page outside the document', () => {
    const model = buildValidModel();
    model.obligations[0] = {
      ...model.obligations[0],
      evidence: [{ ...model.obligations[0].evidence[0], page: 99 }],
    };
    const report = validateLegalModel(model, { documentContent: content });
    expect(codes(report)).toContain(ISSUE_CODES.EVIDENCE_BAD_PAGE);
  });

  it('detects evidence attributed to another document', () => {
    const model = buildValidModel();
    model.obligations[0] = {
      ...model.obligations[0],
      evidence: [{ ...model.obligations[0].evidence[0], documentId: 'doc_other' }],
    };
    const report = validateLegalModel(model, { documentContent: content });
    expect(codes(report)).toContain(ISSUE_CODES.EVIDENCE_BAD_SOURCE_REF);
  });

  it('detects an entity belonging to a different document', () => {
    const model = buildValidModel();
    model.obligations[0] = { ...model.obligations[0], documentId: 'doc_other' };
    const report = validateLegalModel(model, { documentContent: content });
    expect(codes(report)).toContain(ISSUE_CODES.ENTITY_DOCUMENT_MISMATCH);
  });

  it('detects a documentId that does not match its document entity', () => {
    const model = { ...buildValidModel(), documentId: 'doc_other' };
    const report = validateLegalModel(model, { documentContent: content });
    expect(codes(report)).toContain(ISSUE_CODES.MODEL_DOCUMENT_MISMATCH);
  });
});

describe('validators: relationships', () => {
  it('rejects an unknown relationship type', () => {
    const issues = validateRelationship({ id: 'rel_1', type: 'made-up', fromId: 'a', toId: 'b' });
    expect(issues.map((entry) => entry.code)).toContain(ISSUE_CODES.REL_TYPE_INVALID);
  });

  it('requires both endpoints', () => {
    const issues = validateRelationship({
      id: 'rel_1',
      type: 'clause-imposes-obligation',
      fromId: 'cl_payment',
    });
    expect(issues.map((entry) => entry.code)).toContain(ISSUE_CODES.REL_ENDPOINT_MISSING);
  });

  it('rejects an endpoint that does not exist', () => {
    const model = buildValidModel();
    const report = validateLegalModel(
      {
        ...model,
        relationships: [
          ...model.relationships,
          {
            id: 'rel_bad',
            type: 'clause-imposes-obligation',
            fromId: 'cl_payment',
            toId: 'obl_missing',
            fromType: ENTITY_TYPES.CLAUSE,
            toType: ENTITY_TYPES.OBLIGATION,
          },
        ],
      },
      { documentContent: content },
    );
    expect(codes(report)).toContain(ISSUE_CODES.REF_BROKEN);
  });

  it('rejects a pairing the schema does not allow', () => {
    const model = buildValidModel();
    const report = validateLegalModel(
      {
        ...model,
        relationships: [
          ...model.relationships,
          {
            id: 'rel_bad_pair',
            type: 'clause-imposes-obligation',
            fromId: 'party_customer',
            toId: 'obl_payment',
            fromType: ENTITY_TYPES.PARTY,
            toType: ENTITY_TYPES.OBLIGATION,
          },
        ],
      },
      { documentContent: content },
    );
    expect(codes(report)).toContain(ISSUE_CODES.REL_ENDPOINT_TYPE_MISMATCH);
  });

  it('warns about duplicate relationships without failing the model', () => {
    const model = buildValidModel();
    const duplicate = model.relationships[0];
    const report = validateLegalModel(
      { ...model, relationships: [...model.relationships, { ...duplicate, id: 'rel_dup' }] },
      { documentContent: content },
    );
    expect(codes(report)).toContain(ISSUE_CODES.REL_DUPLICATE);
    expect(report.valid).toBe(true);
  });
});

describe('validators: reporting', () => {
  it('throws a ValidationError carrying the error list', () => {
    const model = buildValidModel();
    model.obligations[0] = { ...model.obligations[0], clauseId: null, summary: '' };
    expect(() => assertValidModel(model, { documentContent: content })).toThrow(ValidationError);
    try {
      assertValidModel(model, { documentContent: content });
    } catch (error) {
      expect(error.name).toBe('ValidationError');
      expect(error.issues.length).toBeGreaterThan(0);
    }
  });

  it('reports a non-object model with a dedicated code', () => {
    const report = validateLegalModel(null);
    expect(Object.keys(groupIssuesByCode(report.issues))).toContain(ISSUE_CODES.MODEL_NOT_OBJECT);
    expect(report.issues[0].severity).toBe(ISSUE_SEVERITY.ERROR);
  });

  it('summarises warnings for an empty but well-formed model', () => {
    const report = validateLegalModel({ documentId: 'doc_1' });
    const summary = summarizeIssues(report.issues);
    expect(summary.errors).toBe(0);
    expect(summary.warnings).toBeGreaterThan(0);
    expect(Object.keys(groupIssuesByCode(report.issues))).toContain(ISSUE_CODES.MODEL_NO_DOCUMENT);
  });

  it('handles non-objects without throwing', () => {
    expect(validateLegalModel(null).valid).toBe(false);
    expect(validateLegalModel(undefined).valid).toBe(false);
  });
});
