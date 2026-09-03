"use client";

import { Eyebrow } from "./ui/eyebrow";
import { Reveal } from "./ui/reveal";

// Plain-language commerce flow — static numbered rows, no scroll
// animations or flowing lights.
const steps = [
  {
    number: "01",
    title: "Discover",
    description:
      "An AI buyer finds your store. Your store exposes information that AI agents can understand — no HTML rendering required.",
  },
  {
    number: "02",
    title: "Understand",
    description:
      "The AI Seller understands what the buyer needs and searches your real products — never invented ones.",
  },
  {
    number: "03",
    title: "Negotiate",
    description:
      "The agents can negotiate. The Seller Agent may offer a better price, but it can never go below the minimum you set.",
  },
  {
    number: "04",
    title: "Recommend",
    description:
      "The Seller Agent suggests useful add-ons — a laptop plus a compatible sleeve — within price, category, and budget.",
  },
  {
    number: "05",
    title: "Protect",
    description:
      "Rules and authorization control the transaction. High-value purchases can require human approval, and payment needs explicit consent.",
  },
  {
    number: "06",
    title: "Pay & verify",
    description:
      "Razorpay processes the payment and a signed webhook confirms the result. The full transaction can then be replayed.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative">
        <div className="max-w-[720px]">
          <Eyebrow label="04 — HOW IT WORKS" />
          <h2 className="section-title mt-6 text-[var(--bb-white)]">
            From “I need something” to a completed purchase
          </h2>
          <p className="body-copy mt-6">
            Six steps. Every one is checked against your rules, authorized by
            consent, and written to the ledger.
          </p>
        </div>

        <div className="mt-12 border-t border-[var(--bb-line)] relative">
          {/* animated dashed rail — 2px strip, background-position loop */}
          <div aria-hidden="true" className="flow-rail absolute left-[5px] top-10 bottom-10 w-[2px] hidden sm:block" />
          {steps.map((step, i) => (
            <Reveal key={step.number} delay={Math.min(i, 5) * 70} y={14}>
            <div
              className="group grid grid-cols-1 sm:grid-cols-[88px_220px_1fr] gap-2 sm:gap-6 items-baseline py-6 border-b border-[var(--bb-line-soft)] transition-colors duration-300 hover:bg-[var(--bb-panel)]"
            >
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
