/**
 * Clause typing.
 *
 * Assigning a type to a clause is a *classification of document text*, so it is
 * done deterministically here — never by the model. The AI may later confirm or
 * refine a type for a clause this module could not classify, and when it does
 * the clause records `typeSource: 'ai'` so the UI can say where the label came
 * from.
 *
 * Rules are ordered from most to least specific: the first matching rule wins.
 */

import { CLAUSE_TYPES, CLAUSE_TYPE_SOURCES } from './schema.js';

/** Human-readable labels, kept next to the vocabulary they describe. */
export const CLAUSE_TYPE_LABELS = Object.freeze({
  definitions: 'Definitions',
  services: 'Services',
  payment: 'Payment and fees',
  suspension: 'Suspension',
  termination: 'Termination',
  renewal: 'Renewal',
  term: 'Term',
  confidentiality: 'Confidentiality',
  liability: 'Liability',
  indemnity: 'Indemnity',
  remedies: 'Remedies',
  notice: 'Notices',
  reporting: 'Reporting',
  assignment: 'Assignment',
  subcontracting: 'Subcontracting',
  survival: 'Survival',
  'governing-law': 'Governing law',
  'dispute-resolution': 'Dispute resolution',
  'force-majeure': 'Force majeure',
  schedule: 'Schedule or annex',
  other: 'Other',
  unknown: 'Not determined',
});

/** Types a parser can only guess at, so an AI confirmation is worth keeping. */
export const WEAK_CLAUSE_TYPES = Object.freeze(['other', 'unknown']);

/**
 * Ordered classification rules.
 * `scope` decides which fields of the clause the patterns are tested against.
 */
const RULES = Object.freeze([
  // Heading-scope rules run first: a labelled clause ("SCHEDULE 1",
  // "CONFIDENTIALITY") is more specific than any word in its body text.
  { type: 'schedule', scope: 'heading', patterns: [/^(schedule|annex|exhibit|appendix)\b/i] },
  { type: 'definitions', scope: 'heading', patterns: [/^definitions?\b/i, /\bdefined terms\b/i] },
  { type: 'payment', scope: 'heading', patterns: [/^(payment|fees|invoicing|charges)\b/i] },
  { type: 'termination', scope: 'heading', patterns: [/^(termination|expiry|expiration)\b/i] },
  { type: 'renewal', scope: 'heading', patterns: [/^renewal\b/i] },
  { type: 'term', scope: 'heading', patterns: [/^(term|duration)\b/i] },
  {
    type: 'confidentiality',
    scope: 'heading',
    patterns: [/^(confidentiality|confidential information)\b/i],
  },
  { type: 'liability', scope: 'heading', patterns: [/^liabilit(y|ies)\b/i] },
  {
    type: 'definitions',
    scope: 'text',
    patterns: [
      /(^|\n)\s*"?[A-Z][^"\n]{0,80}"?\s+(means|shall mean|refers to)\b/,
      /\bdefinitions? and interpretation\b/i,
    ],
  },
  {
    type: 'survival',
    scope: 'text',
    patterns: [/\bshall survive\b/i, /\bsurvive (the )?(termination|expiry|expiration)\b/i],
  },
  {
    type: 'confidentiality',
    scope: 'text',
    patterns: [
      /\bconfidential information\b/i,
      /\bconfidentiality\b/i,
      /\bnon[- ]disclosure\b/i,
      /\breceiving party\b/i,
    ],
  },
  {
    type: 'indemnity',
    scope: 'text',
    patterns: [/\bindemnif(y|ies|ication)\b/i, /\bhold harmless\b/i],
  },
  {
    type: 'liability',
    scope: 'text',
    patterns: [
      /\bliabilit(y|ies)\b/i,
      /\blimitation of liability\b/i,
      /\bshall not be limited or excluded\b/i,
    ],
  },
  { type: 'suspension', scope: 'text', patterns: [/\bsuspend(ed|ing|sion)?\b/i] },
  { type: 'subcontracting', scope: 'text', patterns: [/\bsubcontract(ed|ing|or|s)?\b/i] },
  {
    type: 'assignment',
    scope: 'text',
    patterns: [/\bassign(ed|ment|s)?\b/i, /\bchange of control\b/i, /\btransfer of this agreement\b/i],
  },
  {
    type: 'remedies',
    scope: 'text',
    patterns: [/\bremedies\b/i, /\bspecific performance\b/i, /\binjunct(ion|ive)\b/i],
  },
  {
    type: 'termination',
    scope: 'text',
    patterns: [/\bterminat(e|ed|es|ing|ion)\b/i, /\bmaterial breach\b/i, /\bnot cured within\b/i],
  },
  {
    type: 'renewal',
    scope: 'text',
    patterns: [
      /\bautomatic(ally)? renew/i,
      /\brenew(al|s|ed)?\b/i,
      /\bsuccessive periods?\b/i,
      /\bextension of the term\b/i,
    ],
  },
  {
    type: 'term',
    scope: 'text',
    patterns: [
      /\binitial term\b/i,
      /\bterm of (this|the) agreement\b/i,
      /\bcommences on\b/i,
      /\bcontinues until\b/i,
      /\bduration of (this|the) agreement\b/i,
    ],
  },
  {
    type: 'payment',
    scope: 'text',
    patterns: [
      /\bpay(ment|ments|able|s)?\b/i,
      /\binvoice(s|d)?\b/i,
      /\bfees?\b/i,
      /\binterest at\b/i,
      /\baccrue interest\b/i,
      /\bremuneration\b/i,
    ],
  },
  {
    type: 'services',
    scope: 'text',
    patterns: [
      /\bshall provide the services\b/i,
      /\bservices\b/i,
      /\bdeliverables?\b/i,
      /\bservice levels?\b/i,
      /\bstatement of work\b/i,
    ],
  },
  { type: 'reporting', scope: 'text', patterns: [/\breport(ing|s)?\b/i, /\bcompliance report\b/i] },
  {
    type: 'governing-law',
    scope: 'text',
    patterns: [/\bgoverning law\b/i, /\bgoverned by the laws\b/i, /\bjurisdiction of\b/i],
  },
  {
    type: 'dispute-resolution',
    scope: 'text',
    patterns: [/\bdispute\b/i, /\barbitration\b/i, /\bmediation\b/i],
  },
  {
    type: 'force-majeure',
    scope: 'text',
    patterns: [/\bforce majeure\b/i, /\bbeyond its reasonable control\b/i],
  },
  {
    type: 'notice',
    scope: 'text',
    patterns: [/\bwritten notice\b/i, /\bnotices\b/i, /\bnotice period\b/i],
  },
]);

