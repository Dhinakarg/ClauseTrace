/**
 * Ask service — the one path a question takes.
 *
 *   question (untrusted)
 *     → askEngine.sanitizeQuestion   defuse instruction-shaped input, cap length
 *     → askEngine.answerQuestion     deterministic retrieval + citation validation
 *     → prompts.buildAskPrompt       excerpts fenced as data, never as instructions
 *     → provider.answerQuestion      AI proposes prose over the supplied excerpts
 *     → validateAnswerProse          only prose that cites supplied clauses survives
 *
 * The extractive answer is always returned. The AI half is additive: when no
 * provider is available, the call fails, or the prose cites a clause this app
 * cannot see, the result says so and the evidenced answer stands on its own.
 */

import { PROMPT_IDS, buildAskPrompt } from './prompts.js';
import { detectInjectionAttempts } from './promptSafety.js';
import { ENTITY_TYPES, getEntitiesByType } from '../legal/schema.js';
import { truncateText } from '../security/limits.js';
import { answerQuestion } from '../legal/askEngine.js';

/** Caps applied to anything the AI half is allowed to receive or return. */
export const ASK_AI_LIMITS = Object.freeze({
  MAX_EXCERPT_CHARS: 12_000,
  MAX_PER_CLAUSE_CHARS: 4_000,
  MAX_ANSWER_CHARS: 4_000,
});

/** Reasons the AI half can be reported as not used. Kept as data for the UI. */
export const ASK_AI_SKIP_REASONS = Object.freeze({
  NOT_MATCHED:
    'No clause matched the question, so no AI request was made. Questions are only sent once there is source text to quote.',
  NO_PROVIDER: 'No AI provider is configured, so only the extractive answer is shown.',
});

/** Display title for the document, used in the prompt header. */
export function documentTitleOf(model) {
  return model?.documents?.[0]?.title ?? null;
}

/**
 * Builds the excerpt block handed to the provider: the clauses retrieval matched
 * and nothing else. Each clause is truncated and the whole block is capped, so a
 * long document cannot exceed the prompt budget.
 */
export function buildAskExcerpts(
  matches = [],
  {
    maxMatches = 3,
    maxChars = ASK_AI_LIMITS.MAX_EXCERPT_CHARS,
    maxPerClauseChars = ASK_AI_LIMITS.MAX_PER_CLAUSE_CHARS,
  } = {},
) {
  const blocks = [];
  let total = 0;
  for (const match of matches.slice(0, maxMatches)) {
    const budget = maxChars - total;
    if (budget <= 0) break;
    const clause = match?.clause ?? {};
    const label = clause.number
      ? `CLAUSE ${clause.number}${clause.heading ? ` (${clause.heading})` : ''}`
      : clause.heading ?? `CLAUSE ${clause.id ?? 'unknown'}`;
    const body = truncateText(String(clause.text ?? ''), Math.min(maxPerClauseChars, budget), {
      suffix: '',
    });
    blocks.push(`${label}\n${body}`);
    total += label.length + body.length + 2;
  }
  return blocks.join('\n\n');
}

/** Clause numbers a passage refers to, in the forms the prompt asks the model to use. */
export function extractClauseCitations(text) {
  const value = String(text ?? '');
  const found = [];
  const pattern = /(?:\u00a7|\bclauses?\b)\s*(\d+(?:\.\d+)*)/gi;
  let match = pattern.exec(value);
  while (match) {
    if (!found.includes(match[1])) found.push(match[1]);
    match = pattern.exec(value);
  }
  return found;
}

/**
 * Shortest heading that may count as a citation. Shorter strings ("A", "1") match ordinary
 * prose by accident, and a citation nobody can check is worth less than no citation.
 */
const MIN_HEADING_CITATION_CHARS = 3;

