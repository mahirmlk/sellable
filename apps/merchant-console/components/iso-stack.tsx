"use client";

import { useState } from "react";

/*
  Isometric order path, drawn as fixed SVG.
  Five slabs mirror the platform planes. A dashed spine carries packets
  from entry to settlement while each slab lights in turn.
  Hovering (or tapping, or keyboard-focusing) a slab opens an overlay
  window with that layer's details. No 3D transforms and no runtime
  layout math: the viewBox scales the whole drawing cleanly at every
  breakpoint. Motion is limited to opacity and straight vertical
  translation on tiny SVG nodes.
*/

const CX = 250;
const HW = 120;
const HH = 60;
const T = 14;
const YS = [84, 146, 208, 270, 332];
const VIEW_H = 420;
const DROP = YS[YS.length - 1] - YS[0];

interface Slab {
  label: string;
  detail: string;
  body: string;
  tone: "line" | "solid" | "accent";
}

const SLABS: Slab[] = [
  {
    label: "Shopping agents",
    detail: "guests, verified at entry",
    body: "Outside buying agents connect here. They prove identity with an API key or a signed request, and they only ever see the public catalog.",
    tone: "line",
  },
  {
    label: "Gateway",
    detail: "identity + permission",
    body: "Checks who the agent is and what it may do. Settles capabilities, resolves the customer delegation, and opens a session.",
    tone: "line",
  },
  {
    label: "Your agents",
    detail: "seller + service",
    body: "The Seller quotes from your catalog inside your rules. The Service Agent looks after orders, returns, and refunds.",
    tone: "solid",
  },
  {
    label: "Policy + consent",
    detail: "the gate for money",
    body: "Each cart passes the same checks in the same order. Payments need a single-use token tied to the exact order.",
    tone: "accent",
  },
  {
    label: "Payment + ledger",
    detail: "settled, then written down",
    body: "The provider takes the payment. Only a verified webhook settles the order, and each step stays replayable.",
    tone: "line",
  },
];

function topPoints(y: number) {
  return `${CX},${y - HH} ${CX + HW},${y} ${CX},${y + HH} ${CX - HW},${y}`;
}

export function IsoStack({ compact = false }: { compact?: boolean }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const active = hovered ?? pinned;

  return (
    <div
      className={`iso-stage ${compact ? "iso-stage--compact" : ""}`}
      role="img"
      aria-label="Isometric diagram of the Sellable order path: shopping agents enter through the gateway, your agents quote and support, policy and consent gate the payment, and the ledger records it."
      onMouseLeave={() => setHovered(null)}
    >
      <svg viewBox={`0 0 600 ${VIEW_H}`} className="iso-svg" aria-hidden="true">
        {/* spine */}
        <line
          x1={CX}
          y1={YS[0]}
          x2={CX}
          y2={YS[YS.length - 1]}
          className="iso-spine"
        />

        {SLABS.map((slab, i) => {
          const y = YS[i];
          return (
            <g
              key={slab.label}
              className={`iso-slab iso-slab--${slab.tone} ${active === i ? "iso-slab--active" : ""}`}
              tabIndex={0}
              aria-label={`${slab.label}: ${slab.detail}`}
              onMouseEnter={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              onClick={() => setPinned((p) => (p === i ? null : i))}
            >
              {/* side faces */}
              <polygon
                points={`${CX - HW},${y} ${CX},${y + HH} ${CX},${y + HH + T} ${CX - HW},${y + T}`}
                className="iso-face-l"
              />
              <polygon
                points={`${CX},${y + HH} ${CX + HW},${y} ${CX + HW},${y + T} ${CX},${y + HH + T}`}
                className="iso-face-r"
              />
              {/* top */}
              <polygon points={topPoints(y)} className={`iso-slab-top iso-slab-top--${slab.tone}`} />
              {/* sweep highlight, one slab at a time */}
              <polygon
                points={topPoints(y)}
                className="iso-sweep"
                style={{ animationDelay: `${i}s` }}
              />
              {/* joint on the spine */}
              <circle
                cx={CX}
                cy={y}
                r={3.5}
                className={slab.tone === "accent" ? "iso-joint iso-joint--accent" : "iso-joint"}
              />
              {/* label + detail */}
              <text x={398} y={y - 2} className="iso-svg-label">
                {slab.label}
              </text>
              <text x={398} y={y + 17} className="iso-svg-detail">
                {slab.detail}
              </text>
            </g>
          );
        })}

        {/* packets falling down the spine */}
        {[0, 1, 2].map((d) => (
          <circle
            key={d}
            cx={CX}
            cy={YS[0]}
            r={4}
            className="iso-drop"
            style={{ animationDelay: `${d}s`, ["--drop" as string]: `${DROP}px` }}
          />
        ))}
      </svg>

      {active !== null && (
        <div
          className="iso-overlay tab-in"
          style={{ top: `${(YS[active] / VIEW_H) * 100}%` }}
          aria-live="polite"
        >
          <div className="iso-overlay-label">{SLABS[active].label}</div>
          <div className="iso-overlay-detail">{SLABS[active].detail}</div>
          <p className="iso-overlay-body">{SLABS[active].body}</p>
        </div>
      )}

      <div className="iso-caption">
        <span className="iso-caption-dot" />
        <p>
          Agents talk at the top. Money moves at the bottom, after policy and
          consent.
        </p>
      </div>
    </div>
  );
}

export function IsoChip({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="iso-chip">
      <div className="iso-chip-top" aria-hidden="true">
        <span />
      </div>
      <div className="iso-chip-body">
        <div className="iso-chip-label">{label}</div>
        <div className="iso-chip-detail">{detail}</div>
      </div>
    </div>
  );
}
