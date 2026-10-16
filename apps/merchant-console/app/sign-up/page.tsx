"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { clearDemoCookie, clearStatusCache } from "@/lib/api";
import { INLINE_LINK, INPUT_DARK, LABEL_DARK, PRIMARY_ORANGE } from "@/components/auth/fields";

function passwordChecks(password: string) {
  return [
    { id: "length", label: "8 or more characters", ok: password.length >= 8 },
    {
      id: "variety",
      label: "A number or symbol",
      ok: /[0-9\W]/.test(password),
    },
  ];
}

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  const checks = useMemo(() => passwordChecks(password), [password]);
  const passwordTouched = password.length > 0;

  if (!isSupabaseConfigured()) {
    return (
      <AuthShell
        eyebrow="New merchant"
        title="Create your account"
        subtitle="One login for your store. It takes a couple of minutes, and you can leave and come back."
        demo="pass"
      >
        <div className="space-y-4">
          <ErrorBanner message="Sign-ups are off on this deployment." />
          <p className="text-[0.9rem] leading-relaxed text-[var(--bb-grey-1)]">
            You can still walk through the console with the demo store below.
          </p>
        </div>
      </AuthShell>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid work email.");
      return;
    }
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
        email: trimmed,
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
        clearStatusCache();
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
      subtitle="One login for your store. It takes a couple of minutes, and you can leave and come back."
      demo="pass"
    >
      {needsVerification ? (
        <div className="space-y-4">
          <div className="border border-[var(--bb-line)] bg-[var(--bb-black)] px-4 py-3 text-[0.88rem] leading-relaxed text-[var(--bb-white)]">
            Account created. We sent a confirmation link to{" "}
            <span className="font-semibold">{email.trim()}</span>. Open it,
            then sign in to set up your store.
          </div>
          <Link href="/sign-in" className={PRIMARY_ORANGE}>
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {error && <ErrorBanner message={error} />}
          <div className="space-y-2">
            <label htmlFor="email" className={LABEL_DARK}>Work email</label>
            <input
              id="email" type="email" required autoComplete="email" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com" className={INPUT_DARK}
              aria-invalid={Boolean(error && !email)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className={LABEL_DARK}>Password</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required minLength={8} autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Pick a strong one" className={`${INPUT_DARK} pr-12`}
                aria-describedby="password-hints"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] transition-colors"
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <ul id="password-hints" className="space-y-1 pt-1">
              {checks.map((check) => (
                <li
                  key={check.id}
                  className={`flex items-center gap-2 text-[0.8rem] ${
                    check.ok
                      ? "text-[var(--bb-white)]"
                      : passwordTouched
                        ? "text-[var(--bb-grey-2)]"
                        : "text-[var(--bb-grey-2)]"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 items-center justify-center border text-[10px] ${
                      check.ok
                        ? "border-[var(--bb-orange)] bg-[var(--bb-orange)] text-black"
                        : "border-[var(--bb-line)] text-transparent"
                    }`}
                  >
                    <Check size={11} strokeWidth={3} />
                  </span>
                  {check.label}
                </li>
              ))}
            </ul>
          </div>
          <button type="submit" disabled={loading} className={PRIMARY_ORANGE}>
            {loading ? (<><Loader2 size={16} className="animate-spin" /> Creating account</>) : "Create account"}
          </button>
          <p className="text-[0.78rem] leading-relaxed text-[var(--bb-grey-2)]">
            By creating an account you agree to look after the store data in
            your workspace. You can delete your account and its data at any time.
          </p>
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
