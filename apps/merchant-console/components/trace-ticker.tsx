"use client";

import { useEffect, useRef, useState } from "react";

// Real ledger actions recorded by the platform, in transaction order.
// This is a presentation loop over the documented event schema — not a
// claim about a live session.
const TRACE_LINES: Array<{ action: string; detail: string; tone: "orange" | "green" | "grey" }> = [
  { action: "catalog.search", detail: "3 products indexed", tone: "grey" },
  { action: "quote.created", detail: "₹1,948 · catalog-grounded", tone: "grey" },
  { action: "negotiation.countered", detail: "floor protected", tone: "orange" },
  { action: "policy.checked", detail: "ALLOW", tone: "green" },
  { action: "consent.issued", detail: "single-use · amount-bound", tone: "orange" },
  { action: "payment.attempted", detail: "razorpay order created", tone: "grey" },
  { action: "webhook.reconciled", detail: "signature verified", tone: "grey" },
  { action: "order.paid", detail: "settled by webhook only", tone: "green" },
];

const TONE_CLASS: Record<string, string> = {
  orange: "text-[var(--bb-orange)]",
  green: "text-emerald-400",
  grey: "text-[var(--bb-grey-1)]",
};

const TYPE_TICK_MS = 45;
const HOLD_MS = 1600;

export function TraceTicker() {
  const [index, setIndex] = useState(0);
  const [chars, setChars] = useState(0);
  const raf = useRef(0);
  const last = useRef(0);

  const line = TRACE_LINES[index];
  const full = `${line.action}  ·  ${line.detail}`;

  useEffect(() => {
    // rAF-driven timing: pauses automatically when the tab is hidden,
    // and coalesces to ~22 updates/sec instead of unbounded timers.
    const loop = (t: number) => {
      if (t - last.current >= TYPE_TICK_MS) {
        last.current = t;
        setChars((c) => {
          if (c < full.length) return c + 1;
          if (c === full.length) {
            // holding; advance after hold via the timeout branch below
            return c;
          }
          return c;
        });
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [full]);

  useEffect(() => {
    if (chars < full.length) return;
    const hold = window.setTimeout(() => {
      setChars(0);
      setIndex((i) => (i + 1) % TRACE_LINES.length);
    }, HOLD_MS);
    return () => window.clearTimeout(hold);
  }, [chars, full]);

  return (
    <div className="flex items-center gap-3 font-[var(--font-mono)] text-[0.62rem] tracking-[0.04em]">
      <span className="text-[var(--bb-grey-4)] uppercase tracking-[0.14em] text-[0.55rem] shrink-0">
        trace
      </span>
      {/* fixed-size box: the growing text never shifts siblings */}
      <span className={`block w-[240px] sm:w-[310px] truncate ${TONE_CLASS[line.tone]}`}>
        {full.slice(0, chars)}
      </span>
      <span className="inline-block w-[7px] h-[13px] -mb-[2px] bg-[var(--bb-orange)] animate-[blink_1s_steps(1)_infinite]" />
      <span className="text-[var(--bb-grey-4)] text-[0.55rem] tabular-nums shrink-0 ml-auto">
        {String(index + 1).padStart(2, "0")}/{String(TRACE_LINES.length).padStart(2, "0")}
      </span>
    </div>
  );
}
