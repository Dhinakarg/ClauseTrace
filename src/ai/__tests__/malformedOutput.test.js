/**
 * Malformed provider output.
 *
 * This suite is the "never crash" contract: whatever a provider returns —
 * invalid JSON, markdown fences, wrong types, duplicate ids, invented enums,
 * hallucinated quotes — the pipeline must produce a model or an honest failure,
 * and must say what it dropped.
 */

import { describe, expect, it } from 'vitest';
import { runExtraction } from '../extractionService.js';
import { MockProvider } from '../providers/mockProvider.js';
import { buildTestContent } from '../../legal/__tests__/fixtures.js';

const content = buildTestContent();

/** Provider that replays a queue of raw responses (one per call). */
function scriptedProvider(responses) {
  const queue = responses.map((entry) =>
    typeof entry === 'string'
      ? { text: entry, usage: null }
      : { text: entry.text, usage: entry.usage ?? null },
  );
  const calls = [];
  const provider = new MockProvider({ fixtures: {} });
  provider.name = 'scripted';
  provider.model = 'scripted-1';
  provider.calls = calls;
  provider.extractLegalFacts = async ({ prompt }) => {
    calls.push(prompt);
    const next = queue.shift();
    if (!next) throw new Error('Scripted provider ran out of responses.');
    return next;
  };
  return provider;
}

const QUOTE = 'The Customer shall pay each undisputed invoice';

function validPayload() {
  const start = content.text.indexOf(QUOTE);
  return {
    parties: [
      {
        name: 'Acme Limited',
        role: 'customer',
        entityKind: 'company',
        evidence: [
          {
            clauseNumber: '1.1',
            sourceText: QUOTE,
            startOffset: start,
            endOffset: start + QUOTE.length,
          },
        ],
      },
    ],
    obligations: [
      {
        summary: 'Pay undisputed invoices within 30 days.',
        action: 'pay undisputed invoices',
        actor: 'Acme Limited',
        clauseNumber: '1.1',
        standard: 'STRICT',
        evidence: [{ sourceText: 'within thirty (30) days of the invoice date', clauseNumber: '1.1' }],
      },
    ],
  };
}

describe('malformed output: parsing failures never crash the pipeline', () => {
  it('fails the chunk honestly when JSON cannot be repaired', async () => {
    const provider = scriptedProvider(['I am sorry, I cannot help with that.', 'still not json']);
    const { model, report } = await runExtraction({ content, provider });

    expect(model).toBeTruthy();
    expect(report.status).toBe('failed');
    expect(report.statusReason).toMatch(/usable structured response/i);
    expect(report.notes.map((note) => note.code)).toContain('extract.invalid-json');
    expect(report.chunks[0].ok).toBe(false);
    expect(report.chunks[0].repairAttempted).toBe(true);
  });

  it('repairs a response that was returned inside a markdown fence', async () => {
    const provider = scriptedProvider([`\`\`\`json\n${JSON.stringify(validPayload())}\n\`\`\``]);
    const { model, report } = await runExtraction({ content, provider });

    expect(report.status).toBe('ok');
    expect(model.obligations).toHaveLength(1);
    expect(model.obligations[0].id).toMatch(/^obl_/);
  });

  it('retries once on a malformed first answer and uses the second', async () => {
    const provider = scriptedProvider(['{ broken: ', JSON.stringify(validPayload())]);
    const { report } = await runExtraction({ content, provider });

    expect(provider.calls.length).toBe(2);
    expect(report.repairedChunks).toBe(1);
    expect(report.status).toBe('ok');
  });

  it('accepts an empty JSON object and publishes a model with no facts', async () => {
    const provider = scriptedProvider(['{}']);
    const { model, report } = await runExtraction({ content, provider });

    expect(model).toBeTruthy();
    expect(model.obligations).toHaveLength(0);
    expect(report.draftItemCount).toBe(0);
  });

  it('survives a provider that throws', async () => {
    const provider = new MockProvider({ fixtures: {} });
    provider.extractLegalFacts = async () => {
      throw new Error('network down');
    };
    const { model, report } = await runExtraction({ content, provider });

    expect(report.status).toBe('failed');
    expect(model).toBeTruthy();
    expect(report.notes.map((note) => note.code)).toContain('extract.provider-error');
  });
});

