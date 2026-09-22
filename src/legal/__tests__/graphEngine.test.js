import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  computeGraphStats,
  createGraphNode,
  emptyGraph,
  entityTypeLabel,
  filterByEntityType,
  findBrokenRelationships,
  findCycles,
  findOrphanNodes,
  findRelatedNodes,
  getConnectedEntities,
  getNode,
  getNodesByType,
  getOutgoingRelationships,
  getSubgraph,
  indexGraph,
  relationshipTypeLabel,
  shortestPath,
  traverseRelationships,
} from '../graphEngine.js';
import {
  deriveRelationships,
  validateRelationshipDrafts,
  withDerivedRelationships,
} from '../relationships.js';
import { ENTITY_TYPES, createRelationship } from '../schema.js';
import { buildValidModel } from './fixtures.js';

describe('graphEngine: construction', () => {
  it('creates a node carrying trust metadata', () => {
    const node = createGraphNode(
      { id: 'obl_1', summary: 'Pay bills', evidence: [{ id: 'e', verified: true }] },
      { entityType: ENTITY_TYPES.OBLIGATION },
    );
    expect(node.label).toBe('Pay bills');
    expect(node.verified).toBe(true);
    expect(node.evidenceCount).toBe(1);
    expect(createGraphNode(null)).toBeNull();
  });

  it('builds a graph with one node per entity except relationships', () => {
    const model = buildValidModel();
    const graph = buildGraph(model);
    const expectedNodes =
      model.parties.length +
      model.clauses.length +
      model.definitions.length +
      model.rights.length +
      model.obligations.length +
      model.conditions.length +
      model.deadlines.length +
      model.consequences.length +
      model.risks.length +
      model.inconsistencies.length +
      model.documents.length;
    expect(graph.nodes).toHaveLength(expectedNodes);
    expect(graph.relationships).toHaveLength(1);
    expect(graph.documentId).toBe(model.documentId);
    expect(graph.generatedAt).toBeTruthy();
  });

  it('drops relationships whose endpoints are missing and records them', () => {
    const model = buildValidModel();
    const graph = buildGraph({
      ...model,
      relationships: [
        ...model.relationships,
        createRelationship({
          type: 'clause-imposes-obligation',
          fromId: 'cl_payment',
          fromType: ENTITY_TYPES.CLAUSE,
          toId: 'obl_missing',
          toType: ENTITY_TYPES.OBLIGATION,
        }),
      ],
    });
    expect(graph.relationships).toHaveLength(1);
    expect(graph.stats.brokenRelationshipIds.length).toBe(1);
  });

  it('can restrict the node types it includes', () => {
    const graph = buildGraph(buildValidModel(), {
      includeTypes: [ENTITY_TYPES.OBLIGATION, ENTITY_TYPES.CLAUSE],
    });
    expect(graph.nodes.every((node) => ['obligation', 'clause'].includes(node.entityType))).toBe(true);
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    expect(
      graph.relationships.every(
        (relationship) => nodeIds.has(relationship.fromId) && nodeIds.has(relationship.toId),
      ),
    ).toBe(true);
  });

  it('handles empty input', () => {
    expect(buildGraph(null).nodes).toEqual([]);
    expect(emptyGraph('doc').stats.nodeCount).toBe(0);
  });
});

describe('graphEngine: traversal', () => {
  const graph = buildGraph(buildValidModel());

  it('indexes adjacency', () => {
    const index = indexGraph(graph);
    expect(index.nodesById.size).toBe(graph.nodes.length);
    expect(index.outgoing.get('cl_payment')).toHaveLength(1);
    expect(index.incoming.get('obl_payment')).toHaveLength(1);
  });

  it('finds neighbours in either direction', () => {
    const outgoing = findRelatedNodes(graph, 'cl_payment', { direction: 'out' });
    expect(outgoing.map((entry) => entry.node.id)).toContain('obl_payment');

    const incoming = findRelatedNodes(graph, 'obl_payment', { direction: 'in' });
    expect(incoming.map((entry) => entry.node.id)).toContain('cl_payment');
  });

  it('filters neighbours by relationship type and entity type', () => {
    expect(
      findRelatedNodes(graph, 'cl_payment', { relationshipTypes: ['clause-references'] }),
    ).toHaveLength(0);
    expect(findRelatedNodes(graph, 'cl_payment', { entityTypes: [ENTITY_TYPES.CLAUSE] })).toHaveLength(0);
  });

  it('deduplicates connected entities', () => {
    const connected = getConnectedEntities(graph, 'obl_payment');
    expect(connected.map((node) => node.id)).toEqual(['cl_payment']);
  });

  it('traverses breadth-first with a depth cap and cycle safety', () => {
    const result = traverseRelationships(graph, 'cl_payment', { depth: 2, direction: 'both' });
    const ids = result.visits.map((visit) => visit.node.id);
    expect(ids).toContain('obl_payment');
    expect(result.visits.every((visit) => visit.depth <= 2)).toBe(true);
    expect(result.relationships.length).toBeGreaterThan(0);
  });

  it('returns an empty traversal for an unknown node', () => {
    expect(traverseRelationships(graph, 'nope').visits).toEqual([]);
  });

  it('finds the shortest path between two nodes', () => {
    const path = shortestPath(graph, 'obl_payment', 'cl_payment');
    expect(path.nodeIds).toEqual(['obl_payment', 'cl_payment']);
    expect(path.length).toBe(1);
    expect(shortestPath(graph, 'obl_payment', 'nope')).toBeNull();
    expect(shortestPath(graph, 'cl_payment', 'cl_payment').length).toBe(0);
  });

  it('extracts a subgraph, optionally with neighbours', () => {
    const sub = getSubgraph(graph, ['obl_payment']);
    expect(sub.nodes).toHaveLength(1);
    expect(sub.relationships).toHaveLength(0);
    const wider = getSubgraph(graph, ['obl_payment'], { includeNeighbours: true });
    expect(wider.nodes.length).toBeGreaterThan(1);
    expect(wider.relationships).toHaveLength(1);
  });
});

