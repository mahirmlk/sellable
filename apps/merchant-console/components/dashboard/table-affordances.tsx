"use client";

// Premium table affordances shared by the commerce tables: sortable column
// headers (client-side over already-loaded rows) and pagination with honest
// totals. Aurora Glass design system — theme-aware classes only.

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

export type SortDir = "asc" | "desc";

/** Rows per page for every commerce table. */
export const PAGE_SIZE = 25;

/** One sortable column: which sort keys it toggles and how to read its value. */
export interface SortColumn<T, K extends string> {
  id: string;
  label: string;
  /** Sort state applied when this column sorts ascending. */
  asc: K;
  /** Sort state applied when this column sorts descending. */
  desc: K;
  /** Direction the first click on an idle column applies. */
  first: SortDir;
  /** Optional tailwind width class for table-fixed layouts. */
  width?: string;
  /** Sort key: numbers compare numerically (paise, counts, ms), text locale-aware. */
  value: (row: T) => string | number;
  /** Optional stable tiebreak (e.g. title) for equal primary values. */
  tiebreak?: (row: T) => string | number;
}

/** Current direction if `sort` matches the column, else null (column idle). */
export function dirOf<T, K extends string>(col: SortColumn<T, K>, sort: K): SortDir | null {
  if (sort === col.asc) return "asc";
  if (sort === col.desc) return "desc";
  return null;
}

/** Locale-aware compare for text; plain subtraction for numbers and ms epochs. */
export function compareSortValue(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Stable client-side sort over already-loaded rows. Never mutates the input. */
export function sortBy<T>(
  rows: T[],
  value: (row: T) => string | number,
  dir: SortDir,
  tiebreak?: (row: T) => string | number
): T[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compareSortValue(value(a), value(b));
    if (primary !== 0 || !tiebreak) return mul * primary;
    return mul * compareSortValue(tiebreak(a), tiebreak(b));
  });
}

/** Total page count (never below 1). */
export function pageCountOf(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** Slice the current 1-based page of rows (caller clamps the page). */
export function pageSlice<T>(rows: T[], page: number): T[] {
  return rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

/**
 * Sortable `<th>`: header is a button that toggles asc ↔ desc. The active
 * column always shows its direction glyph; idle columns reveal a quiet
 * first-click hint on hover only. `aria-sort` lives on the `<th>`.
 */
export function SortableTh({
  label,
  active,
  dir,
  onSort,
  className = "",
}: {
  label: string;
  active: boolean;
  /** Current direction when active; the first-click direction when idle. */
  dir: SortDir;
  onSort: () => void;
  className?: string;
}) {
  const Icon = dir === "desc" ? ChevronDown : ChevronUp;
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={className}
    >
      <button
        type="button"
        onClick={onSort}
        title={`Sort by ${label}`}
        className={`group -mx-4 -my-2.5 flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent ${
          active ? "text-accent-strong" : "text-muted hover:text-ink"
        }`}
      >
        <span className="truncate">{label}</span>
        <Icon
          size={12}
          aria-hidden
          className={`shrink-0 transition-opacity ${
            active ? "opacity-100" : "opacity-0 group-hover:opacity-70"
          }`}
        />
      </button>
    </th>
  );
}

/**
 * Pagination footer with honest totals: "1–25 of 240 orders" + Prev/Next pill
 * buttons + "Page 2 of 10". Hidden entirely while the total fits one page.
 */
export function TablePagination({
  page,
  total,
  noun,
  onPageChange,
}: {
  /** 1-based current page (already clamped to the available pages). */
  page: number;
  /** Total rows across all pages (the full filtered set). */
  total: number;
  /** Row noun for the totals line, e.g. "orders". */
  noun: string;
  onPageChange: (page: number) => void;
}) {
  const pageCount = pageCountOf(total);
  if (total <= PAGE_SIZE) return null;
  const current = Math.min(Math.max(page, 1), pageCount);
  const start = (current - 1) * PAGE_SIZE + 1;
  const end = Math.min(current * PAGE_SIZE, total);
  return (
    <nav
      aria-label="Table pagination"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <span className="text-[12px] text-muted tabular-nums">
        {start}–{end} of {total} {noun}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          className="inline-flex items-center gap-1 h-8 px-4 rounded-full bg-panel border border-hairline text-[13px] font-medium text-ink-2 hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98]"
        >
          <ChevronLeft size={13} aria-hidden /> Prev
        </button>
        <span className="text-[12px] text-muted tabular-nums">
          Page {current} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= pageCount}
          className="inline-flex items-center gap-1 h-8 px-4 rounded-full bg-panel border border-hairline text-[13px] font-medium text-ink-2 hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98]"
        >
          Next <ChevronRight size={13} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
