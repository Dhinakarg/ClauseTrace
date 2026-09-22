/**
 * Extraction service.
 *
 * Orchestrates the full pipeline for one document:
 *
 *   parsed content
 *     → chunker (deterministic clause skeleton)
 *     → provider (AI proposes structured facts, one chunk at a time)
 *     → responseParser (fence/whitelist/coerce: nothing unknown survives)
 *     → assembleModel (ids, references, evidence wiring)
 *     → relationships (validate AI edges, derive the rest deterministically)
 *     → evidence verification (drop facts whose citations do not check out)
 *     → validators (final gate before the model reaches app state)
 *
 * Every step reports what it dropped. The returned `report` is what the UI uses
 * to show trust, coverage and gaps instead of implying certainty.
 */

import {
  ENTITY_TYPES,
  PROVENANCE,
  createConsequence,
  createCondition,
  createDeadline,
  createDefinition,
  createDocument,
  createEntityId,
  createInconsistency,
  createObligation,
  createParty,
  createRight,
  createRisk,
} from '../legal/schema.js';
import { validateRelationshipDrafts, withDerivedRelationships } from '../legal/relationships.js';
import { validateLegalModel } from '../legal/validators.js';
import { isWeakClauseType } from '../legal/clauseTypes.js';
import {
  createEvidenceReference,
  normalizeForComparison,
  summarizeClauseEvidence,
  verifyModelEvidence,
} from '../documents/evidence.js';
import { describeChunkLocation, mapChunksToClauses, prepareChunks } from '../documents/chunker.js';
import { LIMITS } from '../security/limits.js';
import {
  EXTRACTION_SCHEMA_VERSION,
  buildExtractionPrompt,
  buildRepairPrompt,
  describePromptContract,
} from './prompts.js';
import { countDraftItems, normalizeExtractionDraft, parseProviderJson } from './responseParser.js';
import { AIProviderError } from './provider.js';
import { STAGE_IDS, STAGE_STATUS } from '../documents/stages.js';

/** Normalizes a party name for matching purposes. */
function normalizeName(value) {
  return normalizeForComparison(value).replace(/[.,]/g, '');
}

/** Builds the document entity from parsed content plus extraction hints. */
export function createDocumentFromContent(content, hints = {}) {
  return createDocument({
    id: content?.documentId ?? undefined,
    title: hints.title ?? content?.fileName ?? 'Untitled document',
    documentType: hints.documentType ?? 'unknown',
    effectiveDate: hints.effectiveDate ?? null,
    pageCount: content?.pageCount ?? null,
    metadata: {
      ...content?.metadata,
      fileName: content?.fileName ?? null,
      fileType: content?.fileType ?? null,
      charCount: content?.charCount ?? 0,
      warnings: content?.warnings ?? [],
    },
    provenance: PROVENANCE.PARSER,
  });
}

/**
 * Turns a draft evidence entry into a verifiable EvidenceReference.
 * Clause ids are resolved from the model's clause skeleton; when neither a
 * clause number nor an id resolves, the entry is still kept with a null
 * clauseId so the verifier can at least text-match it (and flag the gap).
 */
export function resolveDraftEvidence(
  entry,
  { documentId, clauseNumberToId, clauseById, defaultClauseId = null },
) {
  if (!entry?.sourceText) return null;
  const explicitClauseId = entry.clauseId && clauseById.has(entry.clauseId) ? entry.clauseId : null;
  const byNumber =
    !explicitClauseId && entry.clauseNumber ? clauseNumberToId.get(entry.clauseNumber) : null;
  const clauseId = explicitClauseId ?? byNumber ?? defaultClauseId ?? null;
  const clause = clauseId ? clauseById.get(clauseId) : null;
  return createEvidenceReference({
    documentId,
    clauseId,
    section: entry.section ?? clause?.number ?? entry.clauseNumber ?? null,
    page: entry.page ?? clause?.page ?? null,
    sourceText: entry.sourceText,
    startOffset: entry.startOffset,
    endOffset: entry.endOffset,
  });
}

