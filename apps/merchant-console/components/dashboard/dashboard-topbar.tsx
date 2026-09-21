"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useSystemStatus } from "@/components/dashboard/use-system-status";
import { OPEN_COMMAND_MENU_EVENT } from "@/components/dashboard/command-menu";
import { getStore } from "@/lib/api";
import { IconSignOut, IconWarning } from "./icons";
import type { ComponentState } from "@/lib/api";

const STATE_META: Record<ComponentState, { label: string; dot: string; text: string }> = {
  CONNECTED: { label: "Connected", dot: "bg-[#1f9d55]", text: "text-[#1f9d55]" },
  UNCONFIGURED: { label: "Unconfigured", dot: "bg-[#b25e00]", text: "text-[#b25e00]" },
  DEGRADED: { label: "Degraded", dot: "bg-[#b25e00]", text: "text-[#b25e00]" },
  ERROR: { label: "Error", dot: "bg-[#d92d20]", text: "text-[#d92d20]" },
  OFFLINE: { label: "Offline", dot: "bg-[#d92d20]", text: "text-[#d92d20]" },
};

function Pill({ label, state, detail }: { label: string; state?: ComponentState | null; detail?: string }) {
  const meta = state ? STATE_META[state] : null;
  return (
    <div className="flex items-center gap-1.5 min-h-[28px]" title={detail || undefined} role="status">
      <span className={`size-2 rounded-full shrink-0 ${meta ? meta.dot : "bg-[#d1d1d6]"}`} />
      <span className="text-[12px] text-neutral-500">
        {label}
      </span>
      <span
        className={`text-[12px] font-medium ${meta ? meta.text : "text-neutral-400"}`}
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
    <header className="h-[60px] sticky top-0 z-40 bg-[rgba(255,255,255,0.72)] backdrop-blur-[20px] backdrop-saturate-[180%] border-b border-black/[0.08] flex items-center justify-between pl-16 pr-4 sm:px-6">
      {/* Left: Merchant name */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-[#1d1d1f] truncate max-w-[280px]">
          {storeName ?? "—"}
        </span>
        <span className="inline-flex items-center rounded-full bg-[#fff4e5] text-[#b25e00] px-2.5 py-1 text-[12px] font-medium leading-none">
          Test
        </span>
      </div>

      {/* Right: Search trigger + status indicators + sign out */}
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_MENU_EVENT))}
          aria-label="Search pages (Command K)"
          className="hidden sm:inline-flex items-center gap-2 h-8 pl-3 pr-2.5 rounded-[10px] bg-black/[0.05] hover:bg-black/10 text-[13px] text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0071e3]"
        >
          <span aria-hidden className="text-[13px]">⌕</span>
          <span>Search</span>
          <kbd className="ml-1 inline-flex items-center h-5 px-1.5 rounded-md bg-white border border-black/10 shadow-sm text-[11px] font-medium text-neutral-500">
            ⌘K
          </kbd>
        </button>
        <div className="hidden md:flex items-center gap-4 px-1">
          {error ? (
            <div
              className="flex items-center gap-2 text-neutral-500"
              title={error.message}
              role="status"
            >
              <IconWarning size={14} className="text-[#b25e00]" />
              <span className="text-[12px] font-medium">
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
        <div className="w-px h-5 bg-black/10 hidden sm:block" />
        <button
          onClick={handleSignOut}
          className="inline-flex items-center gap-2 h-8 px-3 rounded-[10px] bg-black/[0.05] hover:bg-black/10 text-[13px] font-medium text-neutral-700 hover:text-neutral-900 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]"
          aria-label="Sign out"
        >
          <IconSignOut size={14} />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
