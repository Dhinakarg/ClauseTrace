/**
 * Obligation views.
 *
 * "My Obligations" is the answer to "what does this document require of whom?".
 * Each card carries the six things a reader needs — responsible party, the
 * action, the recipient, the trigger, the deadline and the consequence — plus
 * the source clause and the citations. Cards are grouped into
 * overdue / due soon / upcoming / conditional / unclear timing / informational
 * using the deterministic assessments from `obligationEngine`.
 *
 * The Rights board is the mirror image: the same clauses read from the side of
 * the party that may act, so a reader can switch between them without losing
 * their place.
 */

import { ENTITY_TYPES } from './schema.js';
import { assessAllObligations, buildObligationContext, resolveDeadlineDate } from './obligationEngine.js';
import { normalizeText, truncate } from './signalSupport.js';

/** Groups shown in the obligations view, most urgent first. */
export const OBLIGATION_GROUPS = Object.freeze([
  {
    id: 'overdue',
    label: 'Past due',
    description: 'The document states a date that has already passed.',
    statuses: ['overdue'],
  },
  {
    id: 'due-soon',
    label: 'Due soon',
    description: 'Due within the coming month on the extracted dates.',
    statuses: ['due'],
  },
  {
    id: 'upcoming',
    label: 'Upcoming',
    description: 'Dated duties still ahead of us.',
    statuses: ['upcoming'],
  },
  {
    id: 'conditional',
    label: 'Conditional',
    description: 'Duties that only bite when a stated condition is met.',
    statuses: ['conditional'],
  },
  {
    id: 'unknown',
    label: 'Timing unclear',
    description: 'The document does not state a deadline this engine can resolve.',
    statuses: ['unknown'],
  },
  {
    id: 'informational',
    label: 'Informational',
    description: 'Statements recorded without a performance duty.',
    statuses: ['informational'],
  },
]);

export const OBLIGATION_GROUP_IDS = Object.freeze(OBLIGATION_GROUPS.map((group) => group.id));

const GROUP_BY_STATUS = Object.freeze({
  overdue: 'overdue',
  due: 'due-soon',
  upcoming: 'upcoming',
  conditional: 'conditional',
  unknown: 'unknown',
  informational: 'informational',
});

export function groupIdForStatus(status) {
  return GROUP_BY_STATUS[status] ?? 'unknown';
}

export function obligationGroupMeta(groupId) {
  return OBLIGATION_GROUPS.find((group) => group.id === groupId) ?? null;
}

/** One-sentence accessible description of a card, used by list view and aria. */
export function describeObligationCard(card) {
  if (!card) return '';
  const parts = [];
  parts.push(`${card.responsibleName} must ${card.actionText || card.summary}`);
  if (card.recipientName) parts.push(`for ${card.recipientName}`);
  if (card.trigger?.text) parts.push(`when ${card.trigger.text}`);
  if (card.deadline?.relativeExpression) parts.push(`timing: ${card.deadline.relativeExpression}`);
  else if (card.deadline?.date) parts.push(`due ${card.deadline.date}`);
  if (card.deadline?.resolutionNote) parts.push(card.deadline.resolutionNote);
  if (card.consequences.length) parts.push(`${card.consequences.length} consequence(s) recorded`);
  if (card.clauseLabel) parts.push(`source ${card.clauseLabel}`);
  parts.push(
    card.assessment?.dueDate
      ? `assessment: ${card.assessment.status}`
      : `assessment: ${card.assessment?.status ?? 'unknown'}`,
  );
  return `${parts.join(', ')}.`;
}

/** Clause label helper: "Clause 4.2 (Payment)". */
export function clauseLabelFor(clause) {
  if (!clause) return null;
  const heading = clause.heading ? ` (${clause.heading})` : '';
  return clause.number ? `Clause ${clause.number}${heading}` : `unnumbered clause${heading}`;
}

/** Relative wording preserved verbatim when no calendar date can be resolved. */
export function relativeDeadlineExpression(deadline) {
  if (!deadline) return null;
  const offset = deadline.offset;
  if (offset?.amount && offset?.unit) {
    const anchor = normalizeText(deadline.event ?? deadline.anchorEvent ?? '');
    return anchor
      ? `within ${offset.amount} ${offset.unit}(s) after ${anchor}`
      : `within ${offset.amount} ${offset.unit}(s) of an event the document does not date`;
  }
  if (deadline.dateType === 'recurring' && deadline.recurrence) {
    const anchor = deadline.anchorDate ? ` from ${deadline.anchorDate}` : ' with no start date stated';
    return `recurring ${String(deadline.recurrence).toLowerCase()}${anchor}`;
  }
  return null;
}

/**
 * Builds every obligation card for a model.
 * Pure: the same model and options always produce the same cards, in document
 * order, with their assessments attached.
 */
