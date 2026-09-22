/**
 * Compare engine â€” a deterministic, non-advisory difference between two versions
 * of the same agreement.
 *
 * Everything here is a PURE function of the two LegalModels passed in: no dates,
 * no randomness, no network, and no judgement about which version is better. A
 * change is only ever described structurally ("the stated period is shorter in
 * version B: 15 days instead of 30 days"), never rated.
 *
 * Three layers are produced:
 *  1. entity layer  â€” clauses, obligations, rights, deadlines, conditions,
 *     consequences, parties, definitions and relationships, matched across
 *     versions and classified added / removed / modified / unchanged /
 *     relationship_changed.
 *  2. text layer    â€” a word-level diff of clauses whose wording moved.
 *  3. structure layer â€” the legal skeleton the document states
 *     ("1.1 Payment → 30 days" before, "1.1 Payment → 15 days" after).
 *
 * Every change keeps the citations from both versions, so nothing about the
 * comparison is asserted without source text behind it.
 */

import {
  ENTITY_TYPES,
  MODEL_COLLECTION_KEYS,
  entityLabel,
  getEntitiesByType,
  indexEntities,
  isLegalModelLike,
} from './schema.js';
import { entityTypeLabel, relationshipTypeLabel } from './graphEngine.js';
import { diffGraphs, emptyGraphDiff } from './graphDiff.js';
import { mergeEvidence, normalizePhrase, normalizeText, toDays, truncate } from './signalSupport.js';

/* -------------------------------------------------------------------------- */
/* Change vocabulary                                                          */
/* -------------------------------------------------------------------------- */

export const CHANGE_TYPES = Object.freeze({
  ADDED: 'added',
  REMOVED: 'removed',
  MODIFIED: 'modified',
  UNCHANGED: 'unchanged',
  RELATIONSHIP_CHANGED: 'relationship_changed',
});

/**
 * Display metadata. The labels describe what happened to the record, never how
 * good or bad it is; `added` and `removed` are deliberately symmetrical.
 */
export const CHANGE_TYPE_META = Object.freeze({
  [CHANGE_TYPES.ADDED]: {
    label: 'Added',
    description: 'Recorded in version B only.',
    tone: 'accent',
    order: 0,
  },
  [CHANGE_TYPES.REMOVED]: {
    label: 'Removed',
    description: 'Recorded in version A only.',
    tone: 'critical',
    order: 1,
  },
  [CHANGE_TYPES.MODIFIED]: {
    label: 'Modified',
    description: 'Present in both versions with different wording.',
    tone: 'warning',
    order: 2,
  },
  [CHANGE_TYPES.RELATIONSHIP_CHANGED]: {
    label: 'Relationship changed',
    description: 'The two versions link different records here.',
    tone: 'accent',
    order: 3,
  },
  [CHANGE_TYPES.UNCHANGED]: {
    label: 'Unchanged',
    description: 'Word for word the same in both versions.',
    tone: 'muted',
    order: 4,
  },
});

/** Values a compared field can hold. Drives how before/after are displayed. */
export const FIELD_KINDS = Object.freeze({
  VALUE: 'value',
  TEXT: 'text',
  LONG_TEXT: 'long-text',
  REFERENCE: 'reference',
  REFERENCE_LIST: 'reference-list',
  LIST: 'list',
  PERIOD: 'period',
  FLAG: 'flag',
});

/** Machine-readable reasons a comparison could not run. Never thrown. */
export const COMPARE_PROBLEM_CODES = Object.freeze({
  NO_VERSION_A: 'compare.no-version-a',
  NO_VERSION_B: 'compare.no-version-b',
  INVALID_MODEL: 'compare.invalid-model',
});

/* -------------------------------------------------------------------------- */
/* Compared fields and scopes                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Compared fields per entity type, in display order. `get` reads a value that is
 * not a plain property (the stated period is assembled from offset/date/repeat).
 */
export const FIELD_SPECS = Object.freeze({
  [ENTITY_TYPES.CLAUSE]: Object.freeze([
    { field: 'number', label: 'Clause number', kind: FIELD_KINDS.VALUE },
    { field: 'heading', label: 'Heading', kind: FIELD_KINDS.VALUE },
    { field: 'clauseType', label: 'Clause type', kind: FIELD_KINDS.VALUE },
    { field: 'level', label: 'Level', kind: FIELD_KINDS.VALUE },
    { field: 'text', label: 'Text', kind: FIELD_KINDS.LONG_TEXT },
  ]),
  [ENTITY_TYPES.DEFINITION]: Object.freeze([
    { field: 'term', label: 'Defined term', kind: FIELD_KINDS.VALUE },
    { field: 'text', label: 'Definition', kind: FIELD_KINDS.LONG_TEXT },
    { field: 'scope', label: 'Scope', kind: FIELD_KINDS.VALUE },
    { field: 'clauseId', label: 'Defined in clause', kind: FIELD_KINDS.REFERENCE },
  ]),
  [ENTITY_TYPES.PARTY]: Object.freeze([
    { field: 'name', label: 'Name', kind: FIELD_KINDS.VALUE },
    { field: 'role', label: 'Role', kind: FIELD_KINDS.VALUE },
    { field: 'entityKind', label: 'Kind', kind: FIELD_KINDS.VALUE },
    { field: 'jurisdiction', label: 'Jurisdiction', kind: FIELD_KINDS.VALUE },
    { field: 'aliases', label: 'Also called', kind: FIELD_KINDS.LIST },
  ]),
  [ENTITY_TYPES.OBLIGATION]: Object.freeze([
    { field: 'summary', label: 'Summary', kind: FIELD_KINDS.TEXT },
    { field: 'action', label: 'Action', kind: FIELD_KINDS.VALUE },
    { field: 'standard', label: 'Standard', kind: FIELD_KINDS.VALUE },
    { field: 'obligorPartyId', label: 'Responsible party', kind: FIELD_KINDS.REFERENCE },
    { field: 'obligeePartyId', label: 'Owed to', kind: FIELD_KINDS.REFERENCE },
    { field: 'deadlineId', label: 'Deadline', kind: FIELD_KINDS.REFERENCE },
    { field: 'deadlineText', label: 'Deadline wording', kind: FIELD_KINDS.TEXT },
    { field: 'triggerConditionId', label: 'Trigger condition', kind: FIELD_KINDS.REFERENCE },
    { field: 'consequenceIds', label: 'Consequences', kind: FIELD_KINDS.REFERENCE_LIST },
    { field: 'informational', label: 'Informational only', kind: FIELD_KINDS.FLAG },
  ]),
  [ENTITY_TYPES.RIGHT]: Object.freeze([
    { field: 'summary', label: 'Summary', kind: FIELD_KINDS.TEXT },
    { field: 'action', label: 'Action', kind: FIELD_KINDS.VALUE },
    { field: 'condition', label: 'Condition', kind: FIELD_KINDS.TEXT },
    { field: 'holderPartyId', label: 'Held by', kind: FIELD_KINDS.REFERENCE },
    { field: 'counterpartyPartyId', label: 'Against', kind: FIELD_KINDS.REFERENCE },
    { field: 'limitations', label: 'Limitations', kind: FIELD_KINDS.LIST },
  ]),
  [ENTITY_TYPES.CONDITION]: Object.freeze([
    { field: 'summary', label: 'Summary', kind: FIELD_KINDS.TEXT },
    { field: 'conditionType', label: 'Condition type', kind: FIELD_KINDS.VALUE },
    { field: 'activates', label: 'Activates', kind: FIELD_KINDS.VALUE },
    { field: 'triggerDescription', label: 'Trigger', kind: FIELD_KINDS.TEXT },
    { field: 'deadlineId', label: 'Deadline', kind: FIELD_KINDS.REFERENCE },
    { field: 'clauseId', label: 'Clause', kind: FIELD_KINDS.REFERENCE },
  ]),
  [ENTITY_TYPES.DEADLINE]: Object.freeze([
    { field: 'description', label: 'Description', kind: FIELD_KINDS.TEXT },
    { field: 'dateType', label: 'Date type', kind: FIELD_KINDS.VALUE },
    { field: 'statedPeriod', label: 'Stated period', kind: FIELD_KINDS.PERIOD, get: periodPhrase },
    { field: 'date', label: 'Date', kind: FIELD_KINDS.VALUE },
    { field: 'anchorEvent', label: 'Anchored to', kind: FIELD_KINDS.TEXT },
    { field: 'recurrence', label: 'Repeats', kind: FIELD_KINDS.VALUE },
    { field: 'responsiblePartyId', label: 'Responsible party', kind: FIELD_KINDS.REFERENCE },
    { field: 'anchorEntityId', label: 'Anchored record', kind: FIELD_KINDS.REFERENCE },
  ]),
  [ENTITY_TYPES.CONSEQUENCE]: Object.freeze([
    { field: 'description', label: 'Description', kind: FIELD_KINDS.TEXT },
    { field: 'consequenceType', label: 'Consequence type', kind: FIELD_KINDS.VALUE },
    { field: 'severity', label: 'Recorded severity', kind: FIELD_KINDS.VALUE },
    { field: 'event', label: 'Triggered by', kind: FIELD_KINDS.TEXT },
    { field: 'triggerConditionId', label: 'Trigger condition', kind: FIELD_KINDS.REFERENCE },
    { field: 'affectedPartyId', label: 'Affected party', kind: FIELD_KINDS.REFERENCE },
  ]),
  [ENTITY_TYPES.RELATIONSHIP]: Object.freeze([
    { field: 'type', label: 'Relationship', kind: FIELD_KINDS.VALUE },
    { field: 'fromId', label: 'From', kind: FIELD_KINDS.REFERENCE },
    { field: 'toId', label: 'To', kind: FIELD_KINDS.REFERENCE },
    { field: 'label', label: 'Label', kind: FIELD_KINDS.TEXT },
    { field: 'directed', label: 'Directed', kind: FIELD_KINDS.FLAG },
  ]),
});

