"use client";

import type { ReactNode } from "react";

/**
 * Responsive table wrapper. Renders a soft ivory card table on wide screens;
 * on narrow screens rows collapse into stacked cards (see `.data-table` in
 * globals.css) so pages never overflow horizontally.
 *
 * For labelled stacked rows, give each `td` a `data-label` attribute matching
 * its column header — the label is shown before the cell value on mobile.
 *
 * The shadcn Table primitives are re-exported here as the canonical
 * dashboard path so pages can adopt them incrementally. NOTE: this wrapper
 * intentionally still renders its children untouched inside the `.data-table`
 * div instead of rendering `<Table>` itself — every consuming page passes a
 * complete `<table>` tree (some alongside bespoke mobile-card blocks), and
 * shadcn's `Table` emits its own `<table>` element, so wrapping children in
 * it would produce invalid nested-table markup. The `.data-table` CSS targets
 * descendant `table`/`thead`/`td` selectors, so shadcn primitives used by
 * pages inside this wrapper pick up the responsive stacked-card treatment
 * (including the `td[data-label]` pattern) automatically.
 */
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";

export function DataTable({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`data-table ${className}`}>{children}</div>;
}
