/**
 * Compare panel smoke tests.
 *
 * The panels are pure views over a comparison result, so rendering them with a
 * real model pair is enough to catch a broken prop, a bad import or a crash:
 * renderToString fails here instead of in the browser.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ChangeDetail } from '../ChangeDetail.jsx';
import { ChangeList } from '../ChangeList.jsx';
import { ChangeKindLegend, CompareFilters } from '../CompareFilters.jsx';
import { GraphDiffPanel } from '../GraphDiffPanel.jsx';
import { ImpactPanel, ImpactTotals } from '../ImpactPanel.jsx';
import { StructureDiffPanel, TextDiffPanel } from '../LayerPanels.jsx';
import { VersionCard, VersionPicker } from '../VersionPicker.jsx';
import { CHANGE_TYPES, compareModels } from '../../../legal/compareEngine.js';
import { buildCompareViewModel } from '../../../legal/compareView.js';
import { buildValidModel, TEST_DOCUMENT_ID } from '../../../legal/__tests__/fixtures.js';

function clone(model) {
  return JSON.parse(JSON.stringify(model));
}

/** Version B: shortened payment period, an added clause and a re-pointed edge. */
function versionB() {
  const model = clone(buildValidModel());
  model.deadlines.find((entry) => entry.id === 'dl_payment').offsetAmount = 15;
  model.clauses.push({
    ...model.clauses[0],
    id: 'cl_audit',
    number: '5.1',
    heading: 'AUDIT',
    text: '5.1 The Customer may audit once per year.',
    evidence: [],
  });
  model.relationships[0].toId = 'obl_confidentiality';
  return model;
}

const comparison = compareModels(buildValidModel(), versionB());
const view = buildCompareViewModel(comparison, { view: 'changes' });
const deadlineChange = comparison.changes.find((change) => change.scope === 'deadlines');
const deadlineView = buildCompareViewModel(comparison, {
  scopeId: 'deadlines',
  selectedChangeId: deadlineChange.id,
});

const documents = [
  {
    id: TEST_DOCUMENT_ID,
    title: 'Test Agreement',
    effectiveDate: '2026-01-01',
    source: 'demo',
  },
  { id: 'doc_test_agreement_v2', title: 'Test Agreement (revised)', effectiveDate: null, source: 'upload' },
];

function render(element) {
  return renderToString(element);
}

describe('compare panels: version picker and cards', () => {
  it('offers both documents and asks for a second version when only one is loaded', () => {
    const html = render(
      createElement(VersionPicker, {
        documents,
        versionAId: TEST_DOCUMENT_ID,
        versionBId: 'doc_test_agreement_v2',
        onSelectA: () => {},
        onSelectB: () => {},
      }),
    );
    expect(html).toContain('Version A');
    expect(html).toContain('Version B');
    expect(html).toContain('Test Agreement (revised)');

    const single = render(
      createElement(VersionPicker, {
        documents: [documents[0]],
        versionAId: TEST_DOCUMENT_ID,
        versionBId: TEST_DOCUMENT_ID,
        onSelectA: () => {},
        onSelectB: () => {},
        notice: 'Only one document is loaded.',
      }),
    );
    expect(single).toContain('Only one document is loaded.');
  });

  it('summarises each version with its record counts', () => {
    const html = render(
      createElement(VersionCard, {
        label: 'Version A',
        side: 'a',
        version: view.versionA,
        documentSummary: documents[0],
      }),
    );
    expect(html).toContain('Test Agreement');
    expect(html).toContain('records');
    expect(html).toContain('Obligations');

    const empty = render(createElement(VersionCard, { label: 'Version B', version: null }));
    expect(empty).toContain('Choose a document for');
    expect(empty).toContain('Version B');
  });
});

describe('compare panels: filters and change list', () => {
  it('renders every filter chip with its count', () => {
    const html = render(
      createElement(CompareFilters, {
        views: view.views,
        view: view.view,
        viewCounts: { changes: 3, text: 0, structure: 1, graph: 2 },
        scopeFilters: view.scopeFilters,
        scopeId: 'all',
        changeTypeFilters: view.changeTypeFilters,
        changeType: 'all',
      }),
    );
    expect(html).toContain('All scopes');
    expect(html).toContain('Deadlines');
    expect(html).toContain('Relationship changed');
    expect(html).toContain('aria-pressed');
  });

  it('renders the change rows grouped by scope', () => {
    const html = render(
      createElement(ChangeList, {
        groups: view.groups,
        selectedChangeId: view.selectedChangeId,
        onSelectChange: () => {},
      }),
    );
    expect(html).toContain('Deadlines');
    expect(html).toContain('Clauses');
    expect(html).toContain('Relationships');
    expect(html).toContain('Clause imposes obligation');
    expect(html).toContain('aria-current="true"');
    expect(html).not.toMatch(/undefined is not|Cannot read propert/);
  });

  it('renders an empty state instead of an empty list', () => {
    const html = render(
      createElement(ChangeList, { groups: [], emptyMessage: 'Nothing in this scope changed.' }),
    );
    expect(html).toContain('Nothing in this scope changed.');
  });

  it('explains each change kind in the legend', () => {
    const html = render(createElement(ChangeKindLegend));
    expect(html).toContain('added');
    expect(html).toContain('removed');
    expect(html).toContain('modified');
    expect(html).toContain('relationship changed');
  });
});

