"use client";

import { useState } from "react";
import { Eyebrow } from "./ui/eyebrow";
import { IsoStack } from "./iso-stack";

const capabilities = [
  {
    title: "Agent discovery",
    description:
      "A public manifest tells shopping agents who you are, what you sell, and how to talk to your store.",
  },
  {
    title: "Policy engine",
    description:
      "One deterministic pass over the cart. Floors, caps, budgets, and approval limits, checked the same way every time.",
  },
  {
    title: "Consent gates",
    description:
      "Payments need a single-use token tied to the exact order. When it is spent or expired, it is done.",
  },
  {
    title: "Ledger",
    description:
      "Each material step records who acted, what happened, why, and which rule applied. Replay it line by line.",
  },
  {
    title: "Negotiation bounds",
    description:
      "The Seller Agent can counter inside your limits. It cannot change the floor, the cap, or the round limit.",
  },
];

const apiSurface = [
  { method: "GET", path: "/.well-known/agents.json", note: "who you are" },
  { method: "GET", path: "/catalog.ai.json", note: "what you sell" },
  { method: "GET", path: "/llms.txt", note: "how to behave" },
  { method: "GET", path: "/health", note: "liveness probe" },
  { method: "POST", path: "/console/orders", note: "gated ordering" },
  { method: "POST", path: "/webhooks/razorpay", note: "signed settlement" },
];

export function Features() {
  const [activeCap, setActiveCap] = useState<number | null>(null);

  return (
    <section id="platform" className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.82fr)] gap-[clamp(48px,8vw,128px)]">
          <div>
            <Eyebrow label="The platform" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              Quiet machinery behind every sale
            </h2>
            <p className="body-copy mt-6">
              Agents do the talking. Deterministic systems handle the parts
              that touch money.
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

          <div className="flex flex-col gap-6 justify-center">
            <IsoStack compact />
            <div className="w-full">
              <div className="border border-[#30302E] p-6 transition-all duration-500 hover:border-[#404040]">
                <div className="flex items-center justify-between mb-5">
                  <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
                    Public surface
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-[5px] h-[5px] bg-[var(--bb-orange)]" />
                    <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
                      documented
                    </span>
                  </div>
                </div>

                <div className="border border-[#282826] p-5">
                  <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] mb-4">
                    What agents may call
                  </div>

                  <div className="divide-y divide-[var(--bb-line-soft)]">
                    {apiSurface.map((ep) => (
                      <div key={ep.path} className="py-2.5 flex items-center gap-3 first:pt-0 last:pb-0">
                        <span
                          className={`font-[var(--font-mono)] text-[0.52rem] tracking-[0.06em] px-1.5 py-0.5 border flex-shrink-0 ${
                            ep.method === "GET"
                              ? "border-[var(--bb-line)] text-[var(--bb-grey-1)]"
                              : "border-[var(--bb-orange)]/40 text-[var(--bb-orange)]"
                          }`}
                        >
                          {ep.method}
                        </span>
                        <span className="font-[var(--font-mono)] text-[0.66rem] text-[var(--bb-white)] truncate">
                          {ep.path}
                        </span>
                        <span className="ml-auto font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] hidden sm:block flex-shrink-0">
                          {ep.note}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="status-highlight relative mt-5">
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
                      No screen, agent, or admin action can mark an order
                      paid. Only a verified provider webhook can.
                    </p>
                  </div>
                </div>

                <div className="mt-4 font-[var(--font-mono)] text-[0.55rem] tracking-[0.06em] text-[var(--bb-grey-4)] leading-relaxed">
                  Discovery is public. Ordering is gated. Settlement is
                  verified. That order never changes.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
