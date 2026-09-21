"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Store } from "lucide-react";
import { onboardMerchant, ApiError } from "@/lib/api";
import { ErrorBanner } from "@/components/dashboard/error-banner";

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
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#f5f5f7]">
      <div className="w-full max-w-[440px]">
        <div className="rounded-3xl bg-white border border-black/[0.06] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.12)] overflow-hidden">
          <form onSubmit={handleSubmit} className="p-7 space-y-5">
            <div className="flex items-center gap-3 mb-1">
              <span className="flex items-center justify-center size-10 rounded-2xl bg-blue-50 shrink-0" aria-hidden>
                <Store size={18} className="text-[#0071e3]" />
              </span>
              <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-neutral-900">
                Create your store
              </h1>
            </div>
            <p className="text-[14px] leading-relaxed text-neutral-500">
              Your verified account doesn&apos;t have a merchant store yet. Name your store to
              continue — you&apos;ll get your own catalog, policy, ledger, and analytics. No demo
              data is involved.
            </p>

            {error && <ErrorBanner message={error} />}

            <div className="space-y-1.5">
              <label className="text-[13px] text-neutral-500">
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
                className="w-full h-11 rounded-[12px] bg-white border border-black/[0.12] text-[15px] text-neutral-900 px-3.5 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-full bg-[#0071e3] text-white text-[15px] font-semibold hover:bg-[#0077ed] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.99]"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Creating store…
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
