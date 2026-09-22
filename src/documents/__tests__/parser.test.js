import { describe, expect, it } from 'vitest';
import {
  buildPageIndex,
  contentFingerprint,
  createDocumentId,
  detectFileType,
  extractPageText,
  findTextMatches,
  isSupportedFile,
  offsetToPage,
  pageForOffset,
  parseTextContent,
  snippetAt,
} from '../parser.js';

const SAMPLE = ['1. PAYMENT', '1.1 The Customer shall pay each invoice within 30 days.', '', '2. TERM', '2.1 This Agreement renews annually.'].join('\n');

describe('parser: file typing', () => {
  it('detects supported types from mime type and extension', () => {
    expect(detectFileType({ type: 'application/pdf', name: 'x' })).toBe('pdf');
    expect(detectFileType({ type: '', name: 'Contract.PDF' })).toBe('pdf');
    expect(detectFileType({ name: 'notes.md' })).toBe('md');
    expect(detectFileType({ name: 'notes.markdown' })).toBe('md');
    expect(detectFileType({ name: 'notes.txt' })).toBe('txt');
    expect(detectFileType({ name: 'notes.docx' })).toBeNull();
    expect(detectFileType(null)).toBeNull();
  });

  it('reports support', () => {
    expect(isSupportedFile({ name: 'a.pdf' })).toBe(true);
    expect(isSupportedFile({ name: 'a.docx' })).toBe(false);
  });

  it('builds a stable document id from name and size', () => {
    expect(createDocumentId('Contract.pdf', 1024)).toBe(createDocumentId('Contract.pdf', 1024));
    expect(createDocumentId('Contract.pdf', 1024)).not.toBe(createDocumentId('Contract.pdf', 2048));
  });
});

describe('parser: text content', () => {
  it('parses text into a single indexed page', () => {
    const content = parseTextContent(SAMPLE, { fileName: 'contract.txt' });
    expect(content.documentId).toBeTruthy();
    expect(content.pageCount).toBe(1);
    expect(content.pages[0].charStart).toBe(0);
    expect(content.pages[0].charEnd).toBe(SAMPLE.length);
    expect(content.charCount).toBe(SAMPLE.length);
    expect(content.warnings).toEqual([]);
    expect(content.metadata.wordCount).toBeGreaterThan(5);
  });

  it('splits pages on form feeds and keeps offsets consistent', () => {
    const content = parseTextContent(`Page one text.\fPage two text.`, { fileName: 'two.txt' });
    expect(content.pageCount).toBe(2);
    expect(content.text).toBe('Page one text.\n\nPage two text.');
    expect(content.pages[1].charStart).toBe('Page one text.'.length + 2);
    expect(offsetToPage(content.pages[1].charStart, content.pages)).toBe(2);
    expect(pageForOffset(0, content.pages).pageNumber).toBe(1);
  });

  it('strips control characters and records the change', () => {
    const content = parseTextContent('Clause\u0007 text\u0000 here', { fileName: 'x.txt' });
    expect(content.text).toBe('Clause text here');
    expect(content.warnings.join(' ')).toMatch(/Control characters/);
  });

  it('warns instead of throwing when there is no readable text', () => {
    const content = parseTextContent('   ', { fileName: 'empty.txt' });
    expect(content.text).toBe('');
    expect(content.pageCount).toBe(0);
    expect(content.warnings[0]).toMatch(/No readable text/);
  });

  it('builds a page index from raw page strings', () => {
    const { pages, text } = buildPageIndex(['one', 'two']);
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(text).toBe('one\n\ntwo');
  });
});

describe('parser: pdf text extraction helpers', () => {
  it('flattens PDF.js text items and preserves line breaks', () => {
    const text = extractPageText({
      items: [
        { str: '1. PAYMENT', hasEOL: true },
        { str: '1.1 ' },
        { str: 'Payment due in 30 days.' },
      ],
    });
    expect(text).toBe('1. PAYMENT\n1.1 Payment due in 30 days.');
  });

  it('handles empty or malformed text content', () => {
    expect(extractPageText(null)).toBe('');
    expect(extractPageText({ items: [{}] })).toBe('');
  });
});

describe('parser: search and snippets', () => {
  it('finds every occurrence with a page and excerpt', () => {
    const content = parseTextContent(SAMPLE, { fileName: 'contract.txt' });
    const matches = findTextMatches(content, 'invoice');
    expect(matches).toHaveLength(1);
    expect(matches[0].page).toBe(1);
    expect(matches[0].excerpt).toMatch(/invoice/);
    expect(findTextMatches(content, '')).toEqual([]);
    expect(findTextMatches(content, 'missing-term')).toEqual([]);
  });

  it('respects the result limit', () => {
    const content = parseTextContent('pay pay pay pay', { fileName: 'x.txt' });
    expect(findTextMatches(content, 'pay', { limit: 2 })).toHaveLength(2);
  });

  it('extracts a snippet around a range', () => {
    const content = parseTextContent(SAMPLE, { fileName: 'x.txt' });
    const start = content.text.indexOf('30 days');
    expect(snippetAt(content, start, start + 7)).toBe('30 days');
    expect(snippetAt(content, null, null)).toBe('');
  });

  it('fingerprints content consistently', () => {
    const first = parseTextContent(SAMPLE, { fileName: 'x.txt' });
    const second = parseTextContent(SAMPLE, { fileName: 'x.txt' });
    expect(contentFingerprint(first)).toBe(contentFingerprint(second));
    expect(contentFingerprint(first)).not.toBe(
      contentFingerprint(parseTextContent(`${SAMPLE} extra`, { fileName: 'x.txt' })),
    );
  });
});
