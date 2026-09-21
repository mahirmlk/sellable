"use client";

import type { ReactNode } from "react";

/**
 * Responsive table wrapper. Renders a soft Apple card table on wide screens;
 * on narrow screens rows collapse into stacked cards (see `.data-table` in
 * globals.css) so pages never overflow horizontally.
 *
 * For labelled stacked rows, give each `td` a `data-label` attribute matching
 * its column header — the label is shown before the cell value on mobile.
 */
export function DataTable({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`data-table ${className}`}>{children}</div>;
}
