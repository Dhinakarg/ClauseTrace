/**
 * Button.
 * Two visual weights only: primary actions and quiet actions. Anything more
 * elaborate belongs in the page that needs it.
 */

const VARIANTS = {
  primary:
    'bg-accent-600 text-white hover:bg-accent-700 disabled:bg-accent-300',
  quiet:
    'border border-ink-200 bg-surface text-ink-800 hover:bg-ink-50 disabled:text-ink-400',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
  link: 'text-accent-700 underline-offset-2 hover:underline',
  danger: 'border border-flag-500 text-flag-700 hover:bg-flag-50',
};

const SIZES = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
};

export function Button({
  children,
  variant = 'quiet',
  size = 'md',
  icon: Icon = null,
  className = '',
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      className={[
        'inline-flex items-center gap-2 rounded font-medium transition-colors disabled:cursor-not-allowed',
        VARIANTS[variant] ?? VARIANTS.quiet,
        SIZES[size] ?? SIZES.md,
        className,
      ]
        .join(' ')
        .trim()}
      {...rest}
    >
      {Icon ? <Icon aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
      {children}
    </button>
  );
}

export default Button;
