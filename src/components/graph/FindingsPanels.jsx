/**
 * Findings panels — risk signals and potential inconsistencies.
 *
 * Both panels show the same three things for every item: why it was flagged, the
 * exact words the check matched, and where in the document it appears. Items the
 * extraction provider proposed are labelled as such and never mixed into the
 * deterministic counts.
 */

import { useMemo, useState } from 'react';
import { Badge, severityTone } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { Callout, Panel } from '../ui/Panel.jsx';
import { EvidenceList } from '../legal/EvidenceList.jsx';
import { RISK_RULES, groupSignalsByCategory } from '../../legal/riskRules.js';

function FindingCard({ item, clauseNumberById, source, duplicateNote = null }) {
  return (
    <li className="rounded border border-ink-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>
          <span className="text-sm font-semibold text-ink-900">{item.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={source === 'rule' ? 'accent' : 'warning'}>
            {source === 'rule' ? 'deterministic check' : 'proposed by provider'}
          </Badge>
          <Badge tone="neutral">{item.category ?? item.inconsistencyType}</Badge>
          {item.clauseNumber ? <Badge tone="muted">§{item.clauseNumber}</Badge> : null}
        </div>
      </div>

      <dl className="mt-2 space-y-1 text-sm text-ink-700">
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold text-ink-800">Why detected:</dt>
          <dd className="min-w-0 flex-1">{item.detection.why}</dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold text-ink-800">Where it appears:</dt>
          <dd className="min-w-0 flex-1">{item.detection.where}</dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold text-ink-800">Check:</dt>
          <dd className="min-w-0 flex-1">{item.detection.ruleLabel}</dd>
        </div>
      </dl>

      {item.detection.comparison ? (
        <div className="mt-2 rounded border border-signal-300 bg-signal-50/60 p-2 text-sm">
          <p className="font-semibold text-ink-900">{item.detection.comparison.label}</p>
          <p className="mt-1 text-ink-800">
            {item.detection.comparison.left} <span className="text-ink-500">versus</span>{' '}
            {item.detection.comparison.right}
          </p>
        </div>
      ) : null}

      {item.detection.basis.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-600">
          {item.detection.basis.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {duplicateNote ? <p className="mt-2 text-xs text-ink-500">{duplicateNote}</p> : null}

      {item.evidence.length ? (
        <div className="mt-2">
          <EvidenceList evidence={item.evidence} clauseNumberById={clauseNumberById} compact />
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-500">
          No citation is linked to this item, so it is reported without source text.
        </p>
      )}
    </li>
  );
}

/** Deterministic risk signals, grouped by category, plus provider proposals. */
export function SignalsPanel({ collected, clauseNumberById = new Map() }) {
  const [grouped, setGrouped] = useState(true);
  const groups = useMemo(
    () => groupSignalsByCategory(collected?.signals ?? []),
    [collected?.signals],
  );

  if (!collected) {
    return (
      <Panel title="Risk signals">
        <p className="text-sm text-ink-600">Load a document to run the deterministic checks.</p>
      </Panel>
    );
  }

  const duplicateIds = new Set(collected.duplicates.map((entry) => entry.riskId));

  return (
    <Panel
      title="Risk signals"
      subtitle={`${collected.counts.detected} check result(s) · ${collected.counts.modelProvided} provider entr${collected.counts.modelProvided === 1 ? 'y' : 'ies'}`}
      actions={
        <Button size="sm" variant="ghost" onClick={() => setGrouped((current) => !current)}>
          {grouped ? 'Show as one list' : 'Group by category'}
        </Button>
      }
    >
      <div className="space-y-4">
        <Callout tone="info" title="How to read these">
          {collected.disclaimer}
        </Callout>

        {collected.signals.length === 0 ? (
          <p className="text-sm text-ink-600">
            No deterministic check matched this document. That is not a clean bill of health: it means
            the wording these checks look for was not present in the extracted text.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.category}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                {group.category} · {group.signals.length}
              </h3>
              <ul className="mt-2 space-y-3">
                {group.signals.map((signal) => (
                  <FindingCard
                    key={signal.id}
                    item={signal}
                    clauseNumberById={clauseNumberById}
                    source="rule"
                  />
                ))}
              </ul>
            </section>
          ))
        )}

        {collected.modelRisks.length ? (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Proposed by the extraction provider · {collected.modelRisks.length}
            </h3>
            <ul className="mt-2 space-y-3">
              {collected.modelRisks.map((risk) => (
                <FindingCard
                  key={risk.id}
                  item={risk}
                  clauseNumberById={clauseNumberById}
                  source="model"
                  duplicateNote={
                    duplicateIds.has(risk.id)
                      ? 'A deterministic check also flagged this clause and category, so the two overlap.'
                      : null
                  }
                />
              ))}
            </ul>
          </section>
        ) : null}

        <p className="text-xs text-ink-500">
          Checks that ran: {RISK_RULES.map((rule) => rule.label).join(' · ')}.
        </p>
      </div>
    </Panel>
  );
}

/** Potential inconsistencies, each shown with the two sides that disagree. */
export function InconsistenciesPanel({ collected, clauseNumberById = new Map() }) {
  if (!collected) {
    return (
      <Panel title="Potential inconsistencies">
        <p className="text-sm text-ink-600">Load a document to compare its parts with each other.</p>
      </Panel>
    );
  }
  const duplicateIds = new Set(collected.duplicates.map((entry) => entry.proposedId));

  return (
    <Panel
      title="Potential inconsistencies"
      subtitle={`${collected.counts.detected} found by comparison · ${collected.counts.modelProvided} proposed by the provider`}
    >
      <div className="space-y-4">
        <Callout tone="warning" title={collected.headline}>
          {collected.disclaimer}
        </Callout>

        {collected.detected.length === 0 ? (
          <p className="text-sm text-ink-600">
            No comparison rule found a disagreement between the extracted entities. Two clauses could
            still conflict in wording this app does not compare.
          </p>
        ) : (
          <ul className="space-y-3">
            {collected.detected.map((finding) => (
              <FindingCard
                key={finding.id}
                item={finding}
                clauseNumberById={clauseNumberById}
                source="rule"
              />
            ))}
          </ul>
        )}

        {collected.modelProvided.length ? (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Proposed by the extraction provider · {collected.modelProvided.length}
            </h3>
            <ul className="mt-2 space-y-3">
              {collected.modelProvided.map((finding) => (
                <FindingCard
                  key={finding.id}
                  item={finding}
                  clauseNumberById={clauseNumberById}
                  source="model"
                  duplicateNote={
                    duplicateIds.has(finding.id)
                      ? 'A comparison rule flagged the same type, so the two overlap.'
                      : null
                  }
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Panel>
  );
}

export default SignalsPanel;
