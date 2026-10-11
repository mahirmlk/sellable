"use client";

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { Eyebrow } from "./ui/eyebrow";
import { Reveal } from "./ui/reveal";
import { useInView } from "@/lib/use-in-view";

// Public discovery call. No keys, no sample query, no invented
// response. Agents run this exact shape to find the store.
interface Token {
  text: string;
  color: string;
}

const GREEN = "text-[#7EE787]";
const WHITE = "text-[var(--bb-white)]";
const GREY1 = "text-[var(--bb-grey-1)]";
const GREY3 = "text-[var(--bb-grey-3)]";
const ORANGE = "text-[var(--bb-orange)] font-semibold";

const TOKENS: Token[] = [
  { text: "curl", color: ORANGE },
  { text: " ", color: GREY1 },
  { text: "https://api.sellable.shop/.well-known/agents.json", color: WHITE },
];

const TOTAL = TOKENS.reduce((n, t) => n + t.text.length, 0);

const OFFSETS: number[] = [];
TOKENS.reduce((acc, t) => {
  OFFSETS.push(acc);
  return acc + t.text.length;
}, 0);

const codeText = `curl https://api.sellable.shop/.well-known/agents.json`;

const features = [
  "Public manifest at /.well-known/agents.json",
  "Machine catalog at /catalog.ai.json",
  "Behavior notes at /llms.txt",
  "Settlement only through verified webhooks",
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
          <Reveal>
            <div>
              <Eyebrow label="For developers" />
              <h2 className="section-title mt-6 text-[var(--bb-white)]">
                One public file makes you findable
              </h2>
              <p className="body-copy mt-6">
                Shopping agents start here. Your manifest states who you are
                and what you support. Everything behind it stays gated until
                identity, policy, and consent clear.
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

          <Reveal delay={140}>
            <div ref={ref}>
              <div className="rounded-xl overflow-hidden border border-white/10 bg-[#0b0b0b] shadow-[0_32px_90px_-24px_rgba(0,0,0,0.85)]">
                <div className="h-[52px] bg-[#161616] border-b border-white/[0.07] flex items-center px-4 relative">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#FF5F57]" />
                    <span className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
                    <span className="w-3 h-3 rounded-full bg-[#28C840]" />
                  </div>
                  <div className="absolute left-1/2 -translate-x-1/2 font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-grey-2)]">
                    zsh — discovery
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="hidden sm:inline-flex font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] px-2 py-0.5 border border-[var(--bb-line)] text-[var(--bb-grey-3)]">
                      PUBLIC
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

                <div className="px-5 py-5 font-[var(--font-mono)] text-[0.8rem] leading-[1.8] whitespace-pre-wrap break-all min-h-[180px]">
                  <span className="text-[var(--bb-grey-4)] select-none">$ </span>
                  {parts}
                  <span className="inline-block w-[8px] h-[15px] bg-[var(--bb-white)] ml-0.5 translate-y-[3px] animate-[blink_1s_steps(1)_infinite]" aria-hidden="true" />
                  {done && (
                    <div className="response-in mt-4 whitespace-pre-wrap">
                      <span className={GREEN}>200 OK</span>
                      <span className={GREY3}> · application/json</span>
                      <span className={GREY1}>{"\npublic manifest · no key required"}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 font-[var(--font-mono)] text-[0.52rem] tracking-[0.04em] text-[var(--bb-grey-4)]">
                RUN IT NOW: this endpoint is public and returns your live manifest.
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
