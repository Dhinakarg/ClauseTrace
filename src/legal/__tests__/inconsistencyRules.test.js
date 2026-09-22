import { describe, expect, it } from 'vitest';
import {
  INCONSISTENCY_DISCLAIMER,
  INCONSISTENCY_HEADLINE,
  INCONSISTENCY_RULES,
  INCONSISTENCY_RULE_IDS,
  collectInconsistencies,
  detectInconsistencies,
  inconsistencyRuleById,
  inconsistenciesForEntity,
  normalizeModelInconsistency,
} from '../inconsistencyRules.js';
import {
  ENTITY_TYPES,
  INCONSISTENCY_TYPES,
  SEVERITIES,
  createClause,
  createDeadline,
  createDefinition,
  createDocument,
  createInconsistency,
  createLegalModel,
  createObligation,
  createParty,
  createRelationship,
} from '../schema.js';
import { buildValidModel } from './fixtures.js';

const DOCUMENT_ID = 'doc_ic_fixture';

function buildModel({
  clauses = [],
  deadlines = [],
  obligations = [],
  parties = [],
  definitions = [],
  inconsistencies = [],
  relationships = [],
} = {}) {
  const document = createDocument({
    id: DOCUMENT_ID,
    title: 'Inconsistency Fixture',
    documentType: 'agreement',
    pageCount: 1,
    effectiveDate: '2026-01-01',
    partyIds: parties.map((party) => party.id),
    clauseIds: clauses.map((item) => item.id),
  });
  return createLegalModel({
    documentId: DOCUMENT_ID,
    documents: [document],
    clauses,
    deadlines,
    obligations,
    parties,
    definitions,
    inconsistencies,
    relationships,
  });
}

function clause(id, text, extra = {}) {
  return createClause({ id, documentId: DOCUMENT_ID, text, ...extra });
}

describe('inconsistencyRules: catalogue', () => {
  it('uses the schema vocabulary for every rule', () => {
    expect(INCONSISTENCY_RULE_IDS).toHaveLength(INCONSISTENCY_RULES.length);
    for (const rule of INCONSISTENCY_RULES) {
      expect(INCONSISTENCY_TYPES).toContain(rule.inconsistencyType);
      expect(SEVERITIES).toContain(rule.severity);
      expect(rule.why.length).toBeGreaterThan(20);
    }
  });

  it('looks rules up by id', () => {
    expect(inconsistencyRuleById('undefined-term').label).toMatch(/defined/i);
    expect(inconsistencyRuleById('nope')).toBeNull();
  });
});

describe('inconsistencyRules: shape, wording and determinism', () => {
  it('states every finding as a potential inconsistency', () => {
    const model = buildModel({
      clauses: [
        clause('cl_a', '2.1 Either party may terminate on thirty (30) days written notice.', {
          clauseType: 'termination',
        }),
        clause('cl_b', '2.2 Either party may terminate on ten (10) days written notice.', {
          clauseType: 'termination',
        }),
      ],
    });
    const findings = detectInconsistencies(model);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.type).toBe(ENTITY_TYPES.INCONSISTENCY);
      expect(finding.headline).toBe(INCONSISTENCY_HEADLINE);
      expect(finding.headline).toBe('Potential inconsistency detected.');
      expect(finding.description.startsWith(INCONSISTENCY_HEADLINE)).toBe(true);
      expect(finding.provenance).toBe('derived');
      expect(finding.derived).toBe(true);
      expect(finding.detection.basis.length).toBeGreaterThan(0);
      expect(INCONSISTENCY_TYPES).toContain(finding.inconsistencyType);
      expect(Array.isArray(finding.evidence)).toBe(true);
    }
  });

  it('returns the same findings for the same model', () => {
    const model = buildValidModel();
    expect(detectInconsistencies(model)).toEqual(detectInconsistencies(model));
  });

  it('returns nothing for a missing model and can be limited to one rule', () => {
    expect(detectInconsistencies(null)).toEqual([]);
    const model = buildModel({
      clauses: [
        clause('cl_a', '2.1 Either party may terminate on thirty (30) days written notice.', {
          clauseType: 'termination',
        }),
        clause('cl_b', '2.2 Either party may terminate on ten (10) days written notice.', {
          clauseType: 'termination',
        }),
      ],
    });
    const findings = detectInconsistencies(model, { ruleIds: ['missing-cross-reference'] });
    expect(findings).toEqual([]);
  });
});

