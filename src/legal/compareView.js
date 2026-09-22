/**
 * Compare view model.
 *
 * Pure functions that turn a comparison result into everything the comparison
 * route renders: the filter chips with their counts, the change rows, the detail
 * of the selected change, the impact of that change, and the graph-diff groups.
 *
 * All rendering decisions that can be made without React are made here, so the
 * page stays a thin mapping from data to markup and the same logic can be tested
 * directly.
 */

import {
  CHANGE_TYPES,
  CHANGE_TYPE_META,
  COMPARE_SCOPES,
  FIELD_KINDS,
  fieldPhrase,
  periodNote,
  scopeNoun,
} from './compareEngine.js';
import { IMPACT_KIND_LABELS, buildImpactMap, comparisonImpactSummary } from './impactEngine.js';
import { GRAPH_EDGE_STATES, GRAPH_NODE_STATES, GRAPH_STATE_META } from './graphDiff.js';
import { entityTypeLabel } from './graphEngine.js';

/** Filter chip id for "show everything in this dimension". */
export const FILTER_ALL = 'all';

/** Views the comparison route can show. */
export const COMPARE_VIEWS = Object.freeze([
  { id: 'changes', label: 'Changes', description: 'Every recorded difference, by scope.' },
  { id: 'text', label: 'Text', description: 'Word-level differences between clause passages.' },
  { id: 'structure', label: 'Structure', description: 'Which clause states which timing or trigger.' },
  {
    id: 'graph',
    label: 'Graph diff',
    description: 'Nodes and relationships added, removed or re-pointed.',
  },
]);

export const COMPARE_VIEW_IDS = Object.freeze(COMPARE_VIEWS.map((view) => view.id));

/** Change types in the order the filter chips list them. */
export const CHANGE_TYPE_FILTERS = Object.freeze([
  { id: CHANGE_TYPES.ADDED, label: CHANGE_TYPE_META[CHANGE_TYPES.ADDED].label, tone: 'accent' },
  { id: CHANGE_TYPES.REMOVED, label: CHANGE_TYPE_META[CHANGE_TYPES.REMOVED].label, tone: 'critical' },
  { id: CHANGE_TYPES.MODIFIED, label: CHANGE_TYPE_META[CHANGE_TYPES.MODIFIED].label, tone: 'warning' },
  {
    id: CHANGE_TYPES.RELATIONSHIP_CHANGED,
    label: CHANGE_TYPE_META[CHANGE_TYPES.RELATIONSHIP_CHANGED].label,
    tone: 'accent',
  },
  { id: CHANGE_TYPES.UNCHANGED, label: CHANGE_TYPE_META[CHANGE_TYPES.UNCHANGED].label, tone: 'muted' },
]);

export function changeTone(changeType) {
  return CHANGE_TYPE_META[changeType]?.tone ?? 'neutral';
}

export function changeTypeLabel(changeType) {
  return CHANGE_TYPE_META[changeType]?.label ?? 'Change';
}

/** Every change the comparison recorded: changed records first, then unchanged. */
export function allComparisonChanges(comparison) {
  return [...(comparison?.changes ?? []), ...(comparison?.unchanged ?? [])];
}

/** Clause id → "1.1 PAYMENT" style label, gathered from both versions. */
export function compareClauseLabels(comparison) {
  const labels = new Map();
  for (const index of [comparison?.indexBefore, comparison?.indexAfter]) {
    for (const [id, entry] of index ?? []) {
      if (entry?.entityType !== 'clause') continue;
      const number = entry.entity?.number ?? null;
      const heading = entry.entity?.heading ?? null;
      labels.set(id, [number, heading].filter(Boolean).join(' ') || id);
    }
  }
  return labels;
}

