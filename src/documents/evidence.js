/**
 * Evidence engine.
 *
 * Every extracted legal fact in ClauseGraph must be traceable to source text.
 * This module owns the EvidenceReference shape plus the deterministic checks
 * that decide whether a reference actually points at real document content.
 *
 * "AI proposes, application code validates." A reference that fails
 * verification is never silently accepted: callers receive a status and the
 * offending facts are reported (and dropped) by `verifyModelEvidence`.
 */

import {
  EVIDENCE_REQUIRED_TYPES,
  ENTITY_TYPES,
  MODEL_COLLECTION_KEYS,
  createEntityId,
  entityTypeForCollectionKey,
  stableHash,
} from '../legal/schema.js';
import {
  LIMITS,
  normalizeWhitespace,
  stripControlCharacters,
  truncateText,
} from '../security/limits.js';
import { locateOffset } from './chunker.js';

/** Fields an EvidenceReference may carry. */
export const EVIDENCE_FIELDS = Object.freeze([
  'id',
  'documentId',
  'clauseId',
  'section',
  'page',
  'sourceText',
  'startOffset',
  'endOffset',
  'status',
  'verified',
]);

/** Minimum fields required for a reference to be usable at all. */
export const REQUIRED_EVIDENCE_FIELDS = Object.freeze(['documentId', 'clauseId', 'sourceText']);

/** Reference verification outcomes. */
export const EVIDENCE_STATUS = Object.freeze({
  VERIFIED: 'verified',
  TEXT_MISMATCH: 'text-mismatch',
  RANGE_MISMATCH: 'range-mismatch',
  UNKNOWN_CLAUSE: 'unknown-clause',
  MISSING_SOURCE: 'missing-source',
  UNVERIFIED: 'unverified',
});

/* -------------------------------------------------------------------------- */
/* Creation and normalization                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Creates an EvidenceReference. Ids are derived from the citation coordinates
 * so re-extracting the same passage yields the same id.
 */
export function createEvidenceReference({
  id,
  documentId,
  clauseId = null,
  section = null,
  page = null,
  sourceText = '',
  startOffset = null,
  endOffset = null,
  status,
  verified,
} = {}) {
  const text = truncateText(stripControlCharacters(sourceText).trim(), LIMITS.MAX_EVIDENCE_CHARS, {
    suffix: '\u2026',
  });
  const derivedId =
    id ??
    createEntityId(
      ENTITY_TYPES.EVIDENCE,
      `${documentId ?? 'doc'}|${clauseId ?? 'noclause'}|${startOffset ?? 'x'}|${stableHash(text)}`,
    );
  return {
    id: derivedId,
    documentId: documentId ?? null,
    clauseId: clauseId ?? null,
    section: section ?? null,
    page: Number.isInteger(page) ? page : null,
    sourceText: text,
    startOffset: Number.isInteger(startOffset) ? startOffset : null,
    endOffset: Number.isInteger(endOffset) ? endOffset : null,
    status: status ?? (verified === true ? EVIDENCE_STATUS.VERIFIED : EVIDENCE_STATUS.UNVERIFIED),
    verified: Boolean(verified),
  };
}

/** Coerces unknown input (e.g. raw AI JSON) into a well-formed reference. */
export function normalizeEvidenceReference(input, { documentId = null } = {}) {
  if (!input || typeof input !== 'object') return null;
  const page = Number(input.page);
  const startOffset = Number(input.startOffset);
  const endOffset = Number(input.endOffset);
  return createEvidenceReference({
    documentId:
      typeof input.documentId === 'string' && input.documentId ? input.documentId : documentId,
    clauseId: typeof input.clauseId === 'string' && input.clauseId ? input.clauseId : null,
    section: typeof input.section === 'string' && input.section ? input.section : null,
    page: Number.isFinite(page) && page > 0 ? Math.trunc(page) : null,
    sourceText: typeof input.sourceText === 'string' ? input.sourceText : '',
    startOffset: Number.isFinite(startOffset) && startOffset >= 0 ? Math.trunc(startOffset) : null,
    endOffset: Number.isFinite(endOffset) && endOffset >= 0 ? Math.trunc(endOffset) : null,
  });
}

export function normalizeEvidenceList(list, options = {}) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => normalizeEvidenceReference(item, options)).filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Verification                                                               */
/* -------------------------------------------------------------------------- */

