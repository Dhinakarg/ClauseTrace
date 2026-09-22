/**
 * Chunker.
 *
 * Splits normalized document text into (a) a clause/section skeleton, which
 * becomes the `clauses` of the legal model, and (b) size-bounded chunks that
 * can be sent to an AI provider without losing their position in the document.
 *
 * The chunker is deterministic: the same text always produces the same clause
 * ids, offsets and chunk boundaries, which is what makes extracted evidence
 * verifiable afterwards.
 */

import { createClause } from '../legal/schema.js';
import { classifyClauses } from '../legal/clauseTypes.js';
import { LIMITS, truncateText } from '../security/limits.js';
import { offsetToPage } from './parser.js';

/** Rough token estimate (4 characters per token) used only for budgeting. */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/**
 * Heading patterns, ordered from most to least specific.
 * `maxLineLength` guards against treating an ordinary paragraph that happens to
 * start with a number as a heading; numbered clause paragraphs in real
 * agreements are often long, so the strong patterns allow generous length.
 */
const HEADING_PATTERNS = [
  // "12.3 Payment Terms"  /  "12.3.1 Notice"
  { regex: /^(\d+(?:\.\d+)+)\.?\s+(\S.*)$/, level: (number) => number.split('.').length },
  // "12. Payment Terms"  /  "12. Payment"
  { regex: /^(\d+)\.\s+(\S.*)$/, level: () => 1 },
  // "Article 5 - Termination" / "ARTICLE 5 TERMINATION"
  { regex: /^(?:article|art\.)\s+([0-9IVXLC]+)\b[\s.:-]*(.*)$/i, level: () => 1 },
  // "Section 4.2 Confidentiality"
  { regex: /^(?:section|§)\s*([0-9]+(?:\.[0-9]+)*)\b[\s.:-]*(.*)$/i, level: () => 1 },
  // "Clause 7 Indemnity"
  { regex: /^(?:clause)\s+([0-9]+(?:\.[0-9]+)*)\b[\s.:-]*(.*)$/i, level: () => 1 },
  // "(a) the Receiving Party shall ..."
  { regex: /^\(([a-z])\)\s+(\S.*)$/, level: () => 3, maxLineLength: 300 },
  // "(iv) any successor ..."
  { regex: /^\(([ivxl]+)\)\s+(\S.*)$/i, level: () => 4, maxLineLength: 300 },
  // "SCHEDULE 1" / "ANNEX A" / "EXHIBIT B"
  { regex: /^(schedule|annex|exhibit|appendix)\s+([0-9A-Z]+)\b[\s.:-]*(.*)$/i, level: () => 1 },
];

/** Longest numbered line still treated as a clause heading. */
const MAX_HEADING_LINE_LENGTH = 600;

/** Longest heading kept for display; the full text always lives in clause.text. */
const MAX_HEADING_DISPLAY_LENGTH = 160;

