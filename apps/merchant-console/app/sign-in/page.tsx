"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const INPUT =
  "w-full h-11 rounded-[12px] bg-white border border-black/[0.12] text-[15px] text-neutral-900 px-3.5 placeholder:text-neutral-400 focus:outline-none focus:border-hairline focus:ring-[3px] focus:ring-ink/20 transition-shadow";
const PRIMARY =
  "w-full h-11 inline-flex items-center justify-center gap-2 rounded-full bg-ink text-white text-[15px] font-semibold hover:bg-ink-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.99]";
const LABEL = "text-[13px] text-neutral-500";

function friendlyError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials"))
    return "Incorrect email or password. Try again or reset your password below.";
  if (lower.includes("email not confirmed") || lower.includes("not confirmed"))
    return "Please verify your email first — check your inbox for the confirmation link.";
  if (lower.includes("too many") || lower.includes("rate limit"))
    return "Too many attempts. Wait a minute and try again.";
  return message || "Sign-in failed. Please try again.";
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
    authError ? "Your session expired or the link was invalid. Sign in again." : null
  );

  if (!isSupabaseConfigured()) {
    return (
      <div className="space-y-4">
        <ErrorBanner message="Sign-in is unavailable: merchant login is not configured on this deployment." />
        <p className="text-[14px] leading-relaxed text-neutral-500">
          You can still explore the full console with realistic sample data —
          no account needed.
        </p>
        <Link href="/demo" className={PRIMARY}>
          Explore Demo Mode
        </Link>
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
      router.push(next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    } catch {
      setError("Sign-in failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <ErrorBanner message={error} />}
      <div className="space-y-1.5">
        <label htmlFor="email" className={LABEL}>Email</label>
        <input
          id="email" type="email" required autoComplete="email" autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com" className={INPUT}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className={LABEL}>Password</label>
          <Link href="/forgot-password" className="text-[13px] font-medium text-accent-strong hover:underline">
            Forgot password?
          </Link>
        </div>
        <input
          id="password" type="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••" className={INPUT}
        />
      </div>
      <button type="submit" disabled={loading} className={PRIMARY}>
        {loading ? (<><Loader2 size={16} className="animate-spin" /> Signing in…</>) : "Sign in"}
      </button>
      <p className="text-center text-[14px] text-neutral-500">
        New to SELLABLE?{" "}
        <Link href="/sign-up" className="font-medium text-accent-strong hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function SignInPage() {
  return (
    <AuthShell
      title="Sign in to SELLABLE"
      subtitle="Access your merchant console — catalog, selling rules, orders, and agent activity."
    >
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
