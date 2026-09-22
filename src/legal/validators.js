/**
 * Deterministic validation for legal models.
 *
 * Principle: AI proposes structured legal information; application code
 * validates it. Invalid output must NEVER silently enter application state.
 *
 * `validateLegalModel` is pure, side-effect free and returns a report:
 *   { valid, errors, warnings, issues, summary }
 * `assertValidModel` throws a ValidationError when the model is unusable.
 */

import {
  CLAUSE_TYPES,
  CONDITION_TARGETS,
  CONDITION_TYPES,
  CONSEQUENCE_TYPES,
  DATE_OFFSET_UNITS,
  DEFINITION_SCOPES,
  DEADLINE_DATE_TYPES,
  DOCUMENT_TYPES,
  EVIDENCE_REQUIRED_TYPES,
  ENTITY_TYPES,
  INCONSISTENCY_TYPES,
  MODEL_COLLECTION_KEYS,
  OBLIGATION_STANDARDS,
  PARTY_ENTITY_KINDS,
  PARTY_ROLES,
  REQUIRED_FIELDS,
  RELATIONSHIP_SCHEMA,
  RELATIONSHIP_TYPES,
  RISK_CATEGORIES,
  SEVERITIES,
  entityTypeForCollectionKey,
  isKnownEntityType,
} from './schema.js';
import { LIMITS } from '../security/limits.js';

export const ISSUE_SEVERITY = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
});

export const ISSUE_CODES = Object.freeze({
  MODEL_NOT_OBJECT: 'model.not-object',
  MODEL_DOCUMENT_MISMATCH: 'model.document-mismatch',
  MODEL_TOO_LARGE: 'model.too-large',
  MODEL_NO_CLAUSES: 'model.no-clauses',
  MODEL_NO_DOCUMENT: 'model.no-document',
  ENTITY_NOT_OBJECT: 'entity.not-object',
  ENTITY_MISSING_ID: 'entity.missing-id',
  ENTITY_UNKNOWN_TYPE: 'entity.unknown-type',
  ENTITY_TYPE_MISMATCH: 'entity.type-collection-mismatch',
  ENTITY_DUPLICATE_ID: 'entity.duplicate-id',
  ENTITY_MISSING_FIELD: 'entity.missing-field',
  ENTITY_DOCUMENT_MISMATCH: 'entity.document-mismatch',
  ENTITY_INVALID_ENUM: 'entity.invalid-enum',
  ENTITY_INVALID_SHAPE: 'entity.invalid-shape',
  ENTITY_MISSING_EVIDENCE: 'entity.missing-evidence',
  ENTITY_UNVERIFIED_EVIDENCE: 'entity.unverified-evidence',
  EVIDENCE_INVALID: 'evidence.invalid',
  EVIDENCE_BAD_CLAUSE_REF: 'evidence.broken-clause-reference',
  EVIDENCE_BAD_SOURCE_REF: 'evidence.broken-source-reference',
  EVIDENCE_BAD_PAGE: 'evidence.bad-page-reference',
  EVIDENCE_BAD_SECTION: 'evidence.bad-section-reference',
  EVIDENCE_BAD_RANGE: 'evidence.bad-character-range',
  REF_BROKEN: 'reference.broken',
  REF_TYPE_MISMATCH: 'reference.type-mismatch',
  REL_TYPE_INVALID: 'relationship.invalid-type',
  REL_ENDPOINT_MISSING: 'relationship.missing-endpoint',
  REL_ENDPOINT_TYPE_MISMATCH: 'relationship.endpoint-type-mismatch',
  REL_SELF_LOOP: 'relationship.self-loop',
  REL_DUPLICATE: 'relationship.duplicate',
});

