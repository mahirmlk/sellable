"use client";

import { useInView } from "@/lib/use-in-view";
import { Eyebrow } from "./ui/eyebrow";

const steps = [
  {
    number: "01",
    title: "DISCOVER",
    agent: "BUYER AGENT",
    description:
      "AI buyer discovers the merchant via /.well-known/agents.json manifest and reads the machine-readable catalog.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="11" stroke="var(--bb-grey-3)" strokeWidth="1" />
        <circle cx="16" cy="16" r="4" fill="var(--bb-orange)" />
        <line x1="16" y1="1" x2="16" y2="5" stroke="var(--bb-grey-4)" strokeWidth="1" />
        <line x1="16" y1="27" x2="16" y2="31" stroke="var(--bb-grey-4)" strokeWidth="1" />
        <line x1="1" y1="16" x2="5" y2="16" stroke="var(--bb-grey-4)" strokeWidth="1" />
        <line x1="27" y1="16" x2="31" y2="16" stroke="var(--bb-grey-4)" strokeWidth="1" />
      </svg>
    ),
  },
  {
    number: "02",
    title: "NEGOTIATE",
    agent: "SELLER AGENT",
    description:
      "Seller agent proposes quotes within merchant policy. Bounded counter-offers protect floor prices and margins.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="2" y="8" width="12" height="16" rx="2" stroke="var(--bb-grey-3)" strokeWidth="1" />
        <rect x="18" y="8" width="12" height="16" rx="2" stroke="var(--bb-grey-3)" strokeWidth="1" />
        <path d="M14 16h4" stroke="var(--bb-orange)" strokeWidth="1" strokeDasharray="2 2" />
        <circle cx="16" cy="16" r="2" fill="var(--bb-orange)" />
      </svg>
    ),
  },
  {
    number: "03",
    title: "CONSENT",
    agent: "CONSENT SERVICE",
    description:
      "Single-use, time-bound, amount-bound consent token issued. No payment proceeds without explicit authorization.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="6" y="4" width="20" height="24" rx="2" stroke="var(--bb-grey-3)" strokeWidth="1" />
        <path d="M11 16l3 3 7-7" stroke="var(--bb-orange)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    number: "04",
    title: "PAY",
    agent: "PAYMENT RAIL",
    description:
      "Razorpay test-mode order created, payment captured, webhook verified. Full audit trail recorded in XAI ledger.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="12" stroke="var(--bb-grey-3)" strokeWidth="1" />
        <path d="M16 8v16M12 12h8M12 20h8" stroke="var(--bb-orange)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function HowItWorks() {
  const { ref, isInView } = useInView();

  return (
    <section id="how-it-works" className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame" ref={ref}>
        <div className="text-center mb-16">
          <Eyebrow label="TRANSACTION LIFECYCLE" />
          <h2
            className={`section-title mt-6 text-[var(--bb-white)] transition-all duration-700 ${
              isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            How a purchase flows through SELLABLE
          </h2>
          <p
            className={`body-copy mt-6 mx-auto transition-all duration-700 delay-100 ${
              isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            Every step is policy-gated, consent-authorized, and audit-logged.
            The LLM proposes; deterministic systems dispose.
          </p>
        </div>

        {/* Flow line */}
        <div className="relative">
          {/* Vertical connector line (desktop) */}
          <div className="hidden lg:block absolute left-[50%] top-0 bottom-0 w-px bg-[var(--bb-line)]" />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-x-[clamp(48px,6vw,96px)] lg:gap-y-16">
            {steps.map((step, i) => (
              <div
                key={step.number}
                className={`relative transition-all duration-700 ${
                  isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                }`}
                style={{ transitionDelay: `${i * 150}ms` }}
              >
                {/* Desktop: alternate sides */}
                <div
                  className={`${
                    i % 2 === 0
                      ? "lg:col-start-1 lg:pr-16 lg:text-right"
                      : "lg:col-start-2 lg:pl-16"
                  }`}
                >
                  {/* Node dot on the line (desktop) */}
                  <div
                    className={`hidden lg:block absolute top-6 w-3 h-3 border border-[var(--bb-orange)] bg-[var(--bb-black)] ${
                      i % 2 === 0
                        ? "right-[-7px] translate-x-[calc(50%+3.5px)]"
                        : "left-[-7px] -translate-x-[calc(50%+3.5px)]"
                    }`}
                  />

                  <div className="flex items-start gap-4 lg:justify-end">
                    {i % 2 !== 0 && (
                      <div className="flex-shrink-0 mt-1">{step.icon}</div>
                    )}
                    <div>
                      <div className="flex items-center gap-3 lg:justify-end mb-2">
                        <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] text-[var(--bb-orange)]">
                          STEP {step.number}
                        </span>
                        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] text-[var(--bb-grey-4)]">
                          {step.agent}
                        </span>
                      </div>
                      <h3 className="font-[var(--font-sans)] text-[1.6rem] tracking-[-0.04em] text-[var(--bb-white)] mb-2">
                        {step.title}
                      </h3>
                      <p className="font-[var(--font-sans)] text-[0.95rem] text-[var(--bb-grey-1)] leading-relaxed max-w-[400px]">
                        {step.description}
                      </p>
                    </div>
                    {i % 2 === 0 && (
                      <div className="flex-shrink-0 mt-1">{step.icon}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
