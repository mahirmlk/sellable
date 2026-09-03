"use client";

import type { CSSProperties } from "react";
import { CornerBrackets } from "./ui/corner-brackets";

// Static card — all motion lives INSIDE the box: packets travel the wires,
// nodes breathe, the consent line pulses. Translate + opacity only.
function Packet({
  cx,
  cy,
  dx,
  dy,
  duration,
  delay,
  r = 2.5,
}: {
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  duration: number;
  delay: number;
  r?: number;
}) {
  const style = {
    "--pdx": `${dx}px`,
    "--pdy": `${dy}px`,
    animationDuration: `${duration}s`,
    animationDelay: `${delay}s`,
  } as CSSProperties;
  return (
    <circle cx={cx} cy={cy} r={r} fill="var(--bb-orange)" className="packet" style={style} />
  );
}

// Static architecture diagram — no SMIL, no scan lines, no pulses.
// Pure SVG + borders so it costs zero compositing after first paint.
export function Blueprint() {
  return (
    <div className="blueprint rounded-[var(--radius-md)]" aria-hidden="true">
      <CornerBrackets />

      {/* Corner status */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5 pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--bb-orange)] live-dot" />
        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] text-[var(--bb-grey-1)]">LIVE</span>
      </div>

      {/* Isolation boundary */}
      <div className="absolute inset-[40px] rounded-[2px] border border-dashed border-[var(--bb-grey-3)]">
        {/* Inner content area */}
        <div className="absolute inset-[24px]">
          {/* Top label */}
          <div className="absolute top-0 left-0 font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
            AGENT GATEWAY
          </div>

          {/* Merchant node */}
          <div className="absolute top-[40px] left-[20px] flex items-center gap-2">
            <span className="w-2 h-2 bg-[var(--bb-white)]" />
            <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">
              MERCHANT
            </span>
          </div>

          {/* Connecting lines */}
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 400 400"
            fill="none"
          >
            {/* Horizontal main line */}
            <line
              x1="40"
              y1="100"
              x2="360"
              y2="100"
              stroke="var(--bb-grey-4)"
              strokeWidth="1"
            />
            {/* Vertical connector */}
            <line
              x1="200"
              y1="60"
              x2="200"
              y2="340"
              stroke="var(--bb-grey-4)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            {/* Highlight line */}
            <line
              x1="80"
              y1="180"
              x2="320"
              y2="180"
              stroke="var(--bb-orange)"
              strokeWidth="1"
              className="line-pulse"
            />
            {/* Secondary lines */}
            <line
              x1="60"
              y1="260"
              x2="340"
              y2="260"
              stroke="var(--bb-grey-4)"
              strokeWidth="1"
            />
            <line
              x1="100"
              y1="140"
              x2="100"
              y2="300"
              stroke="var(--bb-grey-4)"
              strokeWidth="1"
              strokeDasharray="2 4"
            />
            <line
              x1="300"
              y1="140"
              x2="300"
              y2="300"
              stroke="var(--bb-grey-4)"
              strokeWidth="1"
              strokeDasharray="2 4"
            />

            {/* Nodes */}
            <rect x="88" y="92" width="8" height="8" fill="var(--bb-white)" />
            <rect x="188" y="92" width="8" height="8" fill="var(--bb-grey-3)" />
            <rect x="288" y="92" width="8" height="8" fill="var(--bb-grey-3)" />
            <rect x="188" y="172" width="8" height="8" fill="var(--bb-white)" />
            <rect x="88" y="252" width="8" height="8" fill="var(--bb-grey-3)" />
            <rect x="288" y="252" width="8" height="8" fill="var(--bb-grey-3)" />

            {/* Dashed sub-connectors */}
            <line
              x1="96"
              y1="100"
              x2="188"
              y2="180"
              stroke="var(--bb-grey-4)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <line
              x1="296"
              y1="100"
              x2="196"
              y2="172"
              stroke="var(--bb-grey-4)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />

            {/* In-box packets travelling the wires */}
            <Packet cx={48} cy={100} dx={296} dy={0} duration={2.6} delay={0} />
            <Packet cx={100} cy={104} dx={84} dy={72} duration={2.2} delay={0.4} r={2} />
            <Packet cx={292} cy={104} dx={-92} dy={64} duration={2.8} delay={1.1} r={2} />
            <Packet cx={200} cy={70} dx={0} dy={98} duration={3.1} delay={0.7} r={2} />
          </svg>

          {/* Labels */}
          <div className="absolute top-[80px] left-[120px] font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)]">
            CATALOG
          </div>
          <div className="absolute top-[80px] right-[80px] font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)]">
            POLICY
          </div>
          <div className="absolute top-[160px] left-[50%] -translate-x-1/2 font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-1)]">
            CONSENT
          </div>
          <div className="absolute top-[240px] left-[120px] font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)]">
            ORDER
          </div>
          <div className="absolute top-[240px] right-[80px] font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)]">
            PAYMENT
          </div>

          {/* Bottom status */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between">
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)]">
              STATUS: ACTIVE
            </span>
            <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-1)] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-[var(--bb-white)] rounded-full" />
              LIVE
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
