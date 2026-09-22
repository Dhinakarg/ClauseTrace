/**
 * Graph diff.
 *
 * Compares the two LegalGraphs built from the two versions and reports which
 * nodes were added, removed or changed, and which relationships were added,
 * removed or re-pointed. Like the rest of the legal layer this is pure: the same
 * two models always produce the same diff, and nothing here judges a change.
 *
 * This module deliberately imports nothing from compareEngine.js so the compare
 * engine can depend on it without a cycle.
 */

import { normalizePhrase, mergeEvidence, truncate } from './signalSupport.js';
import { buildGraph, entityTypeLabel, indexGraph, relationshipTypeLabel } from './graphEngine.js';

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

export const GRAPH_NODE_STATES = Object.freeze({
  ADDED: 'added',
  REMOVED: 'removed',
  CHANGED: 'changed',
  UNCHANGED: 'unchanged',
});

export const GRAPH_EDGE_STATES = Object.freeze({
  ADDED: 'added',
  REMOVED: 'removed',
  CHANGED: 'changed',
  UNCHANGED: 'unchanged',
});

export const GRAPH_STATE_META = Object.freeze({
  [GRAPH_NODE_STATES.ADDED]: { label: 'Added', tone: 'accent' },
  [GRAPH_NODE_STATES.REMOVED]: { label: 'Removed', tone: 'critical' },
  [GRAPH_NODE_STATES.CHANGED]: { label: 'Changed', tone: 'warning' },
  [GRAPH_NODE_STATES.UNCHANGED]: { label: 'Unchanged', tone: 'muted' },
});

const STATE_ORDER = { added: 0, removed: 1, changed: 2, unchanged: 3 };