describe('graphEngine: integrity and stats', () => {
  it('reports orphan nodes', () => {
    const graph = buildGraph(buildValidModel());
    const orphans = findOrphanNodes(graph);
    expect(orphans.map((node) => node.id)).toContain('party_supplier');
    expect(orphans.map((node) => node.id)).not.toContain('obl_payment');
  });

  it('finds relationships with missing endpoints', () => {
    const graph = {
      nodes: [{ id: 'a' }],
      relationships: [{ id: 'r', fromId: 'a', toId: 'b' }],
    };
    expect(findBrokenRelationships(graph)).toHaveLength(1);
  });

  it('detects cycles', () => {
    const graph = {
      nodes: [{ id: 'a' }, { id: 'b' }],
      relationships: [
        { id: 'r1', fromId: 'a', toId: 'b' },
        { id: 'r2', fromId: 'b', toId: 'a' },
      ],
    };
    const cycles = findCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0].length).toBeGreaterThan(1);
  });

  it('counts nodes, edges and degree', () => {
    const stats = computeGraphStats(buildGraph(buildValidModel()));
    expect(stats.nodeCount).toBeGreaterThan(0);
    expect(stats.byEntityType[ENTITY_TYPES.OBLIGATION]).toBe(2);
    expect(stats.byRelationshipType['clause-imposes-obligation']).toBe(1);
    expect(stats.averageDegree).toBeGreaterThan(0);
  });

  it('provides readable labels', () => {
    expect(entityTypeLabel(ENTITY_TYPES.OBLIGATION)).toBe('Obligation');
    expect(entityTypeLabel('mystery')).toBe('Entity');
    expect(relationshipTypeLabel('obligation-has-deadline')).toBe('has deadline');
    expect(relationshipTypeLabel('some-new-edge')).toBe('some new edge');
  });
});

describe('relationships: AI proposals', () => {
  it('accepts a valid proposal and sets endpoint types from the model', () => {
    const model = buildValidModel();
    const { relationships, rejected } = validateRelationshipDrafts(
      [{ type: 'document-has-party', from: model.documentId, to: 'party_customer' }],
      model,
    );
    expect(rejected).toHaveLength(0);
    expect(relationships[0].fromType).toBe(ENTITY_TYPES.DOCUMENT);
    expect(relationships[0].toType).toBe(ENTITY_TYPES.PARTY);
  });

  it('rejects unknown types, unknown endpoints, bad pairings and duplicates', () => {
    const model = buildValidModel();
    const { relationships, rejected } = validateRelationshipDrafts(
      [
        { type: 'nonsense', from: model.documentId, to: 'party_customer' },
        { type: 'document-has-party', from: model.documentId, to: 'party_missing' },
        { type: 'document-has-party', from: 'party_customer', to: 'party_supplier' },
        { type: 'clause-imposes-obligation', from: 'cl_payment', to: 'obl_payment' },
      ],
      model,
    );
    expect(relationships).toHaveLength(0);
    expect(rejected).toHaveLength(4);
    expect(rejected.map((entry) => entry.reason).join(' ')).toMatch(/Unknown relationship type|Unknown endpoint|Duplicate/);
  });
});

describe('relationships: deterministic derivation', () => {
  it('derives the edges implied by validated fields', () => {
    const model = buildValidModel();
    const derived = deriveRelationships(model);
    const types = derived.map((entry) => entry.type);
    expect(types).toContain('clause-imposes-obligation');
    expect(types).toContain('party-obligated-by');
    expect(types).toContain('obligation-owed-to');
    expect(types).toContain('obligation-has-deadline');
    expect(types).toContain('deadline-anchored-to');
    expect(types).toContain('condition-has-deadline');
    expect(types).toContain('document-has-clause');
    expect(types).toContain('clause-flags-risk');
    expect(derived.every((entry) => entry.provenance === 'derived')).toBe(true);
  });

  it('does not duplicate edges that already exist', () => {
    const model = buildValidModel();
    const { model: merged, derived } = withDerivedRelationships(model);
    const signature = (entry) => `${entry.type}:${entry.fromId}->${entry.toId}`;
    const signatures = merged.relationships.map(signature);
    expect(new Set(signatures).size).toBe(signatures.length);
    expect(derived.every((entry) => !model.relationships.some((existing) => signature(existing) === signature(entry)))).toBe(true);
  });

  it('leaves nodes with nothing to connect alone', () => {
    const model = buildValidModel();
    const graph = buildGraph(withDerivedRelationships(model).model);
    expect(getNodesByType(graph, ENTITY_TYPES.DEADLINE).length).toBe(2);
    expect(filterByEntityType(graph, ENTITY_TYPES.DEADLINE).length).toBe(2);
    expect(getNode(graph, 'dl_term_end')).not.toBeNull();
    expect(getOutgoingRelationships(graph, 'obl_payment').length).toBeGreaterThan(0);
  });
});
