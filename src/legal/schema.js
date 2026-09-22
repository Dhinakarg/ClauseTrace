/**
 * ClauseGraph legal domain schema.
 *
 * This module is the SINGLE SOURCE OF TRUTH for legal data structures.
 * Components, engines and providers must import from here instead of
 * re-declaring shapes locally.
 *
 * Design rules:
 *  - Plain JavaScript objects only (no classes, no TypeScript).
 *  - Every entity has a stable string `id`, knows its `type` and owning
 *    `documentId`. Relationships are ID based, never object references.
 *  - Every AI-derived legal fact carries at least one EvidenceReference so it
 *    stays traceable to source text.
 *  - Factories are pure: no global state, no input mutation.
 */

/* -------------------------------------------------------------------------- */
/* Entity types                                                               */
/* -------------------------------------------------------------------------- */

export const ENTITY_TYPES = Object.freeze({
  DOCUMENT: 'document',
  PARTY: 'party',
  CLAUSE: 'clause',
  DEFINITION: 'definition',
  RIGHT: 'right',
  OBLIGATION: 'obligation',
  CONDITION: 'condition',
  DEADLINE: 'deadline',
  CONSEQUENCE: 'consequence',
  RISK: 'risk',
  INCONSISTENCY: 'inconsistency',
  EVIDENCE: 'evidence',
  RELATIONSHIP: 'relationship',
});

/** Every entity type that can live inside a LegalModel (and its graph). */
export const MODEL_ENTITY_TYPES = Object.freeze([
  ENTITY_TYPES.DOCUMENT,
  ENTITY_TYPES.PARTY,
  ENTITY_TYPES.CLAUSE,
  ENTITY_TYPES.DEFINITION,
  ENTITY_TYPES.RIGHT,
  ENTITY_TYPES.OBLIGATION,
  ENTITY_TYPES.CONDITION,
  ENTITY_TYPES.DEADLINE,
  ENTITY_TYPES.CONSEQUENCE,
  ENTITY_TYPES.RISK,
  ENTITY_TYPES.INCONSISTENCY,
]);

/**
 * Maps an entity type to the plural collection key used on the LegalModel.
 * Keeps the flat model shape (document → clauses → parties → ...) consistent.
 */
export const ENTITY_COLLECTIONS = Object.freeze({
  [ENTITY_TYPES.DOCUMENT]: 'documents',
  [ENTITY_TYPES.PARTY]: 'parties',
  [ENTITY_TYPES.CLAUSE]: 'clauses',
  [ENTITY_TYPES.DEFINITION]: 'definitions',
  [ENTITY_TYPES.RIGHT]: 'rights',
  [ENTITY_TYPES.OBLIGATION]: 'obligations',
  [ENTITY_TYPES.CONDITION]: 'conditions',
  [ENTITY_TYPES.DEADLINE]: 'deadlines',
  [ENTITY_TYPES.CONSEQUENCE]: 'consequences',
  [ENTITY_TYPES.RISK]: 'risks',
  [ENTITY_TYPES.INCONSISTENCY]: 'inconsistencies',
  [ENTITY_TYPES.EVIDENCE]: 'evidence',
  [ENTITY_TYPES.RELATIONSHIP]: 'relationships',
});

/** Collection keys present on a LegalModel, in stable display order. */
export const MODEL_COLLECTION_KEYS = Object.freeze([
  'documents',
  'parties',
  'clauses',
  'definitions',
  'rights',
  'obligations',
  'conditions',
  'deadlines',
  'consequences',
  'risks',
  'inconsistencies',
  'relationships',
]);

/* -------------------------------------------------------------------------- */
/* Controlled vocabularies                                                    */
/* -------------------------------------------------------------------------- */

/** Where a fact came from. Used for auditability and UI trust cues. */
export const PROVENANCE = Object.freeze({
  PARSER: 'parser', // deterministic result of document parsing
  AI: 'ai', // proposed by an AI provider, must be validated
  DERIVED: 'derived', // computed by an application engine
  USER: 'user', // authored or edited by the person using the app
});

export const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low', 'unknown']);