/** Detects a clause heading in a single line; returns null when absent. */
export function detectHeading(line) {
  const value = String(line ?? '').trim();
  if (!value) return null;

  for (const pattern of HEADING_PATTERNS) {
    const limit = pattern.maxLineLength ?? MAX_HEADING_LINE_LENGTH;
    if (value.length > limit) continue;
    const match = pattern.regex.exec(value);
    if (!match) continue;

    if (pattern.regex.source.startsWith('^(?:schedule')) {
      return {
        number: `${match[1]} ${match[2]}`.trim(),
        heading: truncateHeading(match[3]),
        level: pattern.level(),
      };
    }
    return {
      number: match[1],
      heading: truncateHeading(match[2]),
      level: pattern.level(match[1]),
    };
  }

  // ALL-CAPS short lines behave like headings in many agreements.
  if (
    value.length <= 80 &&
    /[A-Z]/.test(value) &&
    value === value.toUpperCase() &&
    /^[A-Z0-9 ,.'&()/-]+$/.test(value) &&
    value.split(/\s+/).length <= 8
  ) {
    return { number: null, heading: value, level: 1 };
  }
  return null;
}

/** Clips a heading for display only; clause.text always keeps the full text. */
function truncateHeading(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  return value.length > MAX_HEADING_DISPLAY_LENGTH
    ? `${value.slice(0, MAX_HEADING_DISPLAY_LENGTH - 1)}…`
    : value;
}

/**
 * Segments document text into clause-like sections with absolute offsets.
 * Lines that are not headings are appended to the section they follow, so no
 * text is lost: `coverage` reports how much of the document was attributed.
 */
export function segmentIntoClauses(content, { maxClauses = LIMITS.MAX_CLAUSES } = {}) {
  const text = content?.text ?? '';
  const sections = [];
  if (!text) return { sections, coverage: { attributedChars: 0, totalChars: 0 } };

  const lines = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    lines.push({ line, start: offset });
    offset += line.length + 1; // +1 for the removed newline
  }

  let current = null;
  const pushSection = () => {
    if (!current) return;
    current.endOffset = current.lastLineEnd;
    current.text = text.slice(current.startOffset, current.endOffset).trim();
    sections.push(current);
  };

  for (const { line, start } of lines) {
    const heading = detectHeading(line);
    if (heading && sections.length < maxClauses) {
      pushSection();
      current = {
        number: heading.number,
        heading: heading.heading,
        level: heading.level,
        startOffset: start,
        endOffset: start,
        lastLineEnd: start + line.length,
        text: '',
        sectionPath: [],
      };
      continue;
    }
    if (!current) {
      // Preamble before the first heading.
      current = {
        number: null,
        heading: 'Preamble',
        level: 0,
        startOffset: 0,
        endOffset: 0,
        lastLineEnd: 0,
        text: '',
        sectionPath: [],
      };
    }
    current.lastLineEnd = start + line.length;
  }
  pushSection();

  // Assign section paths and pages.
  const stack = [];
  const withPaths = sections.map((section) => {
    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) stack.pop();
    stack.push(section);
    return {
      ...section,
      sectionPath: stack.filter((entry, index) => index < stack.length - 1).map((entry) => entry.number ?? entry.heading),
      page: offsetToPage(section.startOffset, content.pages),
    };
  });

  const attributed = withPaths.reduce((total, section) => total + section.text.length, 0);
  return {
    sections: withPaths,
    coverage: { attributedChars: attributed, totalChars: text.length },
  };
}

/** Finds "clause 4.2" / "section 5" style cross references inside section text. */
export function detectCrossReferences(text, numberToId) {
  const references = new Set();
  const pattern = /(?:clause|section|§)\s*([0-9]+(?:\.[0-9]+)*)/gi;
  let match = pattern.exec(String(text ?? ''));
  while (match) {
    const id = numberToId.get(match[1]);
    if (id) references.add(id);
    match = pattern.exec(String(text ?? ''));
  }
  return [...references];
}

/**
 * Builds clause entities from segmented sections.
 * Ids are derived from document id + number/heading so they are stable, and
 * parent/child links plus cross references are wired deterministically.
 */
export function createClausesFromSections(documentId, sections) {
  const numberToId = new Map();
  const clauses = sections.map((section, index) => {
    const hint = section.number ?? section.heading ?? `section-${index + 1}`;
    const clause = createClause({
      id: undefined,
      documentId,
      number: section.number,
      heading: section.heading,
      text: section.text,
      level: section.level,
      sectionPath: section.sectionPath ?? [],
      page: section.page ?? null,
      startOffset: section.startOffset,
      endOffset: section.endOffset,
    });
    clause.id = `cl_${String(hint).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `section-${index + 1}`}_${index + 1}`;
    if (section.number) numberToId.set(section.number, clause.id);
    return clause;
  });

  clauses.forEach((clause, index) => {
    const parent = index > 0 ? clauses[index - 1] : null;
    if (parent && parent.level < clause.level) {
      clause.parentClauseId = parent.id;
      parent.childClauseIds = [...parent.childClauseIds, clause.id];
    }
  });

  clauses.forEach((clause) => {
    clause.crossReferences = detectCrossReferences(clause.text, numberToId);
  });

  // Clause type is a deterministic classification of the text, so it is applied
  // here rather than being requested from (or taken from) an AI provider.
  return classifyClauses(clauses);
}

