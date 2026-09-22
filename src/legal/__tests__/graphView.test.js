import { describe, expect, it } from 'vitest';
import { buildGraph, createGraphNode } from '../graphEngine.js';
import { withDerivedRelationships } from '../relationships.js';
import { ENTITY_TYPES } from '../schema.js';
import {
  GRAPH_GROUP_IDS,
  augmentGraphWithFindings,
  buildFocusedGraphViewModel,
  buildGraphIndex,
  buildGraphListRows,
  buildGraphViewModel,
  edgeSemantics,
  filterGraphByGroups,
  findDefaultFocusNodeId,
  focusRelationships,
  focusSet,
  groupForEntityType,
  nodeAriaLabel,
  nodeTypeMeta,
  planGraphClusters,
  searchGraphNodes,
  suggestGraphTopics,
  summarizeGraphViewModel,
} from '../graphView.js';
import { buildValidModel } from './fixtures.js';

/** The fixture agreement as a graph, including the deterministically derived edges. */
function fixtureGraph() {
  const model = withDerivedRelationships(buildValidModel()).model;
  return buildGraph(model);
}

describe('graphView: type metadata', () => {
  it('describes each entity type with a shape, a group and a spoken label', () => {
    const obligation = nodeTypeMeta(ENTITY_TYPES.OBLIGATION);
    expect(obligation.shape).toBe('diamond');
    expect(obligation.aria).toBe('Obligation');
    expect(obligation.group).toBe('duties');
    expect(groupForEntityType(ENTITY_TYPES.PARTY)).toBe('actors');
  });

  it('falls back to a neutral entity for an unknown type', () => {
    expect(nodeTypeMeta('something_new').shape).toBe('rect');
    expect(groupForEntityType(undefined)).toBe('structure');
  });

  it('labels an edge with a phrase and a family', () => {
    expect(edgeSemantics('clause-imposes-obligation')).toMatchObject({
      label: 'imposes obligation',
      category: 'duties',
    });
    expect(edgeSemantics('not-a-real-type').category).toBe('reference');
  });
});

describe('graphView: filtering and indexes', () => {
  it('keeps only the node types of the active groups and prunes their edges', () => {
    const graph = fixtureGraph();
    const partiesOnly = filterGraphByGroups(graph, ['actors']);
    expect(partiesOnly.nodes.length).toBeGreaterThan(0);
    expect(partiesOnly.nodes.every((node) => node.entityType === ENTITY_TYPES.PARTY)).toBe(true);
    expect(partiesOnly.relationships).toHaveLength(0);
    expect(filterGraphByGroups(null, GRAPH_GROUP_IDS)).toBeNull();
  });

  it('indexes neighbours, direction and degree', () => {
    const graph = fixtureGraph();
    const index = buildGraphIndex(graph);
    expect(index.nodeById.size).toBe(graph.nodes.length);
    expect(index.degreeById.get('cl_payment')).toBeGreaterThan(0);
    const entry = index.adjacency.get('cl_payment')[0];
    expect(entry.phrase).toBeTruthy();
    expect(entry.semantics.category).toBeTruthy();
  });

  it('searches labels and types without touching the graph', () => {
    const graph = fixtureGraph();
    expect(searchGraphNodes(graph.nodes, 'acme').map((node) => node.id)).toContain(
      'party_customer',
    );
    expect(searchGraphNodes(graph.nodes, '')).toHaveLength(graph.nodes.length);
    expect(searchGraphNodes(graph.nodes, 'nothing-matches-this')).toHaveLength(0);
  });

  it('walks the graph for focus highlighting', () => {
    const graph = fixtureGraph();
    const oneHop = focusSet(graph, 'cl_payment', 1);
    expect(oneHop.has('cl_payment')).toBe(true);
    expect(oneHop.size).toBeGreaterThan(1);
    expect(focusSet(graph, null)).toEqual(new Set());
    expect(focusRelationships(graph, 'cl_payment').length).toBeGreaterThan(0);
    expect(focusRelationships(graph, null)).toEqual([]);
  });
});