/** Scope chips, with the number of changes recorded in each scope. */
export function compareScopeFilters(comparison) {
  const counts = comparison?.counts?.scopes ?? {};
  return [
    {
      id: FILTER_ALL,
      label: 'All scopes',
      description: 'Every scope the comparison covers.',
      count: comparison?.counts?.changeCount ?? 0,
      unchanged: comparison?.counts?.unchangedCount ?? 0,
    },
    ...COMPARE_SCOPES.map((scope) => ({
      id: scope.id,
      label: scope.label,
      description: scope.description,
      count: counts[scope.id]?.total ?? 0,
      unchanged: counts[scope.id]?.unchanged ?? 0,
    })),
  ];
}

/** Change-type chips, with counts taken from the comparison totals. */
export function compareChangeTypeFilters(comparison) {
  const byType = comparison?.counts?.byChangeType ?? {};
  return [
    { id: FILTER_ALL, label: 'All changes', count: comparison?.counts?.changeCount ?? 0 },
    ...CHANGE_TYPE_FILTERS.map((filter) => ({
      ...filter,
      count:
        filter.id === CHANGE_TYPES.UNCHANGED
          ? comparison?.counts?.unchangedCount ?? 0
          : byType[filter.id] ?? 0,
    })),
  ];
}

/**
 * Applies the scope and change-type chips. Unchanged records stay hidden unless
 * the unchanged chip is chosen explicitly, so the default list is the diff.
 */
export function filterComparisonChanges(
  comparison,
  { scopeId = FILTER_ALL, changeType = FILTER_ALL } = {},
) {
  return allComparisonChanges(comparison).filter((change) => {
    if (scopeId !== FILTER_ALL && change.scope !== scopeId) return false;
    if (changeType === FILTER_ALL && change.changeType === CHANGE_TYPES.UNCHANGED) return false;
    if (changeType !== FILTER_ALL && change.changeType !== changeType) return false;
    return true;
  });
}

/** The same list, grouped into scope sections in the product's scope order. */
export function groupChangesByScope(changes) {
  const groups = new Map();
  for (const change of changes ?? []) {
    if (!groups.has(change.scope)) groups.set(change.scope, []);
    groups.get(change.scope).push(change);
  }
  return COMPARE_SCOPES.filter((scope) => groups.has(scope.id)).map((scope) => ({
    scope: scope.id,
    label: scope.label,
    description: scope.description,
    changes: groups.get(scope.id),
  }));
}

/** A short descriptor for a row in the change list. */
export function changeRowSummary(change) {
  if (change.changeType === CHANGE_TYPES.UNCHANGED) {
    return 'Reads the same in both versions.';
  }
  if (change.changeType === CHANGE_TYPES.ADDED || change.changeType === CHANGE_TYPES.REMOVED) {
    const side = change.changeType === CHANGE_TYPES.ADDED ? 'Version B' : 'Version A';
    return `Recorded in ${side} only.`;
  }
  if (change.changeType === CHANGE_TYPES.RELATIONSHIP_CHANGED) {
    return `${change.beforeDisplay} → ${change.afterDisplay}`;
  }
  const rows = (change.fields ?? []).filter((field) => field.changed !== false);
  if (rows.length === 0) return 'No compared field changed.';
  return rows.slice(0, 2).map(fieldPhrase).join('; ');
}

/** "Obligation “Pay invoices”" — how a change is named in lists and headings. */
export function changeTitle(change) {
  if (!change) return 'No change selected';
  const noun = scopeNoun(change.scope);
  const label = change.label ?? change.entityId ?? 'record';
  return `${noun[0]?.toUpperCase() ?? ''}${noun.slice(1)} “${label}”`;
}


/* -------------------------------------------------------------------------- */
/* Detail, impact, text, structure and graph layers                           */
/* -------------------------------------------------------------------------- */

const EMPTY_EVIDENCE_SUMMARY = Object.freeze({ total: 0, verified: 0, unverified: 0 });

function fieldRows(change) {
  return (change?.fields ?? []).map((field) => ({
    field: field.field,
    label: field.label,
    kind: field.kind ?? FIELD_KINDS.VALUE,
    changed: Boolean(field.changed),
    before: field.beforeDisplay ?? null,
    after: field.afterDisplay ?? null,
    beforeMissing: field.beforeDisplay === null || field.beforeDisplay === undefined,
    afterMissing: field.afterDisplay === null || field.afterDisplay === undefined,
  }));
}

