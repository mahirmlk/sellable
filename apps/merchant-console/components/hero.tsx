"use client";

import { Eyebrow } from "./ui/eyebrow";
import { Reveal } from "./ui/reveal";
import { Blueprint } from "./blueprint";
import { TraceTicker } from "./trace-ticker";

export function Hero() {
  return (
    <section className="technical-section overflow-hidden">
      {/* faint drifting grid — one seamless transform loop, masked */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="drift-grid absolute -inset-[56px] opacity-60"
          style={{
            maskImage: "radial-gradient(75% 65% at 50% 40%, black 30%, transparent 100%)",
          }}
        />
      </div>

      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.03fr)_minmax(0,0.97fr)] items-center gap-[clamp(32px,5vw,96px)] py-[clamp(64px,9vw,132px)]">
          {/* Left: Content */}
          <div className="relative">
            <Reveal>
              <Eyebrow label="AI SALES CHANNEL FOR MERCHANTS" />
              <h1 className="hero-title mt-8 text-[var(--bb-white)]">
                Make your store sellable to AI.
              </h1>
              <p className="body-copy mt-8">
                SELLABLE gives your business an AI sales agent that can discover
                products, negotiate within your rules, recommend relevant
                add-ons, and help complete purchases safely.
              </p>
            </Reveal>

            <Reveal delay={120}>
              <div className="flex flex-wrap items-center gap-4 mt-10">
                <a href="#how-it-works" className="btn-light">
                  SEE HOW IT WORKS
                </a>
                <a href="/dashboard/chat" className="btn-outline">
                  TRY THE AI SELLER
                </a>
              </div>
            </Reveal>

            {/* ledger trace ticker — monochrome, viewport-gated */}
            <Reveal delay={200}>
              <div className="mt-8 max-w-[440px] border-l-2 border-[var(--bb-orange)] bg-[var(--bb-panel)]/70 px-4 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-[5px] h-[5px] rounded-full bg-[var(--bb-orange)] live-dot" />
                  <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                    Live · ledger trace
                  </span>
                </div>
                <TraceTicker />
              </div>
            </Reveal>

            <Reveal delay={260}>
              <p className="mt-6 font-[var(--font-mono)] text-[0.62rem] tracking-[0.08em] uppercase text-[var(--bb-grey-2)]">
                Real catalog · Real transactions · Razorpay-powered checkout
              </p>
              <p className="mt-2 font-[var(--font-mono)] text-[0.6rem] leading-relaxed tracking-[0.02em] text-[var(--bb-grey-3)]">
                Payments currently run through Razorpay Test Mode — no real money
                is moved.
              </p>

              {/* micro-stats row — static chips, one live dot */}
              <div className="mt-8 flex flex-wrap items-center gap-2.5">
                <span className="inline-flex items-center gap-2 border border-[var(--bb-line)] bg-[var(--bb-panel)] px-3 py-1.5">
                  <span className="w-[5px] h-[5px] bg-[var(--bb-white)]" />
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)]">Policy engine</span>
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.04em] text-[var(--bb-white)]">deterministic</span>
                </span>
                <span className="hidden sm:inline-flex items-center gap-2 border border-[var(--bb-line)] bg-[var(--bb-panel)] px-3 py-1.5">
                  <span className="w-[5px] h-[5px] rounded-full bg-[var(--bb-orange)] live-dot" />
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)]">Ledger</span>
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.04em] text-[var(--bb-orange)]">recording</span>
                </span>
                <span className="hidden lg:inline-flex items-center gap-2 border border-[var(--bb-line)] bg-[var(--bb-panel)] px-3 py-1.5">
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)]">Rails</span>
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.04em] text-[var(--bb-grey-1)]">razorpay · test</span>
                </span>
              </div>
            </Reveal>
          </div>

          {/* Right: architecture diagram — card stays still, motion lives inside it */}
          <Reveal delay={150} y={24}>
            <div className="relative">
              <Blueprint />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
