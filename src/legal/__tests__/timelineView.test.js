import { describe, expect, it } from 'vitest';
import { createClause, createDeadline, createDocument, createLegalModel } from '../schema.js';
import {
  TIMELINE_BUCKETS,
  TIMELINE_KINDS,
  buildTimelineItems,
  buildTimelineView,
  classifyTimelineItem,
  daysBetween,
  describeRelative,
  describeTimelineItem,
  filterTimelineItems,
  groupTimelineItems,
  timelineCountsByKind,
  timelineItemsForClause,
  timelineKindMeta,
} from '../timelineView.js';
import { buildValidModel } from './fixtures.js';

const TODAY = new Date('2026-09-19T00:00:00Z');

describe('timelineView: classification', () => {
  it('types a deadline by its own wording', () => {
    expect(classifyTimelineItem({ description: 'Invoice payment date' }, null)).toBe('payment');
    expect(classifyTimelineItem({ description: 'Automatic renewal of the term' }, null)).toBe(
      'renewal',
    );
    expect(classifyTimelineItem({ description: 'Cancellation window' }, null)).toBe('termination');
    expect(classifyTimelineItem({ description: 'Delivery milestone' }, null)).toBe('deadline');
    expect(classifyTimelineItem(null, null)).toBe('deadline');
  });

  it('types a deadline by the clause it sits in', () => {
    expect(classifyTimelineItem({ description: 'Anything' }, { clauseType: 'payment' })).toBe(
      'payment',
    );
    expect(classifyTimelineItem({ description: 'Anything' }, { clauseType: 'notice' })).toBe(
      'notice',
    );
    expect(classifyTimelineItem({ description: 'Anything' }, { clauseType: 'renewal' })).toBe(
      'renewal',
    );
    expect(
      classifyTimelineItem({ description: 'Termination window' }, { clauseType: 'termination' }),
    ).toBe('termination');
  });

  it('falls back to the last kind for an unknown kind id', () => {
    expect(timelineKindMeta('nope').id).toBe(TIMELINE_KINDS[TIMELINE_KINDS.length - 1].id);
    expect(timelineKindMeta('payment').label).toBe('Payment dates');
  });

  it('keeps the document wording instead of inventing a date', () => {
    expect(describeRelative({ offset: { amount: 30, unit: 'day' }, event: 'invoice date' })).toBe(
      '30 day(s) after invoice date',
    );
    expect(describeRelative({ offset: { amount: 5, unit: 'business day' } })).toBe(
      '5 business day(s) from an event the document does not date',
    );
    expect(describeRelative({ recurrence: 'Monthly', anchorDate: '2026-01-01' })).toBe(
      'every monthly from 2026-01-01',
    );
    expect(describeRelative({ recurrence: 'Monthly' })).toBe(
      'every monthly, start date not stated',
    );
    expect(describeRelative(null)).toBeNull();
  });

  it('measures day differences without throwing on junk', () => {
    expect(daysBetween('2026-09-19', '2026-09-29')).toBe(10);
    expect(daysBetween('2026-09-19', '2026-09-01')).toBe(-18);
    expect(daysBetween(null, '2026-09-29')).toBeNull();
    expect(daysBetween('nope', '2026-09-29')).toBeNull();
  });
});

describe('timelineView: the fixture schedule', () => {
  const view = buildTimelineView(buildValidModel(), { today: TODAY });

  it('returns one entry per deadline, with its kind and bucket', () => {
    expect(view.items.map((item) => item.id)).toEqual(['dl_payment', 'dl_term_end']);
    expect(view.items[0].kindLabel).toBe('Payment dates');
    expect(view.items[1].kind).toBe('renewal');
    expect(view.items[1].date).toBe('2027-06-30');
    expect(view.items[1].bucket).toBe('future');
    expect(view.items[1].clauseNumber).toBe('3.1');
    expect(view.items[1].evidence.length).toBeGreaterThan(0);
  });

  it('keeps a relative deadline relative when no anchor is stated', () => {
    const payment = view.items[0];
    expect(payment.date).toBeNull();
    expect(payment.relative).toBe(true);
    expect(payment.relativeExpression).toBe('30 day(s) after invoice date');
    expect(payment.bucket).toBe('undated');
    expect(payment.resolutionNote).toMatch(/no anchor date/);
  });

  it('counts what it found, per bucket and per kind', () => {
    expect(view.counts.total).toBe(2);
    expect(view.counts.dated).toBe(1);
    expect(view.counts.relative).toBe(1);
    expect(view.counts.undated).toBe(0);
    expect(view.counts.byBucket.future).toBe(1);
    expect(view.counts.byBucket.undated).toBe(1);
    expect(view.counts.byKind).toEqual({ payment: 1, renewal: 1 });
    expect(view.kinds.find((kind) => kind.id === 'payment').count).toBe(1);
    expect(view.today).toBe('2026-09-19');
    expect(view.empty).toBe(false);
    expect(view.disclaimer).toMatch(/arithmetic/);
  });

  it('dates a relative deadline once the document states an anchor', () => {
    const anchored = buildTimelineView(buildValidModel(), {
      today: TODAY,
      effectiveDate: '2026-01-01',
    });
    const payment = anchored.items.find((item) => item.id === 'dl_payment');
    expect(payment.date).toBe('2026-01-31');
    expect(payment.bucket).toBe('past');
    expect(payment.daysUntil).toBeLessThan(0);
  });

  it('survives a model that is not a model', () => {
    expect(buildTimelineItems(null)).toEqual([]);
    expect(buildTimelineView({}).empty).toBe(true);
  });
});

