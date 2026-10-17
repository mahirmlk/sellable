"use client";

import type { CSSProperties, ReactNode } from "react";

/*
  Two narrative diagrams, drawn as fixed SVG in the same isometric
  language as the hero stack. A single viewBox scales the whole drawing
  at every breakpoint, and motion stays on tiny nodes (translate +
  opacity only).

  ProblemChain — the gates a purchase has to clear, with a click
  storefront's answer missing past the first one.

  ShopFloor — guests waiting outside, the gateway at the door, and the
  two merchant agents at their desks.
*/

function topPoints(cx: number, cy: number, hw: number, hh: number) {
  return `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
}

function IsoSlab({
  cx,
  cy,
  hw,
  hh,
  t = 12,
  tone,
  className,
  children,
}: {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  t?: number;
  tone: "line" | "solid" | "accent";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <g className={className}>
      <polygon
        points={`${cx - hw},${cy} ${cx},${cy + hh} ${cx},${cy + hh + t} ${cx - hw},${cy + t}`}
        className="iso-face-l"
      />
      <polygon
        points={`${cx},${cy + hh} ${cx + hw},${cy} ${cx + hw},${cy + t} ${cx},${cy + hh + t}`}
        className="iso-face-r"
      />
      <polygon
        points={topPoints(cx, cy, hw, hh)}
        className={`iso-slab-top iso-slab-top--${tone}`}
      />
      {children}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Problem chain                                                       */
/* ------------------------------------------------------------------ */

const GATES = [
  { label: "Find the product", detail: "a public page, readable today" },
  { label: "Check availability", detail: "no live stock feed" },
  { label: "Agree on a price", detail: "coupons, not quotes" },
  { label: "Negotiate bounds", detail: "limits never published" },
  { label: "Approve the spend", detail: "no consent step" },
  { label: "Pay and prove it", detail: "no agent payment, no proof" },
];

const GATE_YS = [84, 148, 212, 276, 340, 404];
const CHAIN_FS = [0.32, 0.58, 0.84];

export function ProblemChain() {
  return (
    <div
      className="iso-stage"
      role="img"
      aria-label="Purchase-chain diagram: an agent can find the product, then stalls at checking availability. Stock, price, negotiation limits, spending approval, payment and proof have no machine-readable answer in a storefront built for clicks."
    >
      <svg
        viewBox="0 0 600 500"
        className="iso-svg bg-[var(--bb-panel)]"
        aria-hidden="true"
      >
        {/* spine: live up to the wall, ghosted after it */}
        <line x1="250" y1="36" x2="250" y2="148" className="iso-spine" />
        <line
          x1="250"
          y1="148"
          x2="250"
          y2="404"
          className="iso-spine"
          opacity="0.25"
        />

        {GATES.map((gate, i) => {
          const y = GATE_YS[i];
          const state = i === 0 ? "open" : i === 1 ? "wall" : "locked";
          return (
            <g key={gate.label}>
              <IsoSlab
                cx={250}
                cy={y}
                hw={105}
                hh={52}
                tone={state === "open" ? "solid" : "line"}
                className={`chain-gate chain-gate--${state}`}
              />
              <circle
                cx={250}
                cy={y}
                r={3.5}
                className={
                  state === "wall" ? "iso-joint iso-joint--accent" : "iso-joint"
                }
              />
              {state === "wall" && (
                <g className="chain-barrier line-pulse" aria-hidden="true">
                  {CHAIN_FS.map((f) => {
                    const px = 145 + f * 105;
                    const py = y + f * 52;
                    return (
                      <line key={f} x1={px} y1={py} x2={px} y2={py - 26} />
                    );
                  })}
                  <polyline
                    fill="none"
                    points={CHAIN_FS.map(
                      (f) => `${145 + f * 105},${y + f * 52 - 26}`
                    ).join(" ")}
                  />
                </g>
              )}
              <text x={372} y={y - 2} className="iso-svg-label">
                {gate.label}
              </text>
              <text
                x={372}
                y={y + 17}
                className="iso-svg-detail"
                style={
                  state === "wall"
                    ? { fill: "var(--bb-orange)" }
                    : undefined
                }
              >
                {gate.detail}
              </text>
            </g>
          );
        })}

        {/* packets: repeated attempts that stop at the wall */}
        {[0, 0.93, 1.86].map((delay) => (
          <circle
            key={delay}
            cx={250}
            cy={36}
            r={3.5}
            className="chain-packet"
            style={
              {
                animationDelay: `${delay}s`,
                "--stop": "60px",
              } as CSSProperties
            }
          />
        ))}
      </svg>

      <div className="iso-caption">
        <span className="iso-caption-dot" />
        <p>
          An agent needs a readable answer at every gate. A storefront built
          for clicks gives it one and stops.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shop floor                                                          */
/* ------------------------------------------------------------------ */

const PLATFORM = { cx: 300, cy: 410, hw: 210, hh: 105, t: 14 };
const CUSTOMER = { cx: 170, cy: 90, hw: 62, hh: 31, t: 10 };
const GUEST_AGENT = { cx: 430, cy: 90, hw: 62, hh: 31, t: 10 };
const GATEWAY = { cx: 300, cy: 240, hw: 78, hh: 39, t: 12 };
const SELLER = { cx: 225, cy: 400, hw: 72, hh: 36, t: 10 };
const SERVICE = { cx: 385, cy: 400, hw: 72, hh: 36, t: 10 };

// x1, y1, x2, y2 — routes between the players, drawn under the slabs
const ROUTE_DELEGATION = [236, 88, 302, 67, 366, 88];
const ROUTE_CUSTOMER = [188, 116, 255, 222];
const ROUTE_AGENT = [412, 116, 345, 222];
const ROUTE_TO_SELLER = [288, 282, 228, 366];
const ROUTE_TO_SERVICE = [312, 282, 372, 366];

const PACKETS = [
  { x: 236, y: 88, dx: 66, dy: -21, dur: 1.4, delay: 0.2 },
  { x: 302, y: 67, dx: 64, dy: 21, dur: 1.4, delay: 0.9 },
  { x: 188, y: 116, dx: 67, dy: 106, dur: 2.6, delay: 0.4 },
  { x: 412, y: 116, dx: -67, dy: 106, dur: 2.6, delay: 1.5 },
  { x: 288, y: 282, dx: -60, dy: 84, dur: 2.2, delay: 1.1 },
  { x: 312, y: 282, dx: 60, dy: 84, dur: 2.2, delay: 1.8 },
];

// Faint floor grid on the store platform, clipped to its top face.
const GRID_C = [165, 195, 225, 255, 285, 315, 345];
const GRID_M = [465, 495, 525, 555, 585, 615, 645];

function Route({ points }: { points: number[] }) {
  return (
    <line
      x1={points[0]}
      y1={points[1]}
      x2={points[2]}
      y2={points[3]}
      className="iso-spine"
    />
  );
}

export function ShopFloor() {
  return (
    <div
      className="iso-stage"
      role="img"
      aria-label="Isometric shop diagram: a customer and their shopping agent connect through the gateway. Inside the store, the Seller Agent quotes and checks out, and the Service Agent handles orders and support, all working from the merchant's catalog and rules."
    >
      <svg
        viewBox="0 0 600 560"
        className="iso-svg bg-[var(--bb-panel)]"
        aria-hidden="true"
      >
        <defs>
          <clipPath id="shop-floor-clip">
            <polygon points={topPoints(300, 410, 210, 105)} />
          </clipPath>
        </defs>

        {/* delegation curve between customer and their agent */}
        <path
          d={`M${ROUTE_DELEGATION[0]},${ROUTE_DELEGATION[1]} Q302,46 ${ROUTE_DELEGATION[4]},${ROUTE_DELEGATION[5]}`}
          fill="none"
          className="iso-spine"
        />

        {/* outside routes: guests toward the door */}
        <Route points={ROUTE_CUSTOMER} />
        <Route points={ROUTE_AGENT} />

        {/* the store */}
        <IsoSlab {...PLATFORM} tone="line" />
        <g clipPath="url(#shop-floor-clip)" opacity="0.55">
          {GRID_C.map((c) => (
            <line
              key={`c${c}`}
              x1="80"
              y1={0.5 * 80 + c}
              x2="520"
              y2={0.5 * 520 + c}
              stroke="#1e1e1d"
              strokeWidth="1"
            />
          ))}
          {GRID_M.map((c) => (
            <line
              key={`m${c}`}
              x1="80"
              y1={-0.5 * 80 + c}
              x2="520"
              y2={-0.5 * 520 + c}
              stroke="#1e1e1d"
              strokeWidth="1"
            />
          ))}
        </g>

        {/* inside routes: from the door to the desks */}
        <Route points={ROUTE_TO_SELLER} />
        <Route points={ROUTE_TO_SERVICE} />

        {/* desks */}
        <IsoSlab {...SELLER} tone="solid" />
        <IsoSlab {...SERVICE} tone="solid" />

        {/* guests */}
        <IsoSlab {...CUSTOMER} tone="line" />
        <IsoSlab {...GUEST_AGENT} tone="line" />

        {/* gateway at the door */}
        <IsoSlab {...GATEWAY} tone="accent" />
        <circle
          cx={300}
          cy={201}
          r={3.5}
          className="iso-joint iso-joint--accent line-pulse"
        />

        {/* packets */}
        {PACKETS.map((p) => (
          <circle
            key={`${p.x}-${p.y}-${p.delay}`}
            cx={p.x}
            cy={p.y}
            r={3}
            className="packet"
            style={
              {
                "--pdx": `${p.dx}px`,
                "--pdy": `${p.dy}px`,
                animationDuration: `${p.dur}s`,
                animationDelay: `${p.delay}s`,
              } as CSSProperties
            }
          />
        ))}

        {/* labels */}
        <text x={170} y={34} textAnchor="middle" className="iso-svg-label">
          Customer
        </text>
        <text x={170} y={53} textAnchor="middle" className="iso-svg-detail">
          comes in person
        </text>
        <text x={430} y={34} textAnchor="middle" className="iso-svg-label">
          Shopping agent
        </text>
        <text x={430} y={53} textAnchor="middle" className="iso-svg-detail">
          acts for its customer
        </text>
        <text x={216} y={236} textAnchor="end" className="iso-svg-label">
          Gateway
        </text>
        <text x={216} y={255} textAnchor="end" className="iso-svg-detail">
          checks ID + delegation
        </text>
        <text x={300} y={338} textAnchor="middle" className="iso-svg-label">
          Your store
        </text>
        <text x={302} y={362} textAnchor="middle" className="iso-svg-detail">
          catalog · prices · rules
        </text>
        <text x={225} y={396} textAnchor="middle" className="iso-svg-label">
          Seller agent
        </text>
        <text x={385} y={396} textAnchor="middle" className="iso-svg-label">
          Service agent
        </text>
      </svg>

      <div className="iso-caption">
        <span className="iso-caption-dot" />
        <p>
          A shopper can come in person or send an agent. Both are checked at
          the gateway; your agents answer from your catalog, and the ledger
          keeps the receipt.
        </p>
      </div>
    </div>
  );
}
