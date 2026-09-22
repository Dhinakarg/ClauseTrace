/**
 * Secret detection.
 *
 * Used by tests and diagnostics to prove that no provider credential is
 * committed to the repository or inlined into the browser bundle. This is a
 * guard-rail, not a substitute for secret scanning in CI.
 */

/** Patterns for credential formats ClauseGraph could plausibly encounter. */
export const SECRET_PATTERNS = Object.freeze([
  { name: 'google-api-key', regex: /AIza[0-9A-Za-z_-]{30,}/g },
  { name: 'openai-key', regex: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'anthropic-key', regex: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'aws-access-key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'github-token', regex: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: 'slack-token', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'generic-bearer', regex: /Bearer\s+[A-Za-z0-9\-._~+/]{24,}=*/g },
  { name: 'private-key-block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
]);

/** Values that look like secrets but are obviously placeholders. */
const PLACEHOLDER_PATTERN = /(your|example|placeholder|changeme|replace|test|dummy|xxx|\.\.\.)/i;

/** Returns [{ name, index, sample }] for every credential-shaped match. */
export function findSecrets(text) {
  const value = String(text ?? '');
  const findings = [];
  for (const { name, regex } of SECRET_PATTERNS) {
    const pattern = new RegExp(regex.source, regex.flags);
    let match = pattern.exec(value);
    while (match) {
      if (!PLACEHOLDER_PATTERN.test(match[0])) {
        findings.push({ name, index: match.index, sample: `${match[0].slice(0, 6)}...` });
      }
      match = pattern.exec(value);
    }
  }
  return findings;
}

export function containsSecret(text) {
  return findSecrets(text).length > 0;
}

/**
 * Checks a key supplied at runtime by a person (never from source).
 * Returns { ok, reason } and rejects obviously invalid input early.
 */
export function validateRuntimeApiKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return { ok: false, reason: 'No key was provided.' };
  if (key.length < 20) return { ok: false, reason: 'Key is too short to be valid.' };
  if (/\s/.test(key)) return { ok: false, reason: 'Key must not contain whitespace.' };
  return { ok: true, reason: null };
}