/** Everything the change-detail view shows for one change. */
export function buildChangeDetail(change, { clauseLabels = new Map(), impact = null } = {}) {
  if (!change) return null;
  const isRelationship = change.changeType === CHANGE_TYPES.RELATIONSHIP_CHANGED;
  return {
    id: change.id,
    title: changeTitle(change),
    scope: change.scope,
    scopeLabel: COMPARE_SCOPES.find((scope) => scope.id === change.scope)?.label ?? change.scope,
    entityType: change.entityType,
    entityTypeLabel: change.entityTypeLabel ?? entityTypeLabel(change.entityType),
    changeType: change.changeType,
    changeTypeLabel: changeTypeLabel(change.changeType),
    tone: changeTone(change.changeType),
    summary: change.summary,
    beforeLabel: change.beforeLabel ?? null,
    afterLabel: change.afterLabel ?? null,
    fields: fieldRows(change),
    changedFields: change.changedFields ?? [],
    period: change.period ?? null,
    periodNote: change.period ? periodNote(change.period) : null,
    reading: isRelationship
      ? { before: change.beforeDisplay ?? 'not recorded', after: change.afterDisplay ?? 'not recorded' }
      : null,
    clauseLinks: (change.clauseIds ?? []).map((id) => ({ id, label: clauseLabels.get(id) ?? id })),
    evidence: {
      before: change.evidence?.before ?? [],
      after: change.evidence?.after ?? [],
      beforeSummary: change.evidence?.beforeSummary ?? EMPTY_EVIDENCE_SUMMARY,
      afterSummary: change.evidence?.afterSummary ?? EMPTY_EVIDENCE_SUMMARY,
    },
    impact,
  };
}

/** The impact panel's view of one change's reach. */
export function buildImpactView(impact) {
  if (!impact) {
    return { summary: null, stats: { total: 0, byKind: {}, byDistance: {} }, disclaimer: null, origin: null, affected: [] };
  }
  return {
    summary: impact.summary,
    stats: impact.stats ?? { total: 0, byKind: {}, byDistance: {} },
    disclaimer: impact.disclaimer ?? null,
    origin: (impact.records ?? []).find((record) => record.distance === 0) ?? null,
    affected: (impact.records ?? [])
      .filter((record) => record.distance > 0)
      .map((record) => ({
        id: record.id,
        entityId: record.entityId,
        kind: record.kind,
        kindLabel: IMPACT_KIND_LABELS[record.kind] ?? record.kind,
        label: record.label,
        distance: record.distance,
        via: record.via,
        statement: record.statement,
        clauseIds: record.clauseIds ?? [],
        evidence: record.evidence ?? [],
      })),
  };
}

const SEGMENT_TONES = Object.freeze({
  unchanged: 'text-ink-700',
  added: 'bg-positive-50 text-positive-700',
  removed: 'bg-flag-50 text-flag-700 line-through',
});

/** Text-layer rows, one per clause whose words moved. */
export function textLayerRows(comparison) {
  return (comparison?.text ?? []).map((entry) => ({
    id: entry.id,
    clauseId: entry.clauseId,
    label: entry.label,
    changeType: entry.changeType,
    changeTypeLabel: changeTypeLabel(entry.changeType),
    tone: changeTone(entry.changeType),
    beforeText: entry.beforeText ?? '',
    afterText: entry.afterText ?? '',
    truncated: Boolean(entry.diff?.truncated),
    stats: entry.diff?.stats ?? { unchanged: 0, added: 0, removed: 0, changed: false },
    segments: (entry.diff?.segments ?? []).map((segment, index) => ({
      key: `${entry.id}:${index}`,
      kind: segment.kind,
      text: segment.text,
      className: SEGMENT_TONES[segment.kind] ?? SEGMENT_TONES.unchanged,
    })),
  }));
}