/** Controlled vocabulary checks per entity type. */
const ENUM_FIELDS = Object.freeze({
  [ENTITY_TYPES.DOCUMENT]: { documentType: DOCUMENT_TYPES },
  [ENTITY_TYPES.PARTY]: { role: PARTY_ROLES, entityKind: PARTY_ENTITY_KINDS },
  [ENTITY_TYPES.CLAUSE]: { clauseType: CLAUSE_TYPES },
  [ENTITY_TYPES.DEFINITION]: { scope: DEFINITION_SCOPES },
  [ENTITY_TYPES.OBLIGATION]: { standard: OBLIGATION_STANDARDS },
  [ENTITY_TYPES.CONDITION]: { conditionType: CONDITION_TYPES, activates: CONDITION_TARGETS },
  [ENTITY_TYPES.DEADLINE]: { dateType: DEADLINE_DATE_TYPES },
  [ENTITY_TYPES.CONSEQUENCE]: {
    consequenceType: CONSEQUENCE_TYPES,
    severity: SEVERITIES,
  },
  [ENTITY_TYPES.RISK]: { category: RISK_CATEGORIES, severity: SEVERITIES },
  [ENTITY_TYPES.INCONSISTENCY]: { inconsistencyType: INCONSISTENCY_TYPES, severity: SEVERITIES },
});

/** Expected entity type for id-bearing fields (broken/mis-typed ref detection). */
const EXPECTED_REF_TYPES = Object.freeze({
  [ENTITY_TYPES.DOCUMENT]: {
    partyIds: ENTITY_TYPES.PARTY,
    clauseIds: ENTITY_TYPES.CLAUSE,
  },
  [ENTITY_TYPES.PARTY]: { definedInClauseIds: ENTITY_TYPES.CLAUSE },
  [ENTITY_TYPES.CLAUSE]: {
    parentClauseId: ENTITY_TYPES.CLAUSE,
    childClauseIds: ENTITY_TYPES.CLAUSE,
    crossReferences: ENTITY_TYPES.CLAUSE,
  },
  [ENTITY_TYPES.DEFINITION]: { clauseId: ENTITY_TYPES.CLAUSE },
  [ENTITY_TYPES.RIGHT]: {
    holderPartyId: ENTITY_TYPES.PARTY,
    counterpartyPartyId: ENTITY_TYPES.PARTY,
    clauseId: ENTITY_TYPES.CLAUSE,
  },
  [ENTITY_TYPES.OBLIGATION]: {
    obligorPartyId: ENTITY_TYPES.PARTY,
    obligeePartyId: ENTITY_TYPES.PARTY,
    clauseId: ENTITY_TYPES.CLAUSE,
    deadlineId: ENTITY_TYPES.DEADLINE,
    triggerConditionId: ENTITY_TYPES.CONDITION,
    consequenceIds: ENTITY_TYPES.CONSEQUENCE,
  },
  [ENTITY_TYPES.CONDITION]: { clauseId: ENTITY_TYPES.CLAUSE, deadlineId: ENTITY_TYPES.DEADLINE },
  [ENTITY_TYPES.DEADLINE]: {
    clauseId: ENTITY_TYPES.CLAUSE,
    anchorEntityId: ENTITY_TYPES.OBLIGATION,
    responsiblePartyId: ENTITY_TYPES.PARTY,
  },
  [ENTITY_TYPES.CONSEQUENCE]: {
    clauseId: ENTITY_TYPES.CLAUSE,
    triggerConditionId: ENTITY_TYPES.CONDITION,
    affectedPartyId: ENTITY_TYPES.PARTY,
  },
  [ENTITY_TYPES.RISK]: { clauseId: ENTITY_TYPES.CLAUSE },
  [ENTITY_TYPES.INCONSISTENCY]: { clauseId: ENTITY_TYPES.CLAUSE },
});

/** Fields holding arrays of ids rather than a single id. */
const ARRAY_REF_FIELDS = Object.freeze(
  new Set([
    'partyIds',
    'clauseIds',
    'definedInClauseIds',
    'childClauseIds',
    'crossReferences',
    'consequenceIds',
  ]),
);

export class ValidationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

function issue(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra };
}

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

