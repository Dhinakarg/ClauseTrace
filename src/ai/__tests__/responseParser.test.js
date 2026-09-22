import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_COLLECTIONS,
  coerceEnum,
  coerceISODate,
  coerceNumber,
  coerceString,
  coerceStringArray,
  countDraftItems,
  normalizeDraftEvidence,
  normalizeDraftEvidenceList,
  normalizeExtractionDraft,
  parseProviderJson,
} from '../responseParser.js';
import { PARTY_ROLES } from '../../legal/schema.js';

describe('responseParser: JSON extraction', () => {
  it('parses a clean JSON object', () => {
    const parsed = parseProviderJson('{"parties":[]}');
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual({ parties: [] });
  });

  it('strips markdown fences and surrounding prose', () => {
    const parsed = parseProviderJson(
      'Here is the result:\n```json\n{"parties":[]}\n```\nHope that helps.',
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.notes.map((note) => note.code)).toContain('response.fence-stripped');
  });

  it('repairs trailing commas and smart quotes', () => {
    const parsed = parseProviderJson('{ "title": \u201cHi\u201d, "parties": [], }');
    expect(parsed.value.title).toBe('Hi');
  });

  it('fails cleanly on unusable responses', () => {
    expect(parseProviderJson('').ok).toBe(false);
    expect(parseProviderJson('no json here').ok).toBe(false);
    expect(parseProviderJson('{ broken: ').ok).toBe(false);
    expect(parseProviderJson('x'.repeat(2_000_001)).error).toMatch(/limit/);
  });
});

describe('responseParser: coercion', () => {
  it('coerces strings, trimming and capping length', () => {
    expect(coerceString('  hello  ')).toBe('hello');
    expect(coerceString(42)).toBe('42');
    expect(coerceString({})).toBeNull();
    expect(coerceString('')).toBeNull();
    expect(coerceString('abcdef', { maxLength: 3 })).toBe('abc');
  });

  it('coerces enums against the controlled vocabulary', () => {
    expect(coerceEnum('CUSTOMER', PARTY_ROLES)).toBe('customer');
    expect(coerceEnum('nonsense', PARTY_ROLES)).toBe('unknown');
    expect(coerceEnum(null, PARTY_ROLES)).toBe('unknown');
  });

  it('coerces numbers with bounds', () => {
    expect(coerceNumber('5')).toBe(5);
    expect(coerceNumber('5.7', { integer: true })).toBe(5);
    expect(coerceNumber(-1, { min: 0 })).toBeNull();
    expect(coerceNumber('abc')).toBeNull();
  });

  it('accepts only ISO dates', () => {
    expect(coerceISODate('2026-01-31')).toBe('2026-01-31');
    expect(coerceISODate('31/01/2026')).toBeNull();
    expect(coerceISODate('2026-13-45')).toBeNull();
  });

  it('coerces string arrays with limits', () => {
    expect(coerceStringArray(['a', 'b'], { maxItems: 1 })).toEqual(['a']);
    expect(coerceStringArray('nope')).toEqual([]);
  });
});

describe('responseParser: evidence', () => {
  it('normalizes a usable evidence entry', () => {
    const entry = normalizeDraftEvidence(
      {
        clauseNumber: '1.1',
        page: '2',
        sourceText: '  thirty (30) days  ',
        startOffset: 5,
        endOffset: 22,
      },
      { documentId: 'doc_1' },
    );
    expect(entry.documentId).toBe('doc_1');
    expect(entry.page).toBe(2);
    expect(entry.sourceText).toBe('thirty (30) days');
    expect(entry.startOffset).toBe(5);
  });

  it('rejects evidence without quoted text', () => {
    expect(normalizeDraftEvidence({ clauseNumber: '1.1' })).toBeNull();
    expect(normalizeDraftEvidence(null)).toBeNull();
    expect(normalizeDraftEvidenceList('nope')).toEqual([]);
  });
});

describe('responseParser: draft normalisation', () => {
  const payload = {
    title: 'Test Agreement',
    effectiveDate: '2026-01-01',
    parties: [
      { name: 'Acme', role: 'Customer', entityKind: 'company', evidence: [{ sourceText: 'Acme' }] },
      { role: 'customer', evidence: [] },
    ],
    obligations: [
      {
        summary: 'Pay invoices',
        obligorParty: 'Acme',
        clauseNumber: '1.1',
        standard: 'STRICT',
        informational: 'yes',
        hacked: 'ignore this',
        evidence: [{ clauseNumber: '1.1', sourceText: 'pay within 30 days' }],
      },
      { summary: '', clauseNumber: '1.1' },
    ],
    relationships: [{ type: 'clause-imposes-obligation', from: 'cl_1', to: 'obl_1' }],
    unknownCollection: [{ anything: true }],
  };

  it('keeps only whitelisted fields and reports the rest', () => {
    const { draft, notes, dropped } = normalizeExtractionDraft(payload, { documentId: 'doc_1' });
    expect(draft.obligations).toHaveLength(1);
    expect(draft.obligations[0].hacked).toBeUndefined();
    expect(draft.obligations[0].standard).toBe('strict');
    expect(draft.obligations[0].informational).toBe(false);
    expect(dropped.parties).toBe(1);
    expect(dropped.obligations).toBe(1);
    const codes = notes.map((note) => note.code);
    expect(codes).toContain('draft.unknown-fields');
    expect(codes).toContain('draft.unknown-collection');
    expect(codes).toContain('draft.missing-field');
  });

  it('accepts every supported collection and leaves missing ones empty', () => {
    const { draft } = normalizeExtractionDraft({}, { documentId: 'doc_1' });
    EXTRACTION_COLLECTIONS.forEach((collection) => {
      expect(draft[collection]).toEqual([]);
    });
  });

  it('records document hints without inventing values', () => {
    const { draft } = normalizeExtractionDraft(payload, { documentId: 'doc_1' });
    expect(draft.documentHints.title).toBe('Test Agreement');
    expect(draft.documentHints.effectiveDate).toBe('2026-01-01');
    expect(draft.documentHints.documentType).toBeNull();
  });

  it('rejects a collection that is not an array', () => {
    const { draft, dropped } = normalizeExtractionDraft({ parties: 'Acme' }, { documentId: 'doc_1' });
    expect(draft.parties).toEqual([]);
    expect(dropped.parties).toBe(1);
  });

  it('handles non-object payloads', () => {
    const { draft, notes } = normalizeExtractionDraft('nope', { documentId: 'doc_1' });
    expect(draft).toBeNull();
    expect(notes[0].code).toBe('draft.not-object');
  });

  it('counts proposed items', () => {
    const { draft } = normalizeExtractionDraft(payload, { documentId: 'doc_1' });
    expect(countDraftItems(draft)).toBe(3);
    expect(countDraftItems(null)).toBe(0);
  });
});
