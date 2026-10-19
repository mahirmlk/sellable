"use client";

import type { CSSProperties, ReactNode } from "react";

/*
  Narrative diagrams, drawn as fixed SVG in the same isometric language
  as the hero stack. A single viewBox scales the whole drawing at every
  breakpoint; below 768px the in-SVG captions hand off to a plain
  ordered list under the drawing so nothing shrinks into illegibility.
  Each drawing's svg carries role="img" and its label, so the caption
  and the small-screen list stay real content for screen readers.
  Motion stays on tiny nodes (translate + opacity only).

  ProblemChain — the corridor of gates a purchase has to clear. The
  agent gets through the open first gate and stops at a shut,
  hazard-marked second one.

  AgentJourney — how an outside agent arrives on public files, proves
  itself at the gateway, buys through the Seller Agent, settles on
  consent, and stays supported.

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
/* Problem chain — the corridor of gates                               */
/* ------------------------------------------------------------------ */

const CHAIN_GATES = [
  { state: "open", label: "Find the product", detail: "a public page, readable today" },
  { state: "wall", label: "Check availability", detail: "no live stock feed" },
  { state: "far", label: "Agree on a price", detail: "coupons, not quotes" },
  { state: "far", label: "Negotiate bounds", detail: "limits never published" },
  { state: "far", label: "Approve the spend", detail: "no consent step" },
  { state: "far", label: "Pay and prove it", detail: "no agent payment, no proof" },
] as const;

// Six gates stand in a row across one walkable lane. Each next gate sits
// exactly one pitch further along the walking axis — up and to the right
// in the isometric ground plane — so the corridor recedes toward the
// gates the purchase never reaches. The agent clears gate 01 and stops
// at gate 02; the gates past it step back slightly but stay fully drawn,
// so the chain reads to the last door.
const GATE_H = 54; // door height
const GATE_HW = 42; // half width of the doorway, along the right axis
const CHAIN_PITCH = 140; // gate-to-gate distance along the walking axis
const CHAIN_START = { x: 250, y: 442 }; // centre of gate 01's sill
const LANE_HW = 56; // half width of the walkable lane
const LANE_HH = 28;

// Gates past the shut one sit back while staying clearly readable.
const CHAIN_DIM = [1, 1, 0.95, 0.9, 0.86, 0.82];

// Walking axis: one pitch right, half a pitch up.
const CHAIN_STEP = [CHAIN_PITCH, -CHAIN_PITCH / 2] as const;

// Corners of gate k: sill endpoints a/bb on the ground, tops at/bt.
function chainGate(k: number) {
  const cx = CHAIN_START.x + CHAIN_STEP[0] * k;
  const cy = CHAIN_START.y + CHAIN_STEP[1] * k;
  const a = [cx - GATE_HW, cy - GATE_HW / 2] as const;
  const bb = [cx + GATE_HW, cy + GATE_HW / 2] as const;
  return {
    c: [cx, cy] as const,
    a,
    bb,
    at: [a[0], a[1] - GATE_H] as const,
    bt: [bb[0], bb[1] - GATE_H] as const,
  };
}

// The walkable lane: one long parallelogram through every sill, with a
// short stub before gate 01 and past gate 06.
const chainLaneFrom = [
  CHAIN_START.x - CHAIN_STEP[0] * 0.9,
  CHAIN_START.y - CHAIN_STEP[1] * 0.9,
] as const;
const chainLaneTo = [
  CHAIN_START.x + CHAIN_STEP[0] * (CHAIN_GATES.length - 1 + 0.9),
  CHAIN_START.y + CHAIN_STEP[1] * (CHAIN_GATES.length - 1 + 0.9),
] as const;
const CHAIN_LANE = [
  [chainLaneFrom[0] - LANE_HW, chainLaneFrom[1] - LANE_HH],
  [chainLaneFrom[0] + LANE_HW, chainLaneFrom[1] + LANE_HH],
  [chainLaneTo[0] + LANE_HW, chainLaneTo[1] + LANE_HH],
  [chainLaneTo[0] - LANE_HW, chainLaneTo[1] - LANE_HH],
]
  .map((point) => point.join(","))
  .join(" ");

const chainGates = CHAIN_GATES.map((gate, i) => ({
  ...gate,
  ...chainGate(i),
  dim: CHAIN_DIM[i],
}));