/* -------------------------------------------------------------------------- */
/* Entity-level validation                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Validates a single entity's own shape: id, required fields, controlled
 * vocabularies and evidence references. Reference integrity is checked at model
 * level, where the full id index is available.
 */
export function validateEntity(entity, { entityType = null, collectionKey = null } = {}) {
  const issues = [];
  if (!isPlainObject(entity)) {
    return [
      issue(ISSUE_SEVERITY.ERROR, ISSUE_CODES.ENTITY_NOT_OBJECT, 'Entity is not an object.', {
        entityType,
        collectionKey,
      }),
    ];
  }

  const resolvedType =
    entityType ?? (isKnownEntityType(entity.type) ? entity.type : null) ?? entity.type ?? null;

  if (!isNonEmptyString(entity.id)) {
    issues.push(
      issue(ISSUE_SEVERITY.ERROR, ISSUE_CODES.ENTITY_MISSING_ID, 'Entity is missing a non-empty id.', {
        entityType: resolvedType,
        entityId: entity.id ?? null,
        path: 'id',
      }),
    );
  }

  if (!isKnownEntityType(resolvedType)) {
    issues.push(
      issue(
        ISSUE_SEVERITY.ERROR,
        ISSUE_CODES.ENTITY_UNKNOWN_TYPE,
        `Entity type "${resolvedType}" is not a known ClauseGraph entity type.`,
        { entityType: resolvedType, entityId: entity.id ?? null, path: 'type' },
      ),
    );
    return issues;
  }

  if (collectionKey) {
    const expectedType = entityTypeForCollectionKey(collectionKey);
    if (expectedType && expectedType !== resolvedType) {
      issues.push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.ENTITY_TYPE_MISMATCH,
          `Entity of type "${resolvedType}" was found in the "${collectionKey}" collection (expected "${expectedType}").`,
          { entityType: resolvedType, entityId: entity.id ?? null, path: collectionKey },
        ),
      );
    }
  }

  if (resolvedType !== ENTITY_TYPES.RELATIONSHIP && entity.type !== resolvedType) {
    issues.push(
      issue(
        ISSUE_SEVERITY.WARNING,
        ISSUE_CODES.ENTITY_INVALID_SHAPE,
        `Entity "type" field ("${entity.type}") does not match its collection ("${resolvedType}").`,
        { entityType: resolvedType, entityId: entity.id ?? null, path: 'type' },
      ),
    );
  }

  for (const field of REQUIRED_FIELDS[resolvedType] ?? []) {
    const value = entity[field];
    const empty =
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);
    if (empty) {
      issues.push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.ENTITY_MISSING_FIELD,
          `Entity "${entity.id ?? 'unknown'}" is missing required field "${field}".`,
          { entityType: resolvedType, entityId: entity.id ?? null, path: field },
        ),
      );
    }
  }

  for (const [field, allowed] of Object.entries(ENUM_FIELDS[resolvedType] ?? {})) {
    const value = entity[field];
    if (value === null || value === undefined || allowed.includes(value)) continue;
    issues.push(
      issue(
        ISSUE_SEVERITY.WARNING,
        ISSUE_CODES.ENTITY_INVALID_ENUM,
        `Entity "${entity.id ?? 'unknown'}" has unrecognised ${field} "${value}".`,
        { entityType: resolvedType, entityId: entity.id ?? null, path: field },
      ),
    );
  }

  if (resolvedType === ENTITY_TYPES.DEADLINE && entity.offset) {
    const { amount, unit } = entity.offset;
    if (!Number.isFinite(amount) || amount <= 0 || !DATE_OFFSET_UNITS.includes(unit)) {
      issues.push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.ENTITY_INVALID_SHAPE,
          `Deadline "${entity.id ?? 'unknown'}" has an invalid offset (needs a positive amount and a known unit).`,
          { entityType: resolvedType, entityId: entity.id ?? null, path: 'offset' },
        ),
      );
    }
  }

  issues.push(...validateEvidenceList(entity, resolvedType));
  return issues;
}

