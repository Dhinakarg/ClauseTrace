/**
 * Gemini provider.
 *
 * TWO MODES, ONE RULE: the API key never lives in frontend source.
 *
 *  1. Proxy mode (recommended, default when VITE_AI_PROXY_URL is set):
 *     the request goes to your own endpoint, which injects the credential.
 *       POST {proxyUrl}
 *       { "model": "...", "system": "...", "prompt": "...", "temperature": 0.1 }
 *     The proxy is expected to return { "text": "..." } or a Gemini payload.
 *
 *  2. Direct mode (local experiments only): an API key may be supplied
 *     in-memory via the constructor. It is sent in the `x-goog-api-key` header
 *     (never in the URL, which would leak into logs) and is never persisted.
 */

import { AIProvider, AIProviderError, PROVIDER_ERROR_CODES } from '../provider.js';
import { redactSecret } from '../config.js';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiProvider extends AIProvider {
  constructor({ model = 'gemini-2.0-flash', proxyUrl = null, apiKey = null, fetchImpl = null, temperature = 0.1, ...rest } = {}) {
    super({ name: 'gemini', model, ...rest });
    this.proxyUrl = proxyUrl ?? null;
    // Key held in memory only for the lifetime of this provider instance.
    this.apiKey = apiKey ?? null;
    this.temperature = temperature;
    this.fetchImpl = fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (typeof this.fetchImpl !== 'function') {
      throw new AIProviderError('No usable fetch implementation is available in this environment.', {
        code: PROVIDER_ERROR_CODES.NOT_CONFIGURED,
      });
    }
  }

  isConfigured() {
    return Boolean(this.proxyUrl || this.apiKey);
  }

  /** Extracts plain text from either proxy output or a raw Gemini response. */
  extractText(payload) {
    if (typeof payload?.text === 'string') return payload.text;
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      return parts
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
        .trim();
    }
    if (typeof payload?.error?.message === 'string') {
      throw new AIProviderError(payload.error.message, {
        code: PROVIDER_ERROR_CODES.HTTP,
        status: payload.error.code ?? null,
      });
    }
    return '';
  }

  async request(prompt, signal) {
    if (!this.isConfigured()) {
      throw new AIProviderError(
        'Gemini provider is not configured. Set VITE_AI_PROXY_URL so a server-side endpoint holds the credential.',
        { code: PROVIDER_ERROR_CODES.NOT_CONFIGURED },
      );
    }

    const usingProxy = Boolean(this.proxyUrl);
    const url = usingProxy
      ? this.proxyUrl
      : `${GEMINI_ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`;

    const headers = { 'Content-Type': 'application/json' };
    if (!usingProxy) headers['x-goog-api-key'] = this.apiKey;

    const body = usingProxy
      ? { model: this.model, system: prompt.system, prompt: prompt.user, temperature: this.temperature }
      : {
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
          generationConfig: {
            temperature: this.temperature,
            responseMimeType: 'application/json',
          },
        };

    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new AIProviderError(
        usingProxy
          ? 'Could not reach the configured AI proxy.'
          : `Could not reach the Gemini API (${error?.message ?? 'network error'}).`,
        { code: PROVIDER_ERROR_CODES.NETWORK, retryable: true, cause: error },
      );
    }

    if (!response.ok) {
      // Read the body for diagnostics but never echo credentials.
      let detail = '';
      try {
        const payload = await response.json();
        detail = payload?.error?.message ?? '';
      } catch {
        detail = '';
      }
      throw new AIProviderError(
        `AI request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        {
          code: PROVIDER_ERROR_CODES.HTTP,
          status: response.status,
          retryable: response.status >= 500 || response.status === 429,
        },
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new AIProviderError('AI response was not valid JSON.', {
        code: PROVIDER_ERROR_CODES.INVALID_RESPONSE,
        cause: error,
      });
    }

    const text = this.extractText(payload);
    if (!text) {
      throw new AIProviderError('AI response contained no text content.', {
        code: PROVIDER_ERROR_CODES.EMPTY_RESPONSE,
      });
    }
    return text;
  }

  async extractLegalFacts({ prompt, signal = null }) {
    return this.send({ prompt, signal, runner: ({ prompt: p, signal: s }) => this.request(p, s) });
  }

  async answerQuestion({ prompt, signal = null }) {
    return this.send({ prompt, signal, runner: ({ prompt: p, signal: s }) => this.request(p, s) });
  }

  async healthCheck() {
    return {
      provider: this.name,
      model: this.model,
      ok: this.isConfigured(),
      detail: this.isConfigured()
        ? this.proxyUrl
          ? 'Configured to call the AI proxy.'
          : `Configured with an in-memory key (${redactSecret(this.apiKey)}); not recommended for production.`
        : 'Not configured. Set VITE_AI_PROXY_URL.',
    };
  }
}
