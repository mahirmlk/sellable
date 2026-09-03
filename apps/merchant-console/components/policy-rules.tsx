"use client";

import { useEffect, useState } from "react";
import { Eyebrow } from "./ui/eyebrow";
import { useInView } from "@/lib/use-in-view";

// The real rule references enforced by sellable/policy.py, evaluated in the
// order the engine runs them. Three scenarios cycle so the page shows the
// three possible verdicts: ALLOW, NEEDS_HUMAN_APPROVAL, DENY.
//
// Timing is a single interval driving a total tick counter — scenario,
// revealed rules, and verdict are all derived arithmetically. No chained
// timeouts, no nested setState, nothing that can stall.

const RULES = [
  { ref: "POLICY.catalog_grounding", label: "Catalog grounding", note: "only SKUs the merchant actually stocks" },
  { ref: "POLICY.buyer_allowed_categories", label: "Buyer categories", note: "cart fits the buyer's mandate" },
  { ref: "POLICY.merchant_allowed_categories", label: "Merchant categories", note: "cart fits what the store sells" },
  { ref: "POLICY.floor_price", label: "Floor price", note: "offers below the merchant floor are countered" },
  { ref: "POLICY.buyer_budget", label: "Buyer budget", note: "cart fits the agent's spending mandate" },
  { ref: "POLICY.max_order_value", label: "Max order value", note: "hard cap on every order" },
  { ref: "POLICY.human_approval_threshold", label: "HITL threshold", note: "above the line, a human decides" },
];

interface Scenario {
  name: string;
  setup: string;
  verdict: "ALLOW" | "NEEDS_HUMAN_APPROVAL" | "DENY";
  verdictNote: string;
  failingRule?: number;
}

const SCENARIOS: Scenario[] = [
  {
    name: "Standard mission",
    setup: "1 × ₹1,948 cart — buyer budget ₹6,000",
    verdict: "ALLOW",
    verdictNote: "All seven rules pass. Consent can be issued.",
  },
  {
    name: "Aggressive offer",
    setup: "Buyer offers ₹1,200 against a ₹1,899 floor",
    verdict: "DENY",
    verdictNote: "Floor price breached — the counter is blocked, no order is created.",
    failingRule: 3,
  },
  {
    name: "High-value order",
    setup: "Cart totals ₹2,499 — HITL threshold ₹2,000",
    verdict: "NEEDS_HUMAN_APPROVAL",
    verdictNote: "Order held in AWAITING_CONSENT until the merchant approves it.",
    failingRule: 6,
  },
];

const TICK_MS = 380;
const HOLD_TICKS = 5;
const CYCLE = RULES.length + HOLD_TICKS; // 7 reveal ticks + 5 verdict-hold ticks

// Longest verdict note — rendered invisibly while evaluating so the verdict
// box keeps its full expanded size and never pushes the layout.
const LONGEST_NOTE =
  "Floor price breached — the counter is blocked, no order is created.";

