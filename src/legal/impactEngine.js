/**
 * Impact engine.
 *
 * Given a comparison result, works out which records a change is wired to. The
 * engine walks the reference fields and relationships recorded in BOTH versions
 * and reports reach: "this change reaches the payment obligation and its
 * deadline". It never rates the change, never says a version is better, and never
 * offers advice — the vocabulary is deliberately structural.
 *
 * Everything is a pure function of the comparison passed in, so the same
 * comparison always yields the same impact map.
 */

import { ENTITY_TYPES, entityLabel } from './schema.js';
import { entityTypeLabel, relationshipTypeLabel } from './graphEngine.js';
import { mergeEvidence, normalizePhrase, truncate } from './signalSupport.js';
import { CHANGE_TYPES, periodNote } from './compareEngine.js';

export const IMPACT_DISCLAIMER =
  'Impacts list the records a change is wired to. They describe reach and dependency, not seriousness, and they are not advice.';

/** What kind of record the impact lands on. */
export const IMPACT_KINDS = Object.freeze({
  OBLIGATION: 'obligation',
  RIGHT: 'right',
  DEADLINE: 'deadline',
  CONDITION: 'condition',
  CONSEQUENCE: 'consequence',
  PARTY: 'party',
  DEFINITION: 'definition',
  CLAUSE: 'clause',
  OTHER: 'other',
});

const KIND_BY_ENTITY_TYPE = Object.freeze({
  [ENTITY_TYPES.OBLIGATION]: IMPACT_KINDS.OBLIGATION,
  [ENTITY_TYPES.RIGHT]: IMPACT_KINDS.RIGHT,
  [ENTITY_TYPES.DEADLINE]: IMPACT_KINDS.DEADLINE,
  [ENTITY_TYPES.CONDITION]: IMPACT_KINDS.CONDITION,
  [ENTITY_TYPES.CONSEQUENCE]: IMPACT_KINDS.CONSEQUENCE,
  [ENTITY_TYPES.PARTY]: IMPACT_KINDS.PARTY,
  [ENTITY_TYPES.DEFINITION]: IMPACT_KINDS.DEFINITION,
  [ENTITY_TYPES.CLAUSE]: IMPACT_KINDS.CLAUSE,
});

/**
 * Reference fields that create a dependency, by the record that holds them.
 * `via` is the phrase used to explain the connection in the UI.
 */
const REFERENCE_LINKS = Object.freeze({
  [ENTITY_TYPES.OBLIGATION]: [
    { field: 'deadlineId', via: 'its deadline' },
    { field: 'obligorPartyId', via: 'the party the duty sits with' },
    { field: 'obligeePartyId', via: 'the party the duty is owed to' },
    { field: 'triggerConditionId', via: 'its trigger condition' },
  ],
  [ENTITY_TYPES.RIGHT]: [
    { field: 'holderPartyId', via: 'the party that holds it' },
    { field: 'counterpartyPartyId', via: 'the party it runs against' },
  ],
  [ENTITY_TYPES.CONDITION]: [
    { field: 'deadlineId', via: 'its deadline' },
    { field: 'clauseId', via: 'its clause' },
  ],
  [ENTITY_TYPES.CONSEQUENCE]: [
    { field: 'triggerConditionId', via: 'its trigger condition' },
    { field: 'affectedPartyId', via: 'the party it affects' },
  ],
  [ENTITY_TYPES.DEADLINE]: [
    { field: 'responsiblePartyId', via: 'the party responsible for it' },
    { field: 'anchorEntityId', via: 'the record it is anchored to' },
  ],
  [ENTITY_TYPES.DEFINITION]: [{ field: 'clauseId', via: 'the clause it is defined in' }],
  [ENTITY_TYPES.RELATIONSHIP]: [],
});

/** List-valued references, handled separately because they hold an array. */
const REFERENCE_LIST_LINKS = Object.freeze({
  [ENTITY_TYPES.OBLIGATION]: [{ field: 'consequenceIds', via: 'an associated consequence' }],
});

export function impactKindFor(entityType) {
  return KIND_BY_ENTITY_TYPE[entityType] ?? IMPACT_KINDS.OTHER;
}

export const IMPACT_KIND_LABELS = Object.freeze({
  [IMPACT_KINDS.OBLIGATION]: 'Obligation',
  [IMPACT_KINDS.RIGHT]: 'Right',
  [IMPACT_KINDS.DEADLINE]: 'Deadline',
  [IMPACT_KINDS.CONDITION]: 'Condition',
  [IMPACT_KINDS.CONSEQUENCE]: 'Consequence',
  [IMPACT_KINDS.PARTY]: 'Party',
  [IMPACT_KINDS.DEFINITION]: 'Definition',
  [IMPACT_KINDS.CLAUSE]: 'Clause',
  [IMPACT_KINDS.OTHER]: 'Record',
});

/* -------------------------------------------------------------------------- */
/* Dependency index                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Every record from both versions, keyed by id. Version B wins when the id
 * exists in both, because the impact panel describes where a change landed.
 */
