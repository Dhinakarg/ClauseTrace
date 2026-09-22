import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  LIMITS,
  byteLength,
  checkSize,
  escapeForLog,
  normalizeWhitespace,
  sanitizeUntrustedText,
  stripControlCharacters,
  truncateText,
} from '../limits.js';
import { containsSecret, findSecrets, validateRuntimeApiKey } from '../secrets.js';

describe('limits: sanitization', () => {
  it('removes control characters but keeps newlines, tabs and page breaks', () => {
    expect(stripControlCharacters('a\u0000b\u0007c')).toBe('abc');
    expect(stripControlCharacters('line1\nline2\ttabbed')).toBe('line1\nline2\ttabbed');
    expect(stripControlCharacters('page1\fpage2')).toBe('page1\fpage2');
  });

  it('strips zero-width characters and bidi overrides', () => {
    expect(stripControlCharacters('safe\u200Bword')).toBe('safeword');
    expect(stripControlCharacters('a\u202Eb')).toBe('ab');
  });

  it('normalizes line endings and collapses blank runs', () => {
    expect(normalizeWhitespace('a\r\nb\r\nc')).toBe('a\nb\nc');
    expect(normalizeWhitespace('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('reports what sanitization changed', () => {
    const result = sanitizeUntrustedText('  Clause\u0007 text  ');
    expect(result.text).toBe('Clause text');
    expect(result.modified).toBe(true);
    expect(result.removedControlCharacters).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('truncates oversized text and says so', () => {
    const result = sanitizeUntrustedText('x'.repeat(100), { maxLength: 10 });
    expect(result.text).toHaveLength(10);
    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(100);
  });

  it('truncates on a word boundary', () => {
    expect(truncateText('the quick brown fox jumps over', 20)).toBe('the quick brown…');
    expect(truncateText('short', 10)).toBe('short');
    // Falls back to a hard cut when no boundary is close enough.
    expect(truncateText('supercalifragilistic', 10)).toBe('supercali…');
  });

  it('measures bytes and enforces size limits', () => {
    expect(byteLength('abc')).toBe(3);
    expect(checkSize(LIMITS.MAX_FILE_BYTES).ok).toBe(true);
    expect(checkSize(LIMITS.MAX_FILE_BYTES + 1).ok).toBe(false);
    expect(checkSize(-1).ok).toBe(false);
    expect(checkSize(Number.NaN).ok).toBe(false);
  });

  it('escapes text for logs', () => {
    expect(escapeForLog('a"b\\c\u0007')).toBe('a\\"b\\\\c');
  });
});

describe('secrets: detection', () => {
  // Probes are assembled at runtime rather than written as literals, so this
  // test file never contains a string that a repository secret scanner would
  // flag as a real credential (which the scan below would also catch).
  const fake = (prefix, filler, length = 35) => `${prefix}${filler.repeat(length)}`;

  it('detects credential-shaped strings', () => {
    expect(findSecrets(`key=${fake('AIza', 'A')}`)[0].name).toBe('google-api-key');
    expect(findSecrets(fake('sk-', 'a', 30))[0].name).toBe('openai-key');
    expect(findSecrets(fake('ghp_', 'b', 30))[0].name).toBe('github-token');
    expect(findSecrets(['-----BEGIN', 'RSA', 'PRIVATE KEY-----'].join(' '))[0].name).toBe(
      'private-key-block',
    );
    expect(containsSecret(`${'Bearer'} ${'c'.repeat(30)}`)).toBe(true);
  });

  it('ignores placeholder values and ordinary text', () => {
    expect(findSecrets('VITE_GEMINI_API_KEY=your-api-key-here')).toEqual([]);
    expect(findSecrets('AIza_example_placeholder_value_here')).toEqual([]);
    expect(findSecrets('The Customer shall pay within 30 days.')).toEqual([]);
    expect(findSecrets('')).toEqual([]);
  });

  it('validates a runtime key without storing it', () => {
    expect(validateRuntimeApiKey('').ok).toBe(false);
    expect(validateRuntimeApiKey('short').ok).toBe(false);
    expect(validateRuntimeApiKey('has spaces in it and is long').ok).toBe(false);
    expect(validateRuntimeApiKey('a'.repeat(30)).ok).toBe(true);
  });
});

/** Recursively lists source files under a directory. */
async function listSourceFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      files.push(...(await listSourceFiles(full)));
    } else if (/\.(js|jsx|json|md|html)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('secrets: repository scan', () => {
  it('finds no provider credential in application source', async () => {
    const root = process.cwd();
    const files = [
      ...(await listSourceFiles(path.join(root, 'src'))),
      path.join(root, 'index.html'),
      path.join(root, '.env.example'),
    ];

    const findings = [];
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      for (const secret of findSecrets(text)) {
        findings.push({ file: path.relative(root, file), name: secret.name });
      }
    }

    expect(findings).toEqual([]);
  });

  it('keeps the AI key out of the environment template values', async () => {
    const template = await fs.readFile(path.join(process.cwd(), '.env.example'), 'utf8');
    const assignments = template
      .split('\n')
      .filter((line) => /^\s*VITE_[A-Z_]+\s*=/.test(line))
      .map((line) => line.trim());
    // Any assignment present must be empty or a clearly non-secret value.
    for (const assignment of assignments) {
      const [, value = ''] = assignment.split('=');
      expect(value === '' || value === 'mock' || /^(gemini-|http)/.test(value)).toBe(true);
    }
  });
});
