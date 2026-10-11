"use client";

import { useEffect, useRef, useState } from "react";
import { Eyebrow } from "./ui/eyebrow";
import { CornerBrackets } from "./ui/corner-brackets";
import { useInView } from "@/lib/use-in-view";

// The ledger schema, animated. No sample order, no amounts, no trace
// ids. The console replays real orders in this shape.
interface ReplayEvent {
  seq: string;
  actor: string;
  action: string;
  reason: string;
}

const EVENTS: ReplayEvent[] = [
  { seq: "01", actor: "SELLER AGENT", action: "catalog.search", reason: "Search ran against the merchant catalog only." },
  { seq: "02", actor: "SELLER AGENT", action: "quote.created", reason: "Quote built from a stocked SKU and current price." },
  { seq: "03", actor: "SELLER AGENT", action: "negotiation.countered", reason: "Counter offered at the lowest price policy allows." },
  { seq: "04", actor: "POLICY ENGINE", action: "policy.checked", reason: "Verdict recorded with the rules that applied." },
  { seq: "05", actor: "CONSENT SERVICE", action: "consent.issued", reason: "Single-use token bound to the order." },
  { seq: "06", actor: "COMMERCE CORE", action: "order.created", reason: "Order held until payment is verified." },
  { seq: "07", actor: "RAZORPAY", action: "webhook.reconciled", reason: "Provider signature verified. Nothing else can settle." },
  { seq: "08", actor: "COMMERCE CORE", action: "order.paid", reason: "Settled. The full path stays replayable." },
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
    <section className="technical-section py-[clamp(64px,8vw,130px)]" id="ledger">
      <div className="page-frame relative" ref={ref}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-[clamp(36px,5vw,80px)] items-center">
          <div>
            <Eyebrow label="Explainability" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              Each order keeps its story.
            </h2>
            <p className="body-copy mt-6">
              Not just that a sale happened, but how. Actor, action, and
              reason for each step, in the order the ledger wrote them.
            </p>
            <div className="mt-8 space-y-2.5">
              {[
                ["Actor", "which system acted"],
                ["Reasoning", "why, in plain language"],
                ["Policy refs", "which rules were checked"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-3">
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-white)] w-[92px] shrink-0">
                    {k}
                  </span>
                  <span className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-1)]">
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            className="relative"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="relative border border-[#30302E] bg-[var(--bb-panel)] overflow-hidden">
              <CornerBrackets />
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--bb-line)]">
                <div className="flex items-center gap-2.5">
                  <span className="w-[5px] h-[5px] rounded-full bg-[var(--bb-orange)] live-dot" />
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                    Ledger shape
                  </span>
                </div>
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] text-[var(--bb-grey-4)]">
                  {paused ? "PAUSED" : complete ? "COMPLETE" : "WALKTHROUGH"}
                </span>
              </div>

              <div className="px-5 py-3">
                {EVENTS.map((e, i) => {
                  const shown = i < visible;
                  const isCurrent = shown && i === visible - 1 && !complete;
                  return (
                    <div
                      key={e.seq}
                      className={`py-2 border-b border-[var(--bb-line-soft)] last:border-b-0 transition-colors duration-300 ${
                        shown ? "" : "invisible"
                      } ${isCurrent ? "bg-white/[0.04] -mx-2 px-2" : ""}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] tabular-nums shrink-0">
                          {e.seq}
                        </span>
                        <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] text-[var(--bb-grey-2)] shrink-0 hidden sm:inline">
                          {e.actor}
                        </span>
                        <span className="font-[var(--font-mono)] text-[0.66rem] text-[var(--bb-white)] truncate">
                          {e.action}
                        </span>
                        {complete && i === EVENTS.length - 1 && (
                          <span className="ml-auto font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-white)] shrink-0">
                            SETTLED
                          </span>
                        )}
                      </div>
                      <div className="mt-1 pl-[42px] sm:pl-[104px] font-[var(--font-sans)] text-[0.74rem] text-[var(--bb-grey-2)] leading-relaxed">
                        {e.reason}
                      </div>
                    </div>
                  );
                })}
                <div className="h-[26px] flex items-center gap-2 pl-1">
                  {!complete && visible < EVENTS.length ? (
                    <>
                      <span className="inline-block w-[7px] h-[13px] bg-[var(--bb-white)] animate-[blink_0.9s_steps(1)_infinite]" />
                      <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)]">
                        next: {EVENTS[visible].action}
                      </span>
                    </>
                  ) : (
                    <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] text-[var(--bb-grey-4)]">
                      SCHEMA PREVIEW · RESTARTING
                    </span>
                  )}
                </div>
              </div>

              <div className="px-5 pb-4">
                <div className="h-[2px] bg-[var(--bb-line-soft)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--bb-white)] transition-all duration-700 ease-out"
                    style={{ width: `${(visible / EVENTS.length) * 100}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] tabular-nums">
                  <span>event shape, not a sample order</span>
                  <span>
                    {visible}/{EVENTS.length} STEPS
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 font-[var(--font-mono)] text-[0.52rem] tracking-[0.06em] text-[var(--bb-grey-4)]">
              OPEN ANY ORDER IN THE CONSOLE TO REPLAY ITS REAL TRACE.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
