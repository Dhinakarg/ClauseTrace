/**
 * Graph view model.
 *
 * Turns a LegalGraph into everything the Phase 3 graph view needs, as plain
 * data: typed node metadata (shape, icon, accessible text — never colour alone),
 * semantic edge metadata, adjacency, group filtering, cluster planning for
 * clutter control, focus sets for relationship highlighting, and the rows of the
 * accessible list view.
 *
 * Pure module: no React, no layout coordinates (that is `graphCanvas.js`).
 */

import { ENTITY_TYPES } from './schema.js';
import { relationshipTypeLabel } from './graphEngine.js';

/* -------------------------------------------------------------------------- */
/* Type registries                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Presentation metadata per entity type. `shape` and `icon` carry the meaning;
 * colour is only ever a secondary cue, and `aria` is used for the accessible
 * text of every node.
 */
export const NODE_TYPE_META = Object.freeze({
  [ENTITY_TYPES.DOCUMENT]: {
    label: 'Document',
    group: 'structure',
    shape: 'document',
    icon: 'file-text',
    aria: 'Document',
  },
  [ENTITY_TYPES.CLAUSE]: {
    label: 'Clause',
    group: 'structure',
    shape: 'rect',
    icon: 'list-tree',
    aria: 'Clause',
  },
  [ENTITY_TYPES.DEFINITION]: {
    label: 'Definition',
    group: 'structure',
    shape: 'rect',
    icon: 'book-marked',
    aria: 'Definition',
  },
  [ENTITY_TYPES.PARTY]: {
    label: 'Party',
    group: 'actors',
    shape: 'circle',
    icon: 'users',
    aria: 'Party',
  },
  [ENTITY_TYPES.OBLIGATION]: {
    label: 'Obligation',
    group: 'duties',
    shape: 'diamond',
    icon: 'circle-check',
    aria: 'Obligation',
  },
  [ENTITY_TYPES.RIGHT]: {
    label: 'Right',
    group: 'duties',
    shape: 'diamond',
    icon: 'hand',
    aria: 'Right',
  },
  [ENTITY_TYPES.CONDITION]: {
    label: 'Condition',
    group: 'time',
    shape: 'hexagon',
    icon: 'git-branch',
    aria: 'Condition',
  },
  [ENTITY_TYPES.DEADLINE]: {
    label: 'Deadline',
    group: 'time',
    shape: 'hexagon',
    icon: 'calendar-clock',
    aria: 'Deadline',
  },
  [ENTITY_TYPES.CONSEQUENCE]: {
    label: 'Consequence',
    group: 'findings',
    shape: 'triangle',
    icon: 'alert-triangle',
    aria: 'Consequence',
  },
  [ENTITY_TYPES.RISK]: {
    label: 'Risk signal',
    group: 'findings',
    shape: 'triangle',
    icon: 'shield-alert',
    aria: 'Risk signal',
  },
  [ENTITY_TYPES.INCONSISTENCY]: {
    label: 'Inconsistency',
    group: 'findings',
    shape: 'triangle',
    icon: 'git-compare',
    aria: 'Potential inconsistency',
  },
});

const FALLBACK_NODE_META = Object.freeze({
  label: 'Entity',
  group: 'structure',
  shape: 'rect',
  icon: 'circle',
  aria: 'Entity',
});

