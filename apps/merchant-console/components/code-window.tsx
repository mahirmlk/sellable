"use client";

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { Eyebrow } from "./ui/eyebrow";
import { Reveal } from "./ui/reveal";
import { useInView } from "@/lib/use-in-view";

// macOS-style terminal: traffic lights, dark body, restrained syntax color
// (white + grey + green strings + orange command). The command types itself
// once on view through a viewport-gated interval (~1s total), then a static
// response line fades in. No glow, no shimmer, no hover handlers per token.

interface Token {
  text: string;
  color: string;
}

const GREEN = "text-[#7EE787]";
const WHITE = "text-[var(--bb-white)]";
const GREY1 = "text-[var(--bb-grey-1)]";
const GREY3 = "text-[var(--bb-grey-3)]";
const GREY4 = "text-[var(--bb-grey-4)]";
const ORANGE = "text-[var(--bb-orange)] font-semibold";

const TOKENS: Token[] = [
  { text: "curl", color: ORANGE },
  { text: " -X POST ", color: GREY1 },
  { text: "https://api.sellable.shop/agent/catalog.search", color: WHITE },
  { text: " \\\n", color: GREY4 },
  { text: "  -H ", color: GREY1 },
  { text: '"X-Agent-Key: <your agent key>"', color: GREEN },
  { text: " \\\n", color: GREY4 },
  { text: "  -H ", color: GREY1 },
  { text: '"Content-Type: application/json"', color: GREEN },
  { text: " \\\n", color: GREY4 },
  { text: "  -d ", color: GREY1 },
  { text: "'", color: GREY3 },
  { text: "{", color: WHITE },
  { text: "\n    ", color: WHITE },
  { text: '"query"', color: WHITE },
  { text: ": ", color: GREY3 },
  { text: '"wireless headphones"', color: GREEN },
  { text: ",", color: GREY3 },
  { text: "\n    ", color: WHITE },
  { text: '"categories"', color: WHITE },
  { text: ": ", color: GREY3 },
  { text: "[", color: WHITE },
  { text: '"accessories"', color: GREEN },
  { text: "]", color: WHITE },
  { text: "\n  ", color: WHITE },
  { text: "}", color: WHITE },
  { text: "'", color: GREY3 },
];

const TOTAL = TOKENS.reduce((n, t) => n + t.text.length, 0);

// Start offset of each token — precomputed so rendering slices without
// any per-render mutation.
const OFFSETS: number[] = [];
TOKENS.reduce((acc, t) => {
  OFFSETS.push(acc);
  return acc + t.text.length;
}, 0);

const codeText = `curl -X POST https://api.sellable.shop/agent/catalog.search \\
  -H "X-Agent-Key: <your agent key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "wireless headphones",
    "categories": ["accessories"]
  }'`;

const features = [
  "Machine-readable catalog at /catalog.ai.json",
  "Agent-to-agent negotiation within policy bounds",
  "Single-use consent tokens for every payment",
  "Append-only audit ledger with reasoning traces",
];

export function CodeSection() {
  const { ref, isInView } = useInView();
  const [copied, setCopied] = useState(false);
  const [budget, setBudget] = useState(0);
  const done = budget >= TOTAL;

  useEffect(() => {
    if (!isInView || done) return;
    const t = window.setInterval(() => {
      setBudget((b) => Math.min(b + 3, TOTAL));
    }, 14);
    return () => window.clearInterval(t);
  }, [isInView, done]);

  const handleCopy = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const parts = TOKENS.map((tok, i) => {
    const start = OFFSETS[i];
    if (start >= budget) return null;
    return (
      <span key={i} className={tok.color}>
        {tok.text.slice(0, Math.min(tok.text.length, budget - start))}
      </span>
    );
  });

  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-[clamp(48px,6vw,96px)] items-center">
          {/* Left: Content */}
          <Reveal>
            <div>
              <Eyebrow label="10 — DEVELOPER API" />
              <h2 className="section-title mt-6 text-[var(--bb-white)]">
                One call makes your store agent-readable
              </h2>
              <p className="body-copy mt-6">
                A single search call gives AI buyers your full catalog — with
                real-time pricing, stock, and negotiation policy. Signed API
                keys keep every request authenticated.
              </p>

              <div className="mt-10 space-y-1">
                {features.map((f) => (
                  <div
                    key={f}
                    className="feature-line py-2 px-3 rounded-sm transition-colors duration-200 hover:bg-[var(--bb-panel)]"
                  >
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Right: macOS terminal */}
          <Reveal delay={140}>
            <div ref={ref}>
              <div className="rounded-xl overflow-hidden border border-white/10 bg-[#0b0b0b] shadow-[0_32px_90px_-24px_rgba(0,0,0,0.85)]">
                {/* Title bar */}
                <div className="h-[52px] bg-[#161616] border-b border-white/[0.07] flex items-center px-4 relative">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#FF5F57]" />
                    <span className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
                    <span className="w-3 h-3 rounded-full bg-[#28C840]" />
                  </div>
                  <div className="absolute left-1/2 -translate-x-1/2 font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-grey-2)]">
                    zsh — catalog.search
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="hidden sm:inline-flex font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] px-2 py-0.5 border border-[var(--bb-line)] text-[var(--bb-grey-3)]">
                      EXAMPLE
                    </span>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors cursor-pointer bg-transparent border-0 px-2 py-1 rounded hover:bg-white/[0.06]"
                    >
                      {copied ? (
                        <>
                          <Check size={12} /> COPIED
                        </>
                      ) : (
                        <>
                          <Copy size={12} /> COPY
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Body */}
                <div className="px-5 py-5 font-[var(--font-mono)] text-[0.8rem] leading-[1.8] whitespace-pre-wrap break-all min-h-[280px]">
                  <span className="text-[var(--bb-grey-4)] select-none">$ </span>
                  {parts}
                  <span className="inline-block w-[8px] h-[15px] bg-[var(--bb-white)] ml-0.5 translate-y-[3px] animate-[blink_1s_steps(1)_infinite]" aria-hidden="true" />
                  {done && (
                    <div className="response-in mt-4 whitespace-pre-wrap">
                      <span className={GREEN}>✓ 200 OK</span>
                      <span className={GREY3}> · application/json · 184 ms</span>
                      <span className={GREY1}>{"\n3 products · prices, floors & stock included"}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 font-[var(--font-mono)] text-[0.52rem] tracking-[0.04em] text-[var(--bb-grey-4)]">
                ILLUSTRATED EXAMPLE — run it with your own key against api.sellable.shop.
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
