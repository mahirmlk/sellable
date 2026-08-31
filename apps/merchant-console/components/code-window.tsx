"use client";

import { useState } from "react";
import { Copy, Check, Terminal } from "lucide-react";
import { Eyebrow } from "./ui/eyebrow";

const codeLines = [
  { text: "curl", color: "text-[var(--bb-orange)]" },
  { text: " -X POST ", color: "text-[var(--bb-grey-1)]" },
  { text: "https://api.sellable.dev/agent/catalog.search", color: "text-[var(--bb-white)]" },
  { text: " \\", color: "text-[var(--bb-grey-3)]" },
  { text: "  -H ", color: "text-[var(--bb-grey-1)]" },
  { text: '"Authorization: Bearer sk_live_..."', color: "text-green-400" },
  { text: " \\", color: "text-[var(--bb-grey-3)]" },
  { text: "  -H ", color: "text-[var(--bb-grey-1)]" },
  { text: '"Content-Type: application/json"', color: "text-green-400" },
  { text: " \\", color: "text-[var(--bb-grey-3)]" },
  { text: "  -d ", color: "text-[var(--bb-grey-1)]" },
  { text: "'{", color: "text-[var(--bb-white)]" },
  { text: '    "query": ', color: "text-[var(--bb-white)]" },
  { text: '"wireless headphones"', color: "text-green-400" },
  { text: ",", color: "text-[var(--bb-white)]" },
  { text: '    "categories": ', color: "text-[var(--bb-white)]" },
  { text: '["accessories"]', color: "text-yellow-400" },
  { text: "  }'", color: "text-[var(--bb-white)]" },
];

const features = [
  "Machine-readable catalog at /catalog.ai.json",
  "Agent-to-agent negotiation within policy bounds",
  "Single-use consent tokens for every payment",
  "Append-only audit ledger with reasoning traces",
];

export function CodeSection() {
  const [copied, setCopied] = useState(false);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);

  const codeText = `curl -X POST https://api.sellable.dev/agent/catalog.search \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "wireless headphones",
    "categories": ["accessories"]
  }'`;

  const handleCopy = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)] overflow-hidden relative">
      {/* video-type ambient */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-[0.45]" style={{ background: "radial-gradient(520px 360px at 18% 18%, rgba(255,105,0,0.055), transparent 66%)" }} />
      </div>
      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-[clamp(48px,6vw,96px)] items-center">
          {/* Left: Content */}
          <div>
            <Eyebrow label="DEVELOPER API" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              Three lines to make your store agent-accessible
            </h2>
            <p className="body-copy mt-6">
              A single search endpoint gives AI buyers access to your full
              product catalog with real-time pricing, stock, and negotiation
              policy.
            </p>

            <div className="mt-10 space-y-1">
              {features.map((f) => (
                <div
                  key={f}
                  className="feature-line py-2 px-3 rounded-sm transition-all duration-200 hover:bg-[var(--bb-panel)] hover:translate-x-1"
                >
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Code window — video-type live terminal */}
          <div className="code-window group relative overflow-hidden">
            <div aria-hidden="true" className="code-shimmer" />
            {/* Header */}
            <div className="h-[58px] border-b border-[#1f1f1e] flex items-center justify-between px-5 relative">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#ff5f57] transition-colors group-hover:bg-[#ff4040] shadow-[0_0_0_1px_rgba(255,255,255,0.06)]" />
                  <span className="w-3 h-3 rounded-full bg-[#febc2e] transition-colors group-hover:bg-[#ffb800] shadow-[0_0_0_1px_rgba(255,255,255,0.06)]" />
                  <span className="w-3 h-3 rounded-full bg-[#28c840] transition-colors group-hover:bg-[#22b838] shadow-[0_0_0_1px_rgba(255,255,255,0.06)]" />
                </div>
                <div className="flex items-center gap-1.5 text-[var(--bb-grey-3)]">
                  <Terminal size={12} />
                  <span className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase">
                    curl
                  </span>
                  <span className="ml-2 hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-[pulse_1.4s_ease-in-out_infinite]" />
                    <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] text-[var(--bb-grey-1)]">LIVE</span>
                  </span>
                </div>
              </div>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-orange)] transition-colors cursor-pointer bg-transparent border-0 px-2 py-1 rounded hover:bg-[var(--bb-panel)]"
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

            {/* Code with syntax highlighting + live cursor */}
            <div className="code-content relative">
              {codeLines.map((line, i) => (
                <span
                  key={i}
                  className={`inline transition-colors duration-150 ${
                    hoveredLine === i ? "bg-[rgba(255,105,0,0.06)]" : ""
                  }`}
                  onMouseEnter={() => setHoveredLine(i)}
                  onMouseLeave={() => setHoveredLine(null)}
                >
                  <span className={line.color}>{line.text}</span>
                </span>
              ))}
              <span className="inline-block w-[7px] h-[14px] bg-[var(--bb-orange)] ml-0.5 translate-y-[2px] animate-[blink_1s_steps(1)_infinite]" aria-hidden="true" />
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
