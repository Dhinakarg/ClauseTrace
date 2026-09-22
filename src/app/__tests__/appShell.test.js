/**
 * Shell smoke tests.
 *
 * Renders the real component tree (provider, shell, routes, pages) with
 * react-dom/server. This catches wiring mistakes that unit tests cannot see —
 * a bad import path, a missing route, a component that reads state the provider
 * does not expose — without needing a browser.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App.jsx';

function render(path) {
  return renderToString(
    createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)),
  );
}

describe('app shell: rendering', () => {
  it('renders the overview with the product name and navigation', () => {
    const html = render('/');
    expect(html).toContain('ClauseTrace');
    expect(html).toContain('Documents');
    expect(html).toContain('Load the demo agreement');
  });

  it('renders the documents page', () => {
    const html = render('/documents');
    expect(html).toContain('Documents');
    expect(html).toContain('demo');
  });

  it('renders an honest empty state for a workspace link with no document', () => {
    const html = render('/workspace/doc_missing');
    expect(html).toContain('This document is not loaded');
    expect(html).not.toContain('Relationship graph');
  });

  it('renders the comparison route honestly when the document is not loaded', () => {
    const html = render('/workspace/doc_missing/compare');
    expect(html).toContain('This document is not loaded');
    expect(html).not.toContain('Version A');
  });

  it('renders the ask route honestly when the document is not loaded', () => {
    const html = render('/workspace/doc_missing/ask');
    expect(html).toContain('This document is not loaded');
    expect(html).not.toContain('How answers are produced');
  });

  it('renders the preparation route honestly when the document is not loaded', () => {
    const html = render('/workspace/doc_missing/prepare');
    expect(html).toContain('This document is not loaded');
    expect(html).not.toContain('Checklist items');
  });

  it('renders the not-found page for an unknown route', () => {
    const html = render('/definitely-not-a-route');
    expect(html).toContain('That page does not exist');
    expect(html).toContain('does not match any route');
  });

  it('always shows the legal disclaimer', () => {
    for (const path of ['/', '/documents', '/definitely-not-a-route']) {
      expect(render(path)).toContain('legal advice');
    }
  });

  it('does not leak an internal error message into a rendered page', () => {
    for (const path of [
      '/',
      '/documents',
      '/definitely-not-a-route',
      '/workspace/doc_missing/ask',
      '/workspace/doc_missing/prepare',
    ]) {
      const html = render(path);
      expect(html).not.toMatch(/Cannot read propert|undefined is not|is not a function/);
    }
  });
});
