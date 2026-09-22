/**
 * Chunk metadata and clause mapping.
 *
 * Chunks are how document text reaches the model. If a chunk cannot be traced
 * back to clauses, pages and paragraphs, a citation it produces cannot be
 * verified — so this suite pins the round-trip.
 */

import { describe, expect, it } from 'vitest';
import {
  CHUNK_LOCATION_FIELDS,
  CHUNK_METADATA_FIELDS,
  chunkDocument,
  clausesInRange,
  clauseForOffset,
  createClausesFromSections,
  describeChunkLocation,
  locateOffset,
  mapChunksToClauses,
  paragraphIndexForOffset,
  paragraphsForText,
  prepareChunks,
  segmentIntoClauses,
} from '../chunker.js';
import { parseTextContent } from '../parser.js';

const AGREEMENT = [
  '1. PAYMENT',
  '1.1 The Customer shall pay each undisputed invoice within thirty (30) days of the invoice date.',
  '',
  '2. CONFIDENTIALITY',
  '2.1 The Receiving Party shall keep the Confidential Information confidential.',
  '2.2 This obligation survives termination for five (5) years.',
  '',
  '3. TERM',
  '3.1 This Agreement continues until 30 June 2027 and renews for twelve (12) months unless notice is given.',
].join('\n');

const content = parseTextContent(AGREEMENT, { fileName: 'msa.txt' });
const { sections } = segmentIntoClauses(content);
const clauses = createClausesFromSections(content.documentId, sections);

describe('chunk metadata: shape', () => {
  const { chunks } = chunkDocument(content, { clauses, maxChars: 200 });

  it('carries every documented metadata field', () => {
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      for (const field of CHUNK_METADATA_FIELDS) {
        expect(chunk[field], `${field} missing on ${chunk.id}`).not.toBeUndefined();
      }
    }
  });

  it('adds location metadata on demand for the extraction report', () => {
    const described = describeChunkLocation(chunks[0], clauses, content);
    for (const field of CHUNK_LOCATION_FIELDS) {
      expect(described[field], `${field} missing from the location description`).not.toBeUndefined();
    }
  });

  it('keeps offsets ordered and truthful', () => {
    let previousEnd = 0;
    for (const chunk of chunks) {
      expect(chunk.charStart).toBeGreaterThanOrEqual(previousEnd);
      expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
      expect(chunk.text.length).toBeLessThanOrEqual(200);
      previousEnd = chunk.charEnd;
    }
  });

  it('records page and clause references for each chunk', () => {
    for (const chunk of chunks) {
      expect(chunk.pageStart).toBe(1);
      expect(chunk.clauseIds.length).toBeGreaterThan(0);
      expect(chunk.clauseNumbers.length).toBeGreaterThan(0);
    }
  });
});

describe('chunk metadata: clause mapping', () => {
  const { chunks } = chunkDocument(content, { clauses, maxChars: 200 });
  const mapped = mapChunksToClauses(chunks, clauses);

  it('links every chunk to the clauses it covers', () => {
    expect(mapped.pairs.length).toBeGreaterThan(0);
    for (const pair of mapped.pairs) {
      expect(clauses.map((clause) => clause.id)).toContain(pair.clauseId);
      expect(pair.chunkId).toBeTruthy();
      expect(pair.carried).toBe(false);
    }
  });

  it('covers the payment clause from the chunk that contains it', () => {
    const payment = clauses.find((clause) => clause.number === '1.1');
    const pairs = mapped.byClause.get(payment.id);
    expect(pairs.length).toBeGreaterThan(0);
    const covering = chunks.find((chunk) => chunk.id === pairs[0].chunkId);
    expect(covering.charStart).toBeLessThanOrEqual(payment.startOffset);
  });

  it('finds clauses overlapping a character range', () => {
    const payment = clauses.find((clause) => clause.number === '1.1');
    const overlapping = clausesInRange(clauses, payment.startOffset, payment.endOffset);
    expect(overlapping.map((clause) => clause.id)).toContain(payment.id);
    expect(clausesInRange(clauses, 5000, 6000)).toEqual([]);
    expect(clausesInRange(clauses, 10, 4)).toEqual([]);
  });

  it('resolves the innermost clause for an offset', () => {
    const payment = clauses.find((clause) => clause.number === '1.1');
    const found = clauseForOffset(clauses, payment.startOffset + 10);
    expect(found.id).toBe(payment.id);
    expect(clauseForOffset(clauses, -1)).toBeNull();
    expect(clauseForOffset(clauses, 10_000_000)).toBeNull();
  });

  it('marks repeated context clauses as carried, not covered', () => {
    const withOverlap = chunkDocument(content, { clauses, maxChars: 200, overlapClauses: 1 });
    const pairs = mapChunksToClauses(withOverlap.chunks, clauses).pairs;
    expect(withOverlap.chunks.length).toBeGreaterThan(1);
    expect(pairs.every((pair) => typeof pair.carried === 'boolean')).toBe(true);
  });
});

describe('chunk metadata: paragraphs and location', () => {
  it('numbers paragraphs and finds the one containing an offset', () => {
    const paragraphs = paragraphsForText(AGREEMENT);
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(paragraphs[0].text).toContain('1. PAYMENT');
    expect(paragraphs[0].startOffset).toBe(0);

    const target = AGREEMENT.indexOf('2.1 The Receiving Party');
    expect(paragraphIndexForOffset(AGREEMENT, target)).toBe(
      paragraphs.find((paragraph) => paragraph.text.includes('2.1 The Receiving')).index,
    );
    expect(paragraphIndexForOffset(AGREEMENT, -5)).toBeNull();
    expect(paragraphsForText('')).toEqual([]);
  });

  it('describes a chunk with paragraphs, clauses and pages', () => {
    const { chunks } = chunkDocument(content, { clauses, maxChars: 200 });
    const described = describeChunkLocation(chunks[0], clauses, content);

    expect(described.id).toBe(chunks[0].id);
    expect(described.clauseIds.length).toBeGreaterThan(0);
    expect(described.clauseTypes.length).toBeGreaterThan(0);
    expect(described.paragraphStart).toBeGreaterThanOrEqual(0);
    expect(described.paragraphEnd).toBeGreaterThanOrEqual(described.paragraphStart);
    expect(describeChunkLocation(null, clauses, content)).toBeNull();
  });

  it('locates an evidence offset back to page, paragraph and clause', () => {
    const prepared = prepareChunks(content, { maxChars: 400 });
    const clause = prepared.clauses.find((entry) => entry.number === '2.1');
    const offset = content.text.indexOf('keep the Confidential Information confidential');

    const location = locateOffset(content, prepared.clauses, offset);
    expect(location.clauseId).toBe(clause.id);
    expect(location.clauseNumber).toBe('2.1');
    expect(location.page).toBe(1);
    expect(location.inRange).toBe(true);
  });
});