describe('compare panels: change detail and impact', () => {
  it('shows the before and after of every compared field', () => {
    const html = render(
      createElement(ChangeDetail, {
        detail: deadlineView.detail,
        clauseNumberById: deadlineView.clauseLabels,
      }),
    );
    expect(html).toContain('Before (version A)');
    expect(html).toContain('After (version B)');
    expect(html).toContain('30 days');
    expect(html).toContain('15 days');
    expect(html).toContain('Stated period');
    expect(html).toContain('1.1 PAYMENT');
    expect(html).toContain('Citations in version A');
  });

  it('shows both readings for a changed relationship', () => {
    const relationship = comparison.changes.find(
      (change) => change.changeType === CHANGE_TYPES.RELATIONSHIP_CHANGED,
    );
    const relationshipView = buildCompareViewModel(comparison, {
      selectedChangeId: relationship.id,
    });
    const html = render(
      createElement(ChangeDetail, {
        detail: relationshipView.detail,
        clauseNumberById: relationshipView.clauseLabels,
      }),
    );
    expect(html).toContain('The link as each version records it');
    expect(html).toContain('PAYMENT');
    expect(html).toContain('confidential');
  });

  it('tells the reader nothing is selected instead of rendering an empty panel', () => {
    expect(render(createElement(ChangeDetail, { detail: null }))).toContain('Nothing is selected');
  });

  it('lists the records the selected change reaches', () => {
    const html = render(
      createElement(ImpactPanel, {
        impact: deadlineView.impact,
        clauseNumberById: deadlineView.clauseLabels,
      }),
    );
    expect(html).toContain('The record that changed');
    expect(html).toContain('Reached from there');
    expect(html).toContain('reaches the');
    expect(html).toContain('one step');
    expect(html).toContain('not advice');
    expect(html).not.toMatch(/undefined is not|Cannot read propert/);
  });

  it('renders a prompt when no impact is available', () => {
    expect(render(createElement(ImpactPanel, { impact: null }))).toContain('Select a change');
  });

  it('summarises impact totals across the comparison', () => {
    const html = render(createElement(ImpactTotals, { totals: view.impactTotals }));
    expect(html).toContain('reach');
    expect(html).toContain('changed record(s)');
  });
});

describe('compare panels: text, structure and graph layers', () => {
  it('renders text differences with the words that moved', () => {
    const html = render(createElement(TextDiffPanel, { rows: view.text }));
    expect(html).toContain('Text differences');
    expect(html).toContain('AUDIT');
    expect(html).toContain('Version A');
    expect(html).toContain('Version B');
  });

  it('renders an empty state when no wording moved', () => {
    const html = render(createElement(TextDiffPanel, { rows: [] }));
    expect(html).toContain('No clause wording moved');
  });

  it('renders the structure before and after', () => {
    const html = render(
      createElement(StructureDiffPanel, {
        rows: deadlineView.structure,
        clauseNumberById: deadlineView.clauseLabels,
      }),
    );
    expect(html).toContain('1.1 PAYMENT');
    expect(html).toContain('before:');
    expect(html).toContain('after:');
    expect(html).toContain('15 day(s) instead of 30 day(s)');
  });

  it('renders the graph diff with node and relationship groups', () => {
    const html = render(
      createElement(GraphDiffPanel, {
        graph: view.graph,
        clauseNumberById: view.clauseLabels,
        selectedRowId: view.graph.selectedNode?.id ?? null,
        onSelectRow: () => {},
      }),
    );
    expect(html).toContain('Graph nodes');
    expect(html).toContain('Relationships');
    expect(html).toContain('Selected record');
    expect(html).toContain('Source clauses');
    expect(html).not.toMatch(/undefined is not|Cannot read propert/);
  });

  it('renders an empty graph diff honestly', () => {
    const html = render(
      createElement(GraphDiffPanel, { graph: { nodeGroups: [], edgeGroups: [], empty: true } }),
    );
    expect(html).toContain('no graph to compare');
  });
});

