/**
 * Signal support.
 *
 * Shared, deterministic helpers for the Phase 3 signal engines (`riskRules.js`
 * and `inconsistencyRules.js`). Everything here is either a pattern match on
 * words the document already contains or plain arithmetic on the periods it
 * states. There is no inference, no scoring and no AI: a caller always receives
 * the matched phrase back, so the UI can show a reader the exact words a signal
 * came from.
 */

/** Words-as-numbers the engines understand when a period is spelled out. */
const WORD_NUMBERS = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
});

/** Severity ordering used for stable sort order (most urgent first). */
export const SEVERITY_ORDER = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  unknown: 5,
});

export function severityRank(severity) {
  return SEVERITY_ORDER[severity] ?? SEVERITY_ORDER.unknown;
}

/** Collapses whitespace and trims. Never throws on non-strings. */
export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lower-cased, punctuation-stripped form used for comparisons and dedupe. */
export function normalizePhrase(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clips a phrase for display without cutting mid-word where avoidable. */
export function truncate(value, maxLength = 120) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

/** Approximate days for a calendar unit; month/year are marked inexact. */
export function toDays(amount, unit) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  switch (String(unit ?? '').toLowerCase()) {
    case 'day':
      return { days: value, exact: true };
    case 'week':
      return { days: value * 7, exact: true };
    case 'month':
      return { days: value * 30, exact: false };
    case 'year':
      return { days: value * 365, exact: false };
    default:
      return null;
  }
}

const UNIT_PATTERN = 'day|days|week|weeks|month|months|year|years';

/**
 * Finds every period the text states and converts it to days.
 * Handles digits ("30 days"), number words ("thirty days") and the common legal
 * double form ("thirty (30) days"). Returns entries in text order:
 * `{ amount, unit, days, exact, phrase, index }`.
 */
export function extractPeriods(text) {
  const source = String(text ?? '');
  if (!source) return [];
  const found = [];
  const wordList = Object.keys(WORD_NUMBERS).join('|');
  const pattern = new RegExp(
    `(?:(?:${wordList})\\s*\\((\\d{1,4})\\)|(\\d{1,4})|(?:${wordList}))\\s*(?:calendar\\s+|business\\s+|working\\s+)?(?:${UNIT_PATTERN})\\b`,
    'gi',
  );

  let match = pattern.exec(source);
  while (match) {
    const phrase = normalizeText(match[0]);
    const digits = match[1] ?? match[2] ?? null;
    const word = phrase.match(new RegExp(`^(${wordList})`, 'i'))?.[1] ?? null;
    const amount = digits ? Number(digits) : WORD_NUMBERS[String(word).toLowerCase()] ?? null;
    const unit = phrase.match(new RegExp(`(${UNIT_PATTERN})`, 'i'))?.[1]?.toLowerCase() ?? null;
    const converted = unit ? toDays(amount, unit.replace(/s$/, '')) : null;
    if (amount !== null && converted) {
      found.push({
        amount,
        unit: unit.replace(/s$/, ''),
        days: converted.days,
        exact: converted.exact,
        phrase,
        index: match.index,
      });
    }
    match = pattern.exec(source);
  }
  return found;
}

/** Returns the first match of any pattern, or null. Patterns are RegExp. */
export function matchFirst(text, patterns) {
  const source = String(text ?? '');
  if (!source) return null;
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match) return { phrase: normalizeText(match[0]), index: match.index, match };
  }
  return null;
}

/** Returns every match of a pattern with the text it matched. */
export function matchAll(text, pattern) {
  const source = String(text ?? '');
  if (!source) return [];
  const results = [];
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  let match = regex.exec(source);
  while (match) {
    results.push({ phrase: normalizeText(match[0]), index: match.index, match });
    if (match[0].length === 0) regex.lastIndex += 1;
    match = regex.exec(source);
  }
  return results;
}

/**
 * Quoted terms: the words a contract itself marks as defined, e.g.
 * `"Confidential Information"`, `(the "Services")`.
 */
export function quotedTerms(text) {
  const patterns = [
    /"([^"\n]{3,60})"/g,
    /\u201c([^\u201d\n]{3,60})\u201d/g,
    /\((?:the\s+)?"([^"\n]{3,60})"\)/g,
  ];
  const terms = new Map();
  for (const pattern of patterns) {
    for (const entry of matchAll(text, pattern)) {
      const term = normalizeText(entry.match[1]);
      if (term && !terms.has(normalizePhrase(term))) {
        terms.set(normalizePhrase(term), { term, phrase: entry.phrase, index: entry.index });
      }
    }
  }
  return [...terms.values()];
}

const SENTENCE_STARTERS = new Set([
  'the',
  'this',
  'that',
  'these',
  'those',
  'a',
  'an',
  'any',
  'all',
  'each',
  'every',
  'if',
  'in',
  'on',
  'for',
  'to',
  'no',
  'not',
  'such',
  'where',
  'when',
  'unless',
  'provided',
]);

/**
 * Multi-word capitalised phrases, which is how contracts name defined terms in
 * running text ("Service Provider", "Invoice Date"). Phrases that begin with a
 * sentence starter are excluded so ordinary prose ("The Customer shall pay") is
 * not mistaken for a defined term.
 */
export function capitalizedTerms(text) {
  const source = String(text ?? '');
  if (!source) return [];
  const pattern = /\b([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|of|and|the|to|for|in)){1,4})\b/g;
  const terms = new Map();
  for (const entry of matchAll(source, pattern)) {
    const term = normalizeText(entry.match[1]);
    const words = term.split(' ');
    if (words.length < 2) continue;
    if (SENTENCE_STARTERS.has(words[0].toLowerCase())) continue;
    if (!terms.has(normalizePhrase(term))) {
      terms.set(normalizePhrase(term), { term, phrase: entry.phrase, index: entry.index });
    }
  }
  return [...terms.values()];
}

/** Merges citation lists, de-duplicating by id, keeping first-seen order. */
export function mergeEvidence(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const reference of Array.isArray(list) ? list : []) {
      if (!reference || typeof reference !== 'object') continue;
      const key =
        reference.id ??
        `${reference.clauseId ?? ''}:${reference.startOffset ?? ''}:${reference.sourceText ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(reference);
    }
  }
  return merged;
}

/** Deterministic ordering: severity, then a caller-supplied tie-breaker. */
export function sortBySeverity(items, tieBreak = (item) => item.id ?? '') {
  return [...items].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return String(tieBreak(a)).localeCompare(String(tieBreak(b)));
  });
}
