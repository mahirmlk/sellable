import Link from "next/link";
import type { ReactNode } from "react";

// Shared access-experience shell: sign-in / sign-up / recovery pages all
// use this card so the entry point looks like one product (UPDATE.md §4).
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-canvas">
      <div className="w-full max-w-[440px] space-y-4">
        <div className="rounded-3xl bg-white border border-black/[0.06] shadow-card overflow-hidden">
          <div className="p-7 space-y-5">
            <div>
              <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-neutral-900">
                {title}
              </h1>
              <div className="mt-1 text-[14px] leading-relaxed text-neutral-500">
                {subtitle}
              </div>
            </div>
            {children}
          </div>
        </div>
        <DemoExplainer />
      </div>
    </div>
  );
}

export function DemoExplainer() {
  return (
    <div className="rounded-3xl bg-white border border-dashed border-black/[0.14] px-6 py-5">
      <div className="text-[13px] font-semibold tracking-[0.08em] uppercase text-neutral-500">
        No account? Explore Demo Mode
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500">
        Explore the SELLABLE merchant console using a realistic sample store.
        No account or payment is required. Demo data is separate from live
        merchant data.
      </p>
      <Link
        href="/demo"
        className="mt-3 inline-flex items-center justify-center w-full h-10 rounded-full border border-black/[0.14] text-[14px] font-semibold text-neutral-900 hover:bg-neutral-50 transition-colors focus-visible:outline-2 focus-visible:outline-accent"
      >
        Explore Demo Mode
      </Link>
    </div>
  );
}