export const DOCUMENT_TYPES = Object.freeze([
  'agreement',
  'contract',
  'amendment',
  'nda',
  'policy',
  'terms',
  'letter',
  'order',
  'other',
  'unknown',
]);

export const DOCUMENT_SOURCE_KINDS = Object.freeze(['demo', 'upload', 'text']);

export const PARTY_ROLES = Object.freeze([
  'disclosing-party',
  'receiving-party',
  'client',
  'service-provider',
  'customer',
  'supplier',
  'employer',
  'employee',
  'licensor',
  'licensee',
  'lender',
  'borrower',
  'guarantor',
  'counterparty',
  'other',
  'unknown',
]);

export const PARTY_ENTITY_KINDS = Object.freeze([
  'individual',
  'company',
  'partnership',
  'government',
  'other',
  'unknown',
]);

export const DEFINITION_SCOPES = Object.freeze(['document', 'section', 'clause', 'unknown']);

export const OBLIGATION_STANDARDS = Object.freeze([
  'strict',
  'best-efforts',
  'reasonable-efforts',
  'commercially-reasonable',
  'informational',
  'unknown',
]);

export const CONDITION_TYPES = Object.freeze([
  'condition-precedent',
  'condition-subsequent',
  'trigger',
  'satisfaction',
  'renewal',
  'termination',
  'other',
  'unknown',
]);

export const DEADLINE_DATE_TYPES = Object.freeze([
  'fixed',
  'relative',
  'recurring',
  'unspecified',
]);

export const DATE_OFFSET_UNITS = Object.freeze(['day', 'week', 'month', 'year']);

export const CONSEQUENCE_TYPES = Object.freeze([
  'termination',
  'penalty',
  'fee',
  'interest',
  'liability',
  'suspension',
  'remedy',
  'escalation',
  'other',
  'unknown',
]);

export const RISK_CATEGORIES = Object.freeze([
  'ambiguity',
  'one-sidedness',
  'missing-definition',
  'unlimited-liability',
  'auto-renewal',
  'broad-discretion',
  'short-notice-period',
  'compliance',
  'missing-remedy',
  'other',
  'unknown',
]);

export const INCONSISTENCY_TYPES = Object.freeze([
  'conflicting-terms',
  'contradictory-dates',
  'conflicting-notice-periods',
  'undefined-term',
  'missing-cross-reference',
  'duplicate-obligation',
  'orphan-clause-reference',
  'other',
  'unknown',
]);

export const SEVERITIES = Object.freeze(['info', 'low', 'medium', 'high', 'critical', 'unknown']);

/** Deterministic obligation assessments. These are NOT legal conclusions. */
export const OBLIGATION_STATUSES = Object.freeze([
  'upcoming',
  'due',
  'overdue',
  'conditional',
  'informational',
  'unknown',
]);

export const EVIDENCE_STATUSES = Object.freeze([
  'verified',
  'text-mismatch',
  'range-mismatch',
  'unknown-clause',
  'missing-source',
  'unverified',
]);

/** Clause categories. Classified deterministically; see `legal/clauseTypes.js`. */
export const CLAUSE_TYPES = Object.freeze([
  'definitions',
  'services',
  'payment',
  'suspension',
  'termination',
  'renewal',
  'term',
  'confidentiality',
  'liability',
  'indemnity',
  'remedies',
  'notice',
  'reporting',
  'assignment',
  'subcontracting',
  'survival',
  'governing-law',
  'dispute-resolution',
  'force-majeure',
  'schedule',
  'other',
  'unknown',
]);

/** Where a clause type came from: deterministic rules or an AI confirmation. */
export const CLAUSE_TYPE_SOURCES = Object.freeze({
  PARSER: 'parser',
  AI: 'ai',
  UNKNOWN: 'unknown',
});

/** What a condition operates on, when the document says so. */
export const CONDITION_TARGETS = Object.freeze([
  'obligation',
  'right',
  'termination',
  'renewal',
  'payment',
  'notice',
  'other',
  'unknown',
]);


/* -------------------------------------------------------------------------- */
/* Relationship vocabulary                                                    */
/* -------------------------------------------------------------------------- */

const T = ENTITY_TYPES;

