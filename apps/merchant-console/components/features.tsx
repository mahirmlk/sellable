"use client";

import { useState } from "react";
import { Eyebrow } from "./ui/eyebrow";

const capabilities = [
  {
    title: "AGENT DISCOVERY",
    description:
      "Machine-readable manifest at /.well-known/agents.json makes your store findable by autonomous AI buyers.",
  },
  {
    title: "POLICY ENGINE",
    description:
      "Deterministic guardrails enforce max order value, floor prices, discount limits, and human-in-the-loop thresholds.",
  },
  {
    title: "CONSENT GATES",
    description:
      "Single-use, time-bound, amount-bound consent tokens ensure no payment proceeds without explicit authorization.",
  },
  {
    title: "XAI LEDGER",
    description:
      "Every material action creates a structured audit event with actor, reasoning, policy references, and outcome.",
  },
  {
    title: "NEGOTIATION",
    description:
      "Bounded agent-to-agent negotiation within merchant policy — the LLM proposes, deterministic systems dispose.",
  },
];

export function Features() {
  const [activeCap, setActiveCap] = useState<number | null>(null);

  return (
    <section id="platform" className="technical-section py-[clamp(80px,10vw,160px)] overflow-hidden relative">
      {/* video wash */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-[0.5]" style={{ background: "radial-gradient(640px 420px at 78% 32%, rgba(255,105,0,0.07), transparent 66%)" }} />
      </div>
      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.82fr)] gap-[clamp(48px,8vw,128px)]">
          {/* Left: Content */}
          <div>
            <Eyebrow label="TRUST & SAFETY" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              Every money action is explainable, bounded, and gated
            </h2>
            <p className="body-copy mt-6">
              The core safety principle: agents propose, deterministic policy
              disposes, consent authorizes, and the ledger explains every
              material action.
            </p>

            {/* Capability rows */}
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
                  <div className="capability-title">{cap.title}</div>
                  <div className="capability-description">{cap.description}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Nested deployment diagram */}
          <div className="flex items-center">
            <div className="w-full">
              {/* Enterprise API panel */}
              <div className="border border-[#30302E] p-6 transition-all duration-500 hover:border-[#404040]">
                <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] mb-4">
                  ENTERPRISE API
                </div>

                {/* Dedicated capacity */}
                <div className="border border-[#282826] p-5 transition-all duration-500 hover:border-[#383836]">
                  <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] mb-4">
                    DEDICATED CAPACITY
                  </div>

                  {/* Single tenant */}
                  <div className="border border-[#282826] p-5 transition-all duration-500 hover:border-[#383836]">
                    <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] mb-4">
                      SINGLE-TENANT DEPLOYMENT
                    </div>

                    {/* Active status — with live video sheen */}
                    <div className="status-highlight relative overflow-hidden">
                      <div className="code-shimmer opacity-40" />
                      <div className="flex items-center justify-between relative">
                        <div>
                          <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-2)] mb-1 flex items-center gap-1.5">
                            ARCHITECTURE STATUS
                            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-[pulse_1.6s_ease-in-out_infinite]" />
                          </div>
                          <div className="font-[var(--font-sans)] text-[1.1rem] font-medium text-[var(--bb-orange)]">
                            AUDIT-READY
                          </div>
                        </div>
                        <span className="w-2.5 h-2.5 bg-[var(--bb-orange)] rounded-full animate-[pulse_2s_ease-in-out_infinite] shadow-[0_0_10px_rgba(255,105,0,0.6)]" aria-hidden="true" />
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        <div title="Design target — measured p95 in local verification">
                          <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
                            LATENCY <span className="text-[0.5rem] normal-case tracking-normal text-[var(--bb-grey-4)]">target p95</span>
                          </div>
                          <div className="font-[var(--font-sans)] text-[0.95rem] text-[var(--bb-white)]">
                            &lt; 200ms
                          </div>
                        </div>
                        <div title="Every money action creates a ledger event">
                          <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
                            AUDIT
                          </div>
                          <div className="font-[var(--font-sans)] text-[0.95rem] text-[var(--bb-white)]">
                            100%
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
