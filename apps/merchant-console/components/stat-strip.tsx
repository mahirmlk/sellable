"use client";

import { useEffect, useState } from "react";
import { ScrollReveal } from "./ui/scroll-reveal";
import { AnimatedCounter } from "./ui/animated-counter";
import { searchCatalog, getAgentManifest, getHealthPublic } from "@/lib/api";

interface Stat {
  label: string;
  hint: string;
  highlight: boolean;
  prefix: string;
  suffix: string;
  numeric: number | null;
  text: string | null;
}

// Every value here is derived from live backend data (catalog count, agent
// manifest capabilities, health). No fabricated metrics.
export function StatStrip() {
  const [stats, setStats] = useState<Stat[]>([
    { label: "CATALOG PRODUCTS", hint: "Live catalog count", highlight: false, prefix: "", suffix: "", numeric: null, text: "—" },
    { label: "AGENT CAPABILITIES", hint: "Manifest capabilities", highlight: false, prefix: "", suffix: "", numeric: null, text: "—" },
    { label: "POLICY ENGINE", hint: "Deterministic money boundary", highlight: true, prefix: "", suffix: "", numeric: null, text: "DETERMINISTIC" },
    { label: "PAYMENT RAIL", hint: "Razorpay test mode", highlight: false, prefix: "", suffix: "", numeric: null, text: "—" },
  ]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      Promise.allSettled([searchCatalog(""), getAgentManifest(), getHealthPublic()]).then(
        ([catalog, manifest, health]) => {
          const catalogCount = catalog.status === "fulfilled" ? catalog.value.length : null;
          const capabilities =
            manifest.status === "fulfilled" && Array.isArray(manifest.value.capabilities)
              ? manifest.value.capabilities.length
              : null;
          const razorpayConfigured = health.status === "fulfilled" ? health.value.razorpay_configured : null;
          setStats([
            { label: "CATALOG PRODUCTS", hint: "Live catalog count", highlight: false, prefix: "", suffix: "", numeric: catalogCount, text: catalogCount != null ? null : "—" },
            { label: "AGENT CAPABILITIES", hint: "Manifest capabilities", highlight: false, prefix: "", suffix: "", numeric: capabilities, text: capabilities != null ? null : "—" },
            { label: "POLICY ENGINE", hint: "Deterministic money boundary", highlight: true, prefix: "", suffix: "", numeric: null, text: "DETERMINISTIC" },
            { label: "PAYMENT RAIL", hint: "Razorpay test mode", highlight: false, prefix: "", suffix: "", numeric: null, text: razorpayConfigured == null ? "—" : razorpayConfigured ? "RAZORPAY TEST" : "UNCONFIGURED" },
          ]);
          setLoaded(true);
        }
      );
    }, 0);
    return () => window.clearTimeout(t);
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
                aria-label={`${stat.label}: ${stat.numeric != null ? stat.numeric : stat.text} — ${stat.hint}`}
              >
                <div
                  className={`stat-value transition-colors duration-200 ${stat.highlight ? "text-[var(--bb-orange)]" : "text-[var(--bb-white)]"} ${!loaded ? "opacity-0" : "opacity-100"}`}
                >
                  {stat.numeric != null ? (
                    <>
                      {stat.prefix}
                      <AnimatedCounter target={stat.numeric} duration={1000} />
                      {stat.suffix}
                    </>
                  ) : (
                    <span className="text-[clamp(1.3rem,2vw,1.9rem)]">{stat.text}</span>
                  )}
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