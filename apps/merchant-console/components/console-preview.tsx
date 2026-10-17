"use client";

import Link from "next/link";
import { Eyebrow } from "./ui/eyebrow";

// The console window, drawn from the real app. Nav groups and page names
// come from components/dashboard/nav-config.ts, the feed uses the ledger's
// own event names, and every endpoint in the status bar is live.
// No sample orders, no amounts.

const NAV = [
  { group: null, items: ["Home"] },
  { group: "Store", items: ["Products", "Inventory", "Orders", "Buyers"] },
  {
    group: "Sales",
    items: ["AI Sales", "Support", "AI Storefront", "Selling Rules", "Approvals"],
  },
  { group: "Analyze", items: ["Analytics", "Live Activity", "Evaluations"] },
  {
    group: "System",
    items: ["Payments", "Operations", "Connectors", "Developers", "Settings"],
  },
];

const FEED = [
  { action: "catalog.search", actor: "buyer agent" },
  { action: "quote.created", actor: "seller agent" },
  { action: "policy.checked", actor: "policy engine · allow" },
  { action: "order.created", actor: "commerce core · awaiting consent" },
  { action: "consent.issued", actor: "consent service · single use" },
  { action: "consent.used", actor: "consent service" },
  { action: "payment.pending", actor: "razorpay · payment link" },
  { action: "order.paid", actor: "razorpay · webhook verified" },
];

const HIGHLIGHTS = [
  {
    nav: "Approvals",
    line: "Orders over your line wait here. Payment stays impossible until you decide.",
  },
  {
    nav: "Orders",
    line: "Open any order down to its ledger lines: quotes, policy checks, consent, payment.",
  },
  {
    nav: "AI Sales",
    line: "Talk to your Seller Agent the way a buyer's agent would, and watch each step land in the ledger.",
  },
  {
    nav: "Support",
    line: "The Service Agent answers order questions, opens returns and exchanges, and files refund requests.",
  },
  {
    nav: "Selling Rules",
    line: "Order caps, discount cap, categories, rounds, and the approval line, edited right here.",
  },
  {
    nav: "Live Activity",
    line: "The ledger streaming as events land, filtered by actor or event type.",
  },
];

export function ConsolePreview() {
  return (
    <section id="console" className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-[clamp(48px,7vw,112px)] items-center">
          <div>
            <Eyebrow label="Merchant console" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              Run the shop from one place
            </h2>
            <p className="body-copy mt-6">
              Orders, approvals, rules, and the ledger live in one console.
              Every number traces back to a real transaction, and every
              transaction opens up line by line.
            </p>

            <div className="mt-8 border-y border-[var(--bb-line-soft)] divide-y divide-[var(--bb-line-soft)]">
              {HIGHLIGHTS.map((h) => (
                <div key={h.nav} className="py-3.5 flex items-baseline gap-4">
                  <span className="w-[132px] shrink-0 font-[var(--font-mono)] text-[0.56rem] tracking-[0.12em] uppercase text-[var(--bb-orange)]">
                    {h.nav}
                  </span>
                  <span className="font-[var(--font-sans)] text-[0.88rem] leading-relaxed text-[var(--bb-grey-1)]">
                    {h.line}
                  </span>
                </div>
              ))}
            </div>

            <Link
              href="/dashboard"
              className="mt-7 inline-flex items-center gap-2 h-[36px] px-4 border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-colors"
            >
              Open the console →
            </Link>
          </div>

          {/* Console window */}
          <div className="relative border border-[#30302E] bg-[var(--bb-panel)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--bb-line)] bg-[var(--bb-panel-2)]">
              <div className="flex items-center gap-2.5">
                <span className="w-[5px] h-[5px] rounded-full bg-[var(--bb-orange)] live-dot" />
                <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                  Sellable console
                </span>
              </div>
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.08em] text-[var(--bb-grey-4)]">
                scoped to your store
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[170px_1fr]">
              {/* Sidebar */}
              <div className="hidden md:block border-r border-[var(--bb-line)] py-3">
                {NAV.map((section) => (
                  <div key={section.group ?? "home"} className={section.group ? "mt-2.5" : ""}>
                    {section.group && (
                      <div className="px-4 pb-1 font-[var(--font-mono)] text-[0.46rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)]">
                        {section.group}
                      </div>
                    )}
                    {section.items.map((item) => (
                      <div
                        key={item}
                        className={`flex items-center gap-2 px-4 py-[3.5px] font-[var(--font-mono)] text-[0.56rem] ${
                          item === "Home"
                            ? "text-[var(--bb-white)]"
                            : "text-[var(--bb-grey-3)]"
                        }`}
                      >
                        {item === "Home" && (
                          <span className="w-[3px] h-[3px] bg-[var(--bb-orange)]" />
                        )}
                        {item}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Main panel */}
              <div className="p-4">
                <div className="border border-[var(--bb-line-soft)]">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--bb-line-soft)]">
                    <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-[var(--bb-grey-2)]">
                      Live activity
                    </span>
                    <span className="font-[var(--font-mono)] text-[0.46rem] tracking-[0.06em] text-[var(--bb-grey-4)]">
                      ledger stream
                    </span>
                  </div>
                  <div className="px-3 py-2">
                    {FEED.map((f) => (
                      <div
                        key={f.action}
                        className="flex items-baseline gap-2 py-[3px] font-[var(--font-mono)] text-[0.55rem]"
                      >
                        <span className="text-[var(--bb-grey-4)]">›</span>
                        <span className="text-[var(--bb-white)]">{f.action}</span>
                        <span className="ml-auto text-right text-[var(--bb-grey-4)]">
                          {f.actor}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 border border-[var(--bb-orange)]/30 bg-[var(--bb-orange)]/[0.05] px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.14em] uppercase text-[var(--bb-orange)]">
                      Approvals
                    </span>
                    <div className="flex gap-1.5">
                      <span className="px-2 py-[3px] border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.46rem] uppercase tracking-[0.06em] text-[var(--bb-grey-1)]">
                        Reject
                      </span>
                      <span className="px-2 py-[3px] border border-[var(--bb-orange)] font-[var(--font-mono)] text-[0.46rem] uppercase tracking-[0.06em] text-[var(--bb-orange)]">
                        Approve
                      </span>
                    </div>
                  </div>
                  <p className="mt-1.5 font-[var(--font-sans)] text-[0.74rem] leading-relaxed text-[var(--bb-grey-1)]">
                    Orders over your approval line wait here. Payment stays
                    impossible until you decide.
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-0.5 font-[var(--font-mono)] text-[0.48rem] tracking-[0.06em] uppercase text-[var(--bb-grey-3)]">
                  {["Webhooks · signature verified", "Consent · single use", "Keys · hashed"].map(
                    (s) => (
                      <span key={s} className="inline-flex items-center gap-1.5">
                        <span className="w-[4px] h-[4px] bg-[var(--bb-orange)]" />
                        {s}
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-5 px-4 py-2 border-t border-[var(--bb-line)] font-[var(--font-mono)] text-[0.46rem] tracking-[0.04em] text-[var(--bb-grey-4)] overflow-hidden whitespace-nowrap">
              <span>GET /console/insights</span>
              <span>GET /activity/stream</span>
              <span>GET /console/approvals</span>
              <span>GET /console/transactions</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
