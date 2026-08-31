"use client";

import { useRouter } from "next/navigation";
import { Activity, Wifi, CreditCard, LogOut } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export function DashboardTopBar() {
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      if (isSupabaseConfigured()) {
        const supabase = createClient();
        await supabase.auth.signOut();
      }
    } catch {
      // ignore
    }
    if (typeof document !== "undefined") {
      document.cookie = "sellable_demo_auth=; path=/; max-age=0; SameSite=Lax";
    }
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="h-[52px] sticky top-0 z-40 bg-[rgba(8,8,8,0.96)] border-b border-[var(--bb-line)] backdrop-blur-[12px] flex items-center justify-between px-6">
      {/* Left: Merchant name */}
      <div className="flex items-center gap-4">
        <span className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)]">
          SELLABLE Demo Store
        </span>
        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase px-2 py-0.5 border border-yellow-400/30 text-yellow-400 bg-yellow-400/5 rounded-sm">
          TEST
        </span>
      </div>

      {/* Right: Status indicators + sign out */}
      <div className="flex items-center gap-4">
        <div className="hidden sm:flex items-center gap-5">
          <div className="flex items-center gap-1.5">
            <Activity size={12} className="text-green-400" />
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
              Agent
            </span>
            <span className="font-[var(--font-mono)] text-[0.55rem] text-green-400">Online</span>
          </div>
          <div className="w-px h-3 bg-[var(--bb-line)]" />
          <div className="flex items-center gap-1.5">
            <Wifi size={12} className="text-green-400" />
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
              Gateway
            </span>
            <span className="font-[var(--font-mono)] text-[0.55rem] text-green-400">Healthy</span>
          </div>
          <div className="w-px h-3 bg-[var(--bb-line)]" />
          <div className="flex items-center gap-1.5">
            <CreditCard size={12} className="text-green-400" />
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
              Razorpay
            </span>
            <span className="font-[var(--font-mono)] text-[0.55rem] text-green-400">Connected</span>
          </div>
        </div>
        <div className="w-px h-6 bg-[var(--bb-line)] hidden sm:block" />
        <button
          onClick={handleSignOut}
          className="inline-flex items-center gap-1.5 h-7 px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-colors cursor-pointer"
          title="Sign out"
        >
          <LogOut size={12} />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
