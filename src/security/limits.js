/**
 * Security limits and untrusted-text sanitization.
 *
 * Uploaded legal documents are UNTRUSTED INPUT. Everything that enters the app
 * from a file, and everything an AI provider returns, passes through here.
 *
 * Note on XSS: ClauseGraph never renders untrusted text as HTML. These helpers
 * remove control characters and cap length so downstream consumers (logs,
 * prompts, tables) cannot be abused; React's default escaping handles markup.
 */

export const LIMITS = Object.freeze({
  /** Largest document we will read into memory. */
  MAX_FILE_BYTES: 25 * 1024 * 1024,
  /** Largest PDF we will page through. */
  MAX_PAGES: 400,
  /** Hard cap on normalized document text kept in memory. */
  MAX_TEXT_CHARS: 2_000_000,
  /** Hard cap on clauses parsed from one document. */
  MAX_CLAUSES: 4000,
  /** Cap on characters of untrusted document text sent to an AI provider per chunk. */
  MAX_PROMPT_CHARS: 48_000,
  /** Cap on stored evidence snippets. */
  MAX_EVIDENCE_CHARS: 600,
  /** Cap on a question typed into "Ask the document" (untrusted user input). */
  MAX_QUESTION_CHARS: 500,
  /** Cap on clauses quoted back in one answer. */
  MAX_ANSWER_MATCHES: 5,
  /** Cap on entities of a single type accepted from one extraction. */
  MAX_ENTITIES_PER_TYPE: 800,
  /** Cap on raw model response length we are willing to parse. */
  MAX_RESPONSE_CHARS: 2_000_000,
});

/**
 * C0/C1 character ranges we strip, as [start, end] code-point pairs.
 * Newline (U+000A), tab (U+0009) and form feed (U+000C) are deliberately absent:
 * \f is a meaningful page separator in extracted legal text.
 */
const CONTROL_RANGES = Object.freeze([
  [0x00, 0x08],
  [0x0b, 0x0b],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
]);

const CONTROL_CHARS = new RegExp(
  `[${CONTROL_RANGES.map(
    ([start, end]) => `${String.fromCharCode(start)}-${String.fromCharCode(end)}`,
  ).join('')}]`,
  'g',
);
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Removes NULs, control characters, zero-width characters and bidi overrides. */
export function stripControlCharacters(input) {
  return String(input ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(ZERO_WIDTH, '')
    // Bidi overrides can visually reorder text; strip them from untrusted input.
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
}

/** Normalizes line endings and collapses runaway blank lines. */
export function normalizeWhitespace(input) {
  return String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Full sanitization pipeline for untrusted text.
 * Returns { text, truncated, originalLength, modified, removedControlCharacters }.
 */
export function sanitizeUntrustedText(input, { maxLength = LIMITS.MAX_TEXT_CHARS } = {}) {
  const original = String(input ?? '');
  const withoutBom = original.replace(/^\uFEFF/, '');
  const stripped = stripControlCharacters(withoutBom);
  const cleaned = normalizeWhitespace(stripped).trim();
  const truncated = cleaned.length > maxLength;
  return {
    text: truncated ? cleaned.slice(0, maxLength) : cleaned,
    truncated,
    originalLength: original.length,
    modified: cleaned !== original,
    removedControlCharacters: stripped !== withoutBom,
  };
}

/** Truncates on a word boundary where possible, appending an ellipsis. */
export function truncateText(input, maxLength, { suffix = '\u2026' } = {}) {
  const value = String(input ?? '');
  if (value.length <= maxLength) return value;
  const slice = value.slice(0, Math.max(0, maxLength - suffix.length));
  const boundary = slice.lastIndexOf(' ');
  const trimmed = boundary > maxLength * 0.6 ? slice.slice(0, boundary) : slice;
  return `${trimmed.trimEnd()}${suffix}`;
}

export function byteLength(input) {
  const value = String(input ?? '');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return Buffer.byteLength(value, 'utf8');
}

/** Non-throwing size check used by the parser and upload UI. */
export function checkSize(bytes, limit = LIMITS.MAX_FILE_BYTES) {
  const ok = Number.isFinite(bytes) && bytes >= 0 && bytes <= limit;
  return {
    ok,
    limit,
    actual: bytes,
    message: ok ? null : `Document exceeds the ${Math.round(limit / (1024 * 1024))} MB limit.`,
  };
}

/** Escapes text for safe display in non-HTML sinks (CSV export, logs, prompts). */
export function escapeForLog(input) {
  return stripControlCharacters(input).replace(/[\\"]/g, (match) => `\\${match}`);
}
