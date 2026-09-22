/**
 * Response parser.
 *
 * Provider responses are the least trustworthy input in the system. This module
 *  1. extracts a JSON object from whatever the model returned,
 *  2. whitelists fields so unknown keys can never leak into app state,
 *  3. coerces types, caps lengths and validates enums,
 *  4. reports everything it dropped so the UI can be honest about it.
 *
 * It returns plain data. Turning that data into legal entities (with ids and
 * validated relationships) is the job of `extractionService`.
 */

import {
  CLAUSE_TYPES,
  CONDITION_TARGETS,
  CONDITION_TYPES,
  CONSEQUENCE_TYPES,
  DATE_OFFSET_UNITS,
  DEADLINE_DATE_TYPES,
  DEFINITION_SCOPES,
  INCONSISTENCY_TYPES,
  OBLIGATION_STANDARDS,
  PARTY_ENTITY_KINDS,
  PARTY_ROLES,
  RISK_CATEGORIES,
  SEVERITIES,
} from '../legal/schema.js';
import { LIMITS, sanitizeUntrustedText } from '../security/limits.js';

/** Collections a provider may propose, in dependency order. */
export const EXTRACTION_COLLECTIONS = Object.freeze([
  'clauses',
  'parties',
  'definitions',
  'conditions',
  'deadlines',
  'consequences',
  'obligations',
  'rights',
  'risks',
  'inconsistencies',
  'relationships',
]);

/** Allowed fields per collection. Anything else is dropped and reported. */
const FIELD_WHITELIST = Object.freeze({
  clauses: [
    'number',
    'heading',
    'type',
    'summary',
    'text',
    'level',
    'clauseNumber',
    'evidence',
  ],
  parties: ['name', 'role', 'entityKind', 'jurisdiction', 'description', 'aliases', 'evidence'],
  definitions: ['term', 'text', 'scope', 'clauseNumber', 'aliases', 'evidence'],
  conditions: [
    'ref',
    'summary',
    'conditionType',
    'activates',
    'triggerDescription',
    'clauseNumber',
    'deadlineRef',
    'evidence',
  ],
  deadlines: [
    'ref',
    'description',
    'date',
    'dateType',
    'event',
    'anchorEvent',
    'relativePeriod',
    'anchorClauseNumber',
    'offsetAmount',
    'offsetUnit',
    'recurrence',
    'responsibleParty',
    'clauseNumber',
    'evidence',
  ],
  consequences: [
    'ref',
    'description',
    'consequenceType',
    'severity',
    'event',
    'clauseNumber',
    'triggerConditionRef',
    'affectedParty',
    'evidence',
  ],
  obligations: [
    'summary',
    'action',
    'obligorParty',
    'obligeeParty',
    'clauseNumber',
    'standard',
    'triggerConditionRef',
    'triggerText',
    'deadlineRef',
    'deadlineText',
    'consequenceRefs',
    'consequenceText',
    'informational',
    'evidence',
  ],
  rights: [
    'summary',
    'action',
    'condition',
    'holderParty',
    'counterpartyParty',
    'clauseNumber',
    'limitations',
    'evidence',
  ],
  risks: ['title', 'category', 'severity', 'explanation', 'clauseNumber', 'evidence'],
  inconsistencies: [
    'title',
    'inconsistencyType',
    'severity',
    'description',
    'clauseNumbers',
    'evidence',
  ],
  relationships: ['type', 'from', 'to', 'label'],
});

/**
 * Field names a model may plausibly invent for a concept we already have.
 * Aliases are mapped onto the canonical field, never merged blindly.
 */
