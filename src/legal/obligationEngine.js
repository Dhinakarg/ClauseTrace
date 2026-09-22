/**
 * Obligation engine.
 *
 * Deterministic analysis of the obligations, conditions and deadlines in a
 * LegalModel. Everything here is arithmetic and lookup: no AI, no React, no
 * clock reads unless the caller injects `today` (which tests do).
 *
 * The engine never states a legal conclusion. It reports statuses such as
 * "upcoming" or "overdue" relative to dates written in the document, and
 * surfaces what it could NOT resolve so the UI can be honest about gaps.
 */

import {
  ENTITY_TYPES,
  OBLIGATION_STATUSES,
  getEntitiesByType,
  indexEntities,
} from '../legal/schema.js';

/** An obligation whose deadline falls within this window is reported as "due". */
export const DUE_SOON_DAYS = 30;

/**
 * Status values as named constants. `OBLIGATION_STATUSES` in the schema is the
 * frozen LIST of valid values; this map provides readable keys for code that
 * assigns them.
 */
const STATUS = Object.freeze({
  UPCOMING: 'upcoming',
  DUE: 'due',
  OVERDUE: 'overdue',
  CONDITIONAL: 'conditional',
  INFORMATIONAL: 'informational',
  UNKNOWN: 'unknown',
});

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const UNIT_DAYS = Object.freeze({ day: 1, week: 7 });

