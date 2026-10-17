"use client";

import { Eyebrow } from "./ui/eyebrow";
import { IsoChip } from "./iso-stack";
import { ProblemChain, ShopFloor } from "./narrative-diagrams";

// Narrative sections, written plainly. No invented orders, no sample
// amounts. Architecture source: SELLABLE_ARCHITECTURE.md.

export function Problem() {
  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-[clamp(48px,7vw,112px)] items-start">
          <div>
            <Eyebrow label="The problem" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              An AI can find your store. It cannot buy from it.
            </h2>
            <p className="body-copy mt-6">
              Chat assistants already recommend products, and newer ones
              place orders. An order has to clear a chain of gates: stock,
              price, negotiation limits, spending approval, payment, and
              proof that it happened. Each gate needs an answer a machine
              can act on.
            </p>
            <p className="body-copy mt-4">
              A storefront built for clicks answers those questions on a
              page, for a person. An agent gets no catalog it can read, no
              quote it can accept, no consent step to pass, and no receipt
              to check. The purchase stalls right after the first step, and
              the merchant side never sees it happen.
            </p>
            <p className="body-copy mt-4">
              Merchants see the same gap from the other side. Opening
              prices, discounts, and payments to a bot with no limits is a
              risk nobody takes on purpose.
            </p>
            <p className="mt-8 border-l-2 border-[var(--bb-orange)] pl-5 font-[var(--font-sans)] text-[1.05rem] leading-relaxed text-[var(--bb-white)]">
              Sellable sits between the two. Agents get a clean way in, and
              your shop stays in charge.
            </p>
          </div>

          <ProblemChain />
        </div>
      </div>
    </section>
  );
}

const SELLER_POINTS = [
  "Reads what the shopper actually wants",
  "Searches your catalog, nothing else",
  "Builds quotes your policy allows",
  "Keeps counter-offers inside your floor and discount cap",
  "Suggests add-ons you already linked",
  "Walks the shopper through checkout",
];

const SERVICE_POINTS = [
  "Checks who the customer is first",
  "Looks up orders inside their permission",
  "Explains shipping and delivery status",
  "Opens cases for returns and exchanges",
  "Files refunds up to the limit you set",
  "Hands tricky cases to a human, with context",
];

export function TwoAgents() {
  return (
    <section className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="max-w-[720px]">
          <Eyebrow label="Two agents, one shop" />
          <h2 className="section-title mt-6 text-[var(--bb-white)]">
            One agent sells. The other looks after orders.
          </h2>
          <p className="body-copy mt-6">
            Sellable puts two agents on your staff. The Seller Agent runs
            the sales floor: discovery, quotes, checkout. The Customer
            Service Agent handles the order conversation: status, shipping,
            returns, refunds.
          </p>
          <p className="body-copy mt-4">
            Agents sent by shoppers are guests. They arrive through the
            gateway, prove who they are, and act only on the permission
            their customer granted. They never run inside your store.
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
              It proposes prices and bundles. Policy, consent, and the
              payment rail decide what goes through.
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
              It cannot refund beyond your authority or show one customer
              another&apos;s data. Sensitive cases go to a person.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <IsoChip label="You" detail="catalog, prices, and rules stay yours" />
          <IsoChip label="Outside agents" detail="connect as guests, prove who they are" />
          <IsoChip label="Customers" detail="buy directly or send an agent" />
        </div>

        <div className="mt-6 max-w-[760px] mx-auto">
          <ShopFloor />
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
