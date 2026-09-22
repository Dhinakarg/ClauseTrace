import { describe, expect, it } from 'vitest';
import {
  AIProvider,
  AIProviderError,
  PROVIDER_ERROR_CODES,
  createProvider,
  validatePrompt,
} from '../provider.js';
import { MockProvider } from '../providers/mockProvider.js';
import { buildExtractionPrompt } from '../promptBuilder.js';
import { AI_CONFIG_FIXTURE } from './helpers.js';

describe('provider: contract', () => {
  it('cannot be instantiated directly', () => {
    expect(() => new AIProvider({})).toThrow(TypeError);
  });

  it('validates prompts before sending anything', async () => {
    expect(validatePrompt({ system: 's', user: 'u' }).ok).toBe(true);
    expect(validatePrompt({ user: 'u' }).problems[0]).toMatch(/system/);
    expect(validatePrompt(null).ok).toBe(false);

    const provider = new MockProvider();
    await expect(provider.send({ prompt: { user: 'x' }, runner: async () => 'ok' })).rejects.toThrow(
      AIProviderError,
    );
  });

  it('rejects an empty provider response', async () => {
    const provider = new MockProvider();
    await expect(
      provider.send({ prompt: { system: 's', user: 'u' }, runner: async () => '   ' }),
    ).rejects.toMatchObject({ code: PROVIDER_ERROR_CODES.EMPTY_RESPONSE });
  });

  it('maps abort errors to a timeout error', async () => {
    const provider = new MockProvider();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    await expect(
      provider.send({
        prompt: { system: 's', user: 'u' },
        runner: async () => {
          throw abortError;
        },
      }),
    ).rejects.toMatchObject({ code: PROVIDER_ERROR_CODES.TIMEOUT, retryable: true });
  });

  it('maps unknown errors to a retryable network error', async () => {
    const provider = new MockProvider();
    await expect(
      provider.send({
        prompt: { system: 's', user: 'u' },
        runner: async () => {
          throw new Error('socket closed');
        },
      }),
    ).rejects.toMatchObject({ code: PROVIDER_ERROR_CODES.NETWORK });
  });

  it('does not implement extraction on the base class', () => {
    const provider = new MockProvider();
    provider.extractLegalFacts = AIProvider.prototype.extractLegalFacts.bind(provider);
    expect(() => provider.extractLegalFacts({ prompt: { system: 's', user: 'u' } })).toThrow(
      /not implement/,
    );
  });
});

describe('provider: mock', () => {
  const fixtures = {
    doc_1: { __title: 'Test', parties: [], obligations: [] },
  };

  it('returns the fixture matching the document id in the prompt', async () => {
    const provider = new MockProvider({ fixtures });
    const prompt = buildExtractionPrompt({
      document: { id: 'doc_1', title: 'Test' },
      clauses: [],
      chunk: { id: 'c1', text: 'text', clauseIds: [], charStart: 0, charEnd: 4 },
    });
    const result = await provider.extractLegalFacts({ prompt });
    expect(result.provider).toBe('mock');
    expect(JSON.parse(result.text).__title).toBeUndefined();
    expect(result.usage.responseChars).toBeGreaterThan(0);
  });

  it('fails clearly when no fixture matches', async () => {
    const provider = new MockProvider({ fixtures: {} });
    await expect(
      provider.extractLegalFacts({ prompt: { system: 's', user: 'unknown doc' } }),
    ).rejects.toMatchObject({ code: PROVIDER_ERROR_CODES.NOT_CONFIGURED });
  });

  it('supports a custom responder and reports health without secrets', async () => {
    const provider = new MockProvider({ responder: () => '{"parties":[]}' });
    const result = await provider.extractLegalFacts({ prompt: { system: 's', user: 'u' } });
    expect(result.text).toBe('{"parties":[]}');
    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
    expect(JSON.stringify(health)).not.toMatch(/key/i);
  });

  it('answers questions in demo mode without inventing content', async () => {
    const provider = new MockProvider({ fixtures });
    const result = await provider.answerQuestion({
      prompt: { system: 's', user: 'u' },
      context: { clauses: [{ number: '1.1' }] },
    });
    expect(result.text).toMatch(/Demo mode/);
    expect(result.text).toMatch(/1\.1/);
    expect(result.text).toMatch(/Verify against the cited clause text/);
  });

  it('is resolvable through the factory when the provider is mock', async () => {
    const provider = await createProvider(AI_CONFIG_FIXTURE, { fixtures });
    expect(provider).toBeInstanceOf(MockProvider);
  });
});
