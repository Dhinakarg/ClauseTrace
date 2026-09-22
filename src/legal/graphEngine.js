/**
 * Graph engine.
 *
 * Turns a validated LegalModel into a LegalGraph (nodes + typed relationships)
 * and provides pure traversal helpers. This module is completely independent of
 * React: no hooks, no context, no side effects.
 *
 * Every function returns new objects; inputs are never mutated.
 */

import {
  ENTITY_TYPES,
  MODEL_COLLECTION_KEYS,
  RELATIONSHIP_SCHEMA,
  createRelationship,
  entityLabel,
  entityTypeForCollectionKey,
} from './schema.js';

/* -------------------------------------------------------------------------- */
/* Nodes and relationships                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Creates a graph node from any model entity. Nodes wrap the entity immutably
 * and carry the fields the UI needs (label, evidence counts, trust flags).
 */
export function createGraphNode(entity, { entityType = null, documentId = null } = {}) {
  if (!entity || typeof entity !== 'object') return null;
  const resolvedType = entityType ?? entity.type;
  return {
    id: entity.id,
    entityType: resolvedType,
    label: entityLabel({ ...entity, type: resolvedType }),
    documentId: entity.documentId ?? documentId ?? null,
    clauseId: entity.clauseId ?? (resolvedType === ENTITY_TYPES.CLAUSE ? entity.id : null),
    confidence: entity.confidence ?? 'unknown',
    provenance: entity.provenance ?? 'unknown',
    evidenceCount: Array.isArray(entity.evidence) ? entity.evidence.length : 0,
    verified: Array.isArray(entity.evidence) ? entity.evidence.some((ref) => ref.verified) : false,
    entity,
  };
}

/**
 * Creates a graph relationship (edge). Endpoint types default to the schema's
 * allowed types when the caller does not know them.
 */
export function createGraphRelationship({
  id,
  type,
  fromId,
  toId,
  fromType = null,
  toType = null,
  label = null,
  documentId = null,
  provenance,
  confidence,
  evidence = [],
}) {
  return createRelationship({
    id,
    type,
    fromId,
    toId,
    fromType: fromType ?? RELATIONSHIP_SCHEMA[type]?.from?.[0] ?? null,
    toType: toType ?? RELATIONSHIP_SCHEMA[type]?.to?.[0] ?? null,
    label,
    documentId,
    provenance,
    confidence,
    evidence,
  });
}

/* -------------------------------------------------------------------------- */
/* Graph construction                                                         */
/* -------------------------------------------------------------------------- */

export function emptyGraph(documentId = null) {
  return {
    documentId,
    nodes: [],
    relationships: [],
    generatedAt: null,
    stats: { nodeCount: 0, relationshipCount: 0, byEntityType: {}, byRelationshipType: {} },
  };
}

/**
 * Builds a LegalGraph from a LegalModel.
 * Relationships whose endpoints are absent are dropped and reported in
 * `stats.brokenRelationshipIds`, so traversal can never reach a dangling edge.
 */
export function buildGraph(model, { documentId = null, includeTypes = null } = {}) {
  const graph = emptyGraph(documentId ?? model?.documentId ?? null);
  if (!model || typeof model !== 'object') return graph;

  const include = includeTypes ? new Set(includeTypes) : null;
  const nodeIds = new Set();

  for (const key of MODEL_COLLECTION_KEYS) {
    if (key === 'relationships') continue;
    const entityType = entityTypeForCollectionKey(key);
    if (include && !include.has(entityType)) continue;
    for (const entity of model[key] ?? []) {
      const node = createGraphNode(entity, { entityType, documentId: graph.documentId });
      if (!node) continue;
      graph.nodes.push(node);
      nodeIds.add(node.id);
    }
  }

  const brokenRelationshipIds = [];
  for (const relationship of model.relationships ?? []) {
    if (!relationship || typeof relationship !== 'object') continue;
    if (!nodeIds.has(relationship.fromId) || !nodeIds.has(relationship.toId)) {
      brokenRelationshipIds.push(relationship.id ?? `${relationship.fromId}->${relationship.toId}`);
      continue;
    }
    graph.relationships.push({
      id: relationship.id,
      type: relationship.type,
      fromId: relationship.fromId,
      toId: relationship.toId,
      fromType: relationship.fromType ?? null,
      toType: relationship.toType ?? null,
      label: relationship.label ?? null,
      directed: relationship.directed !== false,
      provenance: relationship.provenance ?? 'unknown',
      confidence: relationship.confidence ?? 'unknown',
    });
  }

  graph.generatedAt = new Date().toISOString();
  graph.stats = computeGraphStats(graph);
  graph.stats.brokenRelationshipIds = brokenRelationshipIds;
  return graph;
}

