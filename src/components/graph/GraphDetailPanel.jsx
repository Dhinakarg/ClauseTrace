/**
 * GraphDetailPanel â€” what the selected node is, and why it is here.
 *
 * For every node it shows the type, the trust metadata, its relationships as
 * readable phrases, the citations behind it and the findings that touch it. For a
 * derived risk signal or inconsistency it also shows the rule that fired, the
 * wording that matched and where the match was found, so a reader can check the
 * machine's reasoning against the document.
 */

import { Badge, severityTone } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { Callout, DefinitionList, Panel } from '../ui/Panel.jsx';
import { EvidenceList } from '../legal/EvidenceList.jsx';
import { clauseNumberMap, entityDisplayName } from '../legal/presentation.js';
import { nodeTypeMeta } from '../../legal/graphView.js';
import { signalsForEntity } from '../../legal/riskRules.js';
import { inconsistenciesForEntity } from '../../legal/inconsistencyRules.js';

const PROVENANCE_LABELS = Object.freeze({
  parser: 'read from the document',
  ai: 'proposed by the AI provider, then verified',
  derived: 'derived by this app',
  user: 'edited by you',
  unknown: 'source not recorded',
});

function FindingDetail({ entity }) {
  const detection = entity?.detection;
  if (!detection) return null;
  return (
    <div className="space-y-3">
      <DefinitionList>
        <div>
          <dt>Check that fired</dt>
          <dd>{detection.ruleLabel}</dd>
        </div>
        <div>
          <dt>Why it was detected</dt>
          <dd>{detection.why}</dd>
        </div>
        <div>
          <dt>Where it appears</dt>
          <dd>{detection.where}</dd>
        </div>
      </DefinitionList>
      {detection.comparison ? (
        <div className="rounded border border-signal-300 bg-signal-50/60 p-3 text-sm">
          <p className="font-semibold text-ink-900">{detection.comparison.label}</p>
          <p className="mt-1 text-ink-800">
            {detection.comparison.left} <span className="text-ink-500">versus</span>{' '}
            {detection.comparison.right}
          </p>
          <p className="mt-1 text-xs text-ink-600">Difference: {detection.comparison.difference}</p>
        </div>
      ) : null}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          What the check matched
        </p>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-ink-700">
          {(detection.basis ?? []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RelationshipList({ view, nodeId, onSelectNode }) {
  const neighbours = view?.visibleIndex?.adjacency?.get(nodeId) ?? [];
  if (!neighbours.length) {
    return (
      <p className="text-sm text-ink-600">
        No relationships are visible with the current filters.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {neighbours.map((entry) => {
        const other = view.visibleIndex.nodeById.get(entry.otherId);
        return (
          <li key={entry.relationship.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="neutral">{entry.phrase}</Badge>
            <Button variant="link" size="sm" onClick={() => onSelectNode?.(entry.otherId)}>
              {other?.label ?? entry.otherId}
            </Button>
            <span className="text-xs text-ink-500">{nodeTypeMeta(other?.entityType).label}</span>
            <Badge tone={entry.relationship.provenance === 'derived' ? 'muted' : 'accent'}>
              {entry.relationship.provenance === 'derived' ? 'derived' : 'provider'}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function EntityFacts({ model, entity }) {
  const rows = [];
  const partyId = entity?.obligorPartyId ?? entity?.holderPartyId ?? entity?.responsiblePartyId;
  if (partyId) rows.push({ label: 'Party', value: entityDisplayName(model, partyId) });
  const otherPartyId = entity?.obligeePartyId ?? entity?.counterpartyPartyId;
  if (otherPartyId) rows.push({ label: 'Other party', value: entityDisplayName(model, otherPartyId) });
  if (entity?.clauseId) rows.push({ label: 'Clause id', value: entity.clauseId });
  if (!rows.length) return null;
  return (
    <DefinitionList>
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </DefinitionList>
  );
}

/** A short list of findings that mention one entity, as text. */
function RelatedFindings({ items }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-2">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>
          <span className="text-ink-800">{item.title}</span>
          <span className="text-xs text-ink-500">{item.detection?.ruleLabel ?? item.headline}</span>
        </li>
      ))}
    </ul>
  );
}

export function GraphDetailPanel({
  view,
  model,
  nodeId,
  signals = [],
  inconsistencies = [],
  onSelectNode,
  onOpenTimeline,
  _onOpenObligations,
  onOpenSource,
}) {
  if (!nodeId) {
    return (
      <Panel title="Selected entity" subtitle="Nothing selected yet">
        <p className="text-sm text-ink-600">
          Select an obligation, right, deadline, or finding to see what it connects to.
        </p>
      </Panel>
    );
  }

  const node = view?.index?.nodeById?.get(nodeId) ?? null;
  if (!node) {
    return (
      <Panel title="Selected entity" subtitle="Not part of current view">
        <Callout tone="warning">
          This entity exists in the document but is hidden by current filters. Switch filters or select another item.
        </Callout>
      </Panel>
    );
  }

  const meta = nodeTypeMeta(node.entityType);
  const entity = node.entity ?? null;
  const clauseNumbers = clauseNumberMap(model);
  const isFinding = entity?.detection !== undefined;
  const relatedSignals = isFinding
    ? []
    : signalsForEntity(node.id, signals, { clauseId: node.clauseId ?? null });
  const relatedInconsistencies = isFinding
    ? []
    : inconsistenciesForEntity(node.id, inconsistencies, {
        clauseIds: node.clauseId ? [node.clauseId] : [],
      });

  const nodeFindings = node.findings ?? [];
  const allFindings = [...nodeFindings, ...relatedSignals, ...relatedInconsistencies];

  return (
    <Panel
      title="Selected entity"
      subtitle={node.label}
      actions={
        <div className="flex flex-wrap gap-2">
          {node.clauseId && onOpenSource ? (
            <Button size="sm" variant="primary" onClick={() => onOpenSource(node.clauseId)}>
              View source →
            </Button>
          ) : null}
          {onOpenTimeline ? (
            <Button size="sm" variant="ghost" onClick={() => onOpenTimeline(node)}>
              Timeline
            </Button>
          ) : null}
          {onSelectNode ? (
            <Button size="sm" variant="ghost" onClick={() => onSelectNode(null)}>
              Clear selection
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">
            {meta.shape} Â· {meta.label}
          </Badge>
          <Badge tone={node.provenance === 'derived' ? 'muted' : 'accent'}>
            {PROVENANCE_LABELS[node.provenance] ?? node.provenance}
          </Badge>
          {node.hasFindings ? <Badge tone="warning">âš  Potential findings</Badge> : null}
          {entity?.severity ? (
            <Badge tone={severityTone(entity.severity)}>severity: {entity.severity}</Badge>
          ) : null}
        </div>

        {entity?.summary ? <p className="text-sm font-medium text-ink-900">{entity.summary}</p> : null}
        {entity?.text ? (
          <p className="rounded border border-ink-200 bg-ink-50/60 p-3 text-sm text-ink-700">
            {entity.text}
          </p>
        ) : null}

        {isFinding ? <FindingDetail entity={entity} /> : null}

        <EntityFacts model={model} entity={entity} />

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Relationships</p>
          <div className="mt-2">
            <RelationshipList view={view} nodeId={node.id} onSelectNode={onSelectNode} />
          </div>
        </div>

        {allFindings.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              âš  Findings touching this entity
            </p>
            <RelatedFindings items={allFindings} />
          </div>
        ) : null}

        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Source text ({Array.isArray(entity?.evidence) ? entity.evidence.length : 0} citation(s))
            </p>
            {node.clauseId && onOpenSource ? (
              <button
                type="button"
                onClick={() => onOpenSource(node.clauseId)}
                className="text-xs font-semibold text-accent-700 hover:underline"
              >
                View source evidence →
              </button>
            ) : null}
          </div>
          <div className="mt-2">
            <EvidenceList evidence={entity?.evidence ?? []} clauseNumberById={clauseNumbers} compact />
          </div>
        </div>
      </div>
    </Panel>
  );
}

export default GraphDetailPanel;