export function buildObligationCards(model, options = {}) {
  if (!model || typeof model !== 'object') return [];
  const { context, assessments } = assessAllObligations(model, options);
  const resolve = (id) => (id ? context.index.get(id)?.entity ?? null : null);

  return (model.obligations ?? []).map((obligation) => {
    const assessment = assessments.get(obligation.id) ?? null;
    const obligor = resolve(obligation.obligorPartyId);
    const obligee = resolve(obligation.obligeePartyId);
    const clause = resolve(obligation.clauseId);
    const deadline = resolve(obligation.deadlineId);
    const triggerCondition = resolve(obligation.triggerConditionId);
    const consequences = (obligation.consequenceIds ?? []).map(resolve).filter(Boolean);
    const resolvedDate = deadline
      ? resolveDeadlineDate(deadline, {
          today: options.today,
          effectiveDate: context.effectiveDate,
        })
      : null;
    const groupId = groupIdForStatus(assessment?.status ?? 'unknown');

    const card = {
      id: obligation.id,
      summary: obligation.summary ?? '',
      actionText: obligation.action ?? null,
      standard: obligation.standard ?? 'unknown',
      informational: Boolean(obligation.informational),
      responsibleId: obligor?.id ?? null,
      responsibleName: obligor?.name ?? 'Party not stated',
      recipientId: obligee?.id ?? null,
      recipientName: obligee?.name ?? null,
      trigger: triggerCondition
        ? {
            conditionId: triggerCondition.id,
            text: triggerCondition.triggerDescription || triggerCondition.summary,
            conditionType: triggerCondition.conditionType ?? 'unknown',
          }
        : obligation.triggerText
          ? { conditionId: null, text: obligation.triggerText, conditionType: 'text-only' }
          : null,
      deadline: deadline
        ? {
            id: deadline.id,
            description: deadline.description ?? '',
            dateType: deadline.dateType ?? 'unspecified',
            date: resolvedDate?.date ? resolvedDate.date.toISOString().slice(0, 10) : null,
            resolvedFrom: resolvedDate?.resolvedFrom ?? null,
            resolutionNote: resolvedDate?.reason ?? null,
            relativeExpression: relativeDeadlineExpression(deadline),
            responsibleId: deadline.responsiblePartyId ?? null,
          }
        : null,
      consequences: consequences.map((consequence) => ({
        id: consequence.id,
        description: consequence.description ?? '',
        consequenceType: consequence.consequenceType ?? 'unknown',
        severity: consequence.severity ?? 'unknown',
      })),
      clause: clause
        ? { id: clause.id, number: clause.number ?? null, heading: clause.heading ?? null }
        : null,
      clauseId: clause?.id ?? null,
      clauseLabel: clauseLabelFor(clause),
      evidence: Array.isArray(obligation.evidence) ? obligation.evidence : [],
      assessment,
      status: assessment?.status ?? 'unknown',
      dueDate: assessment?.dueDate ?? null,
      daysUntilDue: assessment?.daysUntilDue ?? null,
      groupId,
    };
    card.ariaLabel = describeObligationCard(card);
    return card;
  });
}

/** Groups cards into the obligation groups, most urgent first, dropping empties. */
export function groupObligationCards(cards) {
  return OBLIGATION_GROUPS.map((group) => {
    const items = (cards ?? []).filter((card) => card.groupId === group.id);
    return { ...group, cards: items, count: items.length };
  });
}

