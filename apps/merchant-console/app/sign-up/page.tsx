"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { clearDemoCookie } from "@/lib/api";
import { INLINE_LINK, INPUT_DARK, LABEL_DARK, PRIMARY_ORANGE } from "@/app/sign-in/page";

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
        eyebrow="New merchant"
        title="Create your account"
        subtitle="One account per workspace. Setup takes a few minutes, and you can stop halfway."
      >
        <div className="space-y-4">
          <ErrorBanner message="Registration is not switched on for this deployment." />
          <p className="text-[0.9rem] leading-relaxed text-[var(--bb-grey-1)]">
            The demo below works regardless. It is the fastest way to see the console.
          </p>
        </div>
      </AuthShell>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
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
        setError(signUpError.message || "Registration failed. Try again.");
        return;
      }
      // Email confirmation required → wait for verification; session already
      // active → go straight to the dashboard (onboarding guard takes over).
      if (data.session) {
        clearDemoCookie();
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
      eyebrow="New merchant"
      title="Create your account"
      subtitle="One account per workspace. Setup takes a few minutes, and you can stop halfway."
    >
      {needsVerification ? (
        <div className="space-y-4">
          <div className="border border-[var(--bb-line)] bg-[var(--bb-black)] px-4 py-3 text-[0.88rem] leading-relaxed text-[var(--bb-white)]">
            Account created. We sent a confirmation link to{" "}
            <span className="font-semibold">{email}</span>. Open it, then sign
            in to set up your store.
          </div>
          <Link href="/sign-in" className={PRIMARY_ORANGE}>
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <ErrorBanner message={error} />}
          <div className="space-y-2">
            <label htmlFor="email" className={LABEL_DARK}>Work email</label>
            <input
              id="email" type="email" required autoComplete="email" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com" className={INPUT_DARK}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className={LABEL_DARK}>Password · 8+ characters</label>
            <input
              id="password" type="password" required minLength={8} autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Pick a strong one" className={INPUT_DARK}
            />
          </div>
          <button type="submit" disabled={loading} className={PRIMARY_ORANGE}>
            {loading ? (<><Loader2 size={16} className="animate-spin" /> Creating account</>) : "Create account"}
          </button>
          <p className="text-center text-[0.88rem] text-[var(--bb-grey-1)]">
            Already have an account?{" "}
            <Link href="/sign-in" className={INLINE_LINK}>
              Sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
