/**
 * Upload rules.
 *
 * Ingestion starts with a gate, not with a parse. `validateUploadFile` decides
 * whether a file may enter the pipeline at all, and `validateParsedContent`
 * decides whether the parser actually produced something analysable. Both are
 * pure and return reasons instead of throwing, so the UI can explain a rejected
 * file instead of showing an empty document.
 */

import { SUPPORTED_FILE_TYPES, detectFileType } from './parser.js';
import { LIMITS, byteLength } from '../security/limits.js';

/** Reasons an upload or a parse can be refused, with stable codes. */
export const UPLOAD_ERROR_CODES = Object.freeze({
  NO_FILE: 'upload.no-file',
  UNSUPPORTED_TYPE: 'upload.unsupported-type',
  TOO_LARGE: 'upload.too-large',
  EMPTY_FILE: 'upload.empty-file',
  UNREADABLE: 'upload.unreadable',
  NO_TEXT: 'upload.no-text',
  TEXT_TRUNCATED: 'upload.text-truncated',
  PDF_NO_TEXT_LAYER: 'upload.pdf-no-text-layer',
  PDF_UNREADABLE: 'upload.pdf-unreadable',
  PARSE_FAILED: 'upload.parse-failed',
});

export const UPLOAD_SEVERITY = Object.freeze({
  REJECTED: 'rejected',
  WARNING: 'warning',
});

/** Human-readable file type label used by the dropzone and the report. */
export function fileTypeLabel(fileType) {
  if (fileType === 'pdf') return 'PDF';
  if (fileType === 'md' || fileType === 'markdown') return 'Markdown';
  if (fileType === 'txt' || fileType === 'text') return 'Plain text';
  return 'Unsupported';
}

/** File extension of a name, lowercased and without the dot. */
export function fileExtension(fileName) {
  const match = String(fileName ?? '').match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

/** The rules the UI displays verbatim, so it cannot drift from enforcement. */
export function describeUploadRules() {
  return {
    accepted: [...SUPPORTED_FILE_TYPES],
    acceptAttribute: '.pdf,.txt,.md,.markdown,text/plain,application/pdf',
    maxBytes: LIMITS.MAX_FILE_BYTES,
    maxPages: LIMITS.MAX_PAGES,
    maxTextChars: LIMITS.MAX_TEXT_CHARS,
    maxMegabytes: Math.round(LIMITS.MAX_FILE_BYTES / (1024 * 1024)),
  };
}

/** Compact description of a candidate file for the UI, without reading it. */
export function describeUploadFile(file) {
  if (!file) return null;
  const fileName = file.name ?? 'document';
  const fileType = detectFileType(file);
  return {
    name: fileName,
    sizeBytes: file.size ?? 0,
    declaredType: file.type ?? '',
    extension: fileExtension(fileName),
    fileType,
    fileTypeLabel: fileTypeLabel(fileType),
    supported: Boolean(fileType),
  };
}

/**
 * Validates a candidate upload before it is read.
 * Returns { ok, code, message, severity, file, rules }.
 */
export function validateUploadFile(file, { limits = LIMITS } = {}) {
  const described = describeUploadFile(file);
  const rules = describeUploadRules();

  const reject = (code, message) => ({
    ok: false,
    code,
    message,
    severity: UPLOAD_SEVERITY.REJECTED,
    file: described,
    rules,
  });

  if (!described) {
    return reject(UPLOAD_ERROR_CODES.NO_FILE, 'No file was provided.');
  }
  if (!described.supported) {
    return reject(
      UPLOAD_ERROR_CODES.UNSUPPORTED_TYPE,
      `"${described.name}" is not a supported file type. ClauseGraph reads PDF, TXT and Markdown documents.`,
    );
  }
  if (described.sizeBytes === 0) {
    return reject(
      UPLOAD_ERROR_CODES.EMPTY_FILE,
      `"${described.name}" is empty, so there is nothing to read.`,
    );
  }
  if (described.sizeBytes > limits.MAX_FILE_BYTES) {
    return reject(
      UPLOAD_ERROR_CODES.TOO_LARGE,
      `"${described.name}" is ${Math.round(described.sizeBytes / (1024 * 1024))} MB; the limit is ${rules.maxMegabytes} MB.`,
    );
  }

  return { ok: true, code: null, message: null, severity: null, file: described, rules };
}

/** Describes what the parser produced, for the "text extracted" stage. */
export function describeParsedContent(content) {
  if (!content) return null;
  return {
    documentId: content.documentId ?? null,
    fileName: content.fileName ?? null,
    fileType: content.fileType ?? null,
    fileTypeLabel: fileTypeLabel(content.fileType),
    pageCount: content.pageCount ?? 0,
    charCount: content.charCount ?? 0,
    wordCount: content.metadata?.wordCount ?? null,
    byteSize: content.metadata?.byteSize ?? null,
    warnings: [...(content.warnings ?? [])],
    hasText: typeof content.text === 'string' && content.text.trim().length > 0,
    truncated: Boolean(
      typeof content.text === 'string' && content.text.length >= LIMITS.MAX_TEXT_CHARS,
    ),
    textBytes: byteLength(content.text ?? ''),
  };
}

/**
 * Validates normalized content after parsing.
 * Returns { ok, code, message, severity, metrics, warnings }.
 * A document with no text is rejected: an empty workspace would imply the
 * document says nothing, which is a different claim from "we could not read it".
 */
export function validateParsedContent(content, { limits = LIMITS } = {}) {
  const metrics = describeParsedContent(content);
  if (!metrics) {
    return {
      ok: false,
      code: UPLOAD_ERROR_CODES.PARSE_FAILED,
      message: 'The document could not be parsed.',
      severity: UPLOAD_SEVERITY.REJECTED,
      metrics: null,
      warnings: [],
    };
  }

  const warnings = [...metrics.warnings];
  const pdfWarning = warnings.find((warning) => /could not be opened|PDF engine/.test(warning));

  if (!metrics.hasText) {
    const isPdf = metrics.fileType === 'pdf';
    return {
      ok: false,
      code: isPdf ? UPLOAD_ERROR_CODES.PDF_NO_TEXT_LAYER : UPLOAD_ERROR_CODES.NO_TEXT,
      message: pdfWarning
        ? `${metrics.fileName ?? 'This PDF'} could not be read: ${pdfWarning}`
        : isPdf
          ? 'This PDF has no readable text layer. A scan would need OCR, which ClauseGraph does not perform.'
          : 'No readable text was found in this document.',
      severity: UPLOAD_SEVERITY.REJECTED,
      metrics,
      warnings,
    };
  }

  if (metrics.charCount > limits.MAX_TEXT_CHARS) {
    return {
      ok: false,
      code: UPLOAD_ERROR_CODES.TEXT_TRUNCATED,
      message: 'The document text is larger than this workspace can hold.',
      severity: UPLOAD_SEVERITY.REJECTED,
      metrics,
      warnings,
    };
  }

  return { ok: true, code: null, message: null, severity: null, metrics, warnings };
}

/** Warnings the pipeline surfaces as notices without blocking extraction. */
export function nonBlockingWarnings(content) {
  if (!content) return [];
  return (content.warnings ?? []).filter((warning) => !/^No readable text/.test(warning));
}
