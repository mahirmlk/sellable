"use client";

import { Eyebrow } from "./ui/eyebrow";

// Every control listed here is implemented in the codebase — this section
// maps real threat classes to the real mechanisms that neutralize them.

const CONTROLS = [
  {
    threat: "Forged sessions",
    mechanism: "ES256 + JWKS",
    detail:
      "Supabase issues asymmetric access tokens. The backend verifies signatures locally against the project's JWKS — kid-matched, cached, rotation-aware — with strict issuer and audience checks.",
    refs: ["sellable/supabase_jwt.py", "merchant_users lookup"],
  },
  {
    threat: "Privilege escalation",
    mechanism: "Separate auth from authorization",
    detail:
      "A verified identity says nothing about access. The user id is resolved through merchant_users to their own store; a user with no mapping gets onboarding, never demo data. Cross-merchant IDs are 404s.",
    refs: ["merchant_users", "per-merchant cores"],
  },
  {
    threat: "Public database abuse",
    mechanism: "RLS + zero anon grants",
    detail:
      "The anon key ships in browser bundles — so application tables carry row-level security and zero grants for anon/authenticated. Only the backend's service role touches data.",
    refs: ["supabase/migrations", "REVOKE + ENABLE RLS"],
  },
  {
    threat: "Agent key leakage",
    mechanism: "Hash-only storage + replay guard",
    detail:
      "Buyer agents authenticate with API keys stored as SHA-256 hashes, or HMAC-SHA256 request signatures bound to timestamp, nonce, path, and body — with server-side replay protection.",
    refs: ["BUYER_AGENT_API_KEY_HASH", "X-Signature + X-Nonce"],
  },
  {
    threat: "Forged payment success",
    mechanism: "Webhook-only settlement",
    detail:
      "No browser, agent, or admin endpoint can mark an order PAID. Only a signature-verified Razorpay webhook settles it — and duplicate deliveries are idempotent.",
    refs: ["POST /webhooks/razorpay", "HMAC verification"],
  },
  {
    threat: "Unbounded agent behavior",
    mechanism: "Deterministic policy + consent",
    detail:
      "The LLM proposes; the policy engine disposes. Grounding, floors, caps, and thresholds are hard code. Payment requires a single-use, amount-bound consent token consumed exactly once.",
    refs: ["sellable/policy.py", "sellable/consent.py"],
  },
];

export function Security() {
  return (
    <section id="security" className="technical-section py-[clamp(80px,10vw,160px)] overflow-hidden relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-[0.5]" style={{ background: "radial-gradient(640px 420px at 50% 30%, rgba(255,105,0,0.05), transparent 66%)" }} />
      </div>

      <div className="page-frame relative">
        <div className="max-w-[720px]">
          <Eyebrow label="07 — SECURITY MODEL" />
          <h2 className="section-title mt-6 text-[var(--bb-white)]">
            The security model is the product
          </h2>
          <p className="body-copy mt-6">
            Autonomous agents spending real money is a threat model before it is
            a feature list. Each control below is implemented in this
            codebase — with the file or mechanism named, not vibes.
          </p>
        </div>

        <div className="mt-12 border border-[#30302E] overflow-hidden">
          {/* header row */}
          <div className="hidden md:grid grid-cols-[220px_240px_1fr] gap-0 bg-[var(--bb-panel)] border-b border-[var(--bb-line)]">
            <div className="px-5 py-3 font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">THREAT CLASS</div>
            <div className="px-5 py-3 font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">CONTROL</div>
            <div className="px-5 py-3 font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">MECHANISM</div>
          </div>
          {CONTROLS.map((c, i) => (
            <div
              key={c.threat}
              className={`grid grid-cols-1 md:grid-cols-[220px_240px_1fr] gap-2 md:gap-0 px-5 py-5 hover:bg-[var(--bb-panel-2)] transition-colors ${
                i < CONTROLS.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
              }`}
            >
              <div className="font-[var(--font-mono)] text-[0.68rem] text-red-400/90">{c.threat}</div>
              <div className="font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-white)]">
                <span className="md:hidden font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] block mb-0.5">
                  CONTROL
                </span>
                {c.mechanism}
              </div>
              <div>
                <p className="font-[var(--font-sans)] text-[0.84rem] leading-relaxed text-[var(--bb-grey-1)]">
                  {c.detail}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.refs.map((r) => (
                    <span
                      key={r}
                      className="font-[var(--font-mono)] text-[0.5rem] px-1.5 py-0.5 border border-[var(--bb-line-soft)] text-[var(--bb-grey-3)]"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 font-[var(--font-mono)] text-[0.55rem] tracking-[0.04em] text-[var(--bb-grey-4)]">
          FULL AUDIT TRAIL: EVERY CONTROL ABOVE IS COVERED BY TESTS IN tests/ AND EXERCISED IN THE CASE STUDY.
        </div>
      </div>
    </section>
  );
}