/** Party filter options with counts, taken from the cards themselves. */
export function obligationPartyOptions(cards) {
  const counts = new Map();
  for (const card of cards ?? []) {
    if (!card.responsibleId) continue;
    const entry = counts.get(card.responsibleId) ?? { id: card.responsibleId, name: card.responsibleName, count: 0 };
    entry.count += 1;
    counts.set(card.responsibleId, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Client-side filtering for the obligations board. */
export function filterObligationCards(cards, { groupId = null, partyId = null, searchText = '' } = {}) {
  const needle = String(searchText ?? '').trim().toLowerCase();
  return (cards ?? []).filter((card) => {
    if (groupId && card.groupId !== groupId) return false;
    if (partyId && card.responsibleId !== partyId) return false;
    if (!needle) return true;
    return [card.summary, card.actionText, card.responsibleName, card.recipientName, card.clauseLabel]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });
}

/**
 * The My Obligations board: cards, their groups, counts, party filters and the
 * disclaimer that the grouping is arithmetic on extracted dates, not advice.
 */
export function buildObligationBoard(model, options = {}) {
  const cards = buildObligationCards(model, options);
  const groups = groupObligationCards(cards);
  const byGroup = {};
  const byStatus = {};
  for (const card of cards) {
    byGroup[card.groupId] = (byGroup[card.groupId] ?? 0) + 1;
    byStatus[card.status] = (byStatus[card.status] ?? 0) + 1;
  }
  return {
    cards,
    groups,
    counts: {
      total: cards.length,
      byGroup,
      byStatus,
      withDeadline: cards.filter((card) => Boolean(card.deadline)).length,
      withoutDeadline: cards.filter((card) => !card.deadline).length,
      withConsequence: cards.filter((card) => card.consequences.length > 0).length,
      unsourced: cards.filter((card) => !card.clauseId).length,
      unresolved: cards.filter((card) => card.deadline && !card.deadline.date).length,
    },
    parties: obligationPartyOptions(cards),
    optionsMeta: OBLIGATION_GROUPS,
    disclaimer:
      'Cards are built from validated extractions. Dates come from the document; where a deadline is relative and no anchor is stated, the wording is kept as written instead of being guessed.',
    empty: cards.length === 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Rights (the mirror view)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The same document read from the other side: what each party may do, against
 * whom, subject to which condition, and which of the recorded duties sit in the
 * same clause. Switching between this and the obligations board keeps the reader
 * on the same clause, which is why every entry carries its clause id.
 */
export function buildRightsBoard(model, options = {}) {
  if (!model || typeof model !== 'object') {
    return { rights: [], counts: { total: 0 }, parties: [], empty: true };
  }
  const context = buildObligationContext(model, options);
  const resolve = (id) => (id ? context.index.get(id)?.entity ?? null : null);
  const obligations = model.obligations ?? [];

  const rights = (model.rights ?? []).map((right) => {
    const holder = resolve(right.holderPartyId);
    const counterparty = resolve(right.counterpartyPartyId);
    const clause = resolve(right.clauseId);
    const relatedObligations = obligations
      .filter(
        (obligation) =>
          (clause && obligation.clauseId === clause.id) ||
          (counterparty && obligation.obligorPartyId === counterparty.id),
      )
      .slice(0, 6)
      .map((obligation) => ({
        id: obligation.id,
        summary: obligation.summary,
        obligorId: obligation.obligorPartyId ?? null,
        obligorName: resolve(obligation.obligorPartyId)?.name ?? 'Party not stated',
        sameClause: Boolean(clause && obligation.clauseId === clause.id),
      }));

    const parts = [];
    parts.push(
      `${holder?.name ?? 'A party not stated'} may ${right.action || right.summary}`,
    );
    if (counterparty?.name) parts.push(`against ${counterparty.name}`);
    if (right.condition) parts.push(`when ${right.condition}`);
    if ((right.limitations ?? []).length) parts.push(`${right.limitations.length} limitation(s)`);
    if (clause) parts.push(`source ${clauseLabelFor(clause)}`);

    return {
      id: right.id,
      summary: right.summary ?? '',
      action: right.action ?? null,
      holderId: holder?.id ?? null,
      holderName: holder?.name ?? 'Party not stated',
      counterpartyId: counterparty?.id ?? null,
      counterpartyName: counterparty?.name ?? null,
      condition: right.condition ?? null,
      limitations: [...(right.limitations ?? [])],
      clause: clause ? { id: clause.id, number: clause.number ?? null, heading: clause.heading ?? null } : null,
      clauseId: clause?.id ?? null,
      clauseLabel: clauseLabelFor(clause),
      evidence: Array.isArray(right.evidence) ? right.evidence : [],
      relatedObligations,
      provenance: right.provenance ?? 'unknown',
      confidence: right.confidence ?? 'unknown',
      ariaLabel: `${parts.join(', ')}.`,
    };
  });

  const counts = { total: rights.length, withoutCounterparty: 0, limited: 0, withoutClause: 0 };
  for (const right of rights) {
    if (!right.counterpartyId) counts.withoutCounterparty += 1;
    if (right.limitations.length) counts.limited += 1;
    if (!right.clauseId) counts.withoutClause += 1;
  }

  return {
    rights,
    counts,
    empty: rights.length === 0,
    disclaimer:
      'Rights are read from the same validated facts as the obligations board. A right that the document does not tie to a clause is still listed, with that gap made explicit.',
  };
}

/** Obligations recorded against one party, for the party filter on both boards. */
export function obligationsForParty(cards, partyId) {
  return filterObligationCards(cards, { partyId });
}

/** Truncated clause text for a card, used in the detail panel header. */
export function clauseExcerpt(model, clauseId, { maxLength = 220 } = {}) {
  const clause = (model?.clauses ?? []).find((entry) => entry.id === clauseId);
  if (!clause) return null;
  return {
    clauseId: clause.id,
    clauseLabel: clauseLabelFor(clause),
    excerpt: truncate(clause.text ?? '', maxLength),
    clauseType: clause.clauseType ?? 'unknown',
    entityType: ENTITY_TYPES.CLAUSE,
  };
}
