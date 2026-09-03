"use client";

import { useEffect, useRef, useState } from "react";

// Real ledger actions recorded by the platform, in transaction order.
// Presentation loop over the documented event schema — monochrome and
// viewport-gated, so it renders nothing and runs no timers off-screen.
const TRACE_LINES = [
  { action: "catalog.search", detail: "3 products indexed" },
  { action: "quote.created", detail: "₹1,948 · catalog-grounded" },
  { action: "negotiation.countered", detail: "floor protected" },
  { action: "policy.checked", detail: "ALLOW" },
  { action: "consent.issued", detail: "single-use · amount-bound" },
  { action: "payment.attempted", detail: "razorpay order created" },
  { action: "webhook.reconciled", detail: "signature verified" },
  { action: "order.paid", detail: "settled by webhook only" },
];

const TYPE_TICK_MS = 45;
const HOLD_MS = 1600;

export function TraceTicker() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [chars, setChars] = useState(0);

  const line = TRACE_LINES[index];
  const full = `${line.action}  ·  ${line.detail}`;

  // Only animate while the ticker is actually on screen.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (chars < full.length) {
      const t = window.setTimeout(() => setChars((c) => c + 1), TYPE_TICK_MS);
      return () => window.clearTimeout(t);
    }
    const hold = window.setTimeout(() => {
      setChars(0);
      setIndex((i) => (i + 1) % TRACE_LINES.length);
    }, HOLD_MS);
    return () => window.clearTimeout(hold);
  }, [visible, chars, full]);

  return (
    <div
      ref={wrapRef}
      className="flex items-center gap-3 font-[var(--font-mono)] text-[0.62rem] tracking-[0.04em]"
    >
      <span className="text-[var(--bb-grey-4)] uppercase tracking-[0.14em] text-[0.55rem] shrink-0">
        trace
      </span>
      {/* fixed-size box: the growing text never shifts siblings */}
      <span className="block w-[240px] sm:w-[310px] truncate text-[var(--bb-grey-1)]">
        {full.slice(0, chars)}
      </span>
      <span className="inline-block w-[7px] h-[13px] -mb-[2px] bg-[var(--bb-white)] animate-[blink_1s_steps(1)_infinite]" />
      <span className="text-[var(--bb-grey-4)] text-[0.55rem] tabular-nums shrink-0 ml-auto">
        {String(index + 1).padStart(2, "0")}/{String(TRACE_LINES.length).padStart(2, "0")}
      </span>
    </div>
  );
}
