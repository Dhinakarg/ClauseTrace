/**
 * Graph canvas geometry.
 *
 * Pure maths for the graph viewport and the typed layout:
 *  - a viewport transform (scale + translation) with zoom-at-a-point, panning and
 *    fit-to-view, so zooming never drifts away from the pointer;
 *  - a deterministic layout that draws one cluster per filter group in a column,
 *    wrapping long clusters, sizing nodes by how connected they are;
 *  - an edge plan that decides which edges get a visible label, so a dense graph
 *    stays readable instead of showing hundreds of overlapping labels.
 *
 * No React and no DOM: every function takes numbers and returns numbers.
 */

import { edgeSemantics, groupForEntityType, nodeTypeMeta } from './graphView.js';

export const CANVAS_DEFAULTS = Object.freeze({
  scale: 1,
  minScale: 0.4,
  maxScale: 2.5,
  nodeWidth: 168,
  nodeHeight: 34,
  nodeGapY: 12,
  columnPadding: 16,
  clusterGapY: 28,
  clusterHeaderHeight: 24,
  clusterWidth: 216,
  wrapAfter: 12,
  marginX: 32,
  marginY: 32,
  labelBudget: 28,
});

/** Clamps a zoom scale into the allowed range. */
export function clampScale(scale, { min = CANVAS_DEFAULTS.minScale, max = CANVAS_DEFAULTS.maxScale } = {}) {
  const value = Number(scale);
  if (!Number.isFinite(value)) return CANVAS_DEFAULTS.scale;
  if (value < min) return min;
  if (value > max) return max;
  return Number(value.toFixed(4));
}

/** Identity viewport. */
export function initialViewport() {
  return { scale: CANVAS_DEFAULTS.scale, x: 0, y: 0 };
}

/** Pans by a screen-space delta. */
export function panBy(viewport, dx, dy) {
  const current = viewport ?? initialViewport();
  const moveX = Number(dx);
  const moveY = Number(dy);
  if (!Number.isFinite(moveX) || !Number.isFinite(moveY)) return { ...current };
  return { ...current, x: current.x + moveX, y: current.y + moveY };
}

/**
 * Zooms by a factor while keeping the world point under `point` (screen space)
 * fixed, which is what makes wheel zoom feel attached to the pointer.
 */
export function zoomAt(viewport, factor, point = { x: 0, y: 0 }, bounds = {}) {
  const current = viewport ?? initialViewport();
  const nextScale = clampScale(current.scale * factor, bounds);
  if (nextScale === current.scale) return { ...current, scale: nextScale };
  const anchorX = Number(point?.x) || 0;
  const anchorY = Number(point?.y) || 0;
  const worldX = (anchorX - current.x) / current.scale;
  const worldY = (anchorY - current.y) / current.scale;
  return {
    scale: nextScale,
    x: anchorX - worldX * nextScale,
    y: anchorY - worldY * nextScale,
  };
}

export function zoomIn(viewport, bounds = {}) {
  return zoomAt(viewport, 1.2, { x: 0, y: 0 }, bounds);
}

export function zoomOut(viewport, bounds = {}) {
  return zoomAt(viewport, 1 / 1.2, { x: 0, y: 0 }, bounds);
}

/** Converts a point in world coordinates to screen coordinates. */
export function worldToScreen(point, viewport) {
  const view = viewport ?? initialViewport();
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
}