export const FIELD_ALIASES = Object.freeze({
  clauses: { clauseNumber: 'number', section: 'heading', kind: 'type', category: 'type' },
  parties: { kind: 'entityKind', type: 'entityKind', alsoKnownAs: 'aliases', aliases2: 'aliases' },
  obligations: {
    actor: 'obligorParty',
    obliged: 'obligorParty',
    responsible: 'obligorParty',
    recipient: 'obligeeParty',
    beneficiary: 'obligeeParty',
    trigger: 'triggerText',
    dueBy: 'deadlineText',
    consequence: 'consequenceText',
  },
  rights: { holder: 'holderParty', counterparty: 'counterpartyParty', against: 'counterpartyParty' },
  conditions: { trigger: 'triggerDescription', action: 'activates', target: 'activates' },
  deadlines: { responsible: 'responsibleParty', anchor: 'anchorEvent', period: 'relativePeriod' },
  consequences: { consequence: 'description', trigger: 'event', affected: 'affectedParty' },
});

/** Enum vocabularies, keyed by the field they apply to. */
export const FIELD_ENUMS = Object.freeze({
  role: PARTY_ROLES,
  entityKind: PARTY_ENTITY_KINDS,
  scope: DEFINITION_SCOPES,
  type: CLAUSE_TYPES,
  conditionType: CONDITION_TYPES,
  activates: CONDITION_TARGETS,
  dateType: DEADLINE_DATE_TYPES,
  offsetUnit: DATE_OFFSET_UNITS,
  consequenceType: CONSEQUENCE_TYPES,
  standard: OBLIGATION_STANDARDS,
  category: RISK_CATEGORIES,
  inconsistencyType: INCONSISTENCY_TYPES,
  severity: SEVERITIES,
});

const MAX_STRING = 2000;
const MAX_EVIDENCE = 8;

function note(notes, code, message, extra = {}) {
  notes.push({ code, message, ...extra });
}

/* -------------------------------------------------------------------------- */
/* Coercion helpers                                                           */
/* -------------------------------------------------------------------------- */

/** Coerces a value to a trimmed, length-capped string (or null). */
export function coerceString(value, { maxLength = MAX_STRING } = {}) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return null;
  const cleaned = sanitizeUntrustedText(value, { maxLength }).text;
  return cleaned.length > 0 ? cleaned : null;
}

export function coerceEnum(value, allowed, fallback = 'unknown') {
  const normalized = coerceString(value, { maxLength: 64 });
  if (!normalized) return fallback;
  const match = allowed.find((option) => option === normalized.toLowerCase());
  return match ?? fallback;
}

export function coerceNumber(value, { min = null, max = null, integer = false } = {}) {
  const numeric = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return null;
  if (min !== null && numeric < min) return null;
  if (max !== null && numeric > max) return null;
  return integer ? Math.trunc(numeric) : numeric;
}

export function coerceISODate(value) {
  const text = coerceString(value, { maxLength: 32 });
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : text;
}

export function coerceStringArray(value, { maxItems = 20, maxLength = 200 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => coerceString(item, { maxLength }))
    .filter(Boolean);
}

/**
 * Extracts the first JSON object from provider text.
 * Handles fenced blocks, leading prose and trailing commentary.
 * Returns { ok, value, error, notes }.
 */
