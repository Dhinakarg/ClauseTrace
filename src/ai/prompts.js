/**
 * Prompt contracts.
 *
 * The prompt is the *only* place where the app describes what it wants from a
 * model, and it is versioned so a stored extraction can be traced back to the
 * contract that produced it.
 *
 * Three ideas are non-negotiable here:
 *   1. The document is DATA. Instructions inside it are reported, never obeyed
 *      (see `promptSafety.js` and `UNTRUSTED_CONTENT_INSTRUCTION`).
 *   2. Every fact must quote source text verbatim. Offsets are a hint; the code
 *      re-derives them, so a wrong offset cannot manufacture evidence.
 *   3. Output is one strict-JSON object. Anything else is a failed response, and
 *      `responseParser` handles failures without crashing.
 */

import {
  CLAUSE_TYPES,
  CONDITION_TARGETS,
  CONDITION_TYPES,
  CONSEQUENCE_TYPES,
  DEADLINE_DATE_TYPES,
  INCONSISTENCY_TYPES,
  PARTY_ROLES,
  RELATIONSHIP_TYPES,
  RISK_CATEGORIES,
  SEVERITIES,
} from '../legal/schema.js';
import { LIMITS, truncateText } from '../security/limits.js';
import {
  UNTRUSTED_CONTENT_INSTRUCTION,
  buildUntrustedBlock,
  detectInjectionAttempts,
} from './promptSafety.js';

/** Bumped whenever the requested JSON shape or rules change. */
export const EXTRACTION_SCHEMA_VERSION = '2.0.0';

/** Stable identifiers used by the report so a run names its contracts. */
export const PROMPT_IDS = Object.freeze({
  EXTRACTION: 'extraction.chunk.v2',
  ASK: 'ask.grounded.v2',
  REPAIR: 'extraction.repair.v2',
});

/** The one hard requirement behind every citation in the app. */
export const EVIDENCE_INSTRUCTION = [
  'For EVERY fact you return, copy the supporting sentence(s) VERBATIM into sourceText from the DOCUMENT TEXT below.',
  'Never paraphrase, translate, tidy up or summarise a quote. Never quote a clause that is not in the supplied text.',
  'Set clauseNumber to the number of the clause the quote appears in, exactly as it appears in the CLAUSE INDEX.',
  'startOffset/endOffset are optional hints. The application re-derives them; a wrong offset cannot create evidence.',
  'VERIFIED means the quoted text appears in the document. A paraphrase will be rejected and the fact dropped.',
].join(' ');

/** Strict-JSON framing, repeated in the system and user turns on purpose. */
export const STRICT_JSON_INSTRUCTION = [
  'Return ONE JSON object and nothing else: no prose, no explanations, no markdown code fences.',
  'Use double quotes, no trailing commas, no comments and no undefined values.',
  'Omit a fact entirely rather than guessing: use null for unknown scalars and "unknown" for unknown enumerated values.',
  'Do not invent ids: reference other entries by their clause number or by the "ref" value you gave them.',
].join(' ');

/** EVIDENCE shape expected for every extracted fact. */
export const EVIDENCE_OUTPUT_HINT = `{
  "clauseNumber": string, "section": string|null, "page": number|null,
  "sourceText": string, "startOffset": number|null, "endOffset": number|null
}`;

/** Extra fields Phase 2 asks for, one line per entity, kept explicit. */
export const CLAUSE_OUTPUT_HINT = `{ "number": string|null, "heading": string|null, "type": one of ${JSON.stringify(CLAUSE_TYPES)}, "summary": string|null, "clauseNumber": string|null }`;

