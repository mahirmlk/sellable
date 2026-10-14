"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { INPUT_DARK, LABEL_DARK, PRIMARY_ORANGE } from "@/app/sign-in/page";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSupabaseConfigured()) {
    return (
      <AuthShell eyebrow="Account recovery" title="Choose a new password" subtitle="Recovery links land here after verification.">
        <ErrorBanner message="Password reset is not switched on for this deployment." />
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
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message || "The password did not update. The link may have expired, so request a new one.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("The password did not update. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell eyebrow="Account recovery" title="Choose a new password" subtitle="Recovery links land here after verification.">
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <ErrorBanner message={error} />}
        <div className="space-y-2">
          <label htmlFor="password" className={LABEL_DARK}>New password · 8+ characters</label>
          <input
            id="password" type="password" required minLength={8} autoComplete="new-password" autoFocus
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Pick a strong one" className={INPUT_DARK}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="confirm" className={LABEL_DARK}>Confirm new password</label>
          <input
            id="confirm" type="password" required autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat it" className={INPUT_DARK}
          />
        </div>
        <button type="submit" disabled={loading} className={PRIMARY_ORANGE}>
          {loading ? (<><Loader2 size={16} className="animate-spin" /> Updating</>) : "Update password"}
        </button>
      </form>
    </AuthShell>
  );
}
