/**
 * Breadcrumbs and PageHeader.
 * The header states where you are, how large the document is and what it can be
 * trusted for — the same facts live in `describeRoute`, so copy stays consistent.
 */

import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export function Breadcrumbs({ crumbs = [] }) {
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-500">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {crumb.to && !isLast ? (
                <Link to={crumb.to} className="rounded px-1 py-0.5 hover:bg-ink-100 hover:text-ink-800">
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={isLast ? 'px-1 py-0.5 font-medium text-ink-700' : 'px-1 py-0.5'}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              )}
              {!isLast ? (
                <ChevronRight aria-hidden="true" className="h-3 w-3 text-ink-300" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions = null, meta = null }) {
  return (
    <header className="flex flex-col gap-3 border-b border-ink-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="label-eyebrow">{eyebrow}</p> : null}
        <h1 className="mt-1 font-serif text-2xl leading-tight text-ink-900">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-3xl text-sm text-ink-600">{subtitle}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export default PageHeader;
