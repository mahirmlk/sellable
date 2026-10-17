"use client";

import { useEffect, useState } from "react";
import { Eyebrow } from "./ui/eyebrow";
import { useInView } from "@/lib/use-in-view";

// Rules enforced by sellable/policy.py, in evaluation order. The walk
// stops at the first failed check, and every verdict carries a reason
// code that lands in the ledger. No sample carts, no amounts.

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
  code?: string;
  verdictNote: string;
  failingRule?: number;
}

const SCENARIOS: Scenario[] = [
  {
    name: "Inside every limit",
    setup: "stocked SKU · inside budget and caps",
    verdict: "ALLOW",
    verdictNote: "Every check passes. Consent can be issued.",
  },
  {
    name: "Below the floor",
    setup: "offer under the merchant floor",
    verdict: "DENY",
    code: "BELOW_FLOOR_PRICE",
    verdictNote: "The walk stops here. No order is created.",
    failingRule: 3,
  },
  {
    name: "Above the approval line",
    setup: "valid cart, over the human threshold",
    verdict: "NEEDS_HUMAN_APPROVAL",
    code: "ABOVE_APPROVAL_THRESHOLD",
    verdictNote: "Held for you. Payment cannot start until you approve.",
    failingRule: 6,
  },
];

const TICK_MS = 380;
const HOLD_TICKS = 5;
const CYCLE = RULES.length + HOLD_TICKS;

const LONGEST_NOTE = "Held for you. Payment cannot start until you approve.";

const REASON_CODES = [
  "BELOW_FLOOR_PRICE",
  "MAX_DISCOUNT_EXCEEDED",
  "OVER_BUDGET",
  "INSUFFICIENT_STOCK",
  "MAX_NEGOTIATION_ROUNDS",
  "ABOVE_APPROVAL_THRESHOLD",
];

// Each control answers one attack class. Refs point at the mechanism.
const CONTROLS = [
  {
    threat: "Forged sessions",
    mechanism: "ES256 + JWKS",
    detail:
      "Supabase access tokens verify locally against the project's JWKS with strict issuer and audience checks. Keys rotate without a deploy.",
    refs: ["sellable/supabase_jwt.py"],
  },
  {
    threat: "Cross-merchant access",
    mechanism: "Per-store scoping",
    detail:
      "A verified login says nothing about access. Your user id resolves to your store, and another store's id comes back 404.",
    refs: ["merchant_users"],
  },
  {
    threat: "Database abuse",
    mechanism: "RLS + zero anon grants",
    detail:
      "Application tables carry row-level security and zero grants for the anon and authenticated roles. Only the backend's service role touches data.",
    refs: ["supabase/migrations"],
  },
  {
    threat: "Key leakage and replay",
    mechanism: "Hashes + nonce claims",
    detail:
      "Agent keys are stored as SHA-256 hashes. Signed requests carry a timestamp and a nonce that is claimed once and expires after five minutes.",
    refs: ["X-Signature", "X-Nonce"],
  },
  {
    threat: "Forged payment success",
    mechanism: "Webhook-only settlement",
    detail:
      "No browser, agent, or admin endpoint can mark an order paid. A signature-verified Razorpay webhook settles it, the amount has to match, and duplicate deliveries are ignored.",
    refs: ["POST /webhooks/razorpay"],
  },
  {
    threat: "Unbounded agent behavior",
    mechanism: "Deterministic policy + consent",
    detail:
      "Floors, caps, thresholds, and catalog grounding are plain code. Payment needs a single-use token bound to one order's amount and payee.",
    refs: ["policy.py", "consent.py"],
  },
];

const EXTRA = [
  "Per-IP rate limits on every route",
  "PII redacted before the ledger",
  "Prices re-verified before payment",
];

