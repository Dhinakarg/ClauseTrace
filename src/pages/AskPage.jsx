/**
 * AskPage — grounded questions over one document.
 *
 * The page owns only presentation and session state. A question travels through
 * `ai/askService.js`: deterministic retrieval and citation validation first, then
 * the AI reading, which is shown only when the prose it returned cites clauses
 * that were supplied to it and exist in this document.
 *
 * That order is the point. The extractive answer with its quotes stands on its
 * own; the AI half is additive and is labelled as unverified.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Callout, EmptyState, LoadingBlock } from '../components/ui/Panel.jsx';
import {
  AiReadingPanel,
  AnswerPanel,
  AskHistory,
  AskQuestionForm,
  CitationList,
  EvidencePanel,
  QuestionSafetyNotice,
  RelatedObligations,
} from '../components/ask/AskPanels.jsx';
import { clauseNumberMap } from '../components/legal/presentation.js';
import { EMPTY_STATES } from '../content/notices.js';
import { LIMITS } from '../security/limits.js';
import { ASK_DISCLAIMER, suggestQuestions } from '../legal/askEngine.js';
import { useAppState, useAppStore } from '../app/AppProvider.jsx';
import { selectWorkspaceSummary } from '../state/selectors.js';

const MAX_HISTORY = 6;

export function AskPage() {
  const state = useAppStore();
  const { askDocument, pushNotice } = useAppState();
  const summary = selectWorkspaceSummary(state);

  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState([]);
  const abortRef = useRef(null);

  const clauseNumbers = useMemo(() => clauseNumberMap(summary.model), [summary.model]);
  const suggestions = useMemo(
    () => (summary.model ? suggestQuestions(summary.model) : []),
    [summary.model],
  );

  // Abandon an in-flight question when the page goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(
    async (value) => {
      const query = String(typeof value === 'string' ? value : question).trim();
      if (!query) return;
      setQuestion(query);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setPending(true);
      try {
        const answer = await askDocument({ question: query, signal: controller.signal });
        if (controller.signal.aborted || !answer) return;
        setResult(answer);
        setHistory((current) =>
          [
            { question: answer.question, matched: answer.matched },
            ...current.filter((entry) => entry.question !== answer.question),
          ].slice(0, MAX_HISTORY),
        );
      } catch (error) {
        if (error?.name === 'AbortError') return;
        pushNotice({
          level: 'error',
          message: `The question could not be answered: ${error?.message}`,
        });
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    },
    [askDocument, pushNotice, question],
  );

  if (!summary.ready) {
    return <EmptyState icon={MessageSquare} message={EMPTY_STATES.noModel} />;
  }

  const documentId = summary.entry?.id ?? state.activeDocumentId ?? null;

  return (
    <div className="space-y-5">
      <AskQuestionForm
        question={question}
        onChange={setQuestion}
        onSubmit={() => ask()}
        suggestions={suggestions}
        onSelectSuggestion={(suggestion) => ask(suggestion)}
        pending={pending}
        maxChars={LIMITS.MAX_QUESTION_CHARS}
      />

      {result ? <QuestionSafetyNotice questionSafety={result.questionSafety} /> : null}
      {pending ? <LoadingBlock message="Searching the extracted clauses…" /> : null}

      <AnswerPanel result={result} pending={pending} />
      <AiReadingPanel ai={result?.ai ?? null} />
      <EvidencePanel result={result} documentId={documentId} />

      {result?.matched ? (
        <div className="panel p-4">
          <CitationList result={result} documentId={documentId} />
          <div className="mt-4">
            <RelatedObligations result={result} clauseNumberById={clauseNumbers} />
          </div>
        </div>
      ) : null}

      <Callout tone="info" title="How answers are produced">
        <p>{ASK_DISCLAIMER}</p>
        <p className="mt-1">
          A question is only sent to the AI provider once retrieval has found clauses to quote, and
          the provider may only cite those clauses. If it cites anything else, its reading is withheld
          and the extractive answer is shown on its own.
        </p>
      </Callout>

      {result && result.matches.length > 1 ? (
        <section className="panel">
          <header className="panel-header">
            <div className="min-w-0">
              <h2 className="panel-title">Clauses considered</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                Ranked by term overlap with your question, highest first
              </p>
            </div>
          </header>
          <div className="p-4">
            <ul className="space-y-2">
              {result.matches.map((match) => (
                <li key={match.clause.id} className="rounded border border-ink-200 p-2.5">
                  <p className="text-sm font-semibold text-ink-900">
                    {match.clause.number ? `§${match.clause.number}` : match.clause.heading}
                    {match.clause.heading && match.clause.number ? ` — ${match.clause.heading}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-ink-600">
                    {match.clause.text.slice(0, 240)}
                    {match.clause.text.length > 240 ? '…' : ''}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    score {match.score}
                    {match.matchedTerms.length > 0
                      ? ` · matched: ${match.matchedTerms.join(', ')}`
                      : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <AskHistory
        history={history}
        onSelect={(value) => ask(value)}
        onClear={() => setHistory([])}
      />
    </div>
  );
}

export default AskPage;
