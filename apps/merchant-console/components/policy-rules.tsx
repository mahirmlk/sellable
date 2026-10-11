"use client";

import { useEffect, useState } from "react";
import { Eyebrow } from "./ui/eyebrow";
import { useInView } from "@/lib/use-in-view";

// Rule references enforced by sellable/policy.py, in evaluation order.
// No sample carts, no amounts. The panel cycles through the three
// verdicts the engine can return.
const RULES = [
  { ref: "POLICY.catalog_grounding", label: "Catalog grounding", note: "the SKU has to exist in your catalog" },
  { ref: "POLICY.buyer_allowed_categories", label: "Buyer categories", note: "the cart fits the buyer's permission" },
  { ref: "POLICY.merchant_allowed_categories", label: "Merchant categories", note: "the cart fits what you sell" },
  { ref: "POLICY.floor_price", label: "Floor price", note: "offers below your floor get countered" },
  { ref: "POLICY.buyer_budget", label: "Buyer budget", note: "the total fits the buyer's ceiling" },
  { ref: "POLICY.max_order_value", label: "Max order value", note: "a hard cap on every order" },
  { ref: "POLICY.human_approval_threshold", label: "Approval line", note: "above it, a person decides" },
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
    name: "Inside every limit",
    setup: "stocked SKU · inside budget and caps",
    verdict: "ALLOW",
    verdictNote: "Each check passes. Consent can be issued.",
  },
  {
    name: "Below the floor",
    setup: "offer under the merchant floor",
    verdict: "DENY",
    verdictNote: "The floor holds. No order is created.",
    failingRule: 3,
  },
  {
    name: "Above the approval line",
    setup: "valid cart, over the human threshold",
    verdict: "NEEDS_HUMAN_APPROVAL",
    verdictNote: "The order waits until the merchant approves it.",
    failingRule: 6,
  },
];

const TICK_MS = 380;
const HOLD_TICKS = 5;
const CYCLE = RULES.length + HOLD_TICKS;

const LONGEST_NOTE =
  "The order waits until the merchant approves it.";

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
          <div
            className="relative order-2 lg:order-1"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="relative border border-[#30302E] bg-[var(--bb-panel)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--bb-line)]">
                <div className="flex items-center gap-2.5">
                  <span className="w-[5px] h-[5px] rounded-full bg-[var(--bb-orange)] live-dot" />
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                    Policy engine · evaluating
                  </span>
                </div>
                <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] hidden sm:block truncate max-w-[220px]">
                  {scenario.setup}
                </span>
              </div>

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
                  DETERMINISTIC · NO MODEL IN THIS PATH, the same cart always gets the same verdict.
                </div>
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <Eyebrow label="Policy engine" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              The checkpoint before money
            </h2>
            <p className="body-copy mt-6">
              Each cart passes the same checks in the same order, for each
              buyer. The agents cannot argue with this layer or work around
              it.
            </p>
            <div className="mt-8 space-y-2.5">
              {[
                ["Grounded", "a SKU outside your catalog cannot be bought"],
                ["Bounded", "floors, caps, and discounts hold firm"],
                ["Gated", "past your line, only a person can proceed"],
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