export function PolicyRules() {
  const { ref, isInView } = useInView();
  const [total, setTotal] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!isInView || paused) return;
    const timer = window.setInterval(() => {
      setTotal((t) => t + 1);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [isInView, paused]);

  const scenario = SCENARIOS[Math.floor(total / CYCLE) % SCENARIOS.length];
  const phase = total % CYCLE;
  const ruleStep = Math.min(phase + 1, RULES.length);
  const showVerdict = phase >= RULES.length;

  return (
    <section id="policy" className="technical-section py-[clamp(64px,8vw,130px)]">
      <div className="page-frame relative" ref={ref}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-[clamp(36px,5vw,80px)] items-center">
          {/* Left: rule evaluation */}
          <div
            className="relative order-2 lg:order-1"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="relative border border-[#30302E] bg-[var(--bb-panel)] overflow-hidden">
              {/* header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--bb-line)]">
                <div className="flex items-center gap-2.5">
                  <span className="w-[5px] h-[5px] rounded-full bg-[var(--bb-orange)] live-dot" />
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                    POLICY ENGINE · EVALUATING
                  </span>
                </div>
                <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] hidden sm:block truncate max-w-[220px]">
                  {scenario.setup}
                </span>
              </div>

              {/* rules */}
              <div className="px-4 py-2">
                {RULES.map((rule, i) => {
                  const checked = i < ruleStep;
                  const isFailing = showVerdict && scenario.failingRule === i;
                  return (
                    <div
                      key={rule.ref}
                      className={`py-2 flex items-center gap-3 border-b border-[var(--bb-line-soft)] last:border-b-0 transition-opacity duration-300 ${
                        checked ? "opacity-100" : "opacity-35"
                      }`}
                    >
                      <span
                        className={`font-[var(--font-mono)] text-[0.55rem] w-[40px] shrink-0 ${
                          checked ? "text-[var(--bb-orange)]" : "text-[var(--bb-grey-4)]"
                        }`}
                      >
                        {checked ? (isFailing ? "✕" : "✓") : "··"}
                      </span>
                      <div className="min-w-0">
                        <div className={`font-[var(--font-mono)] text-[0.64rem] ${checked ? "text-[var(--bb-white)]" : "text-[var(--bb-grey-3)]"}`}>
                          {rule.label}
                        </div>
                        <div className="font-[var(--font-sans)] text-[0.68rem] text-[var(--bb-grey-3)] leading-snug">
                          {rule.note}
                        </div>
                      </div>
                      <span className="ml-auto font-[var(--font-mono)] text-[0.48rem] text-[var(--bb-grey-4)] hidden sm:block shrink-0">
                        {rule.ref}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* verdict */}
              <div className="px-4 pb-4">
                <div
                  className={`border px-4 py-2.5 transition-colors duration-300 ${
                    showVerdict
                      ? "border-[var(--bb-orange)]/50 text-[var(--bb-white)] bg-[var(--bb-orange)]/[0.06]"
                      : "border-[var(--bb-line)] text-[var(--bb-grey-2)] bg-transparent"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-[var(--font-mono)] text-[0.68rem] tracking-[0.14em] uppercase font-semibold">
                      {showVerdict ? scenario.verdict : "EVALUATING…"}
                    </span>
                    <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)]">
                      {scenario.name}
                    </span>
                  </div>
                  {showVerdict ? (
                    <div className="mt-1 font-[var(--font-sans)] text-[0.72rem] leading-relaxed opacity-90">
                      {scenario.verdictNote}
                    </div>
                  ) : (
                    <div
                      aria-hidden="true"
                      className="mt-1 font-[var(--font-sans)] text-[0.72rem] leading-relaxed invisible"
                    >
                      {LONGEST_NOTE}
                    </div>
                  )}
                </div>
                <div className="mt-2.5 font-[var(--font-mono)] text-[0.5rem] tracking-[0.06em] text-[var(--bb-grey-4)]">
                  DETERMINISTIC · NO LLM IN THIS PATH — the same cart always gets the same verdict.
                </div>
              </div>
            </div>
          </div>

          {/* Right: copy */}
          <div className="order-1 lg:order-2">
            <Eyebrow label="10 — POLICY ENGINE" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              The gauntlet between intent and money
            </h2>
            <p className="body-copy mt-6">
              Before any order exists, the candidate cart crosses the
              deterministic policy engine — the same code path for every
              buyer, every time. The AI never sees this layer; it cannot
              argue, retry, or negotiate with it.
            </p>
            <div className="mt-8 space-y-2.5">
              {[
                ["Grounded", "a SKU that isn't in your catalog cannot be bought"],
                ["Bounded", "floors, caps, and discounts are hard limits"],
                ["Gated", "above your threshold, only a human can proceed"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-3">
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-orange)] w-[88px] shrink-0">
                    {k}
                  </span>
                  <span className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-1)]">
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