describe('timelineView: buckets, filters and grouping', () => {
  const model = createLegalModel({
    documentId: 'doc_buckets',
    documents: [
      createDocument({
        id: 'doc_buckets',
        title: 'Bucket fixture',
        documentType: 'agreement',
        pageCount: 1,
      }),
    ],
    clauses: [
      createClause({
        id: 'cl_1',
        documentId: 'doc_buckets',
        number: '1.1',
        heading: 'DELIVERY',
        text: '',
        level: 2,
        page: 1,
      }),
      createClause({
        id: 'cl_2',
        documentId: 'doc_buckets',
        number: '2.1',
        heading: 'TERM',
        text: '',
        level: 2,
        page: 1,
      }),
    ],
    deadlines: [
      createDeadline({
        id: 'dl_past',
        documentId: 'doc_buckets',
        description: 'Report delivery',
        date: '2026-09-01',
        dateType: 'fixed',
        clauseId: 'cl_1',
      }),
      createDeadline({
        id: 'dl_soon',
        documentId: 'doc_buckets',
        description: 'Invoice payment',
        date: '2026-09-29',
        dateType: 'fixed',
        clauseId: 'cl_1',
      }),
      createDeadline({
        id: 'dl_later',
        documentId: 'doc_buckets',
        description: 'Notice period ends',
        date: '2027-03-01',
        dateType: 'fixed',
        clauseId: 'cl_2',
      }),
    ],
  });
  const view = buildTimelineView(model, { today: TODAY, dueSoonDays: 30 });

  it('buckets every entry against the injected today', () => {
    expect(view.items.map((item) => item.bucket)).toEqual(['past', 'due-soon', 'future']);
    expect(view.counts.byBucket).toEqual({ past: 1, 'due-soon': 1, future: 1, undated: 0 });
  });

  it('always returns every bucket, even the empty ones', () => {
    const groups = groupTimelineItems(view.items);
    expect(groups.map((group) => group.id)).toEqual(TIMELINE_BUCKETS.map((bucket) => bucket.id));
    expect(groups.find((group) => group.id === 'undated').count).toBe(0);
    expect(groups.reduce((total, group) => total + group.count, 0)).toBe(view.items.length);
  });

  it('filters by kind, by bucket and by text', () => {
    expect(filterTimelineItems(view.items, { kind: 'payment' })).toHaveLength(1);
    expect(filterTimelineItems(view.items, { bucket: 'past' })).toHaveLength(1);
    expect(filterTimelineItems(view.items, { searchText: 'report' })).toHaveLength(1);
    expect(filterTimelineItems(view.items, { searchText: 'no such thing' })).toHaveLength(0);
    expect(filterTimelineItems(null)).toEqual([]);
  });

  it('counts kinds and answers per clause', () => {
    expect(timelineCountsByKind(view.items)).toEqual({ deadline: 1, payment: 1, notice: 1 });
    expect(timelineItemsForClause(view.items, 'cl_1')).toHaveLength(2);
    expect(timelineItemsForClause(view.items, null)).toEqual([]);
  });

  it('writes a spoken description of an entry', () => {
    const soon = view.items.find((item) => item.id === 'dl_soon');
    const label = describeTimelineItem(soon);
    expect(label).toContain('Payment dates');
    expect(label).toContain('dated 2026-09-29');
    expect(label).toContain('source');
    expect(describeTimelineItem(null)).toBe('');
  });
});