/** Deterministic string ordering used throughout the diff. */
function order(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Fields of a node that the comparison reports on. */
const NODE_FIELDS = Object.freeze([
  { field: 'entityType', label: 'Record type' },
  { field: 'label', label: 'Statement' },
  { field: 'clauseId', label: 'Clause' },
  { field: 'confidence', label: 'Confidence' },
  { field: 'provenance', label: 'Provenance' },
  { field: 'evidenceCount', label: 'Citations' },
  { field: 'verified', label: 'Has a verified citation' },
]);

function nodeValue(node, field) {
  if (!node) return null;
  if (field === 'entityType') return entityTypeLabel(node.entityType);
  if (field === 'clauseId') return node.clauseId ?? null;
  if (field === 'evidenceCount') return node.evidenceCount ?? 0;
  if (field === 'verified') return node.verified === true;
  return node[field] ?? null;
}

function compareNodeField(left, right) {
  if (typeof left === 'boolean' || typeof right === 'boolean') return String(left) !== String(right);
  return normalizePhrase(left) !== normalizePhrase(right);
}

/** What two versions of the same node look like side by side. */
export function diffNodeFields(beforeNode, afterNode) {
  return NODE_FIELDS.map((spec) => {
    const before = nodeValue(beforeNode, spec.field);
    const after = nodeValue(afterNode, spec.field);
    return {
      field: spec.field,
      label: spec.label,
      before,
      after,
      beforeDisplay: describeNodeValue(before, spec.field),
      afterDisplay: describeNodeValue(after, spec.field),
      changed: compareNodeField(before, after),
    };
  });
}

function describeNodeValue(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (field === 'verified') return value ? 'Yes' : 'No';
  return truncate(value, 120);
}

/* -------------------------------------------------------------------------- */
/* Node diff                                                                  */
/* -------------------------------------------------------------------------- */

export function nodeKey(node) {
  if (!node) return '';
  return `${node.entityType ?? 'unknown'}|${normalizePhrase(node.label)}`;
}

function nodeClauseIds(...nodes) {
  const ids = new Set();
  for (const node of nodes) {
    if (!node) continue;
    if (node.entityType === 'clause') ids.add(node.id);
    const entity = node.entity ?? {};
    if (typeof entity.clauseId === 'string') ids.add(entity.clauseId);
    for (const reference of entity.evidence ?? []) {
      if (reference?.clauseId) ids.add(reference.clauseId);
    }
  }
  return [...ids].sort();
}

function buildNodeChange(state, beforeNode, afterNode) {
  const anchor = afterNode ?? beforeNode;
  const fields = state === GRAPH_NODE_STATES.UNCHANGED ? [] : diffNodeFields(beforeNode, afterNode).filter((entry) => entry.changed);
  const beforeEvidence = mergeEvidence(beforeNode?.entity?.evidence ?? []);
  const afterEvidence = mergeEvidence(afterNode?.entity?.evidence ?? []);
  const change = {
    id: `node:${state}:${anchor?.id ?? 'unknown'}`,
    state,
    stateLabel: GRAPH_STATE_META[state]?.label ?? state,
    nodeId: anchor?.id ?? null,
    key: nodeKey(anchor),
    entityType: anchor?.entityType ?? null,
    entityTypeLabel: entityTypeLabel(anchor?.entityType),
    label: anchor?.label ?? anchor?.id ?? 'Unknown record',
    beforeLabel: beforeNode?.label ?? null,
    afterLabel: afterNode?.label ?? null,
    beforeNode: beforeNode ?? null,
    afterNode: afterNode ?? null,
    fields,
    changedFields: fields.map((entry) => entry.field),
    clauseIds: nodeClauseIds(afterNode, beforeNode),
    evidence: { before: beforeEvidence, after: afterEvidence },
  };
  return { ...change, summary: describeNodeChange(change) };
}

function describeNodeChange(change) {
  const type = truncate(change.entityTypeLabel ?? 'Record', 40);
  const label = truncate(change.label, 100);
  if (change.state === GRAPH_NODE_STATES.ADDED) {
    return `${type} “${label}” has a node in version B and none in version A.`;
  }
  if (change.state === GRAPH_NODE_STATES.REMOVED) {
    return `${type} “${label}” has a node in version A and none in version B.`;
  }
  if (change.state === GRAPH_NODE_STATES.UNCHANGED) {
    return `${type} “${label}” is the same node in both versions.`;
  }
  const parts = change.changedFields.map((name) => {
    const entry = change.fields.find((field) => field.field === name);
    return `${entry.label}: ${entry.beforeDisplay ?? 'not recorded'} → ${entry.afterDisplay ?? 'not recorded'}`;
  });
  return `${type} “${label}” changed — ${parts.join('; ')}.`;
}

/** Node-level difference between two graphs. */
export function diffNodes(beforeGraph, afterGraph) {
  const beforeById = new Map((beforeGraph?.nodes ?? []).map((node) => [node.id, node]));
  const afterById = new Map((afterGraph?.nodes ?? []).map((node) => [node.id, node]));
  const changes = [];
  const usedBefore = new Set();
  const usedAfter = new Set();

  for (const id of [...beforeById.keys()].sort()) {
    const beforeNode = beforeById.get(id);
    const afterNode = afterById.get(id);
    if (!afterNode) continue;
    usedBefore.add(id);
    usedAfter.add(id);
    const state = diffNodeFields(beforeNode, afterNode).some((entry) => entry.changed)
      ? GRAPH_NODE_STATES.CHANGED
      : GRAPH_NODE_STATES.UNCHANGED;
    changes.push(buildNodeChange(state, beforeNode, afterNode));
  }

  const keyIndex = (graph, used) => {
    const groups = new Map();
    for (const node of graph?.nodes ?? []) {
      if (used.has(node.id)) continue;
      const key = nodeKey(node);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(node);
    }
    return groups;
  };

  const beforeByKey = keyIndex(beforeGraph, usedBefore);
  const afterByKey = keyIndex(afterGraph, usedAfter);
  for (const key of [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort()) {
    const left = beforeByKey.get(key) ?? [];
    const right = afterByKey.get(key) ?? [];
    const paired = Math.min(left.length, right.length);
    for (let index = 0; index < paired; index += 1) {
      changes.push(buildNodeChange(GRAPH_NODE_STATES.CHANGED, left[index], right[index]));
      usedBefore.add(left[index].id);
      usedAfter.add(right[index].id);
    }
    for (const node of right.slice(paired)) {
      changes.push(buildNodeChange(GRAPH_NODE_STATES.ADDED, null, node));
      usedAfter.add(node.id);
    }
    for (const node of left.slice(paired)) {
      changes.push(buildNodeChange(GRAPH_NODE_STATES.REMOVED, node, null));
      usedBefore.add(node.id);
    }
  }

  const sortKey = (change) =>
    `${STATE_ORDER[change.state] ?? 9}|${normalizePhrase(change.entityTypeLabel)}|${normalizePhrase(change.label)}|${change.id}`;
  return [...changes].sort((a, b) => order(sortKey(a), sortKey(b)));
}



/* -------------------------------------------------------------------------- */
/* Edge diff                                                                  */
/* -------------------------------------------------------------------------- */

export function edgeKey(edge) {
  return `${normalizePhrase(edge?.type)}|${edge?.fromId ?? ''}|${edge?.toId ?? ''}`;
}

function edgeGroupKey(edge) {
  return `${normalizePhrase(edge?.type)}|${edge?.fromId ?? ''}`;
}

/** "Acme Limited must pay Beta Services plc" read straight off the graph. */
export function edgeDisplay(edge, index = null) {
  if (!edge) return 'not recorded';
  const from = index?.get?.(edge.fromId)?.label ?? edge.fromId ?? 'unknown';
  const to = index?.get?.(edge.toId)?.label ?? edge.toId ?? 'unknown';
  return `${from} ${relationshipTypeLabel(edge.type)} ${to}`;
}

/* Kept local (rather than importing compareEngine) so the module graph stays free
   of cycles: graphDiff is a dependency of compareEngine, not the other way round. */
function edgeClauseIds(edge, index) {
  if (!edge) return [];
  const ids = new Set();
  for (const nodeId of [edge.fromId, edge.toId]) {
    const entity = index?.get?.(nodeId)?.entity ?? null;
    if (!entity) continue;
    if (typeof entity.clauseId === 'string') ids.add(entity.clauseId);
    for (const list of [entity.clauseIds, entity.definedInClauseIds]) {
      for (const id of Array.isArray(list) ? list : []) ids.add(id);
    }
    for (const reference of entity.evidence ?? []) {
      if (reference?.clauseId) ids.add(reference.clauseId);
    }
  }
  return [...ids].sort();
}

function edgeDescription(edge, index) {
  return {
    id: edge?.id ?? null,
    type: edge?.type ?? null,
    typeLabel: relationshipTypeLabel(edge?.type),
    label: edge?.label ?? null,
    directed: edge?.directed !== false,
    fromId: edge?.fromId ?? null,
    toId: edge?.toId ?? null,
    display: edgeDisplay(edge, index),
  };
}

function endpointLabel(edge, index, which) {
  if (!edge) return null;
  const id = which === 'from' ? edge.fromId : edge.toId;
  return index?.get?.(id)?.label ?? id ?? null;
}

function buildEdgeChange(state, beforeEdge, afterEdge, { indexBefore, indexAfter, evidenceById }) {
  const anchor = afterEdge ?? beforeEdge;
  const pairs = [
    { field: 'type', label: 'Relationship', before: relationshipTypeLabel(beforeEdge?.type), after: relationshipTypeLabel(afterEdge?.type) },
    { field: 'from', label: 'From', before: endpointLabel(beforeEdge, indexBefore, 'from'), after: endpointLabel(afterEdge, indexAfter, 'from') },
    { field: 'to', label: 'To', before: endpointLabel(beforeEdge, indexBefore, 'to'), after: endpointLabel(afterEdge, indexAfter, 'to') },
    { field: 'label', label: 'Edge label', before: beforeEdge?.label ?? null, after: afterEdge?.label ?? null },
    { field: 'directed', label: 'Directed', before: beforeEdge ? beforeEdge.directed !== false : null, after: afterEdge ? afterEdge.directed !== false : null },
  ];
  const fields =
    state === GRAPH_EDGE_STATES.UNCHANGED
      ? []
      : pairs
          .map((entry) => ({
            ...entry,
            beforeDisplay: describeEdgeValue(entry.before),
            afterDisplay: describeEdgeValue(entry.after),
            changed: compareNodeField(entry.before, entry.after),
          }))
          .filter((entry) => entry.changed);

  const beforeEvidence = mergeEvidence(evidenceById.get(beforeEdge?.id) ?? []);
  const afterEvidence = mergeEvidence(evidenceById.get(afterEdge?.id) ?? []);
  const clauseIds = [
    ...new Set([...edgeClauseIds(beforeEdge, indexBefore), ...edgeClauseIds(afterEdge, indexAfter)]),
  ].sort();

  const change = {
    id: `edge:${state}:${anchor?.id ?? edgeKey(anchor)}`,
    state,
    stateLabel: GRAPH_STATE_META[state]?.label ?? state,
    relationshipId: anchor?.id ?? null,
    key: edgeKey(anchor),
    type: anchor?.type ?? null,
    typeLabel: relationshipTypeLabel(anchor?.type),
    label: relationshipTypeLabel(anchor?.type),
    beforeDisplay: edgeDisplay(beforeEdge, indexBefore),
    afterDisplay: edgeDisplay(afterEdge, indexAfter),
    before: edgeDescription(beforeEdge, indexBefore),
    after: edgeDescription(afterEdge, indexAfter),
    fields,
    changedFields: fields.map((entry) => entry.field),
    clauseIds,
    evidence: { before: beforeEvidence, after: afterEvidence },
  };
  return { ...change, summary: describeEdgeChange(change) };
}

function describeEdgeValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return truncate(value, 120);
}

function describeEdgeChange(change) {
  const type = truncate(change.typeLabel ?? 'Relationship', 40);
  if (change.state === GRAPH_EDGE_STATES.ADDED) {
    return `${type} was added in version B: ${truncate(change.afterDisplay, 140)}.`;
  }
  if (change.state === GRAPH_EDGE_STATES.REMOVED) {
    return `${type} was removed in version B: ${truncate(change.beforeDisplay, 140)}.`;
  }
  if (change.state === GRAPH_EDGE_STATES.UNCHANGED) {
    return `${type} is the same in both versions: ${truncate(change.afterDisplay, 140)}.`;
  }
  return `${type} was re-pointed: “${truncate(change.beforeDisplay, 110)}” → “${truncate(change.afterDisplay, 110)}”.`;
}

/**
 * Relationship-level difference. Edges with the same (type, from, to) key are
 * paired directly; within a (type, from) group, a leftover edge on each side is
 * reported as re-pointed rather than as a removal plus an addition.
 */
export function diffEdges(beforeGraph, afterGraph, { indexBefore = null, indexAfter = null, evidenceById = new Map() } = {}) {
  const beforeList = [...(beforeGraph?.relationships ?? [])].sort((a, b) => order(edgeKey(a), edgeKey(b)));
  const afterList = [...(afterGraph?.relationships ?? [])].sort((a, b) => order(edgeKey(a), edgeKey(b)));
  const group = (list) => {
    const groups = new Map();
    for (const edge of list) {
      const key = edgeGroupKey(edge);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(edge);
    }
    return groups;
  };

  const beforeGroups = group(beforeList);
  const afterGroups = group(afterList);
  const keys = [...new Set([...beforeGroups.keys(), ...afterGroups.keys()])].sort();
  const changes = [];

  for (const key of keys) {
    const left = beforeGroups.get(key) ?? [];
    const right = afterGroups.get(key) ?? [];
    const leftByTarget = new Map(left.map((edge) => [edge.toId, edge]));
    const usedLeft = new Set();
    const usedRight = new Set();

    for (const edge of right) {
      const before = leftByTarget.get(edge.toId);
      if (!before) continue;
      usedLeft.add(before.id);
      usedRight.add(edge.id);
      const state = buildEdgeChange(GRAPH_EDGE_STATES.CHANGED, before, edge, { indexBefore, indexAfter, evidenceById });
      changes.push(
        state.changedFields.length > 0
          ? state
          : buildEdgeChange(GRAPH_EDGE_STATES.UNCHANGED, before, edge, { indexBefore, indexAfter, evidenceById }),
      );
    }

    const leftRest = left.filter((edge) => !usedLeft.has(edge.id));
    const rightRest = right.filter((edge) => !usedRight.has(edge.id));
    const paired = Math.min(leftRest.length, rightRest.length);
    for (let index = 0; index < paired; index += 1) {
      changes.push(
        buildEdgeChange(GRAPH_EDGE_STATES.CHANGED, leftRest[index], rightRest[index], {
          indexBefore,
          indexAfter,
          evidenceById,
        }),
      );
    }
    for (const edge of rightRest.slice(paired)) {
      changes.push(buildEdgeChange(GRAPH_EDGE_STATES.ADDED, null, edge, { indexBefore, indexAfter, evidenceById }));
    }
    for (const edge of leftRest.slice(paired)) {
      changes.push(buildEdgeChange(GRAPH_EDGE_STATES.REMOVED, edge, null, { indexBefore, indexAfter, evidenceById }));
    }
  }

  const sortKey = (change) =>
    `${STATE_ORDER[change.state] ?? 9}|${normalizePhrase(change.typeLabel)}|${normalizePhrase(change.afterDisplay)}|${change.id}`;
  return [...changes].sort((a, b) => order(sortKey(a), sortKey(b)));
}

function evidenceByRelationshipId(model) {
  const map = new Map();
  for (const relationship of model?.relationships ?? []) {
    if (relationship?.id) map.set(relationship.id, relationship.evidence ?? []);
  }
  return map;
}

export function emptyGraphDiff() {
  return {
    before: null,
    after: null,
    indexBefore: new Map(),
    indexAfter: new Map(),
    nodes: [],
    relationships: [],
    stats: summarizeGraphDiff([], []),
  };
}

function countStates(list) {
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0, total: list.length };
  for (const entry of list) counts[entry.state] = (counts[entry.state] ?? 0) + 1;
  return counts;
}

export function summarizeGraphDiff(nodes, relationships) {
  return {
    nodeCounts: countStates(nodes ?? []),
    relationshipCounts: countStates(relationships ?? []),
  };
}

/** Graph-level difference between two models. */
export function diffGraphs(beforeModel, afterModel, { documentId = null } = {}) {
  const before = buildGraph(beforeModel, { documentId });
  const after = buildGraph(afterModel, { documentId });
  const indexBefore = indexGraph(before).nodesById;
  const indexAfter = indexGraph(after).nodesById;
  const evidenceById = new Map([
    ...evidenceByRelationshipId(beforeModel),
    ...evidenceByRelationshipId(afterModel),
  ]);

  const nodes = diffNodes(before, after);
  const relationships = diffEdges(before, after, { indexBefore, indexAfter, evidenceById });
  return {
    before,
    after,
    /* Node id → graph node, for label lookups in the diff UI. */
    indexBefore,
    indexAfter,
    nodes,
    relationships,
    stats: summarizeGraphDiff(nodes, relationships),
  };
}
