/**
 * Shared helpers for legal presentation components.
 *
 * These functions are pure and React-free so they can be unit tested and reused
 * by pages without pulling components in.
 */

import { getEntitiesByType, ENTITY_TYPES, entityLabel } from '../../legal/schema.js';

/** id → clause number map, used to label evidence citations. */
export function clauseNumberMap(model) {
  const map = new Map();
  for (const clause of getEntitiesByType(model, ENTITY_TYPES.CLAUSE)) {
    map.set(clause.id, clause.number ?? clause.heading ?? null);
  }
  return map;
}

/** id → any entity map across the model's collections. */
export function entityMap(model) {
  const map = new Map();
  for (const clause of getEntitiesByType(model, ENTITY_TYPES.CLAUSE)) map.set(clause.id, clause);
  for (const party of getEntitiesByType(model, ENTITY_TYPES.PARTY)) map.set(party.id, party);
  for (const entity of getEntitiesByType(model, ENTITY_TYPES.OBLIGATION)) map.set(entity.id, entity);
  for (const entity of getEntitiesByType(model, ENTITY_TYPES.DEADLINE)) map.set(entity.id, entity);
  for (const entity of getEntitiesByType(model, ENTITY_TYPES.CONDITION)) map.set(entity.id, entity);
  for (const entity of getEntitiesByType(model, ENTITY_TYPES.CONSEQUENCE)) map.set(entity.id, entity);
  for (const entity of getEntitiesByType(model, ENTITY_TYPES.RISK)) map.set(entity.id, entity);
  for (const entity of getEntitiesByType(model, ENTITY_TYPES.DEFINITION)) map.set(entity.id, entity);
  for (const entity of getEntitiesByType(model, ENTITY_TYPES.RIGHT)) map.set(entity.id, entity);
  return map;
}

/** "§3.1" style clause reference, safe for null. */
export function clauseReference(clause) {
  if (!clause) return 'no clause';
  if (clause.number) return `\u00a7${clause.number}`;
  return clause.heading ?? 'unnamed clause';
}

export function entityDisplayName(model, id) {
  const map = entityMap(model);
  const entity = id ? map.get(id) : null;
  return entity ? entityLabel(entity) : 'not identified';
}

/** Orders severity values from most to least urgent for sorting. */
export const SEVERITY_RANK = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  unknown: 5,
});

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? SEVERITY_RANK.unknown;
}

export const OBLIGATION_STATUS_LABELS = Object.freeze({
  overdue: 'Past due',
  due: 'Due soon',
  upcoming: 'Upcoming',
  conditional: 'Conditional',
  informational: 'Informational',
  unknown: 'Unclear timing',
});

export function obligationStatusLabel(status) {
  return OBLIGATION_STATUS_LABELS[status] ?? 'Unclear timing';
}

/** Formats an ISO date for display without assuming a locale-dependent parser. */
export function formatDate(value) {
  if (!value) return 'not stated';
  const iso = String(value).slice(0, 10);
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
}

/** "in 12 days" / "34 days overdue" style copy for a due date. */
export function describeDueIn(daysUntilDue) {
  if (daysUntilDue === null || daysUntilDue === undefined) return 'due date not resolved';
  if (daysUntilDue === 0) return 'due today';
  if (daysUntilDue > 0) return `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
  const overdue = Math.abs(daysUntilDue);
  return `${overdue} day${overdue === 1 ? '' : 's'} past`;
}
