/**
 * CommandBar — document search.
 *
 * Scope is honest: it searches the TEXT OF THE LOADED DOCUMENT and the
 * extracted clauses. It is not a global index, and it says so when there is
 * nothing to search. Results are plain data from `findTextMatches`; nothing is
 * rendered as HTML.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { findTextMatches } from '../../documents/parser.js';
import { routeBuilders } from '../../app/navigation.js';
import { selectActiveEntry, selectModel } from '../../state/selectors.js';
import { useAppStore } from '../../app/AppProvider.jsx';

export function CommandBar() {
  const state = useAppStore();
  const navigate = useNavigate();
  const entry = selectActiveEntry(state);
  const model = selectModel(state);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const matches = useMemo(() => {
    if (!entry?.content || query.trim().length < 3) return [];
    return findTextMatches(entry.content, query.trim(), { limit: 6 });
  }, [entry?.content, query]);

  const clauseHits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!entry?.content || needle.length < 3) return [];
    return (model?.clauses ?? [])
      .filter((clause) => clause.text?.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((clause) => ({
        id: clause.id,
        number: clause.number,
        heading: clause.heading,
        page: clause.page,
      }));
  }, [entry?.content, model, query]);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const documentId = entry?.id ?? null;
  const canSearch = Boolean(entry?.content);

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <label htmlFor="document-search" className="sr-only">
        Search this document
      </label>
      <div className="flex items-center gap-2 rounded border border-ink-200 bg-surface px-2.5 py-1.5 focus-within:border-accent-500">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-400" />
        <input
          id="document-search"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={canSearch ? 'Search this document…' : 'Load a document to search it'}
          className="w-full bg-transparent text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
          disabled={!canSearch}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
            className="rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            aria-label="Clear search"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && query.trim().length >= 3 ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-96 overflow-y-auto rounded border border-ink-200 bg-surface p-2 shadow-overlay">
          {matches.length === 0 && clauseHits.length === 0 ? (
            <p className="px-2 py-3 text-sm text-ink-600">
              No matches for “{query.trim()}” in this document.
            </p>
          ) : null}

          {clauseHits.length > 0 ? (
            <>
              <p className="px-2 py-1 label-eyebrow">Extracted clauses</p>
              <ul className="mb-2">
                {clauseHits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => {
                        navigate(routeBuilders.workspace(documentId));
                        setOpen(false);
                      }}
                      className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-ink-50"
                    >
                      <span className="font-mono text-xs text-ink-500">{hit.number ?? '·'}</span>
                      <span className="ml-2 text-ink-800">{hit.heading ?? 'Text block'}</span>
                      <span className="ml-2 text-xs text-ink-500">page {hit.page ?? '—'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {matches.length > 0 ? (
            <>
              <p className="px-2 py-1 label-eyebrow">Document text</p>
              <ul>
                {matches.map((match) => (
                  <li key={`${match.startOffset}-${match.endOffset}`}>
                    <button
                      type="button"
                      onClick={() => {
                        navigate(routeBuilders.workspace(documentId));
                        setOpen(false);
                      }}
                      className="w-full rounded px-2 py-1.5 text-left hover:bg-ink-50"
                    >
                      <span className="text-xs text-ink-500">
                        page {match.page ?? '—'} · chars {match.startOffset}–{match.endOffset}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-800">{match.excerpt}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default CommandBar;
