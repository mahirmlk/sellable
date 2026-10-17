"use client";

import { useState } from "react";
import { Eyebrow } from "./ui/eyebrow";

const capabilities = [
  {
    title: "Agent discovery",
    description:
      "Your store publishes a manifest, a machine-readable catalog, and ground rules. Agents read them instead of scraping pages.",
  },
  {
    title: "Policy engine",
    description:
      "Every cart runs the same checks in the same order: floors, caps, budgets, approval limits. No model sits in this path.",
  },
  {
    title: "Consent gates",
    description:
      "Payment needs a single-use token bound to one order: amount, payee, expiry. Once spent, or once it expires, it is done.",
  },
  {
    title: "Ledger",
    description:
      "Who acted, what happened, why, and which rule applied. Open any order and replay it line by line.",
  },
  {
    title: "Negotiation bounds",
    description:
      "The Seller Agent can counter inside your limits. It cannot move the floor, the cap, or the round limit.",
  },
];

// The layer rail: how a request moves through the build, top to bottom.
// Every ref points at the real endpoint, field, or module.
const layers = [
  { name: "Public surface", detail: "who you are, what you sell, how to behave", ref: "/.well-known/agents.json" },
  { name: "Gateway", detail: "agent keys, signed requests, replay guard", ref: "X-Signature · X-Nonce" },
  { name: "Catalog", detail: "your SKUs, prices, floors, stock", ref: "/catalog.ai.json" },
  { name: "Seller agent", detail: "quotes and counters inside your limits", ref: "agents/seller" },
  { name: "Policy engine", detail: "one deterministic pass, three verdicts", ref: "sellable/policy.py" },
  { name: "Consent", detail: "single-use, bound to the order", ref: "sellable/consent.py" },
  { name: "Settlement", detail: "Razorpay, signed webhook only", ref: "POST /webhooks/razorpay" },
  { name: "Ledger", detail: "who, what, why, which rule", ref: "ledger_events" },
];

export function Features() {
  const [activeCap, setActiveCap] = useState<number | null>(null);

  return (
    <section id="platform" className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] gap-[clamp(48px,8vw,128px)]">
          <div>
            <Eyebrow label="The platform" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              The machinery behind every sale
            </h2>
            <p className="body-copy mt-6">
              Agents do the talking with buyers. Everything that touches money
              runs through systems that cannot improvise.
            </p>

            <div className="mt-12">
              {capabilities.map((cap, i) => (
                <div
                  key={cap.title}
                  className={`capability-row cursor-default transition-all duration-300 ${
                    activeCap === i
                      ? "bg-[var(--bb-panel)] border-l-2 border-l-[var(--bb-orange)] pl-6 -ml-6"
                      : "border-l-2 border-l-transparent"
                  }`}
                  onMouseEnter={() => setActiveCap(i)}
                  onMouseLeave={() => setActiveCap(null)}
                >
                  <div className="capability-title">
                    <span className="text-[var(--bb-grey-4)] mr-2 tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {cap.title}
                  </div>
                  <div className="capability-description">{cap.description}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-center">
            <div className="w-full border border-[#30302E] bg-[var(--bb-panel)]">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--bb-line)]">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                  The stack
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-[5px] h-[5px] bg-[var(--bb-orange)]" />
                  <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
                    documented
                  </span>
                </div>
              </div>

              <div>
                {layers.map((layer, i) => (
                  <div
                    key={layer.name}
                    className="group flex items-baseline gap-4 px-6 py-3.5 border-b border-[var(--bb-line-soft)] last:border-b-0 transition-colors duration-300 hover:bg-[var(--bb-panel-2)]"
                  >
                    <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] tabular-nums shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-[var(--font-mono)] text-[0.62rem] tracking-[0.1em] uppercase text-[var(--bb-white)] w-[124px] shrink-0">
                      {layer.name}
                    </span>
                    <span className="font-[var(--font-sans)] text-[0.84rem] text-[var(--bb-grey-1)]">
                      {layer.detail}
                    </span>
                    <span className="ml-auto hidden xl:block font-[var(--font-mono)] text-[0.48rem] text-[var(--bb-grey-4)] group-hover:text-[var(--bb-grey-2)] transition-colors shrink-0">
                      {layer.ref}
                    </span>
                  </div>
                ))}
              </div>

              <div className="m-6 mt-5 status-highlight relative">
                <div className="flex items-center justify-between relative">
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-2)] mb-1 flex items-center gap-1.5">
                      Settlement rule
                      <span className="w-1 h-1 rounded-full bg-[var(--bb-orange)]" />
                    </div>
                    <div className="font-[var(--font-sans)] text-[1.1rem] font-medium text-[var(--bb-orange)]">
                      Webhook only
                    </div>
                  </div>
                  <span className="w-2.5 h-2.5 bg-[var(--bb-orange)] rounded-full" aria-hidden="true" />
                </div>
                <p className="mt-3 font-[var(--font-sans)] text-[0.85rem] leading-relaxed text-[var(--bb-grey-1)]">
                  No screen, agent, or admin action can mark an order paid.
                  Only a verified webhook from the payment provider can.
                </p>
              </div>

              <div className="px-6 pb-6 font-[var(--font-mono)] text-[0.55rem] tracking-[0.06em] text-[var(--bb-grey-4)] leading-relaxed">
                Discovery is public. Ordering is gated. Settlement is
                verified.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
