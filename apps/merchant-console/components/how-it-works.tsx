"use client";

import { Eyebrow } from "./ui/eyebrow";
import { Reveal } from "./ui/reveal";

// Canonical order path, compressed from the architecture's transaction
// flow. No sample carts, no amounts. Each step names the system that
// owns it.
const steps = [
  {
    number: "01",
    title: "Discover",
    description:
      "A shopping agent finds your store through the gateway and reads the public catalog files. No scraping, no guessing.",
  },
  {
    number: "02",
    title: "Quote",
    description:
      "The Seller Agent builds a quote from your catalog and checks it against policy: category, stock, floor, and discount cap.",
  },
  {
    number: "03",
    title: "Negotiate",
    description:
      "Counter-offers stay inside your floor and round limit. The agent can phrase the reply, but it cannot move the limits.",
  },
  {
    number: "04",
    title: "Authorize",
    description:
      "Policy returns allow, deny, or needs a human. Larger orders wait in the approvals queue until you sign off.",
  },
  {
    number: "05",
    title: "Pay",
    description:
      "A single-use consent token binds the exact amount and payee. Razorpay takes the payment and a signed webhook settles the order.",
  },
  {
    number: "06",
    title: "Support",
    description:
      "The Service Agent handles order questions, returns, and refunds inside your authority, and escalates the rest with full context.",
  },
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
            Six steps. Policy checks the cart, consent locks the payment, and
            the ledger writes down each move.
          </p>
        </div>

        <div className="mt-12 border-t border-[var(--bb-line)] relative">
          <div aria-hidden="true" className="flow-rail absolute left-[5px] top-10 bottom-10 w-[2px] hidden sm:block" />
          {steps.map((step, i) => (
            <Reveal key={step.number} delay={Math.min(i, 5) * 70} y={14}>
              <div className="group grid grid-cols-1 sm:grid-cols-[88px_220px_1fr] gap-2 sm:gap-6 items-baseline py-6 border-b border-[var(--bb-line-soft)] transition-colors duration-300 hover:bg-[var(--bb-panel)]">
                <span className="relative font-[var(--font-mono)] text-[0.7rem] tracking-[0.12em] text-[var(--bb-orange)] tabular-nums sm:pl-8">
                  <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 hidden sm:block w-[11px] h-[11px] border border-[var(--bb-orange)] bg-[var(--bb-black)]">
                    <span className="absolute inset-[3px] bg-[var(--bb-orange)]" />
                  </span>
                  {step.number}
                </span>
                <h3 className="font-[var(--font-sans)] text-[1.35rem] tracking-[-0.03em] text-[var(--bb-white)]">
                  {step.title}
                </h3>
                <p className="font-[var(--font-sans)] text-[0.95rem] text-[var(--bb-grey-1)] leading-relaxed max-w-[62ch]">
                  {step.description}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