/**
 * Legal relationship types with allowed endpoint entity types.
 * `from` / `to` are arrays of ENTITY_TYPES values. Validators use this map to
 * reject relationship types and endpoint pairings the app does not understand.
 */
export const RELATIONSHIP_SCHEMA = Object.freeze({
  'document-has-party': { from: [T.DOCUMENT], to: [T.PARTY] },
  'document-has-clause': { from: [T.DOCUMENT], to: [T.CLAUSE] },
  'clause-references': { from: [T.CLAUSE], to: [T.CLAUSE] },
  'clause-defines': { from: [T.CLAUSE], to: [T.DEFINITION] },
  'clause-imposes-obligation': { from: [T.CLAUSE], to: [T.OBLIGATION] },
  'clause-grants-right': { from: [T.CLAUSE], to: [T.RIGHT] },
  'clause-states-condition': { from: [T.CLAUSE], to: [T.CONDITION] },
  'clause-sets-deadline': { from: [T.CLAUSE], to: [T.DEADLINE] },
  'clause-states-consequence': { from: [T.CLAUSE], to: [T.CONSEQUENCE] },
  'clause-flags-risk': { from: [T.CLAUSE], to: [T.RISK] },
  'party-obligated-by': { from: [T.PARTY], to: [T.OBLIGATION] },
  'obligation-owed-to': { from: [T.OBLIGATION], to: [T.PARTY] },
  'party-holds-right': { from: [T.PARTY], to: [T.RIGHT] },
  'right-held-against': { from: [T.RIGHT], to: [T.PARTY] },
  'obligation-triggered-by': { from: [T.OBLIGATION], to: [T.CONDITION] },
  'obligation-has-deadline': { from: [T.OBLIGATION], to: [T.DEADLINE] },
  'obligation-results-in': { from: [T.OBLIGATION], to: [T.CONSEQUENCE] },
  'condition-triggers': {
    from: [T.CONDITION],
    to: [T.OBLIGATION, T.CONSEQUENCE, T.CONDITION],
  },
  'condition-has-deadline': { from: [T.CONDITION], to: [T.DEADLINE] },
  'consequence-follows-condition': { from: [T.CONSEQUENCE], to: [T.CONDITION] },
  'consequence-affected-party': { from: [T.CONSEQUENCE], to: [T.PARTY] },
  'definition-applies-to': {
    from: [T.DEFINITION],
    to: [T.CLAUSE, T.OBLIGATION, T.RIGHT, T.CONDITION, T.DEADLINE, T.CONSEQUENCE],
  },
  'deadline-anchored-to': {
    from: [T.DEADLINE],
    to: [T.OBLIGATION, T.CONDITION, T.CLAUSE],
  },
  'risk-about': { from: [T.RISK], to: [...MODEL_ENTITY_TYPES] },
  'inconsistency-between': { from: [T.INCONSISTENCY], to: [...MODEL_ENTITY_TYPES] },
  // Generic escape hatch. Validators keep it available but flag it as low signal.
  'entity-relates-to': { from: [...MODEL_ENTITY_TYPES], to: [...MODEL_ENTITY_TYPES] },
});

export const RELATIONSHIP_TYPES = Object.freeze(Object.keys(RELATIONSHIP_SCHEMA));

/* -------------------------------------------------------------------------- */
/* ID helpers                                                                 */
/* -------------------------------------------------------------------------- */

const ID_PREFIXES = Object.freeze({
  [T.DOCUMENT]: 'doc',
  [T.PARTY]: 'party',
  [T.CLAUSE]: 'cl',
  [T.DEFINITION]: 'def',
  [T.RIGHT]: 'right',
  [T.OBLIGATION]: 'obl',
  [T.CONDITION]: 'cond',
  [T.DEADLINE]: 'dl',
  [T.CONSEQUENCE]: 'cons',
  [T.RISK]: 'risk',
  [T.INCONSISTENCY]: 'inc',
  [T.EVIDENCE]: 'ev',
  [T.RELATIONSHIP]: 'rel',
});

