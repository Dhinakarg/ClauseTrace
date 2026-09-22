/**
 * Preparation plan tests.
 *
 * The plan is the Phase 5 checklist: four sections derived deterministically from
 * the model, the extraction report and (optionally) a comparison. These tests
 * cover the shape, the derivations and the copy/export rendering.
 */

import { describe, expect, it } from 'vitest';
import {
  PREP_SECTIONS,
  PREP_SECTION_LABELS,
  PREP_SECTION_ORDER,
  PREPARE_DISCLAIMER,
  buildPreparationPlan,
  preparationToText,
  summarizePreparation,
} from '../reviewChecklist.js';
import { compareModels, CHANGE_TYPES } from '../compareEngine.js';
import { buildValidModel } from './fixtures.js';

const model = buildValidModel();
const NEAR = { today: new Date('2026-01-15T00:00:00Z') };

function sectionOf(plan, id) {
  return plan.sections.find((section) => section.id === id);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Version B: the payment deadline is shortened, so there is a change to discuss. */
function versionB() {
  const copy = clone(model);
  copy.deadlines.find((entry) => entry.id === 'dl_payment').offsetAmount = 15;
  return copy;
}

describe('preparation plan: shape', () => {
  it('always returns the four sections, in reading order', () => {
    const plan = buildPreparationPlan(model, null, NEAR);
    expect(plan.sections.map((section) => section.id)).toEqual([...PREP_SECTION_ORDER]);
    for (const section of plan.sections) {
      expect(section.label).toBe(PREP_SECTION_LABELS[section.id]);
      expect(section.description.length).toBeGreaterThan(0);
      expect(Array.isArray(section.items)).toBe(true);
    }
    expect(plan.disclaimer).toBe(PREPARE_DISCLAIMER);
    expect(plan.disclaimer).toMatch(/not legal advice/i);
  });

  it('returns empty sections with an explanation when there is no model', () => {
    const plan = buildPreparationPlan(null);
    expect(plan.counts.total).toBe(0);
    for (const section of plan.sections) {
      expect(section.items).toEqual([]);
      expect(section.note.length).toBeGreaterThan(0);
    }
  });

  it('counts items per section and per severity', () => {
    const plan = buildPreparationPlan(model, null, NEAR);
    const summary = summarizePreparation(plan);
    expect(summary.total).toBe(plan.counts.total);
    expect(summary.bySection.questions).toBe(sectionOf(plan, PREP_SECTIONS.QUESTIONS).items.length);
    expect(summary.emptySections).toContain(PREP_SECTIONS.CHANGES);
    expect(summarizePreparation(null).total).toBe(0);
  });

  it('orders items inside a section by severity, most urgent first', () => {
    const ranks = { critical: 0, high: 1, medium: 2, low: 3, info: 4, warning: 4 };
    const plan = buildPreparationPlan(model, null, NEAR);
    for (const section of plan.sections) {
      for (let index = 1; index < section.items.length; index += 1) {
        const previous = ranks[section.items[index - 1].severity] ?? 5;
        const current = ranks[section.items[index].severity] ?? 5;
        expect(previous).toBeLessThanOrEqual(current);
      }
    }
  });

  it('never repeats an item id inside a section', () => {
    const plan = buildPreparationPlan(model, null, NEAR);
    for (const section of plan.sections) {
      const ids = section.items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('caps each section at the requested size', () => {
    const plan = buildPreparationPlan(model, null, { ...NEAR, maxPerSection: 1 });
    for (const section of plan.sections) {
      expect(section.items.length).toBeLessThanOrEqual(1);
    }
  });
});


describe('preparation plan: questions and facts', () => {
  it('asks when an obligation with no usable timing must be performed', () => {
    const plan = buildPreparationPlan(model, null, NEAR);
    const questions = sectionOf(plan, PREP_SECTIONS.QUESTIONS).items;
    const timing = questions.find((item) => item.clauseId === 'cl_confidentiality');
    expect(timing).toBeTruthy();
    expect(timing.question).toMatch(/^When must/);
    expect(timing.entityId).toBe('obl_confidentiality');
  });

  it('asks about a risk signal using the rule label and clause number', () => {
    const plan = buildPreparationPlan(model, null, NEAR);
    const questions = sectionOf(plan, PREP_SECTIONS.QUESTIONS).items;
    const riskQuestion = questions.find((item) => /What does the document intend/.test(item.question));
    expect(riskQuestion).toBeTruthy();
    expect(riskQuestion.question).toMatch(/§|\d/);
    expect(riskQuestion.detail.length).toBeGreaterThan(0);
  });

  it('turns an inconsistency into a question about which provision governs', () => {
    const withInconsistency = {
      ...clone(model),
      inconsistencies: [
        {
          id: 'inc_notice',
          documentId: model.documentId,
          title: 'Notice periods conflict',
          description: 'One clause gives 30 days, another 45 days.',
          inconsistencyType: 'conflicting-notice-periods',
          severity: 'high',
          clauseIds: ['cl_payment', 'cl_term'],
          clauseId: 'cl_payment',
          evidence: [],
        },
      ],
    };
    const plan = buildPreparationPlan(withInconsistency, null, NEAR);
    const question = sectionOf(plan, PREP_SECTIONS.QUESTIONS).items.find((item) =>
      /which provision governs/i.test(item.question),
    );
    expect(question).toBeTruthy();
    expect(question.question).toContain('§1.1');
    expect(question.question).toContain('§3.1');
  });

  it('lists the parties to confirm under facts to gather', () => {
    const plan = buildPreparationPlan(model, null, NEAR);
    const facts = sectionOf(plan, PREP_SECTIONS.FACTS).items;
    const parties = facts.filter((item) => /Confirm the identity of/.test(item.title));
    expect(parties.map((item) => item.title)).toContain('Confirm the identity of Acme Limited');
    expect(parties[0].detail).toMatch(/jurisdiction/);
  });

  it('reports extraction problems as facts to gather', () => {
    const plan = buildPreparationPlan(
      model,
      {
        provider: { name: 'mock' },
        accepted: false,
        evidence: { rejectedEntities: 2 },
        droppedItems: { deadlines: 1 },
        rejectedRelationships: [{ reason: 'unknown endpoint', relationship: { type: 'a-b' } }],
        injectionWarnings: [{ excerpt: 'ignore previous instructions' }],
      },
      NEAR,
    );
    const titles = sectionOf(plan, PREP_SECTIONS.FACTS).items.map((item) => item.title);
    expect(titles.some((title) => title.includes('2 dropped fact(s)'))).toBe(true);
    expect(titles.some((title) => title.includes('failed validation'))).toBe(true);
    expect(titles.some((title) => title.includes('instruction-like'))).toBe(true);
    expect(titles.some((title) => title.includes('dropped from deadlines'))).toBe(true);
  });

  it('asks who owes a duty that has no identified obligor', () => {
    const withUnattributed = {
      ...clone(model),
      obligations: [
        ...model.obligations,
        { ...clone(model.obligations[1]), id: 'obl_x', obligorPartyId: null },
      ],
    };
    const plan = buildPreparationPlan(withUnattributed, null, NEAR);
    const questions = sectionOf(plan, PREP_SECTIONS.QUESTIONS).items;
    expect(questions.some((item) => /Which party is responsible/.test(item.question))).toBe(true);
  });
});

describe('preparation plan: clauses to discuss', () => {
  it('aggregates the reasons a clause is on the list, once per clause', () => {
    const plan = buildPreparationPlan(model, null, NEAR);
    const clauses = sectionOf(plan, PREP_SECTIONS.CLAUSES).items;
    expect(clauses.length).toBeGreaterThan(0);
    const confidentiality = clauses.find((item) => item.clauseId === 'cl_confidentiality');
    expect(confidentiality).toBeTruthy();
    expect(confidentiality.detail).toMatch(/Timing unclear/);
    expect(confidentiality.title).toContain('§2.1');
    const clauseIds = clauses.map((item) => item.clauseId);
    expect(new Set(clauseIds).size).toBe(clauseIds.length);
  });

  it('does not state a verdict about the clause', () => {
    const plan = buildPreparationPlan(model, null, NEAR);
    for (const item of sectionOf(plan, PREP_SECTIONS.CLAUSES).items) {
      expect(item.detail).not.toMatch(/unenforceable|breach of contract|illegal/i);
      expect(item.detail).not.toMatch(/you should/i);
    }
  });
});

describe('preparation plan: changes to discuss', () => {
  it('explains that a second version is needed when there is no comparison', () => {
    const plan = buildPreparationPlan(model, null, NEAR);
    const changes = sectionOf(plan, PREP_SECTIONS.CHANGES);
    expect(changes.items).toEqual([]);
    expect(changes.note).toMatch(/second version/i);
    expect(plan.comparison.available).toBe(false);
    expect(summarizePreparation(plan).comparisonAvailable).toBe(false);
  });

  it('lists each change with what it reaches', () => {
    const comparison = compareModels(model, versionB());
    const plan = buildPreparationPlan(model, null, {
      ...NEAR,
      comparison,
      comparisonLabels: { a: 'Version A', b: 'Version B' },
    });
    const changes = sectionOf(plan, PREP_SECTIONS.CHANGES).items;
    expect(changes.length).toBeGreaterThan(0);
    expect(
      changes.every((item) => /^(Added|Removed|Modified|Relationship changed)/.test(item.title)),
    ).toBe(true);
    expect(changes.some((item) => /reaches|not wired to any other record/.test(item.detail))).toBe(
      true,
    );
    expect(plan.comparison.available).toBe(true);
    expect(plan.comparison.versionA).toBe('Version A');
    expect(plan.comparison.changeCount).toBe(
      comparison.changes.filter((change) => change.changeType !== CHANGE_TYPES.UNCHANGED).length,
    );
    expect(summarizePreparation(plan).changeCount).toBe(plan.comparison.changeCount);
  });

  it('ignores a comparison that could not run', () => {
    const plan = buildPreparationPlan(model, null, {
      ...NEAR,
      comparison: { ok: false, changes: [] },
    });
    expect(sectionOf(plan, PREP_SECTIONS.CHANGES).items).toEqual([]);
    expect(plan.comparison.available).toBe(false);
  });
});

describe('preparation plan: copy and export', () => {
  it('renders every section as checkable plain text', () => {
    const plan = buildPreparationPlan(model, null, NEAR);
    const text = preparationToText(plan);
    expect(text.startsWith('Review preparation')).toBe(true);
    for (const section of plan.sections) {
      expect(text).toContain(`${section.label}:`);
    }
    expect(text).toContain('- [ ] ');
    expect(text.trimEnd().endsWith('Not legal advice.')).toBe(true);
    expect(preparationToText(null)).toContain('Review preparation');
  });

  it('prints the question text rather than the internal title when there is one', () => {
    const plan = buildPreparationPlan(model, null, NEAR);
    const item = sectionOf(plan, PREP_SECTIONS.QUESTIONS).items.find((entry) => entry.question);
    expect(preparationToText(plan)).toContain(item.question);
  });
});

