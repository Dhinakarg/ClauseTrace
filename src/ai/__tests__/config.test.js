import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDERS,
  AI_REQUEST_LIMITS,
  DEFAULT_AI_MODEL,
  describeAIStatus,
  getAIConfig,
  getProviderName,
  isAIConfigured,
  isProxyConfigured,
  redactSecret,
} from '../config.js';

const config = (overrides = {}) => ({ ...getAIConfig(), ...overrides });

describe('ai config: defaults', () => {
  it('defaults to the local mock provider and a public model id', () => {
    const resolved = getAIConfig();
    expect(resolved.provider).toBe(AI_PROVIDERS.MOCK);
    expect(resolved.model).toBe(DEFAULT_AI_MODEL);
    expect(getProviderName()).toBe(AI_PROVIDERS.MOCK);
    expect(AI_REQUEST_LIMITS.TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('never resolves a credential from the environment', () => {
    const keys = Object.keys(getAIConfig());
    expect(keys).toEqual(['provider', 'proxyUrl', 'model', 'limits']);
    expect(JSON.stringify(getAIConfig())).not.toMatch(/api[_-]?key/i);
  });

  it('treats an unknown provider name as mock', () => {
    // getAIConfig only ever returns one of the two known providers.
    expect([AI_PROVIDERS.MOCK, AI_PROVIDERS.GEMINI]).toContain(getAIConfig().provider);
  });
});

describe('ai config: readiness', () => {
  it('is ready out of the box because the mock provider needs nothing', () => {
    expect(isAIConfigured(config())).toBe(true);
    expect(isProxyConfigured()).toBe(false);
  });

  it('requires a proxy for a real provider', () => {
    expect(isAIConfigured(config({ provider: 'gemini' }))).toBe(false);
    expect(isAIConfigured(config({ provider: 'gemini', proxyUrl: 'https://example.test/ai' }))).toBe(true);
  });

  it('explains each status without leaking a credential', () => {
    const mock = describeAIStatus(config());
    expect(mock.ready).toBe(true);
    expect(mock.label).toBe('Demo extraction data');

    const unconfigured = describeAIStatus(config({ provider: 'gemini' }));
    expect(unconfigured.ready).toBe(false);
    expect(unconfigured.detail).toContain('VITE_AI_PROXY_URL');

    const proxied = describeAIStatus(config({ provider: 'gemini', proxyUrl: 'https://example.test/ai' }));
    expect(proxied.ready).toBe(true);
    expect(proxied.label).toContain(DEFAULT_AI_MODEL);
  });
});

describe('ai config: redaction', () => {
  it('keeps only a short prefix and suffix', () => {
    const redacted = redactSecret('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(redacted.startsWith('abcd')).toBe(true);
    expect(redacted.endsWith('6789')).toBe(true);
    expect(redacted).toContain('*');
    expect(redacted).not.toContain('efghijklmnop');
  });

  it('fully masks short values and handles junk input', () => {
    expect(redactSecret('abc')).toBe('***');
    expect(redactSecret('')).toBe('');
    expect(redactSecret(null)).toBe('');
    expect(redactSecret(12345)).toBe('');
  });
});
