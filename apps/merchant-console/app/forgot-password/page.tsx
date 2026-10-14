"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const INPUT =
  "w-full h-11 rounded-[12px] bg-white border border-black/[0.12] text-[15px] text-neutral-900 px-3.5 placeholder:text-neutral-400 focus:outline-none focus:border-hairline focus:ring-[3px] focus:ring-ink/20 transition-shadow";
const PRIMARY =
  "w-full h-11 inline-flex items-center justify-center gap-2 rounded-full bg-ink text-white text-[15px] font-semibold hover:bg-ink-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.99]";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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
        setError(resetError.message || "Could not send the reset email. Try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Could not send the reset email. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email you a secure link to choose a new password."
    >
      {!isSupabaseConfigured() ? (
        <ErrorBanner message="Password recovery is unavailable: merchant login is not configured on this deployment." />
      ) : sent ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-green-50 border border-green-200/60 px-4 py-3 text-[13px] text-green-900">
            Reset link sent to <span className="font-semibold">{email}</span>.
            It expires soon — check spam if you don&apos;t see it.
          </div>
          <Link href="/sign-in" className={PRIMARY}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <ErrorBanner message={error} />}
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-[13px] text-neutral-500">Email</label>
            <input
              id="email" type="email" required autoComplete="email" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com" className={INPUT}
            />
          </div>
          <button type="submit" disabled={loading} className={PRIMARY}>
            {loading ? (<><Loader2 size={16} className="animate-spin" /> Sending link…</>) : "Send reset link"}
          </button>
          <p className="text-center text-[14px] text-neutral-500">
            <Link href="/sign-in" className="font-medium text-accent-strong hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