/** Filter groups offered in the toolbar, with the types each one shows. */
export const GRAPH_GROUPS = Object.freeze([
  {
    id: 'structure',
    label: 'Document and clauses',
    description: 'The document, its clauses and defined terms.',
    types: [ENTITY_TYPES.DOCUMENT, ENTITY_TYPES.CLAUSE, ENTITY_TYPES.DEFINITION],
  },
  {
    id: 'actors',
    label: 'Parties',
    description: 'The people and organisations the document binds.',
    types: [ENTITY_TYPES.PARTY],
  },
  {
    id: 'duties',
    label: 'Obligations and rights',
    description: 'What each party must do, and what it may do.',
    types: [ENTITY_TYPES.OBLIGATION, ENTITY_TYPES.RIGHT],
  },
  {
    id: 'time',
    label: 'Conditions and deadlines',
    description: 'Triggers, notice periods and dates.',
    types: [ENTITY_TYPES.CONDITION, ENTITY_TYPES.DEADLINE],
  },
  {
    id: 'findings',
    label: 'Consequences, risks and inconsistencies',
    description: 'What follows a breach, plus deterministic signals and potential inconsistencies.',
    types: [ENTITY_TYPES.CONSEQUENCE, ENTITY_TYPES.RISK, ENTITY_TYPES.INCONSISTENCY],
  },
]);

export const GRAPH_GROUP_IDS = Object.freeze(GRAPH_GROUPS.map((group) => group.id));

export function nodeTypeMeta(entityType) {
  return NODE_TYPE_META[entityType] ?? FALLBACK_NODE_META;
}

export function groupForEntityType(entityType) {
  return nodeTypeMeta(entityType).group;
}

/* -------------------------------------------------------------------------- */
/* Edge semantics                                                             */
/* -------------------------------------------------------------------------- */

/** Edge families, for the legend and for bundling decisions. */
export const EDGE_CATEGORIES = Object.freeze({
  structure: { label: 'Structure', description: 'What the document contains.' },
  duties: { label: 'Duties and rights', description: 'Who must do what, and who owes it to whom.' },
  time: { label: 'Timing', description: 'Triggers, conditions and deadlines.' },
  findings: { label: 'Findings', description: 'Consequences, risk signals and inconsistencies.' },
  reference: { label: 'References', description: 'Cross-references and plain associations.' },
});

/**
 * Semantic meaning of every relationship type the engines emit. The label is the
 * sentence fragment used in the graph, the detail panel and the accessible list,
 * so an edge is always readable as text and not only as a line.
 */
export const EDGE_SEMANTICS = Object.freeze({
  'document-has-party': { label: 'has party', category: 'structure' },
  'document-has-clause': { label: 'has clause', category: 'structure' },
  'clause-references': { label: 'references clause', category: 'reference' },
  'clause-defines': { label: 'defines', category: 'structure' },
  'clause-imposes-obligation': { label: 'imposes obligation', category: 'duties' },
  'clause-grants-right': { label: 'grants right', category: 'duties' },
  'clause-states-condition': { label: 'states condition', category: 'time' },
  'clause-sets-deadline': { label: 'sets deadline', category: 'time' },
  'clause-states-consequence': { label: 'states consequence', category: 'findings' },
  'clause-flags-risk': { label: 'flags risk', category: 'findings' },
  'party-obligated-by': { label: 'is obligated by', category: 'duties' },
  'obligation-owed-to': { label: 'is owed to', category: 'duties' },
  'party-holds-right': { label: 'holds right', category: 'duties' },
  'right-held-against': { label: 'is held against', category: 'duties' },
  'obligation-triggered-by': { label: 'triggered by', category: 'time' },
  'obligation-has-deadline': { label: 'has deadline', category: 'time' },
  'obligation-results-in': { label: 'results in', category: 'findings' },
  'condition-triggers': { label: 'triggers', category: 'time' },
  'condition-has-deadline': { label: 'has deadline', category: 'time' },
  'consequence-follows-condition': { label: 'follows condition', category: 'findings' },
  'consequence-affected-party': { label: 'affects party', category: 'findings' },
  'definition-applies-to': { label: 'applies to', category: 'reference' },
  'deadline-anchored-to': { label: 'anchored to', category: 'time' },
  'risk-about': { label: 'about', category: 'findings' },
  'inconsistency-between': { label: 'between', category: 'findings' },
  'entity-relates-to': { label: 'relates to', category: 'reference' },
});

