/**
 * Timeline view.
 *
 * A richer read of the extracted timing facts than the Phase 2 timeline: every
 * entry is classified (payment date, renewal, notice period, termination window,
 * other deadline) so the reader can see the shape of the schedule, and relative
 * deadlines keep the document's own wording instead of being converted into a
 * calendar date the text does not support.
 *
 * Pure module: dates are arithmetic on the document plus the injected `today`.
 */

import { ENTITY_TYPES } from './schema.js';
import { resolveDeadlineDate, toISODateString } from './obligationEngine.js';
import { buildSignalContext, clauseLabel, clauseText } from './riskRules.js';
import { mergeEvidence, normalizeText, truncate } from './signalSupport.js';

/** Entry kinds, in the order the page offers them as filters. */
export const TIMELINE_KINDS = Object.freeze([
  {
    id: 'payment',
    label: 'Payment dates',
    icon: 'banknote',
    description: 'When money is due under the document.',
  },
  {
    id: 'renewal',
    label: 'Renewals',
    icon: 'refresh-cw',
    description: 'Terms and extensions that roll the agreement on.',
  },
  {
    id: 'notice',
    label: 'Notice periods',
    icon: 'bell',
    description: 'How much notice a step in the document requires.',
  },
  {
    id: 'termination',
    label: 'Termination windows',
    icon: 'ban',
    description: 'When the agreement can be ended, and from when.',
  },
  {
    id: 'deadline',
    label: 'Other deadlines',
    icon: 'calendar-clock',
    description: 'Everything else the document dates.',
  },
]);

export const TIMELINE_KIND_IDS = Object.freeze(TIMELINE_KINDS.map((kind) => kind.id));

export function timelineKindMeta(kindId) {
  return TIMELINE_KINDS.find((kind) => kind.id === kindId) ?? TIMELINE_KINDS[TIMELINE_KINDS.length - 1];
}

export const TIMELINE_BUCKETS = Object.freeze([
  { id: 'past', label: 'Already passed' },
  { id: 'due-soon', label: 'Coming up within 30 days' },
  { id: 'future', label: 'Later' },
  { id: 'undated', label: 'No date resolved' },
]);

const KIND_PATTERNS = Object.freeze({
  payment: /invoice|payment|pay |fees?|remuneration|salary|interest|refund|deposit/i,
  renewal: /renew|extension|successive term|further term/i,
  notice: /notice|notify|notification/i,
  termination: /terminat|expiry|expire|end of (?:the )?term|cancel/i,
});

/** Classifies a deadline by its own wording and the clause it sits in. */
export function classifyTimelineItem(deadline, clause) {
  const scope = normalizeText(
    `${deadline?.description ?? ''} ${deadline?.event ?? ''} ${deadline?.anchorEvent ?? ''} ${clauseText(clause)}`,
  );
  const clauseType = clause?.clauseType ?? 'unknown';
  if (clauseType === 'renewal' || KIND_PATTERNS.renewal.test(scope)) return 'renewal';
  if (clauseType === 'termination' && KIND_PATTERNS.termination.test(scope)) return 'termination';
  if (clauseType === 'payment' || KIND_PATTERNS.payment.test(scope)) return 'payment';
  if (clauseType === 'notice' || KIND_PATTERNS.notice.test(scope)) return 'notice';
  if (KIND_PATTERNS.termination.test(scope)) return 'termination';
  return 'deadline';
}

