/**
 * Navigation model.
 *
 * One place that defines every route, its label, its icon and the breadcrumb it
 * produces, so a route cannot exist in the router without appearing in
 * navigation (and vice versa).
 */

import {
  ArrowLeftRight,
  CalendarClock,
  ClipboardCheck,
  FileSearch,
  FileText,
  LayoutDashboard,
  ListTree,
  MessageSquare,
  Network,
  ShieldCheck,
} from 'lucide-react';

export const ROUTES = Object.freeze({
  home: '/',
  documents: '/documents',
  workspace: '/workspace/:documentId',
  graph: '/workspace/:documentId/graph',
  timeline: '/workspace/:documentId/timeline',
  compare: '/workspace/:documentId/compare',
  ask: '/workspace/:documentId/ask',
  prepare: '/workspace/:documentId/prepare',
});

const encode = (documentId) => encodeURIComponent(documentId ?? '');

export const routeBuilders = Object.freeze({
  home: () => '/',
  documents: () => '/documents',
  workspace: (documentId) => `/workspace/${encode(documentId)}`,
  graph: (documentId) => `/workspace/${encode(documentId)}/graph`,
  timeline: (documentId) => `/workspace/${encode(documentId)}/timeline`,
  compare: (documentId) => `/workspace/${encode(documentId)}/compare`,
  ask: (documentId) => `/workspace/${encode(documentId)}/ask`,
  prepare: (documentId) => `/workspace/${encode(documentId)}/prepare`,
});

/** Application-level destinations shown in the sidebar. */
export const PRIMARY_NAV = Object.freeze([
  {
    id: 'overview',
    label: 'Overview',
    to: ROUTES.home,
    icon: LayoutDashboard,
    exact: true,
    description: 'What this workspace does, and what it does not do.',
  },
  {
    id: 'documents',
    label: 'Documents',
    to: ROUTES.documents,
    icon: FileText,
    description: 'Load the demo agreement or import your own document.',
  },
]);

/** Document-scoped destinations; each requires an active document. */
export const WORKSPACE_NAV = Object.freeze([
  {
    id: 'workspace',
    label: 'Document brief',
    toPattern: ROUTES.workspace,
    icon: FileSearch,
    description: 'Parties, clauses, obligations and findings for this document.',
  },
  {
    id: 'graph',
    label: 'Relationship graph',
    toPattern: ROUTES.graph,
    icon: Network,
    description: 'How parties, clauses, obligations, deadlines and risks connect.',
  },
  {
    id: 'timeline',
    label: 'Obligation timeline',
    toPattern: ROUTES.timeline,
    icon: CalendarClock,
    description: 'Dated deadlines resolved deterministically from the document.',
  },
  {
    id: 'compare',
    label: 'Version comparison',
    toPattern: ROUTES.compare,
    icon: ArrowLeftRight,
    description: 'Two versions of the agreement, change by change, with the impact of each change.',
  },
  {
    id: 'ask',
    label: 'Ask the document',
    toPattern: ROUTES.ask,
    icon: MessageSquare,
    description: 'Grounded questions answered only from extracted clauses.',
  },
  {
    id: 'prepare',
    label: 'Review preparation',
    toPattern: ROUTES.prepare,
    icon: ClipboardCheck,
    description: 'Checklist of open questions, gaps and items to confirm.',
  },
]);

export const SECTION_ICONS = Object.freeze({
  outline: ListTree,
  trust: ShieldCheck,
});

/** Resolves workspace navigation into concrete links for a document. */
export function workspaceLinks(documentId) {
  // Without a document there is no destination: returning unresolved patterns
  // would render dead links in the sidebar.
  if (!documentId) return [];
  return WORKSPACE_NAV.map((item) => ({
    ...item,
    to: item.toPattern.replace(':documentId', encode(documentId)),
  }));
}

