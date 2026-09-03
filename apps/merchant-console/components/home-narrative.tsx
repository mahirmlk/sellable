"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Eyebrow } from "./ui/eyebrow";
import { Reveal } from "./ui/reveal";
import { useInView } from "@/lib/use-in-view";

// Plain-language narrative sections for the landing page.
// Monochrome with functional orange accents, one-shot scroll reveals.

// ---------------------------------------------------------------------------
// 02 — PROBLEM
// ---------------------------------------------------------------------------
const BUY_STEPS = [
  "Find the right merchant",
  "Find the right product",
  "Check availability",
  "Get a price",
  "Negotiate",
  "Respect the buyer's budget",
  "Get authorization",
  "Pay",
  "Verify the payment",
];

export function Problem() {
  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-[clamp(48px,7vw,112px)]">
          <div>
            <Eyebrow label="02 — THE PROBLEM" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              AI can recommend. But can AI actually buy?
            </h2>
            <p className="body-copy mt-6">
              An AI assistant can recommend a product in seconds. But a real
              purchase is a chain of dependent steps — and most stores
              can&apos;t serve any of them to software.
            </p>
            <p className="body-copy mt-4">
              On the merchant&apos;s side it&apos;s worse: nobody can safely
              hand an AI unrestricted control over prices, discounts,
              inventory, orders, and payments.
            </p>
            <p className="mt-8 border-l-2 border-[var(--bb-white)] pl-5 font-[var(--font-sans)] text-[1.05rem] leading-relaxed text-[var(--bb-white)]">
              SELLABLE connects these two sides. It gives merchants an AI
              seller — and gives AI buyers a way to transact with real
              merchants.
            </p>
          </div>

          <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 sm:p-8 transition-transform duration-300 hover:-translate-y-1">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] mb-5">
              What a real purchase requires
            </div>
            <ol className="list-none m-0 p-0">
              {BUY_STEPS.map((s, i) => (
                <li
                  key={s}
                  className="flex items-center gap-4 py-2.5 border-b border-[var(--bb-line-soft)] last:border-b-0"
                >
                  <span
                    className="w-[5px] h-[5px] shrink-0 bg-[var(--bb-orange)] live-dot"
                    style={{ animationDelay: `${i * 0.28}s` }}
                    aria-hidden="true"
                  />
                  <span className="font-[var(--font-mono)] text-[0.62rem] text-[var(--bb-grey-4)] tabular-nums shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-[var(--font-sans)] text-[0.95rem] text-[var(--bb-grey-1)]">
                    {s}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 03 — TWO AGENTS
// ---------------------------------------------------------------------------
const SELLER_POINTS = [
  "Understands what a buyer wants",
  "Searches the real store catalog",
  "Recommends products and creates quotes",
  "Negotiates within merchant-defined limits",
  "Suggests relevant add-ons",
  "Guides the buyer toward checkout",
];

const BUYER_POINTS = [
  "Discovers stores",
  "Researches products",
  "Requests quotes",
  "Negotiates and compares options",
  "Requests authorization",
  "Purchases and verifies the result",
];

export function TwoAgents() {
  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="max-w-[720px]">
          <Eyebrow label="03 — TWO AGENTS" />
          <h2 className="section-title mt-6 text-[var(--bb-white)]">
            One platform. Two agents.
          </h2>
          <p className="mt-6 border-l-2 border-[var(--bb-white)] pl-5 font-[var(--font-sans)] text-[1.05rem] leading-relaxed text-[var(--bb-white)]">
            The Seller Agent represents the merchant. The Buyer Agent represents
            the customer.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 sm:p-8 transition-transform duration-300 hover:-translate-y-1">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
              Your AI Seller
            </div>
            <h3 className="mt-3 font-[var(--font-sans)] text-[1.5rem] tracking-[-0.03em] text-[var(--bb-white)]">
              Your AI sales representative.
            </h3>
            <ul className="mt-6 space-y-0 list-none m-0 p-0">
              {SELLER_POINTS.map((p) => (
                <li
                  key={p}
                  className="feature-line py-2 border-b border-[var(--bb-line-soft)] last:border-b-0"
                >
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-2)] leading-relaxed">
              It cannot override merchant rules or directly decide payment
              outcomes.
            </p>
          </div>

          <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 sm:p-8 transition-transform duration-300 hover:-translate-y-1">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
              The AI Buyer
            </div>
            <h3 className="mt-3 font-[var(--font-sans)] text-[1.5rem] tracking-[-0.03em] text-[var(--bb-white)]">
              An AI acting on behalf of a customer.
            </h3>
            <ul className="mt-6 space-y-0 list-none m-0 p-0">
              {BUYER_POINTS.map((p) => (
                <li
                  key={p}
                  className="feature-line py-2 border-b border-[var(--bb-line-soft)] last:border-b-0"
                >
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-2)] leading-relaxed">
              Humans buy through the same seller — chat checkout uses the same
              catalog, rules, and consent. The Seller Agent is the
              merchant&apos;s sales layer, not just a chatbot.
            </p>
          </div>
        </div>

        {/* Simple static flow */}
        <div className="mt-6 border border-[var(--bb-line)] bg-[var(--bb-panel)] px-6 py-8 sm:px-10">
          <div className="flex flex-col items-center text-center">
            {[
              ["CUSTOMER", null],
              ["AI BUYER", "“I need 10 chairs under ₹60,000”"],
              ["SELLABLE", null],
              ["AI SELLER", "“I can offer these within store rules”"],
              ["MERCHANT", null],
            ].map(([node, quote], i, arr) => (
              <div key={node as string} className="flex flex-col items-center">
                <div
                  className={`font-[var(--font-mono)] text-[0.7rem] tracking-[0.16em] px-4 py-2 border ${
                    node === "SELLABLE"
                      ? "bg-[var(--bb-white)] text-[var(--bb-black)] border-[var(--bb-white)] font-semibold"
                      : "text-[var(--bb-white)] border-[var(--bb-line)] bg-[var(--bb-panel-2)]"
                  }`}
                >
                  {node}
                </div>
                {quote && (
                  <div className="mt-2 font-[var(--font-sans)] text-[0.85rem] italic text-[var(--bb-grey-2)]">
                    {quote}
                  </div>
                )}
                {i < arr.length - 1 && (
                  <div
                    className="w-[2px] h-7 my-1 flow-connector"
                    style={{ animationDelay: `${i * 0.4}s` }}
                    aria-hidden="true"
                  />
                )}
              </div>
            ))}
          </div>
          <p className="mt-8 text-center font-[var(--font-sans)] text-[0.9rem] text-[var(--bb-grey-1)]">
            AI Buyer wants the best purchase. AI Seller wants the best sale.{" "}
            <span className="text-[var(--bb-white)]">
              SELLABLE makes the transaction safe and controllable.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// MERCHANT CONTROL (products, prices, floors, rules, approvals + catalog)
// ---------------------------------------------------------------------------
const CONTROLS = [
  ["Products", "what the store actually sells"],
  ["Prices", "normal selling prices"],
  ["Minimum prices", "how low the AI can negotiate"],
  ["Selling rules", "what the AI can and cannot do"],
  ["Approval limits", "when a human must approve a purchase"],
];

export function MerchantControl() {
  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-[clamp(48px,7vw,112px)] items-start">
          <div>
            <h2 className="section-title text-[var(--bb-white)]">
              You set the boundaries. Your AI sells within them.
            </h2>
            <p className="body-copy mt-6">
              SELLABLE lets the AI handle the conversation while you remain in
              control of the business rules.
            </p>
          </div>
          <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 sm:p-8 transition-transform duration-300 hover:-translate-y-1">
            {CONTROLS.map(([k, v]) => (
              <div
                key={k}
                className="flex items-baseline gap-4 py-3 border-b border-[var(--bb-line-soft)] last:border-b-0"
              >
                <span className="font-[var(--font-mono)] text-[0.62rem] tracking-[0.1em] uppercase text-[var(--bb-white)] w-[140px] shrink-0">
                  {k}
                </span>
                <span className="font-[var(--font-sans)] text-[0.88rem] text-[var(--bb-grey-1)]">
                  {v}
                </span>
              </div>
            ))}
            <p className="mt-6 font-[var(--font-sans)] text-[0.9rem] leading-relaxed text-[var(--bb-white)]">
              Your catalog is the source of truth — the AI Seller recommends,
              quotes, and negotiates from the products you actually stock. The
              AI does not invent products or prices.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 05 — MERCHANT VALUE
// ---------------------------------------------------------------------------
// Grounded in real mechanisms: each lever names the catalog field, policy
// rule, or endpoint behind it — nothing staged, everything replayable.
const INSIGHTS: Array<[string, string]> = [
  ["Upsell attach rate", "orders where the offered add-on was accepted"],
  ["Negotiation success", "haggling that ended in a paid order, not a walk-away"],
  ["Discount conceded", "how much margin each closed deal actually cost"],
  ["Walk-away reasons", "why lost deals died — price, stock, or budget"],
  ["Saved deals", "orders that exist only because the agent countered"],
];

export function MerchantValue() {
  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <Reveal>
          <div className="max-w-[720px]">
            <Eyebrow label="05 — MERCHANT VALUE" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              Turn AI conversations into revenue.
            </h2>
            <p className="body-copy mt-6">
              No staged numbers below. Each lever runs on data you already
              own — your catalog, your floors, your ledger — and every
              outcome links back to a transaction you can replay.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Reveal delay={80} className="h-full">
            <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 sm:p-8 h-full transition-transform duration-300 hover:-translate-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
                  Contextual upsells
                </div>
                <span className="font-[var(--font-mono)] text-[0.55rem] px-2 py-0.5 border border-[var(--bb-orange)]/40 text-[var(--bb-orange)]">
                  catalog.upsell_sku
                </span>
              </div>
              <h3 className="mt-3 font-[var(--font-sans)] text-[1.4rem] tracking-[-0.03em] text-[var(--bb-white)]">
                The add-on you linked, offered at the right moment
              </h3>
              <p className="mt-3 font-[var(--font-sans)] text-[0.88rem] leading-relaxed text-[var(--bb-grey-1)]">
                When you add a product, you link its natural add-on. The
                Seller Agent may offer that add-on — and only that add-on —
                when it fits the buyer&apos;s budget and category mandate. It
                cannot invent one.
              </p>
              <div className="mt-6 border border-[var(--bb-line-soft)] divide-y divide-[var(--bb-line-soft)] font-[var(--font-sans)] text-[0.9rem]">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-[var(--bb-grey-2)]">Buyer approves</span>
                  <span className="text-[var(--bb-grey-1)]">Laptop · ₹52,000</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-[var(--bb-grey-2)]">Agent offers, linked</span>
                  <span className="text-[var(--bb-grey-1)]">Sleeve · ₹1,299</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-[var(--bb-grey-2)]">Budget check</span>
                  <span className="font-[var(--font-mono)] text-[0.78rem] text-[var(--bb-grey-1)] tabular-nums">₹53,299 ≤ ₹55,000 — passes</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-[var(--bb-grey-2)]">Order becomes</span>
                  <span className="text-[var(--bb-white)] font-semibold tabular-nums">₹53,299</span>
                </div>
              </div>
              <p className="mt-4 font-[var(--font-sans)] text-[0.82rem] text-[var(--bb-grey-2)] leading-relaxed">
                +₹1,299 the buyer was already willing to spend — captured
                because the link was yours.
              </p>
            </div>
          </Reveal>

          <Reveal delay={160} className="h-full">
            <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 sm:p-8 h-full transition-transform duration-300 hover:-translate-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
                  Margin-protected negotiation
                </div>
                <span className="font-[var(--font-mono)] text-[0.55rem] px-2 py-0.5 border border-[var(--bb-orange)]/40 text-[var(--bb-orange)]">
                  POLICY.floor_price
                </span>
              </div>
              <h3 className="mt-3 font-[var(--font-sans)] text-[1.4rem] tracking-[-0.03em] text-[var(--bb-white)]">
                Concede a little to save the whole order
              </h3>
              <p className="mt-3 font-[var(--font-sans)] text-[0.88rem] leading-relaxed text-[var(--bb-grey-1)]">
                A buyer pushing for ₹4,500 on a ₹6,000 item walks away from a
                static store. Your agent counters inside your floor — and the
                floor itself never moves.
              </p>
              <div className="mt-6 border border-[var(--bb-line-soft)] divide-y divide-[var(--bb-line-soft)] font-[var(--font-mono)] text-[0.78rem] tabular-nums">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-[var(--bb-grey-2)]">List price</span>
                  <span className="text-[var(--bb-grey-1)]">₹6,000</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-[var(--bb-grey-2)]">Buyer offers</span>
                  <span className="text-[var(--bb-grey-1)]">₹4,500</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-[var(--bb-grey-2)]">Below floor — blocked</span>
                  <span className="text-[var(--bb-grey-4)]">no order created</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-[var(--bb-grey-2)]">Agent counters</span>
                  <span className="text-[var(--bb-grey-1)]">₹5,700</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-[var(--bb-grey-2)]">Deal closes</span>
                  <span className="text-[var(--bb-white)] font-semibold">₹5,400</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-[var(--bb-grey-2)]">Your floor, untouched</span>
                  <span className="text-[var(--bb-grey-1)]">₹5,000</span>
                </div>
              </div>
              <p className="mt-4 font-[var(--font-sans)] text-[0.82rem] text-[var(--bb-grey-2)] leading-relaxed">
                ₹600 conceded to save a ₹5,400 order. A walk-away would have
                earned ₹0.
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={120}>
          <div className="mt-6 border border-[var(--bb-line)] bg-[var(--bb-panel)] px-6 py-6 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
                Transaction insights
              </div>
              <span className="font-[var(--font-mono)] text-[0.55rem] px-2 py-0.5 border border-[var(--bb-orange)]/40 text-[var(--bb-orange)]">
                GET /console/insights
              </span>
            </div>
            <p className="font-[var(--font-sans)] text-[0.82rem] text-[var(--bb-grey-2)] mb-5">
              Computed from ledger events — never self-reported.
            </p>
            <div>
              {INSIGHTS.map(([term, def]) => (
                <div
                  key={term}
                  className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 py-2.5 border-b border-[var(--bb-line-soft)] last:border-b-0"
                >
                  <span className="font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-white)] sm:w-[190px] shrink-0">
                    {term}
                  </span>
                  <span className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-1)]">
                    {def}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={160}>
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between border border-[var(--bb-line)] px-6 py-5 sm:px-8">
            <p className="font-[var(--font-sans)] text-[0.9rem] text-[var(--bb-grey-1)]">
              Skeptical? Open Growth in the console — every metric expands
              into the transactions behind it.
            </p>
            <Link
              href="/dashboard/growth"
              className="inline-flex shrink-0 items-center gap-2 h-[36px] px-4 border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-colors"
            >
              Open Growth →
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 09 — LIVE STORY
// ---------------------------------------------------------------------------
// A story player, not a list: chapters auto-advance on a viewport-gated
// interval, segmented progress jumps on tap, hover pauses. The frame is
// fixed-size — only the story inside moves.
const STORY_MS = 2600;

const STORY: Array<{ actor: string; title: string; detail: string; meta: string }> = [
  {
    actor: "CUSTOMER",
    title: "\u201CI need 10 ergonomic chairs. Budget \u20B960,000.\u201D",
    detail:
      "A facilities manager tells her AI assistant what the office needs. No website visit, no search bar.",
    meta: "09:41 · mission started",
  },
  {
    actor: "AI BUYER",
    title: "Discovers your store and reads the real catalog.",
    detail:
      "Manifest, stock levels, prices, floors — machine-readable in a single fetch.",
    meta: "store found · 14 chairs in stock",
  },
  {
    actor: "AI SELLER",
    title: "Quotes AuraChair X at \u20B95,800 per chair.",
    detail:
      "Grounded in your catalog. \u20B958,000 total — inside the buyer's budget.",
    meta: "quote Q-2041 created",
  },
  {
    actor: "NEGOTIATION",
    title: "Buyer pushes \u20B95,200. Seller counters \u20B95,600.",
    detail:
      "Your \u20B95,400 floor holds the line. Neither side walks away.",
    meta: "floor protected",
  },
  {
    actor: "AI SELLER",
    title: "Adds felt floor protectors — \u20B9199 per chair.",
    detail:
      "Your linked add-on, inside budget. The buyer accepts.",
    meta: "+\u20B91,990 upsell",
  },
  {
    actor: "MERCHANT",
    title: "\u20B957,990 crosses your \u20B950,000 approval line.",
    detail:
      "You get one tap: approve. Until then, payment is technically impossible.",
    meta: "approved in 40 seconds",
  },
  {
    actor: "RAZORPAY",
    title: "Consent issued. Payment captured. Order PAID.",
    detail:
      "A signed webhook verifies it, and the full story lands in your ledger.",
    meta: "09:47 · settled",
  },
];

export function RealExample() {
  const { ref, isInView } = useInView();
  const [chapter, setChapter] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!isInView) return;
    const timer = window.setInterval(() => {
      if (pausedRef.current) return;
      setChapter((c) => (c + 1) % STORY.length);
    }, STORY_MS);
    return () => window.clearInterval(timer);
  }, [isInView]);

  const current = STORY[chapter];

  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative" ref={ref}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-[clamp(48px,7vw,112px)] items-center">
          <div>
            <Eyebrow label="09 — LIVE STORY" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              Watch a sale happen, start to finish.
            </h2>
            <p className="body-copy mt-6">
              You sell office furniture. Nobody visits your site — yet at
              09:47, ten chairs sell themselves:
            </p>
            <div className="mt-6 border border-[var(--bb-line)] bg-[var(--bb-panel)] p-5">
              <div className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] mb-3">
                Incoming message
              </div>
              <p className="font-[var(--font-sans)] text-[1.05rem] leading-relaxed text-[var(--bb-white)]">
                &ldquo;I need 10 ergonomic chairs for my office. My budget is
                &#8377;60,000.&rdquo;
              </p>
              <div className="mt-3 font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] text-[var(--bb-grey-4)]">
                customer &rarr; her AI assistant
              </div>
            </div>
            <p className="mt-8 font-[var(--font-sans)] text-[1rem] leading-relaxed text-[var(--bb-white)]">
              SELLABLE turns your store into an always-available AI sales
              channel.
            </p>
          </div>

          {/* Story player — fixed frame, story runs inside */}
          <div>
            <div
              className="border border-[#30302E] bg-[var(--bb-panel)] overflow-hidden"
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--bb-line)]">
                <div className="flex items-center gap-2.5">
                  <span className="w-[5px] h-[5px] rounded-full bg-[var(--bb-orange)] live-dot" />
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                    Live story · 10 chairs
                  </span>
                </div>
                <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] tabular-nums">
                  {chapter + 1}/{STORY.length}
                </span>
              </div>

              <div className="flex gap-1.5 px-5 pt-4">
                {STORY.map((s, i) => (
                  <button
                    key={s.actor + i}
                    onClick={() => setChapter(i)}
                    aria-label={`Go to chapter ${i + 1}: ${s.actor}`}
                    className={`h-[3px] flex-1 border-0 p-0 cursor-pointer transition-colors duration-300 ${
                      i <= chapter ? "bg-[var(--bb-orange)]" : "bg-[var(--bb-line)]"
                    }`}
                  />
                ))}
              </div>

              <div className="px-5 sm:px-7 py-6 min-h-[280px] sm:min-h-[240px]">
                <div key={chapter} className="tab-in">
                  <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-orange)]">
                    {current.actor}
                  </div>
                  <h3 className="mt-3 font-[var(--font-sans)] text-[1.4rem] leading-snug tracking-[-0.02em] text-[var(--bb-white)]">
                    {current.title}
                  </h3>
                  <p className="mt-3 font-[var(--font-sans)] text-[0.92rem] leading-relaxed text-[var(--bb-grey-1)]">
                    {current.detail}
                  </p>
                </div>
              </div>

              <div className="px-5 py-3 border-t border-[var(--bb-line)] flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.06em] text-[var(--bb-grey-2)]">
                  {current.meta}
                </span>
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] text-[var(--bb-grey-4)]">
                  {paused ? "PAUSED" : "PLAYING"}
                </span>
              </div>
            </div>
            <div className="mt-3 font-[var(--font-mono)] text-[0.52rem] tracking-[0.06em] text-[var(--bb-grey-4)]">
              HOVER TO PAUSE · TAP A SEGMENT TO JUMP — the same shape as every real order in your ledger.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