export function edgeSemantics(type) {
  const known = EDGE_SEMANTICS[type];
  if (known) return { type, ...known };
  return { type, label: relationshipTypeLabel(type), category: 'reference' };
}

/* -------------------------------------------------------------------------- */
/* Indexing and filtering                                                     */
/* -------------------------------------------------------------------------- */

/** Adjacency index: neighbours, direction and semantics for each node. */
export function buildGraphIndex(graph) {
  const nodeById = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  const adjacency = new Map();
  for (const node of graph?.nodes ?? []) adjacency.set(node.id, []);
  for (const relationship of graph?.relationships ?? []) {
    if (!nodeById.has(relationship.fromId) || !nodeById.has(relationship.toId)) continue;
    const semantics = edgeSemantics(relationship.type);
    const direction = relationship.directed === false ? 'both' : null;
    adjacency.get(relationship.fromId).push({
      relationship,
      semantics,
      otherId: relationship.toId,
      direction: direction ?? 'out',
      phrase: `${semantics.label}`,
    });
    adjacency.get(relationship.toId).push({
      relationship,
      semantics,
      otherId: relationship.fromId,
      direction: direction ?? 'in',
      phrase: direction === 'both' ? semantics.label : `${semantics.label} (incoming)`,
    });
  }
  return {
    nodeById,
    adjacency,
    degreeById: new Map([...adjacency].map(([id, list]) => [id, list.length])),
  };
}

/** Keeps only the node types the reader has left switched on. */
export function filterGraphByGroups(graph, activeGroupIds) {
  if (!graph) return null;
  const active = new Set(Array.isArray(activeGroupIds) ? activeGroupIds : GRAPH_GROUP_IDS);
  const visibleTypes = new Set(
    GRAPH_GROUPS.filter((group) => active.has(group.id)).flatMap((group) => group.types),
  );
  const nodes = graph.nodes.filter((node) => visibleTypes.has(node.entityType));
  const ids = new Set(nodes.map((node) => node.id));
  return {
    ...graph,
    nodes,
    relationships: graph.relationships.filter(
      (relationship) => ids.has(relationship.fromId) && ids.has(relationship.toId),
    ),
  };
}

/** Case-insensitive label/type search, used by the list view and the graph. */
export function searchGraphNodes(nodes, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return nodes;
  return nodes.filter((node) =>
    [node.label, node.entityType, nodeTypeMeta(node.entityType).label]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)),
  );
}

/** Accessible text for one node: name, type, degree and evidence count. */
export function nodeAriaLabel(node, index, { shownRelationshipCount = null } = {}) {
  if (!node) return '';
  const meta = nodeTypeMeta(node.entityType);
  const degree = index?.degreeById?.get(node.id) ?? 0;
  const shown = shownRelationshipCount ?? degree;
  const pieces = [`${meta.aria}: ${node.label}`, `${degree} relationship(s)`];
  if (shown !== degree) pieces.push(`${shown} visible after filtering`);
  pieces.push(node.evidenceCount === 1 ? '1 citation' : `${node.evidenceCount ?? 0} citations`);
  if (node.provenance === 'derived') pieces.push('derived by this app');
  return `${pieces.join(', ')}.`;
}

