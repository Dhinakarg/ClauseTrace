/**
 * Source view helpers.
 *
 * The workspace shows the document itself, not a summary of it. These helpers
 * turn normalized content plus the parsed clause skeleton into render-able
 * blocks with highlight ranges, so a citation can be pointed back at the exact
 * characters it came from.
 *
 * Everything here is pure: no DOM, no React. That keeps the mapping from
 * offsets to page/paragraph/clause testable on its own.
 */

import { clauseForOffset, paragraphsForText } from '../../documents/chunker.js';

/** How much text the viewer keeps in memory around the selection. */
export const SOURCE_WINDOW_RADIUS = 24;

/**
 * Splits content into paragraph blocks annotated with page and clause.
 * Returns [] for missing or empty content.
 */
export function buildSourceBlocks(content, clauses = []) {
  const text = content?.text ?? '';
  if (!text) return [];
  const clausesById = new Map(clauses.map((clause) => [clause.id, clause]));

  return paragraphsForText(text).map((paragraph) => {
    // A paragraph can straddle two clauses (a heading and its first clause are
    // one block), so it belongs to the clause its text starts in.
    const clause = clauseForOffset(clauses, paragraph.startOffset);
    return {
      index: paragraph.index,
      startOffset: paragraph.startOffset,
      endOffset: paragraph.endOffset,
      text: paragraph.text,
      page: pageForOffset(content, paragraph.startOffset),
      pageEnd: pageForOffset(content, Math.max(paragraph.startOffset, paragraph.endOffset - 1)),
      clauseId: clause?.id ?? null,
      clauseNumber: clause?.number ?? null,
      clauseHeading: clause ? clausesById.get(clause.id)?.heading ?? null : null,
      clauseType: clause?.clauseType ?? 'unknown',
      charCount: paragraph.text.length,
    };
  });
}

/** Page number for an offset, falling back to 1 when no page index exists. */
export function pageForOffset(content, offset) {
  if (!Number.isInteger(offset)) return null;
  const pages = content?.pages ?? [];
  const page = pages.find(
    (entry) => offset >= (entry.charStart ?? 0) && offset <= (entry.charEnd ?? 0),
  );
  return page?.pageNumber ?? (pages.length > 0 ? pages[0].pageNumber : 1);
}

/** Index of the block containing an offset (nearest block when between). */
export function findBlockIndexForOffset(blocks, offset) {
  if (!Array.isArray(blocks) || blocks.length === 0 || !Number.isInteger(offset)) return -1;
  const containing = blocks.findIndex(
    (block) => offset >= block.startOffset && offset <= block.endOffset,
  );
  if (containing >= 0) return containing;
  const after = blocks.findIndex((block) => block.startOffset > offset);
  return after <= 0 ? blocks.length - 1 : after - 1;
}

/**
 * Keeps the block list small for long documents: returns a window of block
 * indices around the focus block, plus how many are hidden on each side.
 */
export function blockWindow(blocks, focusIndex, radius = SOURCE_WINDOW_RADIUS) {
  const total = Array.isArray(blocks) ? blocks.length : 0;
  if (total === 0) return { start: 0, end: 0, hiddenBefore: 0, hiddenAfter: 0 };
  const index = focusIndex < 0 ? 0 : focusIndex;
  const start = Math.max(0, index - radius);
  const end = Math.min(total, index + radius + 1);
  return { start, end, hiddenBefore: start, hiddenAfter: total - end };
}

/** Highlight range for a clause (its whole text, by offset). */
export function clauseHighlight(clause) {
  if (!Number.isInteger(clause?.startOffset) || !Number.isInteger(clause?.endOffset)) return null;
  if (clause.endOffset <= clause.startOffset) return null;
  return { startOffset: clause.startOffset, endOffset: clause.endOffset, kind: 'clause' };
}

/** Highlight ranges for evidence references, marking verification state. */
export function evidenceHighlights(references = []) {
  return (Array.isArray(references) ? references : [])
    .filter(
      (reference) =>
        Number.isInteger(reference?.startOffset) &&
        Number.isInteger(reference?.endOffset) &&
        reference.endOffset > reference.startOffset,
    )
    .map((reference) => ({
      startOffset: reference.startOffset,
      endOffset: reference.endOffset,
      kind: 'evidence',
      verified: Boolean(reference.verified),
      referenceId: reference.id ?? null,
    }));
}

