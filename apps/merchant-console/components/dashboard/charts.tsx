// Dependency-free inline-SVG charts + the pure series math the Analytics and
// Home dashboards share. No npm packages, no mock data: every point, bar and
// delta is computed from real order records returned by getConsoleTransactions().
// Calendar days are zero-filled (a zero bar means "no orders that day" — never
// an invented value); when there is not enough real data the series helpers
// return null and callers render the existing EmptyState instead.
//
// Styling: theme-aware classes only. SVG geometry uses currentColor and the
// --c-accent / --c-hairline tokens so every chart follows light+dark. No hex
// or rgba() literals, no animation (prefers-reduced-motion-safe by being
// static; hover tooltips rely on native <title>, not motion).

import type { ConsoleTransaction } from "@/lib/api";

/* ------------------------------------------------------------------
   CHART PRIMITIVES
   ------------------------------------------------------------------ */

export interface SparklineProps {
  /** Axis-free trend values, oldest → newest. Empty renders nothing. */
  points: number[];
  /** viewBox width (aspect stays ~10:1 with the default height). */
  width?: number;
  height?: number;
  /** Accessible description — the caller knows what the trend represents. */
  ariaLabel: string;
}

/**
 * Axis-free trend line: `currentColor` polyline plus a last-point dot.
 * Responsive via viewBox + width:100%; the caller sizes the wrapper.
 */
