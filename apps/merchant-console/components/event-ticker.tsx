"use client";

// Thin seamless ledger-event marquee. One transform-only CSS loop over a
// duplicated track — zero JS, zero repaints, pauses on hover.
const ITEMS: Array<[string, string]> = [
  ["catalog.search", "3 products indexed"],
  ["quote.created", "₹1,948 · grounded"],
  ["negotiation.countered", "floor protected"],
  ["policy.checked", "ALLOW"],
  ["consent.issued", "single-use"],
  ["webhook.reconciled", "signature verified"],
  ["order.paid", "settled"],
];

function Row({ hidden }: { hidden?: boolean }) {
  return (
    <div
      aria-hidden={hidden || undefined}
      className="flex shrink-0 items-center"
    >
      {ITEMS.map(([action, detail]) => (
        <span key={action} className="flex items-center shrink-0">
          <span className="font-[var(--font-mono)] text-[0.62rem] tracking-[0.06em] text-[var(--bb-grey-1)]">
            {action}
          </span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-4)] ml-2">
            {detail}
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
