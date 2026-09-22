/**
 * ObligationBoard — "My Obligations" and its mirror, the rights view.
 *
 * Every card answers the same questions in the same order: who is responsible,
 * what they must do, who benefits, what triggers it, when it is due and what
 * follows a failure — then the source clause and the citations. Cards are grouped
 * by how the deterministic assessment sees them, never merged into one score.
 *
 * The rights toggle reads the same clauses from the other side, so a reader can
 * switch without losing the clause they were reading.
 */

import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Badge, obligationStatusTone, severityTone } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { Callout, EmptyState, Panel } from '../ui/Panel.jsx';
import { EvidenceList } from '../legal/EvidenceList.jsx';
import { clauseNumberMap, describeDueIn, formatDate, obligationStatusLabel } from '../legal/presentation.js';
import { filterObligationCards } from '../../legal/obligationViews.js';

function FactRow({ label, children }) {
  if (!children) return null;
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <span className="min-w-[7.5rem] font-semibold text-ink-700">{label}</span>
      <span className="min-w-0 flex-1 text-ink-800">{children}</span>
    </div>
  );
}

/** One obligation card with every field a reader needs. */
export function ObligationCard({ card, clauseNumberById = new Map(), onSelect }) {
  return (
    <li className="rounded border border-ink-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">{card.summary}</p>
          <p className="mt-0.5 text-xs text-ink-500">{card.ariaLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={obligationStatusTone(card.status)}>{obligationStatusLabel(card.status)}</Badge>
          <Badge tone="neutral">{card.standard}</Badge>
          {card.clause ? <Badge tone="muted">§{card.clause.number ?? 'unnumbered'}</Badge> : null}
        </div>
      </div>

      <div className="mt-2 space-y-1">
        <FactRow label="Responsible">{card.responsibleName}</FactRow>
        <FactRow label="Action">{card.actionText ?? card.summary}</FactRow>
        <FactRow label="Owed to">{card.recipientName}</FactRow>
        <FactRow label="Trigger">{card.trigger?.text}</FactRow>
        <FactRow label="Deadline">
          {card.deadline ? (
            <>
              {card.deadline.date ? (
                <>
                  {formatDate(card.deadline.date)} · {describeDueIn(card.daysUntilDue)}
                </>
              ) : card.deadline.relativeExpression ? (
                <>
                  Relative wording kept: “{card.deadline.relativeExpression}”.{' '}
                  {card.deadline.resolutionNote}
                </>
              ) : (
                card.deadline.resolutionNote ?? 'No date information extracted.'
              )}
            </>
          ) : (
            'No deadline recorded for this duty.'
          )}
        </FactRow>
        <FactRow label="Consequence">
          {card.consequences.length ? (
            <ul className="space-y-1">
              {card.consequences.map((consequence) => (
                <li key={consequence.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={severityTone(consequence.severity)}>{consequence.severity}</Badge>
                  <span>{consequence.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            'No consequence is linked to this duty.'
          )}
        </FactRow>
        <FactRow label="Source">{card.clauseLabel ?? 'No clause is linked to this duty.'}</FactRow>
      </div>

      <div className="mt-2">
        <EvidenceList evidence={card.evidence} clauseNumberById={clauseNumberById} compact />
      </div>

      {onSelect ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => onSelect(card)}>
            Show in graph
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** One right, read as the mirror of the duties in the same clause. */
export function RightCard({ right, clauseNumberById = new Map() }) {
  return (
    <li className="rounded border border-ink-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink-900">{right.summary}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{right.holderName}</Badge>
          {right.counterpartyName ? (
            <Badge tone="neutral">against {right.counterpartyName}</Badge>
          ) : null}
          {right.clause ? <Badge tone="muted">§{right.clause.number ?? 'unnumbered'}</Badge> : null}
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <FactRow label="May">{right.action ?? right.summary}</FactRow>
        <FactRow label="Condition">{right.condition}</FactRow>
        <FactRow label="Limitations">
          {right.limitations.length ? right.limitations.join(' · ') : 'None recorded.'}
        </FactRow>
        <FactRow label="Related duties">
          {right.relatedObligations.length ? (
            <ul className="space-y-1">
              {right.relatedObligations.map((obligation) => (
                <li key={obligation.id}>
                  {obligation.summary}{' '}
                  <span className="text-xs text-ink-500">
                    ({obligation.obligorName}
                    {obligation.sameClause ? ', same clause' : ''})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            'No duty recorded in this clause.'
          )}
        </FactRow>
        <FactRow label="Source">{right.clauseLabel ?? 'No clause is linked to this right.'}</FactRow>
      </div>
      <div className="mt-2">
        <EvidenceList evidence={right.evidence} clauseNumberById={clauseNumberById} compact />
      </div>
    </li>
  );
}

/**
 * The board itself: a switch between obligations and rights, group and party
 * filters, a search box and the cards. Empty groups can be shown on request,
 * because "nothing recorded here" is information too.
 */
export function ObligationBoard({
  board,
  rightsBoard,
  model,
  view = 'obligations',
  groupId = null,
  partyId = null,
  query = '',
  onChange,
  onSelectObligation,
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const clauseNumbers = clauseNumberMap(model);

  if (!board) {
    return <EmptyState icon={ArrowLeftRight} message="Load a document to see its obligations." />;
  }

  const isRights = view === 'rights';
  const needle = query.trim().toLowerCase();
  const filteredCards = filterObligationCards(board.cards, { groupId, partyId, searchText: query });
  const visibleGroups = board.groups
    .map((group) => {
      const cards = filteredCards.filter((card) => card.groupId === group.id);
      return { ...group, cards, count: cards.length };
    })
    .filter(
      (group) =>
        group.count > 0 ||
        (showEmpty && !groupId && !partyId && !needle && group.cards.length === 0),
    );
  const obligationFilterActive = Boolean(groupId || partyId || needle);
  const rights = isRights
    ? (rightsBoard?.rights ?? []).filter((right) => {
        if (partyId && right.holderId !== partyId) return false;
        if (!needle) return true;
        return [right.summary, right.holderName, right.counterpartyName, right.clauseLabel]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={isRights ? 'quiet' : 'primary'}
          onClick={() => onChange?.({ view: 'obligations' })}
        >
          My obligations
        </Button>
        <Button
          size="sm"
          variant={isRights ? 'primary' : 'quiet'}
          onClick={() => onChange?.({ view: 'rights' })}
        >
          Rights
        </Button>
        <span className="text-xs text-ink-500">
          {isRights
            ? `${rightsBoard?.counts.total ?? 0} right(s) recorded`
            : `${board.counts.total} obligation(s) recorded`}
        </span>
      </div>

      {!isRights ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="obligation-group">
            Group
          </label>
          <select
            id="obligation-group"
            className="rounded border border-ink-200 bg-surface px-2 py-1 text-sm text-ink-800"
            value={groupId ?? ''}
            onChange={(event) => onChange?.({ groupId: event.target.value || null })}
          >
            <option value="">All groups</option>
            {board.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label} ({group.count})
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="obligation-party">
            Responsible party
          </label>
          <select
            id="obligation-party"
            className="rounded border border-ink-200 bg-surface px-2 py-1 text-sm text-ink-800"
            value={partyId ?? ''}
            onChange={(event) => onChange?.({ partyId: event.target.value || null })}
          >
            <option value="">Every party</option>
            {board.parties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.name} ({party.count})
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="obligation-search">
            Search obligations
          </label>
          <input
            id="obligation-search"
            type="search"
            className="rounded border border-ink-200 bg-surface px-2 py-1 text-sm text-ink-800"
            placeholder="Search duties and clauses"
            value={query}
            onChange={(event) => onChange?.({ query: event.target.value })}
          />

          <Button size="sm" variant="ghost" onClick={() => setShowEmpty((current) => !current)}>
            {showEmpty ? 'Hide empty groups' : 'Show empty groups'}
          </Button>
        </div>
      ) : null}

      <Callout
        tone="info"
        title={isRights ? 'Rights are the same facts, read the other way' : 'How to read these cards'}
      >
        {isRights ? rightsBoard?.disclaimer : board.disclaimer}
      </Callout>

      {isRights ? (
        rights.length ? (
          <Panel title="Rights" subtitle={`${rights.length} shown`}>
            <ul className="space-y-3">
              {rights.map((right) => (
                <RightCard key={right.id} right={right} clauseNumberById={clauseNumbers} />
              ))}
            </ul>
          </Panel>
        ) : (
          <p className="text-sm text-ink-600">
            No right is recorded for this filter. The document may still grant rights this extraction
            did not capture — check the clauses directly.
          </p>
        )
      ) : visibleGroups.filter((group) => group.count > 0).length === 0 ? (
        <p className="text-sm text-ink-600">
          {obligationFilterActive
            ? 'No obligation matches these filters.'
            : 'No obligation was extracted from this document.'}
        </p>
      ) : (
        visibleGroups
          .filter((group) => group.count > 0)
          .map((group) => (
            <Panel
              key={group.id}
              title={group.label}
              subtitle={`${group.count} card(s) — ${group.description}`}
            >
              <ul className="space-y-3">
                {group.cards.map((card) => (
                  <ObligationCard
                    key={card.id}
                    card={card}
                    clauseNumberById={clauseNumbers}
                    onSelect={onSelectObligation}
                  />
                ))}
              </ul>
            </Panel>
          ))
      )}
    </div>
  );
}

export default ObligationBoard;