/* -------------------------------------------------------------------------- */
/* Indexing and accessors                                                     */
/* -------------------------------------------------------------------------- */

/** Builds node/adjacency indexes. Call once per render, then pass them around. */
export function indexGraph(graph) {
  const nodesById = new Map();
  const outgoing = new Map();
  const incoming = new Map();
  for (const node of graph?.nodes ?? []) {
    nodesById.set(node.id, node);
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const relationship of graph?.relationships ?? []) {
    if (outgoing.has(relationship.fromId)) outgoing.get(relationship.fromId).push(relationship);
    if (incoming.has(relationship.toId)) incoming.get(relationship.toId).push(relationship);
  }
  return { nodesById, outgoing, incoming };
}

export function getNode(graph, nodeId) {
  return (graph?.nodes ?? []).find((node) => node.id === nodeId) ?? null;
}

export function getNodesByType(graph, types) {
  const list = Array.isArray(types) ? types : [types];
  return (graph?.nodes ?? []).filter((node) => list.includes(node.entityType));
}

/** Explicit alias for readability at call sites. */
export function filterByEntityType(graph, types) {
  return getNodesByType(graph, types);
}

export function getOutgoingRelationships(graph, nodeId) {
  return (graph?.relationships ?? []).filter((relationship) => relationship.fromId === nodeId);
}

export function getIncomingRelationships(graph, nodeId) {
  return (graph?.relationships ?? []).filter((relationship) => relationship.toId === nodeId);
}

/**
 * Direct neighbours of a node, optionally narrowed by relationship type,
 * direction ('out' | 'in' | 'both') and neighbour entity type.
 */
export function findRelatedNodes(graph, nodeId, options = {}) {
  const { direction = 'both', relationshipTypes = null, entityTypes = null } = options;
  const allowedRelationships = relationshipTypes ? new Set(relationshipTypes) : null;
  const allowedEntities = entityTypes ? new Set(entityTypes) : null;
  const results = [];
  const seen = new Set();

  const consider = (relationship, neighbourId) => {
    if (allowedRelationships && !allowedRelationships.has(relationship.type)) return;
    if (seen.has(`${relationship.id}:${neighbourId}`)) return;
    seen.add(`${relationship.id}:${neighbourId}`);
    const node = getNode(graph, neighbourId);
    if (!node) return;
    if (allowedEntities && !allowedEntities.has(node.entityType)) return;
    results.push({ node, relationship, direction: neighbourId === relationship.toId ? 'in' : 'out' });
  };

  if (direction === 'out' || direction === 'both') {
    for (const relationship of getOutgoingRelationships(graph, nodeId)) {
      consider(relationship, relationship.toId);
    }
  }
  if (direction === 'in' || direction === 'both') {
    for (const relationship of getIncomingRelationships(graph, nodeId)) {
      consider(relationship, relationship.fromId);
    }
  }
  return results;
}

/** Deduplicated connected entities (nodes only, no edges). */
export function getConnectedEntities(graph, nodeId, options = {}) {
  const seen = new Set();
  return findRelatedNodes(graph, nodeId, options)
    .map((entry) => entry.node)
    .filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
}

/* -------------------------------------------------------------------------- */
/* Traversal                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Breadth-first traversal from a starting node.
 * Cycle-safe (visited set), depth-capped and type-filterable.
 * Returns { startId, depth, visits: [{ node, depth, viaRelationshipId }], relationships }.
 */