/** Compact description of the expected extraction payload. */
export const EXTRACTION_OUTPUT_HINT = `{
  "parties": [{ "name": string, "role": one of ${JSON.stringify(PARTY_ROLES)}, "entityKind": "individual|company|partnership|government|other|unknown", "jurisdiction": string|null, "description": string|null, "aliases": [string], "evidence": [EVIDENCE] }],
  "definitions": [{ "term": string, "text": string, "scope": "document|section|clause|unknown", "clauseNumber": string|null, "aliases": [string], "evidence": [EVIDENCE] }],
  "clauses": [CLAUSE],
  "rights": [{ "summary": string, "action": string|null, "condition": string|null, "holderParty": string, "counterpartyParty": string|null, "clauseNumber": string, "evidence": [EVIDENCE] }],
  "obligations": [{ "summary": string, "action": string, "obligorParty": string, "obligeeParty": string|null, "clauseNumber": string, "standard": "strict|best-efforts|reasonable-efforts|commercially-reasonable|informational|unknown", "triggerConditionRef": string|null, "triggerText": string|null, "deadlineRef": string|null, "deadlineText": string|null, "consequenceRefs": [string], "consequenceText": string|null, "informational": boolean, "evidence": [EVIDENCE] }],
  "conditions": [{ "ref": string, "summary": string, "conditionType": one of ${JSON.stringify(CONDITION_TYPES)}, "activates": one of ${JSON.stringify(CONDITION_TARGETS)}, "triggerDescription": string|null, "clauseNumber": string, "deadlineRef": string|null, "evidence": [EVIDENCE] }],
  "deadlines": [{ "ref": string, "description": string, "date": "YYYY-MM-DD"|null, "dateType": one of ${JSON.stringify(DEADLINE_DATE_TYPES)}, "event": string|null, "relativePeriod": { "amount": number, "unit": "day|week|month|year" }|null, "recurrence": string|null, "responsibleParty": string|null, "clauseNumber": string, "evidence": [EVIDENCE] }],
  "consequences": [{ "ref": string, "description": string, "consequenceType": one of ${JSON.stringify(CONSEQUENCE_TYPES)}, "severity": one of ${JSON.stringify(SEVERITIES)}, "event": string|null, "clauseNumber": string, "triggerConditionRef": string|null, "affectedParty": string|null, "evidence": [EVIDENCE] }],
  "risks": [{ "title": string, "category": one of ${JSON.stringify(RISK_CATEGORIES)}, "severity": one of ${JSON.stringify(SEVERITIES)}, "explanation": string, "clauseNumber": string, "evidence": [EVIDENCE] }],
  "inconsistencies": [{ "title": string, "inconsistencyType": one of ${JSON.stringify(INCONSISTENCY_TYPES)}, "severity": one of ${JSON.stringify(SEVERITIES)}, "description": string, "clauseNumbers": [string], "evidence": [EVIDENCE] }],
  "relationships": [{ "type": one of ${JSON.stringify(RELATIONSHIP_TYPES)}, "from": string, "to": string }]
}`;

export const EXTRACTION_SYSTEM_PROMPT = [
  'You are a legal document analysis assistant inside ClauseGraph, a contract review workspace.',
  'You extract structured, verifiable information from one document at a time.',
  '',
  'Rules:',
  '1. Return ONE JSON object. No prose, no markdown fences.',
  "2. Quote source text verbatim in every evidence entry; never paraphrase.",
  '3. Only extract facts the supplied text states. Omit anything you cannot quote.',
  '4. Clause numbers must come from the supplied CLAUSE INDEX. Never invent one.',
  '5. Never infer a party, obligation, amount or date that the text does not state.',
  '6. Use only the enumerated values listed in the schema. Use "unknown" when unsure.',
  '7. Report contradictions you actually observe between clauses as inconsistencies.',
  '8. Do not repeat the same fact twice; report each distinct fact once.',
  '9. You are not providing legal advice; you are labelling document content.',
  '',
  UNTRUSTED_CONTENT_INSTRUCTION,
  '',
  STRICT_JSON_INSTRUCTION,
].join('\n');

/** Clause index block: the clause ids/numbers the model may reference. */
export function buildClauseIndexBlock(clauses = [], { maxClauses = 400 } = {}) {
  const rows = clauses.slice(0, maxClauses).map((clause) => ({
    clauseId: clause.id,
    clauseNumber: clause.number,
    heading: clause.heading,
    type: clause.clauseType ?? 'unknown',
    page: clause.page,
    chars: [clause.startOffset, clause.endOffset],
  }));
  return JSON.stringify({ clauseIndex: rows });
}

/**
 * Builds an extraction request for one chunk of one document.
 * Returns { id, version, system, user, meta }. `meta.injectionWarnings` reports
 * any instruction-like text found inside the untrusted document text.
 */
export function buildExtractionPrompt({
  document,
  clauses = [],
  chunk,
  maxChars = LIMITS.MAX_PROMPT_CHARS,
}) {
  const { block, injections, truncated } = buildUntrustedBlock(chunk?.text ?? '', {
    label: `DOCUMENT TEXT ${chunk?.id ?? ''}`.trim(),
    maxChars,
  });

  const user = [
    `DOCUMENT: ${document?.title ?? 'Untitled document'}`,
    `DOCUMENT TYPE: ${document?.documentType ?? 'unknown'}`,
    `EFFECTIVE DATE: ${document?.effectiveDate ?? 'not stated'}`,
    `PAGES: ${chunk?.pageStart ?? '?'}-${chunk?.pageEnd ?? '?'} of ${document?.pageCount ?? '?'}`,
    `CLAUSE NUMBERS IN THIS PASSAGE: ${JSON.stringify(
      chunk?.clauseNumbers ?? chunk?.clauseIds ?? [],
    )}`,
    '',
    'CLAUSE INDEX (use these clauseNumber values for references):',
    buildClauseIndexBlock(clauses),
    '',
    'EVIDENCE FORMAT:',
    EVIDENCE_OUTPUT_HINT,
    '',
    'EVIDENCE RULES:',
    EVIDENCE_INSTRUCTION,
    '',
    'CLAUSE HINT:',
    CLAUSE_OUTPUT_HINT,
    '',
    'RETURN THIS SHAPE:',
    EXTRACTION_OUTPUT_HINT,
    '',
    block,
  ].join('\n');

  return {
    id: PROMPT_IDS.EXTRACTION,
    version: EXTRACTION_SCHEMA_VERSION,
    system: EXTRACTION_SYSTEM_PROMPT,
    user,
    meta: {
      chunkId: chunk?.id ?? null,
      charStart: chunk?.charStart ?? null,
      charEnd: chunk?.charEnd ?? null,
      clauseIds: chunk?.clauseIds ?? [],
      injectionWarnings: injections,
      untrustedTextTruncated: truncated,
    },
  };
}

