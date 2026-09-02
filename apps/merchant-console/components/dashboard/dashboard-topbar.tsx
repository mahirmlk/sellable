"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useSystemStatus } from "@/components/dashboard/use-system-status";
import { getStore } from "@/lib/api";
import { IconSignOut, IconWarning } from "./icons";
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
    <div className="flex items-center gap-1.5" title={detail || undefined}>
      <span className={`w-[5px] h-[5px] ${meta ? meta.dot : "bg-[var(--bb-grey-4)]"}`} />
      <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)]">
        {label}
      </span>
      <span
        className={`font-[var(--font-mono)] text-[0.52rem] tracking-[0.04em] ${meta ? meta.text : "text-[var(--bb-grey-4)]"}`}
      >
        {meta ? meta.label : "…"}
      </span>
    </div>
  );
}

export function DashboardTopBar() {
  const router = useRouter();
  const { data: status, error } = useSystemStatus();
  const [storeName, setStoreName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStore()
      .then((s) => {
        if (!cancelled) setStoreName(s.name);
      })
      .catch(() => {
        if (!cancelled) setStoreName(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    <header className="h-[52px] sticky top-0 z-40 bg-[rgba(8,8,8,0.94)] border-b border-[var(--bb-line)] backdrop-blur-[12px] flex items-center justify-between px-6">
      {/* Left: Merchant name */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)] truncate max-w-[280px]">
          {storeName ?? "—"}
        </span>
        <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.14em] uppercase px-[7px] py-[3px] border border-yellow-400/30 text-yellow-400 bg-yellow-400/5">
          Test
        </span>
      </div>

      {/* Right: Status indicators + sign out */}
      <div className="flex items-center gap-4">
        <div className="hidden md:flex items-center gap-4">
          {error ? (
            <div
              className="flex items-center gap-2 text-[var(--bb-grey-3)]"
              title={error.message}
            >
              <IconWarning size={13} className="text-amber-400" />
              <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.12em] uppercase">
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
              <Pill label="Gateway" state={status?.agent_gateway.state} detail={status?.agent_gateway.detail} />
              <Pill label="Razorpay" state={status?.payment_rail.state} detail={status?.payment_rail.detail} />
            </>
          )}
        </div>
        <div className="w-px h-5 bg-[var(--bb-line)] hidden sm:block" />
        <button
          onClick={handleSignOut}
          className="inline-flex items-center gap-2 h-7 px-3 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-colors cursor-pointer"
          aria-label="Sign out"
        >
          <IconSignOut size={12} />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
