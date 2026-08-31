import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = {
  title: "Create account — SELLABLE",
  description: "Create your merchant account and make your store agent-ready.",
};

function LiveDemo() {
  return (
    <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--bb-line)] bg-[var(--bb-black)]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#ff5f57]" />
          <span className="w-2 h-2 rounded-full bg-[#febc2e]" />
          <span className="w-2 h-2 rounded-full bg-[#28c840]" />
        </div>
        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
          live — agent transaction
        </span>
        <span className="w-2 h-2 rounded-full bg-[var(--bb-orange)] animate-[pulse_1.2s_ease-in-out_infinite]" />
      </div>
      <div className="p-4 space-y-3 font-[var(--font-mono)] text-[0.65rem]">
        <div className="flex items-center gap-2 text-[var(--bb-grey-2)]">
          <span className="w-1.5 h-1.5 bg-[var(--bb-orange)] animate-[pulse_1s_ease-in-out_infinite]" />
          buyer.discovered — catalog.search
        </div>
        <div className="flex items-center gap-2 text-[var(--bb-grey-2)]">
          <span className="w-1.5 h-1.5 bg-[var(--bb-grey-3)] animate-[pulse_1.6s_ease-in-out_infinite_0.3s]" />
          policy.checked — ALLOW
        </div>
        <div className="flex items-center gap-2 text-[var(--bb-orange)]">
          <span className="w-1.5 h-1.5 bg-[var(--bb-orange)] animate-[pulse_1s_ease-in-out_infinite_0.6s]" />
          payment.captured — verified
        </div>
        <div className="mt-3 h-px bg-[var(--bb-line)]" />
        <div className="flex items-center justify-between text-[0.6rem]">
          <span className="text-[var(--bb-grey-3)]">Trace</span>
          <span className="text-[var(--bb-white)] tracking-[0.06em]">trc_8f3a2…91e</span>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-[var(--bb-black)] flex flex-col">
      <header className="h-[64px] shrink-0 border-b border-[var(--bb-line)] flex items-center backdrop-blur">
        <div className="page-frame w-full flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="w-2.5 h-2.5 bg-[var(--bb-orange)] group-hover:scale-110 transition-transform" />
            <span className="font-[var(--font-sans)] text-[1.05rem] tracking-[-0.03em] text-[var(--bb-white)]">SELLABLE</span>
            <span className="hidden sm:inline font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] ml-1">
              Agentic Commerce
            </span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors px-3 py-2 rounded-full hover:bg-[var(--bb-panel)]"
          >
            ← Back to site
          </Link>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Left: marketing + live demo */}
        <div className="relative flex flex-col border-r border-[var(--bb-line)]">
          {/* Blueprint grid background — inline styles avoid .blueprint class position conflict */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.045) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--bb-black)] pointer-events-none" />
          <div className="absolute top-16 right-12 w-32 h-32 rounded-full bg-[var(--bb-orange)]/5 blur-2xl animate-[pulse_4s_ease-in-out_infinite] pointer-events-none" />
          <div className="absolute bottom-24 left-10 w-24 h-24 rounded-full bg-white/[0.03] blur-xl animate-[pulse_5s_ease-in-out_infinite_1s] pointer-events-none" />

          <div className="relative p-6 sm:p-8 flex-1 flex flex-col justify-start pt-8 pb-20">
            <div className="inline-flex items-center gap-2 border border-[var(--bb-orange)]/20 bg-[var(--bb-orange-wash)] px-3 py-1.5 w-fit">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--bb-orange)] animate-[pulse_1.4s_ease-in-out_infinite]" />
              <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-orange)]">
                Early access — free to start
              </span>
            </div>

            <h1 className="mt-5 font-[var(--font-sans)] text-[clamp(1.8rem,3vw,2.7rem)] leading-[0.95] tracking-[-0.06em] text-[var(--bb-white)]">
              Make your store
              <br />
              <span className="text-[var(--bb-orange)]">agent-ready</span>
              <br />
              in 3 minutes.
            </h1>

            <p className="mt-3 font-[var(--font-sans)] text-[0.95rem] leading-relaxed text-[var(--bb-grey-1)] max-w-[34rem]">
              Let AI buyers discover, negotiate, and purchase — with deterministic guardrails and a full XAI audit trail.
            </p>

            <div className="mt-6 w-full max-w-[420px]">
              <LiveDemo />
            </div>

            <div className="mt-8 hidden lg:block">
              <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)]/70 backdrop-blur p-4">
                <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)]">
                  What happens after you sign up
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 font-[var(--font-mono)] text-[0.55rem] tracking-[0.06em] uppercase">
                  <div className="border border-[var(--bb-line)] bg-[var(--bb-black)] px-2 py-2.5 text-center text-[var(--bb-grey-2)]">
                    1 — Verify email
                  </div>
                  <div className="border border-[var(--bb-line)] bg-[var(--bb-black)] px-2 py-2.5 text-center text-[var(--bb-grey-2)]">
                    2 — Open dashboard
                  </div>
                  <div className="border border-[var(--bb-orange)]/30 bg-[var(--bb-orange-wash)] px-2 py-2.5 text-center text-[var(--bb-orange)]">
                    3 — Go live
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: form */}
        <div className="flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-[var(--bb-black)]">
          <div className="w-full max-w-[440px]">
            <AuthForm initialMode="signup" />
          </div>
        </div>
      </div>
    </div>
  );
}
