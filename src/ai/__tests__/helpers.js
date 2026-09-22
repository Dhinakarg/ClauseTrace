/**
 * Shared test helpers for the AI layer.
 * Keeps provider tests independent of environment variables: the config is
 * injected explicitly, exactly as the app does at runtime.
 */

export const AI_CONFIG_FIXTURE = Object.freeze({
  provider: 'mock',
  proxyUrl: null,
  model: 'test-model',
  limits: { TIMEOUT_MS: 5000, MAX_RETRIES: 0, MAX_CHARS_PER_REQUEST: 4000, MAX_RESPONSE_CHARS: 100000 },
});

/** Minimal `fetch` double that records calls and replays queued responses. */
export function createFetchStub(responses = []) {
  const calls = [];
  const queue = [...responses];
  const stub = async (url, options) => {
    calls.push({ url, options });
    const next = queue.shift();
    if (!next) throw new Error('No queued fetch response.');
    return {
      ok: next.status ? next.status < 400 : true,
      status: next.status ?? 200,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body ?? ''),
    };
  };
  stub.calls = calls;
  return stub;
}
