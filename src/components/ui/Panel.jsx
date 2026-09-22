/**
 * Panel, SectionHeading, EmptyState, Callout, StatTile, KeyValue and ProgressMeter.
 * Grouped in one module because they are all small layout primitives with no
 * behaviour of their own.
 */

import { AlertTriangle, CheckCircle2, Info, Loader2, Quote } from 'lucide-react';
import { Badge } from './Badge.jsx';

export function Panel({ title = null, subtitle = null, actions = null, children, className = '', noPadding = false, bodyClassName = '' }) {
  return (
    <section className={['panel flex flex-col', className].join(' ').trim()}>
      {title || actions ? (
        <header className="panel-header shrink-0">
          <div className="min-w-0">
            <h2 className="panel-title truncate">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-500 truncate">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={[noPadding ? 'min-h-0 flex-1 flex flex-col' : 'p-4', bodyClassName].join(' ').trim()}>{children}</div>
    </section>
  );
}

export function SectionHeading({ children, hint = null, id = undefined }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 id={id} className="text-sm font-semibold text-ink-900">
        {children}
      </h3>
      {hint ? <span className="text-xs text-ink-500">{hint}</span> : null}
    </div>
  );
}

export function EmptyState({ message, icon: Icon = Quote, action = null, className = '' }) {
  return (
    <div
      className={[
        'flex flex-col items-center gap-3 rounded border border-dashed border-ink-200 bg-ink-50/60 px-4 py-8 text-center',
        className,
      ]
        .join(' ')
        .trim()}
    >
      <Icon aria-hidden="true" className="h-5 w-5 text-ink-400" />
      <p className="max-w-xl text-sm text-ink-600">{message}</p>
      {action}
    </div>
  );
}

const CALLOUT_TONES = {
  info: { wrapper: 'border-accent-200 bg-accent-50', icon: Info, iconClass: 'text-accent-600' },
  positive: { wrapper: 'border-positive-100 bg-positive-50', icon: CheckCircle2, iconClass: 'text-positive-500' },
  warning: { wrapper: 'border-signal-300 bg-signal-50', icon: AlertTriangle, iconClass: 'text-signal-500' },
  critical: { wrapper: 'border-flag-500 bg-flag-50', icon: AlertTriangle, iconClass: 'text-flag-500' },
};

export function Callout({ tone = 'info', title = null, children, className = '', actions = null }) {
  const config = CALLOUT_TONES[tone] ?? CALLOUT_TONES.info;
  const Icon = config.icon;
  return (
    <div className={['rounded border px-3 py-2.5', config.wrapper, className].join(' ').trim()}>
      <div className="flex gap-2.5">
        <Icon aria-hidden="true" className={['mt-0.5 h-4 w-4 shrink-0', config.iconClass].join(' ')} />
        <div className="min-w-0 flex-1 text-sm text-ink-800">
          {title ? <p className="font-semibold text-ink-900">{title}</p> : null}
          <div className={title ? 'mt-1' : ''}>{children}</div>
          {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function StatTile({ label, value, hint = null, tone = 'neutral', badge = null }) {
  const valueTone =
    tone === 'critical' ? 'text-flag-700' : tone === 'warning' ? 'text-signal-700' : 'text-ink-900';
  return (
    <div className="panel px-3 py-3">
      <p className="label-eyebrow">{label}</p>
      <p className={['mt-1 font-serif text-2xl leading-none', valueTone].join(' ')}>
        {value === null || value === undefined ? '—' : value}
      </p>
      {hint ? <p className="mt-1.5 text-xs text-ink-500">{hint}</p> : null}
      {badge ? <div className="mt-2">{badge}</div> : null}
    </div>
  );
}

export function KeyValue({ label, children, className = '' }) {
  return (
    <div className={className}>
      <dt className="label-eyebrow">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800">{children}</dd>
    </div>
  );
}

export function DefinitionList({ children, className = '' }) {
  return <dl className={['grid gap-3 sm:grid-cols-2', className].join(' ').trim()}>{children}</dl>;
}

/** Thin progress meter; never uses colour alone to convey state. */
export function ProgressMeter({ value, label, tone = 'accent' }) {
  const ratio = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const barTone =
    tone === 'warning' ? 'bg-signal-500' : tone === 'critical' ? 'bg-flag-500' : 'bg-accent-500';
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-ink-600">
        <span>{label}</span>
        <span className="font-medium text-ink-800">{Math.round(ratio * 100)}%</span>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-sm bg-ink-100"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={['h-full', barTone].join(' ')} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function LoadingBlock({ message = 'Working…' }) {
  return (
    <div className="flex items-center gap-2 rounded border border-ink-200 bg-surface px-3 py-2.5 text-sm text-ink-600">
      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-accent-500" />
      {message}
    </div>
  );
}

/** Renders a quoted passage from the document. Text is escaped by React. */
export function QuoteBlock({ children, citation = null }) {
  return (
    <figure className="space-y-1.5">
      <blockquote className="quote-block">{children}</blockquote>
      {citation ? (
        <figcaption className="text-xs text-ink-500">
          <Badge tone="muted">{citation}</Badge>
        </figcaption>
      ) : null}
    </figure>
  );
}
