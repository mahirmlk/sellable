"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Store, AlertCircle } from "lucide-react";
import { onboardMerchant, ApiError } from "@/lib/api";

export default function OnboardingPage() {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const name = storeName.trim();
    if (name.length < 2) {
      setError("Store name must be at least 2 characters.");
      return;
    }
    setLoading(true);
    try {
      await onboardMerchant(name);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          // Already onboarded — just go to the dashboard.
          router.push("/dashboard");
          router.refresh();
          return;
        }
        setError(err.detail || "Onboarding failed. Please try again.");
      } else {
        setError("Onboarding failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-[440px]">
        <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] overflow-hidden">
          <div className="h-[2px] bg-[var(--bb-orange)] w-full" />
          <form onSubmit={handleSubmit} className="p-7 space-y-5">
            <div className="flex items-center gap-2.5 mb-1">
              <Store size={18} className="text-[var(--bb-orange)]" />
              <h1 className="font-[var(--font-sans)] text-[1.2rem] tracking-[-0.02em] text-[var(--bb-white)]">
                Create your store
              </h1>
            </div>
            <p className="font-[var(--font-mono)] text-[0.65rem] leading-relaxed text-[var(--bb-grey-3)]">
              Your verified account doesn&apos;t have a merchant store yet. Name your store to
              continue — you&apos;ll get your own catalog, policy, ledger, and analytics. No demo
              data is involved.
            </p>

            {error && (
              <div className="flex items-start gap-2.5 border border-red-500/30 bg-red-500/[0.07] px-4 py-3">
                <AlertCircle size={14} className="text-red-400 mt-[1px] shrink-0" />
                <span className="font-[var(--font-mono)] text-[0.65rem] leading-relaxed text-red-300">
                  {error}
                </span>
              </div>
            )}

            <div className="space-y-2">
              <label className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                Store name
              </label>
              <input
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
                autoFocus
                placeholder="e.g. Acme Desk Supplies"
                className="w-full h-[44px] px-3.5 bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] font-[var(--font-mono)] text-[0.8rem] placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-[46px] inline-flex items-center justify-center gap-2.5 bg-[var(--bb-orange)] text-[var(--bb-black)] font-[var(--font-mono)] text-[0.7rem] tracking-[0.14em] uppercase font-semibold hover:bg-[var(--bb-orange-bright)] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Creating store...
                </>
              ) : (
                "Create store"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
