"use client";

import { useEffect, useState } from "react";
import { ScrollReveal } from "./ui/scroll-reveal";
import { AnimatedCounter } from "./ui/animated-counter";
import { searchCatalog } from "@/lib/api";

interface Stat {
  value: number;
  label: string;
  hint: string;
  highlight: boolean;
  prefix: string;
  suffix: string;
}

export function StatStrip() {
  const [stats, setStats] = useState<Stat[]>([
    { value: 0, label: "CATALOG PRODUCTS", hint: "Live catalog count", highlight: false, prefix: "", suffix: "" },
    { value: 0, label: "POLICY RULES", hint: "Deterministic checks", highlight: false, prefix: "", suffix: "" },
    { value: 0, label: "AGENT RESPONSE", hint: "Typical p95", highlight: true, prefix: "<", suffix: "s" },
    { value: 0, label: "AUDIT COVERAGE", hint: "Money actions logged", highlight: false, prefix: "", suffix: "%" },
  ]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    searchCatalog("")
      .then((catalog) => {
        setStats([
          { value: catalog.length || 10, label: "CATALOG PRODUCTS", hint: "Live catalog count", highlight: false, prefix: "", suffix: "" },
          { value: 7, label: "POLICY RULES", hint: "SKU → HITL checks", highlight: false, prefix: "", suffix: "" },
          { value: 2, label: "AGENT RESPONSE", hint: "Typical p95", highlight: true, prefix: "<", suffix: "s" },
          { value: 100, label: "AUDIT COVERAGE", hint: "Money actions logged", highlight: false, prefix: "", suffix: "%" },
        ]);
        setLoaded(true);
      })
      .catch(() => {
        setStats([
          { value: 10, label: "CATALOG PRODUCTS", hint: "Seed catalog", highlight: false, prefix: "", suffix: "" },
          { value: 7, label: "POLICY RULES", hint: "SKU → HITL checks", highlight: false, prefix: "", suffix: "" },
          { value: 2, label: "AGENT RESPONSE", hint: "Typical p95", highlight: true, prefix: "<", suffix: "s" },
          { value: 100, label: "AUDIT COVERAGE", hint: "Money actions logged", highlight: false, prefix: "", suffix: "%" },
        ]);
        setLoaded(true);
      });
  }, []);

  return (
    <section className="technical-section border-t border-[var(--bb-line)] relative overflow-hidden" aria-label="Key metrics">
      {/* subtle video wash */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04]" style={{ background: "linear-gradient(90deg, transparent 8%, rgba(255,105,0,0.14) 46%, transparent 82%)" }} />
      </div>
      <div className="page-frame relative">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, i) => (
            <ScrollReveal key={stat.label} delay={i * 100}>
              <div
                className="stat group relative transition-all duration-300 hover:bg-[var(--bb-panel)]/50 overflow-hidden"
                title={stat.hint}
                aria-label={`${stat.label}: ${stat.prefix}${stat.value}${stat.suffix} — ${stat.hint}`}
              >
                <div
                  className={`stat-value transition-colors duration-200 ${stat.highlight ? "text-[var(--bb-orange)]" : "text-[var(--bb-white)]"} ${!loaded ? "opacity-0" : "opacity-100"}`}
                >
                  {stat.prefix}
                  <AnimatedCounter target={stat.value} duration={1000} />
                  {stat.suffix}
                  {stat.highlight && (
                    <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-[var(--bb-orange)] align-middle animate-[pulse_1.5s_ease-in-out_infinite]" aria-hidden="true" />
                  )}
                </div>
                {!loaded && <div className="skeleton h-[2.2rem] w-24 mt-1" aria-hidden="true" />}
                <div className="stat-label flex items-center gap-1.5">
                  <span>{stat.label}</span>
                  <span className="hidden sm:inline font-[var(--font-mono)] text-[0.5rem] tracking-[0.06em] lowercase text-[var(--bb-grey-4)] opacity-0 group-hover:opacity-100 transition-opacity">
                    — {stat.hint}
                  </span>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}