/**
 * Ask engine (grounded retrieval).
 *
 * Deterministic question answering over the extracted model. It retrieves the
 * clauses and facts whose text matches the question's terms, then answers by
 * EXTRACTION — quoting what the document says with citations — rather than by
 * generating prose.
 *
 * That is a deliberate boundary: Phase 1 refuses to paraphrase a contract. The
 * answer always names the clauses it came from and says when nothing matched.
 */

import { ENTITY_TYPES, entityLabel, getEntitiesByType } from './schema.js';
import { assessObligation, buildObligationContext } from './obligationEngine.js';
import { LIMITS, truncateText } from '../security/limits.js';
import { detectInjectionAttempts, neutralizeInjectionText } from '../ai/promptSafety.js';
import { buildEvidenceContext, normalizeForComparison } from '../documents/evidence.js';

/* -------------------------------------------------------------------------- */
/* Copy the reader sees                                                       */
/* -------------------------------------------------------------------------- */

/** Shown beside every answer. Answers quote; they never advise. */
export const ASK_DISCLAIMER =
  'Answers quote the clauses the question matched. ClauseGraph does not paraphrase the contract, does not interpret it and does not give legal advice.';

/** The two ways an answer can legitimately have nothing to show. */
export const ASK_EMPTY_REASONS = Object.freeze({
  NO_TERMS: 'no-terms',
  NO_MATCH: 'no-match',
});

export const ASK_NO_TERMS_ANSWER =
  'Enter a question with at least one substantive term, for example “notice period for renewal”.';

export const ASK_NO_MATCH_ANSWER =
  'No clause in this document matches those terms, so there is nothing in the extracted text that answers it.';

/** How a citation fared when it was checked against the document. */
export const CITATION_STATUS = Object.freeze({
  VERIFIED: 'verified',
  TEXT_MISMATCH: 'text-mismatch',
  UNKNOWN_CLAUSE: 'unknown-clause',
  MISSING_SOURCE: 'missing-source',
  UNCHECKED: 'unchecked',
});

/** Confidence levels. Confidence describes match quality, never legal certainty. */
export const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low', 'none']);

export const CONFIDENCE_LABELS = Object.freeze({
  high: 'Strong match, citations verified',
  medium: 'Reasonable match',
  low: 'Weak match',
  none: 'No supporting text',
});

export const CONFIDENCE_DISCLAIMER =
  'Confidence reports how well the question matched the extracted text and whether the cited clauses were found in the document. It is not a measure of legal certainty.';

/* -------------------------------------------------------------------------- */
/* Question safety                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Sanitises a typed question before it is tokenised or sent anywhere.
 *
 * A question is untrusted input in the same way document text is: it can carry
 * instruction-shaped text aimed at the model. Control characters are stripped,
 * known injection patterns are defused (and reported), and the length is capped.
 * Returns { text, warnings, truncated, originalLength }.
 */
export function sanitizeQuestion(question, { maxChars = LIMITS.MAX_QUESTION_CHARS } = {}) {
  const raw = String(question ?? '');
  const warnings = detectInjectionAttempts(raw);
  const neutralised = neutralizeInjectionText(raw).replace(/\s+/g, ' ').trim();
  const text = neutralised.length > maxChars ? truncateText(neutralised, maxChars, { suffix: '' }) : neutralised;
  return {
    text: text.trim(),
    warnings,
    truncated: text.trim().length < neutralised.length,
    originalLength: raw.length,
  };
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be',
  'been', 'with', 'by', 'at', 'from', 'as', 'that', 'this', 'these', 'those', 'it', 'its', 'we',
  'they', 'them', 'he', 'she', 'if', 'then', 'than', 'there', 'here', 'what', 'which', 'who',
  'whom', 'when', 'where', 'how', 'why', 'do', 'does', 'did', 'can', 'could', 'should', 'would',
  'will', 'shall', 'may', 'might', 'must', 'not', 'no', 'yes', 'about', 'into', 'under', 'over',
  'after', 'before', 'any', 'all', 'each', 'other', 'such', 'my', 'our', 'your', 'their',
]);