/** Flattens clauses into a depth-first ordered list with a display order field. */
export function buildClauseTree(clauses) {
  const byId = new Map(clauses.map((clause) => [clause.id, clause]));
  const childrenOf = new Map();
  const roots = [];
  for (const clause of clauses) {
    if (clause.parentClauseId && byId.has(clause.parentClauseId)) {
      const siblings = childrenOf.get(clause.parentClauseId) ?? [];
      siblings.push(clause);
      childrenOf.set(clause.parentClauseId, siblings);
    } else {
      roots.push(clause);
    }
  }
  const ordered = [];
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      ordered.push({ clause: node, depth });
      walk(childrenOf.get(node.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return { roots, childrenOf, ordered, byId };
}

/**
 * Builds prompt-sized chunks aligned to clause boundaries.
 * Chunks never split a clause when the clause fits, and every chunk records the
 * character range it covers so returned evidence can be verified afterwards.
 */
export function chunkDocument(
  content,
  { clauses = null, maxChars = LIMITS.MAX_PROMPT_CHARS, overlapClauses = 0 } = {},
) {
  const text = content?.text ?? '';
  if (!text) return { chunks: [], truncatedChunks: 0 };

  const effectiveClauses =
    clauses ??
    createClausesFromSections(content?.documentId ?? null, segmentIntoClauses(content).sections);

  const chunks = [];
  let buffer = null;

  const flush = () => {
    if (!buffer) return;
    const chunkText = text.slice(buffer.charStart, buffer.charEnd).trim();
    chunks.push({
      id: `${content?.documentId ?? 'doc'}-chunk-${chunks.length + 1}`,
      index: chunks.length,
      text: chunkText,
      charStart: buffer.charStart,
      charEnd: buffer.charEnd,
      pageStart: offsetToPage(buffer.charStart, content?.pages),
      pageEnd: offsetToPage(buffer.charEnd, content?.pages),
      clauseIds: buffer.clauseIds,
      clauseNumbers: buffer.clauseNumbers,
      estimatedTokens: estimateTokens(chunkText),
      truncated: false,
    });
    buffer = null;
  };

  for (const clause of effectiveClauses) {
    const clauseStart = Number.isInteger(clause.startOffset) ? clause.startOffset : 0;
    const clauseEnd = Number.isInteger(clause.endOffset)
      ? clause.endOffset
      : clauseStart + clause.text.length;
    const clauseLength = clauseEnd - clauseStart;

    if (clauseLength > maxChars) {
      // Oversized clause: flush pending text, then emit it clipped and flagged
      // rather than silently truncated.
      flush();
      const clippedEnd = clauseStart + maxChars;
      chunks.push({
        id: `${content?.documentId ?? 'doc'}-chunk-${chunks.length + 1}`,
        index: chunks.length,
        text: truncateText(text.slice(clauseStart, clippedEnd), maxChars, { suffix: '' }),
        charStart: clauseStart,
        charEnd: clippedEnd,
        pageStart: offsetToPage(clauseStart, content?.pages),
        pageEnd: offsetToPage(clippedEnd, content?.pages),
        clauseIds: [clause.id],
        clauseNumbers: [clause.number].filter(Boolean),
        estimatedTokens: estimateTokens(text.slice(clauseStart, clippedEnd)),
        truncated: true,
      });
      continue;
    }

    if (!buffer) {
      buffer = {
        charStart: clauseStart,
        charEnd: clauseEnd,
        clauseIds: [clause.id],
        clauseNumbers: [clause.number].filter(Boolean),
      };
      continue;
    }

    if (clauseEnd - buffer.charStart > maxChars) {
      flush();
      buffer = {
        charStart: clauseStart,
        charEnd: clauseEnd,
        clauseIds: [clause.id],
        clauseNumbers: [clause.number].filter(Boolean),
      };
      continue;
    }

    buffer.charEnd = clauseEnd;
    if (!buffer.clauseIds.includes(clause.id)) buffer.clauseIds.push(clause.id);
    if (clause.number && !buffer.clauseNumbers.includes(clause.number)) {
      buffer.clauseNumbers.push(clause.number);
    }
  }
  flush();

  return {
    chunks: applyClauseOverlap({
      chunks,
      text,
      clauses: effectiveClauses,
      pages: content?.pages,
      overlapClauses,
    }),
    truncatedChunks: chunks.filter((chunk) => chunk.truncated).length,
  };
}

/**
 * Optionally repeats the tail clauses of the previous chunk so the model can
 * resolve references that straddle a boundary. Offsets stay truthful: carried
 * clauses are recorded on the chunk even when they fall outside its range.
 */
function applyClauseOverlap({ chunks, text, clauses, pages, overlapClauses }) {
  if (overlapClauses <= 0) return chunks;
  return chunks.map((chunk, index) => {
    if (index === 0) return chunk;
    const previous = chunks[index - 1];
    const carriedIds = previous.clauseIds.slice(-overlapClauses);
    const carriedNumbers = previous.clauseNumbers.slice(-overlapClauses);
    const firstCarried = clauses.find((clause) => clause.id === carriedIds[0]);
    const carryStart = firstCarried ? text.indexOf(firstCarried.text) : -1;

    if (!firstCarried || carryStart < 0 || carryStart >= chunk.charStart) {
      return {
        ...chunk,
        carriedClauseIds: carriedIds,
        carriedClauseNumbers: carriedNumbers,
      };
    }

    const overlapText = text.slice(carryStart, chunk.charStart).trim();
    const combined = `${overlapText}\n\n${chunk.text}`.trim();
    return {
      ...chunk,
      text: combined,
      charStart: carryStart,
      pageStart: offsetToPage(carryStart, pages),
      clauseIds: [...carriedIds, ...chunk.clauseIds.filter((id) => !carriedIds.includes(id))],
      clauseNumbers: [...new Set([...carriedNumbers, ...chunk.clauseNumbers])],
      estimatedTokens: estimateTokens(combined),
      carriedClauseIds: carriedIds,
      carriedClauseNumbers: carriedNumbers,
    };
  });
}

/**
 * Convenience wrapper used by the extraction pipeline: segment, build clauses
 * and chunk in one deterministic pass.
 */
export function prepareChunks(content, options = {}) {
  const { sections, coverage } = segmentIntoClauses(content, options);
  const clauses = createClausesFromSections(content?.documentId ?? null, sections);
  const { chunks, truncatedChunks } = chunkDocument(content, { ...options, clauses });
  return {
    clauses,
    chunks,
    truncatedChunks,
    coverage,
    stats: {
      clauseCount: clauses.length,
      chunkCount: chunks.length,
      totalTokens: chunks.reduce((total, chunk) => total + chunk.estimatedTokens, 0),
      documentChars: content?.charCount ?? 0,
    },
  };
}

/** Compact, storable chunk summary for prompt-budget and audit views. */
export function summarizeChunks(chunks = []) {
  return chunks.map((chunk) => ({
    id: chunk.id,
    index: chunk.index,
    clauseNumbers: chunk.clauseNumbers,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    estimatedTokens: chunk.estimatedTokens,
    truncated: chunk.truncated,
    preview: truncateText(chunk.text.replace(/\s+/g, ' '), 140),
  }));
}

/* -------------------------------------------------------------------------- */
/* Location metadata                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Paragraph blocks of a document: runs of text separated by a blank line.
 * Paragraph indices are 0-based and stable for a given text.
 */
export function paragraphsForText(text) {
  const value = String(text ?? '');
  if (!value.trim()) return [];
  const paragraphs = [];
  const pattern = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
  let match = pattern.exec(value);
  while (match) {
    paragraphs.push({
      index: paragraphs.length,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
      text: match[0],
    });
    match = pattern.exec(value);
  }
  return paragraphs;
}

/** Paragraph containing a character offset, or null when the offset is outside. */
export function paragraphIndexForOffset(text, offset) {
  if (!Number.isInteger(offset) || offset < 0) return null;
  for (const paragraph of paragraphsForText(text)) {
    if (offset >= paragraph.startOffset && offset <= paragraph.endOffset) return paragraph.index;
  }
  return null;
}

/** Innermost clause containing an offset (smallest matching range). */
export function clauseForOffset(clauses = [], offset) {
  if (!Number.isInteger(offset)) return null;
  let found = null;
  for (const clause of clauses) {
    const start = clause?.startOffset;
    const end = clause?.endOffset;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (offset < start || offset > end) continue;
    if (!found || end - start < found.endOffset - found.startOffset) found = clause;
  }
  return found;
}

/** Clauses overlapping a character range, in document order. */
export function clausesInRange(clauses = [], startOffset, endOffset) {
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || endOffset < startOffset) {
    return [];
  }
  return clauses.filter(
    (clause) =>
      Number.isInteger(clause?.startOffset) &&
      Number.isInteger(clause?.endOffset) &&
      clause.startOffset <= endOffset &&
      clause.endOffset >= startOffset,
  );
}

/**
 * Chunk → clause mapping used for evidence round-trips and the workspace
 * navigator. `carried: true` means the clause is repeated in this chunk for
 * context, so it lies outside the chunk's own character range.
 */
export function mapChunksToClauses(chunks = [], clauses = []) {
  const byClause = new Map();
  const pairs = [];
  for (const chunk of chunks) {
    const inRange = clausesInRange(clauses, chunk.charStart, chunk.charEnd);
    const inRangeIds = new Set(inRange.map((clause) => clause.id));
    for (const clause of inRange) {
      const pair = {
        chunkId: chunk.id,
        chunkIndex: chunk.index,
        clauseId: clause.id,
        clauseNumber: clause.number,
        clauseType: clause.clauseType ?? 'unknown',
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        carried: false,
      };
      pairs.push(pair);
      byClause.set(clause.id, [...(byClause.get(clause.id) ?? []), pair]);
    }

    for (const clauseId of chunk.carriedClauseIds ?? []) {
      if (inRangeIds.has(clauseId)) continue;
      const clause = clauses.find((entry) => entry.id === clauseId);
      if (!clause) continue;
      const pair = {
        chunkId: chunk.id,
        chunkIndex: chunk.index,
        clauseId: clause.id,
        clauseNumber: clause.number,
        clauseType: clause.clauseType ?? 'unknown',
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        carried: true,
      };
      pairs.push(pair);
      byClause.set(clause.id, [...(byClause.get(clause.id) ?? []), pair]);
    }
  }
  return { pairs, byClause };
}

/** Metadata every chunk carries, as produced by `chunkDocument`. */
export const CHUNK_METADATA_FIELDS = Object.freeze([
  'id',
  'index',
  'text',
  'charStart',
  'charEnd',
  'pageStart',
  'pageEnd',
  'clauseIds',
  'clauseNumbers',
  'estimatedTokens',
  'truncated',
]);

/** Extra location metadata derived by `describeChunkLocation` for the report. */
export const CHUNK_LOCATION_FIELDS = Object.freeze([
  'paragraphStart',
  'paragraphEnd',
  'clauseTypes',
  'sectionPath',
  'carriedClauseIds',
]);

/**
 * Full location description for one chunk: character range, page range,
 * paragraph range, clauses whose text it carries and the section path of the
 * first clause it covers. Used by the extraction report and the workspace UI.
 */
export function describeChunkLocation(chunk, clauses = [], content = null) {
  if (!chunk) return null;
  const text = content?.text ?? '';
  const covered = clausesInRange(clauses, chunk.charStart, chunk.charEnd);
  const firstClause = covered[0] ?? clauses.find((clause) => clause.id === chunk.clauseIds?.[0]) ?? null;
  const paragraphStart = text ? paragraphIndexForOffset(text, chunk.charStart) : null;
  const paragraphEnd = text ? paragraphIndexForOffset(text, Math.max(chunk.charStart, chunk.charEnd - 1)) : null;

  return {
    id: chunk.id,
    index: chunk.index,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    paragraphStart,
    paragraphEnd,
    clauseIds: [...(chunk.clauseIds ?? [])],
    clauseNumbers: [...(chunk.clauseNumbers ?? [])],
    clauseTypes: covered.map((clause) => clause.clauseType ?? 'unknown'),
    sectionPath: firstClause?.sectionPath ?? [],
    estimatedTokens: chunk.estimatedTokens,
    truncated: Boolean(chunk.truncated),
    carriedClauseIds: [...(chunk.carriedClauseIds ?? [])],
  };
}

/**
 * Locates a character offset in a document: page, paragraph and innermost
 * clause. This is what lets the evidence viewer jump from a citation back to
 * the exact place in the source text it was quoted from.
 */
export function locateOffset(content, clauses = [], offset) {
  if (!content || !Number.isInteger(offset)) return null;
  const clause = clauseForOffset(clauses, offset);
  return {
    offset,
    page: offsetToPage(offset, content.pages),
    paragraphIndex: paragraphIndexForOffset(content.text ?? '', offset),
    clauseId: clause?.id ?? null,
    clauseNumber: clause?.number ?? null,
    clauseType: clause?.clauseType ?? 'unknown',
    inRange: offset >= 0 && offset <= (content.charCount ?? content.text?.length ?? 0),
  };
}

