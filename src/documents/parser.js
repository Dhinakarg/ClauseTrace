/**
 * Document parser.
 *
 * Converts an uploaded file (PDF / plain text / markdown) into normalized
 * `DocumentContent`:
 *   {
 *     documentId, fileName, fileType, pageCount,
 *     pages: [{ pageNumber, text, charStart, charEnd }],
 *     text, charCount, warnings, metadata
 *   }
 *
 * The parser is deliberately dumb: no legal interpretation happens here. It
 * only extracts readable text, keeps page/offset coordinates so evidence can be
 * verified later, and reports what it could not read.
 *
 * PDF.js is imported lazily so text-only flows (and Node tests) never load it.
 */

import { LIMITS, checkSize, sanitizeUntrustedText, truncateText } from '../security/limits.js';
import { createEntityId, slugify, stableHash } from '../legal/schema.js';

export const SUPPORTED_FILE_TYPES = Object.freeze(['pdf', 'txt', 'md', 'text']);

const MIME_TO_TYPE = Object.freeze({
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
});

/** Stable document id from the file identity, so re-uploading reuses the id. */
export function createDocumentId(fileName, byteSize = 0) {
  return createEntityId('document', `${slugify(fileName, 'document')}:${byteSize}`);
}

/** Detects the file type from MIME type first, then extension. */
export function detectFileType(file) {
  if (!file) return null;
  const mime = String(file.type ?? '').toLowerCase();
  if (MIME_TO_TYPE[mime]) return MIME_TO_TYPE[mime];
  const name = String(file.name ?? '').toLowerCase();
  const extension = name.includes('.') ? name.split('.').pop() : '';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'md' || extension === 'markdown') return 'md';
  if (extension === 'txt' || extension === 'text') return 'txt';
  return null;
}

export function isSupportedFile(file) {
  return SUPPORTED_FILE_TYPES.includes(detectFileType(file));
}

/** Maps a character offset in the combined text back to a page number. */
export function offsetToPage(offset, pages) {
  if (!Number.isFinite(offset) || !Array.isArray(pages) || pages.length === 0) return null;
  let match = pages[0]?.pageNumber ?? null;
  for (const page of pages) {
    if (offset >= page.charStart && offset <= page.charEnd) return page.pageNumber;
    if (offset > page.charEnd) match = page.pageNumber;
  }
  return match;
}

/** Returns the page object containing an offset (or the closest earlier page). */
export function pageForOffset(offset, pages) {
  if (!Array.isArray(pages) || pages.length === 0) return null;
  let candidate = pages[0];
  for (const page of pages) {
    if (Number.isFinite(offset) && offset >= page.charStart) candidate = page;
  }
  return candidate;
}

/** Extracts a snippet around an offset — used for evidence previews. */
export function snippetAt(content, startOffset, endOffset, { maxChars = 400 } = {}) {
  const text = content?.text ?? '';
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) return '';
  const start = Math.max(0, startOffset);
  const end = Math.min(text.length, Math.max(endOffset, start + 1));
  return truncateText(text.slice(start, end).replace(/\s+/g, ' ').trim(), maxChars);
}

/**
 * Joins page texts into one document string while recording each page's
 * character range. Offsets are what make evidence verification possible.
 */
export function buildPageIndex(pageTexts) {
  const pages = [];
  let cursor = 0;
  pageTexts.forEach((rawText, index) => {
    const text = String(rawText ?? '');
    const charStart = cursor;
    const charEnd = charStart + text.length;
    pages.push({ pageNumber: index + 1, text, charStart, charEnd });
    // Two newlines form the page separator and are included in the offset run.
    cursor = charEnd + 2;
  });
  const text = pages.map((page) => page.text).join('\n\n');
  return { pages, text };
}

function emptyContent(documentId, fileName, fileType) {
  return {
    documentId,
    fileName,
    fileType,
    pageCount: 0,
    pages: [],
    text: '',
    charCount: 0,
    warnings: [],
    metadata: {},
  };
}

/**
 * Parses already-extracted text (plain text files, pasted text, demo data).
 * `pageBreakMarker` (default form feed) splits pages when present.
 */
export function parseTextContent(
  rawText,
  {
    fileName = 'document.txt',
    documentId = null,
    fileType = 'txt',
    byteSize = 0,
    pageBreakMarker = '\f',
  } = {},
) {
  const id = documentId ?? createDocumentId(fileName, byteSize || String(rawText ?? '').length);
  const content = emptyContent(id, fileName, fileType);
  const sanitized = sanitizeUntrustedText(rawText, { maxLength: LIMITS.MAX_TEXT_CHARS });
  if (sanitized.truncated) {
    content.warnings.push(
      `Document text was truncated at the ${LIMITS.MAX_TEXT_CHARS.toLocaleString()} character limit.`,
    );
  }
  if (sanitized.removedControlCharacters) {
    content.warnings.push('Control characters were removed from the extracted text.');
  }
  if (!sanitized.text) {
    content.warnings.push('No readable text was found in this document.');
    return content;
  }

  const rawPages = sanitized.text.split(pageBreakMarker);
  const { pages, text } = buildPageIndex(rawPages);
  content.pages = pages;
  content.text = text;
  content.charCount = text.length;
  content.pageCount = pages.length;
  content.metadata = {
    sourceKind: 'text',
    byteSize: byteSize || text.length,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    parsedAt: new Date().toISOString(),
  };
  return content;
}