/** Parses an ISO date (or date-time) into a UTC Date, or null when invalid. */
export function parseISODate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value !== 'string' || !ISO_DATE.test(value.trim())) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole days between two dates (b - a), ignoring time of day. */
export function daysBetween(a, b) {
  const start = parseISODate(a);
  const end = parseISODate(b);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

/** Adds a positive offset in days/weeks/months/years to a date. */
export function addOffset(date, amount, unit) {
  const base = parseISODate(date);
  if (!base || !Number.isFinite(amount)) return null;
  const result = new Date(base.getTime());
  switch (unit) {
    case 'day':
      result.setUTCDate(result.getUTCDate() + Math.trunc(amount));
      break;
    case 'week':
      result.setUTCDate(result.getUTCDate() + Math.trunc(amount) * UNIT_DAYS.week);
      break;
    case 'month':
      result.setUTCMonth(result.getUTCMonth() + Math.trunc(amount));
      break;
    case 'year':
      result.setUTCFullYear(result.getUTCFullYear() + Math.trunc(amount));
      break;
    default:
      return null;
  }
  return result;
}

export function toISODateString(date) {
  const value = parseISODate(date);
  return value ? value.toISOString().slice(0, 10) : null;
}

const RECURRENCE_UNITS = Object.freeze({
  daily: { amount: 1, unit: 'day' },
  weekly: { amount: 1, unit: 'week' },
  monthly: { amount: 1, unit: 'month' },
  quarterly: { amount: 3, unit: 'month' },
  annually: { amount: 1, unit: 'year' },
  'semi-annually': { amount: 6, unit: 'month' },
});

/**
 * Resolves a deadline entity to a concrete calendar date when the document
 * provides enough information. Returns { date, resolvedFrom, reason }.
 */
export function resolveDeadlineDate(deadline, { today = new Date(), effectiveDate = null } = {}) {
  if (!deadline || typeof deadline !== 'object') {
    return { date: null, resolvedFrom: null, reason: 'No deadline entity was supplied.' };
  }

  const explicit = parseISODate(deadline.date);
  if (explicit) {
    return { date: explicit, resolvedFrom: 'document-date', reason: null };
  }

  if (deadline.dateType === 'recurring' && deadline.recurrence) {
    const step = RECURRENCE_UNITS[String(deadline.recurrence).toLowerCase()];
    const anchor = parseISODate(deadline.anchorDate) ?? parseISODate(effectiveDate);
    if (step && anchor) {
      let occurrence = anchor;
      const limit = parseISODate(today) ?? new Date();
      let guard = 0;
      while (occurrence.getTime() < limit.getTime() && guard < 400) {
        occurrence = addOffset(occurrence, step.amount, step.unit);
        guard += 1;
      }
      return {
        date: occurrence,
        resolvedFrom: 'recurrence',
        reason: `Recurring ${String(deadline.recurrence).toLowerCase()} from ${toISODateString(anchor)}.`,
      };
    }
    return {
      date: null,
      resolvedFrom: null,
      reason: 'Recurring deadline without a usable start date or recurrence unit.',
    };
  }

  if (deadline.offset && deadline.offset.amount && deadline.offset.unit) {
    const anchor =
      parseISODate(deadline.anchorDate) ??
      parseISODate(effectiveDate);
    if (!anchor) {
      return {
        date: null,
        resolvedFrom: null,
        reason: `Relative deadline of ${deadline.offset.amount} ${deadline.offset.unit}(s) has no anchor date in the extraction.`,
      };
    }
    return {
      date: addOffset(anchor, deadline.offset.amount, deadline.offset.unit),
      resolvedFrom: 'offset-from-anchor',
      reason: `Computed ${deadline.offset.amount} ${deadline.offset.unit}(s) from ${toISODateString(anchor)}.`,
    };
  }

  return {
    date: null,
    resolvedFrom: null,
    reason: 'Deadline has no calendar date, offset or recurrence in the extraction.',
  };
}

/* -------------------------------------------------------------------------- */
/* Obligation assessment                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Builds a lookup context once per render: id → entity plus the document's
 * effective date.
 */
export function buildObligationContext(model, { today = new Date(), effectiveDate = null } = {}) {
  const index = indexEntities(model);
  const documentEntity = getEntitiesByType(model, ENTITY_TYPES.DOCUMENT)[0] ?? null;
  return {
    model,
    index,
    today: parseISODate(today) ?? new Date(),
    effectiveDate:
      parseISODate(effectiveDate) ?? parseISODate(documentEntity?.effectiveDate) ?? null,
  };
}

/**
 * Deterministically assesses one obligation.
 * Returns { obligationId, status, dueDate, daysUntilDue, hasDeadline, reasons }.
 *
 * Status is a schedule signal, not legal advice:
 *  - 'informational' when the obligation is flagged informational
 *  - 'overdue' / 'due' / 'upcoming' when a deadline resolves to a date
 *  - 'conditional' when the obligation depends on a condition we cannot date
 *  - 'unknown' when the document does not state a usable deadline
 */
export function assessObligation(obligation, context = {}) {
  const reasons = [];
  const base = {
    obligationId: obligation?.id ?? null,
    status: STATUS.UNKNOWN,
    dueDate: null,
    daysUntilDue: null,
    hasDeadline: false,
    reason: null,
  };

  if (!obligation || typeof obligation !== 'object') {
    return { ...base, reason: 'Obligation is missing.', reasonDetail: reasons };
  }

  if (obligation.informational || obligation.standard === 'informational') {
    reasons.push('Obligation is recorded as informational.');
    return {
      ...base,
      status: STATUS.INFORMATIONAL,
      reason: 'Informational obligations carry no performance deadline.',
      reasonDetail: reasons,
    };
  }

  const index = context.index ?? indexEntities(context.model);
  const deadline = obligation.deadlineId ? index.get(obligation.deadlineId)?.entity ?? null : null;

  if (!deadline) {
    if (obligation.triggerConditionId) {
      const condition = index.get(obligation.triggerConditionId)?.entity ?? null;
      reasons.push(
        condition
          ? `Triggered by condition "${condition.summary ?? condition.id}" which has no resolvable date.`
          : 'Triggered by a condition that could not be resolved.',
      );
      return {
        ...base,
        status: STATUS.CONDITIONAL,
        reason: 'Depends on a condition; no calendar deadline on record.',
        reasonDetail: reasons,
      };
    }
    reasons.push('No deadline is linked to this obligation.');
    return {
      ...base,
      reason: 'No deadline on record; timing cannot be assessed.',
      reasonDetail: reasons,
    };
  }

  const resolved = resolveDeadlineDate(deadline, {
    today: context.today ?? new Date(),
    effectiveDate: context.effectiveDate ?? null,
  });
  if (resolved.reason) reasons.push(resolved.reason);

  if (!resolved.date) {
    return {
      ...base,
      status: obligation.triggerConditionId
        ? STATUS.CONDITIONAL
        : STATUS.UNKNOWN,
      reason: resolved.reason,
      reasonDetail: reasons,
    };
  }

  const today = context.today ?? new Date();
  const daysUntilDue = daysBetween(today, resolved.date);
  let status = STATUS.UPCOMING;
  if (daysUntilDue < 0) status = STATUS.OVERDUE;
  else if (daysUntilDue <= DUE_SOON_DAYS) status = STATUS.DUE;
  reasons.push(
    daysUntilDue < 0
      ? `Deadline passed ${Math.abs(daysUntilDue)} day(s) ago.`
      : `Deadline is ${daysUntilDue} day(s) away.`,
  );

  return {
    ...base,
    status,
    dueDate: toISODateString(resolved.date),
    daysUntilDue,
    hasDeadline: true,
    reason: reasons[reasons.length - 1] ?? null,
    reasonDetail: reasons,
  };
}

/** Assesses every obligation in the model; returns a Map keyed by obligation id. */
export function assessAllObligations(model, options = {}) {
  const context = buildObligationContext(model, options);
  const assessments = new Map();
  for (const obligation of getEntitiesByType(model, ENTITY_TYPES.OBLIGATION)) {
    assessments.set(obligation.id, assessObligation(obligation, context));
  }
  return { context, assessments };
}

/** Full context for one obligation: parties, clause, deadline, consequences. */
export function getObligationContext(model, obligationId, options = {}) {
  const context = buildObligationContext(model, options);
  const obligation = context.index.get(obligationId)?.entity ?? null;
  if (!obligation) return null;

  const resolve = (id) => (id ? (context.index.get(id)?.entity ?? null) : null);
  const consequences = getEntitiesByType(model, ENTITY_TYPES.CONSEQUENCE).filter(
    (consequence) =>
      (obligation.consequenceIds ?? []).includes(consequence.id) ||
      consequence.triggerConditionId === obligation.triggerConditionId,
  );

  return {
    obligation,
    clause: resolve(obligation.clauseId),
    obligor: resolve(obligation.obligorPartyId),
    obligee: resolve(obligation.obligeePartyId),
    deadline: resolve(obligation.deadlineId),
    triggerCondition: resolve(obligation.triggerConditionId),
    consequences,
    assessment: assessObligation(obligation, context),
  };
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Builds a deterministic chronology of dated deadlines plus the items that
 * could not be placed on a calendar (`undated`), so nothing is hidden.
 */
export function buildTimeline(model, options = {}) {
  const { today = new Date(), effectiveDate = null } = options;
  const context = buildObligationContext(model, { today, effectiveDate });
  const entries = [];
  const undated = [];

  for (const deadline of getEntitiesByType(model, ENTITY_TYPES.DEADLINE)) {
    const resolved = resolveDeadlineDate(deadline, {
      today: context.today,
      effectiveDate: context.effectiveDate,
    });
    const anchorEntry = deadline.anchorEntityId ? context.index.get(deadline.anchorEntityId) : null;
    const obligation =
      anchorEntry?.entityType === ENTITY_TYPES.OBLIGATION ? anchorEntry.entity : null;
    const clause = deadline.clauseId ? (context.index.get(deadline.clauseId)?.entity ?? null) : null;

    const entry = {
      id: deadline.id,
      entityType: ENTITY_TYPES.DEADLINE,
      dateType: deadline.dateType,
      description: deadline.description,
      date: resolved.date ? toISODateString(resolved.date) : null,
      resolvedFrom: resolved.resolvedFrom,
      resolutionNote: resolved.reason,
      obligationId: obligation?.id ?? null,
      obligationSummary: obligation?.summary ?? null,
      clauseId: deadline.clauseId,
      clauseNumber: clause?.number ?? null,
      evidence: deadline.evidence ?? [],
      daysUntil: resolved.date ? daysBetween(context.today, resolved.date) : null,
      deadline,
    };

    if (entry.date) {
      entries.push({
        ...entry,
        status: entry.daysUntil < 0 ? 'past' : entry.daysUntil <= DUE_SOON_DAYS ? 'due-soon' : 'future',
      });
    } else {
      undated.push(entry);
    }
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));
  const todayISO = toISODateString(context.today);
  const past = entries.filter((entry) => entry.status === 'past');
  const dueSoon = entries.filter((entry) => entry.status === 'due-soon');
  const future = entries.filter((entry) => entry.status === 'future');

  return {
    generatedFor: todayISO,
    effectiveDate: context.effectiveDate ? toISODateString(context.effectiveDate) : null,
    entries,
    past,
    dueSoon,
    future,
    undated,
    counts: {
      dated: entries.length,
      past: past.length,
      dueSoon: dueSoon.length,
      future: future.length,
      undated: undated.length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Aggregations                                                               */
/* -------------------------------------------------------------------------- */

/** Counts obligations by deterministic status; includes the "no deadline" gap. */
export function summarizeObligations(model, options = {}) {
  const { assessments } = assessAllObligations(model, options);
  const byStatus = OBLIGATION_STATUSES.reduce((acc, status) => ({ ...acc, [status]: 0 }), {});
  const withoutDeadline = [];
  const overdue = [];
  const dueSoon = [];
  const unknownTiming = [];

  for (const obligation of getEntitiesByType(model, ENTITY_TYPES.OBLIGATION)) {
    const assessment = assessments.get(obligation.id);
    byStatus[assessment.status] = (byStatus[assessment.status] ?? 0) + 1;
    if (!obligation.deadlineId) withoutDeadline.push({ obligation, assessment });
    if (assessment.status === STATUS.OVERDUE) overdue.push({ obligation, assessment });
    if (assessment.status === STATUS.DUE) dueSoon.push({ obligation, assessment });
    if (assessment.status === STATUS.UNKNOWN) unknownTiming.push({ obligation, assessment });
  }

  return {
    total: getEntitiesByType(model, ENTITY_TYPES.OBLIGATION).length,
    byStatus,
    overdue,
    dueSoon,
    unknownTiming,
    withoutDeadline,
    incompleteCount: unknownTiming.length + withoutDeadline.length,
  };
}

/** Obligations where the party is obligor and/or obligee. */
export function getObligationsForParty(model, partyId, { role = 'any' } = {}) {
  return getEntitiesByType(model, ENTITY_TYPES.OBLIGATION).filter((obligation) => {
    if (role === 'obligor') return obligation.obligorPartyId === partyId;
    if (role === 'obligee') return obligation.obligeePartyId === partyId;
    return obligation.obligorPartyId === partyId || obligation.obligeePartyId === partyId;
  });
}

/** Groups obligations by status for the workspace dashboard. */
export function groupObligationsByStatus(model, options = {}) {
  const { assessments } = assessAllObligations(model, options);
  const grouped = new Map();
  for (const obligation of getEntitiesByType(model, ENTITY_TYPES.OBLIGATION)) {
    const assessment = assessments.get(obligation.id);
    const bucket = grouped.get(assessment.status) ?? [];
    bucket.push({ obligation, assessment });
    grouped.set(assessment.status, bucket);
  }
  return grouped;
}

/** Groups obligations by the party that must perform them. */
export function groupObligationsByParty(model) {
  const index = indexEntities(model);
  const grouped = new Map();
  for (const obligation of getEntitiesByType(model, ENTITY_TYPES.OBLIGATION)) {
    const partyId = obligation.obligorPartyId ?? 'unassigned';
    const party = index.get(partyId)?.entity ?? null;
    const bucket = grouped.get(partyId) ?? { partyId, party, obligations: [] };
    bucket.obligations.push(obligation);
    grouped.set(partyId, bucket);
  }
  return grouped;
}
