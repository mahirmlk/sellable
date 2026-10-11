"use client";

// Ledger event path, no mock orders. Names only, in the order the
// platform records them. Zero JS, transform-only marquee.
const ITEMS = [
  "catalog.search",
  "quote.created",
  "negotiation.countered",
  "policy.checked",
  "consent.issued",
  "order.created",
  "webhook.reconciled",
  "order.paid",
];

function Row({ hidden }: { hidden?: boolean }) {
  return (
    <div aria-hidden={hidden || undefined} className="flex shrink-0 items-center">
      {ITEMS.map((action) => (
        <span key={action} className="flex items-center shrink-0">
          <span className="font-[var(--font-mono)] text-[0.62rem] tracking-[0.06em] text-[var(--bb-grey-1)]">
            {action}
          </span>
          <span className="w-[5px] h-[5px] bg-[var(--bb-orange)] mx-8 shrink-0" />
        </span>
      ))}
    </div>
  );
}

export function EventTicker() {
  return (
    <div className="marquee technical-section border-y border-[var(--bb-line)] overflow-hidden">
      <div className="py-3.5 overflow-hidden">
        <div className="marquee-track flex w-max">
          <Row />
          <Row hidden />
        </div>
      </div>
    </div>
  );
}
