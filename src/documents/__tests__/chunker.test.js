import { describe, expect, it } from 'vitest';
import {
  buildClauseTree,
  chunkDocument,
  createClausesFromSections,
  detectCrossReferences,
  detectHeading,
  estimateTokens,
  prepareChunks,
  segmentIntoClauses,
  summarizeChunks,
} from '../chunker.js';
import { parseTextContent } from '../parser.js';

const AGREEMENT = [
  'MASTER SERVICES AGREEMENT',
  'This agreement is made between the parties.',
  '1. DEFINITIONS',
  '1.1 "Services" means the services described in Schedule 1.',
  '1.2 "Business Day" means a day other than a weekend.',
  '2. PAYMENT',
  '2.1 The Customer shall pay each invoice within 30 days of the invoice date.',
  '2.2 Late amounts accrue interest as set out in clause 3.1.',
  '3. LIABILITY',
  '3.1 Liability is limited as set out in clause 2.1.',
  'SCHEDULE 1',
  'The services comprise hosting and support.',
].join('\n');

const content = parseTextContent(AGREEMENT, { fileName: 'msa.txt' });

describe('chunker: headings', () => {
  it('recognises numbered, article, section and schedule headings', () => {
    expect(detectHeading('1. DEFINITIONS')).toMatchObject({ number: '1', level: 1 });
    expect(detectHeading('1.1 "Services" means')).toMatchObject({ number: '1.1', level: 2 });
    expect(detectHeading('Article 5 - Termination')).toMatchObject({ number: '5', level: 1 });
    expect(detectHeading('Section 4.2 Confidentiality')).toMatchObject({ number: '4.2' });
    expect(detectHeading('SCHEDULE 1')).toMatchObject({ level: 1 });
  });

  it('ignores ordinary sentences', () => {
    expect(detectHeading('The Customer shall pay each invoice within 30 days.')).toBeNull();
    expect(detectHeading('')).toBeNull();
  });
});

describe('chunker: segmentation', () => {
  it('segments the document into clause-like sections with offsets', () => {
    const { sections, coverage } = segmentIntoClauses(content);
    const numbers = sections.map((section) => section.number);
    expect(numbers).toContain('1');
    expect(numbers).toContain('1.1');
    expect(numbers).toContain('2.1');
    expect(sections.length).toBeGreaterThan(6);
    const first = sections[0];
    expect(first.startOffset).toBeGreaterThanOrEqual(0);
    expect(first.endOffset).toBeGreaterThan(first.startOffset);
    expect(coverage.attributedChars).toBeGreaterThan(0);
    expect(coverage.totalChars).toBe(content.charCount);
  });

  it('keeps paragraphs attached to the heading above them', () => {
    const { sections } = segmentIntoClauses(content);
    const payment = sections.find((section) => section.number === '2.1');
    expect(payment.text).toMatch(/within 30 days/);
  });

  it('tolerates empty content', () => {
    const empty = parseTextContent('', { fileName: 'x.txt' });
    expect(segmentIntoClauses(empty).sections).toEqual([]);
  });
});

describe('chunker: clause construction', () => {
  const { sections } = segmentIntoClauses(content);
  const clauses = createClausesFromSections(content.documentId, sections);

  it('creates clauses with stable ids, numbers and parent links', () => {
    expect(clauses.length).toBe(sections.length);
    expect(new Set(clauses.map((clause) => clause.id)).size).toBe(clauses.length);
    const child = clauses.find((clause) => clause.number === '1.1');
    const parent = clauses.find((clause) => clause.number === '1');
    expect(child.parentClauseId).toBe(parent.id);
    expect(parent.childClauseIds).toContain(child.id);
    const again = createClausesFromSections(content.documentId, sections);
    expect(again.map((clause) => clause.id)).toEqual(clauses.map((clause) => clause.id));
  });

  it('detects cross references between clauses', () => {
    const liability = clauses.find((clause) => clause.number === '3.1');
    const payment = clauses.find((clause) => clause.number === '2.1');
    expect(liability.crossReferences).toContain(payment.id);
    expect(detectCrossReferences('see clause 99.9', new Map())).toEqual([]);
  });

  it('builds a depth-first tree', () => {
    const tree = buildClauseTree(clauses);
    expect(tree.ordered.length).toBe(clauses.length);
    expect(tree.roots.length).toBeGreaterThan(0);
  });
});

describe('chunker: chunks', () => {
  it('estimates tokens from characters', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('')).toBe(0);
  });

  it('keeps every chunk within the character budget', () => {
    const clauses = createClausesFromSections(
      content.documentId,
      segmentIntoClauses(content).sections,
    );
    const { chunks } = chunkDocument(content, { clauses, maxChars: 120 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(chunk.text.length).toBeLessThanOrEqual(120);
      expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
      expect(chunk.clauseIds.length).toBeGreaterThan(0);
    });
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
  });

  it('flags an oversized clause instead of silently cutting it', () => {
    const long = parseTextContent(`1. HEAD\n1.1 ${'word '.repeat(200)}`, { fileName: 'long.txt' });
    const { chunks, truncatedChunks } = chunkDocument(long, { maxChars: 200 });
    expect(truncatedChunks).toBe(1);
    expect(chunks[0].truncated).toBe(true);
  });

  it('returns no chunks for empty content', () => {
    expect(chunkDocument(null).chunks).toEqual([]);
    expect(chunkDocument(parseTextContent('', { fileName: 'x.txt' })).chunks).toEqual([]);
  });

  it('optionally repeats the previous chunk clauses', () => {
    const clauses = createClausesFromSections(
      content.documentId,
      segmentIntoClauses(content).sections,
    );
    const { chunks } = chunkDocument(content, { clauses, maxChars: 120, overlapClauses: 1 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(Array.isArray(chunks[1].carriedClauseIds)).toBe(true);
  });

  it('prepares clauses, chunks and stats in one pass', () => {
    const prepared = prepareChunks(content, { maxChars: 200 });
    expect(prepared.clauses.length).toBeGreaterThan(0);
    expect(prepared.chunks.length).toBeGreaterThan(0);
    expect(prepared.stats.clauseCount).toBe(prepared.clauses.length);
    expect(prepared.stats.chunkCount).toBe(prepared.chunks.length);
    expect(prepared.stats.totalTokens).toBeGreaterThan(0);
    expect(prepared.coverage.totalChars).toBe(content.charCount);
  });

  it('produces a compact chunk summary', () => {
    const prepared = prepareChunks(content, { maxChars: 200 });
    const summary = summarizeChunks(prepared.chunks);
    expect(summary).toHaveLength(prepared.chunks.length);
    expect(summary[0].preview.length).toBeLessThanOrEqual(141);
  });
});
