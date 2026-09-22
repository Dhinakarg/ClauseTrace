/**
 * PreparePage — review preparation.
 *
 * Four sections, assembled deterministically from what the pipeline already
 * knows and (when a second version is loaded) from the comparison between the
 * two: questions to ask, facts to gather, clauses to discuss, changes to
 * discuss. Everything is a preparation aid, never a conclusion — the wording in
 * `legal/reviewChecklist.js` is written that way and this page does not add to it.
 *
 * The extraction report stays on the page: a checklist built on a partial
 * extraction should show how partial it is.
 */

import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, ClipboardCopy, Download } from 'lucide-react';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Callout, EmptyState, Panel } from '../components/ui/Panel.jsx';
import {
  MarkAllDoneButton,
  PreparationSectionList,
  PreparationTiles,
} from '../components/prepare/PreparationSections.jsx';
import { EMPTY_STATES } from '../content/notices.js';
import { compareModels } from '../legal/compareEngine.js';
import {
  PREPARE_DISCLAIMER,
  buildPreparationPlan,
  preparationToText,
  summarizePreparation,
} from '../legal/reviewChecklist.js';
import { useAppState, useAppStore } from '../app/AppProvider.jsx';
import {
  selectDocumentSummaries,
  selectModel,
  selectTrustSummary,
  selectWorkspaceSummary,
} from '../state/selectors.js';

/** File-name-safe slug for the exported checklist. */
function slugify(value, fallback = 'document') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