/**
 * Compared scopes, in the order the comparison UI lists them. The first seven
 * match the filters the product asks for; parties and definitions follow because
 * a change to either moves obligations, rights and deadlines.
 */
export const COMPARE_SCOPES = Object.freeze([
  {
    id: 'obligations',
    label: 'Obligations',
    entityType: ENTITY_TYPES.OBLIGATION,
    description: 'Duties the document places on a party.',
  },
  {
    id: 'rights',
    label: 'Rights',
    entityType: ENTITY_TYPES.RIGHT,
    description: 'Powers or permissions the document grants.',
  },
  {
    id: 'deadlines',
    label: 'Deadlines',
    entityType: ENTITY_TYPES.DEADLINE,
    description: 'Dates and periods the document states.',
  },
  {
    id: 'clauses',
    label: 'Clauses',
    entityType: ENTITY_TYPES.CLAUSE,
    description: 'The numbered text of the agreement.',
  },
  {
    id: 'conditions',
    label: 'Conditions',
    entityType: ENTITY_TYPES.CONDITION,
    description: 'What has to happen before something else applies.',
  },
  {
    id: 'consequences',
    label: 'Consequences',
    entityType: ENTITY_TYPES.CONSEQUENCE,
    description: 'What the document says follows a failure.',
  },
  {
    id: 'relationships',
    label: 'Relationships',
    entityType: ENTITY_TYPES.RELATIONSHIP,
    description: 'How the records in the two versions are wired together.',
  },
  {
    id: 'parties',
    label: 'Parties',
    entityType: ENTITY_TYPES.PARTY,
    description: 'Who the document names.',
  },
  {
    id: 'definitions',
    label: 'Definitions',
    entityType: ENTITY_TYPES.DEFINITION,
    description: 'Terms the document gives a fixed meaning.',
  },
]);

export const COMPARE_SCOPE_IDS = Object.freeze(COMPARE_SCOPES.map((scope) => scope.id));


/* -------------------------------------------------------------------------- */
/* Value helpers                                                              */
/* -------------------------------------------------------------------------- */

/** "30 days" / "1 month" / "on 2027-06-30" â€” the period a record states. */
export function periodPhrase(entity) {
  if (!entity) return null;
  const amount = entity.offsetAmount ?? entity.offset?.amount ?? null;
  const unit = entity.offsetUnit ?? entity.offset?.unit ?? null;
  if (amount !== null && amount !== undefined && unit) return `${amount} ${pluralise(unit, amount)}`;
  if (entity.recurrence) return `repeats every ${normalizeText(entity.recurrence)}`;
  if (entity.date) return `on ${normalizeText(entity.date)}`;
  return null;
}

function pluralise(unit, amount) {
  const text = normalizeText(unit);
  if (Number(amount) === 1) return text.replace(/s$/, '');
  return /s$/.test(text) ? text : `${text}s`;
}

/** The natural key used to match a record that was re-numbered between versions. */
const KEY_GETTERS = Object.freeze({
  [ENTITY_TYPES.CLAUSE]: (entity) =>
    normalizePhrase(entity.heading) || normalizePhrase(entity.text).slice(0, 80),
  [ENTITY_TYPES.DEFINITION]: (entity) => normalizePhrase(entity.term),
  [ENTITY_TYPES.PARTY]: (entity) => normalizePhrase(entity.name),
  [ENTITY_TYPES.OBLIGATION]: (entity) => normalizePhrase(entity.summary),
  [ENTITY_TYPES.RIGHT]: (entity) => normalizePhrase(entity.summary),
  [ENTITY_TYPES.CONDITION]: (entity) => normalizePhrase(entity.summary),
  [ENTITY_TYPES.DEADLINE]: (entity) => normalizePhrase(entity.description),
  [ENTITY_TYPES.CONSEQUENCE]: (entity) => normalizePhrase(entity.description),
  [ENTITY_TYPES.RELATIONSHIP]: (entity) =>
    normalizePhrase(`${entity.type ?? ''} ${entity.fromId ?? ''} ${entity.toId ?? ''}`),
});

/** Display ordering keys, which keep the clause number in front. */
const ORDER_GETTERS = Object.freeze({
  [ENTITY_TYPES.CLAUSE]: (entity) =>
    `${normalizePhrase(entity.number)}|${normalizePhrase(entity.heading)}`,
});

export function entityKey(entityType, entity) {
  return KEY_GETTERS[entityType]?.(entity ?? {}) ?? '';
}

/** Stable ordering key: the display key first, the id as the tie-break. */
export function sortKeyForEntity(entityType, entity) {
  const key =
    ORDER_GETTERS[entityType]?.(entity ?? {}) ||
    entityKey(entityType, entity) ||
    normalizePhrase(entityLabel(entity));
  return `${key}|${entity?.id ?? ''}`;
}

/** What a value looks like when two records are compared. */
function canonical(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizePhrase(item))
      .filter(Boolean)
      .sort()
      .join(' | ');
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return normalizePhrase(value);
}

export function referenceLabel(index, id) {
  if (!id) return null;
  const entry = index?.get?.(id) ?? null;
  if (!entry) return String(id);
  return entityLabel(entry.entity);
}

function rawValue(entity, spec) {
  if (!entity) return null;
  if (typeof spec.get === 'function') return spec.get(entity);
  return entity[spec.field] ?? null;
}

