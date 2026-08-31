import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = {
  title: "Sign in — SELLABLE",
  description: "Sign in to your merchant console.",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[var(--bb-black)] flex flex-col">
      <header className="h-[64px] shrink-0 border-b border-[var(--bb-line)] flex items-center">
        <div className="page-frame w-full flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="w-2.5 h-2.5 bg-[var(--bb-orange)] group-hover:scale-110 transition-transform" />
            <span className="font-[var(--font-sans)] text-[1.05rem] tracking-[-0.03em] text-[var(--bb-white)]">SELLABLE</span>
            <span className="hidden sm:inline font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] ml-1">
              Agentic Commerce
            </span>
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors px-3 py-2 rounded-full hover:bg-[var(--bb-panel)]">
            ← Back to site
          </Link>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Left: marketing panel (desktop only) */}
        <div className="relative hidden lg:flex flex-col border-r border-[var(--bb-line)]">
          {/* Blueprint grid background — inline styles avoid .blueprint class position conflict */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.045) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--bb-black)] pointer-events-none" />
          <div className="absolute top-20 right-10 w-28 h-28 rounded-full bg-[var(--bb-orange)]/5 blur-2xl animate-[pulse_4s_ease-in-out_infinite] pointer-events-none" />

          <div className="relative p-8 xl:p-10 flex-1 flex flex-col justify-center">
            <div className="inline-flex items-center gap-2 border border-[var(--bb-line)] bg-[var(--bb-panel)] px-3 py-1.5 w-fit mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-[pulse_1.5s_ease-in-out_infinite]" />
              <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">Welcome back</span>
            </div>
            <h1 className="font-[var(--font-sans)] text-[clamp(1.8rem,3vw,2.7rem)] leading-[0.95] tracking-[-0.06em] text-[var(--bb-white)]">
              Sign in to
              <br />
              your <span className="text-[var(--bb-orange)]">store</span>.
            </h1>
            <p className="mt-3 font-[var(--font-sans)] text-[0.95rem] leading-relaxed text-[var(--bb-grey-1)] max-w-[32rem]">
              Your catalog, approvals, and audit trail — everything your AI buyers do, explainable.
            </p>
            <div className="mt-6 border border-[var(--bb-line)] bg-[var(--bb-panel)]/70 backdrop-blur p-4 max-w-[420px]">
              <div className="flex items-center gap-2 font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)]">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-[pulse_1s_ease-in-out_infinite]" />
                Trusted flow
              </div>
              <div className="mt-3 space-y-1.5 font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">
                <div>→ Policy checks before money moves</div>
                <div>→ Single-use consent per transaction</div>
                <div>→ Verified Razorpay webhooks only</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: form */}
        <div className="flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-[var(--bb-black)]">
          <div className="w-full max-w-[440px]">
            <AuthForm initialMode="login" />
          </div>
        </div>
      </div>
    </div>
  );
}