/** Structure-layer rows: which clause or obligation states what. */
export function structureLayerRows(comparison) {
  return (comparison?.structure?.changes ?? []).map((change) => ({
    id: change.id,
    kind: change.kind,
    kindLabel: change.kindLabel,
    subject: change.subject,
    changeType: change.changeType,
    changeTypeLabel: changeTypeLabel(change.changeType),
    tone: changeTone(change.changeType),
    beforeText: change.beforeText ?? null,
    afterText: change.afterText ?? null,
    beforePhrase: change.beforePhrase ?? null,
    afterPhrase: change.afterPhrase ?? null,
    note: change.period ? periodNote(change.period) : null,
    clauseIds: change.clauseIds ?? [],
  }));
}


/* -------------------------------------------------------------------------- */
/* Graph-diff rows                                                            */
/* -------------------------------------------------------------------------- */

const GRAPH_STATE_ORDER = [GRAPH_NODE_STATES.ADDED, GRAPH_NODE_STATES.REMOVED, GRAPH_NODE_STATES.CHANGED, GRAPH_NODE_STATES.UNCHANGED];

function graphNodeRow(change) {
  const node = change.afterNode ?? change.beforeNode ?? null;
  return {
    id: change.id,
    nodeId: change.nodeId,
    label: change.label,
    entityType: node?.entityType ?? null,
    entityTypeLabel: change.entityTypeLabel ?? 'Record',
    state: change.state,
    stateLabel: GRAPH_STATE_META[change.state]?.label ?? change.state,
    tone: GRAPH_STATE_META[change.state]?.tone ?? 'neutral',
    summary: change.summary,
    changedFields: change.changedFields ?? [],
    fields: (change.fields ?? []).map((field) => ({
      field: field.field,
      label: field.label,
      before: field.beforeDisplay ?? null,
      after: field.afterDisplay ?? null,
    })),
    clauseIds: change.clauseIds ?? [],
    evidence: {
      before: change.evidence?.before ?? [],
      after: change.evidence?.after ?? [],
    },
    beforeLabel: change.beforeLabel ?? null,
    afterLabel: change.afterLabel ?? null,
  };
}

function graphEdgeRow(change) {
  return {
    id: change.id,
    relationshipId: change.relationshipId,
    label: change.label ?? change.typeLabel,
    typeLabel: change.typeLabel,
    state: change.state,
    stateLabel: GRAPH_STATE_META[change.state]?.label ?? change.state,
    tone: GRAPH_STATE_META[change.state]?.tone ?? 'neutral',
    summary: change.summary,
    changedFields: change.changedFields ?? [],
    fields: (change.fields ?? []).map((field) => ({
      field: field.field,
      label: field.label,
      before: field.beforeDisplay ?? null,
      after: field.afterDisplay ?? null,
    })),
    beforeDisplay: change.beforeDisplay,
    afterDisplay: change.afterDisplay,
    source: change.before ?? null,
    target: change.after ?? null,
    clauseIds: change.clauseIds ?? [],
    evidence: {
      before: change.evidence?.before ?? [],
      after: change.evidence?.after ?? [],
    },
  };
}

function flattenGroups(groups) {
  return groups.flatMap((group) => group.rows);
}

/**
 * Graph-diff grouping for the UI. Groups with no rows are dropped so the panel
 * only lists the states that actually occurred.
 */