describe('inconsistencyRules: conflicting provisions', () => {
  it('compares notice periods for the same action and shows both sides', () => {
    const model = buildModel({
      clauses: [
        clause('cl_a', '2.1 Either party may terminate on thirty (30) days written notice.', {
          clauseType: 'termination',
          number: '2.1',
        }),
        clause('cl_b', '9.4 Either party may terminate on ten (10) days written notice.', {
          clauseType: 'termination',
          number: '9.4',
        }),
      ],
    });
    const findings = detectInconsistencies(model, { ruleIds: ['conflicting-notice-periods'] });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].detection.comparison.left).toContain('30 day(s)');
    expect(findings[0].detection.comparison.right).toContain('10 day(s)');
    expect(findings[0].clauseIds).toEqual(['cl_a', 'cl_b']);
    expect(findings[0].detection.basis.join(' ')).toContain('30 day(s)');
  });

  it('does not compare periods for different actions', () => {
    const model = buildModel({
      clauses: [
        clause('cl_a', '2.1 Either party may terminate on thirty (30) days written notice.', {
          clauseType: 'termination',
        }),
        clause('cl_b', '4.2 The term renews for twelve (12) months unless notice of ten (10) days is given.', {
          clauseType: 'renewal',
        }),
      ],
    });
    expect(detectInconsistencies(model, { ruleIds: ['conflicting-notice-periods'] })).toEqual([]);
  });

  it('flags the same event carrying two different dates', () => {
    const model = buildModel({
      clauses: [clause('cl_a', 'Payments and delivery dates.', { number: '5.1' })],
      deadlines: [
        createDeadline({
          id: 'dl_1',
          documentId: DOCUMENT_ID,
          description: 'Delivery of the goods',
          event: 'delivery of the goods',
          date: '2026-03-01',
          dateType: 'absolute',
          clauseId: 'cl_a',
        }),
        createDeadline({
          id: 'dl_2',
          documentId: DOCUMENT_ID,
          description: 'Delivery of the goods (as amended)',
          event: 'delivery of the goods',
          date: '2026-04-15',
          dateType: 'absolute',
          clauseId: 'cl_a',
        }),
      ],
    });
    const findings = detectInconsistencies(model, { ruleIds: ['contradictory-dates'] });
    expect(findings).toHaveLength(1);
    expect(findings[0].detection.comparison.left).toBe('2026-03-01');
    expect(findings[0].detection.comparison.right).toBe('2026-04-15');
    expect(findings[0].title).toContain('2026-03-01');
  });

  it('flags one term defined twice in different words', () => {
    const model = buildModel({
      clauses: [clause('cl_a', 'Definitions.', { number: '1.1' })],
      definitions: [
        createDefinition({
          id: 'def_1',
          documentId: DOCUMENT_ID,
          term: 'Business Day',
          text: 'A day other than a Saturday or Sunday.',
          clauseId: 'cl_a',
        }),
        createDefinition({
          id: 'def_2',
          documentId: DOCUMENT_ID,
          term: 'Business Day',
          text: 'Any day on which banks in London are open.',
          clauseId: 'cl_a',
        }),
      ],
    });
    const findings = detectInconsistencies(model, { ruleIds: ['conflicting-terms'] });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].title).toContain('Business Day');
    expect(findings[0].detection.comparison.left).toContain('Saturday');
    expect(findings[0].detection.comparison.right).toContain('banks');
  });
});

describe('inconsistencyRules: references and duplicates', () => {
  it('flags a quoted term with no definition entity', () => {
    const model = buildModel({
      clauses: [
        clause('cl_a', '3.1 The Supplier shall protect the "Confidential Information" of the Customer.', {
          number: '3.1',
        }),
      ],
    });
    const findings = detectInconsistencies(model, { ruleIds: ['undefined-term'] });
    expect(findings).toHaveLength(1);
    expect(findings[0].inconsistencyType).toBe('undefined-term');
    expect(findings[0].title).toContain('Confidential Information');
    expect(findings[0].detection.basis.join(' ')).toContain('No definition entity');
  });

  it('does not flag a term the document defines', () => {
    const model = buildModel({
      clauses: [
        clause('cl_a', '3.1 The Supplier shall protect the "Confidential Information" of the Customer.'),
      ],
      definitions: [
        createDefinition({
          id: 'def_ci',
          documentId: DOCUMENT_ID,
          term: 'Confidential Information',
          text: 'Information marked confidential.',
          clauseId: 'cl_a',
        }),
      ],
    });
    expect(detectInconsistencies(model, { ruleIds: ['undefined-term'] })).toEqual([]);
  });

  it('flags the same duty recorded in two clauses', () => {
    const party = createParty({ id: 'party_c', documentId: DOCUMENT_ID, name: 'Acme Limited', role: 'customer' });
    const model = buildModel({
      parties: [party],
      clauses: [
        clause('cl_a', '2.1 Acme Limited shall maintain insurance.', { number: '2.1' }),
        clause('cl_b', '11.3 Acme Limited shall maintain insurance.', { number: '11.3' }),
      ],
      obligations: [
        createObligation({
          id: 'obl_1',
          documentId: DOCUMENT_ID,
          summary: 'Maintain insurance.',
          obligorPartyId: party.id,
          clauseId: 'cl_a',
        }),
        createObligation({
          id: 'obl_2',
          documentId: DOCUMENT_ID,
          summary: 'Maintain insurance.',
          obligorPartyId: party.id,
          clauseId: 'cl_b',
        }),
      ],
    });
    const findings = detectInconsistencies(model, { ruleIds: ['duplicate-obligation'] });
    expect(findings).toHaveLength(1);
    expect(findings[0].clauseIds).toEqual(['cl_a', 'cl_b']);
    expect(findings[0].detection.comparison.label).toContain('Acme Limited');
  });
});