/** Tokenizes a question into meaningful lowercase terms. */
export function tokenizeQuestion(question) {
  return String(question ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s'-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[.'-]+|[.'-]+$/g, ''))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/** Scores a text blob against question terms; longer matches score higher. */
function scoreText(text, terms) {
  const haystack = String(text ?? '').toLowerCase();
  if (!haystack) return 0;
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    score += term.length >= 6 ? 3 : 2;
  }
  return score;
}

/**
 * Retrieves the clauses most relevant to a question.
 * Returns [{ clause, score, matchedTerms, facts }] sorted by score.
 */
export function retrieveClauses(model, question, { limit = 5 } = {}) {
  const terms = tokenizeQuestion(question);
  if (!model || terms.length === 0) return [];

  const obligationsByClause = new Map();
  for (const obligation of getEntitiesByType(model, ENTITY_TYPES.OBLIGATION)) {
    const list = obligationsByClause.get(obligation.clauseId) ?? [];
    list.push(obligation);
    obligationsByClause.set(obligation.clauseId, list);
  }
  const risksByClause = new Map();
  for (const risk of getEntitiesByType(model, ENTITY_TYPES.RISK)) {
    const list = risksByClause.get(risk.clauseId) ?? [];
    list.push(risk);
    risksByClause.set(risk.clauseId, list);
  }

  return getEntitiesByType(model, ENTITY_TYPES.CLAUSE)
    .map((clause) => {
      const facts = obligationsByClause.get(clause.id) ?? [];
      const risks = risksByClause.get(clause.id) ?? [];
      const riskCount = risks.length;
      const score =
        scoreText(clause.text, terms) +
        scoreText(clause.heading, terms) * 2 +
        scoreText(clause.number, terms) * 4 +
        facts.reduce((total, fact) => total + scoreText(fact.summary, terms), 0) * 2 +
        riskCount;
      const matchedTerms = terms.filter((term) =>
        `${clause.number ?? ''} ${clause.heading ?? ''} ${clause.text ?? ''} ${facts
          .map((fact) => fact.summary)
          .join(' ')}`
          .toLowerCase()
          .includes(term),
      );
      return { clause, score, matchedTerms, facts, risks };
    })
    // A clause must overlap the question text to count as a match. The risk bonus
    // orders results that already matched; on its own it must never create one,
    // otherwise an unrelated question would be "answered" with a random clause.
    .filter((entry) => entry.matchedTerms.length > 0)
    .sort(
      (a, b) => b.score - a.score || (a.clause.startOffset ?? 0) - (b.clause.startOffset ?? 0),
    )
    .slice(0, limit);
}

/** First sentence of a passage, trimmed for display. */
export function firstSentence(text, { maxLength = 320 } = {}) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  const boundary = value.search(/\.\s/);
  const sentence = boundary > 0 ? value.slice(0, boundary + 1) : value;
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 1)}…` : sentence;
}

/* -------------------------------------------------------------------------- */
/* Confidence                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Derives a confidence level from deterministic evidence: how strong the term
 * overlap was, whether citations verified, and whether the question itself had to
 * be neutralised. Never a judgement about the law — the level is about the search.
 */
export function assessAnswerConfidence({
  matched,
  matches = [],
  citationValidation = null,
  questionSafety = null,
  emptyReason = null,
} = {}) {
  const reasons = [];
  if (!matched) {
    reasons.push(
      emptyReason === ASK_EMPTY_REASONS.NO_TERMS
        ? 'The question contained no term that could be searched for.'
        : 'No extracted clause overlapped the question, so there is no text to stand behind an answer.',
    );
    return {
      level: 'none',
      score: 0,
      label: CONFIDENCE_LABELS.none,
      reasons,
      disclaimer: CONFIDENCE_DISCLAIMER,
    };
  }

  const topScore = matches[0]?.score ?? 0;
  let score = topScore >= 8 ? 3 : topScore >= 4 ? 2 : 1;
  reasons.push(`The strongest matching clause scored ${topScore} against the question's terms.`);

  if (citationValidation) {
    const statuses = citationValidation.citations.map((citation) => citation.verification.status);
    const verified = statuses.filter((status) => status === CITATION_STATUS.VERIFIED).length;
    const failed = statuses.filter(
      (status) =>
        status === CITATION_STATUS.TEXT_MISMATCH ||
        status === CITATION_STATUS.UNKNOWN_CLAUSE ||
        status === CITATION_STATUS.MISSING_SOURCE,
    ).length;

    if (failed > 0) {
      score -= 1;
      reasons.push(`${failed} of ${statuses.length} citation(s) could not be verified against the document.`);
    }
    if (verified > 0 && verified === statuses.length) {
      score += 1;
      reasons.push('Every cited clause was found in the parsed document text.');
    }
    if (statuses.includes(CITATION_STATUS.UNCHECKED)) {
      reasons.push(
        'The parsed document text was not available, so citations were checked against the extracted clause records only.',
      );
    }
  }

  if ((questionSafety?.warnings ?? []).length > 0) {
    score -= 1;
    reasons.push(
      'The question contained instruction-like text, which was neutralised before the search ran.',
    );
  }
  if (questionSafety?.truncated) {
    reasons.push('The question was longer than the accepted limit and was shortened before the search.');
  }

  const clamped = Math.max(0, score);
  const level = clamped >= 4 ? 'high' : clamped === 3 ? 'medium' : clamped >= 1 ? 'low' : 'none';
  return { level, score: clamped, label: CONFIDENCE_LABELS[level], reasons, disclaimer: CONFIDENCE_DISCLAIMER };
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The evidence panel's view model: one entry per clause quoted in the answer,
 * carrying the excerpt, the clause reference, what was extracted from it and how
 * the citation verified. `clauseId` is enough to link straight to the highlighted
 * source text in the workspace.
 */