export function ProblemChain() {
  // The agent stands on the lane between the open gate and the shut one.
  const first = chainGate(0).c;
  const second = chainGate(1).c;
  const botX = (first[0] + second[0]) / 2 + 12;
  const botY = (first[1] + second[1]) / 2 + 6;

  return (
    <div className="iso-stage">
      <svg
        viewBox="0 0 1240 560"
        className="iso-svg"
        role="img"
        aria-label="Isometric corridor of six gates a purchase must clear. The agent passes the open first gate, then stops on the lane before the shut second gate, marked with an orange cross because there is no live stock feed. The gates beyond — price, negotiation bounds, spend approval, payment and proof — stay visible but recessed, because the purchase never gets there."
      >
        {/* the lane the purchase has to walk */}
        <polygon
          points={CHAIN_LANE}
          className="iso-slab-top iso-slab-top--line chain-lane"
        />

        {chainGates.map(({ c, a, bb, at, bt, dim, state, label, detail }) => {
          const jamb =
            state === "wall"
              ? "chain-jamb chain-jamb--wall"
              : state === "open"
                ? "chain-jamb chain-jamb--open"
                : "chain-jamb";
          return (
            <g
              key={label}
              className={
                state === "far" ? "chain-gate chain-gate--far" : "chain-gate"
              }
              style={{ opacity: dim }}
            >
              {state !== "open" && (
                <>
                  <polygon
                    points={`${a} ${bb} ${bt} ${at}`}
                    className={
                      state === "wall"
                        ? "chain-door chain-door--wall"
                        : "chain-door chain-door--ghost"
                    }
                  />
                  {[0.25, 0.5, 0.75].map((frac) => (
                    <line
                      key={frac}
                      x1={a[0]}
                      y1={a[1] - GATE_H * frac}
                      x2={bb[0]}
                      y2={bb[1] - GATE_H * frac}
                      className={
                        state === "wall"
                          ? "chain-slat chain-slat--wall"
                          : "chain-slat chain-slat--ghost"
                      }
                    />
                  ))}
                </>
              )}

              {state === "wall" && (
                <>
                  <line
                    x1={c[0] - 10}
                    y1={c[1] - 42}
                    x2={c[0] + 10}
                    y2={c[1] - 22}
                    className="chain-x"
                  />
                  <line
                    x1={c[0] + 10}
                    y1={c[1] - 42}
                    x2={c[0] - 10}
                    y2={c[1] - 22}
                    className="chain-x"
                  />
                </>
              )}

              <line x1={a[0]} y1={a[1]} x2={at[0]} y2={at[1]} className={jamb} />
              <line x1={bb[0]} y1={bb[1]} x2={bt[0]} y2={bt[1]} className={jamb} />
              <line x1={at[0]} y1={at[1]} x2={bt[0]} y2={bt[1]} className={jamb} />

              <text
                x={c[0] - 20}
                y={c[1] + 88}
                className="iso-svg-label iso-svg-hide-sm"
              >
                {label}
              </text>
              <text
                x={c[0] - 20}
                y={c[1] + 107}
                className="iso-svg-detail iso-svg-hide-sm"
                style={state === "wall" ? { fill: "var(--bb-orange)" } : undefined}
              >
                {detail}
              </text>
            </g>
          );
        })}

        {/* the agent: through the open gate, stopped at the shut one */}
        <IsoSlab
          cx={botX}
          cy={botY}
          hw={24}
          hh={12}
          t={12}
          tone="solid"
          className="chain-runner"
        >
          <line
            x1={botX}
            y1={botY - 14}
            x2={botX}
            y2={botY - 30}
            className="chain-antenna"
          />
          <circle cx={botX} cy={botY - 33} r={3.2} className="chain-eye" />
        </IsoSlab>
      </svg>

      <div className="iso-caption">
        <span className="iso-caption-dot" />
        <p>
          An agent needs a readable answer at every gate. A storefront built
          for clicks gives it one and stops.
        </p>
      </div>

      {/* The drawing&apos;s captions give way to this list on narrow
          screens, where the SVG text would render too small to read. */}
      <ol className="mt-6 space-y-3.5 md:hidden">
        {CHAIN_GATES.map((gate, i) => (
          <li key={gate.label} className="flex gap-3">
            <span className="pt-0.5 font-[var(--font-mono)] text-[0.56rem] tabular-nums tracking-[0.12em] text-[var(--bb-orange)]">
              {`0${i + 1}`}
            </span>
            <div>
              <div
                className={`font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.1em] ${
                  gate.state === "far"
                    ? "text-[var(--bb-grey-2)]"
                    : "text-[var(--bb-white)]"
                }`}
              >
                {gate.label}
              </div>
              <div
                className={`mt-0.5 font-[var(--font-sans)] text-[0.78rem] leading-snug ${
                  gate.state === "wall"
                    ? "text-[var(--bb-orange)]"
                    : "text-[var(--bb-grey-2)]"
                }`}
              >
                {gate.detail}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agent journey — how an outside agent buys, end to end               */
/* ------------------------------------------------------------------ */

// Six stops on one wire: the agent arrives on the public files, keys in
// at the gateway, is quoted and negotiated by the Seller Agent, settles
// on single-use consent, and hands off to the Service Agent. Every
// label is a real surface — header, endpoint, or mechanism.
const JOURNEY_STOPS = [
  { label: "Outside agent", detail: "arrives from the open web", ref: "no key · no account" },
  { label: "Public files", detail: "who you are · what you sell", ref: "/.well-known/agents.json" },
  { label: "Gateway", detail: "a key or a signed request", ref: "X-Agent-Key · X-Signature" },
  { label: "Seller agent", detail: "quotes, then counter-offers", ref: "quotes.create · negotiate" },
  { label: "Settlement", detail: "consent binds the amount", ref: "verified webhook marks paid" },
  { label: "Service agent", detail: "orders, returns, refunds", ref: "/commerce/support/cases" },
] as const;

const JOURNEY_TY = 190; // top-face centreline of the tiles
const JOURNEY_PITCH = 186;
const JOURNEY_X0 = 132;

const journeyStops = JOURNEY_STOPS.map((stop, i) => ({
  ...stop,
  cx: JOURNEY_X0 + JOURNEY_PITCH * i,
}));

export function AgentJourney() {
  const [arrive, files, gateway, seller, settle, service] = journeyStops;

  return (
    <div className="iso-stage">
      <svg
        viewBox="0 0 1200 300"
        className="iso-svg"
        role="img"
        aria-label="Isometric journey of an outside agent: it arrives from the open web on three public files, proves itself at the gateway with a key or a signed request, is quoted and negotiated by your Seller Agent inside policy bounds, settles through single-use consent confirmed by a verified provider webhook, and is supported by your Service Agent."
      >
        {/* the wire between consecutive stops */}
        {journeyStops.slice(0, -1).map((stop) => (
          <line
            key={`wire-${stop.label}`}
            x1={stop.cx + 54}
            y1={JOURNEY_TY}
            x2={stop.cx + JOURNEY_PITCH - 54}
            y2={JOURNEY_TY}
            className="iso-spine"
          />
        ))}
        {journeyStops.slice(0, -1).map((stop, i) => (
          <circle
            key={`packet-${stop.label}`}
            cx={stop.cx + 56}
            cy={JOURNEY_TY}
            r={3}
            className="packet"
            style={
              {
                "--pdx": `${JOURNEY_PITCH - 110}px`,
                "--pdy": "0px",
                animationDuration: "1.6s",
                animationDelay: `${i * 0.32}s`,
              } as CSSProperties
            }
          />
        ))}

        {/* direction markers at each wire's midpoint — the flow reads
            left to right without step numbers */}
        {journeyStops.slice(0, -1).map((stop) => (
          <polygon
            key={`flow-${stop.label}`}
            points={`${stop.cx + 99},${JOURNEY_TY} ${stop.cx + 90},${JOURNEY_TY - 5} ${stop.cx + 90},${JOURNEY_TY + 5}`}
            className="iso-arrow"
          />
        ))}

        {/* one tile per stop */}
        {journeyStops.map((stop) => (
          <IsoSlab
            key={`tile-${stop.label}`}
            cx={stop.cx}
            cy={JOURNEY_TY}
            hw={54}
            hh={27}
            t={10}
            tone="line"
          />
        ))}

        {/* the outside agent */}
        <IsoSlab cx={arrive.cx} cy={JOURNEY_TY - 3} hw={25} hh={12.5} t={10} tone="solid" />
        <line
          x1={arrive.cx}
          y1={JOURNEY_TY - 15}
          x2={arrive.cx}
          y2={JOURNEY_TY - 38}
          className="chain-antenna"
        />
        <circle cx={arrive.cx} cy={JOURNEY_TY - 41} r={3.4} className="chain-eye" />

        {/* the public files, stacked */}
        <IsoSlab cx={files.cx - 2} cy={JOURNEY_TY - 2} hw={24} hh={12} t={3} tone="line" />
        <IsoSlab cx={files.cx} cy={JOURNEY_TY - 12} hw={24} hh={12} t={3} tone="line" />
        <IsoSlab cx={files.cx + 2} cy={JOURNEY_TY - 22} hw={24} hh={12} t={3} tone="line" />

        {/* the gateway checks the key */}
        <line
          x1={gateway.cx - 28}
          y1={JOURNEY_TY - 14}
          x2={gateway.cx - 28}
          y2={JOURNEY_TY - 56}
          className="chain-jamb chain-jamb--open"
        />
        <line
          x1={gateway.cx + 28}
          y1={JOURNEY_TY + 14}
          x2={gateway.cx + 28}
          y2={JOURNEY_TY - 28}
          className="chain-jamb chain-jamb--open"
        />
        <line
          x1={gateway.cx - 28}
          y1={JOURNEY_TY - 56}
          x2={gateway.cx + 28}
          y2={JOURNEY_TY - 28}
          className="chain-jamb chain-jamb--open"
        />
        <polygon
          points={`${gateway.cx},${JOURNEY_TY - 45.5} ${gateway.cx + 15},${JOURNEY_TY - 38} ${gateway.cx},${JOURNEY_TY - 30.5} ${gateway.cx - 15},${JOURNEY_TY - 38}`}
          className="chain-key"
        />

        {/* the Seller Agent quotes and takes counter-offers */}
        <IsoSlab cx={seller.cx} cy={JOURNEY_TY - 6} hw={30} hh={15} t={10} tone="solid" />
        <polygon
          points={`${seller.cx - 5},${JOURNEY_TY - 43.5} ${seller.cx + 10},${JOURNEY_TY - 36} ${seller.cx - 5},${JOURNEY_TY - 28.5} ${seller.cx - 20},${JOURNEY_TY - 36}`}
          className="iso-slip"
        />
        <path
          d={`M${seller.cx - 42},${JOURNEY_TY - 34} Q${seller.cx},${JOURNEY_TY - 62} ${seller.cx + 42},${JOURNEY_TY - 34}`}
          fill="none"
          className="iso-spine"
        />
        <polygon
          points={`${seller.cx + 42},${JOURNEY_TY - 34} ${seller.cx + 30},${JOURNEY_TY - 39} ${seller.cx + 32},${JOURNEY_TY - 30}`}
          className="iso-arrow"
        />

        {/* settlement: consent binds the amount, the webhook seals it */}
        <IsoSlab cx={settle.cx} cy={JOURNEY_TY - 4} hw={30} hh={15} t={10} tone="accent" />
        <circle cx={settle.cx} cy={JOURNEY_TY - 38} r={11} className="chain-coin" />
        <polyline
          points={`${settle.cx - 6},${JOURNEY_TY - 38} ${settle.cx - 1.5},${JOURNEY_TY - 33.5} ${settle.cx + 7},${JOURNEY_TY - 44}`}
          fill="none"
          className="chain-x"
        />

        {/* the Service Agent takes it from here */}
        <IsoSlab cx={service.cx} cy={JOURNEY_TY - 6} hw={30} hh={15} t={10} tone="solid" />
        <polygon
          points={`${service.cx - 5},${JOURNEY_TY - 41} ${service.cx + 11},${JOURNEY_TY - 33} ${service.cx - 5},${JOURNEY_TY - 25} ${service.cx - 21},${JOURNEY_TY - 33}`}
          className="iso-slip"
        />
        <line
          x1={service.cx - 14}
          y1={JOURNEY_TY - 37.5}
          x2={service.cx + 4}
          y2={JOURNEY_TY - 28.5}
          className="chain-slat"
        />

        {/* captions — the list under the drawing takes over on small screens */}
        {journeyStops.map((stop) => (
          <g key={`text-${stop.label}`} className="iso-svg-hide-sm">
            <text x={stop.cx} y={88} textAnchor="middle" className="iso-svg-label">
              {stop.label}
            </text>
            <text x={stop.cx} y={107} textAnchor="middle" className="iso-svg-detail">
              {stop.detail}
            </text>
            <text x={stop.cx} y={254} textAnchor="middle" className="iso-svg-ref">
              {stop.ref}
            </text>
          </g>
        ))}
      </svg>

      <div className="iso-caption">
        <span className="iso-caption-dot" />
        <p>
          Public files in, a signed request at the gateway, quotes and
          counter-offers inside your bounds, settlement that only a verified
          webhook closes — and your Service Agent after the sale. The ledger
          keeps every step.
        </p>
      </div>

      {/* An ordered list keeps the sequence for screen readers; the
          markers are the orange squares, not numbers. */}
      <ol className="mt-6 space-y-3.5 md:hidden list-none">
        {JOURNEY_STOPS.map((stop) => (
          <li key={stop.label} className="flex gap-3">
            <span
              className="mt-[6px] w-[5px] h-[5px] shrink-0 bg-[var(--bb-orange)]"
              aria-hidden="true"
            />
            <div>
              <div className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.1em] text-[var(--bb-white)]">
                {stop.label}
              </div>
              <div className="mt-0.5 font-[var(--font-sans)] text-[0.78rem] leading-snug text-[var(--bb-grey-2)]">
                {stop.detail}
              </div>
              <div className="mt-0.5 font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">
                {stop.ref}
              </div>
            </div>
          </li>
        ))}
      </ol>
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
    <div className="iso-stage">
      <svg
        viewBox="0 0 600 560"
        className="iso-svg"
        role="img"
        aria-label="Isometric shop diagram: a customer and their shopping agent connect through the gateway. Inside the store, the Seller Agent quotes and checks out, and the Service Agent handles orders and support, all working from the merchant's catalog and rules."
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