export function traverseRelationships(graph, startId, options = {}) {
  const {
    depth = 2,
    direction = 'out',
    relationshipTypes = null,
    entityTypes = null,
    maxNodes = 500,
  } = options;

  const visits = [];
  const relationships = [];
  const start = getNode(graph, startId);
  if (!start) return { startId, depth, visits, relationships };

  const seenNodes = new Set([start.id]);
  const seenRelationships = new Set();
  let frontier = [start.id];

  for (let level = 0; level <= depth; level += 1) {
    if (frontier.length === 0) break;
    const nextFrontier = [];
    for (const currentId of frontier) {
      const neighbours = findRelatedNodes(graph, currentId, {
        direction,
        relationshipTypes,
        entityTypes,
      });
      for (const { node, relationship } of neighbours) {
        if (!seenRelationships.has(relationship.id)) {
          seenRelationships.add(relationship.id);
          relationships.push(relationship);
        }
        if (seenNodes.has(node.id)) continue;
        seenNodes.add(node.id);
        visits.push({ node, depth: level + 1, viaRelationshipId: relationship.id });
        nextFrontier.push(node.id);
        if (visits.length >= maxNodes) break;
      }
      if (visits.length >= maxNodes) break;
    }
    frontier = nextFrontier;
  }

  return { startId, depth, visits, relationships };
}

/** Shortest undirected path between two nodes; returns null when unreachable. */
export function shortestPath(graph, fromId, toId, { maxDepth = 6 } = {}) {
  const start = getNode(graph, fromId);
  const target = getNode(graph, toId);
  if (!start || !target) return null;
  if (fromId === toId) return { nodeIds: [fromId], relationshipIds: [], length: 0 };

  const queue = [{ id: fromId, nodeIds: [fromId], relationshipIds: [] }];
  const visited = new Set([fromId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.nodeIds.length > maxDepth + 1) continue;
    for (const { node, relationship } of findRelatedNodes(graph, current.id)) {
      if (visited.has(node.id)) continue;
      const nodeIds = [...current.nodeIds, node.id];
      const relationshipIds = [...current.relationshipIds, relationship.id];
      if (node.id === toId) return { nodeIds, relationshipIds, length: relationshipIds.length };
      visited.add(node.id);
      queue.push({ id: node.id, nodeIds, relationshipIds });
    }
  }
  return null;
}

/** Extracts an induced subgraph for a set of node ids (optionally + neighbours). */
export function getSubgraph(graph, nodeIds, { includeNeighbours = false } = {}) {
  const ids = new Set(nodeIds);
  if (includeNeighbours) {
    for (const id of nodeIds) {
      for (const { node } of findRelatedNodes(graph, id)) ids.add(node.id);
    }
  }
  const nodes = (graph?.nodes ?? []).filter((node) => ids.has(node.id));
  const relationships = (graph?.relationships ?? []).filter(
    (relationship) => ids.has(relationship.fromId) && ids.has(relationship.toId),
  );
  return {
    documentId: graph?.documentId ?? null,
    nodes,
    relationships,
    generatedAt: graph?.generatedAt ?? null,
    stats: computeGraphStats({ nodes, relationships }),
  };
}

/* -------------------------------------------------------------------------- */
/* Integrity                                                                  */
/* -------------------------------------------------------------------------- */

export function findOrphanNodes(graph) {
  const connected = new Set();
  for (const relationship of graph?.relationships ?? []) {
    connected.add(relationship.fromId);
    connected.add(relationship.toId);
  }
  return (graph?.nodes ?? []).filter((node) => !connected.has(node.id));
}

export function findBrokenRelationships(graph) {
  const ids = new Set((graph?.nodes ?? []).map((node) => node.id));
  return (graph?.relationships ?? []).filter(
    (relationship) => !ids.has(relationship.fromId) || !ids.has(relationship.toId),
  );
}