/** Validates the evidence array of an entity (shape plus mandatory presence). */
export function validateEvidenceList(entity, entityType = null) {
  const issues = [];
  const references = entity?.evidence;
  const requires = EVIDENCE_REQUIRED_TYPES.includes(entityType);
  const missingEvidenceIssue = () =>
    issue(
      ISSUE_SEVERITY.ERROR,
      ISSUE_CODES.ENTITY_MISSING_EVIDENCE,
      `Entity "${entity?.id ?? 'unknown'}" must carry at least one evidence reference.`,
      { entityType, entityId: entity?.id ?? null, path: 'evidence' },
    );

  if (references === undefined || references === null) {
    if (requires) issues.push(missingEvidenceIssue());
    return issues;
  }

  if (!Array.isArray(references)) {
    return [
      issue(
        ISSUE_SEVERITY.ERROR,
        ISSUE_CODES.EVIDENCE_INVALID,
        `Entity "${entity?.id ?? 'unknown'}" has a non-array "evidence" field.`,
        { entityType, entityId: entity?.id ?? null, path: 'evidence' },
      ),
    ];
  }

  if (references.length === 0 && requires) issues.push(missingEvidenceIssue());

  references.forEach((reference, index) => {
    const path = `evidence[${index}]`;
    if (!isPlainObject(reference)) {
      issues.push(
        issue(ISSUE_SEVERITY.ERROR, ISSUE_CODES.EVIDENCE_INVALID, 'Evidence entry is not an object.', {
          entityType,
          entityId: entity?.id ?? null,
          path,
        }),
      );
      return;
    }
    if (!isNonEmptyString(reference.id)) {
      issues.push(
        issue(ISSUE_SEVERITY.ERROR, ISSUE_CODES.EVIDENCE_INVALID, 'Evidence entry is missing an id.', {
          entityType,
          entityId: entity?.id ?? null,
          path: `${path}.id`,
        }),
      );
    }
    if (!isNonEmptyString(reference.documentId)) {
      issues.push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.EVIDENCE_INVALID,
          'Evidence entry is missing a documentId (source reference).',
          { entityType, entityId: entity?.id ?? null, path: `${path}.documentId` },
        ),
      );
    }
    if (!isNonEmptyString(reference.sourceText)) {
      issues.push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.EVIDENCE_INVALID,
          'Evidence entry is missing quoted sourceText.',
          { entityType, entityId: entity?.id ?? null, path: `${path}.sourceText` },
        ),
      );
    }
    if (
      reference.section !== null &&
      reference.section !== undefined &&
      !isNonEmptyString(reference.section) &&
      typeof reference.section !== 'number'
    ) {
      issues.push(
        issue(
          ISSUE_SEVERITY.WARNING,
          ISSUE_CODES.EVIDENCE_BAD_SECTION,
          'Evidence section reference must be a string or number.',
          { entityType, entityId: entity?.id ?? null, path: `${path}.section` },
        ),
      );
    }
    const hasStart = Number.isInteger(reference.startOffset);
    const hasEnd = Number.isInteger(reference.endOffset);
    if (hasStart !== hasEnd) {
      issues.push(
        issue(
          ISSUE_SEVERITY.WARNING,
          ISSUE_CODES.EVIDENCE_BAD_RANGE,
          'Evidence character range needs both startOffset and endOffset.',
          { entityType, entityId: entity?.id ?? null, path },
        ),
      );
    } else if (hasStart && (reference.startOffset < 0 || reference.endOffset <= reference.startOffset)) {
      issues.push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.EVIDENCE_BAD_RANGE,
          'Evidence character range is invalid.',
          { entityType, entityId: entity?.id ?? null, path },
        ),
      );
    }
  });

  if (
    requires &&
    entity?.verification?.status &&
    entity.verification.status !== 'verified'
  ) {
    issues.push(
      issue(
        ISSUE_SEVERITY.WARNING,
        ISSUE_CODES.ENTITY_UNVERIFIED_EVIDENCE,
        `Entity "${entity?.id ?? 'unknown'}" has no evidence entry that could be verified against the document.`,
        { entityType, entityId: entity?.id ?? null, path: 'verification' },
      ),
    );
  }

  return issues;
}

