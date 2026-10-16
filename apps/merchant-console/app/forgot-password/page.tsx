"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { INLINE_LINK, INPUT_DARK, LABEL_DARK, PRIMARY_ORANGE } from "@/components/auth/fields";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Not configured: fail fast with the deployment message instead of
    // throwing inside createClient (which reads as a connection error).
    if (!isSupabaseConfigured()) {
      setError("Password recovery is not switched on for this deployment.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const siteUrl =
        typeof window !== "undefined" ? window.location.origin : "";
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: `${siteUrl}/auth/callback?next=/reset-password` }
      );
      if (resetError) {
        // Generic on purpose: reserve specifics for rate limits so the form
        // cannot be used to probe which emails have accounts.
        const lower = (resetError.message || "").toLowerCase();
        setError(
          lower.includes("too many") || lower.includes("rate limit")
            ? "Too many attempts. Wait a minute, then try again."
            : "If an account exists for that email, a reset link is on its way."
        );
        return;
      }
      setSent(true);
    } catch {
      setError("The reset email did not send. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your password"
      subtitle="We will email you a link that lets you choose a new one."
    >
      {!isSupabaseConfigured() ? (
        <ErrorBanner message="Password recovery is not switched on for this deployment." />
      ) : sent ? (
        <div className="space-y-4">
          <div className="border border-[var(--bb-line)] bg-[var(--bb-black)] px-4 py-3 text-[0.88rem] leading-relaxed text-[var(--bb-white)]">
            Reset link sent to <span className="font-semibold">{email}</span>.
            It expires soon, so check spam if it is not in your inbox.
          </div>
          <Link href="/sign-in" className={PRIMARY_ORANGE}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <ErrorBanner message={error} />}
          <div className="space-y-2">
            <label htmlFor="email" className={LABEL_DARK}>Email</label>
            <input
              id="email" type="email" required autoComplete="email" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com" className={INPUT_DARK}
            />
          </div>
          <button type="submit" disabled={loading} className={PRIMARY_ORANGE}>
            {loading ? (<><Loader2 size={16} className="animate-spin" /> Sending link</>) : "Send reset link"}
          </button>
          <p className="text-center text-[0.88rem] text-[var(--bb-grey-1)]">
            <Link href="/sign-in" className={INLINE_LINK}>
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
