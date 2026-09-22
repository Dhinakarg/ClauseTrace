/**
 * Ask panels.
 *
 * Presentational components for the Ask route: the question form, the answer,
 * the evidence behind it and the AI reading (when one survived validation). They
 * take the view model produced by `ai/askService.js` and render it — no fetching,
 * no state, no store access — so they can be rendered in tests like the other
 * panel groups.
 */

import { Link } from 'react-router-dom';
import { Bot, ExternalLink, History, Search, ShieldQuestion } from 'lucide-react';
import { Badge, evidenceStatusTone } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { Callout, Panel } from '../ui/Panel.jsx';
import { EvidenceList } from '../legal/EvidenceList.jsx';
import { clauseSourceLink } from '../../app/navigation.js';

const CONFIDENCE_TONES = {
  high: 'positive',
  medium: 'accent',
  low: 'warning',
  none: 'muted',
};

const VERIFICATION_LABELS = {
  verified: 'citation verified',
  unchecked: 'checked against the clause record',
  'text-mismatch': 'quote not found in the document',
  'unknown-clause': 'no such clause',
  'missing-source': 'clause has no text',
};

/** The form plus the model-derived suggestions. */
export function AskQuestionForm({
  question = '',
  onChange,
  onSubmit,
  suggestions = [],
  onSelectSuggestion,
  pending = false,
  maxChars = null,
}) {
  const tooLong = maxChars !== null && question.length > maxChars;
  return (
    <Panel title="Ask about this document">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor="ask-question" className="sr-only">
          Question
        </label>
        <input
          id="ask-question"
          className="input"
          type="text"
          value={question}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. what notice is required before renewal?"
          autoComplete="off"
        />
        <Button
          type="submit"
          variant="primary"
          icon={Search}
          className="sm:w-40 sm:justify-center"
          disabled={pending || question.trim().length === 0 || tooLong}
        >
          {pending ? 'Searching…' : 'Search clauses'}
        </Button>
      </form>

      {tooLong ? (
        <p className="mt-2 text-xs text-flag-700">
          This question is longer than the {maxChars}-character limit. Shorten it so the search can run.
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="mt-3">
          <p className="label-eyebrow">Suggestions from this document</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSelectSuggestion(suggestion)}
                className="rounded border border-ink-200 bg-surface px-2 py-1 text-left text-xs text-ink-700 hover:bg-ink-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

/** Reported when the typed question contained instruction-shaped text. */
export function QuestionSafetyNotice({ questionSafety = null }) {
  if (!questionSafety) return null;
  const { warnings = [], truncated = false } = questionSafety;
  if (warnings.length === 0 && !truncated) return null;
  return (
    <Callout tone="warning" title="Your question was treated as untrusted input">
      {warnings.length > 0 ? (
        <div>
          <p>
            {warnings.length} instruction-like passage(s) were neutralised before the search ran, so
            they are analysed as text rather than obeyed.
          </p>
          <p className="mt-1 text-xs text-ink-600">
            {warnings.map((warning) => `“${warning.excerpt}”`).join(' · ')}
          </p>
        </div>
      ) : null}
      {truncated ? <p className="mt-1">The question was shortened to the accepted length.</p> : null}
    </Callout>
  );
}

/** The answer itself, with its confidence and limitations. */
export function AnswerPanel({ result, pending = false }) {
  if (!result) return null;
  const { confidence } = result;
  return (
    <Panel
      title="Answer"
      subtitle={
        result.matched
          ? `${result.citations.length} clause(s) support this answer`
          : 'Nothing in the extracted text answers this'
      }
      actions={
        confidence ? (
          <Badge tone={CONFIDENCE_TONES[confidence.level] ?? 'muted'}>{confidence.label}</Badge>
        ) : null
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <Badge tone={result.matched ? 'accent' : 'muted'}>
            {result.matched ? 'grounded in the text' : 'no supporting clause'}
          </Badge>
          {pending ? <span>Searching…</span> : null}
          {result.questionSafety?.warnings?.length ? (
            <Badge tone="warning" icon={ShieldQuestion}>
              question neutralised
            </Badge>
          ) : null}
        </div>

        {result.matched ? (
          <div className="space-y-2">
            {result.answer.split('\n\n').map((paragraph) => (
              <p key={paragraph} className="text-sm leading-relaxed text-ink-800">
                {paragraph}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-700">{result.answer}</p>
        )}

        {confidence ? (
          <div className="rounded border border-ink-200 bg-ink-50/60 p-2.5">
            <p className="label-eyebrow">Confidence</p>
            <p className="mt-1 text-sm text-ink-800">{confidence.label}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-ink-600">
              {confidence.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-ink-500">{confidence.disclaimer}</p>
          </div>
        ) : null}

        {result.limitations.length > 0 ? (
          <div>
            <p className="label-eyebrow">What this answer is not</p>
            <ul className="mt-1 space-y-0.5 text-xs text-ink-500">
              {result.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}


/**
 * The AI half of the answer. Shown only when a provider answered, and always
 * beside the extractive answer — never instead of it.
 */
export function AiReadingPanel({ ai = null }) {
  if (!ai?.attempted) return null;

  if (!ai.used) {
    return (
      <Callout tone="warning" title="AI reading withheld">
        <p>{ai.reason}</p>
        {ai.issues.length > 1 ? (
          <ul className="mt-1 space-y-0.5 text-xs text-ink-600">
            {ai.issues.slice(1).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1 text-xs text-ink-500">
          The extractive answer above is unaffected: it comes from the retrieved clauses and their
          verified citations.
        </p>
      </Callout>
    );
  }

  // Clause numbers and clause headings are both citation handles; the reader is told which of
  // them were checked against the document. Built as one string so the sentence reads as one
  // piece of text rather than several JSX fragments.
  const checked = [...(ai.citedClauses ?? []), ...(ai.citedHeadings ?? [])];
  const citationNote = [
    'The model was given only the clauses listed below and had to cite them.',
    `Every reference it used${checked.length ? ` (${checked.join(', ')})` : ''} was`,
    "checked against this document; the wording itself is the model's, so read the quotes in",
    'Evidence before relying on it.',
  ].join(' ');

  return (
    <Panel
      title="AI reading"
      subtitle={`${ai.provider}${ai.model ? ` · ${ai.model}` : ''} · contract ${ai.promptId}`}
      actions={
        <Badge tone="muted" icon={Bot}>
          not verified
        </Badge>
      }
    >
      <p className="text-sm leading-relaxed text-ink-800">{ai.text}</p>
      <p className="mt-2 text-xs text-ink-500">{citationNote}</p>
    </Panel>
  );
}

/** The evidence behind the answer: one block per quoted clause. */
export function EvidencePanel({ result = null, documentId = null }) {
  if (!result?.sources?.length) return null;
  return (
    <Panel title="Evidence" subtitle="The clauses the answer was built from, quoted verbatim">
      <ul className="space-y-3">
        {result.sources.map((source) => {
          const verification = source.verification?.status ?? 'unchecked';
          return (
            <li key={source.clauseId} className="rounded border border-ink-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-ink-900">{source.label}</p>
                <Badge tone={evidenceStatusTone(verification)}>
                  {VERIFICATION_LABELS[verification] ?? verification}
                </Badge>
                {source.page ? <span className="text-xs text-ink-500">p.{source.page}</span> : null}
                <Link
                  to={clauseSourceLink(documentId, source.clauseId)}
                  className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline"
                >
                  Open in the document
                  <ExternalLink aria-hidden="true" className="h-3 w-3" />
                </Link>
              </div>

              <blockquote className="quote-block mt-2">{source.excerpt}</blockquote>

              {source.verification?.issues?.length ? (
                <ul className="mt-2 space-y-0.5 text-xs text-ink-500">
                  {source.verification.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : null}

              {source.obligations.length > 0 ? (
                <div className="mt-2">
                  <p className="label-eyebrow">Obligations extracted here</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-600">
                    {source.obligations.map((obligation) => (
                      <li key={obligation.id}>{obligation.summary}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {source.risks.length > 0 ? (
                <div className="mt-2">
                  <p className="label-eyebrow">Findings flagged here</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {source.risks.map((risk) => (
                      <li key={risk.id}>
                        <Badge tone="warning">{risk.title}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}


/** The citations the answer makes, each with its score and a way to open it. */
export function CitationList({ result = null, documentId = null }) {
  if (!result?.citations?.length) return null;
  return (
    <div>
      <p className="label-eyebrow">Citations</p>
      <ul className="mt-1.5 space-y-1.5">
        {result.citations.map((citation) => {
          const verification = citation.verification?.status ?? 'unchecked';
          return (
            <li key={citation.clauseId} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={evidenceStatusTone(verification)}>
                {citation.clauseNumber ? `§${citation.clauseNumber}` : citation.heading ?? citation.clauseId}
                {citation.page ? ` · p.${citation.page}` : ''}
              </Badge>
              <span className="text-ink-500">
                {VERIFICATION_LABELS[verification] ?? verification} · score {citation.score}
              </span>
              <Link
                to={clauseSourceLink(documentId, citation.clauseId)}
                className="font-medium text-accent-700 hover:underline"
              >
                Open clause
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Related obligations extracted from the matched clauses, with their citations. */
export function RelatedObligations({ result = null, clauseNumberById = null }) {
  if (!result?.facts?.length) return null;
  return (
    <div>
      <p className="label-eyebrow">Related obligations</p>
      <ul className="mt-1.5 space-y-2">
        {result.facts.map((row) => (
          <li key={row.obligation.id} className="rounded border border-ink-200 p-2.5">
            <p className="text-sm text-ink-800">{row.obligation.summary}</p>
            <EvidenceList
              evidence={row.obligation.evidence}
              clauseNumberById={clauseNumberById}
              compact
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Questions asked in this session, so a reader can revisit one. */
export function AskHistory({ history = [], onSelect, onClear = null }) {
  if (history.length === 0) return null;
  return (
    <Panel
      title="Recent questions"
      subtitle="Kept in this browser session only"
      actions={
        onClear ? (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        ) : null
      }
    >
      <ul className="space-y-1.5">
        {history.map((entry) => (
          <li key={entry.question} className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(entry.question)}
              className="flex items-center gap-2 text-left text-sm text-ink-800 hover:text-accent-700"
            >
              <History aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />
              {entry.question}
            </button>
            <Badge tone={entry.matched ? 'accent' : 'muted'}>
              {entry.matched ? 'matched' : 'no match'}
            </Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

