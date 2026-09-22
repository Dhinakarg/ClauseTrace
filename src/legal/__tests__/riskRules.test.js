import { describe, expect, it } from 'vitest';
import {
  RISK_RULES,
  RISK_RULE_IDS,
  RISK_SIGNAL_DISCLAIMER,
  SIGNAL_SOURCES,
  collectRiskSignals,
  countBy,
  detectRiskSignals,
  groupSignalsByCategory,
  normalizeModelRisk,
  ruleById,
  signalsForEntity,
} from '../riskRules.js';
import {
  ENTITY_TYPES,
  RISK_CATEGORIES,
  SEVERITIES,
  createClause,
  createDeadline,
  createDocument,
  createLegalModel,
  createObligation,
  createParty,
  createRisk,
} from '../schema.js';
import { buildValidModel } from './fixtures.js';

const DOCUMENT_ID = 'doc_risk_fixture';

/** Minimal but valid model builder, so each rule can be exercised on its own. */
function buildModel({
  clauses = [],
  deadlines = [],
  obligations = [],
  parties = [],
  risks = [],
  conditions = [],
  rights = [],
} = {}) {
  const document = createDocument({
    id: DOCUMENT_ID,
    title: 'Risk Fixture',
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
    conditions,
    rights,
    risks,
  });
}

function clause(id, text, extra = {}) {
  return createClause({ id, documentId: DOCUMENT_ID, text, ...extra });
}

describe('riskRules: catalogue', () => {
  it('exposes one catalogue entry per rule id', () => {
    expect(RISK_RULE_IDS).toHaveLength(RISK_RULES.length);
    for (const rule of RISK_RULES) {
      expect(RISK_CATEGORIES).toContain(rule.category);
      expect(SEVERITIES).toContain(rule.severity);
      expect(rule.why.length).toBeGreaterThan(20);
    }
  });

  it('can look a rule up by id', () => {
    expect(ruleById('short-notice-period').label).toMatch(/notice/i);
    expect(ruleById('nope')).toBeNull();
  });
});

describe('riskRules: signal shape and determinism', () => {
  it('returns the same signals for the same model', () => {
    const model = buildValidModel();
    const options = { today: '2026-02-01', effectiveDate: '2026-01-01' };
    const first = detectRiskSignals(model, options);
    expect(detectRiskSignals(model, options)).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('describes every signal with a rule, a why, a where and a basis', () => {
    const signals = detectRiskSignals(buildValidModel(), { today: '2026-02-01' });
    for (const signal of signals) {
      expect(signal.type).toBe(ENTITY_TYPES.RISK);
      expect(RISK_CATEGORIES).toContain(signal.category);
      expect(SEVERITIES).toContain(signal.severity);
      expect(signal.provenance).toBe('derived');
      expect(signal.derived).toBe(true);
      expect(signal.source).toBe(SIGNAL_SOURCES.RULE);
      expect(signal.explanation).toContain(signal.detection.why);
      expect(signal.detection.ruleId).toBeTruthy();
      expect(signal.detection.ruleLabel).toBeTruthy();
      expect(signal.detection.where).toBeTruthy();
      expect(signal.detection.basis.length).toBeGreaterThan(0);
      expect(Array.isArray(signal.evidence)).toBe(true);
    }
  });

  it('returns nothing for a missing model', () => {
    expect(detectRiskSignals(null)).toEqual([]);
    expect(detectRiskSignals(undefined, {})).toEqual([]);
  });

  it('honours the per-rule and total caps', () => {
    const obligations = Array.from({ length: 30 }, (_, index) =>
      createObligation({
        id: `obl_${index}`,
        documentId: DOCUMENT_ID,
        summary: `Undated duty ${index}`,
        clauseId: 'cl_a',
      }),
    );
    const model = buildModel({
      clauses: [clause('cl_a', 'The Customer shall act promptly.')],
      obligations,
    });
    const limited = detectRiskSignals(model, { maxPerRule: 3 });
    expect(
      limited.filter((signal) => signal.detection.ruleId === 'obligation-without-deadline'),
    ).toHaveLength(3);
    expect(detectRiskSignals(model, { maxSignals: 2, maxPerRule: 30 })).toHaveLength(2);
  });

  it('can run a single rule by id', () => {
    const signals = detectRiskSignals(buildValidModel(), { ruleIds: ['obligation-without-consequence'] });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.detection.ruleId === 'obligation-without-consequence')).toBe(true);
  });
});