/** Longest heading advertised to the model as a citation handle. */
const MAX_CITATION_LABEL_CHARS = 120;

/**
 * Builds a grounded question-answering request over supplied clause excerpts.
 * The answer must cite clause numbers and may not use anything outside them. A clause the parser
 * could not number is advertised by its heading instead, since a heading is the only handle such
 * a clause has — and the only one this app is able to check.
 */
export function buildAskPrompt({ question, clauses = [], excerpts = '', document = null }) {
  const { block, injections } = buildUntrustedBlock(excerpts, { label: 'CLAUSE EXCERPTS' });
  // Headings are document text. An instruction-like heading is reported and NOT offered as a
  // citation handle: the model then has nothing to cite, the reading is withheld, and the reader
  // is told why. Nothing instruction-shaped is ever offered to the model as a citation.
  const headingWarnings = clauses.flatMap((clause) =>
    clause.number ? [] : detectInjectionAttempts(clause.heading ?? ''),
  );
  const askedToCite = clauses
    .map((clause) => {
      if (clause.number) return `clause ${clause.number}`;
      const heading = String(clause.heading ?? '').replace(/\s+/g, ' ').trim();
      if (!heading || detectInjectionAttempts(heading).length > 0) return null;
      return `heading "${truncateText(heading, MAX_CITATION_LABEL_CHARS, { suffix: '' })}"`;
    })
    .filter(Boolean);

  return {
    id: PROMPT_IDS.ASK,
    version: EXTRACTION_SCHEMA_VERSION,
    system: [
      'You answer questions about one legal document using only the supplied excerpts.',
      'Rules:',
      '1. Cite the clause number you used for every statement.',
      '2. If the clause has no number, quote its heading exactly as listed in CLAUSES AVAILABLE instead.',
      '3. If the excerpts do not answer the question, say what is missing instead of guessing.',
      '4. Do not give legal advice or recommendations; describe what the document states.',
      UNTRUSTED_CONTENT_INSTRUCTION,
    ].join('\n'),
    user: [
      `DOCUMENT: ${document?.title ?? 'Untitled document'}`,
      `CLAUSES AVAILABLE: ${askedToCite.join('; ')}`,
      `QUESTION: ${question}`,
      '',
      block,
    ].join('\n'),
    meta: {
      injectionWarnings: [...injections, ...headingWarnings],
      clauseIds: clauses.map((clause) => clause.id),
      citationHandles: askedToCite,
    },
  };
}

/**
 * Repair prompt used when a response could not be parsed.
 * The malformed text is included as data, and the model is asked again for one
 * JSON object. If the retry also fails, the chunk is skipped — never guessed at.
 */
export function buildRepairPrompt({ prompt, responseText, error = null, maxChars = LIMITS.MAX_PROMPT_CHARS }) {
  const { block } = buildUntrustedBlock(responseText ?? '', {
    label: 'PREVIOUS RESPONSE (invalid)',
    maxChars,
  });
  return {
    id: PROMPT_IDS.REPAIR,
    version: EXTRACTION_SCHEMA_VERSION,
    system: EXTRACTION_SYSTEM_PROMPT,
    user: [
      'Your previous response could not be parsed as JSON.',
      `Parser error: ${error ?? 'unknown'}`,
      '',
      'Return the same information again as ONE JSON object that matches this shape:',
      EXTRACTION_OUTPUT_HINT,
      '',
      EVIDENCE_INSTRUCTION,
      '',
      block,
    ].join('\n'),
    meta: {
      repairedFrom: prompt?.id ?? null,
      chunkId: prompt?.meta?.chunkId ?? null,
      injectionWarnings: [],
    },
  };
}

/** Compact description of the prompt contract, for the extraction report. */
export function describePromptContract() {
  return {
    id: PROMPT_IDS.EXTRACTION,
    version: EXTRACTION_SCHEMA_VERSION,
    untrustedContentFenced: true,
    requiresVerbatimEvidence: true,
    strictJson: true,
    maxPromptChars: LIMITS.MAX_PROMPT_CHARS,
  };
}

