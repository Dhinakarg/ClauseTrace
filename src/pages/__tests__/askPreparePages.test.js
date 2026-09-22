/**
 * Page-level smoke tests for the Phase 5 pages.
 *
 * The pages are rendered inside the real provider with an empty store, which is
 * the state the app actually starts in: no document loaded. That is the cheapest
 * honest render of both modules — a bad import, a selector that reads a field the
 * store does not have, or a hook ordered after an early return all fail here.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../../app/AppProvider.jsx';
import { EMPTY_STATES } from '../../content/notices.js';
import AskPage from '../AskPage.jsx';
import PreparePage from '../PreparePage.jsx';

function render(element) {
  return renderToString(
    createElement(MemoryRouter, null, createElement(AppProvider, null, element)),
  );
}

describe('ask page: empty store', () => {
  const html = render(createElement(AskPage));

  it('states that there is nothing to ask about yet', () => {
    expect(html).toContain(EMPTY_STATES.noModel);
  });

  it('does not promise an answer it cannot ground', () => {
    expect(html).not.toContain('How answers are produced');
    expect(html).not.toContain('Clauses considered');
  });
});

describe('prepare page: empty store', () => {
  const html = render(createElement(PreparePage));

  it('states that there is nothing to prepare yet', () => {
    expect(html).toContain(EMPTY_STATES.noModel);
  });

  it('does not show an empty checklist as if it were a result', () => {
    expect(html).not.toContain('Checklist items');
    expect(html).not.toContain('Extraction report');
  });
});