/**
 * Applies AI clause hints to the parser-produced skeleton.
 *
 * The parser owns the clause list: segmentation, offsets, ordering and ids are
 * never taken from the model. A hint can only (a) refine the type of a clause
 * the rules could not classify, and (b) attach a short summary. Unmatched hints
 * are ignored and counted, and the AI type is recorded as `typeSource: 'ai'`.
 */
export function applyClauseHints(clauses = [], hints = []) {
  const issues = [];
  let applied = 0;
  let ignored = 0;
  const next = clauses.map((clause) => ({ ...clause }));
  const nextByNumber = new Map();
  for (const clause of next) {
    if (clause.number) nextByNumber.set(String(clause.number).toLowerCase(), clause);
  }

  for (const hint of hints ?? []) {
    const key = String(hint?.number ?? hint?.clauseNumber ?? '').toLowerCase();
    const clause = key ? nextByNumber.get(key) : null;
    if (!clause) {
      ignored += 1;
      continue;
    }
    const before = clause.clauseType;
    if (hint.type && hint.type !== 'unknown' && isWeakClauseType(before)) {
      clause.clauseType = hint.type;
      clause.clauseTypeSource = 'ai';
    }
    if (hint.summary && !clause.summary) clause.summary = hint.summary;
    if (clause.clauseType !== before) {
      issues.push({
        code: 'assemble.clause-type-refined',
        message: `Clause ${clause.number ?? clause.id} type set to "${clause.clauseType}" from the model (parser said "${before}").`,
      });
    }
    applied += 1;
  }

  if (ignored > 0) {
    issues.push({
      code: 'assemble.ignored-clause-hint',
      message: `${ignored} clause hint(s) did not match any parsed clause and were ignored.`,
    });
  }

  return { clauses: next, applied, ignored, issues };
}

/**
 * Drops exact duplicate proposals within a collection (first occurrence wins).
 * Providers do repeat themselves across chunks; duplicates must not become two
 * entities in the workspace.
 */
export function dedupeProposals(items = [], signature) {
  const seen = new Map();
  const kept = [];
  let dropped = 0;
  for (const item of items) {
    const key = signature(item);
    if (key && seen.has(key)) {
      dropped += 1;
      continue;
    }
    if (key) seen.set(key, true);
    kept.push(item);
  }
  return { kept, dropped, issues: dropped > 0 ? [{ code: 'assemble.duplicate-entity', message: `${dropped} duplicate proposal(s) were merged.` }] : [] };
}

/**
 * Guarantees every entity id in a model is unique.
 * Deterministic ids are derived from text, so two similar facts can collide;
 * the second one is suffixed rather than silently overwriting the first.
 */
export function ensureUniqueEntityIds(model, { collectionKeys = [] } = {}) {
  if (!model || typeof model !== 'object') return { model, renamed: [] };
  const seen = new Set();
  const renamed = [];
  const next = { ...model };

  for (const key of collectionKeys) {
    const list = next[key];
    if (!Array.isArray(list)) continue;
    next[key] = list.map((entity) => {
      if (!entity || typeof entity.id !== 'string' || !entity.id) return entity;
      if (!seen.has(entity.id)) {
        seen.add(entity.id);
        return entity;
      }
      let suffix = 2;
      let candidate = `${entity.id}_${suffix}`;
      while (seen.has(candidate)) {
        suffix += 1;
        candidate = `${entity.id}_${suffix}`;
      }
      seen.add(candidate);
      renamed.push({ from: entity.id, to: candidate });
      return { ...entity, id: candidate };
    });
  }

  return { model: next, renamed };
}

/** How a duplicate proposal is recognised, per collection. */
const DEDUPE_SIGNATURES = Object.freeze({
  clauses: (draft) => String(draft.number ?? draft.heading ?? '').toLowerCase(),
  parties: (draft) => normalizeName(draft.name),
  definitions: (draft) => String(draft.term ?? '').toLowerCase(),
  conditions: (draft) => (draft.ref ? `ref:${draft.ref}` : String(draft.summary ?? '').toLowerCase()),
  deadlines: (draft) =>
    draft.ref ? `ref:${draft.ref}` : String(draft.description ?? '').toLowerCase(),
  consequences: (draft) =>
    draft.ref ? `ref:${draft.ref}` : String(draft.description ?? '').toLowerCase(),
  obligations: (draft) =>
    `${String(draft.summary ?? '').toLowerCase()}|${draft.clauseNumber ?? ''}`,
  rights: (draft) => `${String(draft.summary ?? '').toLowerCase()}|${draft.clauseNumber ?? ''}`,
  risks: (draft) => `${String(draft.title ?? '').toLowerCase()}|${draft.clauseNumber ?? ''}`,
  inconsistencies: (draft) =>
    `${String(draft.title ?? '').toLowerCase()}|${(draft.clauseNumbers ?? []).join(',')}`,
  relationships: (draft) => `${draft.type}|${draft.from}|${draft.to}`.toLowerCase(),
});

