/**
 * Relationship builder.
 *
 * Two responsibilities, both deterministic:
 *
 *  1. `validateRelationshipDrafts` — checks relationship proposals coming from
 *     an AI provider against RELATIONSHIP_SCHEMA and the current id index.
 *     Anything invalid is dropped and reported, never silently accepted.
 *
 *  2. `deriveRelationships` — walks the validated model and CREATES the edges
 *     that the entity fields already imply (obligation → clause, party →
 *     obligation, obligation → deadline ...). This is the "application code
 *     connects what AI proposed" half of the architecture: even a provider that
 *     returns no relationships still produces a traversable graph.
 */

import {
  ENTITY_TYPES,
  RELATIONSHIP_SCHEMA,
  createRelationship,
  getEntitiesByType,
  indexEntities,
} from './schema.js';

/** Builds a dedupe key so the same edge is never added twice. */
export function relationshipKey(type, fromId, toId) {
  return `${type}:${fromId}->${toId}`;
}

/** Indexes existing relationships so derived edges can be de-duplicated. */
function existingKeys(model) {
  const keys = new Set();
  for (const relationship of model.relationships ?? []) {
    keys.add(relationshipKey(relationship.type, relationship.fromId, relationship.toId));
  }
  return keys;
}

/**
 * Validates AI-proposed relationships.
 * Returns { relationships, rejected: [{ relationship, reason }] }.
 */
export function validateRelationshipDrafts(drafts, model, { documentId = null } = {}) {
  const index = indexEntities(model);
  const keys = existingKeys(model);
  const relationships = [];
  const rejected = [];

  for (const draft of drafts ?? []) {
    const schema = RELATIONSHIP_SCHEMA[draft?.type];
    if (!schema) {
      rejected.push({ relationship: draft, reason: `Unknown relationship type "${draft?.type}".` });
      continue;
    }
    const fromId = typeof draft.from === 'string' ? draft.from.trim() : null;
    const toId = typeof draft.to === 'string' ? draft.to.trim() : null;
    if (!fromId || !toId) {
      rejected.push({ relationship: draft, reason: 'Relationship is missing an endpoint id.' });
      continue;
    }
    const fromEntry = index.get(fromId);
    const toEntry = index.get(toId);
    if (!fromEntry || !toEntry) {
      rejected.push({
        relationship: draft,
        reason: `Unknown endpoint(s): ${!fromEntry ? fromId : ''} ${!toEntry ? toId : ''}`.trim(),
      });
      continue;
    }
    if (!schema.from.includes(fromEntry.entityType) || !schema.to.includes(toEntry.entityType)) {
      rejected.push({
        relationship: draft,
        reason: `"${draft.type}" cannot link ${fromEntry.entityType} → ${toEntry.entityType}.`,
      });
      continue;
    }
    const key = relationshipKey(draft.type, fromId, toId);
    if (keys.has(key)) {
      rejected.push({ relationship: draft, reason: 'Duplicate relationship.' });
      continue;
    }
    keys.add(key);
    relationships.push(
      createRelationship({
        type: draft.type,
        fromId,
        toId,
        fromType: fromEntry.entityType,
        toType: toEntry.entityType,
        label: draft.label ?? null,
        documentId,
        provenance: 'ai',
      }),
    );
  }

  return { relationships, rejected };
}

/**
 * Derives the relationships implied by validated entity fields.
 * Returns a NEW array of relationship entities (the input model is untouched).
 */