/** Normalises a heading for matching: case, punctuation and spacing are not meaning. */
export function normalizeHeadingForMatch(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Validates AI prose before it is shown as an AI reading.
 *
 * The failure modes below are caught deterministically, and any one of them withholds the
 * reading rather than showing it:
 *   1. instruction-shaped text inside the answer (a document-borne injection
 *      attempt that survived into the prose) → the answer is withheld;
 *   2. a clause number that does not exist in this document (a hallucinated
 *      citation) → withheld;
 *   3. a clause number that exists but was not supplied to the provider (the
 *      model answering from outside the retrieved excerpts) → withheld.
 *
 * A clause the parser could not number — a heading-only clause, or the "Preamble" block — can
 * still be cited: the model is asked to quote its heading, and the heading of a supplied clause
 * counts as a citation for that clause. Headings are matched case-, punctuation- and
 * spacing-insensitively.
 *
 * Heading mentions deliberately do NOT create out-of-scope findings. A bare heading is ordinary
 * prose ("the payment terms") while a clause number is an explicit reference, so only clause
 * numbers can prove the model reached outside the clauses it was given.
 *
 * Returns { ok, text, cited, citedHeadings, unknown, outOfScope, injections, truncated, issues }.
 */
export function validateAnswerProse({
  text = '',
  model = null,
  allowedClauseIds = null,
  excerpts = '',
} = {}) {
  const prose = String(text ?? '').trim();
  const issues = [];
  const clauses = getEntitiesByType(model, ENTITY_TYPES.CLAUSE);
  const knownNumbers = new Set(clauses.map((clause) => clause.number).filter(Boolean));
  const allowed = allowedClauseIds ? new Set(allowedClauseIds) : null;
  const allowedClauses = clauses.filter((clause) => !allowed || allowed.has(clause.id));
  const allowedNumbers = new Set(allowedClauses.map((clause) => clause.number).filter(Boolean));
  // A quoted excerpt may name another clause ("as set out in clause 5.1"). That
  // number came from the document text we supplied, so citing it is not the model
  // reaching outside its brief.
  for (const number of extractClauseCitations(excerpts)) allowedNumbers.add(number);

  // Headings of the clauses the provider was given, keyed by their normalised form. An
  // unnumbered clause has no other handle, so this is how a reading about it can be cited.
  const allowedHeadings = new Map();
  for (const clause of allowedClauses) {
    const heading = normalizeHeadingForMatch(clause.heading);
    if (heading.length >= MIN_HEADING_CITATION_CHARS) allowedHeadings.set(heading, clause.heading);
  }

  const injections = detectInjectionAttempts(prose);
  const cited = extractClauseCitations(prose);
  const normalisedProse = ` ${normalizeHeadingForMatch(prose)} `;
  const citedHeadings = [...allowedHeadings.entries()]
    .filter(([token]) => normalisedProse.includes(` ${token} `))
    .map(([, original]) => original);
  const unknown = cited.filter((number) => !knownNumbers.has(number));
  const outOfScope = cited.filter(
    (number) => knownNumbers.has(number) && !allowedNumbers.has(number),
  );
  const truncated = prose.length > ASK_AI_LIMITS.MAX_ANSWER_CHARS;

  if (!prose) issues.push('The provider returned an empty answer.');
  if (injections.length > 0) {
    issues.push('The answer contained instruction-like text, so it was withheld rather than shown.');
  }
  if (unknown.length > 0) {
    issues.push(`The answer cited clause number(s) that are not in this document: ${unknown.join(', ')}.`);
  }
  if (outOfScope.length > 0) {
    issues.push(`The answer cited clause(s) that were not supplied to it: ${outOfScope.join(', ')}.`);
  }
  if (prose && cited.length === 0 && citedHeadings.length === 0) {
    issues.push(
      'The answer did not cite any clause number or the heading of a clause it was given, so it cannot be checked against the document.',
    );
  }

  return {
    ok: issues.length === 0,
    text: truncated ? truncateText(prose, ASK_AI_LIMITS.MAX_ANSWER_CHARS) : prose,
    cited,
    citedHeadings,
    unknown,
    outOfScope,
    injections,
    truncated,
    issues,
  };
}

/**
 * Answers a question about one loaded document.
 *
 * Returns the deterministic answer from `askEngine.answerQuestion` plus an `ai`
 * block reporting exactly what the provider was asked, what came back and whether
 * the answer was accepted, rejected or never attempted.
 */
export async function answerDocumentQuestion({
  model,
  question,
  content = null,
  provider = null,
  documentId = null,
  maxMatches = 3,
  signal = null,
  options = {},
} = {}) {
  const deterministic = answerQuestion(model, question, { ...options, content, maxMatches });
  const ai = {
    attempted: false,
    used: false,
    rejected: false,
    provider: provider?.name ?? null,
    model: provider?.model ?? null,
    promptId: PROMPT_IDS.ASK,
    text: '',
    reason: null,
    issues: [],
    citedClauses: [],
    citedHeadings: [],
    unknownCitations: [],
    outOfScopeCitations: [],
    injectionWarnings: [],
    truncated: false,
    durationMs: null,
  };

  if (!deterministic.matched) {
    ai.reason = ASK_AI_SKIP_REASONS.NOT_MATCHED;
    return { ...deterministic, ai };
  }
  if (!provider) {
    ai.reason = ASK_AI_SKIP_REASONS.NO_PROVIDER;
    return { ...deterministic, ai };
  }

  const supplied = deterministic.matches.slice(0, maxMatches);
  const excerpts = buildAskExcerpts(deterministic.matches, { maxMatches });
  const prompt = buildAskPrompt({
    question: deterministic.question,
    clauses: supplied.map((match) => match.clause),
    excerpts,
    document: { title: documentTitleOf(model), documentId },
  });

  ai.attempted = true;
  const startedAt = Date.now();
  try {
    const response = await provider.answerQuestion({
      prompt,
      signal,
      context: {
        documentId,
        model,
        clauses: supplied.map((match) => match.clause),
        citations: deterministic.citations,
        answer: deterministic.answer,
      },
    });

    ai.durationMs = Date.now() - startedAt;
    const validation = validateAnswerProse({
      text: response?.text,
      model,
      allowedClauseIds: supplied.map((match) => match.clause.id),
      excerpts,
    });

    ai.citedClauses = validation.cited;
    ai.citedHeadings = validation.citedHeadings;
    ai.unknownCitations = validation.unknown;
    ai.outOfScopeCitations = validation.outOfScope;
    ai.injectionWarnings = validation.injections;
    ai.truncated = validation.truncated;
    ai.issues = validation.issues;

    if (!validation.ok) {
      ai.rejected = true;
      ai.reason = validation.issues[0];
      return { ...deterministic, ai };
    }

    ai.used = true;
    ai.text = validation.text;
    return { ...deterministic, ai };
  } catch (error) {
    ai.durationMs = Date.now() - startedAt;
    ai.reason = `The AI provider could not answer (${
      error?.code ?? error?.name ?? 'error'
    }): ${error?.message ?? 'unknown error'}. The extractive answer is unaffected.`;
    ai.issues = [ai.reason];
    return { ...deterministic, ai };
  }
}

export default answerDocumentQuestion;