describe('inconsistencyRules: cross references', () => {
  it('flags a reference to a clause number that was never extracted', () => {
    const model = buildModel({
      clauses: [
        clause('cl_a', '2.1 Liability is limited as set out in Clause 14 of this Agreement.', {
          number: '2.1',
        }),
      ],
    });
    const findings = detectInconsistencies(model, { ruleIds: ['missing-cross-reference'] });
    expect(findings).toHaveLength(1);
    expect(findings[0].inconsistencyType).toBe('missing-cross-reference');
    expect(findings[0].title).toContain('Clause 14');
  });

  it('accepts a reference to a clause that does exist', () => {
    const model = buildModel({
      clauses: [
        clause('cl_a', '2.1 Liability is limited as set out in Clause 14 of this Agreement.', { number: '2.1' }),
        clause('cl_b', '14.1 The cap is the fees paid.', { number: '14' }),
      ],
    });
    expect(detectInconsistencies(model, { ruleIds: ['missing-cross-reference'] })).toEqual([]);
  });

  it('flags entities and relationships pointing at missing targets', () => {
    const model = buildModel({
      clauses: [clause('cl_a', '2.1 Duties.', { number: '2.1' })],
      obligations: [
        createObligation({
          id: 'obl_orphan',
          documentId: DOCUMENT_ID,
          summary: 'Duty linking to a missing clause.',
          clauseId: 'cl_missing',
        }),
      ],
      relationships: [
        createRelationship({
          id: 'rel_orphan',
          type: 'clause-imposes-obligation',
          fromId: 'cl_a',
          fromType: ENTITY_TYPES.CLAUSE,
          toId: 'obl_nowhere',
          toType: ENTITY_TYPES.OBLIGATION,
          documentId: DOCUMENT_ID,
        }),
      ],
    });
    const findings = detectInconsistencies(model, { ruleIds: ['orphan-clause-reference'] });
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.title).join(' ')).toMatch(/not present/i);
  });
});

describe('inconsistencyRules: collection and helpers', () => {
  it('keeps provider findings separate and marks overlapping ones', () => {
    const model = buildModel({
      clauses: [
        clause('cl_a', '2.1 Either party may terminate on thirty (30) days written notice.', {
          clauseType: 'termination',
        }),
        clause('cl_b', '9.4 Either party may terminate on ten (10) days written notice.', {
          clauseType: 'termination',
        }),
      ],
      inconsistencies: [
        createInconsistency({
          id: 'inc_provider',
          documentId: DOCUMENT_ID,
          title: 'Notice periods differ',
          inconsistencyType: 'conflicting-notice-periods',
          severity: 'high',
          description: 'The two notice periods differ.',
          clauseIds: ['cl_a', 'cl_b'],
        }),
      ],
    });
    const collected = collectInconsistencies(model);
    expect(collected.detected.length).toBeGreaterThan(0);
    expect(collected.modelProvided).toHaveLength(1);
    expect(collected.modelProvided[0].derived).toBe(false);
    expect(collected.modelProvided[0].description.startsWith(INCONSISTENCY_HEADLINE)).toBe(true);
    expect(collected.duplicates.length).toBeGreaterThan(0);
    expect(collected.all).toHaveLength(collected.detected.length + 1);
    expect(collected.disclaimer).toBe(INCONSISTENCY_DISCLAIMER);
    expect(collected.counts.byType['conflicting-notice-periods']).toBeGreaterThan(0);
  });

  it('normalises a provider inconsistency without clause ids', () => {
    const normalized = normalizeModelInconsistency(
      createInconsistency({
        documentId: DOCUMENT_ID,
        title: 'Odd dates',
        inconsistencyType: 'contradictory-dates',
      }),
      buildModel({}),
    );
    expect(normalized.id).toMatch(/^inc_/);
    expect(normalized.detection.where).toBe('whole document');
    expect(normalized.clauseIds).toEqual([]);
  });

  it('finds findings through the entity or its clauses', () => {
    const model = buildModel({
      clauses: [
        clause('cl_a', '2.1 Either party may terminate on thirty (30) days written notice.', {
          clauseType: 'termination',
        }),
        clause('cl_b', '9.4 Either party may terminate on ten (10) days written notice.', {
          clauseType: 'termination',
        }),
      ],
    });
    const findings = detectInconsistencies(model);
    expect(inconsistenciesForEntity(null, findings, { clauseIds: ['cl_b'] }).length).toBeGreaterThan(0);
    expect(inconsistenciesForEntity('nothing', findings)).toEqual([]);
  });

  it('produces explainable findings on the shared fixture model', () => {
    const findings = detectInconsistencies(buildValidModel());
    for (const finding of findings) {
      expect(finding.detection.where).toBeTruthy();
      expect(finding.detection.why.length).toBeGreaterThan(20);
    }
  });
});