/** Sorts and flattens overlapping highlight ranges, keeping the strongest kind. */
export function mergeHighlights(ranges = []) {
  const valid = (Array.isArray(ranges) ? ranges : [])
    .filter((range) => range && range.endOffset > range.startOffset)
    .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);

  const merged = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    if (last && range.startOffset <= last.endOffset) {
      last.endOffset = Math.max(last.endOffset, range.endOffset);
      // Evidence wins over a plain clause span, because it is more specific.
      if (range.kind === 'evidence') last.kind = 'evidence';
      last.verified = Boolean(last.verified) || Boolean(range.verified);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/**
 * Cuts a block's text into plain and highlighted segments.
 * Text is never interpreted as markup; React escapes it at render time.
 */
export function segmentsForBlock(block, highlights = []) {
  const overlapping = mergeHighlights(
    (Array.isArray(highlights) ? highlights : []).filter(
      (range) => range.endOffset > block.startOffset && range.startOffset < block.endOffset,
    ),
  );
  if (overlapping.length === 0) {
    return [{ text: block.text, highlighted: false, kind: null, verified: false }];
  }

  const segments = [];
  let cursor = block.startOffset;
  for (const range of overlapping) {
    const start = Math.max(range.startOffset, block.startOffset);
    const end = Math.min(range.endOffset, block.endOffset);
    if (start > cursor) {
      segments.push({
        text: block.text.slice(cursor - block.startOffset, start - block.startOffset),
        highlighted: false,
        kind: null,
        verified: false,
      });
    }
    segments.push({
      text: block.text.slice(start - block.startOffset, end - block.startOffset),
      highlighted: true,
      kind: range.kind ?? 'clause',
      verified: Boolean(range.verified),
      referenceId: range.referenceId ?? null,
    });
    cursor = end;
  }
  if (cursor < block.endOffset) {
    segments.push({
      text: block.text.slice(cursor - block.startOffset),
      highlighted: false,
      kind: null,
      verified: false,
    });
  }
  return segments.filter((segment) => segment.text.length > 0);
}

/** Available clause type filters with counts, ordered by frequency. */
export function clauseTypeFilters(clauses = []) {
  const counts = new Map();
  for (const clause of clauses) {
    const type = clause?.clauseType ?? 'unknown';
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * Filters the clause list for the navigator.
 * `factsByClause` is a Map of clauseId → fact count (from the evidence index).
 */
export function filterClauses(
  clauses = [],
  { query = '', types = [], onlyWithFacts = false, factsByClause = null } = {},
) {
  const needle = String(query ?? '').trim().toLowerCase();
  const typeSet = new Set(types);
  return clauses.filter((clause) => {
    if (typeSet.size > 0 && !typeSet.has(clause?.clauseType ?? 'unknown')) return false;
    if (onlyWithFacts) {
      const count = Number(factsByClause?.get?.(clause.id) ?? 0);
      if (!count) return false;
    }
    if (!needle) return true;
    const haystack = `${clause.number ?? ''} ${clause.heading ?? ''} ${clause.text ?? ''}`.toLowerCase();
    return haystack.includes(needle);
  });
}

/** Counts shown in the workspace header: what was read and what was found. */
export function summarizeSource(content, clauses = [], facts = []) {
  return {
    pageCount: content?.pageCount ?? 0,
    charCount: content?.charCount ?? 0,
    clauseCount: clauses.length,
    factCount: facts.length,
    types: clauseTypeFilters(clauses).length,
    hasText: Boolean(content?.text),
  };
}

/** Position of an offset within a document, as a percentage (for scroll hints). */
export function offsetProgress(content, offset) {
  const total = content?.charCount ?? content?.text?.length ?? 0;
  if (!total || !Number.isInteger(offset)) return 0;
  return Math.max(0, Math.min(1, offset / total));
}