/** True when `current` matches `to` (exact match unless `exact` is false). */
export function isActivePath(current, to, { exact = false } = {}) {
  if (!current || !to) return false;
  const normalize = (value) => (value.length > 1 ? value.replace(/\/+$/, '') : value);
  const a = normalize(current);
  const b = normalize(to);
  if (a === b) return true;
  return !exact && b !== '/' && a.startsWith(`${b}/`);
}

/**
 * Deep link to the reading view with one clause selected.
 *
 * Ask and Review preparation both cite clauses, and a citation is only checkable
 * if it can be opened: this keeps the query shape in one place so the workspace
 * and its callers cannot drift apart.
 */
export function clauseSourceLink(documentId, clauseId = null) {
  const base = routeBuilders.workspace(documentId);
  if (!clauseId) return base;
  return `${base}?view=reading&clause=${encodeURIComponent(clauseId)}`;
}

/** Extracts the document id and section from a workspace path. */
export function parseWorkspacePath(pathname) {
  const match = String(pathname ?? '').match(/^\/workspace\/([^/]+)(?:\/([a-z]+))?/);
  if (!match) return { documentId: null, section: null };
  return {
    documentId: decodeURIComponent(match[1]),
    section: match[2] ?? 'workspace',
  };
}

/** Builds breadcrumbs for the current location. */
export function buildBreadcrumbs(pathname, { documentTitle = null } = {}) {
  const crumbs = [{ label: 'Overview', to: routeBuilders.home() }];
  if (!pathname || pathname === '/') return crumbs;

  if (pathname.startsWith('/documents')) {
    return [...crumbs, { label: 'Documents', to: routeBuilders.documents() }];
  }

  const { documentId, section } = parseWorkspacePath(pathname);
  if (!documentId) return crumbs;

  const next = [
    ...crumbs,
    { label: 'Documents', to: routeBuilders.documents() },
    { label: documentTitle ?? 'Document', to: routeBuilders.workspace(documentId) },
  ];

  const tab = WORKSPACE_NAV.find((item) => item.id === section);
  if (tab && section !== 'workspace') next.push({ label: tab.label, to: null });
  return next;
}

/** Page eyebrow, title and subtitle per route. */
export function describeRoute(pathname, { documentTitle = null } = {}) {
  if (!pathname || pathname === '/') {
    return {
      eyebrow: 'Workspace',
      title: 'ClauseTrace',
      subtitle:
        'Read a contract as a connected set of obligations, deadlines and risks, with every fact traced back to the text that supports it.',
    };
  }
  if (pathname.startsWith('/documents')) {
    return {
      eyebrow: 'Library',
      title: 'Documents',
      subtitle: 'Load the fictional demo agreement or import your own PDF, text or Markdown file.',
    };
  }

  const { section } = parseWorkspacePath(pathname);
  const meta = {
    workspace: {
      eyebrow: 'Document brief',
      title: documentTitle ?? 'Document',
      subtitle: 'What the document says, what it requires, and what could not be verified.',
    },
    graph: {
      eyebrow: 'Structure',
      title: 'Relationship graph',
      subtitle:
        'Edges are derived deterministically from validated facts, so the graph only shows connections the model can justify.',
    },
    timeline: {
      eyebrow: 'Schedule',
      title: 'Obligation timeline',
      subtitle:
        'Deadlines resolved from dates and offsets in the document. Items without a resolvable date are listed separately.',
    },
    compare: {
      eyebrow: 'Comparison',
      title: 'Version comparison',
      subtitle:
        'Two versions of an agreement read side by side: what was added, removed or modified, and what each change is wired to.',
    },
    ask: {
      eyebrow: 'Grounded search',
      title: 'Ask the document',
      subtitle:
        'Questions are answered from extracted clauses only. When the document is silent, the answer says so.',
    },
    prepare: {
      eyebrow: 'Preparation',
      title: 'Review preparation',
      subtitle:
        'A checklist assembled from gaps, unresolved dates and flagged findings. Preparation, not legal advice.',
    },
  };
  return meta[section] ?? meta.workspace;
}