export function graphDiffRows(comparison, { selectedNodeId = null, selectedEdgeId = null } = {}) {
  const nodes = comparison?.graph?.nodes ?? [];
  const edges = comparison?.graph?.relationships ?? [];
  const nodeGroups = GRAPH_STATE_ORDER.map((state) => ({
    state,
    label: GRAPH_STATE_META[state]?.label ?? state,
    tone: GRAPH_STATE_META[state]?.tone ?? 'neutral',
    rows: nodes.filter((node) => node.state === state).map(graphNodeRow),
  })).filter((group) => group.rows.length > 0);
  const edgeGroups = GRAPH_STATE_ORDER.map((state) => ({
    state,
    label: GRAPH_STATE_META[state]?.label ?? state,
    tone: GRAPH_STATE_META[state]?.tone ?? 'neutral',
    rows: edges.filter((edge) => edge.state === state).map(graphEdgeRow),
  })).filter((group) => group.rows.length > 0);

  const nodeRows = flattenGroups(nodeGroups);
  const edgeRows = flattenGroups(edgeGroups);
  const selectedNode = nodeRows.find((row) => row.nodeId === selectedNodeId) ?? nodeRows[0] ?? null;
  const selectedEdge =
    edgeRows.find((row) => row.relationshipId === selectedEdgeId) ?? edgeRows[0] ?? null;

  return {
    nodeGroups,
    edgeGroups,
    nodeCounts: comparison?.graph?.stats?.nodeCounts ?? null,
    relationshipCounts: comparison?.graph?.stats?.relationshipCounts ?? null,
    selectedNode,
    selectedEdge,
    empty: nodeRows.length === 0 && edgeRows.length === 0,
  };
}


/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Everything the comparison route renders, in one pure view model. Selection
 * falls back to the first row in the filtered list so the detail panel is never
 * empty while there is something to show.
 */
export function buildCompareViewModel(
  comparison,
  {
    scopeId = FILTER_ALL,
    changeType = FILTER_ALL,
    view = 'changes',
    selectedChangeId = null,
    selectedNodeId = null,
    selectedEdgeId = null,
    maxDepth = 2,
  } = {},
) {
  if (!comparison) return null;

  const clauseLabels = compareClauseLabels(comparison);
  const changes = filterComparisonChanges(comparison, { scopeId, changeType });
  const groups = groupChangesByScope(changes);
  const selectedChange =
    changes.find((change) => change.id === selectedChangeId) ?? changes[0] ?? null;
  const impactMap = buildImpactMap(comparison, { maxDepth });
  const impact = buildImpactView(selectedChange ? impactMap.get(selectedChange.id) ?? null : null);

  return {
    ok: Boolean(comparison.ok),
    problems: comparison.problems ?? [],
    views: COMPARE_VIEWS,
    view: COMPARE_VIEW_IDS.includes(view) ? view : 'changes',
    versionA: comparison.versionA,
    versionB: comparison.versionB,
    counts: comparison.counts,
    summary: comparison.summary,
    impactTotals: comparisonImpactSummary(comparison, { maxDepth, map: impactMap }),
    disclaimer: comparison.disclaimer,
    clauseLabels,
    scopeFilters: compareScopeFilters(comparison),
    changeTypeFilters: compareChangeTypeFilters(comparison),
    filters: { scopeId, changeType },
    changes,
    groups,
    selectedChangeId: selectedChange?.id ?? null,
    detail: buildChangeDetail(selectedChange, { clauseLabels, impact }),
    impact,
    text: textLayerRows(comparison),
    structure: structureLayerRows(comparison),
    graph: graphDiffRows(comparison, { selectedNodeId, selectedEdgeId }),
  };
}

/** Rows shown for the currently selected view, used to drive tab counts. */
export function compareViewCounts(model) {
  if (!model) return {};
  return {
    changes: model.counts?.changeCount ?? 0,
    text: model.text.length,
    structure: model.structure.length,
    graph:
      (model.graph.nodeCounts?.added ?? 0) +
      (model.graph.nodeCounts?.removed ?? 0) +
      (model.graph.nodeCounts?.changed ?? 0) +
      (model.graph.relationshipCounts?.added ?? 0) +
      (model.graph.relationshipCounts?.removed ?? 0) +
      (model.graph.relationshipCounts?.changed ?? 0),
  };
}

/** True when the comparison recorded nothing at all in that view. */
export function compareViewIsEmpty(model, view = 'changes') {
  if (!model) return true;
  if (view === 'text') return model.text.length === 0;
  if (view === 'structure') return model.structure.length === 0;
  if (view === 'graph') return model.graph.empty;
  return model.changes.length === 0;
}

