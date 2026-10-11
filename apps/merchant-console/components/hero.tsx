"use client";

import { ArrowUpRight } from "lucide-react";
import { Eyebrow } from "./ui/eyebrow";
import { Reveal } from "./ui/reveal";
import { IsoStack } from "./iso-stack";

const GUARANTEES = [
  ["Policy decides", "deterministic checks"],
  ["Consent binds", "single use, expiring"],
  ["Webhooks settle", "no UI can mark paid"],
  ["Ledger explains", "replay any order"],
];

export function Hero() {
  return (
    <section className="hero-premium technical-section overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="drift-grid absolute -inset-[56px] opacity-50"
          style={{
            maskImage:
              "radial-gradient(78% 68% at 50% 36%, black 28%, transparent 100%)",
          }}
        />
      </div>

      <div className="page-frame relative">
        <div className="hero-grid">
          <div className="relative">
            <Reveal>
              <Eyebrow label="Agentic commerce platform for merchants" />
              <h1 className="hero-title mt-7 text-[var(--bb-white)]">
                An AI sales floor
                <br />
                for your store.
              </h1>
              <p className="body-copy mt-7 max-w-[46ch]">
                Sellable staffs your shop with two agents. The Seller
                quotes from your catalog. The Service Agent looks after
                orders. Shopping agents from outside connect as guests,
                and your rules decide which payments go through.
              </p>
            </Reveal>

            <Reveal delay={120}>
              <div className="flex flex-wrap items-center gap-3.5 mt-9">
                <a
                  href="/dashboard"
                  className="group inline-flex items-center gap-2.5 min-h-[54px] px-7 bg-[var(--bb-orange)] text-[var(--bb-black)] font-[var(--font-mono)] text-[0.74rem] tracking-[0.12em] uppercase font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors duration-200"
                >
                  Open the console
                  <ArrowUpRight
                    size={15}
                    className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  />
                </a>
                <a href="#how-it-works" className="btn-outline">
                  See how money moves
                </a>
              </div>
            </Reveal>

            <Reveal delay={200}>
              <dl className="hero-guarantees">
                {GUARANTEES.map(([term, note]) => (
                  <div key={term} className="hero-guarantee">
                    <dt>{term}</dt>
                    <dd>{note}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>

          <Reveal delay={150} y={24}>
            <div className="hero-visual">
              <div className="hero-visual-head">
                <span className="hero-live">
                  <span className="w-[6px] h-[6px] rounded-full bg-[var(--bb-orange)] live-dot" />
                  Commerce stack
                </span>
                <span className="hero-head-note">five planes, one order path</span>
              </div>
              <IsoStack />
              <div className="hero-visual-foot">
                <span>External agents enter through the gateway</span>
                <span className="hero-foot-sep" />
                <span>Your catalog stays the source of truth</span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
