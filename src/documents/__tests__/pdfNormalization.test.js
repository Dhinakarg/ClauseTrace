/**
 * PDF normalization.
 *
 * PDF text is the messiest input in the app: lines break in the middle of
 * clauses, pages may be unreadable, and a scan may have no text layer at all.
 * These tests pin the normalizing behaviour that the rest of the pipeline relies
 * on: page boundaries become offsets, unreadable pages keep their page number,
 * and offsets inside a page map back to the right page.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPageIndex,
  extractPageText,
  offsetToPage,
  pageForOffset,
  parsePdfArrayBuffer,
  parseTextContent,
  snippetAt,
} from '../parser.js';
import { locateOffset, paragraphIndexForOffset } from '../chunker.js';
import { LIMITS } from '../../security/limits.js';

describe('pdf normalization: page text extraction', () => {
  it('joins PDF text items and preserves line breaks', () => {
    const textContent = {
      items: [
        { str: '1. PAYMENT', hasEOL: true },
        { str: '1.1 The Customer', hasEOL: false },
        { str: 'shall pay', hasEOL: false },
        { str: 'within 30 days.', hasEOL: true },
      ],
    };
    const text = extractPageText(textContent);
    expect(text).toBe('1. PAYMENT\n1.1 The Customer shall pay within 30 days.');
  });

  it('ignores malformed items and empty content', () => {
    expect(extractPageText({ items: [null, { str: 42 }, 'nope'] })).toBe('');
    expect(extractPageText(null)).toBe('');
  });
});

describe('pdf normalization: page index', () => {
  it('builds contiguous page ranges from page texts', () => {
    const { pages, text } = buildPageIndex(['First page.', 'Second page.']);
    expect(pages).toHaveLength(2);
    expect(pages[0].pageNumber).toBe(1);
    expect(pages[1].pageNumber).toBe(2);
    expect(pages[0].charStart).toBe(0);
    expect(pages[1].charStart).toBeGreaterThan(pages[0].charEnd);
    expect(text).toContain('First page.');
    expect(text).toContain('Second page.');
  });

  it('keeps empty pages in the index so page numbers stay truthful', () => {
    const { pages } = buildPageIndex(['Only page.', '', 'Last page.']);
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
    expect(pages[1].text).toBe('');
    expect(pages[1].charStart).toBe(pages[1].charEnd);
  });

  it('maps offsets back to pages, including the boundaries', () => {
    const { pages, text } = buildPageIndex(['Alpha.', 'Beta.']);
    expect(offsetToPage(0, pages)).toBe(1);
    expect(offsetToPage(text.length, pages)).toBe(2);
    expect(pageForOffset(0, pages)?.pageNumber).toBe(1);
    expect(pageForOffset(text.length - 1, pages)?.pageNumber).toBe(2);
    expect(offsetToPage(10, [])).toBeNull();
    expect(offsetToPage(-1, pages)).toBe(1);
    expect(pageForOffset(0, null)).toBeNull();
  });

  it('keeps page markers from a form-feed text file', () => {
    const content = parseTextContent('Page one text.\fPage two text.', { fileName: 'pages.txt' });
    expect(content.pageCount).toBe(2);
    expect(content.text).not.toContain('\f');
    expect(offsetToPage(content.text.indexOf('Page two'), content.pages)).toBe(2);
  });

  it('normalizes whitespace and strips control characters but keeps line structure', () => {
    const raw = '1. HEADING\r\n\r\n1.1 Clause\r\n\r\n\r\n\r\n1.2 Clause\u0007';
    const content = parseTextContent(raw, { fileName: 'crlf.txt' });
    expect(content.text).not.toContain('\r');
    expect(content.text).not.toContain('\u0007');
    expect(content.text).not.toContain('\n\n\n');
    expect(content.text.split('\n')[0]).toBe('1. HEADING');
  });
});

describe('pdf normalization: location metadata', () => {
  const content = parseTextContent('Clause one text.\fClause two text.', { fileName: 'two-pages.txt' });

  it('locates an offset by page and paragraph', () => {
    const offset = content.text.indexOf('Clause two');
    const location = locateOffset(content, [], offset);
    expect(location.page).toBe(2);
    expect(location.paragraphIndex).toBe(paragraphIndexForOffset(content.text, offset));
    expect(location.inRange).toBe(true);
  });

  it('returns null for unusable offsets instead of guessing', () => {
    expect(locateOffset(content, [], null)).toBeNull();
    expect(locateOffset(null, [], 0)).toBeNull();
  });

  it('builds bounded snippets around a match', () => {
    const snippet = snippetAt(content, 0, 5, { maxChars: 12 });
    expect(snippet.length).toBeLessThanOrEqual(13);
    expect(snippetAt(content, null, null)).toBe('');
  });
});

describe('pdf normalization: unreadable input', () => {
  it('reports an unreadable PDF without throwing, and produces no text', async () => {
    const bytes = new TextEncoder().encode('this is not a pdf at all');
    const content = await parsePdfArrayBuffer(bytes.buffer, { fileName: 'broken.pdf' });

    expect(content.fileType).toBe('pdf');
    expect(content.text).toBe('');
    expect(content.charCount).toBe(0);
    expect(content.warnings.length).toBeGreaterThan(0);
    expect(content.documentId).toMatch(/^doc_/);
  });

  it('refuses a PDF beyond the size limit before reading pages', async () => {
    const content = await parsePdfArrayBuffer(new ArrayBuffer(0), {
      fileName: 'huge.pdf',
      byteSize: LIMITS.MAX_FILE_BYTES + 1,
    });
    expect(content.warnings[0]).toMatch(/limit/i);
    expect(content.text).toBe('');
  });
});
