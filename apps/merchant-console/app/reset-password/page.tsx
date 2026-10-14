"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const INPUT =
  "w-full h-11 rounded-[12px] bg-white border border-black/[0.12] text-[15px] text-neutral-900 px-3.5 placeholder:text-neutral-400 focus:outline-none focus:border-hairline focus:ring-[3px] focus:ring-ink/20 transition-shadow";
const PRIMARY =
  "w-full h-11 inline-flex items-center justify-center gap-2 rounded-full bg-ink text-white text-[15px] font-semibold hover:bg-ink-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.99]";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSupabaseConfigured()) {
    return (
      <AuthShell title="Choose a new password" subtitle="Recovery links land here after verification.">
        <ErrorBanner message="Password reset is unavailable: merchant login is not configured on this deployment." />
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
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message || "Could not update the password. The link may have expired — request a new one.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not update the password. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Choose a new password" subtitle="Recovery links land here after verification.">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-[13px] text-neutral-500">New password <span className="text-neutral-400">(8+ characters)</span></label>
          <input
            id="password" type="password" required minLength={8} autoComplete="new-password" autoFocus
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" className={INPUT}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirm" className="text-[13px] text-neutral-500">Confirm new password</label>
          <input
            id="confirm" type="password" required autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••" className={INPUT}
          />
        </div>
        <button type="submit" disabled={loading} className={PRIMARY}>
          {loading ? (<><Loader2 size={16} className="animate-spin" /> Updating…</>) : "Update password"}
        </button>
      </form>
    </AuthShell>
  );
}
