import { describe, expect, it } from 'vitest';
import {
  DUE_SOON_DAYS,
  addOffset,
  assessAllObligations,
  assessObligation,
  buildObligationContext,
  buildTimeline,
  daysBetween,
  getObligationContext,
  getObligationsForParty,
  groupObligationsByParty,
  groupObligationsByStatus,
  parseISODate,
  resolveDeadlineDate,
  summarizeObligations,
  toISODateString,
} from '../obligationEngine.js';
import {
  ENTITY_TYPES,
  createCondition,
  createDeadline,
  createLegalModel,
  createObligation,
} from '../schema.js';
import { buildValidModel } from './fixtures.js';

const TODAY = new Date('2026-09-19T00:00:00Z');

describe('obligationEngine: dates', () => {
  it('parses ISO dates and rejects junk', () => {
    expect(toISODateString(parseISODate('2026-01-15'))).toBe('2026-01-15');
    expect(parseISODate('15 January 2026')).toBeNull();
    expect(parseISODate('')).toBeNull();
    expect(parseISODate(undefined)).toBeNull();
  });

  it('measures whole days between dates', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
    expect(daysBetween('nope', '2026-01-01')).toBeNull();
  });

  it('adds offsets in every supported unit', () => {
    expect(toISODateString(addOffset('2026-01-01', 30, 'day'))).toBe('2026-01-31');
    expect(toISODateString(addOffset('2026-01-01', 2, 'week'))).toBe('2026-01-15');
    expect(toISODateString(addOffset('2026-01-31', 1, 'month'))).toBe('2026-03-03');
    expect(toISODateString(addOffset('2026-01-01', 1, 'year'))).toBe('2027-01-01');
    expect(addOffset('2026-01-01', 5, 'fortnight')).toBeNull();
  });
});

describe('obligationEngine: deadline resolution', () => {
  it('uses an explicit date', () => {
    const resolved = resolveDeadlineDate(
      createDeadline({ id: 'dl', documentId: 'd', description: 'x', date: '2027-06-30', dateType: 'fixed' }),
      { today: TODAY },
    );
    expect(resolved.resolvedFrom).toBe('document-date');
    expect(toISODateString(resolved.date)).toBe('2027-06-30');
  });

  it('resolves an offset from the document effective date', () => {
    const resolved = resolveDeadlineDate(
      createDeadline({
        id: 'dl',
        documentId: 'd',
        description: 'x',
        dateType: 'relative',
        offsetAmount: 30,
        offsetUnit: 'day',
      }),
      { today: TODAY, effectiveDate: '2026-01-01' },
    );
    expect(toISODateString(resolved.date)).toBe('2026-01-31');
    expect(resolved.reason).toMatch(/Computed 30 day/);
  });

  it('refuses to invent a date when no anchor exists', () => {
    const resolved = resolveDeadlineDate(
      createDeadline({
        id: 'dl',
        documentId: 'd',
        description: 'x',
        dateType: 'relative',
        offsetAmount: 5,
        offsetUnit: 'year',
      }),
      { today: TODAY },
    );
    expect(resolved.date).toBeNull();
    expect(resolved.reason).toMatch(/no anchor date/);
  });

  it('projects a recurring deadline forward from its anchor', () => {
    const resolved = resolveDeadlineDate(
      createDeadline({
        id: 'dl',
        documentId: 'd',
        description: 'quarterly report',
        dateType: 'recurring',
        recurrence: 'quarterly',
      }),
      { today: TODAY, effectiveDate: '2026-01-15' },
    );
    expect(resolved.resolvedFrom).toBe('recurrence');
    expect(resolved.date.getTime()).toBeGreaterThan(TODAY.getTime());
  });

  it('reports when a deadline has no timing information at all', () => {
    const resolved = resolveDeadlineDate(
      createDeadline({ id: 'dl', documentId: 'd', description: 'x', dateType: 'unspecified' }),
      { today: TODAY },
    );
    expect(resolved.date).toBeNull();
    expect(resolved.reason).toMatch(/no calendar date/);
  });
});

