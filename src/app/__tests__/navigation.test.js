import { describe, expect, it } from 'vitest';
import {
  PRIMARY_NAV,
  ROUTES,
  WORKSPACE_NAV,
  buildBreadcrumbs,
  clauseSourceLink,
  describeRoute,
  isActivePath,
  parseWorkspacePath,
  routeBuilders,
  workspaceLinks,
} from '../navigation.js';

describe('navigation: routes', () => {
  it('builds every route from its own pattern', () => {
    expect(routeBuilders.home()).toBe('/');
    expect(routeBuilders.documents()).toBe('/documents');
    expect(routeBuilders.workspace('doc_1')).toBe('/workspace/doc_1');
    expect(routeBuilders.graph('doc_1')).toBe('/workspace/doc_1/graph');
    expect(routeBuilders.timeline('doc_1')).toBe('/workspace/doc_1/timeline');
    expect(routeBuilders.compare('doc_1')).toBe('/workspace/doc_1/compare');
    expect(routeBuilders.ask('doc_1')).toBe('/workspace/doc_1/ask');
    expect(routeBuilders.prepare('doc_1')).toBe('/workspace/doc_1/prepare');
  });

  it('escapes ids so a route cannot be broken by punctuation', () => {
    expect(routeBuilders.workspace('a b/c')).toBe('/workspace/a%20b%2Fc');
    expect(routeBuilders.workspace(null)).toBe('/workspace/');
  });

  it('keeps the pattern list and the builder list in step', () => {
    expect(Object.keys(routeBuilders).sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it('gives every workspace tab a pattern that builds a readable link', () => {
    const links = workspaceLinks('doc_1');
    expect(links.map((link) => link.id)).toEqual(WORKSPACE_NAV.map((item) => item.id));
    for (const link of links) {
      expect(link.to).toMatch(/^\/workspace\/doc_1(\/[a-z]+)?$/);
      expect(link.label.length).toBeGreaterThan(0);
    }
    expect(workspaceLinks(null)).toEqual([]);
  });

  it('routes the ask and prepare tabs to their own pages', () => {
    const links = workspaceLinks('doc_1');
    expect(links.map((link) => link.to)).toContain('/workspace/doc_1/ask');
    expect(links.map((link) => link.to)).toContain('/workspace/doc_1/prepare');
    expect(links.find((link) => link.id === 'ask').label).toBe('Ask the document');
    expect(links.find((link) => link.id === 'prepare').label).toBe('Review preparation');
  });

  it('leaves no unresolved pattern in a built link', () => {
    for (const link of workspaceLinks('doc_1')) {
      expect(link.to).not.toContain(':documentId');
    }
  });

  it('describes every primary destination', () => {
    expect(PRIMARY_NAV.map((item) => item.to)).toEqual(['/', '/documents']);
    for (const item of [...PRIMARY_NAV, ...WORKSPACE_NAV]) {
      expect(item.description.length).toBeGreaterThan(10);
      expect(item.icon).toBeTruthy();
    }
  });
});

describe('navigation: active state', () => {
  it('matches exact routes only when exact is required', () => {
    expect(isActivePath('/', '/', { exact: true })).toBe(true);
    expect(isActivePath('/documents', '/', { exact: true })).toBe(false);
    expect(isActivePath('/workspace/doc_1', '/workspace/doc_1')).toBe(true);
    expect(isActivePath('/workspace/doc_1/graph', '/workspace/doc_1')).toBe(true);
    expect(isActivePath('/workspace/doc_2/graph', '/workspace/doc_1')).toBe(false);
  });

  it('ignores a trailing slash', () => {
    expect(isActivePath('/documents/', '/documents')).toBe(true);
    expect(isActivePath('/documents', '/')).toBe(false);
  });

  it('handles empty input', () => {
    // No current route means nothing is active.
    expect(isActivePath('', '')).toBe(false);
    expect(isActivePath(null, null)).toBe(false);
    expect(isActivePath(null, '/documents')).toBe(false);
  });
});

describe('navigation: path parsing', () => {
  it('extracts the document id and section', () => {
    expect(parseWorkspacePath('/workspace/doc_1')).toEqual({ documentId: 'doc_1', section: 'workspace' });
    expect(parseWorkspacePath('/workspace/doc_1/graph')).toEqual({ documentId: 'doc_1', section: 'graph' });
    expect(parseWorkspacePath('/workspace/a%20b/ask')).toEqual({ documentId: 'a b', section: 'ask' });
    expect(parseWorkspacePath('/documents')).toEqual({ documentId: null, section: null });
    expect(parseWorkspacePath(null)).toEqual({ documentId: null, section: null });
  });
});

describe('navigation: breadcrumbs and titles', () => {
  it('starts every trail at the overview', () => {
    expect(buildBreadcrumbs('/')).toEqual([{ label: 'Overview', to: '/' }]);
    expect(buildBreadcrumbs('/documents').map((crumb) => crumb.label)).toEqual([
      'Overview',
      'Documents',
    ]);
    expect(buildBreadcrumbs('/unknown')).toEqual([{ label: 'Overview', to: '/' }]);
  });

  it('uses the document title in workspace trails', () => {
    const crumbs = buildBreadcrumbs('/workspace/doc_1/graph', { documentTitle: 'Test Agreement' });
    expect(crumbs.map((crumb) => crumb.label)).toEqual([
      'Overview',
      'Documents',
      'Test Agreement',
      'Relationship graph',
    ]);
    expect(crumbs.at(-1).to).toBeNull();
    expect(crumbs[2].to).toBe('/workspace/doc_1');
  });

  it('does not repeat the document name on the brief tab', () => {
    const crumbs = buildBreadcrumbs('/workspace/doc_1', { documentTitle: 'Test Agreement' });
    expect(crumbs).toHaveLength(3);
    expect(crumbs.at(-1).to).toBe('/workspace/doc_1');
  });

  it('falls back to a placeholder title', () => {
    expect(
      buildBreadcrumbs('/workspace/doc_1/ask').map((crumb) => crumb.label),
    ).toEqual(['Overview', 'Documents', 'Document', 'Ask the document']);
  });

  it('describes each route for the page header', () => {
    expect(describeRoute('/').title).toBe('ClauseTrace');
    expect(describeRoute('/documents').eyebrow).toBe('Library');
    const paths = ['/workspace/d', '/workspace/d/graph', '/workspace/d/timeline', '/workspace/d/compare', '/workspace/d/ask', '/workspace/d/prepare'];
    const titles = paths.map((path) => describeRoute(path, { documentTitle: 'Test Agreement' }).title);
    expect(titles).toEqual([
      'Test Agreement',
      'Relationship graph',
      'Obligation timeline',
      'Version comparison',
      'Ask the document',
      'Review preparation',
    ]);
    for (const path of paths) {
      expect(describeRoute(path).subtitle.length).toBeGreaterThan(20);
    }
  });

  it('falls back to the brief description for an unknown section', () => {
    expect(describeRoute('/workspace/d/nonsense').eyebrow).toBe('Document brief');
  });
});

describe('navigation: clause source links', () => {
  it('links a citation back to the highlighted clause in the reading view', () => {
    expect(clauseSourceLink('doc_1', 'cl_payment')).toBe(
      '/workspace/doc_1?view=reading&clause=cl_payment',
    );
  });

  it('escapes the clause id so a link cannot be broken by punctuation', () => {
    expect(clauseSourceLink('doc_1', 'cl a/b')).toBe('/workspace/doc_1?view=reading&clause=cl%20a%2Fb');
  });

  it('falls back to the document itself without a clause', () => {
    expect(clauseSourceLink('doc_1')).toBe('/workspace/doc_1');
    expect(clauseSourceLink(null)).toBe('/workspace/');
  });
});
