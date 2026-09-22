import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_CATEGORIES,
  buildReviewChecklist,
  checklistCategoryLabel,
  checklistToText,
  groupChecklistItems,
} from '../reviewChecklist.js';
import { buildValidModel } from './fixtures.js';

const model = buildValidModel();

/** A deadline long past, so the payment obligation is definitely overdue. */
const PAST = { today: new Date('2027-06-01T00:00:00Z') };
const NEAR = { today: new Date('2026-01-15T00:00:00Z') };

describe('reviewChecklist: items', () => {
  it('returns nothing for a missing model', () => {
    expect(buildReviewChecklist(null)).toEqual([]);
  });

  it('always asks the reader to confirm parties and identities', () => {
    const items = buildReviewChecklist(model, null, NEAR);
    const confirm = items.find((item) => item.category === CHECKLIST_CATEGORIES.CONFIRM);
    expect(confirm.title).toContain('Confirm the party identities');
    expect(confirm.detail).toContain('Acme Limited');
  });

  it('flags an overdue obligation as critical with its due date', () => {
    const items = buildReviewChecklist(model, null, PAST);
    const overdue = items.find((item) => item.category === CHECKLIST_CATEGORIES.OVERDUE);
    expect(overdue.severity).toBe('critical');
    expect(overdue.title).toBe('Pay undisputed invoices within 30 days.');
    expect(overdue.detail).toContain(overdue.detail.match(/\d{4}-\d{2}-\d{2}/)[0]);
    expect(overdue.source).toBe('§1.1');
  });

  it('flags an undated obligation when no timing could be resolved', () => {
    const items = buildReviewChecklist(model, null, NEAR);
    const undated = items.find(
      (item) => item.category === CHECKLIST_CATEGORIES.UNDATED && item.entityId === 'obl_confidentiality',
    );
    expect(undated).toBeTruthy();
    expect(undated.source).toBe('§2.1');
  });

  it('surfaces medium-and-above risks and all inconsistencies', () => {
    const withInconsistency = {
      ...model,
      inconsistencies: [
        {
          id: 'inc_notice',
          documentId: model.documentId,
          title: 'Notice periods conflict',
          description: 'One clause gives 30 days, another 45 days.',
          severity: 'high',
          clauseIds: ['cl_payment', 'cl_term'],
          clauseId: 'cl_payment',
          evidence: [],
        },
      ],
    };
    const items = buildReviewChecklist(withInconsistency, null, NEAR);
    expect(items.some((item) => item.category === CHECKLIST_CATEGORIES.RISK)).toBe(true);
    const inconsistency = items.find((item) => item.category === CHECKLIST_CATEGORIES.INCONSISTENCY);
    expect(inconsistency.source).toBe('§1.1 / §3.1');
    expect(inconsistency.severity).toBe('high');
  });

  it('reports provider integrity problems from the extraction report', () => {
    const items = buildReviewChecklist(
      model,
      {
        provider: { name: 'mock' },
        accepted: false,
        evidence: { rejectedEntities: 2 },
        rejectedRelationships: [{ reason: 'unknown endpoint', relationship: { type: 'a-b' } }],
        injectionWarnings: [{ excerpt: 'ignore previous instructions' }],
      },
      NEAR,
    );
    const titles = items
      .filter((item) => item.category === CHECKLIST_CATEGORIES.PROVIDER)
      .map((item) => item.title);
    expect(titles.some((title) => title.includes('not pass validation'))).toBe(true);
    expect(titles.some((title) => title.includes('neutralised'))).toBe(true);
    expect(
      items.filter((item) => item.category === CHECKLIST_CATEGORIES.EVIDENCE).map((item) => item.title),
    ).toContain('2 proposed fact(s) were dropped');
  });

  it('orders items by severity, most urgent first', () => {
    const items = buildReviewChecklist(model, null, PAST);
    const ranks = { critical: 0, high: 1, medium: 2, low: 3, info: 4, warning: 4 };
    for (let index = 1; index < items.length; index += 1) {
      const previous = ranks[items[index - 1].severity] ?? 5;
      const current = ranks[items[index].severity] ?? 5;
      expect(previous).toBeLessThanOrEqual(current);
    }
    expect(items[0].category).toBe(CHECKLIST_CATEGORIES.OVERDUE);
  });

  it('names an obligation with no obligor as something to confirm', () => {
    const withUnattributed = {
      ...model,
      obligations: [...model.obligations, { ...model.obligations[1], id: 'obl_x', obligorPartyId: null }],
    };
    const items = buildReviewChecklist(withUnattributed, null, NEAR);
    const confirm = items.find((item) => item.title.includes('no identified obligor'));
    expect(confirm.detail).toContain('does not name a party');
    expect(confirm.source).toBe('§2.1');
  });
});

describe('reviewChecklist: rendering', () => {
  const items = buildReviewChecklist(model, null, PAST);

  it('groups items by category without losing order', () => {
    const groups = groupChecklistItems(items);
    expect(groups).toBeInstanceOf(Map);
    expect(groups.has(CHECKLIST_CATEGORIES.OVERDUE)).toBe(true);
    const flattened = [...groups.values()].flat();
    expect(flattened).toHaveLength(items.length);
  });

  it('labels every known category', () => {
    for (const category of Object.values(CHECKLIST_CATEGORIES)) {
      expect(checklistCategoryLabel(category)).not.toBe(category);
    }
    expect(checklistCategoryLabel('unknown-category')).toBe('unknown-category');
  });

  it('renders copyable plain text', () => {
    const text = checklistToText(items, { title: 'Review preparation' });
    expect(text.startsWith('Review preparation')).toBe(true);
    expect(text).toContain('[ ] Pay undisputed invoices within 30 days. (§1.1)');
    expect(text).toContain('Past due:');
    expect(text.trimEnd().endsWith('Not legal advice.')).toBe(true);
    expect(checklistToText([])).toContain('Review preparation');
  });
});