/** Converts a screen point back to world coordinates. */
export function screenToWorld(point, viewport) {
  const view = viewport ?? initialViewport();
  if (!view.scale) return { x: 0, y: 0 };
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

/** Bounding box of positioned nodes. */
export function boundingBox(nodes) {
  if (!nodes?.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Scale and translation that fit the world bounds into the viewport box. */
export function fitToViewport(
  worldBounds,
  viewportSize,
  { padding = CANVAS_DEFAULTS.marginX, minScale = CANVAS_DEFAULTS.minScale, maxScale = CANVAS_DEFAULTS.maxScale } = {},
) {
  const width = Math.max(1, Number(worldBounds?.width) || 0);
  const height = Math.max(1, Number(worldBounds?.height) || 0);
  const viewWidth = Math.max(1, Number(viewportSize?.width) || 0);
  const viewHeight = Math.max(1, Number(viewportSize?.height) || 0);
  const scale = clampScale(Math.min((viewWidth - padding * 2) / width, (viewHeight - padding * 2) / height), {
    min: minScale,
    max: maxScale,
  });
  const centreX = (worldBounds?.minX ?? 0) + width / 2;
  const centreY = (worldBounds?.minY ?? 0) + height / 2;
  return {
    scale,
    x: viewWidth / 2 - centreX * scale,
    y: viewHeight / 2 - centreY * scale,
  };
}

/** Viewport that shows a specific node with some surrounding context. */
export function centreOnNode(node, viewportSize, { scale = CANVAS_DEFAULTS.scale } = {}) {
  if (!node) return initialViewport();
  const nextScale = clampScale(scale);
  return {
    scale: nextScale,
    x: (Number(viewportSize?.width) || 0) / 2 - (node.x + node.width / 2) * nextScale,
    y: (Number(viewportSize?.height) || 0) / 2 - (node.y + node.height / 2) * nextScale,
  };
}

/* -------------------------------------------------------------------------- */
/* Typed layout                                                               */
/* -------------------------------------------------------------------------- */

function nodeSizeFor(node, degreeById, defaults) {
  const degree = degreeById?.get(node.id) ?? 0;
  return { width: defaults.nodeWidth + Math.min(4, degree) * 6, height: defaults.nodeHeight };
}

/**
 * Lays the clustered graph out in columns, one cluster per filter group, in the
 * order the groups are declared. Long clusters wrap into a second sub-column so
 * a single huge group cannot make the canvas impossibly tall.
 *
 * Returns { width, height, nodes, edges, clusters, bounds, empty }.
 */
export function layoutTypedGraph(view, options = {}) {
  const defaults = { ...CANVAS_DEFAULTS, ...options };
  const clusters = view?.clusters ?? [];
  const degreeById = view?.visibleIndex?.degreeById ?? view?.index?.degreeById ?? new Map();
  const nodes = [];
  const placedClusters = [];
  let columnIndex = 0;

  for (const cluster of clusters) {
    const subColumns = Math.max(1, Math.ceil(cluster.nodes.length / defaults.wrapAfter));
    const startX = defaults.marginX + columnIndex * (defaults.clusterWidth + defaults.columnPadding);
    let y = defaults.marginY + defaults.clusterHeaderHeight;
    const placed = [];

    cluster.nodes.forEach((node, index) => {
      const subColumn = Math.floor(index / defaults.wrapAfter);
      const row = index % defaults.wrapAfter;
      const size = nodeSizeFor(node, degreeById, defaults);
      const positioned = {
        ...node,
        x: startX + subColumn * defaults.clusterWidth + (defaults.clusterWidth - size.width) / 2,
        y: y + row * (size.height + defaults.nodeGapY),
        width: size.width,
        height: size.height,
        meta: nodeTypeMeta(node.entityType),
        degree: degreeById.get(node.id) ?? 0,
      };
      placed.push(positioned);
      nodes.push(positioned);
    });

    const rows = Math.min(defaults.wrapAfter, Math.max(1, cluster.nodes.length));
    placedClusters.push({
      id: cluster.id,
      label: cluster.label,
      description: cluster.description,
      x: startX - defaults.columnPadding / 2,
      y: defaults.marginY,
      width: defaults.clusterWidth * subColumns + defaults.columnPadding,
      height: defaults.clusterHeaderHeight + rows * (defaults.nodeHeight + defaults.nodeGapY),
      count: cluster.total,
      visibleCount: cluster.nodes.length,
      hiddenCount: cluster.hiddenCount,
      collapsed: cluster.collapsed,
    });
    columnIndex += subColumns;
  }

  const positionById = new Map(nodes.map((node) => [node.id, node]));
  const edges = [];
  for (const relationship of view?.visibleGraph?.relationships ?? []) {
    const from = positionById.get(relationship.fromId);
    const to = positionById.get(relationship.toId);
    if (!from || !to) continue;
    edges.push({
      ...relationship,
      semantics: edgeSemantics(relationship.type),
      path: edgePath(from, to),
      labelX: (from.x + from.width + to.x) / 2,
      labelY: (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 6,
    });
  }

  const bounds = boundingBox(nodes);
  return {
    width: Math.max(defaults.marginX * 2 + defaults.clusterWidth, bounds.maxX + defaults.marginX),
    height: Math.max(
      defaults.marginY * 2 + defaults.clusterHeaderHeight,
      bounds.maxY + defaults.marginY,
    ),
    bounds,
    nodes,
    edges,
    clusters: placedClusters,
    empty: nodes.length === 0,
  };
}

/** Cubic bezier between two node boxes, drawn left-to-right or right-to-left. */
export function edgePath(from, to, { curve = 0.4 } = {}) {
  if (!from || !to) return '';
  const forward = to.x >= from.x;
  const startX = forward ? from.x + from.width : from.x;
  const endX = forward ? to.x : to.x + to.width;
  const startY = from.y + from.height / 2;
  const endY = to.y + to.height / 2;
  const controlX = startX + Math.abs(endX - startX) * curve * (forward ? 1 : -1);
  return `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`;
}

/** Nearest node in a direction, for keyboard navigation with the arrow keys. */
export function nearestNodeInDirection(nodes, currentNodeId, direction, { step = 20 } = {}) {
  const current = (nodes ?? []).find((node) => node.id === currentNodeId);
  if (!current) return (nodes ?? [])[0] ?? null;
  const centre = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
  return (
    (nodes ?? [])
      .filter((node) => node.id !== current.id)
      .map((node) => {
        const other = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
        return { node, dx: other.x - centre.x, dy: other.y - centre.y };
      })
      .filter((entry) => {
        if (direction === 'left') return entry.dx < -step / 2;
        if (direction === 'right') return entry.dx > step / 2;
        if (direction === 'up') return entry.dy < -step / 2;
        if (direction === 'down') return entry.dy > step / 2;
        return false;
      })
      .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy))[0]?.node ?? null
  );
}

/**
 * Decides which edges show a text label. When more edges than the label budget
 * are on screen, only the edges touching the selection keep their labels; the
 * others stay as lines and remain readable in the detail panel and list view.
 */
export function planEdgeRendering(edges, { focusNodeId = null, labelBudget = CANVAS_DEFAULTS.labelBudget } = {}) {
  const all = edges ?? [];
  const crowded = all.length > labelBudget;
  const planned = all.map((edge) => {
    const touchesFocus = Boolean(
      focusNodeId && (edge.fromId === focusNodeId || edge.toId === focusNodeId),
    );
    return {
      ...edge,
      touchesFocus,
      showLabel: crowded ? touchesFocus : true,
      emphasis: touchesFocus ? 'focus' : focusNodeId ? 'dimmed' : 'normal',
    };
  });
  return {
    edges: planned,
    crowded,
    labelBudget,
    labelledCount: planned.filter((edge) => edge.showLabel).length,
    unlabelledCount: planned.filter((edge) => !edge.showLabel).length,
    categoryCounts: planned.reduce((counts, edge) => {
      const key = edge.semantics?.category ?? 'reference';
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

/** Human-readable zoom percentage for the toolbar. */
export function formatScale(scale) {
  return `${Math.round(clampScale(scale) * 100)}%`;
}

/** Which filter group a node type belongs to, re-exported for convenience. */
export { groupForEntityType };
