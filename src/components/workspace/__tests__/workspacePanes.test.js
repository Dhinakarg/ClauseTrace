/**
 * Workspace panes smoke test.
 *
 * Renders the three panes of the document workspace with data that came out of a
 * real pipeline run — a demo document parsed, chunked, extracted and verified —
 * and checks that each pane shows what it promises. renderToString is enough:
 * the panes are pure views over the model, so a bad prop or a broken import
 * fails here rather than in the browser.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ClauseReader } from '../ClauseReader.jsx';
import { DocumentNavigator } from '../DocumentNavigator.jsx';
import { IntelligencePanel } from '../IntelligencePanel.jsx';
import { SourceViewProvider, SourceViewer } from '../SourceViewer.jsx';
import {
  clauseHighlight,
  evidenceHighlights,
  summarizeSource,
} from '../sourceView.js';
import { clauseNumberMap } from '../../legal/presentation.js';
import { indexClauseFacts } from '../../../documents/evidence.js';
import { runDocumentPipeline } from '../../../documents/pipeline.js';
import { createDemoProvider, loadDemoDocument } from '../../../data/demo/index.js';

let demo = null;

beforeAll(async () => {
  const loaded = loadDemoDocument();
  const result = await runDocumentPipeline({
    content: loaded.content,
    provider: createDemoProvider(),
  });
  expect(result.ok).toBe(true);
  demo = result;
});

function harness(children) {
  return renderToString(createElement(SourceViewProvider, null, children));
}

/** React escapes text children; compare against the same escaping. */
function escapeText(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

describe('workspace panes: rendered from a real extraction', () => {
  it('shows the clause skeleton with fact counts in the navigator', () => {
    const model = demo.model;
    const index = indexClauseFacts(model);
    const factsByClause = new Map(
      [...index.byClause.entries()].map(([id, facts]) => [id, facts.length]),
    );
    const first = model.clauses[0];

    const html = harness(
      createElement(DocumentNavigator, {
        clauses: model.clauses,
        factsByClause,
        activeClauseId: first.id,
        stats: summarizeSource(demo.content, model.clauses, index.facts),
        onSelect: () => {},
      }),
    );

    expect(html).toContain('Clauses');
    expect(html).toContain(`${model.clauses.length}`);
    expect(html).toContain('Search clauses');
    expect(html).toMatch(/facts/);
  });

  it('renders the document text in the source viewer, not a paraphrase', () => {
    const html = harness(
      createElement(SourceViewer, {
        content: demo.content,
        clauses: demo.model.clauses,
        highlights: [],
      }),
    );

    const opening = demo.content.text.slice(0, 40);
    expect(html).toContain(opening.slice(0, 20));
    expect(html).not.toContain('undefined');
  });

  it('highlights the selected clause inside the source text', () => {
    const clause = demo.model.clauses.find((entry) => entry.number === '2.1') ?? demo.model.clauses[1];
    const html = harness(
      createElement(SourceViewer, {
        content: demo.content,
        clauses: demo.model.clauses,
        highlights: [clauseHighlight(clause), ...evidenceHighlights([])],
      }),
    );

    expect(html).toContain('mark');
    expect(clauseHighlight(clause)).not.toBeNull();
  });

  it('reads a clause with its citations in the reader pane', () => {
    const index = indexClauseFacts(demo.model);
    const [clauseId, facts] = [...index.byClause.entries()].find(([, list]) => list.length > 0);
    const clause = demo.model.clauses.find((entry) => entry.id === clauseId);

    const html = harness(
      createElement(ClauseReader, {
        clause,
        facts,
        clauseNumberById: clauseNumberMap(demo.model),
        position: { index: 1, total: demo.model.clauses.length },
        onPrevious: null,
        onNext: null,
        onFocusSource: () => {},
      }),
    );

    expect(html).toContain(escapeText(clause.text.replace(/\s+/g, ' ').slice(0, 24)));
    expect(html).toMatch(/Source|document|cites/);
  });

  it('lists extracted facts with their citations in the intelligence pane', () => {
    const index = indexClauseFacts(demo.model);
    const fact = index.facts[0];
    const clauseId = fact.clauseIds[0];
    const clauseFacts = index.byClause.get(clauseId) ?? [fact];

    const html = harness(
      createElement(IntelligencePanel, {
        facts: clauseFacts,
        clauseNumberById: clauseNumberMap(demo.model),
        selectedEntityId: fact.entity.id,
        onSelect: () => {},
        onShowSource: () => {},
        scopeLabel: 'facts citing clause 2.1',
      }),
    );

    expect(html).toContain('Extracted intelligence');
    expect(html).toContain('Show this passage in the document');
    expect(html).toMatch(/fact\(s\)/);
    expect(html).not.toMatch(/legal advice|is liable|breach of contract/i);
  });

  it('labels a citation that failed verification instead of hiding it', () => {
    const index = indexClauseFacts(demo.model);
    const fact = index.facts[0];
    const unverified = {
      ...fact,
      references: [
        { ...fact.references[0], verified: false, status: 'unverified' },
        { ...fact.references[0], id: `${fact.references[0].id}_mismatch`, verified: false, status: 'text-mismatch' },
      ],
      entity: { ...fact.entity, id: `${fact.entity.id}_unverified` },
    };

    const html = harness(
      createElement(IntelligencePanel, {
        facts: [unverified],
        clauseNumberById: clauseNumberMap(demo.model),
        selectedEntityId: null,
        onSelect: () => {},
        onShowSource: null,
        scopeLabel: 'test scope',
      }),
    );

    expect(html).toContain('unverified');
    expect(html).toContain('quote not found');
    expect(html).not.toContain('>verified<');
  });
});
