"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
  ShieldCheck,
  Zap,
  BarChart3,
  Check,
  AlertCircle,
} from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Mode = "login" | "signup";

function passwordStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

export function AuthForm({ initialMode = "login" }: { initialMode?: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Honor the middleware-preserved ?next= deep link — restricted to
  // /dashboard paths so a crafted value cannot become an open redirect.
  const nextParam = searchParams.get("next");
  const dest =
    nextParam && nextParam.startsWith("/dashboard") ? nextParam : "/dashboard";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const supabaseConfigured = isSupabaseConfigured();
  const strength = passwordStrength(password);
  const isSignup = mode === "signup";

  const setDemoCookie = () => {
    if (typeof document !== "undefined") {
      document.cookie = "sellable_demo_auth=1; path=/; max-age=86400; SameSite=Lax";
    }
  };

  const enterDemo = () => {
    setDemoCookie();
    router.push(dest);
    router.refresh();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!supabaseConfigured) {
      enterDemo();
      return;
    }

    if (isSignup && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          setError(error.message);
          return;
        }
        // NOTE: merchant linking is intentionally NOT done here. The verified
        // Supabase user is resolved to a merchant server-side via the
        // `merchant_users` table (service-role only). Client-side linking
        // would let any signup self-assign merchant access.
        if (data.session) {
          setSuccess("Account created. Redirecting...");
          setTimeout(() => {
            router.push(dest);
            router.refresh();
          }, 600);
        } else {
          setSuccess("Account created. Check your email to confirm, then sign in.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(error.message);
          return;
        }
        router.push(dest);
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[440px] relative">
      {/* Tab switcher */}
      <div className="flex items-center gap-1 p-1 bg-[var(--bb-panel)] border border-[var(--bb-line)] mb-6">
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setError(null);
              setSuccess(null);
            }}
            className={`flex-1 h-[36px] font-[var(--font-mono)] text-[0.65rem] tracking-[0.14em] uppercase transition-all cursor-pointer ${
              mode === m
                ? "bg-[var(--bb-white)] text-[var(--bb-black)]"
                : "bg-transparent text-[var(--bb-grey-3)] hover:text-[var(--bb-white)]"
            }`}
          >
            {m === "login" ? "Sign In" : "Sign Up"}
          </button>
        ))}
      </div>

      {/* Card */}
      <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] overflow-hidden">
        {/* Card header accent */}
        <div className="h-[2px] bg-[var(--bb-orange)] w-full" />

        <form onSubmit={handleSubmit} className="p-7 space-y-5">
          {/* Status */}
          {error && (
            <div className="flex items-start gap-2.5 border border-red-500/30 bg-red-500/[0.07] px-4 py-3 animate-slide-up">
              <AlertCircle size={14} className="text-red-400 mt-[1px] shrink-0" />
              <span className="font-[var(--font-mono)] text-[0.65rem] leading-relaxed text-red-300">{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2.5 border border-green-500/30 bg-green-500/[0.07] px-4 py-3 animate-slide-up">
              <Check size={14} className="text-green-400 mt-[1px] shrink-0" />
              <span className="font-[var(--font-mono)] text-[0.65rem] leading-relaxed text-green-300">{success}</span>
            </div>
          )}

          {/* Demo banner */}
          {!supabaseConfigured && (
            <div className="border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 flex items-start gap-2.5">
              <ShieldCheck size={14} className="text-amber-400 mt-[1px] shrink-0" />
              <p className="font-[var(--font-mono)] text-[0.6rem] leading-relaxed text-amber-200/90">
                Supabase not configured — running in demo mode. Any credentials will proceed to the dashboard.
              </p>
            </div>
          )}

          {/* Email */}
          <div className="space-y-2">
            <label className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
              Email
            </label>
            <div className="relative group">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocused("email")}
                onBlur={() => setFocused(null)}
                required
                autoComplete="email"
                placeholder="merchant@store.com"
                className="w-full h-[44px] px-3.5 bg-[var(--bb-black)] border text-[var(--bb-white)] font-[var(--font-mono)] text-[0.8rem] placeholder:text-[var(--bb-grey-4)] focus:outline-none transition-colors"
                style={{
                  borderColor: focused === "email" ? "var(--bb-orange)" : "var(--bb-line)",
                }}
              />
              <div
                className="absolute bottom-0 left-0 h-[1px] bg-[var(--bb-orange)] transition-all duration-300"
                style={{ width: focused === "email" ? "100%" : "0%" }}
              />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                Password
              </label>
              {!isSignup && (
                <span
                  title="Password recovery is not enabled on this Supabase project — contact the store owner to reset access."
                  className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)] cursor-help"
                >
                  Forgot?
                </span>
              )}
            </div>
            <div className="relative group">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                required
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder="••••••••"
                className="w-full h-[44px] px-3.5 pr-10 bg-[var(--bb-black)] border text-[var(--bb-white)] font-[var(--font-mono)] text-[0.8rem] placeholder:text-[var(--bb-grey-4)] focus:outline-none transition-colors"
                style={{
                  borderColor: focused === "password" ? "var(--bb-orange)" : "var(--bb-line)",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors cursor-pointer"
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <div
                className="absolute bottom-0 left-0 h-[1px] bg-[var(--bb-orange)] transition-all duration-300"
                style={{ width: focused === "password" ? "100%" : "0%" }}
              />
            </div>
            {isSignup && password && (
              <div className="flex gap-1 pt-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-[2px] flex-1 transition-colors duration-300"
                    style={{
                      background:
                        i < strength
                          ? strength <= 1
                            ? "#ef4444"
                            : strength === 2
                              ? "#f59e0b"
                              : strength === 3
                                ? "#84cc16"
                                : "#22c55e"
                          : "var(--bb-line)",
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Confirm */}
          {isSignup && (
            <div className="space-y-2 animate-slide-up">
              <label className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                Confirm password
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onFocus={() => setFocused("confirm")}
                  onBlur={() => setFocused(null)}
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="w-full h-[44px] px-3.5 bg-[var(--bb-black)] border text-[var(--bb-white)] font-[var(--font-mono)] text-[0.8rem] placeholder:text-[var(--bb-grey-4)] focus:outline-none transition-colors"
                  style={{
                    borderColor: focused === "confirm" ? "var(--bb-orange)" : "var(--bb-line)",
                  }}
                />
                <div
                  className="absolute bottom-0 left-0 h-[1px] bg-[var(--bb-orange)] transition-all duration-300"
                  style={{ width: focused === "confirm" ? "100%" : "0%" }}
                />
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-[46px] inline-flex items-center justify-center gap-2.5 bg-[var(--bb-orange)] text-[var(--bb-black)] font-[var(--font-mono)] text-[0.7rem] tracking-[0.14em] uppercase font-semibold hover:bg-[var(--bb-orange-bright)] active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer group"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {isSignup ? "Creating account..." : "Signing in..."}
              </>
            ) : (
              <>
                {isSignup ? "Create account" : "Sign in"}
                <ArrowRight
                  size={16}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </>
            )}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 py-1">
            <div className="h-[1px] flex-1 bg-[var(--bb-line)]" />
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)]">
              {isSignup ? "Already have an account?" : "New to SELLABLE?"}
            </span>
            <div className="h-[1px] flex-1 bg-[var(--bb-line)]" />
          </div>

          <button
            type="button"
            onClick={() => {
              setMode(isSignup ? "login" : "signup");
              setError(null);
              setSuccess(null);
            }}
            className="w-full h-[40px] border border-[var(--bb-line)] bg-transparent text-[var(--bb-grey-2)] font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase hover:border-[var(--bb-grey-4)] hover:text-[var(--bb-white)] hover:bg-[var(--bb-panel-2)] transition-all cursor-pointer"
          >
            {isSignup ? "Sign in instead" : "Create an account"}
          </button>
        </form>

        {/* Footer trust */}
        <div className="border-t border-[var(--bb-line)] bg-[var(--bb-panel-2)] px-7 py-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
            <ShieldCheck size={12} className="text-[var(--bb-grey-4)]" />
            Deterministic policy + consent gates
          </span>
          <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">
            {isSignup ? "Free to start" : "Demo: any email works"}
          </span>
        </div>
      </div>

      {/* Bottom hints */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {[
          { icon: Zap, label: "<2s", sub: "Agent response", hint: "Typical p95 latency" },
          { icon: ShieldCheck, label: "100%", sub: "Audit coverage", hint: "Every money action logged" },
          { icon: BarChart3, label: "14", sub: "Policy checks", hint: "SKU → HITL checks" },
        ].map((s) => (
          <div
            key={s.label}
            className="border border-[var(--bb-line)] bg-[var(--bb-panel)]/50 px-3 py-3 text-center"
            title={s.hint}
          >
            <s.icon size={14} className="mx-auto text-[var(--bb-orange)] mb-1.5" />
            <div className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-white)]">{s.label}</div>
            <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.08em] uppercase text-[var(--bb-grey-4)]">
              {s.sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
