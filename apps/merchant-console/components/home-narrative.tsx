"use client";

import { Eyebrow } from "./ui/eyebrow";
import { IsoChip } from "./iso-stack";

// Narrative sections, written plainly. No invented orders, no sample
// amounts. Architecture source: SELLABLE_ARCHITECTURE.md.

const BUY_STEPS = [
  "Find the right merchant",
  "Find the right product",
  "Check availability",
  "Get a price you can trust",
  "Negotiate inside the rules",
  "Get permission to pay",
  "Pay",
  "Prove the payment happened",
];

export function Problem() {
  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-[clamp(48px,7vw,112px)]">
          <div>
            <Eyebrow label="The problem" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              AI can suggest. Buying is harder.
            </h2>
            <p className="body-copy mt-6">
              A recommendation is one reply. A purchase is a chain: find the
              store, check stock, settle on a price, get permission, pay, and
              prove it later. Most storefronts were built for clicks, so
              agents cannot get past the first step.
            </p>
            <p className="body-copy mt-4">
              Merchants feel the other side of it. Nobody wants to hand an
              AI open access to prices, discounts, and payments.
            </p>
            <p className="mt-8 border-l-2 border-[var(--bb-orange)] pl-5 font-[var(--font-sans)] text-[1.05rem] leading-relaxed text-[var(--bb-white)]">
              Sellable sits between the two. Your shop stays in charge, and
              agents get a clean way to buy from it.
            </p>
          </div>

          <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 sm:p-8">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] mb-5">
              What a real purchase takes
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

const SELLER_POINTS = [
  "Reads what the buyer actually wants",
  "Searches your catalog, nothing else",
  "Builds quotes your policy allows",
  "Counters inside your floor and discount cap",
  "Suggests add-ons you already linked",
  "Walks the buyer to checkout",
];

const SERVICE_POINTS = [
  "Checks who the customer is first",
  "Looks up orders inside their permission",
  "Explains shipping and delivery status",
  "Opens cases for returns and refunds",
  "Requests refunds inside your authority",
  "Hands tricky cases to a human, with context",
];

export function TwoAgents() {
  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="max-w-[720px]">
          <Eyebrow label="Two agents, one shop" />
          <h2 className="section-title mt-6 text-[var(--bb-white)]">
            Selling and support, covered.
          </h2>
          <p className="body-copy mt-6">
            Sellable runs two agents for your store. Shopping agents from
            outside connect through the gateway as guests. They never run
            inside your shop.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 sm:p-8">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
              Seller Agent
            </div>
            <h3 className="mt-3 font-[var(--font-sans)] text-[1.5rem] tracking-[-0.03em] text-[var(--bb-white)]">
              The one that sells.
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
              It proposes prices and bundles. Policy, consent, and the payment
              rail decide what actually happens.
            </p>
          </div>

          <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 sm:p-8">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
              Customer Service Agent
            </div>
            <h3 className="mt-3 font-[var(--font-sans)] text-[1.5rem] tracking-[-0.03em] text-[var(--bb-white)]">
              The one that looks after orders.
            </h3>
            <ul className="mt-6 space-y-0 list-none m-0 p-0">
              {SERVICE_POINTS.map((p) => (
                <li
                  key={p}
                  className="feature-line py-2 border-b border-[var(--bb-line-soft)] last:border-b-0"
                >
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-2)] leading-relaxed">
              It cannot refund beyond your authority or share another
              customer&apos;s data. Anything sensitive goes to a person.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <IsoChip label="You" detail="catalog, prices, and rules stay yours" />
          <IsoChip label="Outside agents" detail="connect as guests, prove who they are" />
          <IsoChip label="Customers" detail="buy directly or send an agent" />
        </div>

        <div className="mt-6 border border-[var(--bb-line)] bg-[var(--bb-panel)] px-6 py-8 sm:px-10">
          <div className="flex flex-col items-center text-center">
            {[
              ["CUSTOMER", null],
              ["SHOPPING AGENT", "asks on the customer's behalf"],
              ["SELLABLE GATEWAY", "checks identity and permission"],
              ["SELLER AGENT", "quotes inside store rules"],
              ["YOUR STORE", "policy, consent, payment, ledger"],
            ].map(([node, quote], i, arr) => (
              <div key={node as string} className="flex flex-col items-center">
                <div
                  className={`font-[var(--font-mono)] text-[0.7rem] tracking-[0.16em] px-4 py-2 border ${
                    node === "SELLABLE GATEWAY"
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
            The shopping agent pushes for its customer. Your agents hold the
            line.{" "}
            <span className="text-[var(--bb-white)]">
              The ledger keeps the receipt.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

const CONTROLS = [
  ["Products", "what the store actually sells"],
  ["Prices", "your normal selling prices"],
  ["Floors", "the lowest the agent may go"],
  ["Selling rules", "what the agent may touch"],
  ["Approvals", "when a person must sign off"],
];

export function MerchantControl() {
  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-[clamp(48px,7vw,112px)] items-start">
          <div>
            <Eyebrow label="Merchant control" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              You set the limits. The agents stay inside them.
            </h2>
            <p className="body-copy mt-6">
              The agents handle the back-and-forth. You keep the decisions
              that affect margin and risk.
            </p>
          </div>
          <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 sm:p-8">
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
              Your catalog is the only source the agents can quote from. A
              product that is not in stock cannot be sold.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
