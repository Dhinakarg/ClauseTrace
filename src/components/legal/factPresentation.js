/**
 * Fact presentation.
 *
 * Turns a model entity into a title, a one-line context and a small table of
 * fields, so the workspace's right-hand pane can show extracted intelligence
 * without a component per entity type.
 *
 * Pure functions only: they take the model (for id → name lookups) and return
 * plain data. Severity and verification wording is deliberately cautious —
 * these are extracted facts, not conclusions.
 */

/** Labels and ordering for the extracted-fact groups. */
export const FACT_TYPE_LABELS = Object.freeze({
  party: 'Parties',
  definition: 'Defined terms',
  right: 'Rights',
  obligation: 'Obligations',
  condition: 'Conditions',
  deadline: 'Deadlines',
  consequence: 'Consequences',
  risk: 'Risk signals',
  inconsistency: 'Inconsistencies',
});

const FACT_TYPE_ORDER = Object.freeze([
  'obligation',
  'right',
  'deadline',
  'condition',
  'consequence',
  'party',
  'definition',
  'risk',
  'inconsistency',
]);

/** Groups facts by entity type, keeping a stable, reading-friendly order. */
export function groupFactsByType(facts = []) {
  const groups = new Map();
  for (const fact of facts) {
    const type = fact?.entityType ?? 'unknown';
    groups.set(type, [...(groups.get(type) ?? []), fact]);
  }
  return [...groups.entries()]
    .map(([type, items]) => ({
      type,
      label: FACT_TYPE_LABELS[type] ?? String(type).replace(/-/g, ' '),
      items,
    }))
    .sort((a, b) => {
      const left = FACT_TYPE_ORDER.indexOf(a.type);
      const right = FACT_TYPE_ORDER.indexOf(b.type);
      return (left < 0 ? 99 : left) - (right < 0 ? 99 : right) || a.label.localeCompare(b.label);
    });
}

/** One-line headline for a fact. */
export function factTitle(entity, entityType) {
  if (!entity) return 'Unknown entry';
  switch (entityType) {
    case 'party':
      return entity.name ?? 'Unnamed party';
    case 'definition':
      return entity.term ?? 'Defined term';
    case 'obligation':
    case 'right':
    case 'condition':
      return entity.summary ?? 'Entry';
    case 'deadline':
    case 'consequence':
      return entity.description ?? 'Entry';
    case 'risk':
    case 'inconsistency':
      return entity.title ?? 'Finding';
    default:
      return entity.id ?? 'Entry';
  }
}

/** Secondary line: who or what the fact applies to. */
export function factSubtitle(entity, entityType, { partyName = () => null } = {}) {
  if (!entity) return null;
  switch (entityType) {
    case 'party':
      return [entity.role?.replace(/-/g, ' '), entity.entityKind, entity.jurisdiction]
        .filter(Boolean)
        .join(' · ');
    case 'obligation': {
      const obligor = partyName(entity.obligorPartyId);
      const obligee = partyName(entity.obligeePartyId);
      if (obligor && obligee) return `${obligor} owes ${obligee}`;
      return obligor ? `${obligor} is responsible` : null;
    }
    case 'right': {
      const holder = partyName(entity.holderPartyId);
      return holder ? `Held by ${holder}` : null;
    }
    case 'deadline':
      return [
        entity.dateType,
        entity.event,
        entity.responsiblePartyId ? partyName(entity.responsiblePartyId) : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'condition':
      return [entity.conditionType?.replace(/-/g, ' '), entity.activates].filter(Boolean).join(' · ');
    case 'consequence':
      return [entity.consequenceType, entity.severity].filter(Boolean).join(' · ');
    case 'definition':
      return entity.scope ? `Scope: ${entity.scope}` : null;
    default:
      return null;
  }
}

/** Field rows for the detail view. Values are plain strings or null. */
export function factRows(
  entity,
  entityType,
  { clauseNumber = () => null, partyName = () => null } = {},
) {
  if (!entity) return [];
  const rows = [
    { label: 'Clause', value: clauseNumber(entity.clauseId) },
    { label: 'Provenance', value: entity.provenance ?? null },
  ];

  switch (entityType) {
    case 'obligation':
      rows.push(
        { label: 'Action', value: entity.action },
        { label: 'Obligor', value: partyName(entity.obligorPartyId) },
        { label: 'Obligee', value: partyName(entity.obligeePartyId) },
        { label: 'Standard', value: entity.standard },
        { label: 'Trigger', value: entity.triggerText },
        { label: 'Deadline', value: entity.deadlineText },
        { label: 'Consequence', value: entity.consequenceText },
        { label: 'Informational', value: entity.informational ? 'yes' : 'no' },
      );
      break;
    case 'right':
      rows.push(
        { label: 'Action', value: entity.action },
        { label: 'Condition', value: entity.condition },
        { label: 'Holder', value: partyName(entity.holderPartyId) },
        { label: 'Against', value: partyName(entity.counterpartyPartyId) },
      );
      break;
    case 'deadline':
      rows.push(
        { label: 'Date', value: entity.date },
        { label: 'Date type', value: entity.dateType },
        { label: 'Event', value: entity.event },
        {
          label: 'Offset',
          value: entity.offset ? `${entity.offset.amount} ${entity.offset.unit}(s)` : null,
        },
        { label: 'Recurrence', value: entity.recurrence },
        { label: 'Responsible', value: partyName(entity.responsiblePartyId) },
      );
      break;
    case 'condition':
      rows.push(
        { label: 'Type', value: entity.conditionType },
        { label: 'Activates', value: entity.activates },
        { label: 'Trigger text', value: entity.triggerDescription },
      );
      break;
    case 'consequence':
      rows.push(
        { label: 'Type', value: entity.consequenceType },
        { label: 'Severity', value: entity.severity },
        { label: 'Triggering event', value: entity.event },
        { label: 'Affected party', value: partyName(entity.affectedPartyId) },
      );
      break;
    case 'party':
      rows.push(
        { label: 'Role', value: entity.role },
        { label: 'Kind', value: entity.entityKind },
        { label: 'Jurisdiction', value: entity.jurisdiction },
        { label: 'Also called', value: (entity.aliases ?? []).join(', ') || null },
      );
      break;
    case 'definition':
      rows.push(
        { label: 'Scope', value: entity.scope },
        { label: 'Text', value: entity.text },
      );
      break;
    case 'risk':
      rows.push(
        { label: 'Category', value: entity.category },
        { label: 'Severity', value: entity.severity },
        { label: 'Explanation', value: entity.explanation },
      );
      break;
    case 'inconsistency':
      rows.push(
        { label: 'Type', value: entity.inconsistencyType },
        { label: 'Severity', value: entity.severity },
        { label: 'Description', value: entity.description },
      );
      break;
    default:
      break;
  }

  return rows.filter((row) => row.value !== null && row.value !== undefined && row.value !== '');
}
