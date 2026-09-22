/**
 * IntelligencePanel — right pane of the workspace.
 *
 * Shows what was extracted for the current selection (a clause, or the whole
 * document). Each fact carries its citations, and a fact whose citation could
 * not be verified is labelled as such. Nothing here is presented as a legal
 * conclusion; the panel states provenance and verification state only.
 */

import { CornerDownRight, Layers } from 'lucide-react';
import { Badge, severityTone } from '../ui/Badge.jsx';
import { EvidenceList } from '../legal/EvidenceList.jsx';
import { factRows, factSubtitle, factTitle, groupFactsByType } from '../legal/factPresentation.js';

export function IntelligencePanel({
  facts = [],
  clauseNumberById = null,
  partyName = () => null,
  selectedEntityId = null,
  onSelect = null,
  onShowSource = null,
  scopeLabel = 'whole document',
  emptyMessage = 'No extracted facts cite this selection.',
}) {
  const groups = groupFactsByType(facts);

  return (
    <div className="min-h-0 overflow-auto">
      <header className="flex items-center justify-between gap-2 border-b border-ink-200 px-3 py-2.5">
        <div className="min-w-0">
          <p className="label-eyebrow">Extracted intelligence</p>
          <p className="mt-0.5 truncate text-xs text-ink-600">{scopeLabel}</p>
        </div>
        <Badge tone="neutral">{facts.length} fact(s)</Badge>
      </header>

      {groups.length === 0 ? (
        <p className="px-3 py-4 text-xs text-ink-500">{emptyMessage}</p>
      ) : (
        <div className="space-y-4 px-3 py-3">
          {groups.map((group) => (
            <section key={group.type}>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-label text-ink-500">
                <Layers aria-hidden="true" className="h-3 w-3" />
                {group.label} · {group.items.length}
              </h3>
              <ul className="space-y-2">
                {group.items.map((fact) => (
                  <FactCard
                    key={fact.entity.id}
                    fact={fact}
                    clauseNumberById={clauseNumberById}
                    partyName={partyName}
                    isSelected={fact.entity.id === selectedEntityId}
                    onSelect={onSelect}
                    onShowSource={onShowSource}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FactCard({ fact, clauseNumberById, partyName, isSelected, onSelect, onShowSource }) {
  const { entity, entityType } = fact;
  const rows = isSelected
    ? factRows(entity, entityType, {
        clauseNumber: (id) => (id ? clauseNumberById?.get?.(id) ?? null : null),
        partyName,
      })
    : [];
  const severity = entity.severity ?? null;

  return (
    <li
      className={[
        'rounded border p-2.5',
        isSelected ? 'border-accent-300 bg-accent-50/60' : 'border-ink-200 bg-surface',
      ].join(' ')}
    >
      <button type="button" onClick={() => onSelect?.(isSelected ? null : fact)} className="w-full text-left">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink-900 break-words">
              {factTitle(entity, entityType)}
            </span>
            {factSubtitle(entity, entityType, { partyName }) ? (
              <span className="mt-0.5 block text-xs text-ink-500 break-words">
                {factSubtitle(entity, entityType, { partyName })}
              </span>
            ) : null}
          </span>
          {severity ? (
            <Badge tone={severityTone(severity)}>{severity}</Badge>
          ) : (
            <Badge tone="muted">{entityType}</Badge>
          )}
        </span>
      </button>

      {isSelected && rows.length > 0 ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-accent-200 pt-2">
          {rows.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="text-2xs font-semibold uppercase tracking-label text-ink-500">
                {row.label}
              </dt>
              <dd className="truncate text-xs text-ink-800" title={String(row.value)}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-2">
        <EvidenceList evidence={fact.references} clauseNumberById={clauseNumberById} compact />
      </div>

      {onShowSource ? (
        <button
          type="button"
          onClick={() =>
            onShowSource({
              clauseId: fact.clauseIds[0] ?? entity.clauseId ?? null,
              reference: fact.references[0] ?? null,
            })
          }
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700"
        >
          <CornerDownRight aria-hidden="true" className="h-3 w-3" />
          Show this passage in the document
        </button>
      ) : null}
    </li>
  );
}

export default IntelligencePanel;