export function Sparkline({ points, width = 120, height = 12, ariaLabel }: SparklineProps) {
  if (points.length === 0) return null;

  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;
  const xOf = (i: number) =>
    points.length === 1 ? width / 2 : pad + (i / (points.length - 1)) * (width - 2 * pad);
  const yOf = (v: number) =>
    range > 0 ? pad + (1 - (v - min) / range) * (height - 2 * pad) : height / 2;

  const lastX = xOf(points.length - 1);
  const lastY = yOf(points[points.length - 1]);
  const line = points.map((v, i) => `${xOf(i).toFixed(2)},${yOf(v).toFixed(2)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      style={{ width: "100%", height: "auto" }}
    >
      {points.length > 1 ? (
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <circle cx={lastX} cy={lastY} r={1.75} fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------------
   SERIES MATH — pure functions over real order records
   ------------------------------------------------------------------ */

/** Which headline metric a series/delta is built for. */
export type MetricKey = "revenue" | "assisted" | "orders" | "aov";

/** Local midnight of the day `ts` falls in. */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight `dayOffset` days from today (DST-safe date stepping). */
function dayStart(dayOffset: number, now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return d.getTime();
}

function shortLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * PAID orders only — exactly the set the backend `/console/insights` counts
 * as revenue (`paid = [o for o in orders if o.status == OrderStatus.PAID]`),
 * so chart totals reconcile with the Revenue metric card.
 */
function isSale(o: ConsoleTransaction): boolean {
  return o.status === "PAID";
}

export interface PeriodTotals {
  /** PAID orders only (mirrors insights `revenue`). Paise. */
  revenuePaise: number;
  /** Mirrors insights `agent_assisted_revenue = revenue` (the AI seller runs
   *  every checkout, so the assisted set is the same order set). Paise. */
  assistedPaise: number;
  /** PAID orders in the window. */
  paidOrders: number;
  /** All orders regardless of status (mirrors insights `total_orders`). */
  orders: number;
}

/** Aggregate real orders in the half-open window [startMs, endMs). */
export function totalsForPeriod(
  orders: ConsoleTransaction[],
  startMs: number,
  endMs: number
): PeriodTotals {
  const totals: PeriodTotals = { revenuePaise: 0, assistedPaise: 0, paidOrders: 0, orders: 0 };
  for (const o of orders) {
    const ts = +new Date(o.created_at);
    if (Number.isNaN(ts) || ts < startMs || ts >= endMs) continue;
    totals.orders += 1;
    if (isSale(o)) {
      totals.paidOrders += 1;
      totals.revenuePaise += o.amount_paise;
      totals.assistedPaise += o.amount_paise;
    }
  }
  return totals;
}

/** The current period: the last `days` calendar days including today. */
export function periodWindow(days: number, now = Date.now()): { startMs: number; endMs: number } {
  return { startMs: dayStart(-(days - 1), now), endMs: dayStart(1, now) };
}

/** The equal-length window immediately before the current period. */
export function previousWindow(days: number, now = Date.now()): { startMs: number; endMs: number } {
  return { startMs: dayStart(-(2 * days - 1), now), endMs: dayStart(-(days - 1), now) };
}

function metricValue(totals: PeriodTotals, metric: MetricKey): number | null {
  switch (metric) {
    case "revenue":
      return totals.revenuePaise;
    case "assisted":
      return totals.assistedPaise;
    case "orders":
      return totals.orders;
    // AOV only exists on periods that actually sold something.
    case "aov":
      return totals.paidOrders > 0 ? totals.revenuePaise / totals.paidOrders : null;
  }
}

export interface PeriodComparison {
  /** Percentage change vs the previous period (unrounded). */
  pct: number;
  current: number;
  previous: number;
}

/**
 * Current vs previous period over real order history. Returns null when the
 * previous period has no comparable value (no orders / no sales / no AOV) —
 * callers then omit the delta entirely instead of showing a zero or a fake
 * arrow. A decline to exactly zero is a valid -100% (previous > 0).
 */
export function comparePeriods(
  orders: ConsoleTransaction[],
  metric: MetricKey,
  days: number,
  now = Date.now()
): PeriodComparison | null {
  const cur = periodWindow(days, now);
  const prev = previousWindow(days, now);
  const currentValue = metricValue(totalsForPeriod(orders, cur.startMs, cur.endMs), metric);
  const previousValue = metricValue(totalsForPeriod(orders, prev.startMs, prev.endMs), metric);
  if (currentValue === null || previousValue === null || previousValue <= 0) return null;
  return {
    pct: ((currentValue - previousValue) / previousValue) * 100,
    current: currentValue,
    previous: previousValue,
  };
}

export interface SeriesPoint {
  label: string;
  value: number;
  /** Day start (ms) — bucket identity, never invented data. */
  dateMs: number;
  /** PAID orders that day (lets AOV series skip non-selling days). */
  paid: number;
}

/**
 * Dense daily series for the last `days` calendar days (zero-filled real days).
 * Values: revenue/assisted in paise, orders as counts, aov as per-day
 * paise-per-sale (0 on days without sales — filter on `paid` for AOV trends).
 */
export function dailySeries(
  orders: ConsoleTransaction[],
  opts: { days: number; metric: MetricKey; now?: number }
): SeriesPoint[] {
  const now = opts.now ?? Date.now();
  // Each bucket is a true local midnight (DST-safe date stepping), so a
  // bucket's label always matches the calendar day it aggregates.
  const buckets = Array.from({ length: opts.days }, (_, i) => {
    const dateMs = dayStart(-(opts.days - 1) + i, now);
    return { label: shortLabel(dateMs), dateMs, revenue: 0, count: 0, paid: 0 };
  });
  // Day-bucket by local calendar day so DST shifts cannot skew an index.
  const indexByDay = new Map<number, number>();
  buckets.forEach((b, i) => indexByDay.set(startOfDay(b.dateMs), i));

  for (const o of orders) {
    const ts = +new Date(o.created_at);
    if (Number.isNaN(ts)) continue;
    const bucket = indexByDay.get(startOfDay(ts));
    if (bucket === undefined) continue;
    buckets[bucket].count += 1;
    if (isSale(o)) {
      buckets[bucket].paid += 1;
      buckets[bucket].revenue += o.amount_paise;
    }
  }

  return buckets.map((b) => ({
    label: b.label,
    dateMs: b.dateMs,
    paid: b.paid,
    value:
      opts.metric === "orders"
        ? b.count
        : opts.metric === "aov"
          ? b.paid > 0
            ? b.revenue / b.paid
            : 0
          : b.revenue,
  }));
}

/**
 * Trend points spanning the current AND previous period (2 × days points) so
 * the sparkline visually backs the period-over-period delta. AOV sparks only
 * include days that actually sold. Returns null when fewer than 2 real points
 * exist — callers then omit the sparkline entirely.
 */
export function sparkSeries(
  orders: ConsoleTransaction[],
  metric: MetricKey,
  days: number,
  now = Date.now()
): number[] | null {
  const points = dailySeries(orders, { days: days * 2, metric, now });
  const values = (metric === "aov" ? points.filter((p) => p.paid > 0) : points).map((p) => p.value);
  return values.length >= 2 ? values : null;
}

export interface TopProduct {
  sku: string;
  units: number;
  /** Real line-item revenue (line_total_paise). Paise. */
  revenuePaise: number;
}
/**
 * Units + revenue per SKU from real order line items (PAID orders only) in
 * the half-open window [startMs, endMs). Sorted by revenue desc (units break
 * ties), limited to `limit` rows.
 */
export function topProducts(
  orders: ConsoleTransaction[],
  opts: { startMs: number; endMs: number; limit?: number }
): TopProduct[] {
  const bySku = new Map<string, TopProduct>();
  for (const o of orders) {
    const ts = +new Date(o.created_at);
    if (Number.isNaN(ts) || ts < opts.startMs || ts >= opts.endMs) continue;
    if (!isSale(o)) continue;
    for (const item of o.items ?? []) {
      const row = bySku.get(item.sku) ?? { sku: item.sku, units: 0, revenuePaise: 0 };
      // Enriched line items carry line_total_paise; fall back to unit × qty so
      // a partial payload can never turn the ranking into NaN.
      const line = Number.isFinite(item.line_total_paise)
        ? item.line_total_paise
        : item.unit_price_paise * item.quantity;
      row.units += item.quantity;
      row.revenuePaise += line;
      bySku.set(item.sku, row);
    }
  }
  return [...bySku.values()]
    .sort((a, b) => b.revenuePaise - a.revenuePaise || b.units - a.units)
    .slice(0, opts.limit ?? 5);
}

export interface StatusBuckets {
  /** PAID / FULFILLED / REFUNDED — money was captured. */
  paid: number;
  /** AWAITING_CONSENT / CONSENTED / PAYMENT_PENDING — no money yet. */
  open: number;
  /** PAYMENT_FAILED / ABORTED, or a FAILED payment_status. */
  failed: number;
}

/** An order whose payment failed, mirroring isFailedPayment in commerce-view
 *  but over the raw wire record (status + payment_status). */
function isFailedTx(o: ConsoleTransaction): boolean {
  return o.status === "PAYMENT_FAILED" || o.status === "ABORTED" || o.payment_status === "FAILED";
}

/** "Open" orders: created but no money captured yet and not dead/refunded. */
function isOpenTx(o: ConsoleTransaction): boolean {
  return o.status === "AWAITING_CONSENT" || o.status === "CONSENTED" || o.status === "PAYMENT_PENDING";
}

/**
 * Order counts per status bucket from real order records in the half-open
 * window [startMs, endMs). REFUNDED counts as paid (money was captured);
 * statuses outside the known backend set are ignored rather than invented
 * into a bucket. All-zero means "no orders in range" — callers render the
 * existing EmptyState instead of an empty donut.
 */
export function statusBuckets(
  orders: ConsoleTransaction[],
  startMs: number,
  endMs: number
): StatusBuckets {
  const buckets: StatusBuckets = { paid: 0, open: 0, failed: 0 };
  for (const o of orders) {
    const ts = +new Date(o.created_at);
    if (Number.isNaN(ts) || ts < startMs || ts >= endMs) continue;
    if (isFailedTx(o)) buckets.failed += 1;
    else if (isOpenTx(o)) buckets.open += 1;
    else if (o.status === "PAID" || o.status === "FULFILLED" || o.status === "REFUNDED")
      buckets.paid += 1;
  }
  return buckets;
}