/** Node ids within `depth` hops of `focusNodeId`, for selection highlighting. */
export function focusSet(graph, focusNodeId, depth = 1) {
  const ids = new Set();
  if (!graph || !focusNodeId) return ids;
  ids.add(focusNodeId);
  let frontier = [focusNodeId];
  for (let level = 0; level < Math.max(0, depth); level += 1) {
    const next = [];
    for (const id of frontier) {
      for (const relationship of graph.relationships ?? []) {
        const neighbour =
          relationship.fromId === id
            ? relationship.toId
            : relationship.toId === id
              ? relationship.fromId
              : null;
        if (neighbour && !ids.has(neighbour)) {
          ids.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
  }
  return ids;
}

/** Relationships that touch the selected node, in graph order. */
export function focusRelationships(graph, focusNodeId) {
  if (!graph || !focusNodeId) return [];
  return (graph.relationships ?? []).filter(
    (relationship) => relationship.fromId === focusNodeId || relationship.toId === focusNodeId,
  );
}

/* -------------------------------------------------------------------------- */
/* Clutter control                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Splits each group into a cluster of at most `maxPerCluster` nodes plus a
 * hidden remainder, so a document with hundreds of obligations still renders a
 * readable picture. The most connected nodes inside a group are kept.
 */
export function planGraphClusters(nodes, { maxPerCluster = 10, degreeById = null } = {}) {
  const byGroup = new Map();
  for (const node of nodes ?? []) {
    const groupId = groupForEntityType(node.entityType);
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push(node);
  }
  const clusters = [];
  for (const group of GRAPH_GROUPS) {
    const all = byGroup.get(group.id) ?? [];
    if (!all.length) continue;
    const ordered = [...all].sort((a, b) => {
      const byDegree = (degreeById?.get(b.id) ?? 0) - (degreeById?.get(a.id) ?? 0);
      if (byDegree !== 0) return byDegree;
      return String(a.label).localeCompare(String(b.label));
    });
    const visible = ordered.slice(0, Math.max(1, maxPerCluster));
    clusters.push({
      id: group.id,
      label: group.label,
      description: group.description,
      nodes: visible,
      total: all.length,
      hiddenCount: all.length - visible.length,
      collapsed: all.length > visible.length,
    });
  }
  return clusters;
}

/* -------------------------------------------------------------------------- */
/* List rows (the accessible view)                                            */
/* -------------------------------------------------------------------------- */

/**
 * One row per node with its type, relationships, citations and the action ids
 * the list view offers. This is the same information the picture shows, as text.
 */
export function buildGraphListRows(nodes, index, { searchText = '' } = {}) {
  const needle = String(searchText ?? '').trim().toLowerCase();
  const rows = [];
  for (const node of nodes ?? []) {
    const meta = nodeTypeMeta(node.entityType);
    const entries = (index?.adjacency?.get(node.id) ?? []).map((entry) => {
      const other = index.nodeById.get(entry.otherId) ?? null;
      return {
        id: entry.relationship.id,
        type: entry.relationship.type,
        phrase: entry.phrase,
        category: entry.semantics.category,
        provenance: entry.relationship.provenance ?? 'unknown',
        otherId: entry.otherId,
        otherLabel: other?.label ?? entry.otherId,
        otherType: other?.entityType ?? null,
        otherTypeLabel: other ? nodeTypeMeta(other.entityType).label : 'Entity',
      };
    });
    const row = {
      id: node.id,
      label: node.label,
      entityType: node.entityType,
      typeLabel: meta.label,
      group: meta.group,
      shape: meta.shape,
      icon: meta.icon,
      provenance: node.provenance ?? 'unknown',
      confidence: node.confidence ?? 'unknown',
      evidence: Array.isArray(node.entity?.evidence) ? node.entity.evidence : [],
      evidenceCount: node.evidenceCount ?? 0,
      relationships: entries,
      ariaLabel: nodeAriaLabel(node, index, { shownRelationshipCount: entries.length }),
      actionIds: ['highlight', 'relationships', 'evidence'],
    };
    row.searchText = [
      row.label,
      row.typeLabel,
      ...entries.map((entry) => `${entry.phrase} ${entry.otherLabel}`),
    ]
      .join(' ')
      .toLowerCase();
    if (!needle || row.searchText.includes(needle)) rows.push(row);
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* View model                                                                 */
/* -------------------------------------------------------------------------- */

function countValues(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Everything the graph route needs in one pure pass: the filtered graph, the
 * clusters that will actually be drawn, the focus set for highlighting/dimming,
 * the accessible rows, and counts for the stat tiles.
 *
 * Clutter control happens here and not in the component: nodes beyond
 * `maxPerCluster` inside a group are reported as `hiddenCount` rather than drawn.
 * The selected node is always kept visible, even if it fell outside a cluster.
 */
export function buildGraphViewModel(
  graph,
  {
    activeGroupIds = GRAPH_GROUP_IDS,
    focusNodeId = null,
    depth = 1,
    maxPerCluster = 10,
    searchText = '',
  } = {},
) {
  const filtered = filterGraphByGroups(graph, activeGroupIds) ?? { nodes: [], relationships: [] };
  const index = buildGraphIndex(filtered);
  const clusters = planGraphClusters(filtered.nodes, {
    maxPerCluster,
    degreeById: index.degreeById,
  });

  const visibleIds = new Set(clusters.flatMap((cluster) => cluster.nodes.map((node) => node.id)));
  const focusKept = Boolean(focusNodeId && index.nodeById.has(focusNodeId) && !visibleIds.has(focusNodeId));
  if (focusKept) visibleIds.add(focusNodeId);

  const visibleNodes = searchText
    ? searchGraphNodes(
        filtered.nodes.filter((node) => visibleIds.has(node.id)),
        searchText,
      )
    : filtered.nodes.filter((node) => visibleIds.has(node.id));
  const visibleRelationships = filtered.relationships.filter(
    (relationship) => visibleIds.has(relationship.fromId) && visibleIds.has(relationship.toId),
  );
  const visibleGraph = { ...filtered, nodes: visibleNodes, relationships: visibleRelationships };
  const visibleIndex = buildGraphIndex(visibleGraph);

  const highlighted = focusNodeId && index.nodeById.has(focusNodeId)
    ? focusSet(visibleGraph, focusNodeId, depth)
    : new Set();
  const relatedRelationships = focusNodeId ? focusRelationships(visibleGraph, focusNodeId) : [];

  const listRows = buildGraphListRows(visibleNodes, visibleIndex, { searchText: '' });

  return {
    graph: filtered,
    visibleGraph,
    index,
    visibleIndex,
    clusters,
    focus: {
      nodeId: focusNodeId && index.nodeById.has(focusNodeId) ? focusNodeId : null,
      node: focusNodeId ? index.nodeById.get(focusNodeId) ?? null : null,
      nodeIds: highlighted,
      relationships: relatedRelationships,
      keptOutsideCluster: focusKept,
      dimmedCount: visibleNodes.length - highlighted.size,
    },
    listRows,
    legend: GRAPH_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      description: group.description,
      types: group.types.map((type) => ({
        entityType: type,
        label: nodeTypeMeta(type).label,
        shape: nodeTypeMeta(type).shape,
        icon: nodeTypeMeta(type).icon,
      })),
      count: filtered.nodes.filter((node) => group.types.includes(node.entityType)).length,
    })),
    edgeLegend: Object.entries(EDGE_CATEGORIES).map(([id, meta]) => ({ id, ...meta })),
    counts: {
      nodes: filtered.nodes.length,
      relationships: filtered.relationships.length,
      visibleNodes: visibleNodes.length,
      visibleRelationships: visibleRelationships.length,
      hiddenNodes: filtered.nodes.length - visibleIds.size,
      hiddenByCluster: clusters.reduce((total, cluster) => total + cluster.hiddenCount, 0),
      collapsedClusters: clusters.filter((cluster) => cluster.collapsed).length,
      byType: countValues(filtered.nodes, (node) => node.entityType),
      byGroup: countValues(filtered.nodes, (node) => groupForEntityType(node.entityType)),
      edgesByCategory: countValues(filtered.relationships, (relationship) =>
        edgeSemantics(relationship.type).category,
      ),
    },
    empty: filtered.nodes.length === 0,
  };
}

/** Headline numbers for the graph route's stat tiles. */
export function summarizeGraphViewModel(view) {
  const counts = view?.counts ?? {};
  return {
    nodeCount: counts.nodes ?? 0,
    relationshipCount: counts.relationships ?? 0,
    visibleNodeCount: counts.visibleNodes ?? 0,
    hiddenNodeCount: counts.hiddenByCluster ?? 0,
    collapsedClusters: counts.collapsedClusters ?? 0,
    clauseCount: counts.byType?.[ENTITY_TYPES.CLAUSE] ?? 0,
    obligationCount: counts.byType?.[ENTITY_TYPES.OBLIGATION] ?? 0,
    deadlineCount: counts.byType?.[ENTITY_TYPES.DEADLINE] ?? 0,
    riskCount: counts.byType?.[ENTITY_TYPES.RISK] ?? 0,
    inconsistencyCount: counts.byType?.[ENTITY_TYPES.INCONSISTENCY] ?? 0,
    listRowCount: view?.listRows?.length ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Derived findings as graph nodes                                            */
/* -------------------------------------------------------------------------- */

function findingNode(entity, { entityType, severity, ruleId }) {
  return {
    id: entity.id,
    entityType,
    label: entity.title,
    documentId: entity.documentId ?? null,
    clauseId: entity.clauseId ?? null,
    confidence: entity.confidence ?? 'high',
    provenance: entity.provenance ?? 'derived',
    evidenceCount: Array.isArray(entity.evidence) ? entity.evidence.length : 0,
    verified: false,
    derived: true,
    severity,
    ruleId,
    entity,
  };
}

function findingRelationship({ id, type, fromId, fromType, toId, toType, documentId }) {
  return {
    id,
    type,
    fromId,
    fromType,
    toId,
    toType,
    label: null,
    directed: true,
    documentId,
    provenance: 'derived',
    confidence: 'high',
    evidence: [],
  };
}

/**
 * Adds the deterministic findings to a graph as first-class typed nodes:
 * risk signals and inconsistencies, each linked to the clause it was found in.
 * Findings whose clause is not in the graph still become nodes; only the edge is
 * skipped, so nothing is silently dropped.
 */
export function augmentGraphWithFindings(graph, { signals = [], inconsistencies = [] } = {}) {
  if (!graph) return graph;
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const nodes = [...graph.nodes];
  const relationships = [...graph.relationships];

  for (const signal of signals) {
    if (!nodeIds.has(signal.id)) {
      nodeIds.add(signal.id);
      nodes.push(
        findingNode(signal, {
          entityType: ENTITY_TYPES.RISK,
          severity: signal.severity,
          ruleId: signal.detection?.ruleId ?? null,
        }),
      );
    }
    if (signal.clauseId && nodeIds.has(signal.clauseId)) {
      relationships.push(
        findingRelationship({
          id: `rel_${signal.id}_about`,
          type: 'risk-about',
          fromId: signal.id,
          fromType: ENTITY_TYPES.RISK,
          toId: signal.clauseId,
          toType: ENTITY_TYPES.CLAUSE,
          documentId: signal.documentId ?? graph.documentId ?? null,
        }),
      );
    }
  }

  for (const finding of inconsistencies) {
    if (!nodeIds.has(finding.id)) {
      nodeIds.add(finding.id);
      nodes.push(
        findingNode(finding, {
          entityType: ENTITY_TYPES.INCONSISTENCY,
          severity: finding.severity,
          ruleId: finding.detection?.ruleId ?? null,
        }),
      );
    }
    for (const clauseId of finding.clauseIds ?? []) {
      if (!nodeIds.has(clauseId)) continue;
      relationships.push(
        findingRelationship({
          id: `rel_${finding.id}_${clauseId}`,
          type: 'inconsistency-between',
          fromId: finding.id,
          fromType: ENTITY_TYPES.INCONSISTENCY,
          toId: clauseId,
          toType: ENTITY_TYPES.CLAUSE,
          documentId: finding.documentId ?? graph.documentId ?? null,
        }),
      );
    }
  }

  return { ...graph, nodes, relationships };
}

/* -------------------------------------------------------------------------- */
/* Focused Graph Helpers & View Model                                          */
/* -------------------------------------------------------------------------- */

/**
 * Finds a representative starting node id when opening the focused graph view.
 * Prefers an obligation with highest connections, then any obligation/duty/finding.
 */
export function findDefaultFocusNodeId(graph) {
  if (!graph?.nodes?.length) return null;
  const index = buildGraphIndex(graph);

  const obligations = graph.nodes.filter((node) => node.entityType === ENTITY_TYPES.OBLIGATION);
  if (obligations.length > 0) {
    const sorted = [...obligations].sort(
      (a, b) => (index.degreeById.get(b.id) ?? 0) - (index.degreeById.get(a.id) ?? 0),
    );
    return sorted[0].id;
  }

  const duties = graph.nodes.filter((node) =>
    [ENTITY_TYPES.RIGHT, ENTITY_TYPES.DEADLINE, ENTITY_TYPES.CONDITION].includes(node.entityType),
  );
  if (duties.length > 0) {
    const sorted = [...duties].sort(
      (a, b) => (index.degreeById.get(b.id) ?? 0) - (index.degreeById.get(a.id) ?? 0),
    );
    return sorted[0].id;
  }

  return graph.nodes[0].id;
}

/**
 * Derives concise, human-readable topic suggestions for the graph search selector.
 */
export function suggestGraphTopics(graph, { limit = 6 } = {}) {
  if (!graph?.nodes?.length) return [];
  const suggestions = [];

  const obligations = graph.nodes.filter((node) => node.entityType === ENTITY_TYPES.OBLIGATION);
  for (const ob of obligations.slice(0, 3)) {
    suggestions.push({ id: ob.id, label: ob.label, type: 'obligation' });
  }
  const inconsistencies = graph.nodes.filter((node) => node.entityType === ENTITY_TYPES.INCONSISTENCY);
  for (const inc of inconsistencies.slice(0, 1)) {
    suggestions.push({ id: inc.id, label: inc.label, type: 'inconsistency' });
  }
  const deadlines = graph.nodes.filter((node) => node.entityType === ENTITY_TYPES.DEADLINE);
  for (const dl of deadlines.slice(0, 2)) {
    suggestions.push({ id: dl.id, label: dl.label, type: 'deadline' });
  }

  return suggestions.slice(0, limit);
}

/**
 * Constructs a focused graph view centered around `focusNodeId` within `depth` hops.
 * Standalone risk/inconsistency nodes are annotated onto target entities rather than cluttering the graph.
 */
export function buildFocusedGraphViewModel(
  graph,
  {
    focusNodeId = null,
    depth = 1,
    searchText = '',
  } = {},
) {
  const fullIndex = buildGraphIndex(graph);
  const targetFocusId = focusNodeId && fullIndex.nodeById.has(focusNodeId)
    ? focusNodeId
    : findDefaultFocusNodeId(graph);

  // Map finding nodes (risks/inconsistencies) to finding annotations on target entities
  const findingsByNodeId = new Map();
  for (const relationship of graph?.relationships ?? []) {
    const fromNode = fullIndex.nodeById.get(relationship.fromId);
    const toNode = fullIndex.nodeById.get(relationship.toId);

    const isFindingFrom = fromNode && (fromNode.entityType === ENTITY_TYPES.RISK || fromNode.entityType === ENTITY_TYPES.INCONSISTENCY);
    const isFindingTo = toNode && (toNode.entityType === ENTITY_TYPES.RISK || toNode.entityType === ENTITY_TYPES.INCONSISTENCY);

    if (isFindingFrom && toNode && !isFindingTo) {
      const list = findingsByNodeId.get(toNode.id) ?? [];
      list.push(fromNode);
      findingsByNodeId.set(toNode.id, list);
    } else if (isFindingTo && fromNode && !isFindingFrom) {
      const list = findingsByNodeId.get(fromNode.id) ?? [];
      list.push(toNode);
      findingsByNodeId.set(fromNode.id, list);
    }
  }

  // Filter primary canvas nodes (exclude standalone RISK & INCONSISTENCY unless selected directly)
  const primaryNodes = (graph?.nodes ?? []).filter(
    (node) =>
      node.id === targetFocusId ||
      (node.entityType !== ENTITY_TYPES.RISK && node.entityType !== ENTITY_TYPES.INCONSISTENCY),
  );
  const primaryIds = new Set(primaryNodes.map((node) => node.id));

  // Relationships between primary nodes
  const primaryRelationships = (graph?.relationships ?? []).filter(
    (relationship) => primaryIds.has(relationship.fromId) && primaryIds.has(relationship.toId),
  );

  const primaryGraph = { nodes: primaryNodes, relationships: primaryRelationships };

  // Calculate focused set within `depth` hops around `targetFocusId`
  const focusIds = targetFocusId ? focusSet(primaryGraph, targetFocusId, depth) : new Set(primaryNodes.map(n => n.id));

  // Visible nodes in focused graph
  let visibleNodes = primaryNodes.filter((node) => focusIds.has(node.id));
  if (searchText) {
    visibleNodes = searchGraphNodes(visibleNodes, searchText);
  }

  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleRelationships = primaryRelationships.filter(
    (relationship) => visibleNodeIds.has(relationship.fromId) && visibleNodeIds.has(relationship.toId),
  );

  // Annotate nodes with findings (warnings)
  const annotatedNodes = visibleNodes.map((node) => {
    const findings = findingsByNodeId.get(node.id) ?? [];
    return {
      ...node,
      findings,
      hasFindings: findings.length > 0,
    };
  });

  const focusedGraph = { nodes: annotatedNodes, relationships: visibleRelationships };
  const visibleIndex = buildGraphIndex(focusedGraph);
  const listRows = buildGraphListRows(annotatedNodes, visibleIndex, { searchText: '' });

  return {
    graph: primaryGraph,
    visibleGraph: focusedGraph,
    index: fullIndex,
    visibleIndex,
    clusters: [],
    focus: {
      nodeId: targetFocusId,
      node: targetFocusId ? fullIndex.nodeById.get(targetFocusId) ?? null : null,
      nodeIds: focusIds,
      relationships: targetFocusId ? focusRelationships(focusedGraph, targetFocusId) : [],
      keptOutsideCluster: false,
      dimmedCount: 0,
    },
    listRows,
    legend: GRAPH_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      description: group.description,
      types: group.types.map((type) => ({
        entityType: type,
        label: nodeTypeMeta(type).label,
        shape: nodeTypeMeta(type).shape,
        icon: nodeTypeMeta(type).icon,
      })),
      count: annotatedNodes.filter((node) => group.types.includes(node.entityType)).length,
    })),
    edgeLegend: Object.entries(EDGE_CATEGORIES).map(([id, meta]) => ({ id, ...meta })),
    counts: {
      nodes: primaryNodes.length,
      relationships: primaryRelationships.length,
      visibleNodes: annotatedNodes.length,
      visibleRelationships: visibleRelationships.length,
      hiddenNodes: primaryNodes.length - annotatedNodes.length,
      hiddenByCluster: 0,
      collapsedClusters: 0,
      byType: countValues(annotatedNodes, (node) => node.entityType),
      byGroup: countValues(annotatedNodes, (node) => groupForEntityType(node.entityType)),
      edgesByCategory: countValues(visibleRelationships, (relationship) =>
        edgeSemantics(relationship.type).category,
      ),
    },
    empty: annotatedNodes.length === 0,
    isFocusedView: true,
  };
}