export function buildAnswerSources(matches = [], { maxMatches = 3, citationValidation = null } = {}) {
  const byClauseId = new Map(
    (citationValidation?.citations ?? []).map((citation) => [citation.clauseId, citation.verification]),
  );
  return matches.slice(0, maxMatches).map((match) => {
    const clause = match.clause;
    return {
      clauseId: clause.id,
      clauseNumber: clause.number ?? null,
      heading: clause.heading ?? null,
      label: clause.number
        ? `Clause ${clause.number}${clause.heading ? ` — ${clause.heading}` : ''}`
        : clause.heading ?? 'A clause',
      page: clause.page ?? null,
      clauseType: clause.type ?? null,
      score: match.score,
      matchedTerms: match.matchedTerms ?? [],
      excerpt: firstSentence(clause.text, { maxLength: 400 }),
      text: clause.text ?? '',
      verification: byClauseId.get(clause.id) ?? null,
      obligations: (match.facts ?? []).map((obligation) => ({
        id: obligation.id,
        summary: obligation.summary,
      })),
      risks: (match.risks ?? []).map((risk) => ({
        id: risk.id,
        title: risk.title,
        severity: risk.severity,
        derived: risk.derived !== false,
      })),
    };
  });
}


/* -------------------------------------------------------------------------- */
/* Citation validation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Checks every citation the answer makes against the model and, when the parsed
 * document text is available, against the text itself.
 *
 * This is the ask-side of the same contract the extraction pipeline enforces: a
 * citation is only reported as verified when the clause exists AND its wording is
 * found in the parsed document. When the parsed text is unavailable the status is
 * `unchecked` — honest about what could not be confirmed, rather than assuming it
 * passed.
 *
 * Returns { citations, counts, ok, hasContent, issues }.
 */