export function PreparePage() {
  const state = useAppStore();
  const { pushNotice } = useAppState();
  const summary = selectWorkspaceSummary(state);
  const trust = selectTrustSummary(state);
  const documents = useMemo(() => selectDocumentSummaries(state), [state]);
  const activeId = summary.entry?.id ?? state.activeDocumentId ?? null;

  const others = useMemo(
    () => documents.filter((document) => document.id !== activeId),
    [documents, activeId],
  );

  const [partnerId, setPartnerId] = useState(null);
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const [copied, setCopied] = useState(false);

  // Keep the comparison partner pointing at a document that exists.
  useEffect(() => {
    if (!others.some((document) => document.id === partnerId)) {
      setPartnerId(others[0]?.id ?? null);
    }
  }, [others, partnerId]);

  const partner = others.find((document) => document.id === partnerId) ?? null;
  const partnerModel = useMemo(() => selectModel(state, partnerId), [state, partnerId]);
  const activeTitle = summary.entry?.model?.documents?.[0]?.title ?? summary.entry?.content?.fileName ?? null;

  const comparison = useMemo(
    () => (summary.model && partnerModel ? compareModels(summary.model, partnerModel) : null),
    [summary.model, partnerModel],
  );

  const plan = useMemo(
    () =>
      summary.model
        ? buildPreparationPlan(summary.model, summary.report, {
            comparison,
            comparisonLabels: { a: activeTitle, b: partner?.title ?? null },
          })
        : null,
    [summary.model, summary.report, comparison, activeTitle, partner],
  );

  const summaryCounts = useMemo(() => summarizePreparation(plan), [plan]);
  const doneCount = plan
    ? plan.sections.reduce(
        (total, section) => total + section.items.filter((item) => checkedIds.has(item.id)).length,
        0,
      )
    : 0;

  const toggle = (id) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const markSectionDone = (section) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      for (const item of section.items) next.add(item.id);
      return next;
    });
  };

  const exportText = () => preparationToText(plan, { title: 'Review preparation' });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportText());
      setCopied(true);
      pushNotice({
        level: 'success',
        message: 'Preparation checklist copied to the clipboard as plain text.',
      });
      setTimeout(() => setCopied(false), 2500);
    } catch (error) {
      pushNotice({
        level: 'warning',
        message: `Clipboard access was blocked (${error?.message ?? 'unknown error'}). Use the download instead.`,
      });
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([exportText()], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${slugify(activeTitle)}-review-preparation.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      pushNotice({ level: 'success', message: 'Preparation checklist downloaded as Markdown.' });
    } catch (error) {
      pushNotice({
        level: 'warning',
        message: `The checklist could not be downloaded (${error?.message ?? 'unknown error'}).`,
      });
    }
  };

  const sectionActions = plan
    ? Object.fromEntries(
        plan.sections
          .filter((section) => section.items.length > 0)
          .map((section) => [
            section.id,
            <MarkAllDoneButton
              key={section.id}
              pending={section.items.filter((item) => !checkedIds.has(item.id)).length}
              onMarkAll={() => markSectionDone(section)}
            />,
          ]),
      )
    : {};

  const evidence = trust.evidence;

  if (!summary.ready) {
    return <EmptyState icon={ClipboardCheck} message={EMPTY_STATES.noModel} />;
  }

  return (
    <div className="space-y-5">
      <PreparationTiles
        plan={plan}
        summary={summaryCounts}
        checkedCount={doneCount}
        evidence={evidence}
      />

      <Panel
        title="Review prep checklist"
        subtitle="Built from this document, its findings and any second version you have loaded"
        actions={
          <>
            <Button size="sm" icon={ClipboardCopy} onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy as text'}
            </Button>
            <Button size="sm" icon={Download} onClick={handleDownload}>
              Download
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0">
              <p className="label-eyebrow">Version compared</p>
              <p className="mt-1 text-sm text-ink-800">
                {partner
                  ? `${activeTitle ?? 'This document'} → ${partner.title}`
                  : 'No second version is loaded, so no changes can be listed.'}
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                Changes are reported structurally, with the records each one reaches. Nothing here
                says one version is better than the other.
              </p>
            </div>
            {others.length > 0 ? (
              <div className="min-w-[220px]">
                <label htmlFor="prepare-partner" className="field-label">
                  Compare against
                </label>
                <select
                  id="prepare-partner"
                  className="input"
                  value={partnerId ?? ''}
                  onChange={(event) => setPartnerId(event.target.value || null)}
                >
                  {others.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.title}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <PreparationSectionList
            plan={plan}
            checkedIds={checkedIds}
            onToggle={toggle}
            documentId={activeId}
            sectionActions={sectionActions}
          />
        </div>
      </Panel>


      <Panel
        title="Extraction report"
        subtitle="What the pipeline proposed, verified and refused to accept"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded border border-ink-200 p-2.5 text-sm">
            <p className="label-eyebrow">Evidence</p>
            <p className="mt-1 text-ink-800">
              {evidence?.checkedEntities ?? 0} fact(s) checked against the parsed text
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              {evidence?.verifiedEntities ?? 0} kept with verified source text ·{' '}
              {evidence?.rejectedEntities ?? 0} dropped
            </p>
          </div>
          <div className="rounded border border-ink-200 p-2.5 text-sm">
            <p className="label-eyebrow">Validation</p>
            <p className="mt-1 text-ink-800">
              {trust.validation?.errorCount ?? 0} error(s) · {trust.validation?.warningCount ?? 0}{' '}
              warning(s)
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              {trust.counts?.derivedRelationshipCount ?? 0} relationship(s) derived deterministically
            </p>
          </div>
          <div className="rounded border border-ink-200 p-2.5 text-sm">
            <p className="label-eyebrow">Prompt safety</p>
            <p className="mt-1 text-ink-800">
              {trust.injectionWarnings.length} instruction-like passage(s)
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              Neutralised before the text was sent for analysis
            </p>
          </div>
        </div>

        {Object.keys(trust.dropped).length > 0 ? (
          <div className="mt-4">
            <p className="label-eyebrow">Dropped by the response parser</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {Object.entries(trust.dropped).map(([collection, count]) => (
                <li key={collection}>
                  <Badge tone="warning">
                    {collection}: {count}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {trust.validationWarnings.length > 0 ? (
          <div className="mt-4">
            <p className="label-eyebrow">Validation warnings (first 6)</p>
            <ul className="mt-1 space-y-1 text-xs text-ink-600">
              {trust.validationWarnings.slice(0, 6).map((warning, index) => (
                <li key={`${warning.code}-${index}`}>
                  {warning.code}: {warning.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Callout tone="warning" title="What this page is for">
        <p>{PREPARE_DISCLAIMER}</p>
        <p className="mt-1">
          Every item is written so it can be checked: a question is something to ask, a fact is
          something to look up, and a clause or change links back to the text it came from. Nothing
          here decides anything for you.
        </p>
      </Callout>
    </div>
  );
}

export default PreparePage;

