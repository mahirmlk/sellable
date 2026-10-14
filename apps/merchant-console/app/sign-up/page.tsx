"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const INPUT =
  "w-full h-11 rounded-[12px] bg-white border border-black/[0.12] text-[15px] text-neutral-900 px-3.5 placeholder:text-neutral-400 focus:outline-none focus:border-hairline focus:ring-[3px] focus:ring-ink/20 transition-shadow";
const PRIMARY =
  "w-full h-11 inline-flex items-center justify-center gap-2 rounded-full bg-ink text-white text-[15px] font-semibold hover:bg-ink-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.99]";
const LABEL = "text-[13px] text-neutral-500";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  if (!isSupabaseConfigured()) {
    return (
      <AuthShell
        title="Create your account"
        subtitle="One account per merchant workspace. Onboarding takes a few minutes."
      >
        <div className="space-y-4">
          <ErrorBanner message="Registration is unavailable: merchant login is not configured on this deployment." />
          <p className="text-[14px] leading-relaxed text-neutral-500">
            You can still explore the full console with realistic sample data —
            no account needed.
          </p>
          <Link href="/demo" className={PRIMARY}>
            Explore Demo Mode
          </Link>
        </div>
      </AuthShell>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const siteUrl =
        typeof window !== "undefined" ? window.location.origin : "";
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${siteUrl}/auth/callback?next=/dashboard`,
        },
      });
      if (signUpError) {
        setError(signUpError.message || "Registration failed. Please try again.");
        return;
      }
      // Email confirmation required → wait for verification; session already
      // active → go straight to the dashboard (onboarding guard takes over).
      if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setNeedsVerification(true);
      }
    } catch {
      setError("Registration failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="One account per merchant workspace. Onboarding takes a few minutes."
    >
      {needsVerification ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-green-50 border border-green-200/60 px-4 py-3 text-[13px] text-green-900">
            Account created. Check <span className="font-semibold">{email}</span> for
            a verification link, then sign in to set up your store.
          </div>
          <Link href="/sign-in" className={PRIMARY}>
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <ErrorBanner message={error} />}
          <div className="space-y-1.5">
            <label htmlFor="email" className={LABEL}>Work email</label>
            <input
              id="email" type="email" required autoComplete="email" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com" className={INPUT}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className={LABEL}>Password <span className="text-neutral-400">(8+ characters)</span></label>
            <input
              id="password" type="password" required minLength={8} autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" className={INPUT}
            />
          </div>
          <button type="submit" disabled={loading} className={PRIMARY}>
            {loading ? (<><Loader2 size={16} className="animate-spin" /> Creating account…</>) : "Create account"}
          </button>
          <p className="text-center text-[14px] text-neutral-500">
            Already have an account?{" "}
            <Link href="/sign-in" className="font-medium text-accent-strong hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