/* -------------------------------------------------------------------------- */
/* Relationship validation                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Validates a relationship's type, endpoints and endpoint-type compatibility.
 * `endpointTypes` maps entity id → entity type (built from the model index).
 */
export function validateRelationship(relationship, { endpointTypes = null } = {}) {
  const issues = [];
  if (!isPlainObject(relationship)) {
    return [
      issue(ISSUE_SEVERITY.ERROR, ISSUE_CODES.REL_TYPE_INVALID, 'Relationship is not an object.', {
        entityType: ENTITY_TYPES.RELATIONSHIP,
      }),
    ];
  }

  const id = relationship.id ?? null;
  const schema = RELATIONSHIP_SCHEMA[relationship.type];
  if (!RELATIONSHIP_TYPES.includes(relationship.type) || !schema) {
    issues.push(
      issue(
        ISSUE_SEVERITY.ERROR,
        ISSUE_CODES.REL_TYPE_INVALID,
        `Relationship type "${relationship.type}" is not a valid ClauseGraph relationship type.`,
        { entityType: ENTITY_TYPES.RELATIONSHIP, entityId: id, path: 'type' },
      ),
    );
    return issues;
  }

  if (!isNonEmptyString(relationship.id)) {
    issues.push(
      issue(
        ISSUE_SEVERITY.ERROR,
        ISSUE_CODES.ENTITY_MISSING_ID,
        'Relationship is missing a non-empty id.',
        { entityType: ENTITY_TYPES.RELATIONSHIP, entityId: id, path: 'id' },
      ),
    );
  }

  if (!isNonEmptyString(relationship.fromId) || !isNonEmptyString(relationship.toId)) {
    issues.push(
      issue(
        ISSUE_SEVERITY.ERROR,
        ISSUE_CODES.REL_ENDPOINT_MISSING,
        `Relationship "${id}" must declare both fromId and toId.`,
        { entityType: ENTITY_TYPES.RELATIONSHIP, entityId: id, path: 'fromId/toId' },
      ),
    );
    return issues;
  }

  if (relationship.fromId === relationship.toId) {
    issues.push(
      issue(
        ISSUE_SEVERITY.WARNING,
        ISSUE_CODES.REL_SELF_LOOP,
        `Relationship "${id}" links entity "${relationship.fromId}" to itself.`,
        { entityType: ENTITY_TYPES.RELATIONSHIP, entityId: id },
      ),
    );
  }

  if (endpointTypes) {
    const fromType = endpointTypes.get(relationship.fromId) ?? relationship.fromType ?? null;
    const toType = endpointTypes.get(relationship.toId) ?? relationship.toType ?? null;

    if (!endpointTypes.has(relationship.fromId)) {
      issues.push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.REF_BROKEN,
          `Relationship "${id}" points at unknown source entity "${relationship.fromId}".`,
          { entityType: ENTITY_TYPES.RELATIONSHIP, entityId: id, path: 'fromId' },
        ),
      );
    } else if (!schema.from.includes(fromType)) {
      issues.push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.REL_ENDPOINT_TYPE_MISMATCH,
          `Relationship "${id}" of type "${relationship.type}" cannot start at a "${fromType}".`,
          { entityType: ENTITY_TYPES.RELATIONSHIP, entityId: id, path: 'fromId' },
        ),
      );
    }

    if (!endpointTypes.has(relationship.toId)) {
      issues.push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.REF_BROKEN,
          `Relationship "${id}" points at unknown target entity "${relationship.toId}".`,
          { entityType: ENTITY_TYPES.RELATIONSHIP, entityId: id, path: 'toId' },
        ),
      );
    } else if (!schema.to.includes(toType)) {
      issues.push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.REL_ENDPOINT_TYPE_MISMATCH,
          `Relationship "${id}" of type "${relationship.type}" cannot end at a "${toType}".`,
          { entityType: ENTITY_TYPES.RELATIONSHIP, entityId: id, path: 'toId' },
        ),
      );
    }
  }

  return issues;
}