export function PolicySecurity() {
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
  const walkLen =
    scenario.failingRule !== undefined ? scenario.failingRule + 1 : RULES.length;
  const ruleStep = Math.min(phase + 1, walkLen);
  const showVerdict = phase >= walkLen;

  return (
    <section id="security" className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative" ref={ref}>
        <div className="max-w-[760px]">
          <Eyebrow label="Policy and security" />
          <h2 className="section-title mt-6 text-[var(--bb-white)]">
            The checkpoint before money
          </h2>
          <p className="body-copy mt-6">
            Every cart passes the same checks in the same order, and the walk
            stops at the first failed check. No model runs in this path, so
            the same cart gets the same verdict, and only a verified webhook
            can settle a payment.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-[clamp(36px,5vw,80px)] items-center">
          {/* the engine, evaluating */}
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
                  const isFailing = checked && scenario.failingRule === i;
                  const stopped =
                    showVerdict &&
                    scenario.failingRule !== undefined &&
                    i > scenario.failingRule;
                  return (
                    <div
                      key={rule.ref}
                      className={`py-2 flex items-center gap-3 border-b border-[var(--bb-line-soft)] last:border-b-0 transition-opacity duration-300 ${
                        stopped ? "opacity-25" : checked ? "opacity-100" : "opacity-35"
                      }`}
                    >
                      <span
                        className={`font-[var(--font-mono)] text-[0.55rem] w-[40px] shrink-0 ${
                          checked ? "text-[var(--bb-orange)]" : "text-[var(--bb-grey-4)]"
                        }`}
                      >
                        {isFailing ? "✕" : checked ? "✓" : "··"}
                      </span>
                      <div className="min-w-0">
                        <div
                          className={`font-[var(--font-mono)] text-[0.64rem] ${
                            checked ? "text-[var(--bb-white)]" : "text-[var(--bb-grey-3)]"
                          }`}
                        >
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
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-[var(--font-mono)] text-[0.68rem] tracking-[0.14em] uppercase font-semibold">
                      {showVerdict
                        ? `${scenario.verdict}${scenario.code ? ` · ${scenario.code}` : ""}`
                        : "EVALUATING…"}
                    </span>
                    <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] shrink-0">
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
                  DETERMINISTIC · NO MODEL IN THIS PATH, the same cart always
                  gets the same verdict.
                </div>
              </div>
            </div>
          </div>

          {/* the rules, in plain words */}
          <div className="order-1 lg:order-2">
            <div className="space-y-2.5">
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

            <div className="mt-9 border-t border-[var(--bb-line-soft)] pt-6">
              <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)] mb-3">
                Declines come with a code
              </div>
              <div className="flex flex-wrap gap-1.5">
                {REASON_CODES.map((code) => (
                  <span
                    key={code}
                    className="font-[var(--font-mono)] text-[0.5rem] px-1.5 py-0.5 border border-[var(--bb-line-soft)] text-[var(--bb-grey-2)]"
                  >
                    {code}
                  </span>
                ))}
              </div>
              <p className="mt-3 font-[var(--font-sans)] text-[0.8rem] leading-relaxed text-[var(--bb-grey-2)]">
                Every verdict carries a reason code and a policy reference
                into the ledger.
              </p>
            </div>
          </div>
        </div>

        {/* Security model */}
        <div className="mt-20 pt-14 border-t border-[var(--bb-line)]">
          <div className="max-w-[720px]">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
              Security model
            </div>
            <h3 className="mt-4 font-[var(--font-sans)] text-[clamp(1.6rem,2.6vw,2.2rem)] tracking-[-0.03em] text-[var(--bb-white)]">
              Built for agents spending money
            </h3>
            <p className="body-copy mt-5">
              Autonomous buying is a threat model first. Each control below
              answers one attack, and each one runs in this codebase.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {CONTROLS.map((c) => (
              <div
                key={c.threat}
                className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 flex flex-col transition-colors duration-300 hover:border-[var(--bb-grey-4)]"
              >
                <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)]">
                  {c.threat}
                </div>
                <div className="mt-2.5 font-[var(--font-sans)] text-[1.05rem] tracking-[-0.02em] text-[var(--bb-white)]">
                  {c.mechanism}
                </div>
                <p className="mt-3 font-[var(--font-sans)] text-[0.84rem] leading-relaxed text-[var(--bb-grey-1)]">
                  {c.detail}
                </p>
                <div className="mt-auto pt-5 flex flex-wrap gap-1.5">
                  {c.refs.map((r) => (
                    <span
                      key={r}
                      className="font-[var(--font-mono)] text-[0.5rem] px-1.5 py-0.5 border border-[var(--bb-line-soft)] text-[var(--bb-grey-3)]"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 font-[var(--font-mono)] text-[0.55rem] tracking-[0.04em] text-[var(--bb-grey-4)]">
            {EXTRA.map((e) => (
              <span key={e} className="inline-flex items-center gap-2">
                <span className="w-[4px] h-[4px] bg-[var(--bb-orange)]" />
                {e}
              </span>
            ))}
            <span className="sm:ml-auto">Each control is covered by tests in tests/.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