/** Finds cycles in the directed relationship graph (bounded by maxCycles). */
export function findCycles(graph, { maxCycles = 25 } = {}) {
  const index = indexGraph(graph);
  const cycles = [];
  const visited = new Set();
  const stack = new Set();

  const walk = (nodeId, path) => {
    if (cycles.length >= maxCycles) return;
    if (stack.has(nodeId)) {
      const start = path.indexOf(nodeId);
      if (start >= 0) cycles.push(path.slice(start).concat(nodeId));
      return;
    }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    stack.add(nodeId);
    for (const relationship of index.outgoing.get(nodeId) ?? []) {
      walk(relationship.toId, [...path, relationship.toId]);
      if (cycles.length >= maxCycles) break;
    }
    stack.delete(nodeId);
  };

  for (const node of graph?.nodes ?? []) {
    walk(node.id, [node.id]);
    if (cycles.length >= maxCycles) break;
  }
  return cycles;
}

export function computeGraphStats(graph) {
  const byEntityType = {};
  const byRelationshipType = {};
  const degree = new Map();

  for (const node of graph?.nodes ?? []) {
    byEntityType[node.entityType] = (byEntityType[node.entityType] ?? 0) + 1;
    degree.set(node.id, 0);
  }
  for (const relationship of graph?.relationships ?? []) {
    byRelationshipType[relationship.type] = (byRelationshipType[relationship.type] ?? 0) + 1;
    degree.set(relationship.fromId, (degree.get(relationship.fromId) ?? 0) + 1);
    degree.set(relationship.toId, (degree.get(relationship.toId) ?? 0) + 1);
  }

  const nodeCount = graph?.nodes?.length ?? 0;
  const relationshipCount = graph?.relationships?.length ?? 0;

  return {
    nodeCount,
    relationshipCount,
    byEntityType,
    byRelationshipType,
    orphanNodeCount: findOrphanNodes(graph).length,
    averageDegree: nodeCount === 0 ? 0 : Number(((relationshipCount * 2) / nodeCount).toFixed(2)),
  };
}

/* -------------------------------------------------------------------------- */
/* Presentation metadata (plain data, safe for UI grouping)                   */
/* -------------------------------------------------------------------------- */

export const ENTITY_TYPE_LABELS = Object.freeze({
  [ENTITY_TYPES.DOCUMENT]: 'Document',
  [ENTITY_TYPES.PARTY]: 'Party',
  [ENTITY_TYPES.CLAUSE]: 'Clause',
  [ENTITY_TYPES.DEFINITION]: 'Definition',
  [ENTITY_TYPES.RIGHT]: 'Right',
  [ENTITY_TYPES.OBLIGATION]: 'Obligation',
  [ENTITY_TYPES.CONDITION]: 'Condition',
  [ENTITY_TYPES.DEADLINE]: 'Deadline',
  [ENTITY_TYPES.CONSEQUENCE]: 'Consequence',
  [ENTITY_TYPES.RISK]: 'Risk signal',
  [ENTITY_TYPES.INCONSISTENCY]: 'Inconsistency',
});

export const RELATIONSHIP_TYPE_LABELS = Object.freeze({
  'document-has-party': 'has party',
  'document-has-clause': 'has clause',
  'clause-references': 'references clause',
  'clause-defines': 'defines',
  'clause-imposes-obligation': 'imposes obligation',
  'clause-grants-right': 'grants right',
  'clause-states-condition': 'states condition',
  'clause-sets-deadline': 'sets deadline',
  'clause-states-consequence': 'states consequence',
  'clause-flags-risk': 'flags risk',
  'party-obligated-by': 'is obligated by',
  'obligation-owed-to': 'is owed to',
  'party-holds-right': 'holds right',
  'right-held-against': 'is held against',
  'obligation-triggered-by': 'triggered by',
  'obligation-has-deadline': 'has deadline',
  'obligation-results-in': 'results in',
  'condition-triggers': 'triggers',
  'condition-has-deadline': 'has deadline',
  'consequence-follows-condition': 'follows condition',
  'consequence-affected-party': 'affects party',
  'definition-applies-to': 'applies to',
  'deadline-anchored-to': 'anchored to',
  'risk-about': 'about',
  'inconsistency-between': 'between',
  'entity-relates-to': 'relates to',
});

export function entityTypeLabel(entityType) {
  return ENTITY_TYPE_LABELS[entityType] ?? 'Entity';
}

export function relationshipTypeLabel(type) {
  return RELATIONSHIP_TYPE_LABELS[type] ?? String(type ?? 'related to').replace(/-/g, ' ');
}
