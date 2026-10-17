"use client";

import { Eyebrow } from "./ui/eyebrow";
import { Reveal } from "./ui/reveal";

// The canonical order path, compressed from the architecture's flow. Each
// step names the system that owns it. No sample carts, no amounts.

const steps = [
  {
    number: "01",
    title: "Discover",
    owner: "Agent gateway",
    description:
      "A shopping agent finds your store through the gateway and reads the public catalog files instead of scraping pages.",
  },
  {
    number: "02",
    title: "Quote",
    owner: "Seller agent",
    description:
      "The Seller Agent builds a quote from your live catalog. Policy checks it before it goes out: category, stock, floor, discount cap.",
  },
  {
    number: "03",
    title: "Negotiate",
    owner: "Seller agent · bounded by policy",
    description:
      "Counter-offers stop at the bounds you set and your round limit ends the haggling. The agent picks the words; the limits do not move.",
  },
  {
    number: "04",
    title: "Authorize",
    owner: "Policy engine · then you",
    description:
      "Policy answers allow, deny, or hold. Orders over your approval line wait in the queue, and rejecting one cancels its payment link.",
  },
  {
    number: "05",
    title: "Pay",
    owner: "Consent token · Razorpay",
    description:
      "A single-use consent token binds the amount and the payee to the order. Razorpay takes the payment, and only a signed webhook settles it.",
  },
  {
    number: "06",
    title: "Support",
    owner: "Service agent",
    description:
      "The Service Agent answers order questions, starts returns and exchanges, and files refund requests. Anything past your authority comes to you.",
  },
];

const glyphClass = "w-[18px] h-[18px]";

const glyphs = [
  <svg
    key="discover"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="square"
    className={glyphClass}
    aria-hidden="true"
  >
    <path d="M6 3h7l5 5v13H6z" />
    <path d="M13 3v5h5" />
  </svg>,
  <svg
    key="quote"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="square"
    className={glyphClass}
    aria-hidden="true"
  >
    <path d="M3 11V3h8l10 10-8 8z" />
    <circle cx="7.5" cy="7.5" r="1.5" />
  </svg>,
  <svg
    key="negotiate"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="square"
    className={glyphClass}
    aria-hidden="true"
  >
    <path d="M4 8h14" />
    <path d="M15 5l3 3-3 3" />
    <path d="M20 16H6" />
    <path d="M9 13l-3 3 3 3" />
  </svg>,
  <svg
    key="authorize"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="square"
    className={glyphClass}
    aria-hidden="true"
  >
    <rect x="3" y="8" width="18" height="8" rx="4" />
    <circle cx="15" cy="12" r="2.5" />
  </svg>,
  <svg
    key="pay"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="square"
    className={glyphClass}
    aria-hidden="true"
  >
    <rect x="5" y="10.5" width="14" height="9" rx="1" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>,
  <svg
    key="support"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="square"
    className={glyphClass}
    aria-hidden="true"
  >
    <path d="M4 4h16v11H10l-6 5z" />
  </svg>,
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="max-w-[720px]">
          <Eyebrow label="How it works" />
          <h2 className="section-title mt-6 text-[var(--bb-white)]">
            From first ask to settled order
          </h2>
          <p className="body-copy mt-6">
            From a shopper&apos;s first request to a settled order, six steps.
            Each belongs to a named system, and each one lands in the ledger.
          </p>
        </div>

        <div className="mt-12 border-t border-[var(--bb-line)]">
          {steps.map((step, i) => (
            <Reveal key={step.number} delay={Math.min(i, 5) * 70} y={14}>
              <div className="group grid grid-cols-[44px_1fr] sm:grid-cols-[44px_220px_1fr] gap-x-6 gap-y-3 items-start py-7 border-b border-[var(--bb-line-soft)] transition-colors duration-300 hover:bg-[var(--bb-panel)]">
                <div className="w-[40px] h-[40px] border border-[var(--bb-line)] bg-[var(--bb-black)] flex items-center justify-center text-[var(--bb-grey-2)] transition-colors duration-300 group-hover:border-[var(--bb-orange)] group-hover:text-[var(--bb-orange)]">
                  {glyphs[i]}
                </div>
                <div>
                  <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] text-[var(--bb-orange)] tabular-nums">
                    {step.number}
                  </div>
                  <h3 className="mt-1.5 font-[var(--font-sans)] text-[1.35rem] tracking-[-0.03em] text-[var(--bb-white)]">
                    {step.title}
                  </h3>
                </div>
                <div className="col-start-2 sm:col-start-auto">
                  <p className="font-[var(--font-sans)] text-[0.95rem] text-[var(--bb-grey-1)] leading-relaxed max-w-[62ch]">
                    {step.description}
                  </p>
                  <span className="mt-3 inline-flex items-center gap-2 border border-[var(--bb-line-soft)] px-2.5 py-1 font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)]">
                    <span className="w-[4px] h-[4px] bg-[var(--bb-orange)]" />
                    {step.owner}
                  </span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