/** Day difference between two ISO dates (b - a), or null when either is missing. */
export function daysBetween(a, b) {
  if (!a || !b) return null;
  const first = new Date(`${String(a).slice(0, 10)}T00:00:00Z`);
  const second = new Date(`${String(b).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(second.getTime())) return null;
  return Math.round((second.getTime() - first.getTime()) / 86400000);
}

/** The document's own relative wording, kept verbatim for display. */
export function describeRelative(deadline) {
  const offset = deadline?.offset;
  if (offset?.amount && offset?.unit) {
    const anchor = normalizeText(deadline.event ?? deadline.anchorEvent ?? '');
    return anchor
      ? `${offset.amount} ${offset.unit}(s) after ${anchor}`
      : `${offset.amount} ${offset.unit}(s) from an event the document does not date`;
  }
  if (deadline?.recurrence) {
    return deadline.anchorDate
      ? `every ${String(deadline.recurrence).toLowerCase()} from ${deadline.anchorDate}`
      : `every ${String(deadline.recurrence).toLowerCase()}, start date not stated`;
  }
  return null;
}

export function describeTimelineItem(item) {
  if (!item) return '';
  const parts = [`${item.kindLabel}: ${truncate(item.title, 90)}`];
  if (item.date) {
    parts.push(
      `dated ${item.date}${item.daysUntil === null ? '' : ` (${item.daysUntil} day(s) from today)`}`,
    );
  } else if (item.relativeExpression) {
    parts.push(`relative wording kept: ${item.relativeExpression}`);
  } else {
    parts.push('no date information');
  }
  if (item.responsibleName) parts.push(`responsible: ${item.responsibleName}`);
  if (item.clauseLabel) parts.push(`source ${item.clauseLabel}`);
  return `${parts.join(', ')}.`;
}

/**
 * One entry per deadline, with its kind, date (or preserved relative wording),
 * the party responsible, the clause and the citations.
 */
export function buildTimelineItems(model, options = {}) {
  if (!model || typeof model !== 'object') return [];
  const { today = new Date(), effectiveDate = null, dueSoonDays = 30 } = options;
  const context = buildSignalContext(model);
  const todayIso = toISODateString(today) ?? new Date().toISOString().slice(0, 10);
  const obligationByDeadline = new Map();
  for (const obligation of model.obligations ?? []) {
    if (obligation.deadlineId) obligationByDeadline.set(obligation.deadlineId, obligation);
  }

  return (model.deadlines ?? []).map((deadline) => {
    const clause = deadline.clauseId ? context.clauseById.get(deadline.clauseId) ?? null : null;
    const resolved = resolveDeadlineDate(deadline, { today, effectiveDate });
    const date = resolved.date ? toISODateString(resolved.date) : null;
    const daysUntil = date ? daysBetween(todayIso, date) : null;
    const relative =
      !date && Boolean(deadline.offset || deadline.recurrence || deadline.dateType === 'relative');
    const kind = classifyTimelineItem(deadline, clause);
    const responsible = deadline.responsiblePartyId
      ? context.partyById.get(deadline.responsiblePartyId) ?? null
      : null;
    const obligation = obligationByDeadline.get(deadline.id) ?? null;

    const item = {
      id: deadline.id,
      entityId: deadline.id,
      entityType: ENTITY_TYPES.DEADLINE,
      kind,
      kindLabel: timelineKindMeta(kind).label,
      title: deadline.description || obligation?.summary || 'Deadline',
      date,
      dateType: deadline.dateType ?? 'unspecified',
      resolvedFrom: resolved.resolvedFrom,
      resolutionNote: resolved.reason,
      relative,
      relativeExpression: relative ? describeRelative(deadline) : null,
      anchorEvent: deadline.event ?? deadline.anchorEvent ?? null,
      recurrence: deadline.recurrence ?? null,
      daysUntil,
      bucket: date ? (daysUntil < 0 ? 'past' : daysUntil <= dueSoonDays ? 'due-soon' : 'future') : 'undated',
      responsibleId: responsible?.id ?? null,
      responsibleName: responsible?.name ?? null,
      obligationId: obligation?.id ?? null,
      obligationSummary: obligation?.summary ?? null,
      clauseId: clause?.id ?? null,
      clauseNumber: clause?.number ?? null,
      clauseLabel: clauseLabel(clause),
      evidence: mergeEvidence(deadline.evidence, clause?.evidence, obligation?.evidence),
    };
    item.ariaLabel = describeTimelineItem(item);
    return item;
  });
}

/** Groups entries into past / due soon / future / undated (every bucket is returned). */
export function groupTimelineItems(items) {
  return TIMELINE_BUCKETS.map((bucket) => {
    const entries = (items ?? []).filter((item) => item.bucket === bucket.id);
    return { ...bucket, entries, count: entries.length };
  });
}

/** Filter by kind and/or bucket, plus a free-text search over the text shown. */
export function filterTimelineItems(items, { kind = null, bucket = null, searchText = '' } = {}) {
  const needle = String(searchText ?? '').trim().toLowerCase();
  return (items ?? []).filter((item) => {
    if (kind && item.kind !== kind) return false;
    if (bucket && item.bucket !== bucket) return false;
    if (!needle) return true;
    return [item.title, item.kindLabel, item.clauseLabel, item.responsibleName, item.relativeExpression]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });
}

/** Counts per kind, for the kind filter chips. */
export function timelineCountsByKind(items) {
  const counts = {};
  for (const item of items ?? []) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
}

/**
 * The whole timeline view: entries, their date buckets, kind filters and counts.
 * Relative deadlines are reported as relative, never silently dated.
 */
export function buildTimelineView(model, options = {}) {
  const { today = new Date(), effectiveDate = null, dueSoonDays = 30 } = options;
  const items = buildTimelineItems(model, { today, effectiveDate, dueSoonDays });
  const groups = groupTimelineItems(items);
  const byBucket = {};
  for (const group of groups) byBucket[group.id] = group.count;
  return {
    items,
    groups,
    kinds: TIMELINE_KINDS.map((kind) => ({
      ...kind,
      count: items.filter((item) => item.kind === kind.id).length,
    })),
    counts: {
      total: items.length,
      byBucket,
      byKind: timelineCountsByKind(items),
      dated: items.filter((item) => item.date).length,
      relative: items.filter((item) => item.relative).length,
      undated: items.filter((item) => !item.date && !item.relative).length,
    },
    today: toISODateString(today) ?? null,
    effectiveDate: effectiveDate ?? null,
    dueSoonDays,
    disclaimer:
      'Dates are arithmetic on what the document states. Relative deadlines keep the wording of the document instead of being guessed, and every entry links back to the words it came from.',
    empty: items.length === 0,
  };
}

/** Entries that share a clause, so the detail panel can pivot by clause. */
export function timelineItemsForClause(items, clauseId) {
  if (!clauseId) return [];
  return (items ?? []).filter((item) => item.clauseId === clauseId);
}
