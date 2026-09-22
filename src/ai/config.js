/**
 * AI configuration.
 *
 * SECURITY MODEL
 * --------------
 * A browser bundle is public. Therefore:
 *  - ClauseGraph never ships a provider API key in source or in a `VITE_*`
 *    variable that a build would inline.
 *  - The default provider is `mock`, which uses local deterministic data.
 *  - Production use is expected to go through `VITE_AI_PROXY_URL`, a same-origin
 *    (or CORS-restricted) endpoint that owns the provider secret server-side.
 *
 * Environment variables (all optional, see `.env.example`):
 *  VITE_AI_PROVIDER   "mock" (default) | "gemini"
 *  VITE_AI_PROXY_URL  server-side endpoint that injects credentials
 *  VITE_GEMINI_MODEL  public model identifier (not a secret)
 */

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

export const AI_PROVIDERS = Object.freeze({ MOCK: 'mock', GEMINI: 'gemini' });

export const DEFAULT_AI_MODEL = 'gemini-2.0-flash';

export const AI_REQUEST_LIMITS = Object.freeze({
  /** Wall-clock ceiling for a single provider call. */
  TIMEOUT_MS: 60_000,
  /** Retry attempts for transient failures (5xx, network). */
  MAX_RETRIES: 1,
  /** Maximum characters of document text per request. */
  MAX_CHARS_PER_REQUEST: 48_000,
  /** Maximum characters accepted from a provider response. */
  MAX_RESPONSE_CHARS: 2_000_000,
});

/** Resolved, non-secret configuration. Safe to display in diagnostics. */
export function getAIConfig() {
  const provider = String(env.VITE_AI_PROVIDER ?? AI_PROVIDERS.MOCK).toLowerCase();
  return {
    provider: provider === AI_PROVIDERS.GEMINI ? AI_PROVIDERS.GEMINI : AI_PROVIDERS.MOCK,
    proxyUrl: env.VITE_AI_PROXY_URL ? String(env.VITE_AI_PROXY_URL) : null,
    model: env.VITE_GEMINI_MODEL ? String(env.VITE_GEMINI_MODEL) : DEFAULT_AI_MODEL,
    limits: AI_REQUEST_LIMITS,
  };
}

export function getProviderName() {
  return getAIConfig().provider;
}

/** Formats provider name truthfully for UI presentation. */
export function getProviderDisplayName(providerName) {
  if (!providerName) return 'Not configured';
  const name = String(providerName).toLowerCase();
  if (name.includes('gemini')) return 'Gemini';
  if (name.includes('mock') || name.includes('demo')) return 'Demo / Mock Provider';
  return providerName;
}

export function isProxyConfigured() {
  return Boolean(getAIConfig().proxyUrl);
}

/**
 * True when the selected provider can actually run.
 * Gemini requires a configured proxy: a key typed at runtime may be passed to
 * the provider constructor in-memory, but nothing is read from source.
 */
export function isAIConfigured(config = getAIConfig()) {
  if (config.provider === AI_PROVIDERS.MOCK) return true;
  return Boolean(config.proxyUrl);
}

/** Human-readable status for the app's status area (contains no secrets). */
export function describeAIStatus(config = getAIConfig()) {
  if (config.provider === AI_PROVIDERS.MOCK) {
    return {
      provider: config.provider,
      ready: true,
      label: 'Demo extraction data',
      detail: 'No external AI provider is called. Demo documents use bundled synthetic data.',
    };
  }
  if (!config.proxyUrl) {
    return {
      provider: config.provider,
      ready: false,
      label: 'AI provider not configured',
      detail:
        'Set VITE_AI_PROXY_URL to a server-side endpoint that holds the provider credential. Keys must not be embedded in frontend code.',
    };
  }
  return {
    provider: config.provider,
    ready: true,
    label: `AI via proxy (${config.model})`,
    detail: 'Requests are sent to the configured proxy, which owns the provider credential.',
  };
}

/** Masks a secret for logs and diagnostics. Never returns a full credential. */
export function redactSecret(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(24, value.length - 8))}${value.slice(-4)}`;
}
