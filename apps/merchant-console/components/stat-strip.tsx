"use client";

import { useEffect, useState } from "react";
import { ScrollReveal } from "./ui/scroll-reveal";
import { AnimatedCounter } from "./ui/animated-counter";
import { getHealthPublic } from "@/lib/api";

interface Fact {
  index: string;
  value?: number | null; // animated when numeric
  display?: string | null; // static display (overrides value)
  prefix?: string;
  suffix?: string;
  label: string;
  note: string;
}

// Facts that are true by design — derived from the actual codebase
// (policy engine rules, seller agent tools, ledger contract, auth stack),
// not from auth-gated API counters.
const FACTS: Fact[] = [
  {
    index: "01",
    value: 14,
    label: "POLICY CHECKS",
    note: "deterministic — grounding → floor → HITL",
  },
  {
    index: "02",
    value: 6,
    label: "AGENT TOOLS",
    note: "search · get · quote · negotiate · upsell · policy",
  },
  {
    index: "03",
    value: 100,
    suffix: "%",
    label: "LEDGER COVERAGE",
    note: "every money action explained",
  },
  {
    index: "04",
    display: null, // filled from live health probe
    value: null,
    label: "PAYMENT RAIL",
    note: "razorpay test · signed webhooks",
  },
];

export function StatStrip() {
  const [railState, setRailState] = useState<"checking" | "live" | "offline">("checking");

  useEffect(() => {
    const t = window.setTimeout(() => {
      getHealthPublic()
        .then((h) => setRailState(h.razorpay_configured ? "live" : "offline"))
        .catch(() => setRailState("offline"));
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <ScrollReveal>
      <section
        className="technical-section border-t border-[var(--bb-line)] relative overflow-hidden"
        aria-label="Platform facts"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 opacity-[0.04]" style={{ background: "linear-gradient(90deg, transparent 8%, rgba(255,105,0,0.14) 46%, transparent 82%)" }} />
        </div>
        <div className="page-frame relative">
          <div className="grid grid-cols-2 lg:grid-cols-4">
            {FACTS.map((fact, i) => (
              <div
                key={fact.label}
                className={`px-6 py-8 border-[var(--bb-line)] ${
                  i < FACTS.length - 1 ? "border-r" : ""
                } ${i < 2 ? "border-b lg:border-b-0" : ""}`}
              >
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] tabular-nums">
                    {fact.index}
                  </span>
                  <span className="w-[5px] h-[5px] bg-[var(--bb-orange)]" />
                </div>
                <div className="font-[var(--font-mono)] text-[1.6rem] leading-none text-[var(--bb-white)] tabular-nums tracking-tight">
                  {fact.display ? (
                    fact.display
                  ) : fact.value != null ? (
                    <>
                      {fact.prefix}
                      <AnimatedCounter target={fact.value} duration={1200} />
                      {fact.suffix}
                    </>
                  ) : railState === "live" ? (
                    <span className="text-emerald-400">LIVE</span>
                  ) : railState === "checking" ? (
                    <span className="text-[var(--bb-grey-3)]">···</span>
                  ) : (
                    <span className="text-[var(--bb-grey-3)]">TEST</span>
                  )}
                </div>
                <div className="mt-4 font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                  {fact.label}
                </div>
                <div className="mt-1 font-[var(--font-mono)] text-[0.55rem] tracking-[0.02em] text-[var(--bb-grey-4)]">
                  {fact.note}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
}
