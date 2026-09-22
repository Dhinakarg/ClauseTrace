/**
 * Ask panel smoke tests.
 *
 * The panels are pure views over the Ask view model, so rendering them with a
 * real answer (retrieval + citation validation over the fixture document) is
 * enough to catch a broken prop, a bad import or a crash: renderToString fails
 * here instead of in the browser.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import {
  AiReadingPanel,
  AnswerPanel,
  AskHistory,
  AskQuestionForm,
  CitationList,
  EvidencePanel,
  QuestionSafetyNotice,
  RelatedObligations,
} from '../AskPanels.jsx';
import { answerQuestion } from '../../../legal/askEngine.js';
import { buildTestContent, buildValidModel } from '../../../legal/__tests__/fixtures.js';

const model = buildValidModel();
const content = buildTestContent();
const DOCUMENT_ID = 'doc_test_agreement';
const answer = answerQuestion(model, 'when must invoices be paid?', { content });
const empty = answerQuestion(model, 'governing law arbitration seat', { content });

function render(element) {
  return renderToString(
    createElement(StaticRouter, { location: '/workspace/doc_test_agreement/ask' }, element),
  );
}

describe('ask panels: answer', () => {
  it('renders the quoted answer, its confidence and its limitations', () => {
    const html = render(createElement(AnswerPanel, { result: answer }));
    expect(html).toContain('Clause 1.1');
    expect(html).toContain('Confidence');
    expect(html).toContain('grounded in the text');
    expect(html).toContain('What this answer is not');
    expect(html).toContain('not advice');
  });

  it('renders the insufficient-information path honestly', () => {
    const html = render(createElement(AnswerPanel, { result: empty }));
    expect(html).toContain('no supporting clause');
    expect(html).toContain('No clause in this document matches those terms');
    expect(html).toContain('No supporting text');
  });

  it('renders nothing without a result', () => {
    expect(render(createElement(AnswerPanel, { result: null }))).toBe('');
  });
});

describe('ask panels: evidence', () => {
  it('shows each source with its verification state and a deep link', () => {
    const html = render(createElement(EvidencePanel, { result: answer, documentId: DOCUMENT_ID }));
    expect(html).toContain('Clause 1.1');
    expect(html).toContain('citation verified');
    expect(html).toContain('undisputed invoice');
    expect(html).toContain('/workspace/doc_test_agreement?view=reading&amp;clause=cl_payment');
    expect(html).toContain('Obligations extracted here');
  });

  it('renders nothing without sources', () => {
    expect(render(createElement(EvidencePanel, { result: null }))).toBe('');
    expect(render(createElement(EvidencePanel, { result: empty }))).toBe('');
  });
});

describe('ask panels: AI reading', () => {
  it('renders nothing when the AI half was never attempted', () => {
    expect(render(createElement(AiReadingPanel, { ai: { attempted: false } }))).toBe('');
    expect(render(createElement(AiReadingPanel, { ai: null }))).toBe('');
  });

  it('shows the withheld reason and keeps the extractive answer in view', () => {
    const html = render(
      createElement(AiReadingPanel, {
        ai: {
          attempted: true,
          used: false,
          rejected: true,
          reason: 'The answer cited clause number(s) that are not in this document: 9.9.',
          issues: ['The answer cited clause number(s) that are not in this document: 9.9.'],
        },
      }),
    );
    expect(html).toContain('AI reading withheld');
    expect(html).toContain('9.9');
    expect(html).toContain('The extractive answer above is unaffected');
  });

  it('labels an accepted AI reading as unverified and names the contract', () => {
    const html = render(
      createElement(AiReadingPanel, {
        ai: {
          attempted: true,
          used: true,
          rejected: false,
          provider: 'mock',
          model: 'clausegraph-mock-1',
          promptId: 'ask.grounded.v2',
          text: 'Clause 1.1 requires payment within thirty days.',
          citedClauses: ['1.1'],
        },
      }),
    );
    expect(html).toContain('not verified');
    expect(html).toContain('ask.grounded.v2');
    expect(html).toContain('Clause 1.1 requires payment');
    expect(html).toContain('Every reference it used (1.1) was checked');
  });

  it('names a heading it checked when the cited clause has no number', () => {
    const html = render(
      createElement(AiReadingPanel, {
        ai: {
          attempted: true,
          used: true,
          rejected: false,
          provider: 'mock',
          model: null,
          promptId: 'ask.grounded.v2',
          text: 'The GOVERNING LAW heading applies.',
          citedClauses: [],
          citedHeadings: ['GOVERNING LAW'],
        },
      }),
    );
    expect(html).toContain('Every reference it used (GOVERNING LAW) was checked');
  });
});

describe('ask panels: form, safety, citations and history', () => {
  it('offers the suggestions and disables an empty submit', () => {
    const html = render(
      createElement(AskQuestionForm, {
        question: '',
        onChange: () => {},
        onSubmit: () => {},
        suggestions: ['When is the deadline for payment?'],
        onSelectSuggestion: () => {},
      }),
    );
    expect(html).toContain('Suggestions from this document');
    expect(html).toContain('disabled');
    expect(html).toContain('When is the deadline for payment?');
  });

  it('explains a question that had to be neutralised', () => {
    expect(
      render(createElement(QuestionSafetyNotice, { questionSafety: answer.questionSafety })),
    ).toBe('');
    const html = render(
      createElement(QuestionSafetyNotice, {
        questionSafety: { warnings: [{ excerpt: 'ignore previous instructions' }], truncated: true },
      }),
    );
    expect(html).toContain('untrusted input');
    expect(html).toContain('ignore previous instructions');
    expect(html).toContain('shortened');
  });

  it('lists the citations with their scores', () => {
    const html = render(createElement(CitationList, { result: answer, documentId: DOCUMENT_ID }));
    expect(html).toContain('Citations');
    expect(html).toContain('score');
    expect(html).toContain('Open clause');
  });

  it('lists the obligations found in the matched clauses', () => {
    const html = render(createElement(RelatedObligations, { result: answer }));
    expect(html).toContain('Pay undisputed invoices within 30 days.');
  });

  it('lists recent questions and renders nothing when there are none', () => {
    expect(render(createElement(AskHistory, { history: [] }))).toBe('');
    const html = render(
      createElement(AskHistory, {
        history: [
          { question: 'when must invoices be paid?', matched: true },
          { question: 'governing law', matched: false },
        ],
      }),
    );
    expect(html).toContain('when must invoices be paid?');
    expect(html).toContain('no match');
  });
});