/** How a value is shown beside "before" / "after" headings. */
export function displayValue(value, spec, index = null) {
  const kind = spec?.kind ?? FIELD_KINDS.VALUE;
  if (value === null || value === undefined || value === '') return null;
  switch (kind) {
    case FIELD_KINDS.REFERENCE:
      return referenceLabel(index, value);
    case FIELD_KINDS.REFERENCE_LIST:
      return Array.isArray(value) && value.length
        ? value.map((id) => referenceLabel(index, id)).filter(Boolean).join(', ')
        : null;
    case FIELD_KINDS.LIST:
      return Array.isArray(value) && value.length
        ? value.map((item) => normalizeText(item)).join(', ')
        : null;
    case FIELD_KINDS.FLAG:
      return value ? 'Yes' : 'No';
    case FIELD_KINDS.LONG_TEXT:
      return truncate(value, 240);
    default:
      return normalizeText(value);
  }
}

/**
 * Compares every declared field of a record pair. Absent values are reported as
 * null rather than as an empty string so "not recorded" reads differently from
 * "recorded as empty".
 */
export function diffFields(before, after, { entityType, indexBefore = null, indexAfter = null } = {}) {
  const specs = FIELD_SPECS[entityType] ?? [];
  return specs.map((spec) => {
    const beforeValue = before ? rawValue(before, spec) : null;
    const afterValue = after ? rawValue(after, spec) : null;
    return {
      field: spec.field,
      label: spec.label,
      kind: spec.kind,
      before: beforeValue ?? null,
      after: afterValue ?? null,
      beforeDisplay: displayValue(beforeValue, spec, indexBefore),
      afterDisplay: displayValue(afterValue, spec, indexAfter),
      changed: canonical(beforeValue) !== canonical(afterValue),
    };
  });
}

export function compareScope(scopeId) {
  return COMPARE_SCOPES.find((scope) => scope.id === scopeId) ?? null;
}

const SCOPE_ORDER = COMPARE_SCOPE_IDS.reduce((order, id, index) => {
  order[id] = index;
  return order;
}, {});

export const COMPARE_DISCLAIMER =
  'This comparison reports what is recorded in each version and how the records are wired together. It does not rank the versions, and it does not say whether a change is desirable.';

const CHANGE_TYPE_ORDER = Object.values(CHANGE_TYPES).reduce((order, type) => {
  order[type] = CHANGE_TYPE_META[type].order;
  return order;
}, {});

/* -------------------------------------------------------------------------- */
/* Evidence helpers                                                           */
/* -------------------------------------------------------------------------- */

export function evidenceOf(entity) {
  return mergeEvidence(entity?.evidence ?? []);
}

/** Every clause a record hangs off, including the citations it carries. */
export function clauseIdsOf(entity) {
  if (!entity) return [];
  const ids = new Set();
  if (typeof entity.clauseId === 'string') ids.add(entity.clauseId);
  for (const list of [entity.clauseIds, entity.definedInClauseIds]) {
    for (const id of Array.isArray(list) ? list : []) if (typeof id === 'string') ids.add(id);
  }
  for (const reference of entity.evidence ?? []) {
    if (reference?.clauseId) ids.add(reference.clauseId);
  }
  return [...ids].sort();
}

/**
 * Citations recorded against a clause, gathered from every fact that hangs off
 * it. Used when the clause itself carries no direct citation.
 */
export function evidenceForClause(model, clauseId) {
  if (!model || !clauseId) return [];
  const lists = [];
  for (const key of MODEL_COLLECTION_KEYS) {
    if (key === 'clauses' || key === 'relationships') continue;
    for (const entity of model[key] ?? []) {
      if (clauseIdsOf(entity).includes(clauseId)) lists.push(entity.evidence ?? []);
    }
  }
  const clause = (model.clauses ?? []).find((entry) => entry.id === clauseId);
  if (clause) lists.push(clause.evidence ?? []);
  return mergeEvidence(...lists);
}


/* -------------------------------------------------------------------------- */
/* Matching records across versions                                           */
/* -------------------------------------------------------------------------- */

export function compareSortKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byId(list) {
  const map = new Map();
  for (const entity of list ?? []) {
    if (entity && typeof entity.id === 'string' && !map.has(entity.id)) map.set(entity.id, entity);
  }
  return map;
}

function groupByKey(list, entityType) {
  const groups = new Map();
  for (const entity of list) {
    const key = entityKey(entityType, entity);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entity);
  }
  return groups;
}

/**
 * Pairs records across the two versions. Ids are trusted first; records whose id
 * changed are then matched on their natural key, but only when exactly one
 * unmatched record on each side shares that key. Everything left over is added
 * or removed. Ordering is deterministic (natural key, then id).
 */
export function matchEntities(beforeList, afterList, { entityType }) {
  const beforeById = byId(beforeList);
  const afterById = byId(afterList);
  const pairs = [];
  const matchedBefore = new Set();
  const matchedAfter = new Set();

  for (const id of [...beforeById.keys()].sort()) {
    const before = beforeById.get(id);
    const after = afterById.get(id);
    if (!after) continue;
    pairs.push({ before, after, matchedBy: 'id' });
    matchedBefore.add(id);
    matchedAfter.add(id);
  }

  const beforeByKey = groupByKey(
    [...beforeById.values()].filter((entity) => !matchedBefore.has(entity.id)),
    entityType,
  );
  const afterByKey = groupByKey(
    [...afterById.values()].filter((entity) => !matchedAfter.has(entity.id)),
    entityType,
  );

  for (const key of [...beforeByKey.keys()].sort()) {
    if (!key) continue;
    const left = beforeByKey.get(key) ?? [];
    const right = afterByKey.get(key) ?? [];
    if (left.length !== 1 || right.length !== 1) continue;
    pairs.push({ before: left[0], after: right[0], matchedBy: 'key' });
    matchedBefore.add(left[0].id);
    matchedAfter.add(right[0].id);
  }

  const order = (entity) => sortKeyForEntity(entityType, entity);
  return {
    pairs: [...pairs].sort((a, b) => compareSortKeys(order(a.after), order(b.after))),
    added: [...afterById.values()]
      .filter((entity) => !matchedAfter.has(entity.id))
      .sort((a, b) => compareSortKeys(order(a), order(b))),
    removed: [...beforeById.values()]
      .filter((entity) => !matchedBefore.has(entity.id))
      .sort((a, b) => compareSortKeys(order(a), order(b))),
  };
}



/* -------------------------------------------------------------------------- */
/* Describing a change                                                        */
/* -------------------------------------------------------------------------- */