/** Renders a clause into the text the rules are matched against. */
function haystackFor(clause) {
  const heading = String(clause?.heading ?? '');
  const text = String(clause?.text ?? '');
  const number = String(clause?.number ?? '');
  return { heading, text: `${heading}\n${text}`.trim(), number };
}

/**
 * Classifies one clause/section.
 * Returns { type, source }. `source` is 'parser' for a rule match and
 * 'unknown' when nothing matched, so callers can decide whether an AI
 * confirmation is worth recording.
 */
export function classifyClauseType(clause) {
  const { heading, text, number } = haystackFor(clause);
  if (!text && !heading && !number) {
    return { type: 'unknown', source: CLAUSE_TYPE_SOURCES.UNKNOWN };
  }

  for (const rule of RULES) {
    // Heading rules see the heading, or the clause number when a document puts
    // its label there ("SCHEDULE 1" is parsed with an empty heading).
    const target = rule.scope === 'heading' ? heading.trim() || number : text;
    if (!target) continue;
    if (rule.patterns.some((pattern) => pattern.test(target))) {
      return { type: rule.type, source: CLAUSE_TYPE_SOURCES.PARSER };
    }
  }

  // A preamble or a bare text block is still "other", not "unknown": we read it,
  // we simply could not place it in a category.
  return { type: text ? 'other' : 'unknown', source: CLAUSE_TYPE_SOURCES.PARSER };
}

/** Applies classification to a clause object, returning a new object. */
export function withClauseType(clause) {
  const { type, source } = classifyClauseType(clause);
  // `type` is the entity discriminator, so the category lives in `clauseType`.
  return { ...clause, clauseType: type, clauseTypeSource: source };
}

/** Classifies many clauses; deterministic and order-independent. */
export function classifyClauses(clauses = []) {
  return clauses.map((clause) => withClauseType(clause));
}

/** Display label for a clause type, never returning an empty string. */
export function clauseTypeLabel(type) {
  if (!type) return CLAUSE_TYPE_LABELS.unknown;
  return CLAUSE_TYPE_LABELS[type] ?? String(type).replace(/-/g, ' ');
}

/** True when a type is part of the vocabulary (used by the AI response parser). */
export function isClauseType(value) {
  return CLAUSE_TYPES.includes(value);
}

/** True when the parser could not place the clause in a category. */
export function isWeakClauseType(type) {
  return WEAK_CLAUSE_TYPES.includes(type ?? 'unknown');
}

