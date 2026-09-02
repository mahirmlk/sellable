"use client";

import { useRouter } from "next/navigation";
import { LogOut, AlertTriangle } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useSystemStatus } from "@/components/dashboard/use-system-status";
import type { ComponentState } from "@/lib/api";

const STATE_META: Record<ComponentState, { label: string; dot: string; text: string }> = {
  CONNECTED: { label: "Connected", dot: "bg-green-500", text: "text-green-400" },
  UNCONFIGURED: { label: "Unconfigured", dot: "bg-yellow-400", text: "text-yellow-400" },
  DEGRADED: { label: "Degraded", dot: "bg-amber-400", text: "text-amber-400" },
  ERROR: { label: "Error", dot: "bg-red-400", text: "text-red-400" },
  OFFLINE: { label: "Offline", dot: "bg-red-400", text: "text-red-400" },
};

function Pill({ label, state, detail }: { label: string; state?: ComponentState | null; detail?: string }) {
  const meta = state ? STATE_META[state] : null;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${meta ? meta.dot : "bg-[var(--bb-grey-4)]"}`} />
      <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
        {label}
      </span>
      <span
        className={`font-[var(--font-mono)] text-[0.55rem] ${meta ? meta.text : "text-[var(--bb-grey-4)]"}`}
        title={detail || undefined}
      >
        {meta ? meta.label : "…"}
      </span>
    </div>
  );
}

export function DashboardTopBar() {
  const router = useRouter();
  const { data: status, error } = useSystemStatus();

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
          {error ? (
            <div
              className="flex items-center gap-1.5 text-[var(--bb-grey-3)]"
              title={error.message}
            >
              <AlertTriangle size={12} className="text-amber-400" />
              <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase">
                {error.kind === "auth"
                  ? "Re-auth needed"
                  : error.kind === "network"
                    ? "Backend unreachable"
                    : error.kind === "endpoint"
                      ? "Wrong endpoint"
                      : "Status error"}
              </span>
            </div>
          ) : (
            <>
              <Pill label="Agent" state={status?.seller_agent.state} detail={status?.seller_agent.detail} />
              <div className="w-px h-3 bg-[var(--bb-line)]" />
              <Pill label="Gateway" state={status?.agent_gateway.state} detail={status?.agent_gateway.detail} />
              <div className="w-px h-3 bg-[var(--bb-line)]" />
              <Pill label="Razorpay" state={status?.payment_rail.state} detail={status?.payment_rail.detail} />
            </>
          )}
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
