import { describe, expect, it } from 'vitest';
import {
  CLAUSE_TYPE_LABELS,
  WEAK_CLAUSE_TYPES,
  classifyClauseType,
  classifyClauses,
  clauseTypeLabel,
  isClauseType,
  isWeakClauseType,
} from '../clauseTypes.js';
import { CLAUSE_TYPES, CLAUSE_TYPE_SOURCES } from '../schema.js';
import { createClausesFromSections, segmentIntoClauses } from '../../documents/chunker.js';
import { parseTextContent } from '../../documents/parser.js';

const AGREEMENT = [
  '1. DEFINITIONS AND INTERPRETATION',
  '1.1 "Services" means the hosted analytics platform described in Schedule 1.',
  '2. SERVICES',
  '2.1 The Service Provider shall provide the Services in accordance with Schedule 1.',
  '3. PAYMENT TERMS',
  '3.1 The Customer shall pay each undisputed invoice within thirty (30) days.',
  '3.2 Late amounts shall accrue interest at 1.5% per month from the due date.',
  '3.3 The Service Provider may suspend the Services on ten (10) Business Days notice.',
  '4. CONFIDENTIALITY',
  '4.1 Each party shall keep the other party Confidential Information confidential.',
  '4.2 The confidentiality obligations shall survive termination for five (5) years.',
  '5. LIABILITY',
  '5.1 Liability is limited to the fees paid in the twelve (12) months preceding the claim.',
  '6. SUB-CONTRACTING',
  '6.1 The Service Provider may subcontract any part of the Services.',
  '7. TERM AND RENEWAL',
  '7.1 This Agreement continues until 30 November 2026.',
  '7.2 This Agreement shall automatically renew for successive periods of twelve (12) months unless notice is given.',
  '8. NOTICES',
  '8.1 Any notice must be given in writing to the address in this clause.',
].join('\n');

describe('clauseTypes: classification', () => {
  it('classifies clauses from their own text', () => {
    expect(classifyClauseType({ heading: 'DEFINITIONS', text: '"Services" means the services.' }).type).toBe(
      'definitions',
    );
    expect(classifyClauseType({ text: 'The Customer shall pay each invoice within 30 days.' }).type).toBe(
      'payment',
    );
    expect(
      classifyClauseType({ text: 'The Service Provider may suspend the Services on ten days notice.' }).type,
    ).toBe('suspension');
    expect(classifyClauseType({ text: 'Either party may terminate on material breach.' }).type).toBe(
      'termination',
    );
    expect(classifyClauseType({ text: 'This Agreement shall automatically renew for successive periods.' }).type).toBe(
      'renewal',
    );
    expect(classifyClauseType({ heading: 'SCHEDULE 1', text: 'The services comprise hosting.' }).type).toBe(
      'schedule',
    );
  });

  it('records where the type came from', () => {
    expect(classifyClauseType({ text: 'The Customer shall pay within 30 days.' }).source).toBe(
      CLAUSE_TYPE_SOURCES.PARSER,
    );
    expect(classifyClauseType({}).source).toBe(CLAUSE_TYPE_SOURCES.UNKNOWN);
  });

  it('falls back to "other" for readable text it cannot place', () => {
    const result = classifyClauseType({ heading: 'Miscellaneous', text: 'The parties agree as follows.' });
    expect(result.type).toBe('other');
    expect(isWeakClauseType(result.type)).toBe(true);
  });

  it('only returns types from the controlled vocabulary', () => {
    const clauses = segmentIntoClauses(parseTextContent(AGREEMENT, { fileName: 'a.txt' })).sections;
    for (const clause of clauses) {
      const { type } = classifyClauseType(clause);
      expect(CLAUSE_TYPES).toContain(type);
    }
  });

  it('is deterministic and order independent for the same clause', () => {
    const clause = { heading: 'PAYMENT', text: 'The Customer shall pay each invoice.' };
    expect(classifyClauseType(clause)).toEqual(classifyClauseType(clause));
    expect(classifyClauses([clause])[0].clauseType).toBe('payment');
  });

  it('labels every type readably and validates the vocabulary', () => {
    for (const type of CLAUSE_TYPES) {
      expect(clauseTypeLabel(type).length).toBeGreaterThan(0);
    }
    expect(clauseTypeLabel(null)).toBe(CLAUSE_TYPE_LABELS.unknown);
    expect(clauseTypeLabel('governing-law')).toBe('Governing law');
    expect(isClauseType('payment')).toBe(true);
    expect(isClauseType('nonsense')).toBe(false);
    expect(WEAK_CLAUSE_TYPES).toEqual(['other', 'unknown']);
  });
});

describe('clauseTypes: integration with the chunker', () => {
  const content = parseTextContent(AGREEMENT, { fileName: 'agreement.txt' });
  const sections = segmentIntoClauses(content).sections;
  const clauses = createClausesFromSections(content.documentId, sections);

  it('types every parsed clause without touching the entity type', () => {
    expect(clauses.length).toBeGreaterThan(8);
    for (const clause of clauses) {
      expect(clause.type).toBe('clause');
      expect(clause.clauseTypeSource).toBe(CLAUSE_TYPE_SOURCES.PARSER);
    }
  });

  it('types the clauses a reader would expect', () => {
    const typeOf = (number) => clauses.find((clause) => clause.number === number)?.clauseType;
    expect(typeOf('2.1')).toBe('services');
    expect(typeOf('3.1')).toBe('payment');
    expect(typeOf('3.3')).toBe('suspension');
    expect(typeOf('4.2')).toBe('survival');
    expect(typeOf('7.2')).toBe('renewal');
  });

  it('clause typing does not change clause ids or offsets', () => {
    const again = createClausesFromSections(content.documentId, sections);
    expect(again.map((clause) => clause.id)).toEqual(clauses.map((clause) => clause.id));
    expect(again.map((clause) => clause.startOffset)).toEqual(
      clauses.map((clause) => clause.startOffset),
    );
  });
});
