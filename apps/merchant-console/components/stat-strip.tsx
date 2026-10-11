"use client";

import { useEffect, useState } from "react";
import { ScrollReveal } from "./ui/scroll-reveal";
import { getHealthPublic } from "@/lib/api";

// Design guarantees, stated plainly. No counters, no sampled metrics.
// The only live value is the payment rail probe, which reports what the
// backend actually says.
const GUARANTEES = [
  {
    index: "01",
    title: "Policy decides",
    note: "same cart, same verdict, every time",
  },
  {
    index: "02",
    title: "Consent binds",
    note: "amount, payee, and expiry locked",
  },
  {
    index: "03",
    title: "Ledger explains",
    note: "actor, reason, and rule per step",
  },
];

export function StatStrip() {
  const [railState, setRailState] = useState<"checking" | "live" | "offline">(
    "checking"
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      getHealthPublic()
        .then((h) => setRailState(h?.status === "ok" ? "live" : "offline"))
        .catch(() => setRailState("offline"));
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <ScrollReveal>
      <section
        className="technical-section border-t border-[var(--bb-line)] relative"
        aria-label="Platform guarantees"
      >
        <div className="page-frame relative">
          <div className="grid grid-cols-2 lg:grid-cols-4">
            {GUARANTEES.map((g, i) => (
              <div
                key={g.title}
                className={`px-6 py-8 border-[var(--bb-line)] ${
                  i < GUARANTEES.length ? "border-r" : ""
                } border-b lg:border-b-0`}
              >
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] tabular-nums">
                    {g.index}
                  </span>
                  <span className="w-[5px] h-[5px] bg-[var(--bb-orange)]" />
                </div>
                <div className="font-[var(--font-sans)] text-[1.25rem] leading-tight tracking-[-0.02em] text-[var(--bb-white)]">
                  {g.title}
                </div>
                <div className="mt-2 font-[var(--font-mono)] text-[0.55rem] tracking-[0.02em] text-[var(--bb-grey-4)]">
                  {g.note}
                </div>
              </div>
            ))}
            <div className="px-6 py-8 border-b lg:border-b-0">
              <div className="flex items-baseline gap-2 mb-3">
                <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] tabular-nums">
                  04
                </span>
                <span
                  className={`w-[5px] h-[5px] rounded-full ${
                    railState === "live" ? "bg-[var(--bb-orange)] live-dot" : "bg-[var(--bb-grey-3)]"
                  }`}
                />
              </div>
              <div className="font-[var(--font-sans)] text-[1.25rem] leading-tight tracking-[-0.02em] text-[var(--bb-white)]">
                {railState === "live"
                  ? "Rail live"
                  : railState === "checking"
                    ? "Checking rail"
                    : "Rail in test"}
              </div>
              <div className="mt-2 font-[var(--font-mono)] text-[0.55rem] tracking-[0.02em] text-[var(--bb-grey-4)]">
                razorpay test · signed webhooks
              </div>
            </div>
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
}
