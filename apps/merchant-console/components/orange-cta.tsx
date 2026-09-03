"use client";

import { Reveal } from "./ui/reveal";

export function OrangeCTA() {
  return (
    <section className="orange-cta relative">
      <div className="page-frame relative">
        <Reveal>
        <div className="inline-flex items-center gap-2 border border-black/10 bg-black/[0.06] px-3 py-1.5">
          <span className="w-[5px] h-[5px] bg-black" />
          <span className="font-[var(--font-mono)] text-[0.62rem] tracking-[0.14em] uppercase text-black/70">Live on Razorpay test mode</span>
          <span className="font-[var(--font-mono)] text-[0.58rem] text-black/45">— webhooks verified</span>
        </div>
        <h2 className="mt-6">
          Ready to make your store sellable to AI?
        </h2>
        <p className="mt-6 font-[var(--font-sans)] text-[1.2rem] leading-relaxed text-[#080808] opacity-80 max-w-[600px]">
          Connect your products, define your selling rules, and let your AI
          seller handle the conversation.
        </p>
        <div className="flex flex-wrap items-center gap-4 mt-10">
          <a href="/signup" className="btn-orange-primary">
            START SELLING WITH AI
          </a>
          <a href="/case-study" className="btn-orange-secondary">
            EXPLORE AI COMMERCE
          </a>
        </div>
        {/* trust row — static */}
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
