/**
 * Upload validation.
 *
 * The gate in front of the pipeline: type, size and emptiness are checked before
 * a byte is read, and a parse that produced no text is refused rather than turned
 * into an empty workspace.
 */

import { describe, expect, it } from 'vitest';
import {
  UPLOAD_ERROR_CODES,
  UPLOAD_SEVERITY,
  describeParsedContent,
  describeUploadFile,
  describeUploadRules,
  fileExtension,
  fileTypeLabel,
  nonBlockingWarnings,
  validateParsedContent,
  validateUploadFile,
} from '../upload.js';
import { parseTextContent } from '../parser.js';
import { LIMITS } from '../../security/limits.js';

const file = (name, size = 1024, type = '') => ({ name, size, type });

describe('upload: rules and file description', () => {
  it('publishes the same rules it enforces', () => {
    const rules = describeUploadRules();
    expect(rules.maxBytes).toBe(LIMITS.MAX_FILE_BYTES);
    expect(rules.maxPages).toBe(LIMITS.MAX_PAGES);
    expect(rules.accepted).toContain('pdf');
    expect(rules.acceptAttribute).toContain('.pdf');
  });

  it('describes a candidate file without reading it', () => {
    const described = describeUploadFile(file('MSA.PDF', 2048, 'application/pdf'));
    expect(described).toMatchObject({ extension: 'pdf', fileType: 'pdf', supported: true });
    expect(described.fileTypeLabel).toBe('PDF');
    expect(describeUploadFile(null)).toBeNull();
  });

  it('labels file types and extensions readably', () => {
    expect(fileTypeLabel('txt')).toBe('Plain text');
    expect(fileTypeLabel('md')).toBe('Markdown');
    expect(fileTypeLabel('docx')).toBe('Unsupported');
    expect(fileExtension('a.b/c.DOCX')).toBe('docx');
    expect(fileExtension('noextension')).toBe('');
  });
});

describe('upload: file validation', () => {
  it('accepts a supported, non-empty file within the limit', () => {
    const result = validateUploadFile(file('agreement.txt', 4096, 'text/plain'));
    expect(result.ok).toBe(true);
    expect(result.file.fileType).toBe('txt');
  });

  it('refuses a missing file, an unsupported type, an empty file and an oversized file', () => {
    expect(validateUploadFile(null).code).toBe(UPLOAD_ERROR_CODES.NO_FILE);
    expect(validateUploadFile(undefined).code).toBe(UPLOAD_ERROR_CODES.NO_FILE);

    const unsupported = validateUploadFile(file('deed.docx', 1024));
    expect(unsupported.code).toBe(UPLOAD_ERROR_CODES.UNSUPPORTED_TYPE);
    expect(unsupported.message).toContain('deed.docx');
    expect(unsupported.severity).toBe(UPLOAD_SEVERITY.REJECTED);

    // A nameless object cannot be typed either, but it is not "no file".
    expect(validateUploadFile({}).code).toBe(UPLOAD_ERROR_CODES.UNSUPPORTED_TYPE);

    expect(validateUploadFile(file('empty.txt', 0)).code).toBe(UPLOAD_ERROR_CODES.EMPTY_FILE);

    const tooLarge = validateUploadFile(file('huge.pdf', LIMITS.MAX_FILE_BYTES + 1, 'application/pdf'));
    expect(tooLarge.code).toBe(UPLOAD_ERROR_CODES.TOO_LARGE);
    expect(tooLarge.message).toContain('25 MB');
  });

  it('does not throw for any of those cases', () => {
    for (const candidate of [null, {}, file('x.docx'), file('x.txt', 0), file('x.pdf', 1e12)]) {
      expect(() => validateUploadFile(candidate)).not.toThrow();
    }
  });
});

describe('upload: parsed content validation', () => {
  it('accepts text content and reports what was read', () => {
    const content = parseTextContent('1. PAYMENT\n1.1 Pay within 30 days.', { fileName: 'a.txt' });
    const result = validateParsedContent(content);

    expect(result.ok).toBe(true);
    expect(result.metrics).toMatchObject({ pageCount: 1, hasText: true, fileTypeLabel: 'Plain text' });
    expect(result.metrics.charCount).toBeGreaterThan(0);
  });

  it('refuses content with no readable text', () => {
    const content = parseTextContent('', { fileName: 'scan.txt' });
    const result = validateParsedContent(content);

    expect(result.ok).toBe(false);
    expect(result.code).toBe(UPLOAD_ERROR_CODES.NO_TEXT);
    expect(result.message).toMatch(/No readable text/);
  });

  it('explains that a PDF without a text layer is not OCR-ed', () => {
    const content = {
      documentId: 'doc_scan',
      fileName: 'scan.pdf',
      fileType: 'pdf',
      pageCount: 1,
      pages: [{ pageNumber: 1, text: '', charStart: 0, charEnd: 0 }],
      text: '',
      charCount: 0,
      warnings: ['No readable text layer was found; this PDF may be a scan.'],
      metadata: { sourceKind: 'upload' },
    };
    const result = validateParsedContent(content);

    expect(result.ok).toBe(false);
    expect(result.code).toBe(UPLOAD_ERROR_CODES.PDF_NO_TEXT_LAYER);
    expect(result.message).toMatch(/OCR/);
  });

  it('reports an unreadable PDF as unreadable rather than as empty', () => {
    const content = {
      documentId: 'doc_broken',
      fileName: 'broken.pdf',
      fileType: 'pdf',
      pageCount: 0,
      pages: [],
      text: '',
      charCount: 0,
      warnings: ['PDF could not be opened (Invalid PDF structure).'],
      metadata: { sourceKind: 'upload' },
    };
    const result = validateParsedContent(content);

    expect(result.ok).toBe(false);
    expect(result.code).toBe(UPLOAD_ERROR_CODES.PDF_NO_TEXT_LAYER);
    expect(result.message).toContain('Invalid PDF structure');
  });

  it('rejects a missing content object instead of throwing', () => {
    const result = validateParsedContent(null);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(UPLOAD_ERROR_CODES.PARSE_FAILED);
    expect(describeParsedContent(null)).toBeNull();
  });

  it('keeps parser warnings that do not block extraction', () => {
    const content = parseTextContent('Clause text \u0007 here', { fileName: 'a.txt' });
    expect(validateParsedContent(content).ok).toBe(true);
    expect(nonBlockingWarnings(content).length).toBeGreaterThan(0);
    expect(nonBlockingWarnings(null)).toEqual([]);
  });
});
