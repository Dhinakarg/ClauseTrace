/**
 * AI provider abstraction.
 *
 * The rest of the application talks to one interface:
 *   provider.extractLegalFacts({ prompt, signal }) -> { text, provider, model, usage }
 *   provider.answerQuestion({ prompt, signal })    -> { text, provider, model, usage }
 *
 * Two implementations ship with Phase 1:
 *   - MockProvider  : deterministic local data, the default. No network.
 *   - GeminiProvider: real provider, but credentials live behind a proxy.
 *
 * Providers never touch domain logic. They receive a prompt and return text;
 * parsing, validation and evidence verification happen in application code.
 */

import { AI_PROVIDERS, AI_REQUEST_LIMITS, getAIConfig } from './config.js';

export const PROVIDER_ERROR_CODES = Object.freeze({
  NOT_IMPLEMENTED: 'not-implemented',
  NOT_CONFIGURED: 'not-configured',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  HTTP: 'http',
  EMPTY_RESPONSE: 'empty-response',
  INVALID_RESPONSE: 'invalid-response',
  ABORTED: 'aborted',
});

export class AIProviderError extends Error {
  constructor(
    message,
    { code = PROVIDER_ERROR_CODES.INVALID_RESPONSE, status = null, retryable = false, cause = null } = {},
  ) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.cause = cause;
  }
}

/** Validates the prompt object handed to a provider. */
export function validatePrompt(prompt) {
  const problems = [];
  if (!prompt || typeof prompt !== 'object') {
    problems.push('Prompt must be an object.');
  } else {
    if (typeof prompt.system !== 'string' || prompt.system.trim() === '') {
      problems.push('Prompt must include a non-empty system instruction.');
    }
    if (typeof prompt.user !== 'string' || prompt.user.trim() === '') {
      problems.push('Prompt must include a non-empty user message.');
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Validates a provider result before it is parsed. */
export function validateProviderResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, error: 'Provider returned nothing.' };
  }
  if (typeof result.text !== 'string') return { ok: false, error: 'Provider returned no text.' };
  if (result.text.trim() === '') {
    return { ok: false, error: 'Provider returned an empty response.' };
  }
  if (result.text.length > AI_REQUEST_LIMITS.MAX_RESPONSE_CHARS) {
    return { ok: false, error: 'Provider response exceeded the accepted size limit.' };
  }
  return { ok: true, error: null };
}

/**
 * Base class documenting the provider contract. Subclasses implement the two
 * request methods; timing, result shape and error mapping are shared here.
 */
export class AIProvider {
  constructor({ name = 'provider', model = null, limits = AI_REQUEST_LIMITS } = {}) {
    if (new.target === AIProvider) {
      throw new TypeError('AIProvider is abstract. Use MockProvider or GeminiProvider.');
    }
    this.name = name;
    this.model = model;
    this.limits = limits;
  }

  /** Runs one request through `runner`, normalizing timing and errors. */
  async send({ prompt, runner, signal = null }) {
    const validation = validatePrompt(prompt);
    if (!validation.ok) {
      throw new AIProviderError(`Invalid prompt: ${validation.problems.join(' ')}`, {
        code: PROVIDER_ERROR_CODES.INVALID_RESPONSE,
      });
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.limits.TIMEOUT_MS);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const text = await runner({ prompt, signal: controller.signal });
      if (typeof text !== 'string' || text.trim() === '') {
        throw new AIProviderError('Provider returned an empty response.', {
          code: PROVIDER_ERROR_CODES.EMPTY_RESPONSE,
        });
      }
      if (text.length > this.limits.MAX_RESPONSE_CHARS) {
        throw new AIProviderError('Provider response exceeded the accepted size limit.', {
          code: PROVIDER_ERROR_CODES.INVALID_RESPONSE,
        });
      }
      return {
        text,
        provider: this.name,
        model: this.model,
        usage: {
          durationMs: Date.now() - startedAt,
          promptChars: (prompt.system?.length ?? 0) + (prompt.user?.length ?? 0),
          responseChars: text.length,
        },
      };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error?.name === 'AbortError') {
        throw new AIProviderError(
          signal?.aborted ? 'Request was cancelled.' : 'Provider request timed out.',
          {
            code: signal?.aborted ? PROVIDER_ERROR_CODES.ABORTED : PROVIDER_ERROR_CODES.TIMEOUT,
            retryable: !signal?.aborted,
            cause: error,
          },
        );
      }
      throw new AIProviderError(error?.message ?? 'Provider request failed.', {
        code: PROVIDER_ERROR_CODES.NETWORK,
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Extracts legal facts from a document chunk. Returns raw provider text. */
  extractLegalFacts() {
    throw new AIProviderError(`${this.name} does not implement extractLegalFacts().`, {
      code: PROVIDER_ERROR_CODES.NOT_IMPLEMENTED,
    });
  }

  /** Answers a grounded question over supplied excerpts. */
  answerQuestion() {
    throw new AIProviderError(`${this.name} does not implement answerQuestion().`, {
      code: PROVIDER_ERROR_CODES.NOT_IMPLEMENTED,
    });
  }

  /** Reports whether the provider is usable, without revealing credentials. */
  async healthCheck() {
    return { provider: this.name, model: this.model, ok: true, detail: 'Provider is available.' };
  }
}

/**
 * Factory that resolves the configured provider.
 * `options` lets tests inject fixtures or a fetch implementation.
 */
export async function createProvider(config = getAIConfig(), options = {}) {
  if (config.provider === AI_PROVIDERS.GEMINI) {
    const { GeminiProvider } = await import('./providers/geminiProvider.js');
    return new GeminiProvider({ model: config.model, proxyUrl: config.proxyUrl, ...options });
  }
  const { MockProvider } = await import('./providers/mockProvider.js');
  return new MockProvider(options);
}

/** Convenience helper for diagnostics: provider name + readiness. */
export function describeProvider(provider) {
  if (!provider) return { name: 'none', ready: false };
  return { name: provider.name, model: provider.model ?? null, ready: true };
}

