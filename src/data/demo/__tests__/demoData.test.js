import { describe, expect, it } from 'vitest';
import {
  DEMO_NOTES,
  buildDemoFixtures,
  createDemoProvider,
  getDemoExtraction,
  listDemoDocuments,
  loadDemoDocument,
} from '../index.js';
import { runExtraction } from '../../../ai/extractionService.js';
import { buildGraph } from '../../../legal/graphEngine.js';
import { validateLegalModel } from '../../../legal/validators.js';
import { summarizeEvidenceCoverage } from '../../../documents/evidence.js';
import { buildTimeline, summarizeObligations } from '../../../legal/obligationEngine.js';
import { ENTITY_TYPES, getEntitiesByType } from '../../../legal/schema.js';

describe('demo data: integrity of the fixture', () => {
  it('quotes the demo document verbatim', () => {
    const { problems } = getDemoExtraction();
    expect(problems).toEqual([]);
  });

  it('parses the demo document into clauses', () => {
    const demo = loadDemoDocument();
    expect(demo.content.documentId).toBeTruthy();
    expect(demo.content.charCount).toBeGreaterThan(1500);
    expect(demo.content.warnings).toEqual([]);
  });

  it('keys fixtures by the parsed document id', () => {
    const fixtures = buildDemoFixtures();
    const { content } = getDemoExtraction();
    expect(Object.keys(fixtures)).toEqual([content.documentId]);
    expect(fixtures[content.documentId].__title).toBeTruthy();
  });

  it('describes the demo document without touching application logic', () => {
    const [document] = listDemoDocuments();
    expect(document.source).toBe('demo');
    expect(document.documentType).toBe('agreement');
    expect(document.title).toMatch(/Northwind|Vantage/);
    expect(DEMO_NOTES.length).toBeGreaterThan(0);
  });
});

describe('demo data: full pipeline', () => {
  it('produces a validated, evidence-checked model with the expected content', async () => {
    const demo = loadDemoDocument();
    const provider = createDemoProvider();
    const { model, report, validation } = await runExtraction({
      content: demo.content,
      provider,
      options: { documentHints: { title: demo.meta.title, documentType: demo.meta.documentType } },
    });

    expect(report.status).toBe('ok');
    expect(report.evidence.rejectedEntities).toBe(0);
    expect(validation.valid).toBe(true);

    // Three parties, including the guarantor.
    const parties = getEntitiesByType(model, ENTITY_TYPES.PARTY);
    expect(parties.map((party) => party.name)).toEqual(
      expect.arrayContaining([
        'Northwind Analytics Ltd',
        'Vantage Cloud Systems Inc.',
        'Meridian Capital Partners LLP',
      ]),
    );

    // Payment and confidentiality obligations are both present.
    const summaries = model.obligations.map((obligation) => obligation.summary).join(' | ');
    expect(summaries).toMatch(/within 30 days/);
    expect(summaries).toMatch(/Confidential Information/);

    // Termination and renewal conditions, a deadline and a consequence.
    expect(model.conditions.length).toBeGreaterThanOrEqual(2);
    expect(model.deadlines.length).toBeGreaterThanOrEqual(4);
    expect(model.consequences.length).toBeGreaterThanOrEqual(2);
    expect(model.inconsistencies).toHaveLength(1);
    expect(model.risks.length).toBeGreaterThanOrEqual(3);

    // Every fact carries a verified citation.
    const coverage = summarizeEvidenceCoverage(model);
    expect(coverage.verified).toBe(coverage.total);
    expect(coverage.coverageRatio).toBe(1);
  });

  it('builds a connected graph from the validated model', async () => {
    const demo = loadDemoDocument();
    const { model } = await runExtraction({ content: demo.content, provider: createDemoProvider() });
    const graph = buildGraph(model, { documentId: demo.content.documentId });

    expect(graph.stats.nodeCount).toBeGreaterThan(15);
    expect(graph.stats.relationshipCount).toBeGreaterThan(20);
    expect(graph.stats.brokenRelationshipIds).toEqual([]);
    expect(graph.relationships.every((relationship) => relationship.provenance === 'derived')).toBe(true);
    expect(validateLegalModel(model, { documentContent: demo.content }).valid).toBe(true);
  });

  it('resolves the fixed term date and flags the undatable survival clause', async () => {
    const demo = loadDemoDocument();
    const { model } = await runExtraction({ content: demo.content, provider: createDemoProvider() });
    const timeline = buildTimeline(model, { today: new Date('2026-09-19T00:00:00Z') });

    expect(timeline.entries.map((entry) => entry.date)).toContain('2026-11-30');
    expect(timeline.counts.future).toBeGreaterThanOrEqual(1);
    const survival = timeline.entries.find((entry) => entry.id.includes('confidentiality'));
    expect(survival).toBeUndefined();
    expect(timeline.undated.map((entry) => entry.description).join(' ')).toMatch(/five years/i);
  });

  it('identifies the deliberate payment-period contradiction', async () => {
    const demo = loadDemoDocument();
    const { model } = await runExtraction({ content: demo.content, provider: createDemoProvider() });
    const [inconsistency] = model.inconsistencies;
    expect(inconsistency.inconsistencyType).toBe('conflicting-terms');
    expect(inconsistency.title).toMatch(/30 days.*45 days/);
    expect(inconsistency.evidence).toHaveLength(2);
    expect(inconsistency.evidence.every((reference) => reference.verified)).toBe(true);
  });

  it('summarises obligations with an honest gap count', async () => {
    const demo = loadDemoDocument();
    const { model } = await runExtraction({ content: demo.content, provider: createDemoProvider() });
    const summary = summarizeObligations(model, { today: new Date('2026-09-19T00:00:00Z') });
    expect(summary.total).toBeGreaterThanOrEqual(6);
    expect(summary.withoutDeadline.length).toBeGreaterThan(0);
    expect(summary.incompleteCount).toBeGreaterThan(0);
  });
});