export function validateCitations(model, citations = [], { content = null } = {}) {
  const clauseById = new Map(
    getEntitiesByType(model, ENTITY_TYPES.CLAUSE).map((clause) => [clause.id, clause]),
  );
  const context = content ? buildEvidenceContext(content) : null;
  const haystack = context?.hasContent ? normalizeForComparison(context.text) : null;
  const issues = [];

  const checked = citations.map((citation) => {
    const clause = citation?.clauseId ? clauseById.get(citation.clauseId) : null;
    if (!clause) {
      const issue = `Citation “${citation?.clauseId ?? 'unknown'}” does not match any clause in this document.`;
      issues.push(issue);
      return {
        ...citation,
        verification: { status: CITATION_STATUS.UNKNOWN_CLAUSE, ok: false, scope: null, issues: [issue] },
      };
    }

    const clauseText = normalizeForComparison(clause.text);
    if (!clauseText) {
      const issue = `Clause ${clause.number ?? clause.id} has no extracted text to quote.`;
      issues.push(issue);
      return {
        ...citation,
        verification: { status: CITATION_STATUS.MISSING_SOURCE, ok: false, scope: null, issues: [issue] },
      };
    }

    if (!haystack) {
      return {
        ...citation,
        verification: {
          status: CITATION_STATUS.UNCHECKED,
          ok: true,
          scope: 'clause-record',
          issues: [
            'The parsed document text was not available, so this citation was checked against the extracted clause record only.',
          ],
        },
      };
    }

    if (haystack.includes(clauseText)) {
      return {
        ...citation,
        verification: { status: CITATION_STATUS.VERIFIED, ok: true, scope: 'clause', issues: [] },
      };
    }

    const sentence = normalizeForComparison(firstSentence(clause.text, { maxLength: 200 }));
    if (sentence && haystack.includes(sentence)) {
      return {
        ...citation,
        verification: {
          status: CITATION_STATUS.VERIFIED,
          ok: true,
          scope: 'excerpt',
          issues: [
            'The quoted excerpt appears in the document, but the full extracted clause text did not match as one block.',
          ],
        },
      };
    }

    const issue = `The extracted text of clause ${clause.number ?? clause.id} was not found in the parsed document.`;
    issues.push(issue);
    return {
      ...citation,
      verification: { status: CITATION_STATUS.TEXT_MISMATCH, ok: false, scope: null, issues: [issue] },
    };
  });

  const counts = checked.reduce(
    (acc, citation) => {
      const status = citation.verification.status;
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {
      [CITATION_STATUS.VERIFIED]: 0,
      [CITATION_STATUS.UNCHECKED]: 0,
      [CITATION_STATUS.TEXT_MISMATCH]: 0,
      [CITATION_STATUS.UNKNOWN_CLAUSE]: 0,
      [CITATION_STATUS.MISSING_SOURCE]: 0,
    },
  );

  return {
    citations: checked,
    counts,
    ok: checked.every((citation) => citation.verification.ok),
    hasContent: Boolean(haystack),
    issues,
  };
}


/**
 * Builds a grounded answer: what matched, what the document says, and what it
 * does not say. `answer` is assembled from extracted facts and verbatim quotes.
 */
export function answerQuestion(model, question, options = {}) {
  const questionSafety =
    options.sanitize === false
      ? {
          text: String(question ?? ''),
          warnings: [],
          truncated: false,
          originalLength: String(question ?? '').length,
        }
      : sanitizeQuestion(question, options);
  const askedQuestion = questionSafety.text;
  const matches = retrieveClauses(model, askedQuestion, options);
  const terms = tokenizeQuestion(askedQuestion);
  const maxMatches = options.maxMatches ?? 3;
  const base = { question: askedQuestion, askedAs: String(question ?? ''), questionSafety };

  if (terms.length === 0) {
    return {
      ...base,
      matched: false,
      insufficient: true,
      emptyReason: ASK_EMPTY_REASONS.NO_TERMS,
      matches: [],
      answer: ASK_NO_TERMS_ANSWER,
      citations: [],
      facts: [],
      sources: [],
      citationValidation: null,
      confidence: assessAnswerConfidence({
        matched: false,
        questionSafety,
        emptyReason: ASK_EMPTY_REASONS.NO_TERMS,
      }),
      limitations: ['The question contained no searchable terms.'],
      disclaimer: ASK_DISCLAIMER,
    };
  }

  if (matches.length === 0) {
    return {
      ...base,
      matched: false,
      insufficient: true,
      emptyReason: ASK_EMPTY_REASONS.NO_MATCH,
      matches: [],
      answer: ASK_NO_MATCH_ANSWER,
      citations: [],
      facts: [],
      sources: [],
      citationValidation: null,
      confidence: assessAnswerConfidence({
        matched: false,
        questionSafety,
        emptyReason: ASK_EMPTY_REASONS.NO_MATCH,
      }),
      limitations: [
        'No match means the term does not appear in the parsed text; it is not a conclusion that the document is silent on the topic.',
      ],
      disclaimer: ASK_DISCLAIMER,
    };
  }

  const context = buildObligationContext(model, options);
  const facts = [];
  const citations = [];
  const sentences = [];

  for (const match of matches.slice(0, maxMatches)) {
    citations.push({
      clauseId: match.clause.id,
      clauseNumber: match.clause.number,
      heading: match.clause.heading,
      page: match.clause.page,
      score: match.score,
    });
    const label = match.clause.number
      ? `Clause ${match.clause.number}${match.clause.heading ? ` (${match.clause.heading})` : ''}`
      : match.clause.heading ?? 'A clause';
    sentences.push(`${label}: “${firstSentence(match.clause.text)}”`);

    for (const obligation of match.facts) {
      facts.push({ obligation, assessment: assessObligation(obligation, context) });
    }
  }

  const citationValidation = validateCitations(model, citations, { content: options.content ?? null });
  const sources = buildAnswerSources(matches, { maxMatches, citationValidation });
  const limitations = [
    'This answer is an extractive summary of the quoted clauses. It does not interpret the clauses and is not advice.',
  ];
  if (matches[0].score < 4) {
    limitations.push(
      'The strongest match is weak (only a term or two overlapped), so these excerpts may be only loosely related to the question.',
    );
  }
  if (citationValidation.issues.length > 0) {
    limitations.push(
      `${citationValidation.issues.length} citation(s) could not be verified against the parsed document text; treat those excerpts as unconfirmed.`,
    );
  }
  if (!citationValidation.hasContent) {
    limitations.push(
      'The parsed document text was not available for this answer, so each citation was checked against the extracted clause record only.',
    );
  }

  return {
    ...base,
    matched: true,
    insufficient: false,
    emptyReason: null,
    matches,
    answer: sentences.join('\n\n'),
    citations: citationValidation.citations,
    citationValidation,
    sources,
    facts,
    confidence: assessAnswerConfidence({
      matched: true,
      matches,
      citationValidation,
      questionSafety,
    }),
    limitations,
    disclaimer: ASK_DISCLAIMER,
  };
}

/** Suggested prompts derived from the model, so the page is useful immediately. */
export function suggestQuestions(model, { limit = 5 } = {}) {
  const suggestions = [];
  const clean = (text) => String(text ?? '').trim().replace(/[.\s]+$/, '');
  for (const risk of getEntitiesByType(model, ENTITY_TYPES.RISK).slice(0, 2)) {
    if (risk.title) suggestions.push(`What does the document say about ${clean(risk.title).toLowerCase()}?`);
  }
  for (const deadline of getEntitiesByType(model, ENTITY_TYPES.DEADLINE).slice(0, 2)) {
    if (deadline.description) suggestions.push(`When is the deadline for ${clean(deadline.description).toLowerCase()}?`);
  }
  for (const obligation of getEntitiesByType(model, ENTITY_TYPES.OBLIGATION).slice(0, 2)) {
    const label = entityLabel(obligation);
    if (label) suggestions.push(`Who is responsible for: ${clean(label).toLowerCase()}?`);
  }
  return suggestions.slice(0, limit);
}
