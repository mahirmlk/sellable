"use client";

import Link from "next/link";
import { Reveal } from "./ui/reveal";

export function OrangeCTA() {
  return (
    <section className="orange-cta relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,0,0,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.35) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(70% 80% at 50% 40%, black 40%, transparent 100%)",
        }}
      />
      <div className="page-frame relative">
        <Reveal>
          <h2>Give your store an AI sales floor.</h2>
          <p className="mt-6 font-[var(--font-sans)] text-[1.15rem] leading-relaxed text-[#080808] opacity-80 max-w-[620px]">
            Put your catalog where agents already shop. You keep the pricing,
            the approvals, and the final word. The agents do the talking.
          </p>
          <div className="flex flex-wrap items-center gap-4 mt-10">
            <Link href="/dashboard" className="btn-orange-primary">
              Open the console
            </Link>
            <Link href="/demo" className="btn-orange-secondary">
              Explore the demo
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-3 font-[var(--font-mono)] text-[0.62rem] tracking-[0.08em] uppercase text-black/55">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-[5px] h-[5px] bg-black/70" /> Consent-gated
            </span>
            <span className="w-px h-3 bg-black/15" />
            <span className="inline-flex items-center gap-1.5">
              <span className="w-[5px] h-[5px] bg-black/70" /> Policy-bounded
            </span>
            <span className="w-px h-3 bg-black/15" />
            <span className="inline-flex items-center gap-1.5">
              <span className="w-[5px] h-[5px] bg-black/70" /> Ledger-audited
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