describe('graphView: clutter control', () => {
  const duties = Array.from({ length: 14 }, (_, index) =>
    createGraphNode(
      { id: `obl_${index}`, summary: `Duty ${index}`, evidence: [] },
      { entityType: ENTITY_TYPES.OBLIGATION },
    ),
  );
  const degreeById = new Map(duties.map((node, index) => [node.id, duties.length - index]));

  it('caps each group and reports what it held back', () => {
    const clusters = planGraphClusters(duties, { maxPerCluster: 10, degreeById });
    const cluster = clusters.find((entry) => entry.id === 'duties');
    expect(cluster.nodes).toHaveLength(10);
    expect(cluster.total).toBe(14);
    expect(cluster.hiddenCount).toBe(4);
    expect(cluster.collapsed).toBe(true);
    expect(cluster.nodes[0].id).toBe('obl_0');
  });

  it('never draws an empty cluster', () => {
    const clusters = planGraphClusters(duties, { maxPerCluster: 2, degreeById });
    expect(clusters.every((cluster) => cluster.nodes.length > 0)).toBe(true);
  });
});

describe('graphView: list rows and view model', () => {
  it('writes an accessible label for a node, including its derived status', () => {
    const node = {
      id: 'obl_1',
      entityType: ENTITY_TYPES.OBLIGATION,
      label: 'Pay invoices',
      evidenceCount: 2,
      provenance: 'derived',
    };
    const label = nodeAriaLabel(node, { degreeById: new Map([['obl_1', 3]]) }, {
      shownRelationshipCount: 1,
    });
    expect(label).toContain('Obligation: Pay invoices');
    expect(label).toContain('3 relationship(s)');
    expect(label).toContain('1 visible after filtering');
    expect(label).toContain('2 citations');
    expect(label).toContain('derived by this app');
    expect(nodeAriaLabel(null, {})).toBe('');
  });

  it('builds one text row per node with its relationships and citations', () => {
    const graph = fixtureGraph();
    const index = buildGraphIndex(graph);
    const rows = buildGraphListRows(graph.nodes, index);
    expect(rows).toHaveLength(graph.nodes.length);
    const paymentRow = rows.find((row) => row.id === 'cl_payment');
    expect(paymentRow.typeLabel).toBe('Clause');
    expect(paymentRow.relationships.length).toBeGreaterThan(0);
    expect(paymentRow.ariaLabel).toContain('Clause:');
    expect(paymentRow.actionIds).toContain('evidence');
  });

  it('filters list rows by the text a reader sees', () => {
    const graph = fixtureGraph();
    const index = buildGraphIndex(graph);
    const hits = buildGraphListRows(graph.nodes, index, { searchText: 'invoice' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((row) => row.searchText.includes('invoice'))).toBe(true);
  });

  it('answers every question the page asks in one pass', () => {
    const graph = fixtureGraph();
    const view = buildGraphViewModel(graph);
    expect(view.empty).toBe(false);
    expect(view.counts.nodes).toBe(graph.nodes.length);
    expect(view.counts.visibleNodes).toBeGreaterThan(0);
    expect(view.clusters.length).toBeGreaterThan(0);
    expect(view.listRows).toHaveLength(view.counts.visibleNodes);
    expect(view.legend.map((entry) => entry.id)).toEqual([...GRAPH_GROUP_IDS]);
    expect(summarizeGraphViewModel(view).nodeCount).toBe(graph.nodes.length);
  });

  it('tracks the selection, the dimming set and the search', () => {
    const graph = fixtureGraph();
    const focused = buildGraphViewModel(graph, { focusNodeId: 'cl_payment', depth: 2 });
    expect(focused.focus.nodeId).toBe('cl_payment');
    expect(focused.focus.node).not.toBeNull();
    expect(focused.focus.nodeIds.has('cl_payment')).toBe(true);
    expect(focused.focus.dimmedCount).toBe(
      focused.counts.visibleNodes - focused.focus.nodeIds.size,
    );

    const searched = buildGraphViewModel(graph, { searchText: 'acme' });
    expect(searched.counts.nodes).toBe(graph.nodes.length);
    expect(searched.listRows.every((row) => row.searchText.includes('acme'))).toBe(true);

    const noGroups = buildGraphViewModel(graph, { activeGroupIds: [] });
    expect(noGroups.counts.nodes).toBe(0);
    expect(noGroups.empty).toBe(true);
  });
});

describe('graphView: findings as nodes', () => {
  it('adds risk signals and inconsistencies, with a dashed edge to their clause', () => {
    const graph = fixtureGraph();
    const augmented = augmentGraphWithFindings(graph, {
      signals: [
        {
          id: 'risk_no_deadline',
          title: 'Obligation without a deadline',
          severity: 'high',
          clauseId: 'cl_payment',
          evidence: [],
        },
        {
          id: 'risk_unsourced',
          title: 'Signal on a clause that is not a node',
          severity: 'low',
          clauseId: 'cl_missing',
          evidence: [],
        },
      ],
      inconsistencies: [
        { id: 'inc_dates', title: 'Dates disagree', severity: 'medium', clauseIds: ['cl_term'] },
      ],
    });

    const riskNode = augmented.nodes.find((node) => node.id === 'risk_no_deadline');
    expect(riskNode.entityType).toBe(ENTITY_TYPES.RISK);
    expect(riskNode.derived).toBe(true);
    expect(riskNode.severity).toBe('high');

    const orphanRisk = augmented.nodes.find((node) => node.id === 'risk_unsourced');
    expect(orphanRisk).toBeDefined();
    expect(augmented.relationships.some((entry) => entry.id === 'rel_risk_unsourced_about')).toBe(
      false,
    );

    const riskEdge = augmented.relationships.find(
      (entry) => entry.id === 'rel_risk_no_deadline_about',
    );
    expect(riskEdge.toId).toBe('cl_payment');
    expect(riskEdge.provenance).toBe('derived');

    const inconsistency = augmented.nodes.find((node) => node.id === 'inc_dates');
    expect(inconsistency.entityType).toBe(ENTITY_TYPES.INCONSISTENCY);
    expect(augmented.relationships.some((entry) => entry.id === 'rel_inc_dates_cl_term')).toBe(true);

    expect(augmentGraphWithFindings(null, { signals: [] })).toBeNull();
  });
});

describe('graphView: focused progressive view', () => {
  it('selects a useful default focus node from obligations', () => {
    const graph = fixtureGraph();
    const defaultFocusId = findDefaultFocusNodeId(graph);
    expect(defaultFocusId).toBeTruthy();
    const node = graph.nodes.find((n) => n.id === defaultFocusId);
    expect(node).toBeDefined();
  });

  it('suggests concise graph topics derived from the graph', () => {
    const graph = fixtureGraph();
    const topics = suggestGraphTopics(graph);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics[0]).toHaveProperty('id');
    expect(topics[0]).toHaveProperty('label');
  });

  it('builds a curated focused graph around a focus node with annotated findings', () => {
    const graph = augmentGraphWithFindings(fixtureGraph(), {
      signals: [
        {
          id: 'risk_1',
          title: 'Risk signal',
          severity: 'high',
          clauseId: 'cl_payment',
          evidence: [],
        },
      ],
    });
    const defaultFocusId = findDefaultFocusNodeId(graph);
    const view = buildFocusedGraphViewModel(graph, { focusNodeId: defaultFocusId, depth: 1 });

    expect(view.visibleGraph.nodes.length).toBeLessThan(graph.nodes.length);
    expect(view.focus.nodeId).toBe(defaultFocusId);
    // Standalone risk nodes should not clutter primary canvas
    const containsRiskNode = view.visibleGraph.nodes.some((n) => n.entityType === ENTITY_TYPES.RISK);
    expect(containsRiskNode).toBe(false);
  });
});