export function parseProviderJson(text) {
  const notes = [];
  const raw = String(text ?? '');
  if (!raw.trim()) {
    return { ok: false, value: null, error: 'Provider returned an empty response.', notes };
  }

  if (raw.length > LIMITS.MAX_RESPONSE_CHARS) {
    return {
      ok: false,
      value: null,
      error: `Provider response exceeded the ${LIMITS.MAX_RESPONSE_CHARS} character limit.`,
      notes,
    };
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    note(notes, 'response.fence-stripped', 'Markdown code fence was stripped.');
  }
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, value: null, error: 'No JSON object was found in the response.', notes };
  }

  const sliced = candidate.slice(start, end + 1);
  try {
    return { ok: true, value: JSON.parse(sliced), error: null, notes };
  } catch (error) {
    note(
      notes,
      'response.repair-attempted',
      `Initial JSON parse failed (${error.message}); attempted repair.`,
    );
  }

  // Conservative repair only: smart quotes and trailing commas.
  const repaired = sliced
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
  try {
    return { ok: true, value: JSON.parse(repaired), error: null, notes };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: `Provider response was not valid JSON (${error.message}).`,
      notes,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Draft normalization                                                        */
/* -------------------------------------------------------------------------- */

/** Normalizes one evidence entry from provider output (clauseNumber based). */
export function normalizeDraftEvidence(value, { documentId = null } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sourceText = coerceString(value.sourceText, { maxLength: LIMITS.MAX_EVIDENCE_CHARS });
  if (!sourceText) return null;
  return {
    documentId,
    clauseNumber: coerceString(value.clauseNumber, { maxLength: 32 }),
    clauseId: coerceString(value.clauseId, { maxLength: 64 }),
    section: coerceString(value.section, { maxLength: 64 }),
    page: coerceNumber(value.page, { min: 1, max: 100000, integer: true }),
    sourceText,
    startOffset: coerceNumber(value.startOffset, {
      min: 0,
      max: LIMITS.MAX_TEXT_CHARS,
      integer: true,
    }),
    endOffset: coerceNumber(value.endOffset, {
      min: 0,
      max: LIMITS.MAX_TEXT_CHARS,
      integer: true,
    }),
  };
}

export function normalizeDraftEvidenceList(value, options = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_EVIDENCE)
    .map((item) => normalizeDraftEvidence(item, options))
    .filter(Boolean);
}

/** Applies the field whitelist to one item, reporting anything dropped. */
function pickWhitelistedFields(item, collection, notes, index) {
  const allowed = FIELD_WHITELIST[collection] ?? [];
  const aliases = FIELD_ALIASES[collection] ?? {};
  const picked = {};
  const droppedKeys = [];
  const appliedAliases = {};
  for (const [key, value] of Object.entries(item)) {
    if (allowed.includes(key)) {
      picked[key] = value;
      continue;
    }
    const canonical = aliases[key];
    if (canonical && allowed.includes(canonical) && picked[canonical] === undefined) {
      picked[canonical] = value;
      appliedAliases[key] = canonical;
      continue;
    }
    droppedKeys.push(key);
  }
  if (Object.keys(appliedAliases).length > 0) {
    note(
      notes,
      'draft.alias-applied',
      `Accepted alternate field name(s) in ${collection}[${index}].`,
      { collection, index, aliases: appliedAliases },
    );
  }
  if (droppedKeys.length > 0) {
    note(
      notes,
      'draft.unknown-fields',
      `Dropped unsupported field(s) from ${collection}[${index}].`,
      { collection, index, fields: droppedKeys },
    );
  }
  return picked;
}

