/**
 * HomePage — overview of the workspace.
 *
 * Explains the product's core contract (AI proposes, code verifies), what it
 * will not do, and gets a reader into the demo in one click.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, Network, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { Callout, Panel, StatTile } from '../components/ui/Panel.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { DISCLAIMER_LONG, TRUST_NOTE } from '../content/notices.js';
import { routeBuilders } from '../app/navigation.js';
import { useAppState, useAppStore } from '../app/AppProvider.jsx';
import { selectDocumentSummaries, selectWorkspaceSummary } from '../state/selectors.js';

const PIPELINE = [
  {
    id: 'parse',
    title: '1. Parse',
    body: 'PDF, text or Markdown is read into page-indexed text. Clause numbers and headings become a clause skeleton with character offsets.',
  },
  {
    id: 'propose',
    title: '2. Propose',
    body: 'An AI provider proposes parties, obligations, conditions, deadlines, consequences, risks and inconsistencies as structured data, each with a quoted source passage.',
  },
  {
    id: 'verify',
    title: '3. Verify',
    body: 'Application code checks every citation against the parsed text. Facts whose quotes cannot be found are rejected, not displayed.',
  },
  {
    id: 'validate',
    title: '4. Validate and connect',
    body: 'Types, enums, references and relationship endpoints are validated, then the relationships implied by those facts are derived so the graph is complete and traversable.',
  },
];

export function HomePage() {
  const state = useAppStore();
  const { loadDemoWorkspace } = useAppState();
  const navigate = useNavigate();
  const summary = selectWorkspaceSummary(state);
  const documents = selectDocumentSummaries(state);

  const handleLoadDemo = async () => {
    await loadDemoWorkspace();
    navigate(routeBuilders.documents());
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Documents loaded"
          value={documents.length}
          hint={documents.length === 0 ? 'Nothing loaded in this session' : 'This session only'}
        />
        <StatTile
          label="Obligations"
          value={summary.counts?.obligations ?? null}
          hint={summary.ready ? 'Extracted and validated' : 'Load a document to extract'}
        />
        <StatTile
          label="Verified citations"
          value={summary.coverage ? `${summary.coverage.verified}/${summary.coverage.total}` : null}
          hint="Facts whose quoted text was found in the document"
        />
        <StatTile
          label="Open gaps"
          value={summary.gaps?.length ?? 0}
          tone={summary.gaps?.length > 0 ? 'warning' : 'neutral'}
          hint="Unresolved dates, missing citations and flagged issues"
        />
      </div>

      <Panel title="Get Started with ClauseTrace" subtitle="Evidence-backed legal document intelligence workspace">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-ink-900">Browser-only Contract Analysis</p>
            <p className="text-xs text-ink-600">
              Load a contract to extract parties, obligations, deadlines, risk signals, and relationship graphs with verified text citations.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5 shrink-0">
            <Button
              variant="primary"
              icon={FileText}
              onClick={handleLoadDemo}
              className="justify-center"
            >
              Load demo agreement
            </Button>
            <Button
              icon={ArrowRight}
              className="justify-center"
              onClick={() => navigate(routeBuilders.documents())}
            >
              Import document
            </Button>
          </div>
        </div>
      </Panel>

      {summary.ready ? (
        <Panel
          title="Continue where you are"
          subtitle={`${summary.counts?.clauses ?? 0} clauses · ${summary.counts?.parties ?? 0} parties · ${summary.graphStats?.relationshipCount ?? 0} relationships`}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={FileText}
              onClick={() => navigate(routeBuilders.workspace(summary.entry.id))}
            >
              Open document brief
            </Button>
            <Button icon={Network} onClick={() => navigate(routeBuilders.graph(summary.entry.id))}>
              Relationship graph
            </Button>
            <Button onClick={() => navigate(routeBuilders.timeline(summary.entry.id))}>
              Obligation timeline
            </Button>
            <Button onClick={() => navigate(routeBuilders.prepare(summary.entry.id))}>
              Review preparation
            </Button>
          </div>
          {summary.gaps?.length > 0 ? (
            <div className="mt-3 space-y-2">
              {summary.gaps.slice(0, 3).map((gap) => (
                <p key={gap.code} className="flex items-start gap-2 text-sm text-ink-700">
                  <Badge tone={gap.severity === 'warning' ? 'warning' : 'neutral'}>{gap.severity}</Badge>
                  {gap.message}
                </p>
              ))}
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Callout tone="info" title="Boundaries">
        {DISCLAIMER_LONG}
      </Callout>
    </div>
  );
}

export default HomePage;
