"use client";

import { CornerBrackets } from "./ui/corner-brackets";

export function Blueprint() {
  return (
    <div className="blueprint rounded-[var(--radius-md)] group" aria-hidden="true">
      <CornerBrackets />

      {/* Video-type drifting gradient behind blueprint */}
      <div className="absolute inset-0 overflow-hidden rounded-[var(--radius-md)] pointer-events-none">
        <div className="hero-video-grad opacity-60" />
        <div className="hero-video-grid opacity-[0.12]" />
      </div>
      {/* Scan line effect — two staggered */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--bb-orange)] to-transparent opacity-20 animate-[scan-line_4s_linear_infinite]" />
        <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--bb-orange)]/70 to-transparent opacity-10 animate-[scan-line_4s_linear_infinite]" style={{ animationDelay: "1.9s" }} />
      </div>
      {/* Corner live dot pulse */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5 pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--bb-orange)] shadow-[0_0_8px_rgba(255,105,0,0.8)] animate-[pulse_1.6s_ease-in-out_infinite]" />
        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] text-[var(--bb-orange)]">LIVE</span>
      </div>

      {/* Isolation boundary */}
      <div className="absolute inset-[40px] isolation-boundary rounded-[2px]">
        {/* Inner content area */}
        <div className="absolute inset-[24px]">
          {/* Top label */}
          <div className="absolute top-0 left-0 font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
            AGENT GATEWAY
          </div>

          {/* Merchant node */}
          <div className="absolute top-[40px] left-[20px] flex items-center gap-2">
            <span className="w-2 h-2 bg-[var(--bb-orange)] animate-[pulse_3s_ease-in-out_infinite]" />
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
            {/* Orange highlight line */}
            <line
              x1="80"
              y1="180"
              x2="320"
              y2="180"
              stroke="var(--bb-orange)"
              strokeWidth="1"
              opacity="0.6"
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

            {/* Nodes with pulse animation */}
            <rect x="88" y="92" width="8" height="8" fill="var(--bb-orange)">
              <animate attributeName="opacity" values="1;0.5;1" dur="3s" repeatCount="indefinite" />
            </rect>
            <rect x="188" y="92" width="8" height="8" fill="var(--bb-grey-3)">
              <animate attributeName="opacity" values="1;0.6;1" dur="4s" repeatCount="indefinite" />
            </rect>
            <rect x="288" y="92" width="8" height="8" fill="var(--bb-grey-3)">
              <animate attributeName="opacity" values="1;0.6;1" dur="4.5s" repeatCount="indefinite" />
            </rect>
            <rect x="188" y="172" width="8" height="8" fill="var(--bb-orange)">
              <animate attributeName="opacity" values="1;0.5;1" dur="2.5s" repeatCount="indefinite" />
            </rect>
            <rect x="88" y="252" width="8" height="8" fill="var(--bb-grey-3)">
              <animate attributeName="opacity" values="1;0.6;1" dur="3.5s" repeatCount="indefinite" />
            </rect>
            <rect x="288" y="252" width="8" height="8" fill="var(--bb-grey-3)">
              <animate attributeName="opacity" values="1;0.6;1" dur="5s" repeatCount="indefinite" />
            </rect>

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

            {/* Animated data flow dots — 4 staggered video-like trails */}
            <circle r="2.2" fill="var(--bb-orange)" opacity="0.9">
              <animateMotion dur="2.4s" repeatCount="indefinite" path="M88,100 L188,180" />
            </circle>
            <circle r="1.6" fill="#ffb86a" opacity="0.7">
              <animateMotion dur="2.4s" repeatCount="indefinite" path="M88,100 L188,180" begin="0.45s" />
            </circle>
            <circle r="2.2" fill="var(--bb-orange)" opacity="0.9">
              <animateMotion dur="2.8s" repeatCount="indefinite" path="M296,100 L196,172" begin="0.7s" />
            </circle>
            <circle r="1.6" fill="#ffb86a" opacity="0.7">
              <animateMotion dur="2.8s" repeatCount="indefinite" path="M296,100 L196,172" begin="1.35s" />
            </circle>
            {/* vertical consent pulse */}
            <circle r="1.8" fill="var(--bb-orange)" opacity="0.8">
              <animateMotion dur="3.2s" repeatCount="indefinite" path="M200,65 L200,172" begin="0.2s" />
            </circle>
            <circle r="1.4" fill="var(--bb-orange)" opacity="0.45">
              <animateMotion dur="3.2s" repeatCount="indefinite" path="M200,172 L200,258" begin="1.1s" />
            </circle>
          </svg>

          {/* Labels */}
          <div className="absolute top-[80px] left-[120px] font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)]">
            CATALOG
          </div>
          <div className="absolute top-[80px] right-[80px] font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)]">
            POLICY
          </div>
          <div className="absolute top-[160px] left-[50%] -translate-x-1/2 font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-orange)]">
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
            <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-orange)] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-[var(--bb-orange)] rounded-full animate-[pulse_2s_ease-in-out_infinite]" />
              LIVE
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
