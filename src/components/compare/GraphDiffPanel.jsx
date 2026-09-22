/**
 * GraphDiffPanel.
 *
 * The graph side of the comparison: which nodes were added, removed or changed,
 * and which relationships were added, removed or re-pointed. Selecting a row
 * shows the before/after reading, the source clauses and the citations of the
 * records at either end.
 */

import { Equal, Network } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { EmptyState, Panel } from '../ui/Panel.jsx';
import { EvidenceList } from '../legal/EvidenceList.jsx';

function RowButton({ row, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(row)}
      aria-current={selected ? 'true' : undefined}
      className={[
        'w-full rounded border px-2.5 py-2 text-left transition-colors',
        selected ? 'border-accent-300 bg-accent-50' : 'border-ink-100 bg-surface hover:bg-ink-50',
      ].join(' ')}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 text-sm font-medium text-ink-900">{row.label}</span>
        <Badge tone={row.tone}>{row.stateLabel}</Badge>
      </span>
      <span className="mt-1 block text-xs text-ink-600">{row.summary}</span>
    </button>
  );
}

function Group({ group, selectedId, onSelect }) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900">{group.label}</h3>
        <span className="text-xs text-ink-500">{group.rows.length}</span>
      </div>
      <ul className="space-y-1.5">
        {group.rows.map((row) => (
          <li key={row.id}>
            <RowButton row={row} selected={row.id === selectedId} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SelectionDetail({ node, edge, clauseNumberById }) {
  if (!node && !edge) {
    return (
      <p className="text-sm text-ink-500">Select a node or a relationship to read it in full.</p>
    );
  }
  const selected = node ?? edge;
  const title = node ? `${node.entityTypeLabel} “${node.label}”` : `${edge.typeLabel} relationship`;
  const fields = node?.fields ?? edge?.fields ?? [];
  const beforeDisplay = node ? node.beforeLabel : edge?.beforeDisplay;
  const afterDisplay = node ? node.afterLabel : edge?.afterDisplay;
  const clauseIds = selected.clauseIds ?? [];
  const evidence = selected.evidence ?? { before: [], after: [] };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={selected.tone}>{selected.stateLabel}</Badge>
        <span className="text-sm font-semibold text-ink-900">{title}</span>
      </div>
      <p className="text-sm text-ink-700">{selected.summary}</p>

      {beforeDisplay || afterDisplay ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded border border-ink-100 bg-ink-50/50 p-2.5">
            <p className="label-eyebrow">Version A</p>
            <p className="mt-0.5 text-sm text-ink-700">{beforeDisplay ?? 'not recorded'}</p>
          </div>
          <div className="rounded border border-ink-100 bg-ink-50/50 p-2.5">
            <p className="label-eyebrow">Version B</p>
            <p className="mt-0.5 text-sm text-ink-700">{afterDisplay ?? 'not recorded'}</p>
          </div>
        </div>
      ) : null}

      {fields.length > 0 ? (
        <ul className="space-y-1">
          {fields.map((field) => (
            <li key={field.field} className="text-xs text-ink-600">
              <span className="font-medium text-ink-800">{field.label}:</span>{' '}
              {field.before ?? 'not recorded'} → {field.after ?? 'not recorded'}
            </li>
          ))}
        </ul>
      ) : null}

      {clauseIds.length > 0 && clauseNumberById ? (
        <div>
          <p className="label-eyebrow">Source clauses</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {clauseIds.map((id) => (
              <li key={id}>
                <Badge tone="neutral">{clauseNumberById.get(id) ?? id}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className="label-eyebrow">Citations in version A</p>
          <div className="mt-1.5">
            <EvidenceList evidence={evidence.before} clauseNumberById={clauseNumberById} compact />
          </div>
        </div>
        <div>
          <p className="label-eyebrow">Citations in version B</p>
          <div className="mt-1.5">
            <EvidenceList evidence={evidence.after} clauseNumberById={clauseNumberById} compact />
          </div>
        </div>
      </div>
    </div>
  );
}

export function GraphDiffPanel({ graph, clauseNumberById = null, selectedRowId = null, onSelectRow }) {
  if (!graph || graph.empty) {
    return (
      <Panel title="Graph diff" subtitle="Nodes and relationships in both versions">
        <EmptyState
          icon={Equal}
          message="Neither version records any nodes or relationships, so there is no graph to compare."
        />
      </Panel>
    );
  }

  const selectedNode =
    graph.nodeGroups.flatMap((group) => group.rows).find((row) => row.id === selectedRowId) ?? null;
  const selectedEdge =
    graph.edgeGroups.flatMap((group) => group.rows).find((row) => row.id === selectedRowId) ?? null;

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel
        title="Graph nodes"
        subtitle="Records present in the two versions"
        actions={<Network aria-hidden="true" className="h-4 w-4 text-ink-400" />}
      >
        <div className="space-y-4">
          {graph.nodeGroups.map((group) => (
            <Group
              key={group.state}
              group={group}
              selectedId={selectedNode?.id ?? null}
              onSelect={onSelectRow}
            />
          ))}
        </div>
      </Panel>

      <div className="space-y-5">
        <Panel
          title="Relationships"
          subtitle="Edges added, removed or pointed somewhere else"
          actions={
            graph.relationshipCounts ? (
              <Badge tone="muted">{graph.relationshipCounts.total} total</Badge>
            ) : null
          }
        >
          <div className="space-y-4">
            {graph.edgeGroups.map((group) => (
              <Group
                key={group.state}
                group={group}
                selectedId={selectedEdge?.id ?? null}
                onSelect={onSelectRow}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Selected record" subtitle="Before, after, source clauses and citations">
          <SelectionDetail
            node={selectedNode}
            edge={selectedEdge}
            clauseNumberById={clauseNumberById}
          />
        </Panel>
      </div>
    </div>
  );
}

export default GraphDiffPanel;
