"use client";

import { useState } from "react";
import Link from "next/link";
import { Eyebrow } from "./ui/eyebrow";
import { CornerBrackets } from "./ui/corner-brackets";

// The real console surfaces, named after the routes that actually exist in
// apps/merchant-console and services/commerce/sellable/main.py. No invented
// features — every tab maps to shipped backend endpoints.

interface Surface {
  key: string;
  nav: string;
  title: string;
  description: string;
  endpoints: string[];
  highlights: string[];
}

const SURFACES: Surface[] = [
  {
    key: "overview",
    nav: "OVERVIEW",
    title: "What is happening in your store, right now",
    description:
      "Revenue, agent-driven share, and pending approvals — plus a live event feed streamed from the ledger over SSE. Every number is derived from real orders; nothing is cached or faked.",
    endpoints: ["GET /console/insights", "GET /activity/stream"],
    highlights: ["Live SSE feed", "Merchant-scoped metrics", "System health from the backend"],
  },
  {
    key: "chat",
    nav: "CHAT CHECKOUT",
    title: "Conversational checkout on your own catalog",
    description:
      "Talk to the Seller Agent the same way an AI buyer would. It searches your catalog, quotes within policy, negotiates, and takes payment through Razorpay test mode — every step lands in the ledger.",
    endpoints: ["POST /console/agent/seller/respond", "POST /console/orders", "POST /console/orders/{id}/payment"],
    highlights: ["Bounded negotiation", "Single-use consent", "Policy-gated checkout"],
  },
  {
    key: "approvals",
    nav: "APPROVALS",
    title: "Human judgment where it matters",
    description:
      "Orders above your human-approval threshold are held — payment is technically impossible until you decide. One click approves and issues consent; rejection aborts cleanly with a ledger event.",
    endpoints: ["GET /console/approvals", "POST /console/approvals/{id}/approve"],
    highlights: ["HITL by construction", "No payment before consent", "Auditable decisions"],
  },
  {
    key: "replay",
    nav: "REPLAY",
    title: "Replay any transaction, line by line",
    description:
      "Open any order and walk its full trace: actor, action, reasoning, and policy references for every step. Disputes stop being arguments — they become timelines.",
    endpoints: ["GET /console/transactions/{id}", "GET /transactions/{id}/events"],
    highlights: ["Actor + reasoning per step", "Policy refs on every check", "Payment verified by webhook"],
  },
  {
    key: "catalog",
    nav: "CATALOG",
    title: "Your catalog is the agent's reality",
    description:
      "Products live in Postgres, persist across restarts, and are served machine-readable at /catalog.ai.json. The agent can only sell what is actually stocked — inventing SKUs is structurally impossible.",
    endpoints: ["GET /console/catalog", "POST /catalog/products", "GET /catalog.ai.json"],
    highlights: ["DB-persisted per merchant", "Floor prices enforced", "Served machine-readable"],
  },
  {
    key: "growth",
    nav: "GROWTH",
    title: "Agentic revenue analytics",
    description:
      "Upsell attach rate, negotiation outcomes, and saved-deal pricing insight — derived from ledger events, traceable to the transactions behind every number.",
    endpoints: ["GET /console/insights", "GET /console/transactions"],
    highlights: ["Derived from the ledger", "Price-sensitivity signals", "Nothing self-reported"],
  },
];

export function ConsolePreview() {
  const [active, setActive] = useState(0);
  const surface = SURFACES[active];

  return (
    <section id="console" className="technical-section py-[clamp(80px,10vw,160px)] overflow-hidden relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-[0.5]" style={{ background: "radial-gradient(680px 420px at 50% 90%, rgba(255,105,0,0.05), transparent 66%)" }} />
      </div>

      <div className="page-frame relative">
        <div className="max-w-[720px]">
          <Eyebrow label="06 — MERCHANT CONSOLE" />
          <h2 className="section-title mt-6 text-[var(--bb-white)]">
            A cockpit, not an admin panel
          </h2>
          <p className="body-copy mt-6">
            Everything the backend does is observable and controllable from the
            console — scoped to your store, authenticated with your session,
            and honest about every failure.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-[280px_1fr] border border-[#30302E] bg-[var(--bb-panel)]">
          {/* Tab rail */}
          <div className="border-b lg:border-b-0 lg:border-r border-[var(--bb-line)] flex lg:flex-col overflow-x-auto">
            {SURFACES.map((s, i) => (
              <button
                key={s.key}
                onClick={() => setActive(i)}
                className={`relative flex items-center gap-3 px-5 py-4 text-left font-[var(--font-mono)] text-[0.62rem] tracking-[0.12em] uppercase whitespace-nowrap transition-colors cursor-pointer ${
                  active === i
                    ? "text-[var(--bb-white)] bg-[var(--bb-panel-3)]"
                    : "text-[var(--bb-grey-3)] hover:text-[var(--bb-white)]"
                }`}
              >
                <span
                  className={`absolute left-0 top-0 bottom-0 w-[2px] transition-all ${
                    active === i ? "bg-[var(--bb-orange)]" : "bg-transparent"
                  }`}
                />
                <span className={`tabular-nums text-[0.55rem] ${active === i ? "text-[var(--bb-orange)]" : "text-[var(--bb-grey-4)]"}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s.nav}
              </button>
            ))}
          </div>

          {/* Detail panel */}
          <div className="relative p-7 sm:p-9">
            <CornerBrackets />
            <div key={surface.key} className="animate-slide-up">
              <h3 className="font-[var(--font-sans)] text-[1.4rem] tracking-[-0.03em] text-[var(--bb-white)]">
                {surface.title}
              </h3>
              <p className="mt-3 max-w-[62ch] font-[var(--font-sans)] text-[0.9rem] leading-relaxed text-[var(--bb-grey-1)]">
                {surface.description}
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                {surface.highlights.map((h) => (
                  <span
                    key={h}
                    className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.06em] px-2 py-1 border border-[var(--bb-line)] text-[var(--bb-grey-1)]"
                  >
                    {h}
                  </span>
                ))}
              </div>

              <div className="mt-7 pt-5 border-t border-[var(--bb-line-soft)]">
                <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)] mb-2.5">
                  Real endpoints behind this surface
                </div>
                <div className="space-y-1.5">
                  {surface.endpoints.map((e) => (
                    <div key={e} className="font-[var(--font-mono)] text-[0.64rem] text-[var(--bb-grey-2)]">
                      <span className="text-[var(--bb-grey-4)] mr-2">›</span>
                      {e}
                    </div>
                  ))}
                </div>
              </div>

              <Link
                href="/dashboard"
                className="mt-7 inline-flex items-center gap-2 h-[36px] px-4 border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-colors"
              >
                Open the console →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