/** Detects entity-to-entity reference fields that point nowhere. */
function validateEntityReferences(entity, entityType, idIndex, issueSink) {
  const expected = EXPECTED_REF_TYPES[entityType] ?? {};
  for (const [field, expectedType] of Object.entries(expected)) {
    const value = entity[field];
    if (value === null || value === undefined) continue;
    const values = ARRAY_REF_FIELDS.has(field)
      ? Array.isArray(value)
        ? value
        : [value]
      : [value];

    values.forEach((refId, index) => {
      const path = ARRAY_REF_FIELDS.has(field) ? `${field}[${index}]` : field;
      if (!isNonEmptyString(refId)) {
        issueSink(
          issue(
            ISSUE_SEVERITY.ERROR,
            ISSUE_CODES.REF_BROKEN,
            `Entity "${entity.id}" has an empty "${field}" reference.`,
            { entityType, entityId: entity.id, path },
          ),
        );
        return;
      }
      const entry = idIndex.get(refId);
      if (!entry) {
        issueSink(
          issue(
            ISSUE_SEVERITY.ERROR,
            ISSUE_CODES.REF_BROKEN,
            `Entity "${entity.id}" references unknown ${expectedType} "${refId}".`,
            { entityType, entityId: entity.id, path, referencedId: refId },
          ),
        );
        return;
      }
      if (entry.entityType !== expectedType) {
        issueSink(
          issue(
            ISSUE_SEVERITY.ERROR,
            ISSUE_CODES.REF_TYPE_MISMATCH,
            `Entity "${entity.id}" expects a ${expectedType} in "${field}" but "${refId}" is a ${entry.entityType}.`,
            { entityType, entityId: entity.id, path, referencedId: refId },
          ),
        );
      }
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Model-level validation                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Validates a complete LegalModel.
 *
 * Checks required ids, known entity types, required fields, controlled
 * vocabularies, duplicate ids, source/clause/page/section references, mandatory
 * evidence, broken references and relationship integrity.
 *
 * Pure and non-throwing. Returns { valid, errors, warnings, issues, summary }.
 */
export function validateLegalModel(model, { documentContent = null, maxIssues = 500 } = {}) {
  const issues = [];
  const push = (...entries) => {
    for (const entry of entries) {
      if (issues.length < maxIssues) issues.push(entry);
    }
  };

  if (!isPlainObject(model)) {
    return finalizeReport(model, [
      issue(ISSUE_SEVERITY.ERROR, ISSUE_CODES.MODEL_NOT_OBJECT, 'Legal model is not an object.'),
    ]);
  }

  const idIndex = new Map();
  const idCounts = new Map();
  const endpointTypes = new Map();
  const documentId = model.documentId ?? null;

  for (const key of MODEL_COLLECTION_KEYS) {
    const collection = model[key];
    if (collection === undefined || collection === null) continue;
    if (!Array.isArray(collection)) {
      push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.MODEL_NOT_OBJECT,
          `Model collection "${key}" must be an array.`,
          { path: key },
        ),
      );
      continue;
    }
    if (collection.length > LIMITS.MAX_ENTITIES_PER_TYPE) {
      push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.MODEL_TOO_LARGE,
          `Collection "${key}" holds ${collection.length} entities, above the supported maximum of ${LIMITS.MAX_ENTITIES_PER_TYPE}.`,
          { path: key },
        ),
      );
    }
  }

  // Pass 1: entity shape, ids and duplicates.
  for (const key of MODEL_COLLECTION_KEYS) {
    const collection = Array.isArray(model[key]) ? model[key] : [];
    const isRelationshipCollection = key === 'relationships';
    const entityType = isRelationshipCollection
      ? ENTITY_TYPES.RELATIONSHIP
      : entityTypeForCollectionKey(key);

    collection.forEach((entity, index) => {
      push(
        ...validateEntity(entity, {
          entityType,
          collectionKey: isRelationshipCollection ? null : key,
        }).map((entry) => ({ ...entry, collectionKey: key, index })),
      );

      if (entity && isNonEmptyString(entity.id)) {
        idCounts.set(entity.id, (idCounts.get(entity.id) ?? 0) + 1);
        if (!idIndex.has(entity.id)) {
          idIndex.set(entity.id, { entity, entityType, collectionKey: key });
        }
        if (!isRelationshipCollection) endpointTypes.set(entity.id, entityType);
      }
    });
  }

  for (const [id, count] of idCounts.entries()) {
    if (count > 1) {
      const entry = idIndex.get(id);
      push(
        issue(
          ISSUE_SEVERITY.ERROR,
          ISSUE_CODES.ENTITY_DUPLICATE_ID,
          `ID "${id}" is used by ${count} entities; ids must be unique across the model.`,
          { entityType: entry?.entityType ?? null, entityId: id, path: entry?.collectionKey ?? null },
        ),
      );
    }
  }

  // Pass 2: document-level expectations.
  const documents = Array.isArray(model.documents) ? model.documents : [];
  if (documents.length === 0) {
    push(
      issue(ISSUE_SEVERITY.WARNING, ISSUE_CODES.MODEL_NO_DOCUMENT, 'Legal model contains no document entity.', {
        documentId,
      }),
    );
  } else if (documentId && documents[0].id !== documentId) {
    push(
      issue(
        ISSUE_SEVERITY.ERROR,
        ISSUE_CODES.MODEL_DOCUMENT_MISMATCH,
        `Model documentId "${documentId}" does not match its document entity "${documents[0].id}".`,
        { entityType: ENTITY_TYPES.DOCUMENT, entityId: documents[0].id, path: 'documentId' },
      ),
    );
  }

  if ((Array.isArray(model.clauses) ? model.clauses : []).length === 0) {
    push(
      issue(
        ISSUE_SEVERITY.WARNING,
        ISSUE_CODES.MODEL_NO_CLAUSES,
        'Legal model contains no clauses; citations cannot be resolved.',
        { documentId },
      ),
    );
  }

  const pageCount =
    (Number.isInteger(documentContent?.pageCount) && documentContent.pageCount) ||
    (Number.isInteger(documents[0]?.pageCount) && documents[0].pageCount) ||
    null;

  // Pass 3: reference integrity and evidence coordinates.
  for (const key of MODEL_COLLECTION_KEYS) {
    if (key === 'relationships') continue;
    const collection = Array.isArray(model[key]) ? model[key] : [];
    const entityType = entityTypeForCollectionKey(key);

    collection.forEach((entity) => {
      if (!isPlainObject(entity)) return;
      validateEntityReferences(entity, entityType, idIndex, push);

      if (documentId && entity.documentId && entity.documentId !== documentId) {
        push(
          issue(
            ISSUE_SEVERITY.ERROR,
            ISSUE_CODES.ENTITY_DOCUMENT_MISMATCH,
            `Entity "${entity.id}" belongs to document "${entity.documentId}" but the model is for "${documentId}".`,
            { entityType, entityId: entity.id, path: 'documentId' },
          ),
        );
      }

      for (const reference of Array.isArray(entity.evidence) ? entity.evidence : []) {
        if (!isPlainObject(reference)) continue;
        const base = { entityType, entityId: entity.id, evidenceId: reference.id ?? null };

        if (isNonEmptyString(reference.documentId) && documentId && reference.documentId !== documentId) {
          push(
            issue(
              ISSUE_SEVERITY.ERROR,
              ISSUE_CODES.EVIDENCE_BAD_SOURCE_REF,
              `Evidence "${reference.id}" cites document "${reference.documentId}" instead of "${documentId}".`,
              { ...base, path: 'evidence.documentId' },
            ),
          );
        }

        if (isNonEmptyString(reference.clauseId)) {
          const clauseEntry = idIndex.get(reference.clauseId);
          if (!clauseEntry) {
            push(
              issue(
                ISSUE_SEVERITY.ERROR,
                ISSUE_CODES.EVIDENCE_BAD_CLAUSE_REF,
                `Evidence "${reference.id}" cites unknown clause "${reference.clauseId}".`,
                { ...base, path: 'evidence.clauseId', referencedId: reference.clauseId },
              ),
            );
          } else if (clauseEntry.entityType !== ENTITY_TYPES.CLAUSE) {
            push(
              issue(
                ISSUE_SEVERITY.ERROR,
                ISSUE_CODES.EVIDENCE_BAD_CLAUSE_REF,
                `Evidence "${reference.id}" cites "${reference.clauseId}", which is not a clause.`,
                { ...base, path: 'evidence.clauseId', referencedId: reference.clauseId },
              ),
            );
          }
        }

        if (
          Number.isInteger(reference.page) &&
          Number.isInteger(pageCount) &&
          (reference.page < 1 || reference.page > pageCount)
        ) {
          push(
            issue(
              ISSUE_SEVERITY.ERROR,
              ISSUE_CODES.EVIDENCE_BAD_PAGE,
              `Evidence "${reference.id}" cites page ${reference.page}, outside the document's ${pageCount} pages.`,
              { ...base, path: 'evidence.page' },
            ),
          );
        }
      }
    });
  }

  // Pass 4: relationships.
  const seenRelationships = new Set();
  (Array.isArray(model.relationships) ? model.relationships : []).forEach((relationship) => {
    push(...validateRelationship(relationship, { endpointTypes }));
    if (isPlainObject(relationship) && isNonEmptyString(relationship.fromId)) {
      const signature = `${relationship.type}:${relationship.fromId}->${relationship.toId}`;
      if (seenRelationships.has(signature)) {
        push(
          issue(
            ISSUE_SEVERITY.WARNING,
            ISSUE_CODES.REL_DUPLICATE,
            `Duplicate relationship "${signature}".`,
            { entityType: ENTITY_TYPES.RELATIONSHIP, entityId: relationship.id ?? null },
          ),
        );
      }
      seenRelationships.add(signature);
    }
  });

  return finalizeReport(model, issues);
}