export function impactEntityIndex(comparison) {
  const entities = new Map();
  for (const [id, entry] of comparison?.indexBefore ?? []) entities.set(id, entry);
  for (const [id, entry] of comparison?.indexAfter ?? []) entities.set(id, entry);
  return entities;
}

function addLink(links, fromId, toId, via) {
  if (!fromId || !toId || fromId === toId) return;
  if (!links.has(fromId)) links.set(fromId, new Map());
  if (!links.get(fromId).has(toId)) links.get(fromId).set(toId, via);
}

/**
 * A plain, undirected dependency graph: which records are wired to which. Built
 * from the reference fields of both versions plus the relationships either
 * version records, so a link that only exists in one version still shows the
 * change reaching the other end.
 */
export function buildDependencyIndex(comparison) {
  const entities = impactEntityIndex(comparison);
  const links = new Map();

  for (const [id, entry] of entities) {
    const entity = entry?.entity ?? {};
    const entityType = entry?.entityType ?? entity.type ?? null;

    for (const spec of REFERENCE_LINKS[entityType] ?? []) {
      addLink(links, id, entity[spec.field] ?? null, spec.via);
      addLink(links, entity[spec.field] ?? null, id, spec.via);
    }
    for (const spec of REFERENCE_LIST_LINKS[entityType] ?? []) {
      for (const target of Array.isArray(entity[spec.field]) ? entity[spec.field] : []) {
        addLink(links, id, target, spec.via);
        addLink(links, target, id, spec.via);
      }
    }
    if (entityType !== ENTITY_TYPES.CLAUSE && typeof entity.clauseId === 'string') {
      addLink(links, id, entity.clauseId, 'the clause it sits in');
      addLink(links, entity.clauseId, id, 'the clause it sits in');
    }
  }

  for (const graph of [comparison?.graph?.before, comparison?.graph?.after]) {
    for (const relationship of graph?.relationships ?? []) {
      const via = `the ${relationshipTypeLabel(relationship.type)} link`;
      addLink(links, relationship.fromId, relationship.toId, via);
      addLink(links, relationship.toId, relationship.fromId, via);
    }
  }

  return { entities, links };
}

/* -------------------------------------------------------------------------- */
/* Impact statements                                                          */
/* -------------------------------------------------------------------------- */

function viaPhrase(via) {
  return via ? `, linked through ${via}` : '';
}

function timingPhrase(entry, period) {
  if (!period) return '';
  if (entry?.entityType === ENTITY_TYPES.DEADLINE || entry?.entityType === ENTITY_TYPES.OBLIGATION) {
    return ` ${periodNote(period)}`;
  }
  return '';
}

/** One structural sentence per impacted record. No judgement, no advice. */
export function describeImpact({ entry, distance, via, period }) {
  const type = entityTypeLabel(entry?.entityType) ?? 'Record';
  const label = truncate(entityLabel(entry?.entity), 100) || entry?.id;
  const timing = timingPhrase(entry, period);
  if (distance === 0) {
    return `${type} “${label}” is the record that changed.${timing}`;
  }
  const where = distance === 1 ? 'directly' : `${distance} steps away`;
  return `This change reaches the ${type.toLowerCase()} “${label}” ${where}${viaPhrase(via)}.${timing}`;
}

function impactClauseIds(entry) {
  const ids = new Set();
  const entity = entry?.entity ?? {};
  if (entry?.entityType === ENTITY_TYPES.CLAUSE && entry?.id) ids.add(entry.id);
  if (typeof entity.clauseId === 'string') ids.add(entity.clauseId);
  for (const list of [entity.clauseIds, entity.definedInClauseIds]) {
    for (const id of Array.isArray(list) ? list : []) ids.add(id);
  }
  for (const reference of entity.evidence ?? []) {
    if (reference?.clauseId) ids.add(reference.clauseId);
  }
  return [...ids].sort();
}


/* -------------------------------------------------------------------------- */
/* Reach                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Breadth-first reach from one record, capped at `maxDepth` steps. Neighbour
 * order is sorted so the same comparison always produces the same map.
 */