/** Stable djb2 hash, used so regenerated IDs for the same input stay identical. */
export function stableHash(input) {
  const value = String(input ?? '');
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function slugify(input, fallback = 'item') {
  const slug = String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || fallback;
}

/**
 * Creates a deterministic, readable entity id: `<prefix>_<slug>_<hash>`.
 * Passing the same type + hint twice yields the same id, which keeps demo data
 * and repeated extractions stable.
 */
export function createEntityId(entityType, hint = '') {
  const prefix = ID_PREFIXES[entityType] ?? 'ent';
  return `${prefix}_${slugify(hint, 'x')}_${stableHash(`${entityType}:${hint}`)}`;
}

export function isKnownEntityType(entityType) {
  return Object.prototype.hasOwnProperty.call(ENTITY_COLLECTIONS, entityType);
}

export function getCollectionKey(entityType) {
  return ENTITY_COLLECTIONS[entityType] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Entity factories                                                           */
/* -------------------------------------------------------------------------- */

/** Required, non-empty fields per entity type (validators enforce these). */
export const REQUIRED_FIELDS = Object.freeze({
  [T.DOCUMENT]: ['id', 'documentId', 'title'],
  [T.PARTY]: ['id', 'documentId', 'name', 'role'],
  [T.CLAUSE]: ['id', 'documentId', 'text'],
  [T.DEFINITION]: ['id', 'documentId', 'term', 'text'],
  [T.RIGHT]: ['id', 'documentId', 'summary', 'clauseId'],
  [T.OBLIGATION]: ['id', 'documentId', 'summary', 'clauseId'],
  [T.CONDITION]: ['id', 'documentId', 'summary', 'conditionType', 'clauseId'],
  [T.DEADLINE]: ['id', 'documentId', 'description', 'dateType', 'clauseId'],
  [T.CONSEQUENCE]: ['id', 'documentId', 'description', 'consequenceType', 'clauseId'],
  [T.RISK]: ['id', 'documentId', 'title', 'category', 'clauseId'],
  [T.INCONSISTENCY]: ['id', 'documentId', 'title', 'inconsistencyType'],
  [T.EVIDENCE]: ['id', 'documentId'],
  [T.RELATIONSHIP]: ['id', 'type', 'fromId', 'toId'],
});

/** Entity types where evidence is mandatory: AI must not assert facts bare. */
export const EVIDENCE_REQUIRED_TYPES = Object.freeze([
  T.PARTY,
  T.RIGHT,
  T.OBLIGATION,
  T.CONDITION,
  T.DEADLINE,
  T.CONSEQUENCE,
  T.RISK,
  T.INCONSISTENCY,
]);

/** Fields carrying an array of related entity ids, checked for dangling refs. */
export const ID_REFERENCE_FIELDS = Object.freeze({
  [T.DOCUMENT]: ['partyIds', 'clauseIds'],
  [T.PARTY]: ['definedInClauseIds'],
  [T.CLAUSE]: ['parentClauseId', 'crossReferences', 'childClauseIds'],
  [T.DEFINITION]: ['clauseId'],
  [T.RIGHT]: ['holderPartyId', 'counterpartyPartyId', 'clauseId'],
  [T.OBLIGATION]: [
    'obligorPartyId',
    'obligeePartyId',
    'clauseId',
    'deadlineId',
    'triggerConditionId',
  ],
  [T.CONDITION]: ['clauseId', 'deadlineId'],
  [T.DEADLINE]: ['clauseId', 'anchorEntityId', 'responsiblePartyId'],
  [T.CONSEQUENCE]: ['clauseId', 'triggerConditionId', 'affectedPartyId'],
  [T.RISK]: ['clauseId'],
  [T.INCONSISTENCY]: ['clauseId'],
});

function base(entityType, { id, documentId, provenance, confidence, evidence, notes }) {
  return {
    id: id ?? createEntityId(entityType, `${documentId ?? 'doc'}:${Math.random()}`),
    type: entityType,
    documentId: documentId ?? null,
    provenance: provenance ?? PROVENANCE.AI,
    confidence: confidence ?? 'unknown',
    evidence: Array.isArray(evidence) ? [...evidence] : [],
    notes: notes ?? null,
  };
}

export function createDocument({
  id,
  title,
  documentType = 'unknown',
  effectiveDate = null,
  pageCount = null,
  partyIds = [],
  clauseIds = [],
  metadata = {},
  provenance = PROVENANCE.PARSER,
  evidence = [],
}) {
  const documentId = id ?? createEntityId(T.DOCUMENT, `${title ?? 'untitled'}`);
  return {
    ...base(T.DOCUMENT, { id: documentId, documentId, provenance, evidence }),
    title: title ?? 'Untitled document',
    documentType,
    effectiveDate,
    pageCount,
    partyIds: [...partyIds],
    clauseIds: [...clauseIds],
    metadata: { ...metadata },
  };
}

export function createParty({
  id,
  documentId,
  name,
  role = 'unknown',
  entityKind = 'unknown',
  jurisdiction = null,
  description = null,
  aliases = [],
  definedInClauseIds = [],
  provenance,
  confidence,
  evidence,
}) {
  return {
    ...base(T.PARTY, { id, documentId, provenance, confidence, evidence }),
    name: name ?? '',
    role,
    entityKind,
    jurisdiction,
    description,
    aliases: [...aliases],
    definedInClauseIds: [...definedInClauseIds],
  };
}

export function createClause({
  id,
  documentId,
  number = null,
  heading = null,
  text = '',
  level = 1,
  clauseType = 'unknown',
  clauseTypeSource = 'unknown',
  parentClauseId = null,
  childClauseIds = [],
  sectionPath = [],
  page = null,
  startOffset = null,
  endOffset = null,
  crossReferences = [],
  provenance = PROVENANCE.PARSER,
  evidence = [],
}) {
  return {
    ...base(T.CLAUSE, { id, documentId, provenance, evidence }),
    number,
    heading,
    text,
    level,
    clauseType,
    clauseTypeSource,
    parentClauseId,
    childClauseIds: [...childClauseIds],
    sectionPath: [...sectionPath],
    page,
    startOffset,
    endOffset,
    crossReferences: [...crossReferences],
  };
}

export function createDefinition({
  id,
  documentId,
  term,
  text = '',
  scope = 'unknown',
  clauseId = null,
  aliases = [],
  provenance,
  confidence,
  evidence,
}) {
  return {
    ...base(T.DEFINITION, { id, documentId, provenance, confidence, evidence }),
    term: term ?? '',
    text,
    scope,
    clauseId,
    aliases: [...aliases],
  };
}

export function createRight({
  id,
  documentId,
  summary,
  action = null,
  condition = null,
  holderPartyId = null,
  counterpartyPartyId = null,
  clauseId = null,
  limitations = [],
  provenance,
  confidence,
  evidence,
}) {
  return {
    ...base(T.RIGHT, { id, documentId, provenance, confidence, evidence }),
    summary: summary ?? '',
    action,
    condition,
    holderPartyId,
    counterpartyPartyId,
    clauseId,
    limitations: [...limitations],
  };
}

export function createObligation({
  id,
  documentId,
  summary,
  action = null,
  obligorPartyId = null,
  obligeePartyId = null,
  clauseId = null,
  standard = 'unknown',
  triggerConditionId = null,
  triggerText = null,
  deadlineId = null,
  deadlineText = null,
  consequenceIds = [],
  consequenceText = null,
  informational = false,
  provenance,
  confidence,
  evidence,
}) {
  return {
    ...base(T.OBLIGATION, { id, documentId, provenance, confidence, evidence }),
    summary: summary ?? '',
    action,
    obligorPartyId,
    obligeePartyId,
    clauseId,
    standard,
    triggerConditionId,
    triggerText,
    deadlineId,
    deadlineText,
    consequenceIds: [...consequenceIds],
    consequenceText,
    informational: Boolean(informational),
  };
}

export function createCondition({
  id,
  documentId,
  summary,
  conditionType = 'unknown',
  activates = null,
  triggerDescription = null,
  clauseId = null,
  deadlineId = null,
  provenance,
  confidence,
  evidence,
}) {
  return {
    ...base(T.CONDITION, { id, documentId, provenance, confidence, evidence }),
    summary: summary ?? '',
    conditionType,
    activates,
    triggerDescription,
    clauseId,
    deadlineId,
  };
}

export function createDeadline({
  id,
  documentId,
  description,
  date = null,
  dateType = 'unspecified',
  event = null,
  anchorEvent = null,
  anchorEntityId = null,
  anchorDate = null,
  offsetAmount = null,
  offsetUnit = null,
  recurrence = null,
  responsiblePartyId = null,
  clauseId = null,
  provenance,
  confidence,
  evidence,
}) {
  return {
    ...base(T.DEADLINE, { id, documentId, provenance, confidence, evidence }),
    description: description ?? '',
    date,
    dateType,
    // `event` is the Phase 2 name for the event a relative deadline hangs off;
    // `anchorEvent` is kept because the graph and validators already use it.
    event: event ?? anchorEvent,
    anchorEvent: anchorEvent ?? event,
    anchorEntityId,
    anchorDate,
    offset: offsetAmount && offsetUnit ? { amount: offsetAmount, unit: offsetUnit } : null,
    recurrence,
    responsiblePartyId,
    clauseId,
  };
}

export function createConsequence({
  id,
  documentId,
  description,
  consequenceType = 'unknown',
  severity = 'unknown',
  event = null,
  clauseId = null,
  triggerConditionId = null,
  affectedPartyId = null,
  provenance,
  confidence,
  evidence,
}) {
  return {
    ...base(T.CONSEQUENCE, { id, documentId, provenance, confidence, evidence }),
    description: description ?? '',
    consequenceType,
    severity,
    event,
    clauseId,
    triggerConditionId,
    affectedPartyId,
  };
}

export function createRisk({
  id,
  documentId,
  title,
  category = 'unknown',
  severity = 'unknown',
  explanation = '',
  clauseId = null,
  relatedEntityRefs = [],
  provenance,
  confidence,
  evidence,
}) {
  return {
    ...base(T.RISK, { id, documentId, provenance, confidence, evidence }),
    title: title ?? '',
    category,
    severity,
    explanation,
    clauseId,
    relatedEntityRefs: relatedEntityRefs.map((ref) => ({ ...ref })),
  };
}

export function createInconsistency({
  id,
  documentId,
  title,
  inconsistencyType = 'unknown',
  severity = 'unknown',
  description = '',
  entityRefs = [],
  clauseIds = [],
  clauseId = null,
  provenance,
  confidence,
  evidence,
}) {
  return {
    ...base(T.INCONSISTENCY, { id, documentId, provenance, confidence, evidence }),
    title: title ?? '',
    inconsistencyType,
    severity,
    description,
    entityRefs: entityRefs.map((ref) => ({ ...ref })),
    clauseIds: [...clauseIds],
    clauseId,
  };
}

/**
 * Relationship entity. `fromId`/`toId` are ids of model entities; endpoint
 * types are stored explicitly so the graph can be traversed without lookups.
 */
export function createRelationship({
  id,
  type,
  fromId,
  fromType,
  toId,
  toType,
  label = null,
  directed = true,
  documentId = null,
  provenance = PROVENANCE.DERIVED,
  confidence,
  evidence = [],
}) {
  return {
    id: id ?? createEntityId(T.RELATIONSHIP, `${type}:${fromId}:${toId}`),
    type,
    fromId,
    fromType,
    toId,
    toType,
    label,
    directed: Boolean(directed),
    documentId,
    provenance,
    confidence: confidence ?? 'unknown',
    evidence: [...evidence],
  };
}

/* -------------------------------------------------------------------------- */
/* Model containers and lookups                                               */
/* -------------------------------------------------------------------------- */

/**
 * Canonical empty LegalModel. The model is FLAT (one array per entity type)
 * plus an id-keyed index built on demand. Relationships are id based and live
 * in `relationships`, so no entity ever nests another entity.
 */
export function emptyLegalModel(documentId = null, meta = {}) {
  return {
    documentId,
    documents: [],
    parties: [],
    clauses: [],
    definitions: [],
    rights: [],
    obligations: [],
    conditions: [],
    deadlines: [],
    consequences: [],
    risks: [],
    inconsistencies: [],
    relationships: [],
    meta: { extractionProvider: null, extractedAt: null, validatedAt: null, ...meta },
  };
}

/** Shallow-merges partial collections into a fresh model (never mutates input). */
export function createLegalModel(partial = {}) {
  const model = emptyLegalModel(partial.documentId ?? null, partial.meta ?? {});
  for (const key of MODEL_COLLECTION_KEYS) {
    if (Array.isArray(partial[key])) model[key] = [...partial[key]];
  }
  if (partial.document) model.documents = [partial.document];
  return model;
}

export function isLegalModelLike(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    MODEL_COLLECTION_KEYS.filter((key) => Array.isArray(value[key])).length >= 4
  );
}

const ENTITY_COLLECTIONS_KEY_TO_TYPE = Object.freeze(
  Object.fromEntries(
    Object.entries(ENTITY_COLLECTIONS).map(([entityType, key]) => [key, entityType]),
  ),
);

/**
 * Builds an id → { entity, entityType } index for every model collection.
 * Does not throw: duplicate ids simply overwrite, validators report duplicates.
 */
export function indexEntities(model) {
  const index = new Map();
  if (!isLegalModelLike(model)) return index;
  for (const key of MODEL_COLLECTION_KEYS) {
    const entityType = ENTITY_COLLECTIONS_KEY_TO_TYPE[key];
    for (const entity of model[key] ?? []) {
      if (!entity || typeof entity.id !== 'string') continue;
      index.set(entity.id, { entity, entityType });
    }
  }
  return index;
}

export function entityTypeForCollectionKey(key) {
  return ENTITY_COLLECTIONS_KEY_TO_TYPE[key] ?? null;
}

export function getEntitiesByType(model, entityType) {
  const key = getCollectionKey(entityType);
  if (!key || !isLegalModelLike(model)) return [];
  return model[key] ?? [];
}

export function getEntity(model, id) {
  if (!id) return null;
  return indexEntities(model).get(id)?.entity ?? null;
}

export function getEntityEntry(model, id) {
  if (!id) return null;
  return indexEntities(model).get(id) ?? null;
}

export function getClause(model, clauseId) {
  const entry = getEntityEntry(model, clauseId);
  return entry?.entityType === ENTITY_TYPES.CLAUSE ? entry.entity : null;
}

export function getDeadlinesForObligation(model, obligationId) {
  return getEntitiesByType(model, ENTITY_TYPES.DEADLINE).filter(
    (deadline) => deadline.anchorEntityId === obligationId,
  );
}

/** Counts of each collection, used by dashboards and the status area. */
export function modelCounts(model) {
  const counts = {};
  for (const key of MODEL_COLLECTION_KEYS) {
    counts[key] = Array.isArray(model?.[key]) ? model[key].length : 0;
  }
  return counts;
}

/** Short human label for any model entity, used by graph/table UIs. */
export function entityLabel(entity) {
  if (!entity) return 'Unknown';
  switch (entity.type) {
    case ENTITY_TYPES.DOCUMENT:
      return entity.title ?? 'Untitled document';
    case ENTITY_TYPES.PARTY:
      return entity.name ?? 'Unnamed party';
    case ENTITY_TYPES.CLAUSE:
      return entity.number ? `${entity.number} ${entity.heading ?? ''}`.trim() : entity.heading ?? 'Clause';
    case ENTITY_TYPES.DEFINITION:
      return entity.term ?? 'Definition';
    case ENTITY_TYPES.RIGHT:
    case ENTITY_TYPES.OBLIGATION:
    case ENTITY_TYPES.CONDITION:
      return entity.summary ?? entity.title ?? 'Entry';
    case ENTITY_TYPES.DEADLINE:
    case ENTITY_TYPES.CONSEQUENCE:
      return entity.description ?? 'Entry';
    case ENTITY_TYPES.RISK:
    case ENTITY_TYPES.INCONSISTENCY:
      return entity.title ?? 'Finding';
    case ENTITY_TYPES.RELATIONSHIP:
      return entity.label ?? entity.type ?? 'Relationship';
    default:
      return entity.id ?? 'Entity';
  }
}