/** Normalizes a single draft item; returns null when it is unusable. */
function normalizeDraftItem(item, collection, index, context, notes) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    note(notes, 'draft.invalid-item', `Ignored non-object entry in ${collection}[${index}].`, {
      collection,
      index,
    });
    return null;
  }
  const picked = pickWhitelistedFields(item, collection, notes, index);
  const evidence = normalizeDraftEvidenceList(picked.evidence, { documentId: context.documentId });
  const str = (key, maxLength = MAX_STRING) => coerceString(picked[key], { maxLength });
  const enumOf = (key, fallback = 'unknown') =>
    coerceEnum(picked[key], FIELD_ENUMS[key] ?? [], fallback);
  const requireField = (field, label) => {
    const value = str(field);
    if (value) return value;
    note(
      notes,
      'draft.missing-field',
      `${label} at ${collection}[${index}] is missing "${field}" and was dropped.`,
      { collection, index },
    );
    return null;
  };

  switch (collection) {
    case 'clauses': {
      const number = str('number', 32);
      const heading = str('heading', 300);
      const type = enumOf('type');
      if (!number && !heading && type === 'unknown') {
        note(notes, 'draft.missing-field', `Clause hint at ${collection}[${index}] is unusable and was dropped.`, {
          collection,
          index,
        });
        return null;
      }
      return {
        number,
        heading,
        type,
        summary: str('summary', 600),
        text: str('text'),
        level: coerceNumber(picked.level, { min: 0, max: 10, integer: true }),
        clauseNumber: str('clauseNumber', 32),
        evidence,
      };
    }
    case 'parties': {
      const name = requireField('name', 'Party');
      if (!name) return null;
      return {
        name,
        role: enumOf('role'),
        entityKind: enumOf('entityKind'),
        jurisdiction: str('jurisdiction', 120),
        description: str('description', 600),
        aliases: coerceStringArray(picked.aliases, { maxItems: 8, maxLength: 120 }),
        evidence,
      };
    }
    case 'definitions': {
      const term = requireField('term', 'Definition');
      if (!term) return null;
      return {
        term,
        text: str('text') ?? '',
        scope: enumOf('scope'),
        clauseNumber: str('clauseNumber', 32),
        aliases: coerceStringArray(picked.aliases, { maxItems: 8, maxLength: 120 }),
        evidence,
      };
    }
    case 'conditions': {
      const summary = requireField('summary', 'Condition');
      if (!summary) return null;
      return {
        ref: str('ref', 64),
        summary,
        conditionType: enumOf('conditionType'),
        activates: picked.activates ? enumOf('activates') : null,
        triggerDescription: str('triggerDescription'),
        clauseNumber: str('clauseNumber', 32),
        deadlineRef: str('deadlineRef', 64),
        evidence,
      };
    }
    case 'deadlines': {
      const description = requireField('description', 'Deadline');
      if (!description) return null;
      const period =
        picked.relativePeriod && typeof picked.relativePeriod === 'object' && !Array.isArray(picked.relativePeriod)
          ? picked.relativePeriod
          : null;
      const rawUnit = picked.offsetUnit ?? period?.unit ?? null;
      return {
        ref: str('ref', 64),
        description,
        date: coerceISODate(picked.date),
        dateType: enumOf('dateType', 'unspecified'),
        event: str('event', 300) ?? str('anchorEvent', 300),
        anchorEvent: str('anchorEvent', 300) ?? str('event', 300),
        anchorClauseNumber: str('anchorClauseNumber', 32),
        offsetAmount: coerceNumber(picked.offsetAmount ?? period?.amount, {
          min: 1,
          max: 100000,
          integer: true,
        }),
        offsetUnit: rawUnit ? coerceEnum(rawUnit, DATE_OFFSET_UNITS, null) : null,
        recurrence: str('recurrence', 64),
        responsibleParty: str('responsibleParty', 300),
        clauseNumber: str('clauseNumber', 32),
        evidence,
      };
    }
    case 'consequences': {
      const description = requireField('description', 'Consequence');
      if (!description) return null;
      return {
        ref: str('ref', 64),
        description,
        consequenceType: enumOf('consequenceType'),
        severity: enumOf('severity'),
        event: str('event', 300),
        clauseNumber: str('clauseNumber', 32),
        triggerConditionRef: str('triggerConditionRef', 64),
        affectedParty: str('affectedParty', 300),
        evidence,
      };
    }
    case 'obligations': {
      const summary = requireField('summary', 'Obligation');
      if (!summary) return null;
      return {
        summary,
        action: str('action', 300),
        obligorParty: str('obligorParty', 300),
        obligeeParty: str('obligeeParty', 300),
        clauseNumber: str('clauseNumber', 32),
        standard: enumOf('standard'),
        triggerConditionRef: str('triggerConditionRef', 64),
        triggerText: str('triggerText', 600),
        deadlineRef: str('deadlineRef', 64),
        deadlineText: str('deadlineText', 600),
        consequenceRefs: coerceStringArray(picked.consequenceRefs, { maxItems: 10, maxLength: 64 }),
        consequenceText: str('consequenceText', 600),
        informational: picked.informational === true,
        evidence,
      };
    }
    case 'rights': {
      const summary = requireField('summary', 'Right');
      if (!summary) return null;
      return {
        summary,
        action: str('action', 300),
        condition: str('condition', 300),
        holderParty: str('holderParty', 300),
        counterpartyParty: str('counterpartyParty', 300),
        clauseNumber: str('clauseNumber', 32),
        limitations: coerceStringArray(picked.limitations, { maxItems: 10, maxLength: 300 }),
        evidence,
      };
    }
    case 'risks': {
      const title = requireField('title', 'Risk signal');
      if (!title) return null;
      return {
        title,
        category: enumOf('category'),
        severity: enumOf('severity'),
        explanation: str('explanation') ?? '',
        clauseNumber: str('clauseNumber', 32),
        evidence,
      };
    }
    case 'inconsistencies': {
      const title = requireField('title', 'Inconsistency');
      if (!title) return null;
      return {
        title,
        inconsistencyType: enumOf('inconsistencyType'),
        severity: enumOf('severity'),
        description: str('description') ?? '',
        clauseNumbers: coerceStringArray(picked.clauseNumbers, { maxItems: 8, maxLength: 32 }),
        evidence,
      };
    }
    case 'relationships': {
      const type = str('type', 64);
      const from = str('from', 64);
      const to = str('to', 64);
      if (!type || !from || !to) {
        note(
          notes,
          'draft.missing-field',
          `Relationship at relationships[${index}] is missing type/from/to and was dropped.`,
          { collection, index },
        );
        return null;
      }
      return { type, from, to, label: str('label', 120) };
    }
    default:
      return picked;
  }
}

