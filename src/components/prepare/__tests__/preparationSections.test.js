/**
 * Preparation section smoke tests.
 *
 * The sections are pure views over `buildPreparationPlan`, so rendering a real
 * plan (derived from the fixture model) catches a broken prop, a bad import or a
 * crash here instead of in the browser.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import {
  MarkAllDoneButton,
  PreparationItem,
  PreparationSectionList,
  PreparationSectionPanel,
  PreparationTiles,
} from '../PreparationSections.jsx';
import { compareModels } from '../../../legal/compareEngine.js';
import { buildPreparationPlan } from '../../../legal/reviewChecklist.js';
import { buildValidModel } from '../../../legal/__tests__/fixtures.js';

const model = buildValidModel();
const DOCUMENT_ID = 'doc_test_agreement';
const TODAY = { today: new Date('2026-01-15T00:00:00Z') };
const plan = buildPreparationPlan(model, null, TODAY);
const NO_TAGS = { replace: null };

function render(element) {
  return renderToString(
    createElement(StaticRouter, { location: '/workspace/doc_test_agreement/prepare' }, element),
  );
}

function sectionOf(source, id) {
  return source.sections.find((section) => section.id === id);
}

/** Version B: the payment deadline is shortened, so there is a change to discuss. */
function comparisonPlan() {
  const copy = JSON.parse(JSON.stringify(model));
  copy.deadlines.find((entry) => entry.id === 'dl_payment').offsetAmount = 15;
  return buildPreparationPlan(model, null, {
    ...TODAY,
    comparison: compareModels(model, copy),
    comparisonLabels: { a: 'Test Agreement', b: 'Test Agreement v2' },
  });
}

describe('prepare sections: plan rendering', () => {
  it('renders all four sections with their labels and descriptions', () => {
    const html = render(
      createElement(PreparationSectionList, { plan, documentId: DOCUMENT_ID, checkedIds: NO_TAGS }),
    );
    expect(html).toContain('Questions to ask');
    expect(html).toContain('Facts to gather');
    expect(html).toContain('Clauses to discuss');
    expect(html).toContain('Changes to discuss');
    expect(html).toContain('Load a second version');
  });

  it('renders nothing without a plan', () => {
    expect(render(createElement(PreparationSectionList, { plan: null }))).toBe('');
  });

  it('renders a question item as the question to ask', () => {
    const questions = sectionOf(plan, 'questions');
    const html = render(
      createElement(PreparationSectionPanel, {
        section: questions,
        documentId: DOCUMENT_ID,
        checkedIds: NO_TAGS,
      }),
    );
    expect(html).toContain('When must');
    expect(html).toContain('item');
    expect(html).toContain('medium');
  });

  it('links a clause item back to the highlighted source text', () => {
    const clauses = sectionOf(plan, 'clauses');
    const html = render(
      createElement(PreparationSectionPanel, {
        section: clauses,
        documentId: DOCUMENT_ID,
        checkedIds: NO_TAGS,
      }),
    );
    expect(html).toContain('Read the clause');
    expect(html).toContain('/workspace/doc_test_agreement?view=reading&amp;clause=cl_confidentiality');
  });

  it('lists the changes with what each one reaches', () => {
    const source = comparisonPlan();
    const html = render(
      createElement(PreparationSectionPanel, {
        section: sectionOf(source, 'changes'),
        documentId: DOCUMENT_ID,
        checkedIds: NO_TAGS,
      }),
    );
    expect(html).toMatch(/Modified|Added|Removed/);
    expect(html).toMatch(/reaches|not wired to any other record/);
  });
});

describe('prepare sections: items, tiles and quirks', () => {
  it('marks an item as done when its id is in the checked set', () => {
    const item = sectionOf(plan, 'facts').items[0];
    const unchecked = render(
      createElement(PreparationItem, { item, checked: false, onToggle: () => {}, documentId: DOCUMENT_ID }),
    );
    const checked = render(
      createElement(PreparationItem, { item, checked: true, onToggle: () => {}, documentId: DOCUMENT_ID }),
    );
    expect(unchecked).toContain('aria-pressed="false"');
    expect(checked).toContain('aria-pressed="true"');
  });

  it('shows the section note when a section is empty', () => {
    const html = render(
      createElement(PreparationSectionPanel, {
        section: sectionOf(plan, 'changes'),
        documentId: DOCUMENT_ID,
        checkedIds: NO_TAGS,
      }),
    );
    expect(html).toContain('Load a second version of the agreement');
  });

  it('summarises the plan in the header tiles', () => {
    const html = render(createElement(PreparationTiles, { plan, checkedCount: 2 }));
    expect(html).toContain('Checklist items');
    expect(html).toContain('Marked done');
    expect(html).toContain('Changes to discuss');
    expect(html).toContain('No second version loaded');
    expect(html).toContain('questions');
  });

  it('names the compared versions in the tiles when a comparison ran', () => {
    const html = render(createElement(PreparationTiles, { plan: comparisonPlan(), checkedCount: 0 }));
    expect(html).toContain('Test Agreement');
    expect(html).toContain('Test Agreement v2');
  });

  it('offers a mark-all-done button only while items are outstanding', () => {
    expect(render(createElement(MarkAllDoneButton, { pending: 0 }))).toBe('');
    const html = render(createElement(MarkAllDoneButton, { pending: 3, onMarkAll: () => {} }));
    expect(html).toContain('Mark all done');
  });
});

