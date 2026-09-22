/**
 * Product copy shown in multiple places.
 *
 * Kept in one module so the tool never implies it is a lawyer or that its
 * output is legal advice. This wording is part of the product's design, not a
 * decoration: deterministic verification tells you what the document says, not
 * what you should do about it.
 */

export const DISCLAIMER_SHORT =
  'ClauseTrace summarises document text. It is not legal advice and is not a substitute for review by a qualified lawyer.';

export const DISCLAIMER_LONG = [
  'ClauseTrace extracts and organises information from documents you provide.',
  'It does not provide legal advice, does not opine on enforceability, and does not decide what you should do.',
  'Extracted facts are proposed by an AI provider and then checked by deterministic application code:',
  'each fact must quote source text that the app can verify, and unverifiable facts are rejected rather than shown as truth.',
  'Always confirm against the original document before acting.',
].join(' ');

export const DEMO_BANNER =
  'Demo workspace: the agreement is fictional and extraction uses bundled demo data, not a live AI service.';

export const APP_NAME = 'ClauseTrace';

export const APP_TAGLINE = 'Evidence-backed legal document intelligence';

export const EMPTY_STATES = Object.freeze({
  noDocuments:
    'No documents loaded yet. Load the demo agreement or add your own to see how extraction, verification and the obligation graph behave.',
  noModel:
    'This document has no validated extraction yet. Run extraction to propose facts, then review what the application code could verify.',
  noClauses: 'No clause structure was detected in this document.',
  noObligations: 'No obligations were extracted from this document.',
  noRisks: 'No risk signals were flagged for this document.',
  noInconsistencies: 'No inconsistencies were detected between the extracted clauses.',
  noTimeline: 'No dated deadlines were resolved from this document.',
  noGraph: 'The relationship graph is empty for this document.',
});

export const TRUST_NOTE =
  'AI proposes facts; application code verifies citations, validates references and only then displays them.';
