/**
 * ComparePage — version comparison.
 *
 * The page reads two versions of the same agreement side by side: what each
 * version records at the top, every change in the middle, and what the selected
 * change is wired to on the right. Four layers can be read — the recorded
 * changes, the wording, the legal skeleton and the graph diff — and every change
 * keeps its citations from both versions.
 *
 * The tool reports what each version says. It does not rank the versions, score
 * the changes, or advise on them; the clause reading aid at the bottom is the
 * original side-by-side clause comparison.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Badge } from '../components/ui/Badge.jsx';
import { Callout, EmptyState, Panel, StatTile } from '../components/ui/Panel.jsx';
import { ChangeDetail } from '../components/compare/ChangeDetail.jsx';
import { ChangeList } from '../components/compare/ChangeList.jsx';
import { ChangeKindLegend, CompareFilters } from '../components/compare/CompareFilters.jsx';
import { ClausePairPanel } from '../components/compare/ClausePairPanel.jsx';
import { GraphDiffPanel } from '../components/compare/GraphDiffPanel.jsx';
import { ImpactPanel, ImpactTotals } from '../components/compare/ImpactPanel.jsx';
import { StructureDiffPanel, TextDiffPanel } from '../components/compare/LayerPanels.jsx';
import { VersionCard, VersionPicker } from '../components/compare/VersionPicker.jsx';
import { EMPTY_STATES } from '../content/notices.js';
import { useAppStore } from '../app/AppProvider.jsx';
import { compareModels } from '../legal/compareEngine.js';
import {
  FILTER_ALL,
  buildCompareViewModel,
  compareViewCounts,
} from '../legal/compareView.js';
import { selectDocumentSummaries, selectModel } from '../state/selectors.js';

function ChangeSummaryTiles({ counts, graphChanged, impactTotals }) {
  const byType = counts.byChangeType ?? {};
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatTile
        label="Changes"
        value={counts.changeCount}
        hint={`${byType.added ?? 0} added · ${byType.removed ?? 0} removed · ${byType.modified ?? 0} modified`}
        tone={counts.changeCount > 0 ? 'warning' : 'neutral'}
      />
      <StatTile label="Unchanged" value={counts.unchangedCount} hint="read the same in both versions" />
      <StatTile label="Text differences" value={counts.textChanges} hint="clauses whose wording moved" />
      <StatTile
        label="Structure differences"
        value={counts.structureChanges}
        hint="timing, dates and triggers"
      />
      <StatTile
        label="Graph edges changed"
        value={graphChanged}
        hint={
          impactTotals ? `${impactTotals.affectedRecordCount} other record(s) reached` : null
        }
      />
    </div>
  );
}

export function ComparePage() {
  const state = useAppStore();
  const documents = useMemo(() => selectDocumentSummaries(state), [state]);
  const activeDocumentId = state?.activeDocumentId ?? null;

  const [versionAId, setVersionAId] = useState(() => activeDocumentId);
  const [versionBId, setVersionBId] = useState(null);
  const [view, setView] = useState('changes');
  const [scopeId, setScopeId] = useState(FILTER_ALL);
  const [changeType, setChangeType] = useState(FILTER_ALL);
  const [selectedChangeId, setSelectedChangeId] = useState(null);
  const [selectedGraphRow, setSelectedGraphRow] = useState(null);

  /* Keep both sides pointing at documents that exist, without fighting the reader. */
  useEffect(() => {
    if (documents.length === 0) return;
    if (!documents.some((document) => document.id === versionAId)) {
      setVersionAId(documents[0].id);
    }
    if (!documents.some((document) => document.id === versionBId)) {
      const fallback =
        documents.find((document) => document.id !== (versionAId ?? activeDocumentId)) ??
        documents[0];
      setVersionBId(fallback.id);
    }
  }, [documents, versionAId, versionBId, activeDocumentId]);

  const modelA = useMemo(() => selectModel(state, versionAId), [state, versionAId]);
  const modelB = useMemo(() => selectModel(state, versionBId), [state, versionBId]);
  const comparison = useMemo(() => compareModels(modelA, modelB), [modelA, modelB]);

  const viewModel = useMemo(
    () =>
      buildCompareViewModel(comparison, {
        scopeId,
        changeType,
        view,
        selectedChangeId,
        selectedNodeId: selectedGraphRow?.kind === 'node' ? selectedGraphRow.id : null,
        selectedEdgeId: selectedGraphRow?.kind === 'edge' ? selectedGraphRow.id : null,
      }),
    [comparison, scopeId, changeType, view, selectedChangeId, selectedGraphRow],
  );


  if (documents.length === 0) {
    return <EmptyState icon={ArrowLeftRight} message={EMPTY_STATES.noDocuments} />;
  }

  const documentSummary = (id) => documents.find((document) => document.id === id) ?? null;
  const graphChanged =
    (viewModel?.counts?.graphRelationships?.added ?? 0) +
    (viewModel?.counts?.graphRelationships?.removed ?? 0) +
    (viewModel?.counts?.graphRelationships?.changed ?? 0);
  const viewCounts = compareViewCounts(viewModel);

  return (
    <div className="space-y-5">
      <VersionPicker
        documents={documents}
        versionAId={versionAId}
        versionBId={versionBId}
        onSelectA={setVersionAId}
        onSelectB={setVersionBId}
        notice={
          documents.length < 2
            ? 'Only one document is loaded, so both sides point at the same version. Load a second version to compare two readings of the agreement.'
            : null
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <VersionCard
          label="Version A"
          side="a"
          version={viewModel?.versionA ?? null}
          documentSummary={documentSummary(versionAId)}
        />
        <VersionCard
          label="Version B"
          side="b"
          version={viewModel?.versionB ?? null}
          documentSummary={documentSummary(versionBId)}
        />
      </div>

      {viewModel.problems.length > 0 ? (
        <Callout tone="warning" title="Nothing could be compared">
          <ul className="space-y-1">
            {viewModel.problems.map((problem) => (
              <li key={problem.code}>{problem.message}</li>
            ))}
          </ul>
        </Callout>
      ) : (
        <>
          <ChangeSummaryTiles
            counts={viewModel.counts}
            graphChanged={graphChanged}
            impactTotals={viewModel.impactTotals}
          />

          {comparison.riskShiftSummary?.length > 0 ? (
            <Panel
              title="Executive Risk Shift Summary"
              subtitle="Key structural, obligation, and deadline shifts detected between Version A and Version B"
            >
              <div className="space-y-2">
                {comparison.riskShiftSummary.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm text-ink-800">
                    <Badge tone={item.severity === 'high' ? 'critical' : item.severity === 'medium' ? 'warning' : 'neutral'}>
                      {item.severity}
                    </Badge>
                    <span className="font-medium text-ink-900">{item.text}</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Callout tone="info" title="What this comparison is">
            {viewModel.disclaimer}
          </Callout>

          <CompareFilters
            views={viewModel.views}
            view={viewModel.view}
            onSelectView={setView}
            viewCounts={viewCounts}
            scopeFilters={viewModel.scopeFilters}
            scopeId={scopeId}
            onSelectScope={setScopeId}
            changeTypeFilters={viewModel.changeTypeFilters}
            changeType={changeType}
            onSelectChangeType={setChangeType}
          />

          {viewModel.view === 'changes' ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
              <Panel
                title="Changes"
                subtitle={`${viewModel.changes.length} of ${viewModel.counts.changeCount + viewModel.counts.unchangedCount} records`}
              >
                <div className="mb-3">
                  <ChangeKindLegend />
                </div>
                <ChangeList
                  groups={viewModel.groups}
                  selectedChangeId={viewModel.selectedChangeId}
                  onSelectChange={setSelectedChangeId}
                  emptyMessage="Nothing in this scope changed between the two versions. Widen the filters or ask for unchanged records."
                />
              </Panel>

              <ChangeDetail
                detail={viewModel.detail}
                clauseNumberById={viewModel.clauseLabels}
              />

              <div className="space-y-5">
                <ImpactPanel
                  impact={viewModel.impact}
                  clauseNumberById={viewModel.clauseLabels}
                />
                <Panel title="Impact totals" subtitle="Across every change in the comparison">
                  <ImpactTotals totals={viewModel.impactTotals} />
                </Panel>
              </div>
            </div>
          ) : null}

          {viewModel.view === 'text' ? <TextDiffPanel rows={viewModel.text} /> : null}

          {viewModel.view === 'structure' ? (
            <StructureDiffPanel
              rows={viewModel.structure}
              clauseNumberById={viewModel.clauseLabels}
            />
          ) : null}

          {viewModel.view === 'graph' ? (
            <GraphDiffPanel
              graph={viewModel.graph}
              clauseNumberById={viewModel.clauseLabels}
              selectedRowId={
                viewModel.graph.selectedNode?.id ?? viewModel.graph.selectedEdge?.id ?? null
              }
              onSelectRow={(row) =>
                setSelectedGraphRow(
                  row?.nodeId ? { kind: 'node', id: row.nodeId } : { kind: 'edge', id: row.relationshipId },
                )
              }
            />
          ) : null}
        </>
      )}

      <ClausePairPanel />
    </div>
  );
}

export default ComparePage;