function capitalise(text) {
  const value = normalizeText(text);
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

/** Singular, lower-case noun for a scope: "obligations" → "obligation". */
export function scopeNoun(scopeId) {
  const label = compareScope(scopeId)?.label ?? 'Record';
  return label.replace(/s$/, '').toLowerCase();
}

export function fieldPhrase(field) {
  const before = field.beforeDisplay ?? 'not recorded';
  const after = field.afterDisplay ?? 'not recorded';
  return `${field.label}: ${truncate(before, 80)} → ${truncate(after, 80)}`;
}

/** Short label used in the change list. */
export function changeLabel(change) {
  if (!change) return 'Change';
  if (change.changeType === CHANGE_TYPES.RELATIONSHIP_CHANGED) {
    return `${change.beforeDisplay} → ${change.afterDisplay}`;
  }
  return change.afterLabel ?? change.beforeLabel ?? change.label ?? change.entityId;
}

/** One sentence, structural only: what moved, from what, to what. */
export function describeChange(change) {
  if (!change) return '';
  const noun = scopeNoun(change.scope);
  const label = truncate(change.label ?? change.entityId, 110);
  switch (change.changeType) {
    case CHANGE_TYPES.ADDED:
      return `${capitalise(noun)} â€œ${label}â€ is recorded in version B and not in version A.`;
    case CHANGE_TYPES.REMOVED:
      return `${capitalise(noun)} â€œ${label}â€ is recorded in version A and not in version B.`;
    case CHANGE_TYPES.UNCHANGED:
      return `${capitalise(noun)} â€œ${label}â€ reads the same in both versions.`;
    case CHANGE_TYPES.RELATIONSHIP_CHANGED:
      return `The link â€œ${change.beforeDisplay}â€ became â€œ${change.afterDisplay}â€.`;
    default: {
      const fields = (change.fields ?? []).filter((field) => field.changed !== false);
      if (fields.length === 0) {
        return `${capitalise(noun)} â€œ${label}â€ is present in both versions with no compared field changed.`;
      }
      const shown = fields.slice(0, 3).map(fieldPhrase);
      const extra = fields.length > 3 ? `; and ${fields.length - 3} more field(s)` : '';
      return `${capitalise(noun)} â€œ${label}â€ changed â€” ${shown.join('; ')}${extra}.`;
    }
  }
}

/** Verified / unverified counts for a set of citations, for the evidence panel. */
export function evidenceSummary(references) {
  const total = (references ?? []).length;
  const verified = (references ?? []).filter(
    (reference) => reference?.verified === true || reference?.status === 'verified',
  ).length;
  return { total, verified, unverified: total - verified };
}


/* -------------------------------------------------------------------------- */
/* Entity changes                                                             */
/* -------------------------------------------------------------------------- */

/** Deterministic ordering: scope, then change kind, then label, then id. */
export function compareChanges(a, b) {
  return (
    (SCOPE_ORDER[a.scope] ?? 99) - (SCOPE_ORDER[b.scope] ?? 99) ||
    (CHANGE_TYPE_ORDER[a.changeType] ?? 9) - (CHANGE_TYPE_ORDER[b.changeType] ?? 9) ||
    compareSortKeys(normalizePhrase(a.label), normalizePhrase(b.label)) ||
    compareSortKeys(a.id, b.id)
  );
}

export function sortChanges(list) {
  return [...(list ?? [])].sort(compareChanges);
}

/**
 * The period a deadline states, with the direction of the movement. The
 * direction is a fact about the two numbers, not a judgement about either.
 */
export function periodChange(before, after) {
  const beforePhrase = periodPhrase(before);
  const afterPhrase = periodPhrase(after);
  if (!beforePhrase && !afterPhrase) return null;
  if (beforePhrase === afterPhrase) return null;
  const beforeDays = deadlineDays(before);
  const afterDays = deadlineDays(after);
  let direction = 'changed';
  if (beforeDays && afterDays) {
    direction = afterDays.days < beforeDays.days ? 'shortened' : 'extended';
  }
  return {
    before: beforePhrase,
    after: afterPhrase,
    beforeDays: beforeDays?.days ?? null,
    afterDays: afterDays?.days ?? null,
    exact: Boolean(beforeDays?.exact && afterDays?.exact),
    direction,
  };
}

function deadlineDays(entity) {
  if (!entity) return null;
  const amount = entity.offsetAmount ?? entity.offset?.amount ?? null;
  const unit = entity.offsetUnit ?? entity.offset?.unit ?? null;
  if (amount === null || amount === undefined || !unit) return null;
  return toDays(amount, unit);
}

/** "The stated period is shorter in version B: 15 days instead of 30 days." */
export function periodNote(period) {
  if (!period) return null;
  if (period.direction === 'shortened' && period.beforeDays !== null) {
    return `The stated period is shorter in version B: ${period.afterDays} day(s) instead of ${period.beforeDays} day(s).`;
  }
  if (period.direction === 'extended' && period.beforeDays !== null) {
    return `The stated period is longer in version B: ${period.afterDays} day(s) instead of ${period.beforeDays} day(s).`;
  }
  return `The stated period changed from â€œ${truncate(period.before, 80)}â€ to â€œ${truncate(period.after, 80)}â€.`;
}


/**
 * Builds one change record. Both versions of the record are kept verbatim and
 * both citation sets are preserved, which is what makes the diff auditable.
 */
export function buildChange({
  changeType,
  scope,
  entityType,
  before = null,
  after = null,
  indexBefore = null,
  indexAfter = null,
  modelBefore = null,
  modelAfter = null,
}) {
  const anchor = after ?? before;
  const allFields = diffFields(before, after, { entityType, indexBefore, indexAfter });
  let fields = [];
  if (changeType === CHANGE_TYPES.MODIFIED) fields = allFields.filter((field) => field.changed);
  if (changeType === CHANGE_TYPES.ADDED || changeType === CHANGE_TYPES.REMOVED) {
    fields = allFields.filter((field) => field.before !== null || field.after !== null);
  }

  const beforeEvidence = mergeEvidence(
    entityType === ENTITY_TYPES.CLAUSE ? evidenceForClause(modelBefore, before?.id) : [],
    evidenceOf(before),
  );
  const afterEvidence = mergeEvidence(
    entityType === ENTITY_TYPES.CLAUSE ? evidenceForClause(modelAfter, after?.id) : [],
    evidenceOf(after),
  );

  const clauseIds = new Set([...clauseIdsOf(before), ...clauseIdsOf(after)]);
  if (entityType === ENTITY_TYPES.CLAUSE) {
    if (before?.id) clauseIds.add(before.id);
    if (after?.id) clauseIds.add(after.id);
  }

  const change = {
    id: `${changeType}:${scope}:${anchor?.id ?? 'unknown'}`,
    changeType,
    scope,
    entityType,
    entityTypeLabel: entityTypeLabel(entityType),
    entityId: anchor?.id ?? null,
    key: entityKey(entityType, anchor),
    label: entityLabel(anchor),
    beforeLabel: before ? entityLabel(before) : null,
    afterLabel: after ? entityLabel(after) : null,
    before,
    after,
    fields,
    changedFields: fields.map((field) => field.field),
    evidence: {
      before: beforeEvidence,
      after: afterEvidence,
      beforeSummary: evidenceSummary(beforeEvidence),
      afterSummary: evidenceSummary(afterEvidence),
    },
    clauseIds: [...clauseIds].sort(),
    period: entityType === ENTITY_TYPES.DEADLINE ? periodChange(before, after) : null,
    source: 'entity',
  };

  return { ...change, summary: describeChange(change) };
}

/** Every change inside one scope. Unchanged records are returned separately. */
export function compareEntityType(beforeModel, afterModel, { scopeId, entityType, indexBefore, indexAfter }) {
  const matched = matchEntities(
    getEntitiesByType(beforeModel, entityType),
    getEntitiesByType(afterModel, entityType),
    { entityType },
  );

  const changes = [];
  const unchanged = [];
  const base = {
    scope: scopeId,
    entityType,
    indexBefore,
    indexAfter,
    modelBefore: beforeModel,
    modelAfter: afterModel,
  };

  for (const pair of matched.pairs) {
    const diff = diffFields(pair.before, pair.after, { entityType, indexBefore, indexAfter });
    const changeType = diff.some((field) => field.changed)
      ? CHANGE_TYPES.MODIFIED
      : CHANGE_TYPES.UNCHANGED;
    const change = buildChange({ ...base, changeType, before: pair.before, after: pair.after });
    if (changeType === CHANGE_TYPES.UNCHANGED) unchanged.push(change);
    else changes.push(change);
  }
  for (const entity of matched.added) {
    changes.push(buildChange({ ...base, changeType: CHANGE_TYPES.ADDED, after: entity }));
  }
  for (const entity of matched.removed) {
    changes.push(buildChange({ ...base, changeType: CHANGE_TYPES.REMOVED, before: entity }));
  }

  return { changes: sortChanges(changes), unchanged: sortChanges(unchanged) };
}

/* -------------------------------------------------------------------------- */
/* Relationship changes                                                       */
/* -------------------------------------------------------------------------- */

function relationshipSortKey(relationship) {
  return `${normalizePhrase(relationship?.type)}|${relationship?.fromId ?? ''}|${relationship?.toId ?? ''}|${
    relationship?.id ?? ''
  }`;
}

/** "Acme Limited must pay Beta Services plc" style read-back of an edge. */
export function relationshipDisplay(relationship, index = null) {
  if (!relationship) return 'not recorded';
  const from = referenceLabel(index, relationship.fromId) ?? relationship.fromId ?? 'unknown';
  const to = referenceLabel(index, relationship.toId) ?? relationship.toId ?? 'unknown';
  return `${from} ${relationshipTypeLabel(relationship.type)} ${to}`;
}

/** Clauses and citations reachable through an edge's endpoints. */
export function endpointFacts(relationship, index) {
  if (!relationship) return { clauseIds: [], evidence: [] };
  const clauseIds = [];
  const lists = [];
  for (const id of [relationship.fromId, relationship.toId]) {
    const entry = index?.get?.(id) ?? null;
    if (!entry) continue;
    clauseIds.push(...clauseIdsOf(entry.entity));
    if (Array.isArray(entry.entity.evidence)) lists.push(entry.entity.evidence);
  }
  return { clauseIds: [...new Set(clauseIds)].sort(), evidence: mergeEvidence(...lists) };
}

function groupRelationships(list) {
  const groups = new Map();
  for (const relationship of list) {
    const key = `${relationship.type ?? 'unknown'}|${relationship.fromId ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(relationship);
  }
  return groups;
}

function decorateRelationshipChange(change, { indexBefore, indexAfter }) {
  const beforeSide = endpointFacts(change.before, indexBefore);
  const afterSide = endpointFacts(change.after, indexAfter);
  const clauseIds = [
    ...new Set([...change.clauseIds, ...beforeSide.clauseIds, ...afterSide.clauseIds]),
  ].sort();
  const beforeEvidence = mergeEvidence(change.evidence.before, beforeSide.evidence);
  const afterEvidence = mergeEvidence(change.evidence.after, afterSide.evidence);
  const beforeDisplay = relationshipDisplay(change.before, indexBefore);
  const afterDisplay = relationshipDisplay(change.after, indexAfter);
  const anchor = change.after ?? change.before;
  const typeLabel = relationshipTypeLabel(anchor?.type);
  const fromLabel = anchor?.fromType ? entityTypeLabel(anchor.fromType) : null;
  const decorated = {
    ...change,
    /* Relationships carry no label of their own, so name them by their type. */
    label: fromLabel ? `${fromLabel} ${typeLabel}` : typeLabel,
    beforeDisplay,
    afterDisplay,
    clauseIds,
    evidence: {
      before: beforeEvidence,
      after: afterEvidence,
      beforeSummary: evidenceSummary(beforeEvidence),
      afterSummary: evidenceSummary(afterEvidence),
    },
  };
  return { ...decorated, summary: describeChange(decorated) };
}

/**
 * Compares the wiring of the two versions. Edges are grouped by
 * (relationship type, source record): an edge that kept its source but points at
 * a different target is a changed relationship rather than an add plus a remove,
 * which is what makes a moved deadline readable in the UI.
 */
export function compareRelationships(
  beforeModel,
  afterModel,
  { scopeId = 'relationships', indexBefore = null, indexAfter = null } = {},
) {
  const orderList = (list) =>
    [...list].sort((a, b) => compareSortKeys(relationshipSortKey(a), relationshipSortKey(b)));
  const beforeList = orderList(getEntitiesByType(beforeModel, ENTITY_TYPES.RELATIONSHIP));
  const afterList = orderList(getEntitiesByType(afterModel, ENTITY_TYPES.RELATIONSHIP));
  const beforeGroups = groupRelationships(beforeList);
  const afterGroups = groupRelationships(afterList);
  const keys = [...new Set([...beforeGroups.keys(), ...afterGroups.keys()])].sort();

  const changes = [];
  const unchanged = [];
  const base = {
    scope: scopeId,
    entityType: ENTITY_TYPES.RELATIONSHIP,
    indexBefore,
    indexAfter,
    modelBefore: beforeModel,
    modelAfter: afterModel,
  };

  for (const key of keys) {
    const left = beforeGroups.get(key) ?? [];
    const right = afterGroups.get(key) ?? [];
    const leftByTarget = new Map(left.map((relationship) => [relationship.toId, relationship]));
    const usedLeft = new Set();
    const usedRight = new Set();

    for (const target of [...right.map((relationship) => relationship.toId)].sort()) {
      const before = leftByTarget.get(target);
      if (!before) continue;
      const after = right.find((relationship) => relationship.toId === target);
      usedLeft.add(before.id);
      usedRight.add(after.id);
      const diff = diffFields(before, after, {
        entityType: ENTITY_TYPES.RELATIONSHIP,
        indexBefore,
        indexAfter,
      });
      const changeType = diff.some((field) => field.changed)
        ? CHANGE_TYPES.RELATIONSHIP_CHANGED
        : CHANGE_TYPES.UNCHANGED;
      const change = decorateRelationshipChange(buildChange({ ...base, changeType, before, after }), {
        indexBefore,
        indexAfter,
      });
      if (changeType === CHANGE_TYPES.UNCHANGED) unchanged.push(change);
      else changes.push(change);
    }

    const leftRest = left.filter((relationship) => !usedLeft.has(relationship.id));
    const rightRest = right.filter((relationship) => !usedRight.has(relationship.id));
    const paired = Math.min(leftRest.length, rightRest.length);
    for (let index = 0; index < paired; index += 1) {
      changes.push(
        decorateRelationshipChange(
          buildChange({
            ...base,
            changeType: CHANGE_TYPES.RELATIONSHIP_CHANGED,
            before: leftRest[index],
            after: rightRest[index],
          }),
          { indexBefore, indexAfter },
        ),
      );
    }
    for (const relationship of rightRest.slice(paired)) {
      changes.push(
        decorateRelationshipChange(
          buildChange({ ...base, changeType: CHANGE_TYPES.ADDED, after: relationship }),
          { indexBefore, indexAfter },
        ),
      );
    }
    for (const relationship of leftRest.slice(paired)) {
      changes.push(
        decorateRelationshipChange(
          buildChange({ ...base, changeType: CHANGE_TYPES.REMOVED, before: relationship }),
          { indexBefore, indexAfter },
        ),
      );
    }
  }

  return { changes: sortChanges(changes), unchanged: sortChanges(unchanged) };
}

/* -------------------------------------------------------------------------- */
/* Text layer                                                                 */
/* -------------------------------------------------------------------------- */

export const TEXT_DIFF_KINDS = Object.freeze({
  SAME: 'unchanged',
  ADDED: 'added',
  REMOVED: 'removed',
});

function tokenise(text) {
  return normalizeText(text).split(' ').filter(Boolean);
}

function tokensMatch(left, right) {
  const a = normalizePhrase(left);
  return Boolean(a) && a === normalizePhrase(right);
}

function mergeRuns(tokens) {
  const segments = [];
  for (const token of tokens) {
    const last = segments[segments.length - 1];
    if (last && last.kind === token.kind) last.text = `${last.text} ${token.text}`;
    else segments.push({ kind: token.kind, text: token.text });
  }
  return segments;
}

/**
 * Word-level difference between two passages, computed with a plain LCS so the
 * same inputs always produce the same segments. Very long passages fall back to
 * one removed block plus one added block rather than a quadratic table.
 */
export function compareTexts(beforeText, afterText, { maxTokens = 800 } = {}) {
  const beforeTokens = tokenise(beforeText);
  const afterTokens = tokenise(afterText);
  const truncated = beforeTokens.length > maxTokens || afterTokens.length > maxTokens;

  if (truncated) {
    const segments = [];
    if (beforeTokens.length) segments.push({ kind: TEXT_DIFF_KINDS.REMOVED, text: beforeTokens.join(' ') });
    if (afterTokens.length) segments.push({ kind: TEXT_DIFF_KINDS.ADDED, text: afterTokens.join(' ') });
    return {
      segments,
      truncated: true,
      beforeWordCount: beforeTokens.length,
      afterWordCount: afterTokens.length,
      stats: {
        unchanged: 0,
        added: afterTokens.length,
        removed: beforeTokens.length,
        changed: beforeTokens.join(' ') !== afterTokens.join(' '),
      },
    };
  }

  const rows = beforeTokens.length;
  const columns = afterTokens.length;
  const table = new Uint16Array((rows + 1) * (columns + 1));
  const at = (row, column) => row * (columns + 1) + column;

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      table[at(row, column)] = tokensMatch(beforeTokens[row], afterTokens[column])
        ? table[at(row + 1, column + 1)] + 1
        : Math.max(table[at(row + 1, column)], table[at(row, column + 1)]);
    }
  }

  const raw = [];
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (tokensMatch(beforeTokens[row], afterTokens[column])) {
      raw.push({ kind: TEXT_DIFF_KINDS.SAME, text: beforeTokens[row] });
      row += 1;
      column += 1;
    } else if (table[at(row + 1, column)] >= table[at(row, column + 1)]) {
      raw.push({ kind: TEXT_DIFF_KINDS.REMOVED, text: beforeTokens[row] });
      row += 1;
    } else {
      raw.push({ kind: TEXT_DIFF_KINDS.ADDED, text: afterTokens[column] });
      column += 1;
    }
  }
  while (row < rows) {
    raw.push({ kind: TEXT_DIFF_KINDS.REMOVED, text: beforeTokens[row] });
    row += 1;
  }
  while (column < columns) {
    raw.push({ kind: TEXT_DIFF_KINDS.ADDED, text: afterTokens[column] });
    column += 1;
  }

  const segments = mergeRuns(raw);
  const count = (kind) => raw.filter((token) => token.kind === kind).length;
  const stats = {
    unchanged: count(TEXT_DIFF_KINDS.SAME),
    added: count(TEXT_DIFF_KINDS.ADDED),
    removed: count(TEXT_DIFF_KINDS.REMOVED),
    changed: raw.some((token) => token.kind !== TEXT_DIFF_KINDS.SAME),
  };
  return { segments, truncated: false, beforeWordCount: rows, afterWordCount: columns, stats };
}

/** Segment list for a clause that exists on one side only. */
export function oneSidedTextDiff(text, side) {
  const tokens = tokenise(text);
  return {
    segments: tokens.length ? [{ kind: side, text: tokens.join(' ') }] : [],
    truncated: false,
    beforeWordCount: side === TEXT_DIFF_KINDS.REMOVED ? tokens.length : 0,
    afterWordCount: side === TEXT_DIFF_KINDS.ADDED ? tokens.length : 0,
    stats: {
      unchanged: 0,
      added: side === TEXT_DIFF_KINDS.ADDED ? tokens.length : 0,
      removed: side === TEXT_DIFF_KINDS.REMOVED ? tokens.length : 0,
      changed: tokens.length > 0,
    },
  };
}



/* -------------------------------------------------------------------------- */
/* Structure layer                                                            */
/* -------------------------------------------------------------------------- */

export const STRUCTURE_KINDS = Object.freeze({
  CLAUSE_PERIOD: 'clause-period',
  CLAUSE_DATE: 'clause-date',
  OBLIGATION_PERIOD: 'obligation-period',
  OBLIGATION_DEADLINE: 'obligation-deadline',
  CONDITION_TIMING: 'condition-timing',
});

const STRUCTURE_KIND_LABELS = Object.freeze({
  [STRUCTURE_KINDS.CLAUSE_PERIOD]: 'Clause timing',
  [STRUCTURE_KINDS.CLAUSE_DATE]: 'Clause date',
  [STRUCTURE_KINDS.OBLIGATION_PERIOD]: 'Obligation timing',
  [STRUCTURE_KINDS.OBLIGATION_DEADLINE]: 'Obligation deadline wording',
  [STRUCTURE_KINDS.CONDITION_TIMING]: 'Condition timing',
});

/** "1.1 Payment terms" â€” how a clause is named in the structure layer. */
export function clauseSubject(clause) {
  if (!clause) return 'Clause';
  const number = normalizeText(clause.number);
  const heading = normalizeText(clause.heading);
  if (number && heading) return `${number} ${heading}`;
  if (number) return `Clause ${number}`;
  if (heading) return heading;
  return truncate(clause.text, 60) || clause.id;
}

function structureFact({ kind, subject, phrase, clauseId = null, entityId, entityType, periodEntityId = null }) {
  return {
    id: `${kind}:${entityId}`,
    kind,
    kindLabel: STRUCTURE_KIND_LABELS[kind] ?? kind,
    subject,
    subjectKey: normalizePhrase(subject),
    phrase,
    text: phrase ? `${subject} → ${phrase}` : subject,
    clauseId,
    entityId,
    entityType,
    periodEntityId,
  };
}

/**
 * The legal skeleton the document states: which clause or obligation carries
 * which timing, date or trigger. This is what lets the UI say
 * "1.1 Payment → 30 days" before and "1.1 Payment → 15 days" after.
 */
export function buildStructureFacts(model) {
  if (!model) return [];
  const facts = [];
  const deadlines = model.deadlines ?? [];

  for (const clause of model.clauses ?? []) {
    const subject = clauseSubject(clause);
    for (const deadline of deadlines.filter((entry) => entry.clauseId === clause.id)) {
      const period = periodPhrase(deadline);
      if (period) {
        facts.push(
          structureFact({
            kind: STRUCTURE_KINDS.CLAUSE_PERIOD,
            subject,
            phrase: period,
            clauseId: clause.id,
            entityId: clause.id,
            entityType: ENTITY_TYPES.CLAUSE,
            periodEntityId: deadline.id,
          }),
        );
      }
      if (deadline.date && deadline.dateType === 'fixed') {
        facts.push(
          structureFact({
            kind: STRUCTURE_KINDS.CLAUSE_DATE,
            subject,
            phrase: normalizeText(deadline.date),
            clauseId: clause.id,
            entityId: clause.id,
            entityType: ENTITY_TYPES.CLAUSE,
            periodEntityId: deadline.id,
          }),
        );
      }
    }
    for (const condition of (model.conditions ?? []).filter((entry) => entry.clauseId === clause.id)) {
      facts.push(
        structureFact({
          kind: STRUCTURE_KINDS.CONDITION_TIMING,
          subject,
          phrase: truncate(condition.summary, 80),
          clauseId: clause.id,
          entityId: condition.id,
          entityType: ENTITY_TYPES.CONDITION,
        }),
      );
    }
  }

  for (const obligation of model.obligations ?? []) {
    const subject = truncate(obligation.summary, 90) || obligation.id;
    const deadline =
      deadlines.find((entry) => entry.id === obligation.deadlineId) ??
      deadlines.find((entry) => entry.anchorEntityId === obligation.id) ??
      null;
    const period = deadline ? periodPhrase(deadline) : null;
    if (period) {
      facts.push(
        structureFact({
          kind: STRUCTURE_KINDS.OBLIGATION_PERIOD,
          subject,
          phrase: period,
          clauseId: obligation.clauseId ?? deadline?.clauseId ?? null,
          entityId: obligation.id,
          entityType: ENTITY_TYPES.OBLIGATION,
          periodEntityId: deadline.id,
        }),
      );
    }
    if (obligation.deadlineText) {
      facts.push(
        structureFact({
          kind: STRUCTURE_KINDS.OBLIGATION_DEADLINE,
          subject,
          phrase: truncate(obligation.deadlineText, 80),
          clauseId: obligation.clauseId ?? null,
          entityId: obligation.id,
          entityType: ENTITY_TYPES.OBLIGATION,
          periodEntityId: deadline?.id ?? null,
        }),
      );
    }
  }

  const order = (fact) => `${fact.kind}|${fact.subjectKey}|${fact.id}`;
  return facts.sort((a, b) => compareSortKeys(order(a), order(b)));
}

/** The structure-level difference: which clause or obligation states what. */
export function compareStructures(beforeModel, afterModel) {
  const beforeFacts = buildStructureFacts(beforeModel);
  const afterFacts = buildStructureFacts(afterModel);
  const key = (fact) => `${fact.kind}|${fact.subjectKey}`;
  const beforeByKey = new Map(beforeFacts.map((fact) => [key(fact), fact]));
  const afterByKey = new Map(afterFacts.map((fact) => [key(fact), fact]));
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();

  const changes = [];
  const unchanged = [];
  for (const entry of keys) {
    const before = beforeByKey.get(entry) ?? null;
    const after = afterByKey.get(entry) ?? null;
    const anchor = after ?? before;
    let changeType = CHANGE_TYPES.MODIFIED;
    if (!before) changeType = CHANGE_TYPES.ADDED;
    else if (!after) changeType = CHANGE_TYPES.REMOVED;
    else if (normalizePhrase(before.phrase) === normalizePhrase(after.phrase)) changeType = CHANGE_TYPES.UNCHANGED;

    const isTiming =
      anchor.kind === STRUCTURE_KINDS.OBLIGATION_PERIOD || anchor.kind === STRUCTURE_KINDS.CLAUSE_PERIOD;
    const beforeDeadline = findDeadline(beforeModel, before?.periodEntityId);
    const afterDeadline = findDeadline(afterModel, after?.periodEntityId);

    const clauseIds = [...new Set([before?.clauseId, after?.clauseId].filter(Boolean))].sort();
    const record = {
      id: `structure:${entry}`,
      kind: anchor.kind,
      kindLabel: anchor.kindLabel,
      subject: anchor.subject,
      changeType,
      beforeText: before?.text ?? null,
      afterText: after?.text ?? null,
      beforePhrase: before?.phrase ?? null,
      afterPhrase: after?.phrase ?? null,
      clauseIds,
      entityType: anchor.entityType,
      entityIds: [...new Set([before?.entityId, after?.entityId].filter(Boolean))].sort(),
      period: isTiming ? periodChange(beforeDeadline, afterDeadline) : null,
    };
    if (changeType === CHANGE_TYPES.UNCHANGED) unchanged.push(record);
    else changes.push(record);
  }

  const byKey = (record) => `${record.kind}|${normalizePhrase(record.subject)}|${record.id}`;
  return {
    facts: { before: beforeFacts, after: afterFacts },
    changes: [...changes].sort((a, b) => compareSortKeys(byKey(a), byKey(b))),
    unchanged: [...unchanged].sort((a, b) => compareSortKeys(byKey(a), byKey(b))),
  };
}

/**
 * Text-layer changes for clauses whose words moved. Added and removed clauses
 * are reported as wholly added / wholly removed passages.
 */
export function compareClauseTexts(beforeModel, afterModel) {
  const matched = matchEntities(beforeModel?.clauses ?? [], afterModel?.clauses ?? [], {
    entityType: ENTITY_TYPES.CLAUSE,
  });
  const entries = [];

  for (const pair of matched.pairs) {
    const diff = compareTexts(pair.before.text, pair.after.text);
    if (!diff.stats.changed) continue;
    entries.push({
      id: `text:${pair.after.id}`,
      clauseId: pair.after.id,
      beforeClauseId: pair.before.id,
      afterClauseId: pair.after.id,
      label: clauseSubject(pair.after),
      beforeLabel: clauseSubject(pair.before),
      afterLabel: clauseSubject(pair.after),
      changeType: CHANGE_TYPES.MODIFIED,
      beforeText: pair.before.text ?? '',
      afterText: pair.after.text ?? '',
      diff,
    });
  }
  for (const clause of matched.added) {
    entries.push({
      id: `text:${clause.id}`,
      clauseId: clause.id,
      beforeClauseId: null,
      afterClauseId: clause.id,
      label: clauseSubject(clause),
      beforeLabel: null,
      afterLabel: clauseSubject(clause),
      changeType: CHANGE_TYPES.ADDED,
      beforeText: '',
      afterText: clause.text ?? '',
      diff: oneSidedTextDiff(clause.text, TEXT_DIFF_KINDS.ADDED),
    });
  }
  for (const clause of matched.removed) {
    entries.push({
      id: `text:${clause.id}`,
      clauseId: clause.id,
      beforeClauseId: clause.id,
      afterClauseId: null,
      label: clauseSubject(clause),
      beforeLabel: clauseSubject(clause),
      afterLabel: null,
      changeType: CHANGE_TYPES.REMOVED,
      beforeText: clause.text ?? '',
      afterText: '',
      diff: oneSidedTextDiff(clause.text, TEXT_DIFF_KINDS.REMOVED),
    });
  }

  const order = (entry) => `${normalizePhrase(entry.label)}|${entry.id}`;
  return entries.sort((a, b) => compareSortKeys(order(a), order(b)));
}

/* -------------------------------------------------------------------------- */
/* Whole-model comparison                                                     */
/* -------------------------------------------------------------------------- */

function findDeadline(model, id) {
  if (!model || !id) return null;
  return (model.deadlines ?? []).find((deadline) => deadline.id === id) ?? null;
}

/** Every change in the requested scopes, plus the unchanged records. */
export function compareEntityLayer(beforeModel, afterModel, { scopeIds = null } = {}) {
  const indexBefore = indexEntities(beforeModel);
  const indexAfter = indexEntities(afterModel);
  const allowed = new Set(scopeIds && scopeIds.length ? scopeIds : COMPARE_SCOPE_IDS);

  const changes = [];
  const unchanged = [];
  for (const scope of COMPARE_SCOPES) {
    if (!allowed.has(scope.id)) continue;
    const result =
      scope.entityType === ENTITY_TYPES.RELATIONSHIP
        ? compareRelationships(beforeModel, afterModel, {
            scopeId: scope.id,
            indexBefore,
            indexAfter,
          })
        : compareEntityType(beforeModel, afterModel, {
            scopeId: scope.id,
            entityType: scope.entityType,
            indexBefore,
            indexAfter,
          });
    changes.push(...result.changes);
    unchanged.push(...result.unchanged);
  }

  return {
    indexBefore,
    indexAfter,
    changes: sortChanges(changes),
    unchanged: sortChanges(unchanged),
  };
}

export function documentTitle(model) {
  const document = Array.isArray(model?.documents) ? model.documents[0] : null;
  return (
    normalizeText(document?.title ?? model?.document?.title ?? model?.meta?.title ?? model?.title) || null
  );
}

function versionDescriptor(model, label) {
  const counts = {};
  for (const key of MODEL_COLLECTION_KEYS) counts[key] = (model?.[key] ?? []).length;
  return {
    label,
    documentId: model?.documentId ?? null,
    title: documentTitle(model),
    counts,
    entityCount: Object.values(counts).reduce((total, value) => total + value, 0),
  };
}

/** Change totals grouped by kind and by scope, for the summary strip. */
export function comparisonCounts({ changes = [], unchanged = [], text = [], structure = null, graph = null } = {}) {
  const byChangeType = {
    [CHANGE_TYPES.ADDED]: 0,
    [CHANGE_TYPES.REMOVED]: 0,
    [CHANGE_TYPES.MODIFIED]: 0,
    [CHANGE_TYPES.RELATIONSHIP_CHANGED]: 0,
  };
  const scopes = {};
  for (const scope of COMPARE_SCOPES) {
    scopes[scope.id] = { scope: scope.id, label: scope.label, total: 0, added: 0, removed: 0, modified: 0, relationshipChanged: 0, unchanged: 0 };
  }
  const tally = (change) => {
    const bucket = scopes[change.scope];
    if (!bucket) return;
    bucket.total += 1;
    if (change.changeType === CHANGE_TYPES.ADDED) bucket.added += 1;
    else if (change.changeType === CHANGE_TYPES.REMOVED) bucket.removed += 1;
    else if (change.changeType === CHANGE_TYPES.MODIFIED) bucket.modified += 1;
    else if (change.changeType === CHANGE_TYPES.RELATIONSHIP_CHANGED) bucket.relationshipChanged += 1;
  };

  for (const change of changes) {
    if (byChangeType[change.changeType] === undefined) byChangeType[change.changeType] = 0;
    byChangeType[change.changeType] += 1;
    tally(change);
  }
  for (const change of unchanged) if (scopes[change.scope]) scopes[change.scope].unchanged += 1;

  return {
    changeCount: changes.length,
    unchangedCount: unchanged.length,
    byChangeType,
    scopes,
    scopeList: COMPARE_SCOPES.map((scope) => scopes[scope.id]),
    textChanges: text.length,
    structureChanges: (structure?.changes ?? []).length,
    structureUnchanged: (structure?.unchanged ?? []).length,
    graphNodes: graph?.stats?.nodeCounts ?? { added: 0, removed: 0, changed: 0, unchanged: 0, total: 0 },
    graphRelationships: graph?.stats?.relationshipCounts ?? { added: 0, removed: 0, changed: 0, unchanged: 0, total: 0 },
  };
}

/** The one-paragraph read-out at the top of the comparison. */
export function comparisonSummary({ changes = [], unchanged = [], text = [], structure = null } = {}) {
  const byScope = {};
  for (const change of changes) {
    byScope[change.scope] = (byScope[change.scope] ?? 0) + 1;
  }
  const structureCount = (structure?.changes ?? []).length;
  return {
    changeCount: changes.length,
    unchangedCount: unchanged.length,
    textChangeCount: text.length,
    structureChangeCount: structureCount,
    byScope,
    scopeBreakdown: COMPARE_SCOPES.map((scope) => ({
      scope: scope.id,
      label: scope.label,
      changes: byScope[scope.id] ?? 0,
    })).filter((entry) => entry.changes > 0),
    headline:
      changes.length === 0 && text.length === 0 && structureCount === 0
        ? 'No differences are recorded between version A and version B.'
        : `${changes.length} change(s) recorded between version A and version B.`,
  };
}



/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

function describeVersion(model, label) {
  return isLegalModelLike(model) ? versionDescriptor(model, label) : null;
}

/**
 * Compares two LegalModels. Never throws: a missing or malformed version is
 * reported through `problems` so the page can render an empty state instead of
 * crashing.
 */
/** Executive risk shift summary: highlights high-impact risk shifts between versions. */
export function buildExecutiveRiskShiftSummary(changes = [], _text = [], _structure = null) {
  const highlights = [];

  const deadlineChanges = changes.filter((c) => c.scope === 'deadlines');
  for (const change of deadlineChanges) {
    if (change.period?.direction === 'shortened') {
      const daysNote = change.period.beforeDays && change.period.afterDays
        ? ` (${change.period.beforeDays} days → ${change.period.afterDays} days)`
        : '';
      highlights.push({
        type: 'deadline-shortened',
        severity: 'high',
        text: `Deadline window shortened for â€œ${change.label}â€${daysNote}.`,
      });
    } else if (change.period?.direction === 'extended') {
      const daysNote = change.period.beforeDays && change.period.afterDays
        ? ` (${change.period.beforeDays} days → ${change.period.afterDays} days)`
        : '';
      highlights.push({
        type: 'deadline-extended',
        severity: 'medium',
        text: `Deadline window extended for â€œ${change.label}â€${daysNote}.`,
      });
    }
  }

  const obligationChanges = changes.filter((c) => c.scope === 'obligations');
  const addedObligations = obligationChanges.filter((c) => c.changeType === CHANGE_TYPES.ADDED);
  const removedObligations = obligationChanges.filter((c) => c.changeType === CHANGE_TYPES.REMOVED);

  if (addedObligations.length > 0) {
    highlights.push({
      type: 'obligation-added',
      severity: 'high',
      text: `${addedObligations.length} new obligation(s) introduced in Version B (e.g., â€œ${addedObligations[0].label}â€).`,
    });
  }
  if (removedObligations.length > 0) {
    highlights.push({
      type: 'obligation-removed',
      severity: 'medium',
      text: `${removedObligations.length} obligation(s) removed from Version A (e.g., â€œ${removedObligations[0].label}â€).`,
    });
  }

  const consequenceChanges = changes.filter((c) => c.scope === 'consequences');
  for (const change of consequenceChanges) {
    if (change.changeType === CHANGE_TYPES.ADDED) {
      highlights.push({
        type: 'consequence-added',
        severity: 'high',
        text: `New consequence/remedy added: â€œ${change.label}â€.`,
      });
    } else if (change.changeType === CHANGE_TYPES.REMOVED) {
      highlights.push({
        type: 'consequence-removed',
        severity: 'medium',
        text: `Consequence/remedy removed: â€œ${change.label}â€.`,
      });
    }
  }

  const rightChanges = changes.filter((c) => c.scope === 'rights');
  const removedRights = rightChanges.filter((c) => c.changeType === CHANGE_TYPES.REMOVED);
  if (removedRights.length > 0) {
    highlights.push({
      type: 'right-removed',
      severity: 'high',
      text: `${removedRights.length} right(s) granted in Version A were removed in Version B.`,
    });
  }

  if (highlights.length === 0) {
    highlights.push({
      type: 'no-major-shift',
      severity: 'info',
      text: 'No major risk shift detected; structural changes are neutral.',
    });
  }

  return highlights;
}

export function compareModels(beforeModel, afterModel, { scopeIds = null } = {}) {
  const problems = [];
  if (!isLegalModelLike(beforeModel)) {
    problems.push({
      code: COMPARE_PROBLEM_CODES.NO_VERSION_A,
      message: 'Version A is missing or is not a legal model, so nothing could be compared.',
    });
  }
  if (!isLegalModelLike(afterModel)) {
    problems.push({
      code: COMPARE_PROBLEM_CODES.NO_VERSION_B,
      message: 'Version B is missing or is not a legal model, so nothing could be compared.',
    });
  }

  if (problems.length > 0) {
    return {
      ...emptyComparison(problems),
      versionA: describeVersion(beforeModel, 'Version A'),
      versionB: describeVersion(afterModel, 'Version B'),
      riskShiftSummary: [],
    };
  }

  const entityLayer = compareEntityLayer(beforeModel, afterModel, { scopeIds });
  const text = compareClauseTexts(beforeModel, afterModel);
  const structure = compareStructures(beforeModel, afterModel);
  const graph = diffGraphs(beforeModel, afterModel);
  const riskShiftSummary = buildExecutiveRiskShiftSummary(entityLayer.changes, text, structure);
  const base = {
    changes: entityLayer.changes,
    unchanged: entityLayer.unchanged,
    text,
    structure,
  };

  return {
    ok: true,
    problems: [],
    versionA: versionDescriptor(beforeModel, 'Version A'),
    versionB: versionDescriptor(afterModel, 'Version B'),
    ...base,
    graph,
    riskShiftSummary,
    indexBefore: entityLayer.indexBefore,
    indexAfter: entityLayer.indexAfter,
    counts: comparisonCounts({ ...base, graph }),
    summary: comparisonSummary(base),
    disclaimer: COMPARE_DISCLAIMER,
  };
}

/** The empty comparison shape, also used as the result when inputs are invalid. */
export function emptyComparison(problems = []) {
  const graph = emptyGraphDiff();
  const base = {
    changes: [],
    unchanged: [],
    text: [],
    structure: { facts: { before: [], after: [] }, changes: [], unchanged: [] },
  };
  return {
    ok: false,
    problems,
    versionA: null,
    versionB: null,
    ...base,
    graph,
    indexBefore: new Map(),
    indexAfter: new Map(),
    counts: comparisonCounts({ ...base, graph }),
    summary: comparisonSummary(base),
    disclaimer: COMPARE_DISCLAIMER,
  };
}

