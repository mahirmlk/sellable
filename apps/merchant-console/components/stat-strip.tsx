"use client";

import { useEffect, useState } from "react";
import { ScrollReveal } from "./ui/scroll-reveal";
import { AnimatedCounter } from "./ui/animated-counter";
import { searchCatalog } from "@/lib/api";

interface Stat {
  value: number;
  label: string;
  highlight: boolean;
  prefix: string;
  suffix: string;
}

export function StatStrip() {
  const [stats, setStats] = useState<Stat[]>([
    { value: 0, label: "CATALOG PRODUCTS", highlight: false, prefix: "", suffix: "" },
    { value: 0, label: "POLICY RULES", highlight: false, prefix: "", suffix: "" },
    { value: 0, label: "AGENT RESPONSE", highlight: true, prefix: "<", suffix: "s" },
    { value: 0, label: "AUDIT COVERAGE", highlight: false, prefix: "", suffix: "%" },
  ]);

  useEffect(() => {
    searchCatalog("")
      .then((catalog) => {
        setStats([
          { value: catalog.length || 10, label: "CATALOG PRODUCTS", highlight: false, prefix: "", suffix: "" },
          { value: 6, label: "POLICY RULES", highlight: false, prefix: "", suffix: "" },
          { value: 2, label: "AGENT RESPONSE", highlight: true, prefix: "<", suffix: "s" },
          { value: 100, label: "AUDIT COVERAGE", highlight: false, prefix: "", suffix: "%" },
        ]);
      })
      .catch(() => {});
  }, []);

  return (
    <section className="technical-section border-t border-[var(--bb-line)]">
      <div className="page-frame">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, i) => (
            <ScrollReveal key={stat.label} delay={i * 100}>
              <div className="stat">
                <div className={`stat-value ${stat.highlight ? "text-[var(--bb-orange)]" : "text-[var(--bb-white)]"}`}>
                  {stat.prefix}
                  <AnimatedCounter target={stat.value} duration={1000} />
                  {stat.suffix}
                </div>
                <div className="stat-label">{stat.label}</div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
