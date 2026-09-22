/**
 * Mock provider.
 *
 * Deterministic, offline stand-in for a real model. It plays the same role in
 * development and demos as Gemini would: it returns JSON text that the
 * application then parses, validates and evidence-checks like any other
 * provider response. Nothing here bypasses that pipeline.
 *
 * Fixtures are injected (see `src/data/demo/`), which keeps demo data isolated
 * from application logic.
 */

import { AIProvider, AIProviderError, PROVIDER_ERROR_CODES } from '../provider.js';

export class MockProvider extends AIProvider {
  /**
   * @param {object} options
   * @param {Record<string, object>} options.fixtures   documentId -> extraction payload
   * @param {object|null} options.defaultFixture        payload used when no fixture matches
   * @param {(prompt: object) => string} options.responder custom override
   * @param {number} options.latencyMs                  simulated latency (0 by default)
   */
  constructor({ fixtures = {}, defaultFixture = null, responder = null, latencyMs = 0, ...rest } = {}) {
    super({ name: 'mock', model: 'clausegraph-mock-1', ...rest });
    this.fixtures = fixtures;
    this.defaultFixture = defaultFixture;
    this.responder = responder;
    this.latencyMs = latencyMs;
  }

  /** Resolves the payload for a prompt by matching the document id in metadata. */
  resolveFixture(prompt) {
    const haystack = `${prompt?.user ?? ''}`;
    for (const [documentId, payload] of Object.entries(this.fixtures)) {
      if (haystack.includes(documentId)) return payload;
    }
    // Chunk prompts embed their own limits; match by document title as a fallback.
    for (const payload of Object.values(this.fixtures)) {
      const title = payload?.__title;
      if (title && haystack.includes(title)) return payload;
    }
    return this.defaultFixture;
  }

  async extractLegalFacts({ prompt, signal = null }) {
    if (this.responder) {
      return this.send({
        prompt,
        signal,
        runner: async () => this.responder(prompt),
      });
    }

    const fixture = this.resolveFixture(prompt);
    if (!fixture) {
      throw new AIProviderError(
        'Mock provider has no fixture for this document. Load a demo document or configure a real provider.',
        { code: PROVIDER_ERROR_CODES.NOT_CONFIGURED },
      );
    }

    return this.send({
      prompt,
      signal,
      runner: async ({ signal: innerSignal }) => {
        if (this.latencyMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
        }
        if (innerSignal?.aborted) {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }
        // Strip internal fixture metadata before returning it as "model output".
        const { __title, __notes, ...payload } = fixture;
        return JSON.stringify(payload);
      },
    });
  }

  /**
   * Demo mode answers strictly from extracted facts and says so. It does not
   * fabricate a narrative answer, mirroring how the real provider is instructed.
   */
  async answerQuestion({ prompt, signal = null, context = null }) {
    return this.send({
      prompt,
      signal,
      runner: async () => {
        const lines = [
          'Demo mode answer — derived only from the extracted facts stored for this document.',
        ];
        if (context?.answer) lines.push(context.answer);
        else if (context?.clauses?.length) {
          lines.push(
            `Relevant clauses on record: ${context.clauses
              .map((clause) => `§${clause.number ?? clause.id}`)
              .join(', ')}.`,
          );
        } else {
          lines.push('No extracted clause matches this question yet.');
        }
        lines.push('Verify against the cited clause text before relying on this.');
        return lines.join('\n');
      },
    });
  }

  async healthCheck() {
    return {
      provider: this.name,
      model: this.model,
      ok: true,
      detail: `Demo extraction data (${Object.keys(this.fixtures).length} fixture document(s)).`,
    };
  }
}
