"use client";

import { useEffect, useRef, useState } from "react";
import { Eyebrow } from "./ui/eyebrow";
import { CornerBrackets } from "./ui/corner-brackets";
import { useInView } from "@/lib/use-in-view";

// Schema-accurate replay of one transaction through the real event names,
// actors, and reasoning fields the XAI ledger records. Presented as an
// animation on the marketing page — the console's replay view renders the
// same schema from the live database.

interface ReplayEvent {
  seq: string;
  actor: string;
  tone: string;
  action: string;
  reason: string;
}

const EVENTS: ReplayEvent[] = [
  { seq: "01", actor: "SELLER AGENT", tone: "text-[var(--bb-orange)]", action: "catalog.search", reason: "3 catalog matches for the buyer's mission." },
  { seq: "02", actor: "SELLER AGENT", tone: "text-[var(--bb-orange)]", action: "quote.created", reason: "Grounded quote — 1 × coffee setup, ₹1,948, inside budget." },
  { seq: "03", actor: "SELLER AGENT", tone: "text-[var(--bb-orange)]", action: "negotiation.countered", reason: "Buyer offered ₹1,700 — countered at the policy floor, ₹1,899." },
  { seq: "04", actor: "POLICY ENGINE", tone: "text-yellow-400", action: "policy.checked", reason: "ALLOW — offer above floor, within order limits, category permitted." },
  { seq: "05", actor: "CONSENT SERVICE", tone: "text-sky-400", action: "consent.issued", reason: "Single-use token bound to amount, payee, and 10-minute window." },
  { seq: "06", actor: "COMMERCE CORE", tone: "text-[var(--bb-grey-1)]", action: "order.created", reason: "Order created in AWAITING_CONSENT — payment still impossible." },
  { seq: "07", actor: "RAZORPAY", tone: "text-purple-400", action: "webhook.reconciled", reason: "payment.captured verified by HMAC signature — the only path to PAID." },
  { seq: "08", actor: "COMMERCE CORE", tone: "text-[var(--bb-grey-1)]", action: "order.paid", reason: "Settled. Eight events on one trace — replayable line by line." },
];

const STEP_MS = 1100;

export function TraceReplay() {
  const { ref, isInView } = useInView();
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!isInView) return;
    const timer = window.setInterval(() => {
      if (pausedRef.current) return;
      setStep((s) => (s >= EVENTS.length + 2 ? 0 : s + 1));
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [isInView]);

  const visible = Math.min(step, EVENTS.length);
  const complete = step >= EVENTS.length;

  return (
    <section
      className="technical-section py-[clamp(80px,10vw,160px)] overflow-hidden relative"
      id="ledger"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-[0.5]" style={{ background: "radial-gradient(700px 440px at 22% 40%, rgba(255,105,0,0.06), transparent 66%)" }} />
      </div>

      <div className="page-frame relative" ref={ref}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-[clamp(48px,7vw,112px)] items-center">
          {/* Left: copy */}
          <div>
            <Eyebrow label="02 — XAI LEDGER" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              Every transaction replays, step by step
            </h2>
            <p className="body-copy mt-6">
              This is one trace, exactly as the ledger recorded it — actor,
              action, and reasoning for each step. The merchant console replays
              real transactions in this same format, straight from the database.
            </p>
            <div className="mt-8 space-y-2.5">
              {[
                ["Actor", "who acted — agent, engine, service, or human"],
                ["Reasoning", "why the step was taken, in plain language"],
                ["Policy refs", "which deterministic rules were consulted"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-3">
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-orange)] w-[92px] shrink-0">
                    {k}
                  </span>
                  <span className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-1)]">
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: animated replay panel */}
          <div
            className="relative"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="relative border border-[#30302E] bg-[var(--bb-panel)] overflow-hidden">
              <CornerBrackets />
              {/* header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--bb-line)]">
                <div className="flex items-center gap-2.5">
                  <span className="w-[5px] h-[5px] bg-[var(--bb-orange)] animate-[pulse_1.6s_ease-in-out_infinite]" />
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                    SAMPLE TRACE REPLAY
                  </span>
                </div>
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] text-[var(--bb-grey-4)]">
                  {paused ? "PAUSED" : complete ? "TRACE COMPLETE" : "REPLAYING"}
                </span>
              </div>

              {/* events */}
              <div className="px-5 py-4 min-h-[380px]">
                {EVENTS.slice(0, visible).map((e, i) => (
                  <div
                    key={e.seq}
                    className={`py-2.5 border-b border-[var(--bb-line-soft)] last:border-b-0 ${
                      i === visible - 1 && !complete ? "bg-[var(--bb-orange-wash-2)] -mx-2 px-2" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] tabular-nums shrink-0">
                        {e.seq}
                      </span>
                      <span className={`font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] shrink-0 hidden sm:inline ${e.tone}`}>
                        {e.actor}
                      </span>
                      <span className="font-[var(--font-mono)] text-[0.66rem] text-[var(--bb-white)] truncate">
                        {e.action}
                      </span>
                      {complete && i === EVENTS.length - 1 && (
                        <span className="ml-auto font-[var(--font-mono)] text-[0.52rem] text-emerald-400 shrink-0">
                          ✓ SETTLED
                        </span>
                      )}
                    </div>
                    <div className="mt-1 pl-[42px] sm:pl-[104px] font-[var(--font-sans)] text-[0.74rem] text-[var(--bb-grey-2)] leading-relaxed">
                      {e.reason}
                    </div>
                  </div>
                ))}
                {!complete && visible < EVENTS.length && (
                  <div className="pt-2.5 flex items-center gap-2 pl-1">
                    <span className="inline-block w-[7px] h-[13px] bg-[var(--bb-orange)] animate-[blink_0.9s_steps(1)_infinite]" />
                    <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)]">
                      next: {EVENTS[visible].action}
                    </span>
                  </div>
                )}
              </div>

              {/* progress */}
              <div className="px-5 pb-4">
                <div className="h-[2px] bg-[var(--bb-line-soft)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--bb-orange)] transition-all duration-700 ease-out"
                    style={{ width: `${(visible / EVENTS.length) * 100}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] tabular-nums">
                  <span>trc_9ede1020…</span>
                  <span>
                    {visible}/{EVENTS.length} EVENTS
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 font-[var(--font-mono)] text-[0.52rem] tracking-[0.06em] text-[var(--bb-grey-4)]">
              ANIMATED ILLUSTRATION · REAL EVENT SCHEMA — the console replays live traces from the database in this format.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
