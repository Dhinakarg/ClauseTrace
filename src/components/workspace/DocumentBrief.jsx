import { AITracePanel } from './AITracePanel.jsx';
/**
 * DocumentBrief â€” the Phase 1 summary view of a document.
 *
 * Kept as its own component because the Phase 2 workspace adds a reading view
 * alongside it; the brief remains the "what does this document require, and what
 * could not be verified" surface.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button.jsx';
import { Badge } from '../ui/Badge.jsx';
import { Callout, DefinitionList, KeyValue, Panel, ProgressMeter, StatTile } from '../ui/Panel.jsx';
import { ObligationTable } from '../legal/ObligationTable.jsx';
import { InconsistencyList, RiskList } from '../legal/FindingsList.jsx';
import { ClauseOutline, DefinitionList as TermList, PartyList, RightList } from '../legal/ClauseOutline.jsx';
import { clauseNumberMap, formatDate } from '../legal/presentation.js';
import { routeBuilders } from '../../app/navigation.js';
import { useAppStore } from '../../app/AppProvider.jsx';
import {
  selectAllObligationRows,
  selectClauseOutline,
  selectDefinitions,
  selectPartyRows,
  selectRights,
  selectTrustSummary,
  selectWorkspaceSummary,
} from '../../state/selectors.js';

export function DocumentBrief() {
  const state = useAppStore();
  const navigate = useNavigate();
  const [selectedEntityId, setSelectedEntityId] = useState(null);

  const summary = selectWorkspaceSummary(state);
  const trust = selectTrustSummary(state);
  const obligations = selectAllObligationRows(state);
  const parties = selectPartyRows(state);
  const outline = selectClauseOutline(state);
  const definitions = selectDefinitions(state);
  const rights = selectRights(state);

  const model = summary.model;
  const clauseNumbers = useMemo(() => clauseNumberMap(model), [model]);
  const partyById = useMemo(
    () => new Map((model?.parties ?? []).map((party) => [party.id, party])),
    [model],
  );

  if (!summary.ready) {
    return null;
  }

  const counts = summary.counts;
  const obligationsByStatus = summary.obligations?.byStatus ?? {};

  return (
    <div className="space-y-5">
      <AITracePanel summary={summary} trust={trust} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Clauses detected"
          value={counts.clauses}
          hint="Determined by the parser, not the model"
        />
        <StatTile
          label="Obligations"
          value={counts.obligations}
          hint={`${obligationsByStatus.overdue ?? 0} past due Â· ${obligationsByStatus.due ?? 0} due soon`}
          tone={(obligationsByStatus.overdue ?? 0) > 0 ? 'critical' : 'neutral'}
        />
        <StatTile
          label="Deadlines resolved"
          value={summary.timeline?.counts.dated ?? 0}
          hint={`${summary.timeline?.counts.undated ?? 0} could not be dated`}
        />
        <StatTile
          label="Relationships"
          value={summary.graphStats?.relationshipCount ?? 0}
          hint={`${summary.graphStats?.orphanNodeCount ?? 0} unconnected node(s)`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel
          title="Document"
          subtitle={model.documents?.[0]?.documentType}
          className="lg:col-span-2"
        >
          <DefinitionList className="sm:grid-cols-3">
            <KeyValue label="Title">{model.documents?.[0]?.title}</KeyValue>
            <KeyValue label="Effective date">{formatDate(model.documents?.[0]?.effectiveDate)}</KeyValue>
            <KeyValue label="Pages">{model.documents?.[0]?.pageCount ?? 'â€”'}</KeyValue>
            <KeyValue label="Characters">
              {(summary.entry.content?.charCount ?? 0).toLocaleString()}
            </KeyValue>
            <KeyValue label="Parties">{counts.parties}</KeyValue>
            <KeyValue label="Definitions">{counts.definitions}</KeyValue>
          </DefinitionList>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ProgressMeter
              value={summary.coverage?.coverageRatio ?? 0}
              label="Facts with a verified citation"
              tone={(summary.coverage?.coverageRatio ?? 0) < 0.6 ? 'warning' : 'accent'}
            />
            <div className="text-xs text-ink-600">
              <p>
                Facts removed on evidence: {trust.evidence?.rejectedEntities ?? 0} Â· validation
                errors: {trust.validation?.errorCount ?? 0}
              </p>
              <p className="mt-0.5">
                Relationships: {trust.counts?.derivedRelationshipCount ?? 0} derived deterministically
                Â· {trust.rejectedRelationships?.length ?? 0} rejected as invalid
              </p>
            </div>
          </div>

          {summary.gaps?.length > 0 ? (
            <div className="mt-4 space-y-2">
              {summary.gaps.map((gap) => (
                <p key={gap.code} className="flex items-start gap-2 text-sm text-ink-700">
                  <Badge tone={gap.severity === 'warning' ? 'warning' : 'neutral'}>{gap.severity}</Badge>
                  {gap.message}
                </p>
              ))}
              <div>
                <Button size="sm" onClick={() => navigate(routeBuilders.prepare(model.documentId))}>
                  Open review preparation
                </Button>
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel title="Parties" subtitle={`${parties.length} identified`}>
          <PartyList
            rows={parties}
            obligations={obligations}
            activePartyId={selectedEntityId}
            onSelect={(party) => setSelectedEntityId(party.id)}
          />
          {selectedEntityId ? (
            <div className="mt-3 rounded border border-accent-200 bg-accent-50 p-2.5 text-xs text-ink-700">
              <p className="font-medium text-ink-900">
                {partyById.get(selectedEntityId)?.name ?? 'Selected party'}
              </p>
              <p className="mt-0.5">
                {partyById.get(selectedEntityId)?.role?.replace(/-/g, ' ')} Â·{' '}
                {obligations.filter((row) => row.obligation.obligorPartyId === selectedEntityId).length}{' '}
                obligation(s) on record
              </p>
            </div>
          ) : null}
        </Panel>
      </div>

      <Panel
        title="Obligations"
        subtitle={`${counts.obligations} extracted Â· statuses are schedule signals, not legal conclusions`}
        actions={
          <Button size="sm" onClick={() => navigate(routeBuilders.timeline(model.documentId))}>
            View timeline
          </Button>
        }
      >
        <ObligationTable rows={obligations} clauseNumberById={clauseNumbers} />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Clause outline" subtitle="Parser output with extracted-fact markers">
          <ClauseOutline clauses={outline} />
        </Panel>

        <Panel title="Risk signals" subtitle={`${summary.risks.length} flagged`}>
          <RiskList rows={summary.risks} clauseNumberById={clauseNumbers} />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Inconsistencies" subtitle={`${summary.inconsistencies.length} detected`}>
          <InconsistencyList rows={summary.inconsistencies} clauseNumberById={clauseNumbers} />
        </Panel>

        <div className="space-y-5">
      <AITracePanel summary={summary} trust={trust} />
          <Panel title="Defined terms" subtitle={`${definitions.length} extracted`}>
            <TermList definitions={definitions} />
          </Panel>
          <Panel title="Rights" subtitle={`${rights.length} extracted`}>
            <RightList rights={rights} partiesById={partyById} />
          </Panel>
        </div>
      </div>

      <Callout tone="warning" title="How to read these findings">
        Obligation statuses come from dates written in the document and are calculated in your
        browser. They tell you what is due and when, not what you should do about it. Risk signals
        and inconsistencies are proposals that survived citation checks; each one shows the text it
        was drawn from so you can judge it yourself.
      </Callout>
    </div>
  );
}

export default DocumentBrief;