export function deriveRelationships(model, { documentId = null } = {}) {
  const derived = [];
  const index = indexEntities(model);
  const keys = existingKeys(model);

  const add = (type, fromId, toId, extra = {}) => {
    const schema = RELATIONSHIP_SCHEMA[type];
    if (!schema || !fromId || !toId || fromId === toId) return;
    const fromEntry = index.get(fromId);
    const toEntry = index.get(toId);
    if (!fromEntry || !toEntry) return;
    if (!schema.from.includes(fromEntry.entityType) || !schema.to.includes(toEntry.entityType)) return;
    const key = relationshipKey(type, fromId, toId);
    if (keys.has(key)) return;
    keys.add(key);
    derived.push(
      createRelationship({
        type,
        fromId,
        toId,
        fromType: fromEntry.entityType,
        toType: toEntry.entityType,
        documentId,
        provenance: 'derived',
        label: extra.label ?? null,
      }),
    );
  };

  // Document → parties / clauses.
  for (const document of getEntitiesByType(model, ENTITY_TYPES.DOCUMENT)) {
    for (const partyId of document.partyIds ?? []) add('document-has-party', document.id, partyId);
    for (const clauseId of document.clauseIds ?? []) add('document-has-clause', document.id, clauseId);
  }

  // Clauses → contained facts.
  const clauseFactTypes = [
    [ENTITY_TYPES.DEFINITION, 'clause-defines'],
    [ENTITY_TYPES.OBLIGATION, 'clause-imposes-obligation'],
    [ENTITY_TYPES.RIGHT, 'clause-grants-right'],
    [ENTITY_TYPES.CONDITION, 'clause-states-condition'],
    [ENTITY_TYPES.DEADLINE, 'clause-sets-deadline'],
    [ENTITY_TYPES.CONSEQUENCE, 'clause-states-consequence'],
    [ENTITY_TYPES.RISK, 'clause-flags-risk'],
  ];
  for (const [entityType, relationshipType] of clauseFactTypes) {
    for (const entity of getEntitiesByType(model, entityType)) {
      if (entity.clauseId) add(relationshipType, entity.clauseId, entity.id);
    }
  }

  // Clause → clause references.
  for (const clause of getEntitiesByType(model, ENTITY_TYPES.CLAUSE)) {
    for (const targetId of clause.crossReferences ?? []) add('clause-references', clause.id, targetId);
  }

  // Parties ↔ obligations and rights.
  for (const obligation of getEntitiesByType(model, ENTITY_TYPES.OBLIGATION)) {
    if (obligation.obligorPartyId) {
      add('party-obligated-by', obligation.obligorPartyId, obligation.id);
    }
    if (obligation.obligeePartyId) {
      add('obligation-owed-to', obligation.id, obligation.obligeePartyId);
    }
    if (obligation.deadlineId) {
      add('obligation-has-deadline', obligation.id, obligation.deadlineId);
      add('deadline-anchored-to', obligation.deadlineId, obligation.id);
    }
    if (obligation.triggerConditionId) {
      add('obligation-triggered-by', obligation.id, obligation.triggerConditionId);
      add('condition-triggers', obligation.triggerConditionId, obligation.id);
    }
    for (const consequenceId of obligation.consequenceIds ?? []) {
      add('obligation-results-in', obligation.id, consequenceId);
    }
  }

  for (const right of getEntitiesByType(model, ENTITY_TYPES.RIGHT)) {
    if (right.holderPartyId) add('party-holds-right', right.holderPartyId, right.id);
    if (right.counterpartyPartyId) add('right-held-against', right.id, right.counterpartyPartyId);
  }

  // Conditions and consequences.
  for (const condition of getEntitiesByType(model, ENTITY_TYPES.CONDITION)) {
    if (condition.deadlineId) add('condition-has-deadline', condition.id, condition.deadlineId);
  }
  for (const consequence of getEntitiesByType(model, ENTITY_TYPES.CONSEQUENCE)) {
    if (consequence.triggerConditionId) {
      add('consequence-follows-condition', consequence.id, consequence.triggerConditionId);
    }
    if (consequence.affectedPartyId) {
      add('consequence-affected-party', consequence.id, consequence.affectedPartyId);
    }
  }

  // Deadlines anchored to an explicit entity.
  for (const deadline of getEntitiesByType(model, ENTITY_TYPES.DEADLINE)) {
    if (deadline.anchorEntityId) add('deadline-anchored-to', deadline.id, deadline.anchorEntityId);
  }

  // Findings point at what they concern.
  for (const risk of getEntitiesByType(model, ENTITY_TYPES.RISK)) {
    if (risk.clauseId) add('clause-flags-risk', risk.clauseId, risk.id);
    for (const reference of risk.relatedEntityRefs ?? []) {
      add('risk-about', risk.id, reference?.entityId, { label: reference?.reason ?? null });
    }
  }
  for (const inconsistency of getEntitiesByType(model, ENTITY_TYPES.INCONSISTENCY)) {
    for (const clauseId of inconsistency.clauseIds ?? []) {
      add('inconsistency-between', inconsistency.id, clauseId);
    }
    if (!inconsistency.clauseIds?.length && inconsistency.clauseId) {
      add('inconsistency-between', inconsistency.id, inconsistency.clauseId);
    }
  }

  return derived;
}

/** Merges derived edges into a model without mutating it. */
export function withDerivedRelationships(model, options = {}) {
  const derived = deriveRelationships(model, options);
  if (derived.length === 0) return { model, derived: [] };
  return {
    model: { ...model, relationships: [...(model.relationships ?? []), ...derived] },
    derived,
  };
}