/** Loose text comparison: case, whitespace and quote style agnostic. */
export function normalizeForComparison(input) {
  return normalizeWhitespace(stripControlCharacters(String(input ?? '')))
    .toLowerCase()
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds the verification context from parsed document content (`DocumentContent`):
 *   { documentId, pages: [{ pageNumber, text, charStart, charEnd }], text, pageCount }
 */
export function buildEvidenceContext(content, { clauseIds } = {}) {
  const text = typeof content?.text === 'string' ? content.text : '';
  return {
    documentId: content?.documentId ?? null,
    text,
    charCount: text.length,
    pageCount: Number.isInteger(content?.pageCount) ? content.pageCount : null,
    pages: Array.isArray(content?.pages) ? content.pages : [],
    clauseIds: clauseIds instanceof Set ? clauseIds : new Set(clauseIds ?? []),
    hasContent: text.length > 0,
  };
}

/**
 * Deterministically verifies one reference against document content.
 * Returns { status, ok, issues } and never throws.
 */
export function verifyEvidenceReference(reference, context) {
  const issues = [];
  if (!reference || typeof reference !== 'object') {
    return {
      status: EVIDENCE_STATUS.MISSING_SOURCE,
      ok: false,
      issues: ['Evidence reference is empty.'],
    };
  }
  if (!context?.documentId) {
    return {
      status: EVIDENCE_STATUS.UNVERIFIED,
      ok: false,
      issues: ['No parsed document content is available for verification.'],
    };
  }
  if (!reference.documentId) {
    return {
      status: EVIDENCE_STATUS.MISSING_SOURCE,
      ok: false,
      issues: ['Evidence reference has no documentId.'],
    };
  }
  if (reference.documentId !== context.documentId) {
    return {
      status: EVIDENCE_STATUS.MISSING_SOURCE,
      ok: false,
      issues: [
        `Evidence points at document "${reference.documentId}" but is attached to "${context.documentId}".`,
      ],
    };
  }
  if (!reference.clauseId) {
    issues.push('Evidence reference has no clauseId.');
  } else if (
    context.clauseIds &&
    context.clauseIds.size > 0 &&
    !context.clauseIds.has(reference.clauseId)
  ) {
    return {
      status: EVIDENCE_STATUS.UNKNOWN_CLAUSE,
      ok: false,
      issues: [...issues, `Evidence references unknown clause "${reference.clauseId}".`],
    };
  }
  if (!reference.sourceText) {
    return {
      status: EVIDENCE_STATUS.MISSING_SOURCE,
      ok: false,
      issues: [...issues, 'Evidence reference has no sourceText.'],
    };
  }
  if (
    Number.isInteger(reference.page) &&
    Number.isInteger(context.pageCount) &&
    (reference.page < 1 || reference.page > context.pageCount)
  ) {
    return {
      status: EVIDENCE_STATUS.UNKNOWN_CLAUSE,
      ok: false,
      issues: [...issues, `Evidence cites page ${reference.page} of ${context.pageCount}.`],
    };
  }

  const hasRange = Number.isInteger(reference.startOffset) && Number.isInteger(reference.endOffset);

  if (!context.hasContent) {
    issues.push('Document text is unavailable; evidence could not be matched.');
    return { status: EVIDENCE_STATUS.UNVERIFIED, ok: false, issues };
  }

  const needle = normalizeForComparison(reference.sourceText);
  const haystack = normalizeForComparison(context.text);

  if (hasRange) {
    if (reference.startOffset < 0 || reference.endOffset <= reference.startOffset) {
      return {
        status: EVIDENCE_STATUS.RANGE_MISMATCH,
        ok: false,
        issues: [...issues, 'Evidence character range is invalid.'],
      };
    }
    if (reference.endOffset > context.charCount) {
      return {
        status: EVIDENCE_STATUS.RANGE_MISMATCH,
        ok: false,
        issues: [...issues, 'Evidence character range falls outside the document.'],
      };
    }
    const slice = normalizeForComparison(
      context.text.slice(reference.startOffset, reference.endOffset),
    );
    const ok = slice.length > 0 && (slice.includes(needle) || needle.includes(slice));
    return ok
      ? { status: EVIDENCE_STATUS.VERIFIED, ok: true, issues }
      : {
          status: EVIDENCE_STATUS.TEXT_MISMATCH,
          ok: false,
          issues: [...issues, 'Quoted source text does not match the cited character range.'],
        };
  }

  // No offsets supplied: fall back to a substring search over the whole document.
  const ok = haystack.includes(needle);
  return ok
    ? {
        status: EVIDENCE_STATUS.VERIFIED,
        ok: true,
        issues: [...issues, 'Verified by text match (no character offsets supplied).'],
      }
    : {
        status: EVIDENCE_STATUS.TEXT_MISMATCH,
        ok: false,
        issues: [...issues, 'Quoted source text was not found in the document.'],
      };
}

/** Returns a copy of the reference with verification stamped onto it. */
export function stampEvidenceReference(reference, context) {
  const result = verifyEvidenceReference(reference, context);
  return {
    reference: { ...reference, status: result.status, verified: result.ok },
    result,
  };
}

/* -------------------------------------------------------------------------- */
/* Model-level verification                                                   */
/* -------------------------------------------------------------------------- */

function verifyEntityEvidence(entity, context, entityType) {
  const references = Array.isArray(entity.evidence) ? entity.evidence : [];
  const stamped = [];
  const issues = [];
  let verifiedCount = 0;

  for (const reference of references) {
    const { reference: stampedRef, result } = stampEvidenceReference(reference, context);
    stamped.push(stampedRef);
    if (result.ok) verifiedCount += 1;
    else issues.push({ evidenceId: stampedRef.id, status: result.status, messages: result.issues });
  }

  const requiresEvidence = EVIDENCE_REQUIRED_TYPES.includes(entityType);
  const status =
    verifiedCount > 0
      ? EVIDENCE_STATUS.VERIFIED
      : requiresEvidence
        ? EVIDENCE_STATUS.MISSING_SOURCE
        : EVIDENCE_STATUS.UNVERIFIED;

  return {
    entity: {
      ...entity,
      evidence: stamped,
      verification: {
        status,
        verifiedEvidenceCount: verifiedCount,
        totalEvidenceCount: stamped.length,
        issues,
      },
    },
    status,
    verifiedCount,
    issues,
  };
}

/**
 * Verifies every evidence reference in a model against parsed document content.
 *
 * Entities whose mandatory evidence cannot be verified are REJECTED rather than
 * silently accepted (hallucinated citations never reach application state).
 * Rejected entities are also pruned from relationships so the graph cannot hold
 * edges pointing at facts the app refused to trust.
 *
 * Returns { model, report } and never throws.
 */
export function verifyModelEvidence(model, content, { dropUnverified = true } = {}) {
  const report = {
    documentId: model?.documentId ?? null,
    checkedEntities: 0,
    verifiedEntities: 0,
    rejectedEntities: 0,
    rejectedIds: [],
    rejectedRelationships: 0,
    issues: [],
  };

  if (!model || typeof model !== 'object') {
    report.issues.push({
      entityId: null,
      status: EVIDENCE_STATUS.UNVERIFIED,
      messages: ['Model is empty.'],
    });
    return { model, report };
  }

  const clauseIds = new Set(
    (Array.isArray(model.clauses) ? model.clauses : []).map((clause) => clause.id),
  );
  const context = buildEvidenceContext(content, { clauseIds });
  const nextModel = { ...model };

  for (const key of MODEL_COLLECTION_KEYS) {
    if (!Array.isArray(model[key]) || key === 'relationships' || key === 'documents') continue;
    const entityType = entityTypeForCollectionKey(key);
    nextModel[key] = model[key].map((entity) => {
      report.checkedEntities += 1;
      const outcome = verifyEntityEvidence(entity, context, entityType);
      if (outcome.verifiedCount > 0) {
        report.verifiedEntities += 1;
      } else if (EVIDENCE_REQUIRED_TYPES.includes(entityType)) {
        report.rejectedEntities += 1;
        report.rejectedIds.push(entity.id);
        report.issues.push({
          entityId: entity.id,
          entityType,
          status: outcome.status,
          messages: outcome.issues,
        });
      }
      return outcome.entity;
    });
  }

  if (dropUnverified && report.rejectedIds.length > 0) {
    const rejected = new Set(report.rejectedIds);
    for (const key of MODEL_COLLECTION_KEYS) {
      if (key === 'relationships' || !Array.isArray(nextModel[key])) continue;
      nextModel[key] = nextModel[key].filter((entity) => !rejected.has(entity.id));
    }
    nextModel.documents = (nextModel.documents ?? []).map((doc) => ({
      ...doc,
      partyIds: (doc.partyIds ?? []).filter((id) => !rejected.has(id)),
      clauseIds: (doc.clauseIds ?? []).filter((id) => !rejected.has(id)),
    }));
  }

  if (Array.isArray(nextModel.relationships)) {
    const known = new Set();
    for (const key of MODEL_COLLECTION_KEYS) {
      if (key === 'relationships') continue;
      for (const entity of nextModel[key] ?? []) known.add(entity.id);
    }
    nextModel.relationships = nextModel.relationships.filter((rel) => {
      const keep = known.has(rel.fromId) && known.has(rel.toId);
      if (!keep) report.rejectedRelationships += 1;
      return keep;
    });
  }

  nextModel.meta = { ...(nextModel.meta ?? {}), evidenceVerifiedAt: new Date().toISOString() };
  return { model: nextModel, report };
}

/* -------------------------------------------------------------------------- */
/* Presentation helpers (pure strings, no JSX)                                */
/* -------------------------------------------------------------------------- */

/** Builds a compact citation such as "§4.2 · p. 3". */
export function evidenceCitation(reference, { clauseNumber = null, section = null } = {}) {
  if (!reference) return 'No source';
  const parts = [];
  const label = clauseNumber ?? reference.section ?? section;
  if (label) parts.push(String(label).startsWith('\u00a7') ? label : `\u00a7${label}`);
  if (reference.page) parts.push(`p. ${reference.page}`);
  return parts.length > 0 ? parts.join(' \u00b7 ') : 'Source excerpt';
}

/**
 * Coverage summary for the trust/status area: how many EXTRACTED FACTS are
 * anchored to source text that deterministic code could verify.
 *
 * Measured entity types are the ones an AI provider proposes (parties,
 * definitions, rights, obligations, conditions, deadlines, consequences, risks,
 * inconsistencies). Parser-produced structure (document, clauses) and derived
 * relationship edges are counted separately, because they are not citations —
 * they are the source.
 */
export function summarizeEvidenceCoverage(model) {
  const summary = {
    total: 0,
    withEvidence: 0,
    verified: 0,
    unverified: 0,
    coverageRatio: 0,
    structuralEntities: 0,
    relationshipCount: 0,
  };
  if (!model) return summary;

  for (const key of MODEL_COLLECTION_KEYS) {
    if (key === 'relationships') {
      summary.relationshipCount = Array.isArray(model[key]) ? model[key].length : 0;
      continue;
    }
    if (key === 'documents' || key === 'clauses') {
      summary.structuralEntities += Array.isArray(model[key]) ? model[key].length : 0;
      continue;
    }
    for (const entity of model[key] ?? []) {
      summary.total += 1;
      const references = Array.isArray(entity.evidence) ? entity.evidence : [];
      if (references.length > 0) summary.withEvidence += 1;
      if (references.some((reference) => reference.verified)) summary.verified += 1;
      else summary.unverified += 1;
    }
  }

  summary.coverageRatio = summary.total === 0 ? 0 : summary.verified / summary.total;
  return summary;
}

/** Convenience: coverage expressed as "29/29 facts". */
export function formatCoverage(coverage) {
  if (!coverage || coverage.total === 0) return 'no extracted facts yet';
  return `${coverage.verified}/${coverage.total} facts with a verified citation`;
}

/* -------------------------------------------------------------------------- */
/* Evidence mapping                                                           */
/* -------------------------------------------------------------------------- */

/** Collections holding AI-proposed facts (structure and edges excluded). */
export const FACT_COLLECTIONS = Object.freeze(
  MODEL_COLLECTION_KEYS.filter((key) => key !== 'documents' && key !== 'clauses' && key !== 'relationships'),
);

/** Clause-shaped fields a fact may use to point at document text. */
const FACT_CLAUSE_FIELDS = Object.freeze(['clauseId', 'clauseIds', 'definedInClauseIds']);

/** Every clause a fact claims to come from, entity field first, then citations. */
export function factClauseIds(entity) {
  const ids = new Set();
  if (!entity || typeof entity !== 'object') return ids;
  for (const field of FACT_CLAUSE_FIELDS) {
    const value = entity[field];
    if (typeof value === 'string' && value) ids.add(value);
    if (Array.isArray(value)) value.filter((entry) => typeof entry === 'string' && entry).forEach((entry) => ids.add(entry));
  }
  for (const reference of Array.isArray(entity.evidence) ? entity.evidence : []) {
    if (reference?.clauseId) ids.add(reference.clauseId);
  }
  return ids;
}

/**
 * Flattens a model into fact records with their clause anchors.
 * Deterministic and cheap enough for render-time use on typical documents.
 */
export function collectFacts(model) {
  const facts = [];
  if (!model) return facts;
  for (const collectionKey of FACT_COLLECTIONS) {
    const entityType = entityTypeForCollectionKey(collectionKey);
    for (const entity of model[collectionKey] ?? []) {
      if (!entity || typeof entity !== 'object') continue;
      facts.push({
        collectionKey,
        entityType,
        entity,
        clauseIds: [...factClauseIds(entity)],
        references: Array.isArray(entity.evidence) ? entity.evidence : [],
      });
    }
  }
  return facts;
}

/**
 * Maps facts onto the clauses they cite, so the document navigator can show
 * "this clause produced 3 facts, 2 of them verified" without re-scanning the
 * model per clause.
 */
export function indexClauseFacts(model) {
  const facts = collectFacts(model);
  const byClause = new Map();
  const orphans = [];
  for (const fact of facts) {
    if (fact.clauseIds.length === 0) {
      orphans.push(fact);
      continue;
    }
    for (const clauseId of fact.clauseIds) {
      byClause.set(clauseId, [...(byClause.get(clauseId) ?? []), fact]);
    }
  }
  return { facts, byClause, orphans };
}

/** Facts anchored to one clause (empty array when there are none). */
export function factsForClause(model, clauseId) {
  if (!clauseId) return [];
  return indexClauseFacts(model).byClause.get(clauseId) ?? [];
}

/** One fact plus its verification roll-up, or null when the id is unknown. */
export function factsForEntity(model, entityId) {
  const fact = collectFacts(model).find((entry) => entry.entity.id === entityId);
  if (!fact) return null;
  const references = fact.references;
  return {
    ...fact,
    verifiedCount: references.filter((reference) => reference.verified).length,
    unverifiedCount: references.filter((reference) => !reference.verified).length,
    coverageRatio: references.length === 0 ? 0 : references.filter((r) => r.verified).length / references.length,
  };
}

/**
 * Resolves an evidence reference to a place in the source document: page,
 * paragraph, innermost clause and the exact quoted text. The workspace uses
 * this to jump from a citation to the text it came from.
 */
export function mapReferenceToSource(reference, { content = null, clauses = [] } = {}) {
  if (!reference) return null;
  const offset = Number.isInteger(reference.startOffset)
    ? reference.startOffset
    : content
      ? (content.text ?? '').indexOf(reference.sourceText ?? '')
      : -1;
  const location = offset >= 0 ? locateOffset(content, clauses, offset) : null;
  return {
    referenceId: reference.id ?? null,
    verified: Boolean(reference.verified),
    status: reference.status ?? (reference.verified ? EVIDENCE_STATUS.VERIFIED : EVIDENCE_STATUS.UNVERIFIED),
    sourceText: reference.sourceText ?? '',
    startOffset: Number.isInteger(reference.startOffset) ? reference.startOffset : null,
    endOffset: Number.isInteger(reference.endOffset) ? reference.endOffset : null,
    page: location?.page ?? reference.page ?? null,
    paragraphIndex: location?.paragraphIndex ?? null,
    clauseId: location?.clauseId ?? reference.clauseId ?? null,
    clauseNumber: location?.clauseNumber ?? reference.section ?? null,
    inDocument: Boolean(location?.inRange),
  };
}

/**
 * Per-clause evidence counts for the navigator and filters.
 * Returns { byClause, totals } where `byClause` values are
 * { facts, verified, unverified, missing, byType }.
 */
export function summarizeClauseEvidence(model) {
  const { byClause } = indexClauseFacts(model);
  const result = new Map();
  const totals = { clauses: 0, facts: 0, verified: 0, unverified: 0, missing: 0 };
  for (const [clauseId, facts] of byClause.entries()) {
    const summary = { facts: facts.length, verified: 0, unverified: 0, missing: 0, byType: {} };
    for (const fact of facts) {
      const type = fact.entityType;
      summary.byType[type] = (summary.byType[type] ?? 0) + 1;
      if (fact.references.length === 0) summary.missing += 1;
      else if (fact.references.some((reference) => reference.verified)) summary.verified += 1;
      else summary.unverified += 1;
    }
    result.set(clauseId, summary);
    totals.clauses += 1;
    totals.facts += summary.facts;
    totals.verified += summary.verified;
    totals.unverified += summary.unverified;
    totals.missing += summary.missing;
  }
  return { byClause: result, totals };
}
