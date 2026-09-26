import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  href?: string;
  /** Render the label in monospace (order ids, buyer ids, SKUs). */
  mono?: boolean;
}

/**
 * Hierarchy breadcrumbs (not history): the current page is always the last
 * item, rendered as non-link text with aria-current="page". Chevron
 * separators via lucide. On small screens only the last two levels show so
 * the trail never wraps or crowds the row actions; the full trail shows
 * from sm: up.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const tailStart = Math.max(0, items.length - 2);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[12px]">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          const inTail = i >= tailStart;
          return (
            <li
              key={`${item.label}-${i}`}
              className={`flex min-w-0 items-center gap-1 ${inTail ? "" : "hidden sm:flex"}`}
            >
              {i > 0 ? (
                <ChevronRight
                  size={13}
                  aria-hidden
                  className={`shrink-0 text-faint ${i === tailStart ? "hidden sm:block" : ""}`}
                />
              ) : null}
              {last || !item.href ? (
                <span
                  aria-current={last ? "page" : undefined}
                  title={item.label}
                  className={`truncate font-medium text-ink ${item.mono ? "font-mono" : ""}`}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  title={item.label}
                  className={`shrink-0 text-faint transition-colors hover:text-ink ${item.mono ? "font-mono" : ""}`}
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
