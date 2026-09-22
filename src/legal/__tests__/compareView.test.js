import { describe, expect, it } from 'vitest';
import { CHANGE_TYPES, compareModels } from '../compareEngine.js';
import {
  FILTER_ALL,
  allComparisonChanges,
  buildChangeDetail,
  buildCompareViewModel,
  buildImpactView,
  changeRowSummary,
  changeTitle,
  compareChangeTypeFilters,
  compareClauseLabels,
  compareScopeFilters,
  compareViewCounts,
  compareViewIsEmpty,
  filterComparisonChanges,
  graphDiffRows,
  groupChangesByScope,
  structureLayerRows,
  textLayerRows,
} from '../compareView.js';
import { buildValidModel } from './fixtures.js';

function clone(model) {
  return JSON.parse(JSON.stringify(model));
}

/** Version B of the fixture with a shortened payment period and a re-pointed edge. */
function changedVersion() {
  const model = clone(buildValidModel());
  model.deadlines.find((entry) => entry.id === 'dl_payment').offsetAmount = 15;
  model.clauses.find((entry) => entry.id === 'cl_payment').text = model.clauses
    .find((entry) => entry.id === 'cl_payment')
    .text.replace('thirty (30) days', 'fifteen (15) days');
  model.obligations.find((entry) => entry.id === 'obl_confidentiality').summary =
    'Keep Confidential Information secret.';
  model.relationships[0].toId = 'obl_confidentiality';
  model.clauses.push({
    id: 'cl_audit',
    type: 'clause',
    documentId: 'doc_test_agreement',
    number: '5.1',
    heading: 'AUDIT',
    text: '5.1 The Customer may audit once per year.',
    level: 2,
    evidence: [],
    crossReferences: [],
  });
  return model;
}

const comparison = compareModels(buildValidModel(), changedVersion());

describe('compareView: filter chips', () => {
  it('lists every scope with the number of changes recorded in it', () => {
    const filters = compareScopeFilters(comparison);
    expect(filters).toHaveLength(10);
    expect(filters[0].id).toBe(FILTER_ALL);
    expect(filters[0].count).toBe(comparison.counts.changeCount);
    const clauses = filters.find((filter) => filter.id === 'clauses');
    expect(clauses.label).toBe('Clauses');
    expect(clauses.count).toBeGreaterThan(0);
    expect(clauses.unchanged).toBeGreaterThan(0);
  });

  it('lists every change type with its own count', () => {
    const filters = compareChangeTypeFilters(comparison);
    expect(filters.map((filter) => filter.id)).toEqual([
      FILTER_ALL,
      CHANGE_TYPES.ADDED,
      CHANGE_TYPES.REMOVED,
      CHANGE_TYPES.MODIFIED,
      CHANGE_TYPES.RELATIONSHIP_CHANGED,
      CHANGE_TYPES.UNCHANGED,
    ]);
    const unchanged = filters.find((filter) => filter.id === CHANGE_TYPES.UNCHANGED);
    expect(unchanged.count).toBe(comparison.counts.unchangedCount);
  });
});

