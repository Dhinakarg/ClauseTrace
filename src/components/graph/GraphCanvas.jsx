/**
 * GraphCanvas — the interactive picture.
 *
 * Plain SVG drawn from the deterministic layout in `graphCanvas.js`. It supports
 * zoom (buttons, wheel and keyboard), panning by dragging, fit and reset, single
 * selection with relationship highlighting, and keyboard navigation between
 * nodes. Typed nodes are drawn with a shape *and* an accessible label, so meaning
 * never depends on colour alone. The list view carries the same information as
 * text for screen readers and keyboard users.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button.jsx';
import { nodeTone } from '../../legal/graphLayout.js';
import {
  CANVAS_DEFAULTS,
  centreOnNode,
  fitToViewport,
  formatScale,
  initialViewport,
  nearestNodeInDirection,
  panBy,
  planEdgeRendering,
  zoomAt,
} from '../../legal/graphCanvas.js';

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.4;

/** Truncates a label to fit the node box. */
function clip(label, maxLength) {
  const value = String(label ?? '').replace(/\s+/g, ' ').trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

/** Polygon points for the non-rectangular node shapes. */
function shapePoints(shape, node) {
  const { x, y, width, height } = node;
  const centreY = y + height / 2;
  const points = {
    diamond: [
      [x + width / 2, y],
      [x + width, centreY],
      [x + width / 2, y + height],
      [x, centreY],
    ],
    hexagon: [
      [x + 12, y],
      [x + width - 12, y],
      [x + width, centreY],
      [x + width - 12, y + height],
      [x + 12, y + height],
      [x, centreY],
    ],
    triangle: [
      [x + width / 2, y],
      [x + width, y + height],
      [x, y + height],
    ],
    document: [
      [x, y],
      [x + width - 16, y],
      [x + width, y + 16],
      [x + width, y + height],
      [x, y + height],
    ],
  };
  return (points[shape] ?? []).map(([px, py]) => `${px},${py}`).join(' ');
}

function NodeShape({ node, tone, dimmed, selected }) {
  const shape = node.meta?.shape ?? 'rect';
  const common = {
    fill: tone.fill,
    stroke: tone.stroke,
    strokeWidth: selected ? 2.5 : 1.4,
    opacity: dimmed ? 0.35 : 1,
  };
  if (shape === 'circle') {
    return (
      <circle
        cx={node.x + node.width / 2}
        cy={node.y + node.height / 2}
        r={Math.min(node.width / 2, node.height / 2 + 5)}
        {...common}
      />
    );
  }
  if (shape === 'rect') {
    return <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={5} {...common} />;
  }
  return <polygon points={shapePoints(shape, node)} {...common} />;
}

export function GraphCanvas({ view, layout, focusNodeId = null, onSelectNode, onClearSelection }) {
  const wrapperRef = useRef(null);
  const dragRef = useRef(null);
  const [viewport, setViewport] = useState(() => initialViewport());
  const [viewportSize, setViewportSize] = useState({ width: 960, height: 520 });
  const [keyboardNodeId, setKeyboardNodeId] = useState(null);

  const nodes = layout?.nodes ?? [];
  const planned = useMemo(
    () =>
      planEdgeRendering(layout?.edges ?? [], {
        focusNodeId,
        labelBudget: CANVAS_DEFAULTS.labelBudget,
      }),
    [layout, focusNodeId],
  );
  const highlighted = view?.focus?.nodeIds ?? new Set();

  const fit = useCallback(() => {
    if (!layout || layout.empty) return;
    setViewport(fitToViewport(layout.bounds, viewportSize, { minScale: MIN_SCALE, maxScale: MAX_SCALE }));
  }, [layout, viewportSize]);

  // Re-fit whenever the drawing changes shape, so a filter change cannot leave
  // the reader staring at empty space.
  useEffect(() => {
    fit();
  }, [fit, layout?.width, layout?.height, layout?.nodes?.length]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewportSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setViewport((current) => zoomAt(current, factor, point, { min: MIN_SCALE, max: MAX_SCALE }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      onClearSelection?.();
      event.preventDefault();
      return;
    }
    const directions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const direction = directions[event.key];
    if (!direction) return;
    const origin = keyboardNodeId ?? focusNodeId ?? nodes[0]?.id ?? null;
    const next = nearestNodeInDirection(nodes, origin, direction);
    if (!next) return;
    event.preventDefault();
    setKeyboardNodeId(next.id);
    onSelectNode?.(next.id);
    setViewport((current) => centreOnNode(next, viewportSize, { scale: current.scale }));
  };

  const handlePointerDown = (event) => {
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    setViewport((current) => panBy(current, dx, dy));
  };

  const handlePointerUp = (event) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const centre = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
  const zoomButtons = [
    {
      id: 'zoom-in',
      label: 'Zoom in',
      icon: Plus,
      onClick: () =>
        setViewport((current) => zoomAt(current, 1.2, centre, { min: MIN_SCALE, max: MAX_SCALE })),
    },
    {
      id: 'zoom-out',
      label: 'Zoom out',
      icon: Minus,
      onClick: () =>
        setViewport((current) => zoomAt(current, 1 / 1.2, centre, { min: MIN_SCALE, max: MAX_SCALE })),
    },
    { id: 'fit', label: 'Fit to view', icon: Maximize2, onClick: fit },
    { id: 'reset', label: 'Reset zoom', icon: RotateCcw, onClick: () => setViewport(initialViewport()) },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {zoomButtons.map((button) => (
          <Button
            key={button.id}
            size="sm"
            onClick={button.onClick}
            aria-label={button.label}
            title={button.label}
          >
            <button.icon aria-hidden="true" className="h-4 w-4" />
          </Button>
        ))}
        <span className="text-xs text-ink-600" aria-live="polite">
          Zoom {formatScale(viewport.scale)}
        </span>
        {planned.crowded ? (
          <span className="text-xs text-ink-500">
            {planned.unlabelledCount} edge label(s) hidden to keep the picture readable. Select a node
            or open the list view to read every relationship.
          </span>
        ) : null}
      </div>

      <div
        ref={wrapperRef}
        className="relative h-[30rem] w-full cursor-grab touch-none overflow-hidden rounded border border-ink-200 bg-surface"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <svg
          className="h-full w-full"
          viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
          role="group"
          aria-label={`Relationship graph with ${nodes.length} node(s). Use the arrow keys to move between nodes and Escape to clear the selection.`}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          data-testid="graph-svg"
        >
          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            {layout?.clusters.map((cluster) => (
              <g key={cluster.id}>
                <rect
                  x={cluster.x}
                  y={cluster.y}
                  width={cluster.width}
                  height={cluster.height}
                  rx={8}
                  fill="#fbfbfc"
                  stroke="#dfe1e5"
                />
                <text x={cluster.x + 10} y={cluster.y + 16} className="fill-ink-600 text-[10px]">
                  {cluster.label} · {cluster.visibleCount}
                  {cluster.hiddenCount > 0 ? ` of ${cluster.count} shown` : ''}
                </text>
              </g>
            ))}

            {planned.edges.map((edge) => (
              <g key={edge.id}>
                <path
                  d={edge.path}
                  fill="none"
                  stroke={edge.emphasis === 'dimmed' ? '#d7dade' : '#9aa1aa'}
                  strokeWidth={edge.emphasis === 'focus' ? 2 : 1}
                  strokeDasharray={edge.provenance === 'derived' ? '6 4' : undefined}
                />
                {edge.showLabel ? (
                  <text
                    x={edge.labelX}
                    y={edge.labelY}
                    textAnchor="middle"
                    className="fill-ink-500 text-[9px]"
                  >
                    {edge.semantics?.label ?? edge.type}
                  </text>
                ) : null}
              </g>
            ))}

            {nodes.map((node) => {
              const tone = nodeTone(node.entityType);
              const selected = node.id === focusNodeId;
              const dimmed = Boolean(focusNodeId && !highlighted.has(node.id));
              const row = (view?.listRows ?? []).find((entry) => entry.id === node.id);
              const hasFindings = node.hasFindings || (node.findings && node.findings.length > 0);
              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={selected || keyboardNodeId === node.id ? 0 : -1}
                  aria-label={row?.ariaLabel ?? `${node.meta?.aria ?? 'Node'}: ${node.label}`}
                  aria-pressed={selected}
                  data-dimmed={dimmed ? 'true' : 'false'}
                  onClick={() => onSelectNode?.(node.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setKeyboardNodeId(node.id);
                    onSelectNode?.(node.id);
                  }}
                  className="cursor-pointer"
                >
                  <NodeShape node={node} tone={tone} dimmed={dimmed} selected={selected} />
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2 + 3}
                    textAnchor="middle"
                    className="pointer-events-none select-none text-[10px]"
                    fill={tone.text}
                    opacity={dimmed ? 0.5 : 1}
                  >
                    {clip(node.label, Math.max(12, Math.round(node.width / 6)))}
                  </text>
                  {hasFindings ? (
                    <text
                      x={node.x + node.width - 6}
                      y={node.y + 12}
                      textAnchor="middle"
                      className="pointer-events-none select-none text-[11px] font-bold fill-amber-600"
                    >
                      ⚠
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>

        {layout?.empty ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-600">
            No nodes match the current filters.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default GraphCanvas;
