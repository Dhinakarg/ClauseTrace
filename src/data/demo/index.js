/**
 * Demo data registry.
 *
 * The ONLY place application code should import demo content from. Demo data is
 * isolated here so it can be deleted without touching domain logic, and it flows
 * through the same parser, provider interface, verification and validation as a
 * real upload.
 */

import { MockProvider } from '../../ai/providers/mockProvider.js';
import { DEMO_AGREEMENT_META, DEMO_AGREEMENT_TEXT } from './demoAgreement.js';
import { buildDemoExtraction } from './demoExtraction.js';

export { DEMO_AGREEMENT_TEXT, DEMO_AGREEMENT_META, DEMO_AGREEMENT_FILE_NAME } from './demoAgreement.js';

let cachedExtraction = null;

/** Builds (and memoizes) the parsed demo document + fixture. */
export function getDemoExtraction() {
  if (!cachedExtraction) cachedExtraction = buildDemoExtraction();
  return cachedExtraction;
}

/** Notes shown in the UI to make the synthetic nature of demo data explicit. */
export const DEMO_NOTES = Object.freeze([
  'The demo agreement is fictional and exists only to demonstrate the workflow.',
  'Demo extraction results are produced by the bundled mock provider, not by a live AI service.',
  'Every demo fact still passes the same evidence verification and validation as a real extraction.',
]);

/**
 * Loads the demo document source material.
 * Returns { meta, text, content, fixture, problems }.
 */
export function loadDemoDocument() {
  const { content, payload, problems } = getDemoExtraction();
  return {
    meta: DEMO_AGREEMENT_META,
    text: DEMO_AGREEMENT_TEXT,
    content,
    fixture: payload,
    problems,
  };
}

/** Fixtures keyed by document id, ready for MockProvider. */
export function buildDemoFixtures() {
  const { content, payload } = getDemoExtraction();
  return { [content.documentId]: payload };
}

/**
 * Creates a mock provider preloaded with the demo extraction.
 * This is the default provider, so the app works with no credentials at all.
 */
export function createDemoProvider(options = {}) {
  return new MockProvider({ fixtures: buildDemoFixtures(), ...options });
}

/**
 * Convenience: parsed demo documents as cards for the library view.
 * Pure and cheap enough to call during render.
 */
export function listDemoDocuments() {
  const { content } = getDemoExtraction();
  return [
    {
      id: content.documentId,
      title: DEMO_AGREEMENT_META.title,
      documentType: DEMO_AGREEMENT_META.documentType,
      effectiveDate: DEMO_AGREEMENT_META.effectiveDate,
      pageCount: content.pageCount,
      charCount: content.charCount,
      fileName: content.fileName,
      source: 'demo',
      warnings: content.warnings,
    },
  ];
}