export function reachFrom(startId, dependency, maxDepth = 2) {
  const visited = new Map();
  if (!startId) return visited;
  visited.set(startId, { distance: 0, via: null });
  let frontier = [startId];

  for (let distance = 1; distance <= maxDepth; distance += 1) {
    const next = [];
    for (const id of frontier) {
      const neighbours = dependency.links.get(id);
      if (!neighbours) continue;
      for (const targetId of [...neighbours.keys()].sort()) {
        if (visited.has(targetId)) continue;
        visited.set(targetId, { distance, via: neighbours.get(targetId) });
        next.push(targetId);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  return visited;
}

const KIND_ORDER = Object.values(IMPACT_KINDS).reduce((order, kind, index) => {
  order[kind] = index;
  return order;
}, {});

/** One record reached by a change, described without comment. */
export function createImpactRecord(change, { id = null, entry, distance, via }) {
  const kind = impactKindFor(entry?.entityType);
  const entityId = id ?? entry?.entity?.id ?? null;
  const label = entityLabel(entry?.entity) || entityId || 'Unknown record';
  return {
    id: `${change?.id ?? 'change'}:impact:${entityId ?? 'unknown'}`,
    changeId: change?.id ?? null,
    changeLabel: change?.label ?? null,
    entityId,
    entityType: entry?.entityType ?? null,
    entityTypeLabel: entityTypeLabel(entry?.entityType),
    kind,
    kindLabel: IMPACT_KIND_LABELS[kind],
    label,
    distance,
    via: via ?? null,
    period: change?.period ?? null,
    statement: describeImpact({ entry, distance, via, period: change?.period ?? null }),
    clauseIds: impactClauseIds(entry),
    evidence: mergeEvidence(entry?.entity?.evidence ?? []),
  };
}

function impactSortKey(record) {
  return `${record.distance}|${String(KIND_ORDER[record.kind] ?? 99).padStart(2, '0')}|${normalizePhrase(
    record.label,
  )}|${record.entityId}`;
}

function summarizeImpact(change, records) {
  const downstream = records.filter((record) => record.distance > 0);
  if (change?.changeType === CHANGE_TYPES.UNCHANGED) {
    return 'No change was recorded here, so nothing downstream is reported.';
  }
  if (downstream.length === 0) {
    return 'This change is not wired to any other record in either version.';
  }
  const parts = downstream
    .slice(0, 3)
    .map((record) => `the ${record.kindLabel.toLowerCase()} “${truncate(record.label, 70)}”`);
  const extra = downstream.length > 3 ? `, and ${downstream.length - 3} more record(s)` : '';
  const joined =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `This change reaches ${joined}${extra}.`;
}

/** Impact counts grouped by kind and by distance. */
export function impactCounts(records) {
  const byKind = {};
  const byDistance = {};
  for (const record of records ?? []) {
    if (record.distance === 0) continue;
    byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
    byDistance[record.distance] = (byDistance[record.distance] ?? 0) + 1;
  }
  return {
    total: Object.values(byKind).reduce((sum, value) => sum + value, 0),
    byKind,
    byDistance,
  };
}


/* -------------------------------------------------------------------------- */
/* Public entry points                                                        */
/* -------------------------------------------------------------------------- */

/** The impact of a single change: the record itself plus everything it reaches. */
export function buildImpactForChange(change, dependency, { maxDepth = 2 } = {}) {
  const reached = reachFrom(change?.entityId, dependency, maxDepth);
  const records = [];
  for (const [id, info] of reached) {
    const entry = dependency.entities.get(id);
    if (!entry) continue;
    records.push(createImpactRecord(change, { id, entry, distance: info.distance, via: info.via }));
  }
  records.sort((a, b) => {
    const left = impactSortKey(a);
    const right = impactSortKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return {
    changeId: change?.id ?? null,
    changeLabel: change?.label ?? null,
    changeType: change?.changeType ?? null,
    scope: change?.scope ?? null,
    summary: summarizeImpact(change, records),
    stats: impactCounts(records),
    records,
    disclaimer: IMPACT_DISCLAIMER,
  };
}

/**
 * Impact for every change in the comparison, keyed by change id. Remote records
 * that were removed or re-pointed still appear here, because the dependency
 * index is built from both versions.
 */
export function buildImpactMap(comparison, { maxDepth = 2 } = {}) {
  const dependency = buildDependencyIndex(comparison);
  const map = new Map();
  for (const change of comparison?.changes ?? []) {
    map.set(change.id, buildImpactForChange(change, dependency, { maxDepth }));
  }
  return map;
}

export function impactsForChange(comparison, changeId, { maxDepth = 2, dependency = null } = {}) {
  const change = (comparison?.changes ?? []).find((entry) => entry.id === changeId) ?? null;
  if (!change) return null;
  return buildImpactForChange(
    change,
    dependency ?? buildDependencyIndex(comparison),
    { maxDepth },
  );
}

/** Totals across the whole comparison, used by the summary strip. */
export function comparisonImpactSummary(comparison, { maxDepth = 2, map = null } = {}) {
  const impacts = map ?? buildImpactMap(comparison, { maxDepth });
  const byKind = {};
  let changeCount = 0;
  let impactedChangeCount = 0;
  for (const impact of impacts.values()) {
    if (impact.stats.total === 0) continue;
    changeCount += impact.stats.total;
    impactedChangeCount += 1;
    for (const [kind, count] of Object.entries(impact.stats.byKind)) {
      byKind[kind] = (byKind[kind] ?? 0) + count;
    }
  }
  return {
    affectedRecordCount: changeCount,
    changesWithImpact: impactedChangeCount,
    byKind,
    byKindList: Object.entries(byKind)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, count]) => ({ kind, label: IMPACT_KIND_LABELS[kind] ?? kind, count })),
    disclaimer: IMPACT_DISCLAIMER,
  };
}

