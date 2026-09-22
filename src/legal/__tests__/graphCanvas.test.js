import { describe, expect, it } from 'vitest';
import {
  CANVAS_DEFAULTS,
  boundingBox,
  centreOnNode,
  clampScale,
  edgePath,
  fitToViewport,
  formatScale,
  initialViewport,
  layoutTypedGraph,
  nearestNodeInDirection,
  panBy,
  planEdgeRendering,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../graphCanvas.js';
import { buildGraph } from '../graphEngine.js';
import { withDerivedRelationships } from '../relationships.js';
import { buildGraphViewModel } from '../graphView.js';
import { buildValidModel } from './fixtures.js';

const VIEWPORT = { width: 960, height: 520 };

/** The fixture agreement laid out the way the graph page draws it. */
function fixtureView() {
  const model = withDerivedRelationships(buildValidModel()).model;
  return buildGraphViewModel(buildGraph(model));
}

describe('graphCanvas: viewport maths', () => {
  it('clamps the zoom scale and reports it as a percentage', () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(0.01)).toBe(CANVAS_DEFAULTS.minScale);
    expect(clampScale(99)).toBe(CANVAS_DEFAULTS.maxScale);
    expect(clampScale('nonsense')).toBe(CANVAS_DEFAULTS.scale);
    expect(formatScale(1.5)).toBe('150%');
  });

  it('pans by a screen-space delta and ignores junk', () => {
    expect(panBy(initialViewport(), 10, -5)).toEqual({ scale: 1, x: 10, y: -5 });
    expect(panBy({ scale: 2, x: 4, y: 4 }, Number.NaN, 0)).toEqual({ scale: 2, x: 4, y: 4 });
    expect(panBy(null, 1, 1)).toEqual({ scale: 1, x: 1, y: 1 });
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const before = { scale: 1, x: 30, y: 20 };
    const anchor = { x: 240, y: 160 };
    const after = zoomAt(before, 1.5, anchor);
    expect(after.scale).toBe(1.5);
    const worldBefore = screenToWorld(anchor, before);
    const worldAfter = screenToWorld(anchor, after);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    expect(worldToScreen(worldBefore, after)).toMatchObject({ x: anchor.x, y: anchor.y });
  });

  it('does not move the view when the zoom is already at its limit', () => {
    const viewport = { scale: CANVAS_DEFAULTS.maxScale, x: 12, y: 8 };
    expect(zoomAt(viewport, 4, { x: 10, y: 10 })).toEqual({
      scale: CANVAS_DEFAULTS.maxScale,
      x: 12,
      y: 8,
    });
  });

  it('fits the world bounds inside the viewport', () => {
    const fitted = fitToViewport({ minX: 0, minY: 0, width: 400, height: 200 }, VIEWPORT, {
      minScale: 0.4,
      maxScale: 2.4,
    });
    expect(fitted.scale).toBeGreaterThan(0);
    expect(fitted.scale).toBeLessThanOrEqual(2.4);
    const centre = worldToScreen({ x: 200, y: 100 }, fitted);
    expect(centre.x).toBeCloseTo(VIEWPORT.width / 2, 4);
    expect(centre.y).toBeCloseTo(VIEWPORT.height / 2, 4);
  });

  it('centres a node, with a fallback for a missing one', () => {
    const node = { x: 100, y: 50, width: 20, height: 10 };
    const centred = centreOnNode(node, VIEWPORT, { scale: 2 });
    expect(worldToScreen({ x: 110, y: 55 }, centred)).toMatchObject({
      x: VIEWPORT.width / 2,
      y: VIEWPORT.height / 2,
    });
    expect(centreOnNode(null, VIEWPORT)).toEqual(initialViewport());
  });

  it('walks to the nearest node in a direction', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', x: 100, y: 0, width: 10, height: 10 },
      { id: 'c', x: 200, y: 0, width: 10, height: 10 },
      { id: 'd', x: 100, y: 200, width: 10, height: 10 },
    ];
    expect(nearestNodeInDirection(nodes, 'a', 'right').id).toBe('b');
    expect(nearestNodeInDirection(nodes, 'c', 'left').id).toBe('b');
    expect(nearestNodeInDirection(nodes, 'b', 'down').id).toBe('d');
    expect(nearestNodeInDirection(nodes, 'a', 'left')).toBeNull();
    expect(nearestNodeInDirection(nodes, 'missing', 'right').id).toBe('a');
  });

  it('measures the bounding box of positioned nodes', () => {
    expect(boundingBox([{ x: 5, y: 5, width: 10, height: 20 }])).toMatchObject({
      minX: 5,
      minY: 5,
      maxX: 15,
      maxY: 25,
      width: 10,
      height: 20,
    });
    expect(boundingBox([])).toMatchObject({ width: 0, height: 0 });
  });
});

describe('graphCanvas: typed layout', () => {
  it('lays the view model out into positioned, typed nodes and edges', () => {
    const view = fixtureView();
    const layout = layoutTypedGraph(view);
    expect(layout.empty).toBe(false);
    expect(layout.nodes).toHaveLength(view.counts.visibleNodes);
    expect(layout.clusters.length).toBeGreaterThan(0);
    const node = layout.nodes[0];
    expect(node.meta.shape).toBeTruthy();
    expect(node.width).toBeGreaterThanOrEqual(CANVAS_DEFAULTS.nodeWidth);
    expect(layout.edges.length).toBe(view.counts.visibleRelationships);
    expect(layout.edges[0].path).toContain('C');
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('lays out an empty view honestly', () => {
    const layout = layoutTypedGraph({ clusters: [] });
    expect(layout.empty).toBe(true);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
  });

  it('draws a bezier per edge, and handles a missing endpoint', () => {
    const from = { x: 0, y: 0, width: 10, height: 10 };
    const to = { x: 100, y: 40, width: 10, height: 10 };
    expect(edgePath(from, to)).toContain('C');
    expect(edgePath(to, from)).toContain('C');
    expect(edgePath(null, to)).toBe('');
  });
});

describe('graphCanvas: edge label budget', () => {
  const edges = Array.from({ length: 40 }, (_, index) => ({
    id: `rel_${index}`,
    fromId: `n_${index}`,
    toId: `n_${index + 1}`,
    semantics: { category: 'duties' },
  }));

  it('keeps every label when the graph is small', () => {
    const planned = planEdgeRendering(edges.slice(0, 5));
    expect(planned.crowded).toBe(false);
    expect(planned.labelledCount).toBe(5);
    expect(planned.unlabelledCount).toBe(0);
  });

  it('hides labels past the budget, keeping the ones that touch the selection', () => {
    const planned = planEdgeRendering(edges, { labelBudget: 10, focusNodeId: 'n_4' });
    expect(planned.crowded).toBe(true);
    expect(planned.labelledCount).toBe(2);
    expect(planned.unlabelledCount).toBe(38);
    const focused = planned.edges.filter((edge) => edge.touchesFocus);
    expect(focused.every((edge) => edge.showLabel && edge.emphasis === 'focus')).toBe(true);
    expect(planned.categoryCounts.duties).toBe(40);
  });
});