describe('compareView: change list', () => {
  it('hides unchanged records until the unchanged chip is chosen', () => {
    const diff = filterComparisonChanges(comparison, {});
    expect(diff.length).toBe(comparison.counts.changeCount);
    expect(diff.some((change) => change.changeType === CHANGE_TYPES.UNCHANGED)).toBe(false);

    const everything = filterComparisonChanges(comparison, {
      changeType: CHANGE_TYPES.UNCHANGED,
    });
    expect(everything.length).toBe(comparison.counts.unchangedCount);
  });

  it('filters by scope', () => {
    const deadlines = filterComparisonChanges(comparison, { scopeId: 'deadlines' });
    expect(deadlines.length).toBeGreaterThan(0);
    expect(deadlines.every((change) => change.scope === 'deadlines')).toBe(true);
    expect(filterComparisonChanges(comparison, { scopeId: 'rights' })).toEqual([]);
  });

  it('groups the filtered rows in the product scope order', () => {
    const groups = groupChangesByScope(allComparisonChanges(comparison));
    const order = groups.map((group) => group.scope);
    expect(order).toEqual([...order].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(order.indexOf('obligations')).toBeLessThan(order.indexOf('clauses'));
    expect(groups.every((group) => group.changes.length > 0)).toBe(true);
  });

  it('summarises each row in one line', () => {
    const modified = comparison.changes.find((change) => change.scope === 'deadlines');
    expect(changeRowSummary(modified)).toMatch(/Stated period/);

    const added = comparison.changes.find((change) => change.changeType === CHANGE_TYPES.ADDED);
    expect(changeRowSummary(added)).toMatch(/Version B only/);

    const relationship = comparison.changes.find(
      (change) => change.changeType === CHANGE_TYPES.RELATIONSHIP_CHANGED,
    );
    expect(changeRowSummary(relationship)).toContain('→');
  });

  it('names a change with its scope noun and label', () => {
    const modified = comparison.changes.find((change) => change.scope === 'deadlines');
    expect(changeTitle(modified)).toMatch(/^Deadline “/);
    expect(changeTitle(null)).toBe('No change selected');
  });
});

describe('compareView: change detail', () => {
  const clauseLabels = compareClauseLabels(comparison);

  it('reads clause labels from both versions', () => {
    expect(clauseLabels.get('cl_payment')).toBe('1.1 PAYMENT');
    expect(clauseLabels.get('cl_audit')).toBe('5.1 AUDIT');
  });

  it('describes a modified record field by field', () => {
    const change = comparison.changes.find((entry) => entry.scope === 'deadlines');
    const detail = buildChangeDetail(change, { clauseLabels });
    expect(detail.title).toMatch(/^Deadline “/);
    expect(detail.scopeLabel).toBe('Deadlines');
    expect(detail.changeTypeLabel).toBe('Modified');
    expect(detail.periodNote).toMatch(/15 day\(s\) instead of 30 day\(s\)/);
    const period = detail.fields.find((field) => field.field === 'statedPeriod');
    expect(period.changed).toBe(true);
    expect(period.before).toBe('30 days');
    expect(period.after).toBe('15 days');
    expect(detail.clauseLinks).toContainEqual({ id: 'cl_payment', label: '1.1 PAYMENT' });
  });

  it('marks a missing side as not recorded', () => {
    const change = comparison.changes.find((entry) => entry.changeType === CHANGE_TYPES.ADDED);
    const detail = buildChangeDetail(change, { clauseLabels });
    const text = detail.fields.find((field) => field.field === 'text');
    expect(text.beforeMissing).toBe(true);
    expect(text.afterMissing).toBe(false);
    expect(detail.evidence.before).toEqual([]);
  });

  it('shows both readings for a changed relationship', () => {
    const change = comparison.changes.find(
      (entry) => entry.changeType === CHANGE_TYPES.RELATIONSHIP_CHANGED,
    );
    const detail = buildChangeDetail(change, { clauseLabels });
    expect(detail.reading.before).toMatch(/PAYMENT/);
    expect(detail.reading.after).toMatch(/confidential/i);
    expect(detail.reading.before).not.toBe(detail.reading.after);
  });

  it('returns null when there is nothing selected', () => {
    expect(buildChangeDetail(null)).toBeNull();
  });
});

describe('compareView: impact panel', () => {
  it('separates the changed record from the records it reaches', () => {
    const change = comparison.changes.find((entry) => entry.scope === 'deadlines');
    const model = buildCompareViewModel(comparison, { selectedChangeId: change.id });
    expect(model.detail.impact.summary).toMatch(/reaches/i);
    expect(model.impact.origin.entityId).toBe('dl_payment');
    expect(model.impact.affected.length).toBeGreaterThan(0);
    expect(model.impact.affected.every((record) => record.distance > 0)).toBe(true);
    expect(model.impact.affected[0].statement).toMatch(/reaches the/);
    expect(model.impact.disclaimer).toMatch(/not advice/i);
  });

  it('handles a missing impact gracefully', () => {
    const view = buildImpactView(null);
    expect(view.summary).toBeNull();
    expect(view.affected).toEqual([]);
    expect(view.stats.total).toBe(0);
  });
});

describe('compareView: text and structure layers', () => {
  it('exposes text segments with a class for each kind', () => {
    const rows = textLayerRows(comparison);
    expect(rows.length).toBeGreaterThan(0);
    const audit = rows.find((row) => row.label.includes('AUDIT'));
    expect(audit.changeType).toBe(CHANGE_TYPES.ADDED);
    expect(audit.segments[0].kind).toBe('added');
    expect(audit.segments[0].className).toMatch(/positive/);
    const removedSegment = rows
      .flatMap((row) => row.segments)
      .find((segment) => segment.kind === 'removed');
    expect(removedSegment.className).toMatch(/line-through/);
  });

  it('exposes structure rows with the before and after reading', () => {
    const rows = structureLayerRows(comparison);
    const timing = rows.find((row) => row.kind === 'clause-period');
    expect(timing.subject).toBe('1.1 PAYMENT');
    expect(timing.beforeText).toBe('1.1 PAYMENT → 30 days');
    expect(timing.afterText).toBe('1.1 PAYMENT → 15 days');
    expect(timing.note).toMatch(/15 day\(s\) instead of 30 day\(s\)/);
    expect(timing.clauseIds).toContain('cl_payment');
  });
});


describe('compareView: graph diff rows', () => {
  const graph = graphDiffRows(comparison);

  it('groups nodes and edges by state, added first', () => {
    expect(graph.nodeGroups.map((group) => group.state)[0]).toBe('added');
    expect(graph.nodeGroups.every((group) => group.rows.length > 0)).toBe(true);
    expect(graph.edgeGroups.length).toBeGreaterThan(0);
  });

  it('reports the added clause as an added node with its clauses', () => {
    const added = graph.nodeGroups
      .find((group) => group.state === 'added')
      .rows.find((row) => row.nodeId === 'cl_audit');
    expect(added.entityTypeLabel).toBe('Clause');
    expect(added.tone).toBe('accent');
    expect(added.clauseIds).toContain('cl_audit');
  });

  it('reports the re-pointed edge with both readings', () => {
    const changed = graph.edgeGroups
      .find((group) => group.state === 'changed')
      .rows.find((row) => row.fields.some((field) => field.field === 'to'));
    expect(changed.beforeDisplay).toMatch(/PAYMENT/);
    expect(changed.afterDisplay).toMatch(/confidential/i);
    expect(changed.source).not.toBeNull();
  });

  it('keeps counts from the graph diff', () => {
    expect(graph.nodeCounts.total).toBeGreaterThan(0);
    expect(graph.relationshipCounts.total).toBeGreaterThan(0);
    expect(graph.empty).toBe(false);
  });

  it('reports an empty graph diff for two identical versions', () => {
    const same = compareModels(buildValidModel(), clone(buildValidModel()));
    const rows = graphDiffRows(same);
    expect(rows.nodeGroups.map((group) => group.state)).toEqual(['unchanged']);
    expect(rows.nodeGroups[0].rows.every((row) => row.tone === 'muted')).toBe(true);
  });

  it('selects the first row by default and honours an explicit selection', () => {
    expect(graph.selectedNode).toBeTruthy();
    const chosen = graph.nodeGroups[0].rows[1] ?? graph.nodeGroups[0].rows[0];
    const explicit = graphDiffRows(comparison, { selectedNodeId: chosen.nodeId });
    expect(explicit.selectedNode.nodeId).toBe(chosen.nodeId);
  });
});

describe('compareView: whole view model', () => {
  it('returns null when there is no comparison', () => {
    expect(buildCompareViewModel(null)).toBeNull();
  });

  it('selects the first filtered change when nothing is chosen', () => {
    const model = buildCompareViewModel(comparison);
    expect(model.selectedChangeId).toBe(model.changes[0].id);
    expect(model.detail.id).toBe(model.selectedChangeId);
    expect(model.view).toBe('changes');
  });

  it('falls back to the changes view for an unknown view id', () => {
    expect(buildCompareViewModel(comparison, { view: 'nonsense' }).view).toBe('changes');
    expect(buildCompareViewModel(comparison, { view: 'graph' }).view).toBe('graph');
  });

  it('keeps the selection stable when the filters still contain it', () => {
    const target = comparison.changes.find((change) => change.scope === 'deadlines');
    const model = buildCompareViewModel(comparison, { scopeId: 'deadlines', selectedChangeId: target.id });
    expect(model.selectedChangeId).toBe(target.id);
    expect(model.changes.every((change) => change.scope === 'deadlines')).toBe(true);
  });

  it('falls back to the first row when the selection is filtered out', () => {
    const target = comparison.changes.find((change) => change.scope === 'deadlines');
    const model = buildCompareViewModel(comparison, { scopeId: 'clauses', selectedChangeId: target.id });
    expect(model.selectedChangeId).toBe(model.changes[0].id);
  });

  it('counts the rows in each view and reports which views are empty', () => {
    const model = buildCompareViewModel(comparison);
    const counts = compareViewCounts(model);
    expect(counts.changes).toBe(comparison.counts.changeCount);
    expect(counts.text).toBeGreaterThan(0);
    expect(counts.structure).toBeGreaterThan(0);
    expect(counts.graph).toBeGreaterThan(0);
    expect(compareViewIsEmpty(model, 'text')).toBe(false);
    expect(compareViewIsEmpty(null, 'changes')).toBe(true);
  });

  it('surfaces the comparison problems when a version is missing', () => {
    const model = buildCompareViewModel(compareModels(null, buildValidModel()));
    expect(model.ok).toBe(false);
    expect(model.problems.length).toBeGreaterThan(0);
    expect(model.changes).toEqual([]);
    expect(model.detail).toBeNull();
  });

  it('reports no changes for two identical versions', () => {
    const model = buildCompareViewModel(compareModels(buildValidModel(), clone(buildValidModel())));
    expect(model.changes).toEqual([]);
    expect(compareViewIsEmpty(model, 'changes')).toBe(true);
    expect(compareViewIsEmpty(model, 'graph')).toBe(false);
    expect(model.summary.headline).toMatch(/no differences/i);
  });
});

