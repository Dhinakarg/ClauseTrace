/**
 * Preparation sections.
 *
 * Presentational components for the Review preparation route: the four sections
 * of the plan (questions to ask, facts to gather, clauses to discuss, changes to
 * discuss), each item with a session checkbox and a link back to the clause it
 * came from. Pure props in, markup out.
 */

import { Link } from 'react-router-dom';
import { ClipboardCheck, ExternalLink, MinusSquare, PlusSquare } from 'lucide-react';
import { Badge, severityTone } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { Panel, StatTile } from '../ui/Panel.jsx';
import { clauseSourceLink } from '../../app/navigation.js';

/** One item: a question when the item is something to ask, otherwise a statement. */
export function PreparationItem({ item, checked = false, onToggle, documentId = null }) {
  const text = item.question ?? item.title;
  return (
    <li className="rounded border border-ink-200 p-2.5">
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          aria-pressed={checked}
          aria-label={checked ? `Mark not done: ${text}` : `Mark done: ${text}`}
          className={checked ? 'mt-0.5 text-positive-500' : 'mt-0.5 text-ink-300 hover:text-ink-500'}
        >
          {checked ? (
            <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
          ) : (
            <PlusSquare aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={[
                'text-sm',
                checked ? 'text-ink-500 line-through' : 'font-medium text-ink-900',
              ].join(' ')}
            >
              {text}
            </p>
            <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>
          </div>

          {item.detail ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-600">{item.detail}</p>
          ) : null}

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            {item.source ? <span className="text-ink-500">{item.source}</span> : null}
            {item.clauseId ? (
              <Link
                to={clauseSourceLink(documentId, item.clauseId)}
                className="inline-flex items-center gap-1 font-medium text-accent-700 hover:underline"
              >
                Read the clause
                <ExternalLink aria-hidden="true" className="h-3 w-3" />
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

/** One section of the plan. */
export function PreparationSectionPanel({
  section,
  checkedIds = null,
  onToggle = () => {},
  documentId = null,
  actions = null,
}) {
  const checked = (id) => Boolean(checkedIds?.has?.(id));
  return (
    <Panel
      title={section.label}
      subtitle={section.description}
      actions={
        <>
          <Badge tone={section.items.length > 0 ? 'accent' : 'muted'}>
            {section.items.length} item{section.items.length === 1 ? '' : 's'}
          </Badge>
          {actions}
        </>
      }
    >
      {section.items.length === 0 ? (
        <p className="text-sm text-ink-600">{section.note ?? 'Nothing to review in this section.'}</p>
      ) : (
        <ul className="space-y-2">
          {section.items.map((item) => (
            <PreparationItem
              key={item.id}
              item={item}
              checked={checked(item.id)}
              onToggle={onToggle}
              documentId={documentId}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Every section, in reading order. */
export function PreparationSectionList({
  plan,
  checkedIds = null,
  onToggle = () => {},
  documentId = null,
  sectionActions = {},
}) {
  if (!plan) return null;
  return (
    <div className="space-y-5">
      {plan.sections.map((section) => (
        <PreparationSectionPanel
          key={section.id}
          section={section}
          checkedIds={checkedIds}
          onToggle={onToggle}
          documentId={documentId}
          actions={sectionActions[section.id] ?? null}
        />
      ))}
    </div>
  );
}

/** Header tiles: how much is on the list and how much is marked done. */
export function PreparationTiles({ plan, summary = null, checkedCount = 0, evidence = null }) {
  const counts = summary ?? plan?.counts ?? { total: 0, bySection: {} };
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Checklist items"
        value={counts.total}
        hint={`${counts.bySection?.questions ?? 0} questions · ${counts.bySection?.facts ?? 0} facts · ${
          counts.bySection?.clauses ?? 0
        } clauses · ${counts.bySection?.changes ?? 0} changes`}
      />
      <StatTile label="Marked done" value={checkedCount} hint="Tracked in this session only" />
      <StatTile
        label="Citations dropped"
        value={evidence?.rejectedEntities ?? 0}
        tone={(evidence?.rejectedEntities ?? 0) > 0 ? 'warning' : 'neutral'}
        hint={`${evidence?.verifiedEntities ?? 0} fact(s) kept with verified source text`}
      />
      <StatTile
        label="Changes to discuss"
        value={plan?.comparison?.changeCount ?? 0}
        hint={
          plan?.comparison?.available
            ? `${plan.comparison.versionA ?? 'Version A'} → ${plan.comparison.versionB ?? 'Version B'}`
            : 'No second version loaded'
        }
      />
    </div>
  );
}

/** Item 4 with a minus sign, for the "mark all done" affordance. */
export function MarkAllDoneButton({ pending = 0, onMarkAll }) {
  if (!pending) return null;
  return (
    <Button size="sm" icon={MinusSquare} onClick={onMarkAll}>
      Mark all done
    </Button>
  );
}
