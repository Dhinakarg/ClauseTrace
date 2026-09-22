/**
 * Source view helpers.
 *
 * The workspace's centre pane is only trustworthy if the offsets it highlights
 * are the ones the parser produced. These tests cover the pure mapping layer:
 * blocks, highlights, segments, filters and windows.
 */

import { describe, expect, it } from 'vitest';
import {
  blockWindow,
  buildSourceBlocks,
  clauseHighlight,
  clauseTypeFilters,
  evidenceHighlights,
  filterClauses,
  findBlockIndexForOffset,
  mergeHighlights,
  offsetProgress,
  pageForOffset,
  segmentsForBlock,
  summarizeSource,
} from '../sourceView.js';
import { parseTextContent } from '../../../documents/parser.js';
import { createClausesFromSections, segmentIntoClauses } from '../../../documents/chunker.js';

const TEXT = [
  'PREAMBLE',
  'This Agreement is made between the parties.',
  '',
  '1. PAYMENT',
  '1.1 The Customer shall pay each undisputed invoice within thirty (30) days.',
  '',
  '2. CONFIDENTIALITY',
  '2.1 The Receiving Party shall keep the Confidential Information confidential.',
].join('\n');

const content = parseTextContent(TEXT, { fileName: 'a.txt' });
const clauses = createClausesFromSections(content.documentId, segmentIntoClauses(content).sections);
const blocks = buildSourceBlocks(content, clauses);

describe('sourceView: blocks', () => {
  it('splits the document into annotated paragraphs', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(blocks[0].text).toContain('PREAMBLE');
    expect(blocks[0].page).toBe(1);
    for (const block of blocks) {
      expect(block.endOffset).toBeGreaterThan(block.startOffset);
      expect(block.text).toBe(TEXT.slice(block.startOffset, block.endOffset));
    }
  });

  it('attaches the innermost clause that fully contains each block', () => {
    // A paragraph keeps consecutive lines together, so the "1. PAYMENT" heading
    // and its first clause form one block, owned by the section clause.
    const payment = blocks.find((block) => block.text.includes('1.1 The Customer'));
    expect(payment.clauseType).toBe('payment');
    expect(payment.clauseNumber).toBe('1');
    expect(payment.clauseId).toBeTruthy();
    expect(payment.clauseHeading).toBe('PAYMENT');

    expect(blocks[0].text).toContain('PREAMBLE');
    expect(blocks[0].clauseNumber).toBe(null);
    expect(blocks[0].clauseType).toBe('other');
  });

  it('handles empty content without throwing', () => {
    expect(buildSourceBlocks(null, clauses)).toEqual([]);
    expect(buildSourceBlocks({ text: '' }, clauses)).toEqual([]);
    expect(pageForOffset(content, 0)).toBe(1);
    expect(pageForOffset({ pages: [] }, 0)).toBe(1);
  });

  it('finds the block for an offset', () => {
    const target = TEXT.indexOf('2.1 The Receiving');
    const index = findBlockIndexForOffset(blocks, target);
    expect(blocks[index].text).toContain('2.1 The Receiving');
    expect(findBlockIndexForOffset(blocks, 0)).toBe(0);
    expect(findBlockIndexForOffset([], 0)).toBe(-1);
    expect(findBlockIndexForOffset(blocks, null)).toBe(-1);
  });

  it('keeps long documents manageable with a window', () => {
    const window = blockWindow(blocks, 0, 1);
    expect(window.start).toBe(0);
    expect(window.end).toBeLessThanOrEqual(2);
    expect(window.hiddenAfter).toBeGreaterThan(0);
    expect(blockWindow([], 0)).toEqual({ start: 0, end: 0, hiddenBefore: 0, hiddenAfter: 0 });
  });
});

describe('sourceView: highlights', () => {
  const payment = clauses.find((clause) => clause.number === '1.1');

  it('highlights a clause by its own offsets', () => {
    expect(clauseHighlight(payment)).toEqual({
      startOffset: payment.startOffset,
      endOffset: payment.endOffset,
      kind: 'clause',
    });
    expect(clauseHighlight({ startOffset: 5, endOffset: 5 })).toBeNull();
    expect(clauseHighlight(null)).toBeNull();
  });

  it('turns evidence references into highlights and drops unusable ones', () => {
    const ranges = evidenceHighlights([
      { id: 'e1', startOffset: 10, endOffset: 20, verified: true },
      { id: 'e2', startOffset: 30, endOffset: 30 },
      { id: 'e3' },
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ kind: 'evidence', verified: true, referenceId: 'e1' });
    expect(evidenceHighlights('nope')).toEqual([]);
  });

  it('merges overlapping ranges and lets evidence win', () => {
    const merged = mergeHighlights([
      { startOffset: 0, endOffset: 20, kind: 'clause' },
      { startOffset: 5, endOffset: 12, kind: 'evidence', verified: true },
      { startOffset: 40, endOffset: 50, kind: 'clause' },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      startOffset: 0,
      endOffset: 20,
      kind: 'evidence',
      verified: true,
    });
  });

  it('cuts a block into plain and highlighted segments', () => {
    const block = blocks.find((entry) => entry.text.includes('1.1 The Customer'));
    const segments = segmentsForBlock(block, [
      { startOffset: block.startOffset, endOffset: block.startOffset + 12, kind: 'clause' },
    ]);
    expect(segments[0]).toMatchObject({ highlighted: true, kind: 'clause' });
    expect(segments.map((segment) => segment.text).join('')).toBe(block.text);
  });

  it('returns one plain segment when nothing overlaps', () => {
    const block = blocks[0];
    const segments = segmentsForBlock(block, [{ startOffset: 9000, endOffset: 9001 }]);
    expect(segments).toEqual([
      { text: block.text, highlighted: false, kind: null, verified: false },
    ]);
  });
});

describe('sourceView: filters and summary', () => {
  const countOfType = (type) => clauses.filter((clause) => clause.clauseType === type).length;

  it('counts clause types for the filter chips', () => {
    const filters = clauseTypeFilters(clauses);
    expect(filters.length).toBeGreaterThan(2);
    expect(filters.reduce((total, filter) => total + filter.count, 0)).toBe(clauses.length);
    expect(clauseTypeFilters([])).toEqual([]);
  });

  it('filters by query, type and fact presence', () => {
    const payment = clauses.find((clause) => clause.number === '1.1');
    const factsByClause = new Map([[payment.id, 2]]);

    expect(filterClauses(clauses, { query: 'undisputed' })).toHaveLength(1);
    expect(filterClauses(clauses, { types: ['payment'] }).length).toBe(countOfType('payment'));
    expect(filterClauses(clauses, { onlyWithFacts: true, factsByClause })).toHaveLength(1);
    expect(filterClauses(clauses, { query: 'nothing matches this' })).toEqual([]);
    expect(filterClauses(clauses).length).toBe(clauses.length);
  });

  it('summarizes what was read', () => {
    const stats = summarizeSource(content, clauses, [{}, {}]);
    expect(stats).toMatchObject({
      pageCount: 1,
      clauseCount: clauses.length,
      factCount: 2,
      hasText: true,
    });
    expect(stats.charCount).toBe(content.charCount);
  });

  it('reports progress through the document', () => {
    expect(offsetProgress(content, 0)).toBe(0);
    expect(offsetProgress(content, content.charCount)).toBe(1);
    expect(offsetProgress(content, null)).toBe(0);
    expect(offsetProgress(null, 5)).toBe(0);
  });
});
