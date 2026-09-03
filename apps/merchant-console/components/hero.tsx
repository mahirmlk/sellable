"use client";

import { Eyebrow } from "./ui/eyebrow";
import { Blueprint } from "./blueprint";
import { Parallax } from "./ui/parallax";
import { TraceTicker } from "./trace-ticker";

export function Hero() {
  return (
    <section className="technical-section overflow-hidden">
      {/* video-type ambient wash behind hero — drift + grid */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 hero-video-grad opacity-[0.55]" />
        <div className="absolute inset-0 hero-video-grid" />
        {/* soft vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--bb-black)]/40" />
      </div>

      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.03fr)_minmax(0,0.97fr)] items-center gap-[clamp(32px,5vw,96px)] py-[clamp(64px,9vw,132px)]">
          {/* Left: Content */}
          <div className="relative">
            <Parallax speed={0.06}>
              <div className="animate-slide-up">
                <Eyebrow label="AGENTIC COMMERCE INFRASTRUCTURE" />
              </div>
            </Parallax>

            <h1 className="hero-title mt-8 text-[var(--bb-white)] animate-slide-up animate-delay-1">
              The commerce layer for AI buyers
            </h1>

            <p className="body-copy mt-8 animate-slide-up animate-delay-2">
              SELLABLE makes your store discoverable, negotiable, and safely
              transactable by autonomous AI agents — with deterministic policy
              enforcement and full audit trails on every money action.
            </p>

            <div className="flex flex-wrap items-center gap-4 mt-10 animate-slide-up animate-delay-3">
              <a href="/signup" className="btn-light">
                GET STARTED
              </a>
              <a href="#how-it-works" className="btn-outline">
                HOW IT WORKS
              </a>
            </div>

            {/* live ledger trace ticker — real event schema, looping */}
            <div className="mt-8 max-w-[440px] border-l-2 border-[var(--bb-orange)]/50 bg-[var(--bb-panel)]/70 px-4 py-2.5 animate-slide-up animate-delay-3">
              <TraceTicker />
            </div>

            {/* live micro-stats row under CTA — terminal chips */}
            <div className="mt-8 flex items-center gap-2.5 animate-slide-up animate-delay-4">
              <span className="inline-flex items-center gap-2 border border-[var(--bb-line)] bg-[var(--bb-panel)] px-3 py-1.5">
                <span className="w-[5px] h-[5px] bg-[var(--bb-orange)] animate-[pulse_1.4s_ease-in-out_infinite]" />
                <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)]">Policy engine</span>
                <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.04em] text-[var(--bb-orange)]">deterministic</span>
              </span>
              <span className="hidden sm:inline-flex items-center gap-2 border border-[var(--bb-line)] bg-[var(--bb-panel)] px-3 py-1.5">
                <span className="w-[5px] h-[5px] bg-emerald-400 animate-[pulse_1.8s_ease-in-out_infinite]" />
                <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)]">Ledger</span>
                <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.04em] text-emerald-400">recording</span>
              </span>
              <span className="hidden lg:inline-flex items-center gap-2 border border-[var(--bb-line)] bg-[var(--bb-panel)] px-3 py-1.5">
                <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)]">Rails</span>
                <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.04em] text-[var(--bb-grey-1)]">razorpay · test</span>
              </span>
            </div>
          </div>

          {/* Right: Blueprint with video wrap and parallax */}
          <Parallax speed={-0.08} className="animate-slide-up animate-delay-4">
            <div className="relative">
              {/* soft video glow behind blueprint */}
              <div aria-hidden="true" className="pointer-events-none absolute -inset-6 -z-10 blur-[28px] opacity-30">
                <div className="absolute inset-0 bg-gradient-to-br from-[var(--bb-orange)]/22 via-transparent to-transparent rounded-[24px]" />
                <div className="absolute inset-0 bg-gradient-to-tl from-white/[0.04] to-transparent rounded-[24px]" />
              </div>
              <Blueprint />
            </div>
          </Parallax>
        </div>
      </div>
    </section>
  );
}