/**
 * Normalizes a whole provider payload into a draft extraction.
 * Unknown keys, invalid items and oversized collections are dropped and
 * reported in `notes` / `dropped`.
 */
export function normalizeExtractionDraft(raw, { documentId = null } = {}) {
  const notes = [];
  const dropped = {};
  const draft = {};

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    note(notes, 'draft.not-object', 'Provider payload was not a JSON object.');
    return { draft: null, notes, dropped };
  }

  const seenKeys = new Set(EXTRACTION_COLLECTIONS);
  for (const key of Object.keys(raw)) {
    if (!seenKeys.has(key) && key !== 'documentType' && key !== 'effectiveDate' && key !== 'title') {
      note(notes, 'draft.unknown-collection', `Ignored unsupported top-level key "${key}".`, { key });
    }
  }

  for (const collection of EXTRACTION_COLLECTIONS) {
    const value = raw[collection];
    if (value === undefined || value === null) {
      draft[collection] = [];
      continue;
    }
    if (!Array.isArray(value)) {
      note(notes, 'draft.invalid-collection', `Ignored "${collection}" because it is not an array.`, {
        collection,
      });
      draft[collection] = [];
      dropped[collection] = 1;
      continue;
    }

    const capped = value.slice(0, LIMITS.MAX_ENTITIES_PER_TYPE);
    if (value.length > capped.length) {
      note(
        notes,
        'draft.collection-capped',
        `"${collection}" was capped at ${LIMITS.MAX_ENTITIES_PER_TYPE} items.`,
        { collection, received: value.length },
      );
      dropped[collection] = (dropped[collection] ?? 0) + (value.length - capped.length);
    }

    const items = [];
    capped.forEach((item, index) => {
      const normalized = normalizeDraftItem(item, collection, index, { documentId }, notes);
      if (normalized) items.push(normalized);
      else dropped[collection] = (dropped[collection] ?? 0) + 1;
    });
    draft[collection] = items;
  }

  // Optional document-level hints the model may add.
  draft.documentHints = {
    title: coerceString(raw.title, { maxLength: 300 }),
    documentType: raw.documentType ? coerceEnum(raw.documentType, []) : null,
    effectiveDate: coerceISODate(raw.effectiveDate),
  };

  return { draft, notes, dropped };
}

/** Counts the items a draft proposes, for the extraction report. */
export function countDraftItems(draft) {
  if (!draft) return 0;
  return EXTRACTION_COLLECTIONS.reduce(
    (total, collection) => total + (Array.isArray(draft[collection]) ? draft[collection].length : 0),
    0,
  );
}