/**
 * Removes repeated proposals across chunks before assembly.
 * Providers restate the same clause in overlapping chunks; without this, one
 * fact would appear twice in the workspace.
 */
export function dedupeDrafts(drafts = []) {
  const deduped = drafts.map((draft) => ({ ...draft }));
  const droppedByCollection = {};
  for (const [collection, signature] of Object.entries(DEDUPE_SIGNATURES)) {
    const seen = new Set();
    for (const draft of deduped) {
      const items = Array.isArray(draft[collection]) ? draft[collection] : [];
      const kept = [];
      for (const item of items) {
        const key = item && typeof item === 'object' ? signature(item) : '';
        if (key && seen.has(key)) {
          droppedByCollection[collection] = (droppedByCollection[collection] ?? 0) + 1;
          continue;
        }
        if (key) seen.add(key);
        kept.push(item);
      }
      draft[collection] = kept;
    }
  }
  return { drafts: deduped, droppedByCollection };
}

/**
 * Assembles a LegalModel from normalized drafts (one or more chunks).
 * References (party names, ref keys, clause numbers) are resolved here.
 * Anything that cannot be resolved becomes null and is reported, never guessed.
 */
export function assembleModel({
  documentId,
  document = null,
  clauses = [],
  drafts = [],
  clauseHints = [],
}) {
  const issues = [];
  // Repeated proposals across chunks must not become duplicate entities.
  const deduped = dedupeDrafts(drafts);
  const draftList = deduped.drafts;
  for (const [collection, count] of Object.entries(deduped.droppedByCollection)) {
    issues.push({
      code: 'assemble.duplicate-entity',
      message: `${count} duplicate "${collection}" proposal(s) across chunks were merged.`,
    });
  }

  // The parser skeleton is authoritative; AI hints may only refine weak types.
  const hinted = applyClauseHints(clauses, [
    ...clauseHints,
    ...draftList.flatMap((draft) => draft?.clauses ?? []),
  ]);
  const effectiveClauses = hinted.clauses;
  issues.push(...hinted.issues);

  const clauseById = new Map(effectiveClauses.map((clause) => [clause.id, clause]));
  const clauseNumberToId = new Map();
  for (const clause of effectiveClauses) {
    if (clause.number) clauseNumberToId.set(String(clause.number), clause.id);
  }

  const evidenceFor = (list, defaultClauseId = null) =>
    (Array.isArray(list) ? list : [])
      .map((entry) =>
        resolveDraftEvidence(entry, { documentId, clauseNumberToId, clauseById, defaultClauseId }),
      )
      .filter(Boolean);

  const mergeDrafts = (key) => draftList.flatMap((draft) => draft?.[key] ?? []);
  const clauseIdFor = (number) => (number ? clauseNumberToId.get(String(number)) ?? null : null);

  /* Parties --------------------------------------------------------------- */
  const parties = [];
  const partyByName = new Map();
  for (const draft of mergeDrafts('parties')) {
    const key = normalizeName(draft.name);
    if (partyByName.has(key)) {
      issues.push({
        code: 'assemble.duplicate-party',
        message: `Merged duplicate party "${draft.name}".`,
      });
      continue;
    }
    const party = createParty({
      id: createEntityId(ENTITY_TYPES.PARTY, `${documentId}:${draft.name}`),
      documentId,
      name: draft.name,
      role: draft.role,
      entityKind: draft.entityKind,
      jurisdiction: draft.jurisdiction,
      description: draft.description,
      aliases: draft.aliases,
      evidence: evidenceFor(draft.evidence),
      provenance: PROVENANCE.AI,
    });
    parties.push(party);
    partyByName.set(key, party.id);
    for (const alias of draft.aliases ?? []) {
      const aliasKey = normalizeName(alias);
      if (aliasKey && !partyByName.has(aliasKey)) partyByName.set(aliasKey, party.id);
    }
  }
  const resolveParty = (name) => (name ? partyByName.get(normalizeName(name)) ?? null : null);

  /* Definitions ----------------------------------------------------------- */
  const definitions = mergeDrafts('definitions').map((draft) => {
    const clauseId = clauseIdFor(draft.clauseNumber);
    return createDefinition({
      id: createEntityId(ENTITY_TYPES.DEFINITION, `${documentId}:${draft.term}`),
      documentId,
      term: draft.term,
      text: draft.text,
      scope: draft.scope,
      clauseId,
      aliases: draft.aliases,
      evidence: evidenceFor(draft.evidence, clauseId),
      provenance: PROVENANCE.AI,
    });
  });

  /* Conditions ------------------------------------------------------------ */
  const conditions = mergeDrafts('conditions').map((draft) => {
    const clauseId = clauseIdFor(draft.clauseNumber);
    return createCondition({
      id: createEntityId(ENTITY_TYPES.CONDITION, `${documentId}:${draft.ref ?? draft.summary}`),
      documentId,
      summary: draft.summary,
      conditionType: draft.conditionType,
      activates: draft.activates,
      triggerDescription: draft.triggerDescription,
      clauseId,
      evidence: evidenceFor(draft.evidence, clauseId),
      provenance: PROVENANCE.AI,
    });
  });
  const conditionByRef = new Map();
  mergeDrafts('conditions').forEach((draft, index) => {
    if (draft.ref && conditions[index]) conditionByRef.set(draft.ref, conditions[index].id);
  });

  /* Deadlines ------------------------------------------------------------- */
  const deadlines = mergeDrafts('deadlines').map((draft) => {
    const clauseId = clauseIdFor(draft.clauseNumber) ?? clauseIdFor(draft.anchorClauseNumber);
    return createDeadline({
      id: createEntityId(ENTITY_TYPES.DEADLINE, `${documentId}:${draft.ref ?? draft.description}`),
      documentId,
      description: draft.description,
      date: draft.date,
      dateType: draft.dateType,
      event: draft.event,
      anchorEvent: draft.anchorEvent,
      offsetAmount: draft.offsetAmount,
      offsetUnit: draft.offsetUnit,
      recurrence: draft.recurrence,
      responsiblePartyId: resolveParty(draft.responsibleParty),
      clauseId,
      evidence: evidenceFor(draft.evidence, clauseId),
      provenance: PROVENANCE.AI,
    });
  });
  const deadlineByRef = new Map();
  mergeDrafts('deadlines').forEach((draft, index) => {
    if (draft.ref && deadlines[index]) deadlineByRef.set(draft.ref, deadlines[index].id);
  });

  /* Consequences ---------------------------------------------------------- */
  const consequences = mergeDrafts('consequences').map((draft) => {
    const clauseId = clauseIdFor(draft.clauseNumber);
    return createConsequence({
      id: createEntityId(ENTITY_TYPES.CONSEQUENCE, `${documentId}:${draft.ref ?? draft.description}`),
      documentId,
      description: draft.description,
      consequenceType: draft.consequenceType,
      severity: draft.severity,
      event: draft.event,
      clauseId,
      triggerConditionId: draft.triggerConditionRef
        ? conditionByRef.get(draft.triggerConditionRef) ?? null
        : null,
      affectedPartyId: resolveParty(draft.affectedParty),
      evidence: evidenceFor(draft.evidence, clauseId),
      provenance: PROVENANCE.AI,
    });
  });
  const consequenceByRef = new Map();
  mergeDrafts('consequences').forEach((draft, index) => {
    if (draft.ref && consequences[index]) consequenceByRef.set(draft.ref, consequences[index].id);
  });

  /* Obligations ----------------------------------------------------------- */
  const obligations = mergeDrafts('obligations').map((draft) => {
    const clauseId = clauseIdFor(draft.clauseNumber);
    if (!clauseId) {
      issues.push({
        code: 'assemble.unresolved-clause',
        message: `Obligation "${draft.summary}" cites clause ${draft.clauseNumber ?? '(none)'}, which the parser did not find.`,
      });
    }
    const obligorId = resolveParty(draft.obligorParty);
    if (draft.obligorParty && !obligorId) {
      issues.push({
        code: 'assemble.unresolved-party',
        message: `Obligation "${draft.summary}" names obligor "${draft.obligorParty}", which is not a declared party.`,
      });
    }
    return createObligation({
      id: createEntityId(ENTITY_TYPES.OBLIGATION, `${documentId}:${draft.summary}`),
      documentId,
      summary: draft.summary,
      action: draft.action,
      obligorPartyId: obligorId,
      obligeePartyId: resolveParty(draft.obligeeParty),
      clauseId,
      standard: draft.standard,
      triggerConditionId: draft.triggerConditionRef
        ? conditionByRef.get(draft.triggerConditionRef) ?? null
        : null,
      triggerText: draft.triggerText,
      deadlineId: draft.deadlineRef ? deadlineByRef.get(draft.deadlineRef) ?? null : null,
      deadlineText: draft.deadlineText,
      consequenceIds: (draft.consequenceRefs ?? [])
        .map((ref) => consequenceByRef.get(ref))
        .filter(Boolean),
      consequenceText: draft.consequenceText,
      informational: draft.informational,
      evidence: evidenceFor(draft.evidence, clauseId),
      provenance: PROVENANCE.AI,
    });
  });

  /* Rights ---------------------------------------------------------------- */
  const rights = mergeDrafts('rights').map((draft) => {
    const clauseId = clauseIdFor(draft.clauseNumber);
    return createRight({
      id: createEntityId(ENTITY_TYPES.RIGHT, `${documentId}:${draft.summary}`),
      documentId,
      summary: draft.summary,
      action: draft.action,
      condition: draft.condition,
      holderPartyId: resolveParty(draft.holderParty),
      counterpartyPartyId: resolveParty(draft.counterpartyParty),
      clauseId,
      limitations: draft.limitations,
      evidence: evidenceFor(draft.evidence, clauseId),
      provenance: PROVENANCE.AI,
    });
  });

  /* Risk signals ---------------------------------------------------------- */
  const risks = mergeDrafts('risks').map((draft) => {
    const clauseId = clauseIdFor(draft.clauseNumber);
    return createRisk({
      id: createEntityId(ENTITY_TYPES.RISK, `${documentId}:${draft.title}`),
      documentId,
      title: draft.title,
      category: draft.category,
      severity: draft.severity,
      explanation: draft.explanation,
      clauseId,
      evidence: evidenceFor(draft.evidence, clauseId),
      provenance: PROVENANCE.AI,
    });
  });

  /* Inconsistencies ------------------------------------------------------- */
  const inconsistencies = mergeDrafts('inconsistencies').map((draft) => {
    const clauseIds = (draft.clauseNumbers ?? []).map(clauseIdFor).filter(Boolean);
    return createInconsistency({
      id: createEntityId(ENTITY_TYPES.INCONSISTENCY, `${documentId}:${draft.title}`),
      documentId,
      title: draft.title,
      inconsistencyType: draft.inconsistencyType,
      severity: draft.severity,
      description: draft.description,
      clauseIds,
      clauseId: clauseIds[0] ?? null,
      evidence: evidenceFor(draft.evidence, clauseIds[0] ?? null),
      provenance: PROVENANCE.AI,
    });
  });

  /* Wiring ---------------------------------------------------------------- */
  const documentEntity =
    document ??
    createDocument({ id: documentId, title: 'Untitled document', documentType: 'unknown' });

  const modelBase = {
    documentId,
    documents: [{ ...documentEntity, partyIds: parties.map((p) => p.id), clauseIds: effectiveClauses.map((c) => c.id) }],
    parties,
    clauses: [...effectiveClauses],
    definitions,
    rights,
    obligations,
    conditions,
    deadlines,
    consequences,
    risks,
    inconsistencies,
    relationships: [],
    meta: { schemaVersion: EXTRACTION_SCHEMA_VERSION },
  };

  // AI-proposed edges are validated against the assembled id index, then the
  // remaining edges implied by entity fields are derived deterministically.
  const { relationships: aiRelationships, rejected } = validateRelationshipDrafts(
    mergeDrafts('relationships'),
    modelBase,
    { documentId },
  );
  const derivedResult = withDerivedRelationships(
    { ...modelBase, relationships: aiRelationships },
    { documentId },
  );

  // Deterministic ids come from text, so two similar facts can collide: make the
  // ids unique before anything references them.
  const unique = ensureUniqueEntityIds(derivedResult.model, {
    collectionKeys: [
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
    ],
  });
  if (unique.renamed.length > 0) {
    issues.push({
      code: 'assemble.id-collision',
      message: `${unique.renamed.length} entity id(s) collided and were made unique.`,
    });
  }

  for (const entry of rejected) {
    issues.push({ code: 'assemble.rejected-relationship', message: entry.reason });
  }

  return {
    model: unique.model,
    issues,
    renamedIds: unique.renamed,
    rejectedRelationships: rejected,
    derivedRelationshipCount: derivedResult.derived.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Orchestration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Runs the whole extraction pipeline for one parsed document.
 *
 * Returns { model, drafts, report }:
 *  - `model`    is the assembled + verified + validated model
 *  - `report`   records provider usage, dropped items, evidence verification and
 *               validation results so the UI never implies more certainty than
 *               the pipeline actually achieved
 */
export async function runExtraction({ content, provider, options = {} }) {
  const maxChars = options.maxChars ?? LIMITS.MAX_PROMPT_CHARS;
  const documentId = content?.documentId ?? null;
  const emitStage = (stage, patch = {}) => {
    options.onStage?.({ stage, status: STAGE_STATUS.DONE, ...patch });
  };

  const report = {
    provider: provider ? { name: provider.name, model: provider.model ?? null } : null,
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    prompt: describePromptContract(),
    chunkCount: 0,
    chunks: [],
    chunkMetadata: [],
    clauseCount: 0,
    clauseTypes: {},
    draftItemCount: 0,
    droppedItems: {},
    notes: [],
    injectionWarnings: [],
    repairedChunks: 0,
    assembleIssues: [],
    renamedIds: [],
    rejectedRelationships: [],
    derivedRelationshipCount: 0,
    evidence: null,
    validation: null,
    accepted: false,
    status: 'pending',
    statusReason: null,
  };

  if (!content || typeof content.text !== 'string' || content.text.trim() === '') {
    report.status = 'failed';
    report.statusReason = 'No analysable text was found.';
    report.notes.push({
      code: 'extract.no-text',
      message: 'Document has no readable text, so nothing could be extracted.',
    });
    emitStage(STAGE_IDS.CLAUSES_IDENTIFIED, {
      status: STAGE_STATUS.SKIPPED,
      message: 'No readable text to segment.',
    });
    return { model: null, drafts: [], report };
  }

  const prepared = prepareChunks(content, {
    maxChars,
    overlapClauses: options.overlapClauses ?? 0,
  });
  report.chunkCount = prepared.chunks.length;
  report.chunkStats = prepared.stats;
  report.sectionCoverage = prepared.coverage;
  report.clauseCount = prepared.clauses.length;
  report.clauseTypes = prepared.clauses.reduce((counts, clause) => {
    const type = clause.clauseType ?? 'unknown';
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
  report.chunkMetadata = prepared.chunks.map((chunk) =>
    describeChunkLocation(chunk, prepared.clauses, content),
  );
  report.clauseChunkMap = mapChunksToClauses(prepared.chunks, prepared.clauses).pairs;

  emitStage(STAGE_IDS.CLAUSES_IDENTIFIED, {
    metrics: {
      clauses: prepared.clauses.length,
      chunks: prepared.chunks.length,
      truncatedChunks: prepared.truncatedChunks,
      attributedChars: prepared.coverage?.attributedChars ?? 0,
      totalChars: prepared.coverage?.totalChars ?? content.charCount ?? 0,
    },
  });

  const documentEntity = createDocumentFromContent(content, options.documentHints ?? {});
  const drafts = [];

  emitStage(STAGE_IDS.ENTITIES_EXTRACTED, {
    status: STAGE_STATUS.ACTIVE,
    metrics: { chunks: prepared.chunks.length, completed: 0 },
  });

  for (const chunk of prepared.chunks) {
    const chunkReport = {
      id: chunk.id,
      index: chunk.index,
      clauseNumbers: chunk.clauseNumbers,
      estimatedTokens: chunk.estimatedTokens,
      truncated: chunk.truncated,
      ok: false,
      usage: null,
      error: null,
      dropped: {},
      notes: [],
      injectionWarnings: [],
    };

    const prompt = buildExtractionPrompt({
      document: { ...documentEntity, pageCount: content.pageCount },
      clauses: prepared.clauses,
      chunk,
      maxChars,
    });
    chunkReport.injectionWarnings = prompt.meta.injectionWarnings;
    report.injectionWarnings.push(
      ...prompt.meta.injectionWarnings.map((entry) => ({ ...entry, chunkId: chunk.id })),
    );

    let result;
    try {
      result = await provider.extractLegalFacts({ prompt, signal: options.signal });
    } catch (error) {
      chunkReport.error =
        error instanceof AIProviderError
          ? `${error.code}: ${error.message}`
          : String(error?.message ?? error);
      report.chunks.push(chunkReport);
      report.notes.push({
        code: 'extract.provider-error',
        message: `Chunk ${chunk.index + 1} failed: ${chunkReport.error}`,
      });
      if (options.stopOnError) break;
      continue;
    }
    chunkReport.usage = result.usage ?? null;

    let parsed = parseProviderJson(result.text);
    if (!parsed.ok && options.retryOnInvalidJson !== false) {
      // One repair attempt: the invalid response goes back as data and the model
      // is asked again for a single JSON object. A second failure is recorded,
      // never guessed at.
      chunkReport.repairAttempted = true;
      try {
        const repairPrompt = buildRepairPrompt({
          prompt,
          responseText: result.text,
          error: parsed.error,
          maxChars,
        });
        const retry = await provider.extractLegalFacts({
          prompt: repairPrompt,
          signal: options.signal,
        });
        chunkReport.repairUsage = retry?.usage ?? null;
        const retried = parseProviderJson(retry?.text);
        if (retried.ok) {
          report.repairedChunks += 1;
          chunkReport.notes.push({
            code: 'extract.repaired',
            message: 'A second pass returned parseable JSON.',
          });
          parsed = retried;
        } else {
          chunkReport.notes.push({
            code: 'extract.repair-failed',
            message: `Retry still could not be parsed: ${retried.error}`,
          });
        }
      } catch (error) {
        chunkReport.notes.push({
          code: 'extract.repair-failed',
          message: `Retry failed: ${String(error?.message ?? error)}`,
        });
      }
    }

    if (!parsed.ok) {
      chunkReport.error = parsed.error;
      chunkReport.notes = [...chunkReport.notes, ...parsed.notes];
      report.chunks.push(chunkReport);
      report.notes.push({
        code: 'extract.invalid-json',
        message: `Chunk ${chunk.index + 1}: ${parsed.error}`,
      });
      emitStage(STAGE_IDS.ENTITIES_EXTRACTED, {
        status: STAGE_STATUS.ACTIVE,
        metrics: { chunks: prepared.chunks.length, completed: report.chunks.length },
        message: `Chunk ${chunk.index + 1} returned unusable output.`,
      });
      continue;
    }

    const normalized = normalizeExtractionDraft(parsed.value, { documentId });
    if (!normalized.draft) {
      chunkReport.notes = [...parsed.notes, ...normalized.notes];
      report.chunks.push(chunkReport);
      continue;
    }

    const itemCount = countDraftItems(normalized.draft);
    chunkReport.ok = true;
    chunkReport.itemCount = itemCount;
    chunkReport.dropped = normalized.dropped;
    chunkReport.notes = [...parsed.notes, ...normalized.notes];
    report.draftItemCount += itemCount;
    for (const [collection, count] of Object.entries(normalized.dropped)) {
      report.droppedItems[collection] = (report.droppedItems[collection] ?? 0) + count;
    }
    drafts.push(normalized.draft);
    report.chunks.push(chunkReport);
    emitStage(STAGE_IDS.ENTITIES_EXTRACTED, {
      status: STAGE_STATUS.ACTIVE,
      metrics: {
        chunks: prepared.chunks.length,
        completed: report.chunks.length,
        draftItems: report.draftItemCount,
      },
    });
  }

  emitStage(STAGE_IDS.ENTITIES_EXTRACTED, {
    metrics: {
      chunks: prepared.chunks.length,
      completed: report.chunks.length,
      draftItems: report.draftItemCount,
      repairedChunks: report.repairedChunks,
      injectionWarnings: report.injectionWarnings.length,
    },
  });

  const assembled = assembleModel({
    documentId,
    document: documentEntity,
    clauses: prepared.clauses,
    drafts,
  });
  report.assembleIssues = assembled.issues;
  report.rejectedRelationships = assembled.rejectedRelationships;
  report.derivedRelationshipCount = assembled.derivedRelationshipCount;
  report.renamedIds = assembled.renamedIds;
  if (assembled.renamedIds.length > 0) {
    report.notes.push({
      code: 'extract.id-collision',
      message: `${assembled.renamedIds.length} entity id(s) were made unique because two facts produced the same id.`,
    });
  }

  emitStage(STAGE_IDS.RELATIONSHIPS_BUILT, {
    metrics: {
      aiRelationships: assembled.model?.relationships?.length
        ? assembled.model.relationships.length - assembled.derivedRelationshipCount
        : 0,
      derivedRelationships: assembled.derivedRelationshipCount,
      rejectedRelationships: assembled.rejectedRelationships.length,
    },
  });

  // Evidence verification runs before validation: hallucinated citations are
  // removed here so the validator judges only facts that survived verification.
  const verified = verifyModelEvidence(assembled.model, content, {
    dropUnverified: options.dropUnverified !== false,
  });
  report.evidence = verified.report;
  const evidenceIndex = summarizeClauseEvidence(verified.model);
  report.evidenceIndex = {
    clausesWithFacts: evidenceIndex.totals.clauses,
    facts: evidenceIndex.totals.facts,
    verified: evidenceIndex.totals.verified,
    unverified: evidenceIndex.totals.unverified,
    missingCitations: evidenceIndex.totals.missing,
  };
  emitStage(STAGE_IDS.EVIDENCE_VALIDATED, {
    metrics: {
      checkedEntities: verified.report.checkedEntities,
      verifiedEntities: verified.report.verifiedEntities,
      rejectedEntities: verified.report.rejectedEntities,
      clausesWithFacts: evidenceIndex.totals.clauses,
    },
  });
  if (verified.report.rejectedEntities > 0) {
    report.notes.push({
      code: 'extract.evidence-dropped',
      message: `${verified.report.rejectedEntities} proposed fact(s) were removed because their quoted source text could not be verified against the document.`,
    });
  }

  const validation = validateLegalModel(verified.model, { documentContent: content });
  report.validation = validation.summary;
  report.accepted = validation.valid;
  if (!validation.valid) {
    report.notes.push({
      code: 'extract.rejected',
      message: `Extraction failed validation with ${validation.summary.errorCount} error(s); it was not applied.`,
    });
  }

  // Overall pipeline status, so the UI can distinguish "nothing usable came back"
  // from "facts were extracted and some were withheld".
  const successfulChunks = report.chunks.filter((chunk) => chunk.ok).length;
  if (successfulChunks === 0) {
    report.status = 'failed';
    report.statusReason =
      report.chunkCount === 0
        ? 'No analysable text was found.'
        : 'No chunk returned a usable structured response.';
  } else if (
    successfulChunks < report.chunkCount ||
    !validation.valid ||
    verified.report.rejectedEntities > 0
  ) {
    report.status = 'partial';
    report.statusReason = `Facts were extracted and ${verified.report.rejectedEntities} proposed fact(s) were withheld; review the extraction report.`;
  } else {
    report.status = 'ok';
    report.statusReason = null;
  }

  return { model: verified.model, drafts, report, validation };
}
