"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { clearDemoCookie, clearStatusCache } from "@/lib/api";
import { safeNext } from "@/lib/safe-next";

export { INLINE_LINK, INPUT_DARK, LABEL_DARK, PRIMARY_ORANGE } from "@/components/auth/fields";
import { INLINE_LINK, INPUT_DARK, LABEL_DARK, PRIMARY_ORANGE } from "@/components/auth/fields";

function friendlyError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials"))
    return "That email and password did not match. Try again, or reset your password below.";
  if (lower.includes("email not confirmed") || lower.includes("not confirmed"))
    return "Confirm your email first. The confirmation link is in your inbox.";
  if (lower.includes("too many") || lower.includes("rate limit"))
    return "Too many attempts. Wait a minute, then try again.";
  return message || "Sign-in failed. Try again.";
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const authError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    authError ? "That link expired or was already used. Sign in again." : null
  );

  if (!isSupabaseConfigured()) {
    return (
      <div className="space-y-4">
        <ErrorBanner message="Merchant login is not switched on for this deployment." />
        <p className="text-[0.9rem] leading-relaxed text-[var(--bb-grey-1)]">
          The demo below works regardless. It is the fastest way to see the console.
        </p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(friendlyError(signInError.message));
        return;
      }
      // A real session always wins: drop any demo flag before entering.
      clearDemoCookie();
      clearStatusCache();
      router.push(safeNext(next));
      router.refresh();
    } catch {
      setError("Sign-in failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
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
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className={LABEL_DARK}>Password</label>
          <Link href="/forgot-password" className={`text-[13px] ${INLINE_LINK}`}>
            Forgot password?
          </Link>
        </div>
        <input
          id="password" type="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password" className={INPUT_DARK}
        />
      </div>
      <button type="submit" disabled={loading} className={PRIMARY_ORANGE}>
        {loading ? (<><Loader2 size={16} className="animate-spin" /> Signing in</>) : "Sign in"}
      </button>
      <p className="text-center text-[0.88rem] text-[var(--bb-grey-1)]">
        New to SELLABLE?{" "}
        <Link href="/sign-up" className={INLINE_LINK}>
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function SignInPage() {
  return (
    <AuthShell
      eyebrow="Merchant login"
      title="Sign in to your console"
      subtitle="Your catalog, orders, and agent activity are inside."
    >
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