describe('riskRules: obligation rules', () => {
  const customer = createParty({
    id: 'party_c',
    documentId: DOCUMENT_ID,
    name: 'Acme Limited',
    role: 'customer',
  });

  it('flags a duty with no deadline and no trigger', () => {
    const model = buildModel({
      parties: [customer],
      clauses: [clause('cl_a', 'Acme Limited shall keep records.')],
      obligations: [
        createObligation({
          id: 'obl_a',
          documentId: DOCUMENT_ID,
          summary: 'Keep records.',
          clauseId: 'cl_a',
          obligorPartyId: customer.id,
        }),
      ],
    });
    const signals = detectRiskSignals(model, { ruleIds: ['obligation-without-deadline'] });
    expect(signals).toHaveLength(1);
    expect(signals[0].severity).toBe('medium');
    expect(signals[0].title).toContain('Keep records.');
    expect(signals[0].clauseId).toBe('cl_a');
  });

  it('does not flag a duty that has a deadline', () => {
    const model = buildModel({
      parties: [customer],
      clauses: [clause('cl_a', 'Acme Limited shall pay within 30 days.')],
      deadlines: [
        createDeadline({
          id: 'dl_a',
          documentId: DOCUMENT_ID,
          description: 'Pay 30 days after invoice',
          dateType: 'relative',
          offsetAmount: 30,
          offsetUnit: 'day',
          anchorEvent: 'invoice date',
          clauseId: 'cl_a',
          anchorDate: '2026-01-01',
        }),
      ],
      obligations: [
        createObligation({
          id: 'obl_a',
          documentId: DOCUMENT_ID,
          summary: 'Pay invoices.',
          clauseId: 'cl_a',
          obligorPartyId: customer.id,
          deadlineId: 'dl_a',
        }),
      ],
    });
    expect(detectRiskSignals(model, { ruleIds: ['obligation-without-deadline'] })).toEqual([]);
  });

  it('skips informational obligations', () => {
    const model = buildModel({
      clauses: [clause('cl_a', 'The parties acknowledge the following.')],
      obligations: [
        createObligation({
          id: 'obl_info',
          documentId: DOCUMENT_ID,
          summary: 'Acknowledge the notice.',
          clauseId: 'cl_a',
          informational: true,
        }),
      ],
    });
    expect(
      detectRiskSignals(model, {
        ruleIds: ['obligation-without-deadline', 'obligation-without-consequence'],
      }),
    ).toEqual([]);
  });
});

describe('riskRules: clause wording rules', () => {
  it('finds uncapped liability wording and cites the phrase', () => {
    const model = buildModel({
      clauses: [
        clause('cl_liab', 'The Supplier has unlimited liability for any breach of this Agreement.', {
          number: '9.1',
        }),
      ],
    });
    const signals = detectRiskSignals(model, { ruleIds: ['unlimited-liability'] });
    expect(signals).toHaveLength(1);
    expect(signals[0].severity).toBe('high');
    expect(signals[0].detection.basis[0]).toContain('unlimited liability');
    expect(signals[0].detection.where).toBe('Clause 9.1');
  });

  it('finds automatic renewal wording and broad discretion wording', () => {
    const renewal = buildModel({
      clauses: [
        clause('cl_renew', '3.2 This Agreement automatically renews for successive periods of twelve months.'),
      ],
    });
    expect(detectRiskSignals(renewal, { ruleIds: ['automatic-renewal'] })).toHaveLength(1);

    const discretion = buildModel({
      clauses: [clause('cl_disc', '4.3 The Supplier may change the fees at its sole discretion.')],
    });
    const signals = detectRiskSignals(discretion, { ruleIds: ['broad-discretion'] });
    expect(signals).toHaveLength(1);
    expect(signals[0].detection.basis[0]).toContain('sole discretion');
  });

  it('finds qualified performance standards, including obligation standards', () => {
    const model = buildModel({
      clauses: [clause('cl_best', '5.1 The Supplier shall use best efforts to deliver.')],
      obligations: [
        createObligation({
          id: 'obl_best',
          documentId: DOCUMENT_ID,
          summary: 'Deliver using reasonable efforts.',
          clauseId: 'cl_best',
          standard: 'reasonable-efforts',
        }),
      ],
    });
    const signals = detectRiskSignals(model, { ruleIds: ['vague-standard'] });
    expect(signals.length).toBeGreaterThanOrEqual(2);
    const standards = signals.map((signal) => signal.detection.details?.standard).filter(Boolean);
    expect(standards).toContain('reasonable-efforts');
  });

  it('flags renewal clauses with no notice deadline recorded', () => {
    const model = buildModel({
      clauses: [
        clause('cl_renew', '3.2 The term renews for further periods unless notice is given.', {
          clauseType: 'renewal',
        }),
      ],
    });
    expect(detectRiskSignals(model, { ruleIds: ['renewal-without-notice-window'] })).toHaveLength(1);
  });

  it('flags termination wording that names only one party', () => {
    const acme = createParty({ id: 'party_a', documentId: DOCUMENT_ID, name: 'Acme Limited', role: 'customer' });
    const beta = createParty({ id: 'party_b', documentId: DOCUMENT_ID, name: 'Beta Supplies', role: 'supplier' });
    const model = buildModel({
      parties: [acme, beta],
      clauses: [
        clause('cl_term', '8.1 Acme Limited may terminate this Agreement for convenience.', {
          clauseType: 'termination',
        }),
      ],
    });
    const signals = detectRiskSignals(model, { ruleIds: ['one-sided-termination'] });
    expect(signals).toHaveLength(1);
    expect(signals[0].title).toContain('Acme Limited');
    expect(signals[0].detection.basis).toContain('Only Acme Limited is named in this clause.');
  });
});

