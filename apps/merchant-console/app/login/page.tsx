"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [supabaseConfigured] = useState(() => isSupabaseConfigured());

  const enterDemo = () => {
    router.push("/dashboard");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!supabaseConfigured) {
      enterDemo();
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[var(--bb-bg)]">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.18em] uppercase text-[var(--bb-orange)] mb-2">
            Merchant Console
          </div>
          <h1 className="font-[var(--font-sans)] text-[1.6rem] tracking-[-0.04em] text-[var(--bb-white)]">
            SELLABLE
          </h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">
            Sign in to manage your AI storefront
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-6 space-y-4"
        >
          {error && (
            <div className="border border-red-500/40 bg-red-500/10 px-4 py-3 font-[var(--font-mono)] text-[0.65rem] text-red-400">
              {error}
            </div>
          )}

          {supabaseConfigured ? (
            <>
              <div>
                <label className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)]">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="mt-1 w-full h-[40px] px-3 bg-[var(--bb-bg)] border border-[var(--bb-line)] text-[var(--bb-white)] font-[var(--font-mono)] text-[0.8rem] focus:border-[var(--bb-orange)] focus:outline-none"
                />
              </div>
              <div>
                <label className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)]">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="mt-1 w-full h-[40px] px-3 bg-[var(--bb-bg)] border border-[var(--bb-line)] text-[var(--bb-white)] font-[var(--font-mono)] text-[0.8rem] focus:border-[var(--bb-orange)] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full h-[42px] inline-flex items-center justify-center gap-2 bg-[var(--bb-orange)] text-[var(--bb-bg)] font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : "Sign In"}
                {!loading && <ArrowRight size={14} />}
              </button>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-3)] mb-4">
                Supabase is not configured — running in demo mode.
              </p>
              <button
                type="submit"
                className="w-full h-[42px] inline-flex items-center justify-center gap-2 bg-[var(--bb-orange)] text-[var(--bb-bg)] font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase hover:opacity-90 transition-opacity cursor-pointer"
              >
                Continue in Demo Mode <ArrowRight size={14} />
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}