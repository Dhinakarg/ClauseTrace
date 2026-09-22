/**
 * SourceViewer.
 *
 * The reusable "return to source" surface: it renders the document's own text
 * with clause anchors, page markers and evidence highlights, and it can be told
 * to scroll to a clause or to a single citation.
 *
 * A viewer instance shares its focus target through `SourceViewProvider`, so a
 * button anywhere in the workspace can say "show me this quote in the document"
 * without prop-drilling offsets through every component in between.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { EmptyState } from '../ui/Panel.jsx';
import { clauseTypeLabel } from '../../legal/clauseTypes.js';
import {
  blockWindow,
  buildSourceBlocks,
  findBlockIndexForOffset,
  segmentsForBlock,
} from './sourceView.js';

const SourceViewContext = createContext(null);

/** No-op value used when a viewer is rendered without its provider. */
const IDLE_SOURCE_VIEW = Object.freeze({
  target: null,
  focusClause: () => {},
  focusEvidence: () => {},
  clearFocus: () => {},
});

export function SourceViewProvider({ children }) {
  const [target, setTarget] = useState(null);

  const focusClause = useCallback((clauseId) => {
    setTarget({ kind: 'clause', clauseId, offset: null, nonce: Date.now() });
  }, []);

  const focusEvidence = useCallback(({ clauseId = null, reference = null } = {}) => {
    setTarget({
      kind: 'evidence',
      clauseId,
      offset: Number.isInteger(reference?.startOffset) ? reference.startOffset : null,
      referenceId: reference?.id ?? null,
      nonce: Date.now(),
    });
  }, []);

  const clearFocus = useCallback(() => setTarget(null), []);

  const value = useMemo(
    () => ({ target, focusClause, focusEvidence, clearFocus }),
    [target, focusClause, focusEvidence, clearFocus],
  );

  return <SourceViewContext.Provider value={value}>{children}</SourceViewContext.Provider>;
}

export function useSourceView() {
  return useContext(SourceViewContext) ?? IDLE_SOURCE_VIEW;
}

/** Where the viewer should scroll, resolved from a focus target. */
export function resolveFocusOffset(target, clauses = []) {
  if (!target) return null;
  if (Number.isInteger(target.offset)) return target.offset;
  const clause = clauses.find((entry) => entry.id === target.clauseId);
  return Number.isInteger(clause?.startOffset) ? clause.startOffset : null;
}

export function SourceViewer({
  content = null,
  clauses = [],
  highlights = [],
  emptyMessage = 'No parsed text is available for this document.',
  maxHeightClass = 'max-h-[65vh]',
}) {
  const { target, focusClause } = useSourceView();
  const blockRefs = useRef(new Map());

  const blocks = useMemo(() => buildSourceBlocks(content, clauses), [content, clauses]);
  const focusOffset = resolveFocusOffset(target, clauses);
  const focusIndex = findBlockIndexForOffset(blocks, focusOffset);
  const windowRange = useMemo(() => blockWindow(blocks, focusIndex), [blocks, focusIndex]);
  const visible = blocks.slice(windowRange.start, windowRange.end);

  useEffect(() => {
    if (focusIndex < 0) return;
    const node = blockRefs.current.get(focusIndex);
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focusIndex, target?.nonce]);

  if (!content?.text) {
    return <EmptyState icon={FileText} message={emptyMessage} />;
  }

  return (
    <div className={['overflow-auto rounded border border-ink-200 bg-surface', maxHeightClass].join(' ')}>
      {windowRange.hiddenBefore > 0 ? (
        <p className="border-b border-ink-100 px-4 py-2 text-2xs text-ink-500">
          {windowRange.hiddenBefore} earlier paragraph(s) hidden while a selection is focused.
        </p>
      ) : null}

      <ol className="divide-y divide-ink-100">
        {visible.map((block) => {
          const segments = segmentsForBlock(block, highlights);
          const isFocused = target?.clauseId ? block.clauseId === target.clauseId : false;
          return (
            <li
              key={block.index}
              ref={(node) => {
                if (node) blockRefs.current.set(block.index, node);
                else blockRefs.current.delete(block.index);
              }}
              className={['px-4 py-3', isFocused ? 'bg-accent-50/60' : ''].join(' ').trim()}
            >
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <Badge tone="muted">p. {block.page ?? '—'}</Badge>
                {block.clauseNumber ? (
                  <button
                    type="button"
                    onClick={() => focusClause(block.clauseId)}
                    className="text-2xs font-semibold uppercase tracking-label text-accent-600 hover:text-accent-700"
                    title="Focus this clause"
                  >
                    §{block.clauseNumber}
                    {block.clauseHeading ? ` · ${block.clauseHeading}` : ''}
                  </button>
                ) : (
                  <span className="text-2xs font-semibold uppercase tracking-label text-ink-400">
                    unnumbered
                  </span>
                )}
                {block.clauseType && block.clauseType !== 'unknown' ? (
                  <Badge tone="neutral">{clauseTypeLabel(block.clauseType)}</Badge>
                ) : null}
              </div>

              <p className="font-serif text-[0.95rem] leading-relaxed text-ink-800 break-words whitespace-pre-wrap">
                {segments.map((segment, index) => {
                  if (!segment.highlighted) {
                    return <span key={`${block.index}-${index}`}>{segment.text}</span>;
                  }
                  const tone =
                    segment.kind === 'evidence'
                      ? segment.verified
                        ? 'bg-positive-100 text-ink-900'
                        : 'bg-flag-100 text-ink-900'
                      : 'bg-accent-100 text-ink-900';
                  return (
                    <mark key={`${block.index}-${index}`} className={tone} title={segment.kind}>
                      {segment.text}
                    </mark>
                  );
                })}
              </p>
            </li>
          );
        })}
      </ol>

      {windowRange.hiddenAfter > 0 ? (
        <p className="border-t border-ink-100 px-4 py-2 text-2xs text-ink-500">
          {windowRange.hiddenAfter} later paragraph(s) hidden. Clear the selection to read the whole
          document.
        </p>
      ) : null}
    </div>
  );
}

export default SourceViewer;
