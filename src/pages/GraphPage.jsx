/**
 * GraphPage â€” Redesigned Relationship Graph with Progressive Disclosure.
 *
 * Built around human comprehension: "Help me understand the relationships around something important."
 * Answers: Who → must do what → when → triggered by what → with what consequence?
 *
 * Default mode: Focused view (5-10 nodes centered around a key obligation).
 * Mode toggle: Focused view | Full map | Accessible list.
 * Findings are annotated on primary nodes (with warning markers âš ) rather than cluttering as 25+ nodes.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Network, Search, SlidersHorizontal } from 'lucide-react';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Callout, EmptyState, Panel, StatTile } from '../components/ui/Panel.jsx';
import { GraphCanvas } from '../components/graph/GraphCanvas.jsx';
import { GraphDetailPanel } from '../components/graph/GraphDetailPanel.jsx';
import { GraphListView } from '../components/graph/GraphListView.jsx';
import { clauseNumberMap } from '../components/legal/presentation.js';
import { clauseSourceLink, routeBuilders } from '../app/navigation.js';
import { layoutTypedGraph } from '../legal/graphCanvas.js';
import { GRAPH_GROUP_IDS } from '../legal/graphView.js';
import { EMPTY_STATES } from '../content/notices.js';
import { useAppStore } from '../app/AppProvider.jsx';
import {
  selectGraphTopics,
  selectGraphViewModel,
  selectInconsistencyFindings,
  selectSignals,
  selectWorkspaceSummary,
} from '../state/selectors.js';

export const DEPTH_OPTIONS = Object.freeze([
  { value: 1, label: '1 level' },
  { value: 2, label: '2 levels' },
  { value: 3, label: 'All' },
]);

export function parseGroupParam(value) {
  const ids = String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => GRAPH_GROUP_IDS.includes(entry));
  return ids.length ? ids : [...GRAPH_GROUP_IDS];
}

export function parseDepthParam(value) {
  const depth = Number.parseInt(value, 10);
  return DEPTH_OPTIONS.some((option) => option.value === depth) ? depth : 1;
}

export function GraphPage() {
  const state = useAppStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  const summary = selectWorkspaceSummary(state);
  const signals = selectSignals(state);
  const inconsistencies = selectInconsistencyFindings(state);
  const topics = selectGraphTopics(state);

  const viewParam = params.get('mode') ?? params.get('view') ?? 'focused';
  const viewMode = ['focused', 'full', 'list'].includes(viewParam) ? viewParam : 'focused';

  const groupsParam = params.get('groups') ?? '';
  const activeGroupIds = useMemo(() => parseGroupParam(groupsParam), [groupsParam]);
  const focusNodeId = params.get('focus') || null;
  const depth = parseDepthParam(params.get('depth'));
  const searchText = params.get('q') ?? '';

  const graphView = useMemo(
    () =>
      selectGraphViewModel(state, null, {
        mode: viewMode,
        activeGroupIds,
        focusNodeId,
        depth,
        searchText,
      }),
    [state, viewMode, activeGroupIds, focusNodeId, depth, searchText],
  );

  const layout = useMemo(() => layoutTypedGraph(graphView), [graphView]);
  const _clauseNumbers = useMemo(() => clauseNumberMap(summary.model), [summary.model]);

  const setParam = useCallback(
    (key, value) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value === null || value === undefined || value === '') next.delete(key);
          else next.set(key, String(value));
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const selectNode = useCallback(
    (nodeId) => {
      setParam('focus', nodeId ?? '');
    },
    [setParam],
  );

  const setViewMode = useCallback(
    (mode) => {
      setParam('mode', mode === 'focused' ? '' : mode);
    },
    [setParam],
  );

  const toggleGroup = useCallback(
    (groupId) => {
      const next = activeGroupIds.includes(groupId)
        ? activeGroupIds.filter((entry) => entry !== groupId)
        : [...activeGroupIds, groupId];
      setParam('groups', next.length === GRAPH_GROUP_IDS.length ? '' : next.join(','));
    },
    [activeGroupIds, setParam],
  );

  if (!summary.ready || !graphView) {
    return <EmptyState icon={Network} message={EMPTY_STATES.noModel} />;
  }

  const counts = graphView.counts;
  const documentId = summary.entry?.id ?? null;

  const openObligations = () => {
    if (documentId) navigate(`${routeBuilders.timeline(documentId)}?view=obligations`);
  };
  const openTimeline = () => {
    if (documentId) navigate(`${routeBuilders.timeline(documentId)}?view=schedule`);
  };
  const openSource = (clauseId) => {
    if (documentId && clauseId) navigate(clauseSourceLink(documentId, clauseId));
  };

  const activeFocusNode = graphView.focus?.node;

  return (
    <div className="space-y-5">
      {/* 1. Question-driven Header */}
      <div className="rounded-lg border border-accent-200/80 bg-accent-50/40 p-4 shadow-sm space-y-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Understand a relationship</h2>
          <p className="text-xs text-ink-600">
            Select an obligation, right, deadline, or finding to see what it connects to.
          </p>
        </div>

        {/* Search & Topic Quick Selector */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-ink-600">
            What do you want to understand?
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[16rem]">
              <Search aria-hidden="true" className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
              <input
                type="search"
                value={searchText}
                onChange={(event) => setParam('q', event.target.value)}
                placeholder="Search obligations, parties, clauses..."
                aria-label="What do you want to understand search input"
                className="w-full rounded-md border border-ink-200 bg-surface py-1.5 pl-8 pr-3 text-sm text-ink-800 shadow-xs outline-none focus:border-accent-400 focus:ring-1 focus:ring-accent-400"
              />
            </div>

            {/* Suggested Topics */}
            {topics.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-500 font-medium">Suggestions:</span>
                {topics.map((topic) => {
                  const isSelected = graphView.focus?.nodeId === topic.id;
                  return (
                    <button
                      key={topic.id}
                      type="button"
                      onClick={() => selectNode(topic.id)}
                      className={[
                        'rounded-full px-2.5 py-1 text-xs font-medium transition-colors border',
                        isSelected
                          ? 'border-accent-400 bg-accent-500 text-white font-semibold shadow-xs'
                          : 'border-ink-200 bg-surface text-ink-700 hover:bg-accent-50 hover:border-accent-300',
                      ].join(' ')}
                    >
                      {topic.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* 2. Controls Toolbar & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 pb-3">
        {/* View Mode Toggle: Focused view | Full map | Accessible list */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-ink-200 bg-surface p-0.5 shadow-xs">
            <button
              type="button"
              onClick={() => setViewMode('focused')}
              className={[
                'rounded px-3 py-1 text-xs font-semibold transition-colors',
                viewMode === 'focused' ? 'bg-accent-50 text-accent-700 font-bold' : 'text-ink-600 hover:bg-ink-50',
              ].join(' ')}
            >
              Focused view
            </button>
            <button
              type="button"
              onClick={() => setViewMode('full')}
              className={[
                'rounded px-3 py-1 text-xs font-semibold transition-colors',
                viewMode === 'full' ? 'bg-accent-50 text-accent-700 font-bold' : 'text-ink-600 hover:bg-ink-50',
              ].join(' ')}
            >
              Full map
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={[
                'rounded px-3 py-1 text-xs font-semibold transition-colors',
                viewMode === 'list' ? 'bg-accent-50 text-accent-700 font-bold' : 'text-ink-600 hover:bg-ink-50',
              ].join(' ')}
            >
              Accessible list
            </button>
          </div>

          {/* Progressive Expansion Depth Selector (for graph modes) */}
          {viewMode !== 'list' ? (
            <div className="flex items-center gap-1 text-xs text-ink-600 pl-2">
              <span className="font-semibold text-ink-500">Expand:</span>
              <div className="inline-flex rounded border border-ink-200 bg-surface p-0.5">
                {DEPTH_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setParam('depth', opt.value)}
                    className={[
                      'rounded px-2 py-0.5 text-xs font-medium',
                      depth === opt.value ? 'bg-accent-100 text-accent-800 font-bold' : 'text-ink-600 hover:bg-ink-50',
                    ].join(' ')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Compact Status Line */}
        <div className="flex items-center gap-3 text-xs text-ink-600">
          <span className="font-semibold text-ink-700 bg-ink-100/70 px-2.5 py-1 rounded">
            Showing {counts.visibleNodes} connected {counts.visibleNodes === 1 ? 'entity' : 'entities'} Â· {counts.visibleRelationships} {counts.visibleRelationships === 1 ? 'relationship' : 'relationships'}
          </span>
          <button
            type="button"
            onClick={() => setShowAdvancedFilters((v) => !v)}
            className="flex items-center gap-1 text-accent-700 font-medium hover:underline"
          >
            <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
            {showAdvancedFilters ? 'Hide advanced filters' : 'Advanced filters'}
          </button>
        </div>
      </div>

      {/* Full map metric tiles (Only shown in Full map mode when requested) */}
      {viewMode === 'full' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Entities shown"
            value={counts.visibleNodes}
            hint={`${counts.nodes} after group filters`}
          />
          <StatTile
            label="Relationships"
            value={counts.visibleRelationships}
            hint={`${counts.relationships} between filtered entities`}
          />
          <StatTile
            label="Held back for readability"
            value={counts.hiddenByCluster}
            tone={counts.hiddenByCluster > 0 ? 'warning' : 'neutral'}
            hint={`${counts.collapsedClusters} cluster(s) capped`}
          />
          <StatTile
            label="Findings"
            value={(graphView.summary?.riskCount ?? 0) + (graphView.summary?.inconsistencyCount ?? 0)}
            tone="warning"
            hint="Total risk signals and inconsistencies"
          />
        </div>
      ) : null}

      {/* Collapsible Advanced Filters */}
      {showAdvancedFilters ? (
        <Panel
          title="Advanced filters & group toggles"
          subtitle="Customize visible entity categories and view shape legends"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {graphView.legend.map((group) => {
                const active = activeGroupIds.includes(group.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-pressed={active}
                    title={group.description}
                    className={[
                      'rounded border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? 'border-accent-300 bg-accent-50 text-accent-700'
                        : 'border-ink-200 bg-surface text-ink-600 hover:bg-ink-50',
                    ].join(' ')}
                  >
                    {group.label}
                    <span className="ml-1 text-ink-500">{group.count}</span>
                  </button>
                );
              })}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setParam('groups', '')}
                disabled={activeGroupIds.length === GRAPH_GROUP_IDS.length}
              >
                All groups
              </Button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setShowLegend((v) => !v)}
                className="text-2xs font-semibold uppercase tracking-wider text-accent-700 hover:underline"
              >
                {showLegend ? 'Hide shape & edge legend â–²' : 'Show shape & edge legend â–¼'}
              </button>
            </div>

            {showLegend ? (
              <div className="space-y-2 rounded border border-ink-100 bg-ink-50/50 p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
                  <span className="font-semibold uppercase tracking-wide text-ink-500">Node shapes</span>
                  {graphView.legend.flatMap((group) =>
                    group.types.map((type) => (
                      <Badge key={type.entityType} tone="neutral" title={type.icon}>
                        {type.shape} Â· {type.label}
                      </Badge>
                    )),
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
                  <span className="font-semibold uppercase tracking-wide text-ink-500">Edge families</span>
                  {graphView.edgeLegend.map((edge) => (
                    <Badge key={edge.id} tone="muted" title={edge.description}>
                      {edge.label}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {/* Main Content Area */}
      {graphView.empty ? (
        <EmptyState icon={Network} message={EMPTY_STATES.noGraph} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            {viewMode !== 'list' ? (
              <Panel
                title={
                  viewMode === 'focused'
                    ? `Focused view: ${activeFocusNode?.label ?? 'Obligation relationship'}`
                    : 'Full Relationship Map'
                }
                subtitle={
                  viewMode === 'focused'
                    ? 'Focused view shows the relationships most relevant to the selected item.'
                    : `${counts.visibleNodes} entities and ${counts.visibleRelationships} edges shown.`
                }
              >
                <GraphCanvas
                  view={graphView}
                  layout={layout}
                  focusNodeId={graphView.focus.nodeId}
                  onSelectNode={selectNode}
                  onClearSelection={() => selectNode(null)}
                />
                <p className="mt-3 text-xs text-ink-500">
                  Select any node to focus its chain. Nodes marked with âš  contain risk or inconsistency annotations.
                </p>
              </Panel>
            ) : (
              <GraphListView
                view={graphView}
                model={summary.model}
                focusNodeId={graphView.focus.nodeId}
                onSelectNode={selectNode}
                query={searchText}
                onQueryChange={(value) => setParam('q', value)}
              />
            )}
          </div>

          <div className="space-y-4">
            <GraphDetailPanel
              view={graphView}
              model={summary.model}
              nodeId={graphView.focus.nodeId}
              signals={signals?.signals ?? []}
              inconsistencies={inconsistencies?.detected ?? []}
              onSelectNode={selectNode}
              onOpenTimeline={openTimeline}
              onOpenObligations={openObligations}
              onOpenSource={openSource}
            />

            <Panel title="How to explore" subtitle="Understanding contract relationships">
              <ul className="list-disc space-y-1.5 pl-4 text-xs text-ink-700">
                <li>
                  <strong>Focused view</strong> concentrates on one relationship chain at a time (Party → Obligation → Trigger → Deadline → Consequence).
                </li>
                <li>
                  Click <strong>View source →</strong> to jump directly to the exact clause citations in the document.
                </li>
                <li>
                  Use <strong>Expand</strong> (1 level, 2 levels, All) to progressively reveal wider connected entities.
                </li>
                <li>
                  Switch to <strong>Full map</strong> to inspect the complete legal network.
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      )}

      {/* Readable Relationship Table */}
      {!graphView.empty && viewMode === 'full' ? (
        <Panel
          title="Every relationship, in words"
          subtitle={`${counts.visibleRelationships} edge(s) between the entities currently shown`}
        >
          {counts.visibleRelationships === 0 ? (
            <p className="text-sm text-ink-600">
              No relationship connects the entities left by these filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base min-w-[40rem]">
                <thead>
                  <tr>
                    <th scope="col">From</th>
                    <th scope="col">Relationship</th>
                    <th scope="col">To</th>
                    <th scope="col">Family</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {graphView.visibleGraph.relationships.map((relationship) => {
                    const entry = graphView.visibleIndex.adjacency
                      .get(relationship.fromId)
                      ?.find((candidate) => candidate.relationship.id === relationship.id);
                    return (
                      <tr key={relationship.id}>
                        <td className="text-ink-800 font-medium">
                          {graphView.visibleIndex.nodeById.get(relationship.fromId)?.label ??
                            relationship.fromId}
                        </td>
                        <td className="text-ink-600 italic">
                          {entry?.phrase ?? relationship.type}
                        </td>
                        <td className="text-ink-800 font-medium">
                          {graphView.visibleIndex.nodeById.get(relationship.toId)?.label ??
                            relationship.toId}
                        </td>
                        <td>
                          <Badge tone="neutral">{entry?.semantics.category ?? 'reference'}</Badge>
                        </td>
                        <td>
                          <Badge
                            tone={relationship.provenance === 'derived' ? 'muted' : 'accent'}
                          >
                            {relationship.provenance}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}

      <Callout tone="info" title="Comprehension-first Relationship Graph">
        The graph maps legal relationships traced from validated contract text. Use the topic suggestions above or click any node to explore key obligation chains step-by-step.
      </Callout>
    </div>
  );
}

export default GraphPage;

