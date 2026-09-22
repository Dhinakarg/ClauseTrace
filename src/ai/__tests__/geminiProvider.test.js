import { describe, expect, it } from 'vitest';
import { GeminiProvider } from '../providers/geminiProvider.js';
import { PROVIDER_ERROR_CODES } from '../provider.js';
import { createFetchStub } from './helpers.js';

const PROMPT = { system: 'system instruction', user: 'user question' };

describe('geminiProvider: configuration', () => {
  it('refuses to run without a proxy or a runtime key', async () => {
    const provider = new GeminiProvider({ fetchImpl: createFetchStub([]) });
    expect(provider.isConfigured()).toBe(false);
    expect((await provider.healthCheck()).ok).toBe(false);
    await expect(provider.extractLegalFacts({ prompt: PROMPT })).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.NOT_CONFIGURED,
    });
  });

  it('refuses to construct with a fetch implementation that is not callable', () => {
    expect(() => new GeminiProvider({ apiKey: 'k'.repeat(30), fetchImpl: 42 })).toThrow();
  });
});

describe('geminiProvider: proxy mode', () => {
  it('posts the prompt to the proxy and returns its text', async () => {
    const fetchStub = createFetchStub([{ body: { text: '{"parties":[]}' } }]);
    const provider = new GeminiProvider({
      proxyUrl: 'https://example.test/api/ai',
      fetchImpl: fetchStub,
    });

    const result = await provider.extractLegalFacts({ prompt: PROMPT });
    expect(result.text).toBe('{"parties":[]}');
    expect(result.provider).toBe('gemini');

    const [call] = fetchStub.calls;
    expect(call.url).toBe('https://example.test/api/ai');
    expect(call.options.headers['x-goog-api-key']).toBeUndefined();
    const body = JSON.parse(call.options.body);
    expect(body.system).toBe(PROMPT.system);
    expect(body.prompt).toBe(PROMPT.user);
  });

  it('extracts text from a raw Gemini-shaped payload', async () => {
    const fetchStub = createFetchStub([
      { body: { candidates: [{ content: { parts: [{ text: 'part one ' }, { text: 'part two' }] } }] } },
    ]);
    const provider = new GeminiProvider({ proxyUrl: 'https://example.test/api/ai', fetchImpl: fetchStub });
    const result = await provider.extractLegalFacts({ prompt: PROMPT });
    expect(result.text).toBe('part one part two');
  });
});

describe('geminiProvider: direct mode', () => {
  it('sends the key in a header, never in the URL', async () => {
    const fetchStub = createFetchStub([{ body: { text: '{}' } }]);
    const provider = new GeminiProvider({
      model: 'gemini-test',
      apiKey: 'test-key-value-that-is-long-enough',
      fetchImpl: fetchStub,
    });
    await provider.extractLegalFacts({ prompt: PROMPT });
    const [call] = fetchStub.calls;
    expect(call.url).toContain('gemini-test:generateContent');
    expect(call.url).not.toContain('test-key-value');
    expect(call.options.headers['x-goog-api-key']).toBe('test-key-value-that-is-long-enough');
    const body = JSON.parse(call.options.body);
    expect(body.systemInstruction.parts[0].text).toBe(PROMPT.system);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('redacts the key in health output', async () => {
    const provider = new GeminiProvider({
      apiKey: 'abcdefgh-ijklmnop-qrstuvwx',
      fetchImpl: createFetchStub([]),
    });
    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.detail).not.toContain('ijklmnop');
    expect(health.detail).toMatch(/\*/);
  });
});

describe('geminiProvider: error handling', () => {
  it('maps HTTP failures, keeping retryable statuses retryable', async () => {
    const fetchStub = createFetchStub([{ status: 429, body: { error: { message: 'rate limited' } } }]);
    const provider = new GeminiProvider({ proxyUrl: 'https://example.test/api/ai', fetchImpl: fetchStub });
    await expect(provider.extractLegalFacts({ prompt: PROMPT })).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.HTTP,
      status: 429,
      retryable: true,
    });
  });

  it('reports a non-retryable client error', async () => {
    const fetchStub = createFetchStub([{ status: 400, body: { error: { message: 'bad request' } } }]);
    const provider = new GeminiProvider({ proxyUrl: 'https://example.test/api/ai', fetchImpl: fetchStub });
    await expect(provider.extractLegalFacts({ prompt: PROMPT })).rejects.toMatchObject({
      status: 400,
      retryable: false,
    });
  });

  it('reports a network failure as retryable', async () => {
    const provider = new GeminiProvider({
      proxyUrl: 'https://example.test/api/ai',
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    await expect(provider.extractLegalFacts({ prompt: PROMPT })).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.NETWORK,
      retryable: true,
    });
  });

  it('rejects a response with no text content', async () => {
    const fetchStub = createFetchStub([{ body: { candidates: [] } }]);
    const provider = new GeminiProvider({ proxyUrl: 'https://example.test/api/ai', fetchImpl: fetchStub });
    await expect(provider.extractLegalFacts({ prompt: PROMPT })).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.EMPTY_RESPONSE,
    });
  });
});
