import { describe, expect, it } from 'vitest';
import {
  GRAPH_EDGE_STATES,
  GRAPH_NODE_STATES,
  diffEdges,
  diffGraphs,
  diffNodeFields,
  diffNodes,
  edgeDisplay,
  edgeKey,
  emptyGraphDiff,
  nodeKey,
  summarizeGraphDiff,
} from '../graphDiff.js';
import { buildGraph, indexGraph } from '../graphEngine.js';
import { createClause, createRelationship, ENTITY_TYPES } from '../schema.js';
import { buildValidModel, TEST_DOCUMENT_ID } from './fixtures.js';

function clone(model) {
  return JSON.parse(JSON.stringify(model));
}

function versionB(mutate = null) {
  const model = clone(buildValidModel());
  if (mutate) mutate(model);
  return model;
}

describe('diffGraphs: identical versions', () => {
  const diff = diffGraphs(buildValidModel(), versionB());

  it('reports every node and edge as unchanged', () => {
    expect(diff.nodes.every((node) => node.state === GRAPH_NODE_STATES.UNCHANGED)).toBe(true);
    expect(diff.relationships.every((edge) => edge.state === GRAPH_EDGE_STATES.UNCHANGED)).toBe(true);
  });

  it('counts both sides of the diff', () => {
    expect(diff.stats.nodeCounts.added).toBe(0);
    expect(diff.stats.nodeCounts.removed).toBe(0);
    expect(diff.stats.nodeCounts.changed).toBe(0);
    expect(diff.stats.nodeCounts.unchanged).toBeGreaterThan(0);
    expect(diff.stats.relationshipCounts.unchanged).toBeGreaterThan(0);
  });

  it('lists each node once', () => {
    const ids = diff.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('diffGraphs: added and removed nodes', () => {
  const diff = diffGraphs(
    buildValidModel(),
    versionB((model) => {
      model.clauses.push(
        createClause({
          id: 'cl_audit',
          documentId: TEST_DOCUMENT_ID,
          number: '5.1',
          heading: 'AUDIT',
          text: '5.1 The Customer may audit once per year.',
          level: 2,
        }),
      );
    }),
  );

  it('reports a node that exists in version B only as added', () => {
    const added = diff.nodes.filter((node) => node.state === GRAPH_NODE_STATES.ADDED);
    expect(added).toHaveLength(1);
    expect(added[0].entityTypeLabel).toBe('Clause');
    expect(added[0].label).toMatch(/AUDIT/);
    expect(added[0].summary).toMatch(/version B and none in version A/i);
  });

  it('reports the mirrored case as removed', () => {
    const removed = diffGraphs(
      buildValidModel(),
      versionB((model) => {
        model.clauses = model.clauses.filter((clause) => clause.id !== 'cl_term');
      }),
    ).nodes.filter((node) => node.state === GRAPH_NODE_STATES.REMOVED);
    expect(removed).toHaveLength(1);
    expect(removed[0].entityTypeLabel).toBe('Clause');
  });
});

describe('diffGraphs: changed nodes and edges', () => {
  const diff = diffGraphs(
    buildValidModel(),
    versionB((model) => {
      model.obligations.find((entry) => entry.id === 'obl_payment').summary =
        'Pay undisputed invoices within 15 days.';
      model.relationships[0].toId = 'obl_confidentiality';
    }),
  );

  it('reports a re-worded record as a changed node with the field that moved', () => {
    const changed = diff.nodes.find((node) => node.nodeId === 'obl_payment');
    expect(changed).toBeTruthy();
    expect(changed.state).toBe(GRAPH_NODE_STATES.CHANGED);
    expect(changed.changedFields).toContain('label');
    expect(changed.summary).toMatch(/changed/i);
  });

  it('reports a re-pointed edge with both readings', () => {
    const edge = diff.relationships.find(
      (entry) => entry.state === GRAPH_EDGE_STATES.CHANGED && entry.changedFields.includes('to'),
    );
    expect(edge).toBeTruthy();
    expect(edge.beforeDisplay).toMatch(/PAYMENT/);
    expect(edge.afterDisplay).toMatch(/confidential/i);
    expect(edge.summary).toMatch(/re-pointed/i);
    expect(edge.clauseIds).toContain('cl_payment');
  });

  it('reports an edge that only exists in version B as added', () => {
    const result = diffGraphs(
      buildValidModel(),
      versionB((model) => {
        model.relationships.push(
          createRelationship({
            type: 'clause-imposes-obligation',
            fromId: 'cl_confidentiality',
            fromType: ENTITY_TYPES.CLAUSE,
            toId: 'obl_confidentiality',
            toType: ENTITY_TYPES.OBLIGATION,
            documentId: TEST_DOCUMENT_ID,
          }),
        );
      }),
    );

    const added = result.relationships.filter((entry) => entry.state === GRAPH_EDGE_STATES.ADDED);
    expect(added).toHaveLength(1);
    expect(added[0].summary).toMatch(/added in version B/i);
    expect(added[0].relationshipId).toBeTruthy();
  });

  it('never lists an edge as both added and removed for a re-pointed link', () => {
    expect(diff.relationships.filter((entry) => entry.state === GRAPH_EDGE_STATES.ADDED)).toHaveLength(0);
    expect(diff.relationships.filter((entry) => entry.state === GRAPH_EDGE_STATES.REMOVED)).toHaveLength(0);
  });
});

describe('graphDiff: helpers', () => {
  it('builds a stable natural key for nodes and edges', () => {
    const graph = buildGraph(buildValidModel());
    const clause = graph.nodes.find((node) => node.id === 'cl_payment');
    expect(nodeKey(clause)).toBe('clause|1 1 payment');
    expect(edgeKey(graph.relationships[0])).toBe('clause imposes obligation|cl_payment|obl_payment');
  });

  it('reads an edge back with its endpoint labels', () => {
    const graph = buildGraph(buildValidModel());
    const index = indexGraph(graph).nodesById;
    expect(edgeDisplay(graph.relationships[0], index)).toMatch(/PAYMENT/);
    expect(edgeDisplay(null, index)).toBe('not recorded');
  });

  it('compares node fields without flagging equal values', () => {
    const graph = buildGraph(buildValidModel());
    const clause = graph.nodes.find((node) => node.id === 'cl_payment');
    expect(diffNodeFields(clause, clause).every((field) => !field.changed)).toBe(true);
  });

  it('handles empty and malformed graphs without throwing', () => {
    expect(() => diffNodes(null, null)).not.toThrow();
    expect(() => diffEdges(undefined, undefined)).not.toThrow();
    expect(summarizeGraphDiff([], []).nodeCounts).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
      unchanged: 0,
      total: 0,
    });
    const empty = emptyGraphDiff();
    expect(empty.nodes).toEqual([]);
    expect(empty.relationships).toEqual([]);
  });

  it('produces the same diff run to run', () => {
    const first = diffGraphs(buildValidModel(), versionB());
    const second = diffGraphs(buildValidModel(), versionB());
    expect(second.nodes.map((node) => node.id)).toEqual(first.nodes.map((node) => node.id));
    expect(second.relationships.map((edge) => edge.id)).toEqual(
      first.relationships.map((edge) => edge.id),
    );
  });
});