describe('malformed output: fields, ids and enums', () => {
  it('drops unknown fields, invalid enums and unusable items', async () => {
    const provider = scriptedProvider([
      JSON.stringify({
        parties: [{ name: 'Acme Limited', role: 'customer', entityKind: 'company', hacked: true }],
        obligations: [
          { summary: 'Pay invoices', clauseNumber: '1.1', standard: 'extremely-strict' },
          { clauseNumber: '1.1' },
          'not an object',
        ],
        relationships: [{ type: 'not-a-relationship', from: 'x', to: 'y' }],
      }),
    ]);
    const { report } = await runExtraction({ content, provider });

    expect(report.droppedItems.obligations).toBe(2);
    const codes = report.chunks[0].notes.map((note) => note.code);
    expect(codes).toContain('draft.unknown-fields');
    expect(codes).toContain('draft.missing-field');
    expect(report.rejectedRelationships.length).toBe(1);
  });

  it('drops a fact whose quoted text is not in the document', async () => {
    const provider = scriptedProvider([
      JSON.stringify({
        obligations: [
          {
            summary: 'Pay a penalty of GBP 1,000,000.',
            clauseNumber: '1.1',
            evidence: [
              {
                clauseNumber: '1.1',
                sourceText: 'The Customer shall pay a penalty of GBP 1,000,000.',
              },
            ],
          },
        ],
      }),
    ]);
    const { model, report } = await runExtraction({ content, provider });

    expect(report.evidence.rejectedEntities).toBe(1);
    expect(model.obligations).toHaveLength(0);
    expect(report.notes.map((note) => note.code)).toContain('extract.evidence-dropped');
  });

  it('merges duplicate proposals instead of double-counting them', async () => {
    const provider = scriptedProvider([
      JSON.stringify({
        obligations: [
          {
            summary: 'Pay invoices',
            clauseNumber: '1.1',
            evidence: [{ clauseNumber: '1.1', sourceText: QUOTE }],
          },
          {
            summary: 'Pay invoices',
            clauseNumber: '1.1',
            evidence: [{ clauseNumber: '1.1', sourceText: QUOTE }],
          },
        ],
      }),
    ]);
    const { model, report } = await runExtraction({ content, provider });

    expect(model.obligations).toHaveLength(1);
    expect(report.assembleIssues.map((entry) => entry.code)).toContain('assemble.duplicate-entity');
  });

  it('keeps ids unique when two distinct facts produce the same id', async () => {
    const provider = scriptedProvider([
      JSON.stringify({
        definitions: [
          { term: 'Invoice', text: 'A demand for payment.', clauseNumber: '1.1' },
          { term: 'Invoice.', text: 'A demand for payment.', clauseNumber: '1.1' },
        ],
      }),
    ]);
    const { model } = await runExtraction({ content, provider });

    const ids = model.definitions.map((definition) => definition.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('accepts alternate field names and maps them onto the schema', async () => {
    const provider = scriptedProvider([
      JSON.stringify({
        parties: [
          {
            name: 'Acme Limited',
            kind: 'company',
            role: 'customer',
            evidence: [{ clauseNumber: '1.1', sourceText: QUOTE }],
          },
        ],
        obligations: [
          {
            summary: 'Pay invoices',
            actor: 'Acme Limited',
            recipient: 'Beta Services plc',
            clauseNumber: '1.1',
            trigger: 'on invoice receipt',
            dueBy: 'within 30 days',
            evidence: [{ clauseNumber: '1.1', sourceText: QUOTE }],
          },
        ],
      }),
    ]);
    const { model, report } = await runExtraction({ content, provider });

    expect(model.parties[0].entityKind).toBe('company');
    expect(model.obligations[0].triggerText).toBe('on invoice receipt');
    expect(model.obligations[0].deadlineText).toBe('within 30 days');
    expect(report.chunks[0].notes.map((note) => note.code)).toContain('draft.alias-applied');
  });

  it('numbers an unknown enum as "unknown" rather than failing', async () => {
    const provider = scriptedProvider([
      JSON.stringify({
        risks: [
          {
            title: 'Odd clause',
            category: 'not-a-category',
            severity: 'catastrophic',
            clauseNumber: '1.1',
            evidence: [{ clauseNumber: '1.1', sourceText: QUOTE }],
          },
        ],
      }),
    ]);
    const { model } = await runExtraction({ content, provider });

    expect(model.risks[0].category).toBe('unknown');
    expect(model.risks[0].severity).toBe('unknown');
  });
});
