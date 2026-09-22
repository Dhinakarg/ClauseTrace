/**
 * Version picker and version summary cards.
 *
 * The comparison is between two versions of the same agreement, so the picker is
 * deliberately neutral: Version A and Version B, no "old/new" or "before/after"
 * language that would imply one of them is the current truth.
 */

import { ArrowLeftRight, FileText } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { Callout, DefinitionList, KeyValue, Panel } from '../ui/Panel.jsx';
import { formatDate } from '../legal/presentation.js';

const COUNT_LABELS = Object.freeze({
  clauses: 'Clauses',
  obligations: 'Obligations',
  rights: 'Rights',
  deadlines: 'Deadlines',
  conditions: 'Conditions',
  consequences: 'Consequences',
  parties: 'Parties',
  definitions: 'Definitions',
  relationships: 'Relationships',
});

export function VersionPicker({
  documents = [],
  versionAId = null,
  versionBId = null,
  onSelectA,
  onSelectB,
  notice = null,
}) {
  const fields = [
    { id: 'version-a', label: 'Version A', value: versionAId, onChange: onSelectA },
    { id: 'version-b', label: 'Version B', value: versionBId, onChange: onSelectB },
  ];

  return (
    <Panel
      title="Choose two versions"
      subtitle="Version A is the earlier reading and version B is the later one. Neither is treated as better."
      actions={<ArrowLeftRight aria-hidden="true" className="h-4 w-4 text-ink-400" />}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.id}>
            <label htmlFor={field.id} className="field-label">
              {field.label}
            </label>
            <select
              id={field.id}
              className="input"
              value={field.value ?? ''}
              onChange={(event) => field.onChange?.(event.target.value)}
            >
              <option value="">Select a document…</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                  {document.effectiveDate ? ` — effective ${formatDate(document.effectiveDate)}` : ''}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {notice ? (
        <Callout tone="warning" className="mt-3">
          {notice}
        </Callout>
      ) : null}
    </Panel>
  );
}

export function VersionCard({ label, version = null, documentSummary = null, side = 'a' }) {
  if (!version) {
    return (
      <Panel title={label} subtitle="Not selected">
        <p className="text-sm text-ink-500">Choose a document for {label} to compare it.</p>
      </Panel>
    );
  }

  const counts = version.counts ?? {};
  return (
    <Panel
      title={label}
      subtitle={version.title ?? 'Untitled document'}
      actions={
        <Badge tone={side === 'a' ? 'neutral' : 'accent'}>
          {version.entityCount ?? 0} records
        </Badge>
      }
    >
      <DefinitionList>
        <KeyValue label="Source">
          <span className="inline-flex items-center gap-1.5">
            <FileText aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />
            {documentSummary?.source ?? 'unknown'}
          </span>
        </KeyValue>
        <KeyValue label="Effective date">
          {documentSummary?.effectiveDate ? formatDate(documentSummary.effectiveDate) : 'not stated'}
        </KeyValue>
      </DefinitionList>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(COUNT_LABELS).map(([key, text]) => (
          <li key={key}>
            <Badge tone={counts[key] ? 'neutral' : 'muted'}>
              {text} {counts[key] ?? 0}
            </Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default VersionPicker;
