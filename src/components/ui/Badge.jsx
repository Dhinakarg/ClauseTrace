/**
 * Badge.
 * Semantic tones are deliberately muted: this is a reading tool, not a dashboard
 * of alarms.
 */

const TONES = {
  neutral: 'border-ink-200 bg-ink-50 text-ink-700',
  accent: 'border-accent-200 bg-accent-50 text-accent-700',
  info: 'border-accent-200 bg-accent-50 text-accent-700',
  positive: 'border-positive-100 bg-positive-50 text-positive-700',
  warning: 'border-signal-300 bg-signal-50 text-signal-700',
  critical: 'border-flag-500 bg-flag-50 text-flag-700',
  muted: 'border-ink-200 bg-surface text-ink-500',
};

export function Badge({ children, tone = 'neutral', icon: Icon = null, title = null, className = '' }) {
  return (
    <span
      title={title ?? undefined}
      className={[
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-label',
        TONES[tone] ?? TONES.neutral,
        className,
      ]
        .join(' ')
        .trim()}
    >
      {Icon ? <Icon aria-hidden="true" className="h-3 w-3" /> : null}
      {children}
    </span>
  );
}

/** Maps a severity value to a badge tone. */
export function severityTone(severity) {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'critical';
    case 'medium':
      return 'warning';
    case 'low':
    case 'info':
      return 'neutral';
    default:
      return 'muted';
  }
}

/** Maps an obligation status to a badge tone. */
export function obligationStatusTone(status) {
  switch (status) {
    case 'overdue':
      return 'critical';
    case 'due':
      return 'warning';
    case 'upcoming':
      return 'accent';
    case 'informational':
      return 'muted';
    case 'conditional':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** Maps an evidence verification status to a badge tone. */
export function evidenceStatusTone(status) {
  switch (status) {
    case 'verified':
      return 'positive';
    case 'text-mismatch':
    case 'range-mismatch':
    case 'missing-source':
    case 'unknown-clause':
      return 'critical';
    default:
      return 'muted';
  }
}

export default Badge;
