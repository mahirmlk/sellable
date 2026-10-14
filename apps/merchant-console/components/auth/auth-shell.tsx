import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";

// Access experience in the marketing site's own visual language: near-black
// canvas, mono eyebrow labels, orange primary actions. Sign-in, sign-up,
// and recovery share this shell so entry feels like one product.
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen relative flex flex-col bg-[var(--bb-black)] text-[var(--bb-white)] overflow-hidden">
      {/* faint static grid, masked — no motion on auth pages */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(70% 60% at 50% 30%, black 20%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(70% 60% at 50% 30%, black 20%, transparent 100%)",
        }}
      />

      <header className="relative page-frame h-[68px] flex items-center justify-between shrink-0">
        <Link href="/" aria-label="SELLABLE home">
          <Image
            src="/sellable-logo.png"
            alt="SELLABLE"
            width={160}
            height={36}
            className="h-[26px] w-auto"
            priority
          />
        </Link>
        <Link
          href="/"
          className="font-[var(--font-mono)] text-[0.66rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)] hover:text-[var(--bb-white)] transition-colors"
        >
          Back to home
        </Link>
      </header>

      <main className="relative flex-1 flex items-start sm:items-center justify-center px-5 pb-16 pt-6">
        <div className="w-full max-w-[460px] space-y-5">
          <div>
            <Eyebrow label={eyebrow} />
            <h1 className="mt-5 text-[clamp(1.7rem,5vw,2.3rem)] leading-[1.05] font-semibold tracking-[-0.02em] text-[var(--bb-white)]">
              {title}
            </h1>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--bb-grey-1)]">
              {subtitle}
            </p>
          </div>

          <div className="bg-[var(--bb-panel)] border border-[var(--bb-line)] p-6 sm:p-7">
            {children}
          </div>

          <DemoPanel />
        </div>
      </main>
    </div>
  );
}

// Demo Mode gets its own look on purpose: an orange-stamped panel that
// reads as a separate place, not a second login button. Same panel on
// every access page.
export function DemoPanel() {
  const perks = [
    "A home-goods store with 8 products and 6 orders already inside",
    "Test payments that never move money",
    "The full console, same pages as the real thing",
  ];
  return (
    <section
      aria-label="Demo mode"
      className="border border-dashed border-[var(--bb-orange)] bg-[var(--bb-orange-wash-2)] p-6"
    >
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="block w-2.5 h-2.5 bg-[var(--bb-orange)]" />
        <span className="font-[var(--font-mono)] text-[0.66rem] tracking-[0.16em] uppercase text-[var(--bb-orange)]">
          Demo mode
        </span>
      </div>
      <h2 className="mt-3 text-[1.15rem] font-semibold tracking-[-0.01em] text-[var(--bb-white)]">
        Look around first, no account needed
      </h2>
      <p className="mt-2 text-[0.88rem] leading-relaxed text-[var(--bb-grey-1)]">
        Everything you change here stays in this browser. Real merchant data
        is never touched, and you can reset the demo whenever you want.
      </p>
      <ul className="mt-4 space-y-2">
        {perks.map((perk) => (
          <li key={perk} className="flex items-start gap-2.5 text-[0.85rem] leading-relaxed text-[var(--bb-grey-1)]">
            <span aria-hidden="true" className="mt-[7px] block w-1.5 h-1.5 shrink-0 bg-[var(--bb-orange)]" />
            {perk}
          </li>
        ))}
      </ul>
      <Link
        href="/demo"
        className="btn-outline mt-5 w-full !min-h-[52px] !text-[0.72rem]"
      >
        Enter the demo
      </Link>
    </section>
  );
}