describe('riskRules: deadline rules', () => {
  it('flags a relative deadline the engine cannot anchor, without inventing a date', () => {
    const model = buildModel({
      clauses: [clause('cl_a', '6.1 The Customer shall pay within 30 days after delivery.')],
      deadlines: [
        createDeadline({
          id: 'dl_relative',
          documentId: DOCUMENT_ID,
          description: 'Pay within 30 days after delivery',
          dateType: 'relative',
          offsetAmount: 30,
          offsetUnit: 'day',
          anchorEvent: 'delivery',
          clauseId: 'cl_a',
        }),
      ],
    });
    const signals = detectRiskSignals(model, { ruleIds: ['deadline-unresolvable'], effectiveDate: null });
    expect(signals).toHaveLength(1);
    expect(signals[0].severity).toBe('medium');
    expect(signals[0].detection.basis[0]).toMatch(/anchor|no calendar date/i);
  });

  it('does not flag a recurring deadline with a usable anchor', () => {
    const model = buildModel({
      clauses: [clause('cl_a', '6.2 Fees are invoiced monthly.')],
      deadlines: [
        createDeadline({
          id: 'dl_recurring',
          documentId: DOCUMENT_ID,
          description: 'Monthly invoicing',
          dateType: 'recurring',
          recurrence: 'monthly',
          anchorDate: '2026-01-15',
          clauseId: 'cl_a',
        }),
      ],
    });
    expect(
      detectRiskSignals(model, { ruleIds: ['deadline-unresolvable'], today: '2026-03-01' }),
    ).toEqual([]);
  });

  it('flags notice periods shorter than the threshold', () => {
    const model = buildModel({
      clauses: [
        clause('cl_notice', '7.1 Either party may terminate on fourteen (14) days written notice.', {
          clauseType: 'notice',
        }),
      ],
      deadlines: [
        createDeadline({
          id: 'dl_notice',
          documentId: DOCUMENT_ID,
          description: 'Termination notice of fourteen (14) days',
          dateType: 'relative',
          offsetAmount: 14,
          offsetUnit: 'day',
          anchorEvent: 'notice given',
          clauseId: 'cl_notice',
        }),
      ],
    });
    const signals = detectRiskSignals(model, { ruleIds: ['short-notice-period'] });
    expect(signals).toHaveLength(1);
    expect(signals[0].detection.details.days).toBe(14);
    expect(signals[0].detection.details.threshold).toBe(30);
    expect(signals[0].title).toContain('14');
  });

  it('leaves notice periods at or above the threshold alone', () => {
    const model = buildModel({
      clauses: [
        clause('cl_notice', '7.1 Either party may terminate on thirty (30) days written notice.', {
          clauseType: 'notice',
        }),
      ],
      deadlines: [
        createDeadline({
          id: 'dl_notice',
          documentId: DOCUMENT_ID,
          description: 'Termination notice of thirty (30) days from notice',
          dateType: 'relative',
          offsetAmount: 30,
          offsetUnit: 'day',
          anchorEvent: 'notice given',
          clauseId: 'cl_notice',
        }),
      ],
    });
    expect(detectRiskSignals(model, { ruleIds: ['short-notice-period'] })).toEqual([]);
  });
});