describe('obligationEngine: assessment', () => {
  const model = buildValidModel();
  const context = buildObligationContext(model, { today: TODAY });

  it('resolves an obligation deadline and flags it past due', () => {
    const assessment = assessObligation(
      model.obligations.find((entry) => entry.id === 'obl_payment'),
      context,
    );
    expect(assessment.hasDeadline).toBe(true);
    expect(assessment.dueDate).toBe('2026-01-31');
    expect(assessment.status).toBe('overdue');
    expect(assessment.reasonDetail.join(' ')).toMatch(/Deadline passed/);
  });

  it('reports an obligation that has no deadline at all', () => {
    const assessment = assessObligation(
      model.obligations.find((entry) => entry.id === 'obl_confidentiality'),
      context,
    );
    expect(assessment.hasDeadline).toBe(false);
    expect(assessment.status).toBe('unknown');
    expect(assessment.reason).toMatch(/No deadline on record/);
  });

  it('marks an unresolvable, condition-dependent obligation as conditional', () => {
    const conditionalModel = createLegalModel({
      documentId: 'doc_x',
      documents: [{ id: 'doc_x', type: ENTITY_TYPES.DOCUMENT, title: 'x', documentId: 'doc_x' }],
      conditions: [
        createCondition({
          id: 'cond_1',
          documentId: 'doc_x',
          summary: 'On completion',
          conditionType: 'trigger',
        }),
      ],
      deadlines: [
        createDeadline({
          id: 'dl_rel',
          documentId: 'doc_x',
          description: 'Five years after termination',
          dateType: 'relative',
          offsetAmount: 5,
          offsetUnit: 'year',
        }),
      ],
      obligations: [
        createObligation({
          id: 'obl_1',
          documentId: 'doc_x',
          summary: 'Survive for five years',
          deadlineId: 'dl_rel',
          triggerConditionId: 'cond_1',
        }),
      ],
    });
    const assessments = assessAllObligations(conditionalModel, { today: TODAY }).assessments;
    expect(assessments.get('obl_1').status).toBe('conditional');
    expect(assessments.get('obl_1').dueDate).toBeNull();
  });

  it('marks informational obligations without applying a deadline', () => {
    const informational = createObligation({
      id: 'obl_info',
      documentId: 'doc_x',
      summary: 'Record keeping',
      informational: true,
    });
    expect(assessObligation(informational, context).status).toBe('informational');
  });

  it('is due soon when the deadline falls inside the window', () => {
    const soon = new Date(TODAY.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dueSoonModel = createLegalModel({
      documentId: 'doc_y',
      documents: [{ id: 'doc_y', type: ENTITY_TYPES.DOCUMENT, title: 'y', documentId: 'doc_y' }],
      deadlines: [
        createDeadline({
          id: 'dl_y',
          documentId: 'doc_y',
          description: 'x',
          date: soon,
          dateType: 'fixed',
        }),
      ],
      obligations: [
        createObligation({ id: 'obl_y', documentId: 'doc_y', summary: 'File report', deadlineId: 'dl_y' }),
      ],
    });
    const assessment = assessAllObligations(dueSoonModel, { today: TODAY }).assessments.get('obl_y');
    expect(assessment.status).toBe('due');
    expect(assessment.daysUntilDue).toBeLessThanOrEqual(DUE_SOON_DAYS);
  });

  it('survives malformed input', () => {
    expect(assessObligation(null, context).status).toBe('unknown');
    expect(getObligationContext(buildValidModel(), 'missing')).toBeNull();
  });
});

describe('obligationEngine: timeline and aggregation', () => {
  const model = buildValidModel();

  it('builds a sorted timeline and reports what it could date', () => {
    const timeline = buildTimeline(model, { today: TODAY });
    expect(timeline.counts.dated).toBe(2);
    expect(timeline.counts.past).toBe(1);
    expect(timeline.counts.future).toBe(1);
    expect(timeline.entries[0].date).toBe('2026-01-31');
    expect(timeline.entries[0].clauseNumber).toBe('1.1');
    expect(timeline.entries[1].date).toBe('2027-06-30');
    expect(timeline.generatedFor).toBe('2026-09-19');
  });

  it('resolves a relative deadline from the document effective date', () => {
    const relative = model.deadlines.find((deadline) => deadline.id === 'dl_payment');
    expect(relative.anchorDate).toBeNull();
    const timeline = buildTimeline(model, { today: TODAY });
    const entry = timeline.entries.find((item) => item.id === 'dl_payment');
    expect(entry.date).toBe('2026-01-31');
    expect(entry.resolutionNote).toMatch(/Computed 30 day\(s\) from 2026-01-01/);
  });

  it('lists deadlines it cannot date instead of dropping them', () => {
    const withUndated = createLegalModel({
      ...model,
      deadlines: [
        ...model.deadlines,
        createDeadline({
          id: 'dl_undated',
          documentId: model.documentId,
          description: 'Deadline stated without a date in the extraction',
          dateType: 'unspecified',
          clauseId: 'cl_term',
        }),
      ],
    });
    const timeline = buildTimeline(withUndated, { today: TODAY });
    expect(timeline.counts.undated).toBe(1);
    expect(timeline.undated[0].id).toBe('dl_undated');
    expect(timeline.undated[0].resolutionNote).toMatch(/no calendar date/);
  });

  it('summarises statuses and gaps', () => {
    const summary = summarizeObligations(model, { today: TODAY });
    expect(summary.total).toBe(2);
    expect(summary.byStatus.overdue).toBe(1);
    expect(summary.byStatus.unknown).toBe(1);
    expect(summary.overdue).toHaveLength(1);
    expect(summary.withoutDeadline).toHaveLength(1);
    expect(summary.incompleteCount).toBeGreaterThanOrEqual(1);
  });

  it('queries and groups obligations by party', () => {
    expect(getObligationsForParty(model, 'party_customer')).toHaveLength(2);
    expect(getObligationsForParty(model, 'party_customer', { role: 'obligee' })).toHaveLength(0);
    expect(groupObligationsByParty(model).get('party_customer').obligations).toHaveLength(2);
    expect(groupObligationsByStatus(model, { today: TODAY }).get('overdue')).toHaveLength(1);
  });

  it('returns rich context for one obligation', () => {
    const context = getObligationContext(model, 'obl_payment', { today: TODAY });
    expect(context.clause.id).toBe('cl_payment');
    expect(context.obligor.name).toBe('Acme Limited');
    expect(context.obligee.name).toBe('Beta Services plc');
    expect(context.deadline.id).toBe('dl_payment');
    expect(context.consequences).toHaveLength(1);
    expect(context.assessment.hasDeadline).toBe(true);
  });
});
