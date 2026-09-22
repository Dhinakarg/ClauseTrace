/**
 * Graph layout.
 *
 * Deterministic SVG layout with no external graph library. Nodes are grouped
 * into columns by entity type (document → clauses → facts → parties → findings),
 * which mirrors how a reader thinks about a contract and keeps the picture
 * stable between renders.
 */

import { ENTITY_TYPES } from './schema.js';

/** Column order and labels, left to right. */
export const LAYOUT_COLUMNS = Object.freeze([
  { entityType: ENTITY_TYPES.DOCUMENT, label: 'Document' },
  { entityType: ENTITY_TYPES.CLAUSE, label: 'Clauses' },
  { entityType: ENTITY_TYPES.DEFINITION, label: 'Definitions' },
  { entityType: ENTITY_TYPES.PARTY, label: 'Parties' },
  { entityType: ENTITY_TYPES.OBLIGATION, label: 'Obligations' },
  { entityType: ENTITY_TYPES.RIGHT, label: 'Rights' },
  { entityType: ENTITY_TYPES.CONDITION, label: 'Conditions' },
  { entityType: ENTITY_TYPES.DEADLINE, label: 'Deadlines' },
  { entityType: ENTITY_TYPES.CONSEQUENCE, label: 'Consequences' },
  { entityType: ENTITY_TYPES.RISK, label: 'Risks' },
  { entityType: ENTITY_TYPES.INCONSISTENCY, label: 'Inconsistencies' },
]);

const COLUMN_WIDTH = 190;
const NODE_WIDTH = 160;
const NODE_HEIGHT = 34;
const NODE_GAP = 12;
const TOP_MARGIN = 46;
const SIDE_MARGIN = 24;

/** Truncates a node label for display inside a fixed-width node box. */
function clipLabel(label, maxLength = 24) {
  const value = String(label ?? '').replace(/\s+/g, ' ').trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

/**
 * Positions nodes and computes edge geometry.
 * Returns { width, height, columns, nodes, edges, empty }.
 */
export function layoutGraph(graph, { maxNodesPerColumn = 40 } = {}) {
  const nodesByType = new Map();
  for (const node of graph?.nodes ?? []) {
    const list = nodesByType.get(node.entityType) ?? [];
    list.push(node);
    nodesByType.set(node.entityType, list);
  }

  const columns = [];
  const placed = [];
  const positionById = new Map();

  LAYOUT_COLUMNS.forEach((column, columnIndex) => {
    const all = nodesByType.get(column.entityType) ?? [];
    if (all.length === 0) return;
    const visible = all.slice(0, maxNodesPerColumn);
    const x = SIDE_MARGIN + columnIndex * COLUMN_WIDTH;
    columns.push({ ...column, x, count: all.length, hiddenCount: all.length - visible.length });
    visible.forEach((node, index) => {
      const y = TOP_MARGIN + index * (NODE_HEIGHT + NODE_GAP);
      const positioned = {
        ...node,
        x,
        y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        label: clipLabel(node.label),
      };
      placed.push(positioned);
      positionById.set(node.id, positioned);
    });
  });

  const columnCount = columns.length || 1;
  const rows = Math.max(1, ...columns.map((column) => (nodesByType.get(column.entityType) ?? []).length));
  const width = SIDE_MARGIN * 2 + columnCount * COLUMN_WIDTH;
  const height = TOP_MARGIN + rows * (NODE_HEIGHT + NODE_GAP) + 24;

  const edges = (graph?.relationships ?? [])
    .map((relationship) => {
      const from = positionById.get(relationship.fromId);
      const to = positionById.get(relationship.toId);
      if (!from || !to) return null;
      const startX = from.x + from.width;
      const startY = from.y + from.height / 2;
      const endX = to.x;
      const endY = to.y + to.height / 2;
      const direction = endX >= startX ? 1 : -1;
      const midX = startX + ((endX - startX) / 2) * direction;
      return {
        ...relationship,
        path: `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`,
        labelX: (startX + endX) / 2,
        labelY: (startY + endY) / 2 - 4,
        startX,
        startY,
        endX,
        endY,
      };
    })
    .filter(Boolean);

  return {
    width,
    height,
    columns,
    nodes: placed,
    edges,
    empty: placed.length === 0,
    hiddenNodeCount: placed.length === 0 ? 0 : (graph?.nodes?.length ?? 0) - placed.length,
  };
}

/** Node colour tokens by entity type, kept subtle and consistent with badges. */
export const NODE_TONES = Object.freeze({
  [ENTITY_TYPES.DOCUMENT]: { fill: '#ffffff', stroke: '#2f4d75', text: '#1a2a3e' },
  [ENTITY_TYPES.CLAUSE]: { fill: '#f7f7f8', stroke: '#bcbfc4', text: '#2c2f34' },
  [ENTITY_TYPES.DEFINITION]: { fill: '#f2f5f9', stroke: '#9fb3cc', text: '#273f5e' },
  [ENTITY_TYPES.PARTY]: { fill: '#e3e9f2', stroke: '#3f6191', text: '#1a2a3e' },
  [ENTITY_TYPES.OBLIGATION]: { fill: '#e0eee4', stroke: '#3f6f4f', text: '#2c4f38' },
  [ENTITY_TYPES.RIGHT]: { fill: '#f2f7f3', stroke: '#3f6f4f', text: '#2c4f38' },
  [ENTITY_TYPES.CONDITION]: { fill: '#faedd5', stroke: '#b8801f', text: '#7f5713' },
  [ENTITY_TYPES.DEADLINE]: { fill: '#fdf7ec', stroke: '#b8801f', text: '#7f5713' },
  [ENTITY_TYPES.CONSEQUENCE]: { fill: '#f6e3e1', stroke: '#9d3b32', text: '#71271f' },
  [ENTITY_TYPES.RISK]: { fill: '#fbf3f2', stroke: '#9d3b32', text: '#71271f' },
  [ENTITY_TYPES.INCONSISTENCY]: { fill: '#f6e3e1', stroke: '#9d3b32', text: '#71271f' },
});

export function nodeTone(entityType) {
  return NODE_TONES[entityType] ?? { fill: '#ffffff', stroke: '#bcbfc4', text: '#2c2f34' };
}
