"use client";

import type { ReactNode } from "react";

/**
 * Responsive table wrapper. Renders a normal bordered table on wide screens;
 * on narrow screens rows collapse into stacked cards (see `.data-table` in
 * globals.css) so pages never overflow horizontally.
 *
 * For labelled stacked rows, give each `td` a `data-label` attribute matching
 * its column header — the label is shown before the cell value on mobile.
 */
export function DataTable({ children }: { children: ReactNode }) {
  return <div className="data-table">{children}</div>;
}