describe('riskRules: obligations imbalance', () => {
  it('flags a 3x concentration of recorded duties', () => {
    const acme = createParty({ id: 'party_a', documentId: DOCUMENT_ID, name: 'Acme Limited', role: 'customer' });
    const obligations = Array.from({ length: 4 }, (_, index) =>
      createObligation({
        id: `obl_${index}`,
        documentId: DOCUMENT_ID,
        summary: `Duty ${index}`,
        obligorPartyId: acme.id,
        clauseId: 'cl_a',
        deadlineId: 'dl_a',
      }),
    );
    const model = buildModel({
      parties: [acme],
      clauses: [clause('cl_a', 'Duties of Acme Limited.')],
      deadlines: [
        createDeadline({ id: 'dl_a', documentId: DOCUMENT_ID, description: 'Date', date: '2026-02-01', clauseId: 'cl_a' }),
      ],
      obligations,
    });
    const signals = detectRiskSignals(model, { ruleIds: ['obligation-imbalance'] });
    expect(signals).toHaveLength(1);
    expect(signals[0].title).toContain('Acme Limited');
    expect(signals[0].detection.details).toMatchObject({ topCount: 4, nextCount: 0, total: 4 });
  });

  it('stays quiet when duties are spread across parties', () => {
    const acme = createParty({ id: 'party_a', documentId: DOCUMENT_ID, name: 'Acme Limited', role: 'customer' });
    const beta = createParty({ id: 'party_b', documentId: DOCUMENT_ID, name: 'Beta Supplies', role: 'supplier' });
    const obligations = [
      createObligation({ id: 'obl_a1', documentId: DOCUMENT_ID, summary: 'A1', obligorPartyId: acme.id, clauseId: 'cl_a' }),
      createObligation({ id: 'obl_a2', documentId: DOCUMENT_ID, summary: 'A2', obligorPartyId: acme.id, clauseId: 'cl_a' }),
      createObligation({ id: 'obl_b1', documentId: DOCUMENT_ID, summary: 'B1', obligorPartyId: beta.id, clauseId: 'cl_a' }),
      createObligation({ id: 'obl_b2', documentId: DOCUMENT_ID, summary: 'B2', obligorPartyId: beta.id, clauseId: 'cl_a' }),
    ];
    const model = buildModel({ parties: [acme, beta], clauses: [clause('cl_a', 'Duties.')], obligations });
    expect(detectRiskSignals(model, { ruleIds: ['obligation-imbalance'] })).toEqual([]);
  });
});

describe('riskRules: collection and helpers', () => {
  it('keeps provider findings separate from rule matches', () => {
    const model = buildModel({
      clauses: [clause('cl_a', '8.1 Acme Limited may terminate on fourteen (14) days notice.', { number: '8.1' })],
      risks: [
        createRisk({
          id: 'risk_provider',
          documentId: DOCUMENT_ID,
          title: 'Short notice window',
          category: 'short-notice-period',
          severity: 'medium',
          explanation: 'Notice is short.',
          clauseId: 'cl_a',
        }),
      ],
      deadlines: [
        createDeadline({
          id: 'dl_n',
          documentId: DOCUMENT_ID,
          description: 'Termination notice of fourteen (14) days',
          dateType: 'relative',
          offsetAmount: 14,
          offsetUnit: 'day',
          clauseId: 'cl_a',
        }),
      ],
    });
    const collected = collectRiskSignals(model);
    expect(collected.signals.every((signal) => signal.source === SIGNAL_SOURCES.RULE)).toBe(true);
    expect(collected.modelRisks).toHaveLength(1);
    expect(collected.modelRisks[0].derived).toBe(false);
    expect(collected.modelRisks[0].detection.ruleId).toBe('model-provided');
    expect(collected.modelRisks[0].detection.why).toBe('Notice is short.');
    expect(collected.duplicates.length).toBeGreaterThan(0);
    expect(collected.all).toHaveLength(collected.signals.length + collected.modelRisks.length);
    expect(collected.disclaimer).toBe(RISK_SIGNAL_DISCLAIMER);
    expect(collected.counts.detected).toBe(collected.signals.length);
    expect(collected.counts.byRule['short-notice-period']).toBeGreaterThan(0);
  });

  it('normalises a provider risk that lacks an id', () => {
    const risk = createRisk({ documentId: DOCUMENT_ID, title: 'Missing cap', category: 'unlimited-liability' });
    const normalized = normalizeModelRisk({ ...risk, id: undefined }, buildModel({}));
    expect(normalized.id).toMatch(/^risk_/);
    expect(normalized.detection.where).toBe('no clause recorded');
  });

  it('finds the signals that touched an entity or its clause', () => {
    const signals = detectRiskSignals(buildValidModel(), { today: '2026-02-01' });
    const direct = signalsForEntity('obl_confidentiality', signals);
    expect(direct.length).toBeGreaterThan(0);
    expect(direct.every((signal) => signal.detection.basis.length > 0)).toBe(true);
    expect(signalsForEntity(null, signals)).toEqual([]);
  });

  it('groups signals by category and counts them', () => {
    const signals = detectRiskSignals(buildValidModel(), { today: '2026-02-01' });
    const groups = groupSignalsByCategory(signals);
    expect(groups.reduce((total, group) => total + group.signals.length, 0)).toBe(signals.length);
    const counts = countBy(signals, (signal) => signal.category);
    expect(Object.values(counts).reduce((total, value) => total + value, 0)).toBe(signals.length);
  });
});