/** Flattens PDF.js text items into a page string, preserving line breaks. */
export function extractPageText(textContent) {
  const items = Array.isArray(textContent?.items) ? textContent.items : [];
  let output = '';
  for (const item of items) {
    if (typeof item?.str !== 'string') continue;
    output += item.str;
    if (item.hasEOL) output += '\n';
    else if (!item.str.endsWith(' ')) output += ' ';
  }
  return output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parses a PDF from an ArrayBuffer using PDF.js (lazy import).
 * Unreadable pages are recorded as warnings with empty text so offsets stay
 * aligned with page numbers rather than silently shifting.
 */
export async function parsePdfArrayBuffer(
  arrayBuffer,
  { fileName = 'document.pdf', documentId = null, byteSize = 0, onProgress = null } = {},
) {
  const bytes = byteSize || arrayBuffer?.byteLength || 0;
  const id = documentId ?? createDocumentId(fileName, bytes);
  const content = emptyContent(id, fileName, 'pdf');
  content.metadata = { sourceKind: 'upload', byteSize: bytes };

  const sizeCheck = checkSize(bytes);
  if (!sizeCheck.ok) {
    content.warnings.push(sizeCheck.message);
    return content;
  }

  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist');
    const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    if (workerModule?.default) pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  } catch (error) {
    content.warnings.push(
      `PDF engine could not be loaded (${error?.message ?? 'unknown error'}). PDF text extraction is unavailable.`,
    );
    return content;
  }

  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false }).promise;
  } catch (error) {
    content.warnings.push(`PDF could not be opened (${error?.message ?? 'unknown error'}).`);
    return content;
  }

  const pageLimit = Math.min(pdf.numPages, LIMITS.MAX_PAGES);
  if (pdf.numPages > LIMITS.MAX_PAGES) {
    content.warnings.push(
      `Document has ${pdf.numPages} pages; only the first ${LIMITS.MAX_PAGES} were read.`,
    );
  }

  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    try {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      pageTexts.push(
        sanitizeUntrustedText(extractPageText(textContent), { maxLength: LIMITS.MAX_TEXT_CHARS }).text,
      );
    } catch (error) {
      pageTexts.push('');
      content.warnings.push(`Page ${pageNumber} could not be read (${error?.message ?? 'unknown error'}).`);
    }
    if (typeof onProgress === 'function') {
      onProgress({ pageNumber, pageCount: pageLimit, ratio: pageNumber / pageLimit });
    }
  }

  const { pages, text } = buildPageIndex(pageTexts);
  const clipped = truncateText(text, LIMITS.MAX_TEXT_CHARS, { suffix: '' });
  content.pages = pages;
  content.text = clipped;
  content.charCount = clipped.length;
  content.pageCount = pages.length;
  if (!clipped) content.warnings.push('No readable text layer was found; this PDF may be a scan.');
  if (clipped.length < text.length) {
    content.warnings.push('Extracted text was truncated to the supported maximum length.');
  }
  content.metadata = {
    ...content.metadata,
    wordCount: clipped.split(/\s+/).filter(Boolean).length,
    parsedAt: new Date().toISOString(),
  };
  return content;
}

/** Parses a File/Blob from an <input type="file"> or the demo loader. */
export async function parseDocumentFile(file, options = {}) {
  const fileName = file?.name ?? 'document';
  const fileType = detectFileType(file);
  if (!fileType) {
    return {
      ...emptyContent(options.documentId ?? createDocumentId(fileName), fileName, null),
      warnings: ['Unsupported file type. ClauseGraph reads PDF, TXT and Markdown documents.'],
    };
  }

  const byteSize = file.size ?? 0;
  const sizeCheck = checkSize(byteSize);
  if (!sizeCheck.ok) {
    return {
      ...emptyContent(options.documentId ?? createDocumentId(fileName, byteSize), fileName, fileType),
      warnings: [sizeCheck.message],
    };
  }

  if (fileType === 'pdf') {
    const buffer = await file.arrayBuffer();
    return parsePdfArrayBuffer(buffer, { fileName, byteSize, ...options });
  }

  const raw = await file.text();
  return parseTextContent(raw, { fileName, fileType, byteSize, ...options });
}

/** Substring search helper used by the search and ask surfaces. */
export function findTextMatches(content, query, { limit = 50, caseSensitive = false } = {}) {
  const text = content?.text ?? '';
  const needle = String(query ?? '');
  if (!text || !needle) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const target = caseSensitive ? needle : needle.toLowerCase();
  const matches = [];
  let index = haystack.indexOf(target);
  while (index !== -1 && matches.length < limit) {
    matches.push({
      startOffset: index,
      endOffset: index + target.length,
      page: offsetToPage(index, content.pages),
      excerpt: snippetAt(content, index, index + target.length + 160),
    });
    index = haystack.indexOf(target, index + Math.max(1, target.length));
  }
  return matches;
}

/** Stable fingerprint of parsed content, used to detect re-uploads. */
export function contentFingerprint(content) {
  return stableHash(
    `${content?.documentId ?? ''}:${content?.charCount ?? 0}:${(content?.text ?? '').slice(0, 512)}`,
  );
}
