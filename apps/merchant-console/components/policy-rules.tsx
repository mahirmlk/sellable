"use client";

import { useEffect, useRef, useState } from "react";
import { Eyebrow } from "./ui/eyebrow";
import { useInView } from "@/lib/use-in-view";

// The real rule references enforced by sellable/policy.py, evaluated in the
// order the engine runs them. Three scenarios cycle so the page shows the
// three possible verdicts: ALLOW, NEEDS_HUMAN_APPROVAL, DENY.

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
  tone: "green" | "amber" | "red";
  failingRule?: number;
}

const SCENARIOS: Scenario[] = [
  {
    name: "Standard mission",
    setup: "1 × ₹1,948 cart — buyer budget ₹6,000",
    verdict: "ALLOW",
    verdictNote: "All seven rules pass. Consent can be issued.",
    tone: "green",
  },
  {
    name: "Aggressive offer",
    setup: "Buyer offers ₹1,200 against a ₹1,899 floor",
    verdict: "DENY",
    verdictNote: "Floor price breached — the counter is blocked, no order is created.",
    tone: "red",
    failingRule: 3,
  },
  {
    name: "High-value order",
    setup: "Cart totals ₹2,499 — HITL threshold ₹2,000",
    verdict: "NEEDS_HUMAN_APPROVAL",
    verdictNote: "Order held in AWAITING_CONSENT until the merchant approves it.",
    tone: "amber",
    failingRule: 6,
  },
];

const STEP_MS = 420;
const VERDICT_HOLD_MS = 2600;

export function PolicyRules() {
  const { ref, isInView } = useInView();
  const [scenario, setScenario] = useState(0);
  const [ruleStep, setRuleStep] = useState(0);
  const [showVerdict, setShowVerdict] = useState(false);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!isInView) return;
    const timer = window.setInterval(() => {
      if (pausedRef.current) return;
      setShowVerdict((v) => {
        if (!v) {
          setRuleStep((r) => {
            if (r >= RULES.length) {
              return r;
            }
            return r + 1;
          });
          return v;
        }
        return v;
      });
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [isInView]);

  // Sequencing: rules tick → verdict shows → hold → next scenario
  useEffect(() => {
    if (!isInView) return;
    let timer: number;
    if (ruleStep >= RULES.length && !showVerdict) {
      timer = window.setTimeout(() => setShowVerdict(true), 350);
    } else if (showVerdict) {
      timer = window.setTimeout(() => {
        setShowVerdict(false);
        setRuleStep(0);
        setScenario((s) => (s + 1) % SCENARIOS.length);
      }, VERDICT_HOLD_MS);
    }
    return () => window.clearTimeout(timer);
  }, [ruleStep, showVerdict, isInView]);

  const current = SCENARIOS[scenario];
  const verdictTone =
    current.tone === "green"
      ? "border-emerald-400/40 text-emerald-400 bg-emerald-400/5"
      : current.tone === "amber"
        ? "border-amber-400/40 text-amber-400 bg-amber-400/5"
        : "border-red-400/40 text-red-400 bg-red-400/5";

  return (
    <section id="policy" className="technical-section py-[clamp(80px,10vw,160px)] overflow-hidden relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-[0.5]" style={{ background: "radial-gradient(620px 420px at 16% 55%, rgba(255,105,0,0.055), transparent 66%)" }} />
      </div>

      <div className="page-frame relative" ref={ref}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-[clamp(48px,7vw,112px)] items-center">
          {/* Left: animated rule evaluation */}
          <div
            className="relative order-2 lg:order-1"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="relative border border-[#30302E] bg-[var(--bb-panel)] overflow-hidden">
              {/* header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--bb-line)]">
                <div className="flex items-center gap-2.5">
                  <span className="w-[5px] h-[5px] bg-[var(--bb-orange)] animate-[pulse_1.6s_ease-in-out_infinite]" />
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                    POLICY ENGINE · EVALUATING
                  </span>
                </div>
                <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] hidden sm:block truncate max-w-[220px]">
                  {current.setup}
                </span>
              </div>

              {/* rules */}
              <div className="px-5 py-3">
                {RULES.map((rule, i) => {
                  const checked = i < ruleStep;
                  const isFailing = showVerdict && current.failingRule === i;
                  return (
                    <div
                      key={rule.ref}
                      className={`py-2 flex items-center gap-3 border-b border-[var(--bb-line-soft)] last:border-b-0 transition-opacity duration-300 ${
                        checked ? "opacity-100" : "opacity-35"
                      }`}
                    >
                      <span
                        className={`font-[var(--font-mono)] text-[0.55rem] w-[44px] shrink-0 ${
                          isFailing ? "text-red-400" : checked ? "text-emerald-400" : "text-[var(--bb-grey-4)]"
                        }`}
                      >
                        {checked ? (isFailing ? "✕" : "✓") : "··"}
                      </span>
                      <div className="min-w-0">
                        <div className={`font-[var(--font-mono)] text-[0.66rem] ${checked ? "text-[var(--bb-white)]" : "text-[var(--bb-grey-3)]"}`}>
                          {rule.label}
                        </div>
                        <div className="font-[var(--font-sans)] text-[0.7rem] text-[var(--bb-grey-3)] leading-snug">
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
              <div className="px-5 pb-5">
                <div
                  className={`border px-4 py-3 transition-all duration-500 ${verdictTone} ${
                    showVerdict ? "opacity-100 translate-y-0" : "opacity-40 translate-y-1"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-[var(--font-mono)] text-[0.7rem] tracking-[0.14em] uppercase font-semibold">
                      {showVerdict ? current.verdict : "EVALUATING…"}
                    </span>
                    <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)]">
                      {current.name}
                    </span>
                  </div>
                  {showVerdict && (
                    <div className="mt-1 font-[var(--font-sans)] text-[0.74rem] leading-relaxed opacity-90">
                      {current.verdictNote}
                    </div>
                  )}
                </div>
                <div className="mt-3 font-[var(--font-mono)] text-[0.5rem] tracking-[0.06em] text-[var(--bb-grey-4)]">
                  DETERMINISTIC · NO LLM IN THIS PATH — the same cart always gets the same verdict.
                </div>
              </div>
            </div>
          </div>

          {/* Right: copy */}
          <div className="order-1 lg:order-2">
            <Eyebrow label="05 — POLICY ENGINE" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              Seven rules between intent and money
            </h2>
            <p className="body-copy mt-6">
              Before any order exists, the candidate cart crosses the deterministic
              policy engine — the same code path for every buyer, every time. The
              LLM never sees this layer; it cannot argue, retry, or negotiate
              with it.
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