function finalizeReport(model, issues) {
  const errors = issues.filter((entry) => entry.severity === ISSUE_SEVERITY.ERROR);
  const warnings = issues.filter((entry) => entry.severity === ISSUE_SEVERITY.WARNING);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    issues,
    summary: {
      errorCount: errors.length,
      warningCount: warnings.length,
      checkedEntityCount: MODEL_COLLECTION_KEYS.reduce(
        (total, key) => total + (Array.isArray(model?.[key]) ? model[key].length : 0),
        0,
      ),
      bySeverity: {
        error: errors.length,
        warning: warnings.length,
        info: issues.filter((entry) => entry.severity === ISSUE_SEVERITY.INFO).length,
      },
    },
  };
}

/** Throws when a model cannot be trusted enough to enter application state. */
export function assertValidModel(model, options = {}) {
  const report = validateLegalModel(model, options);
  if (!report.valid) {
    const first = report.errors[0];
    throw new ValidationError(
      `Legal model failed validation (${report.summary.errorCount} error(s)). First: ${first?.message ?? 'unknown'}`,
      report.errors,
    );
  }
  return report;
}

export function summarizeIssues(issues = []) {
  return {
    total: issues.length,
    errors: issues.filter((entry) => entry.severity === ISSUE_SEVERITY.ERROR).length,
    warnings: issues.filter((entry) => entry.severity === ISSUE_SEVERITY.WARNING).length,
  };
}

export function groupIssuesByCode(issues = []) {
  return issues.reduce((grouped, entry) => {
    const key = entry.code ?? 'unknown';
    grouped[key] = grouped[key] ?? [];
    grouped[key].push(entry);
    return grouped;
  }, {});
}
