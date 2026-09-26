"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Code2, Settings, ShieldCheck, Store } from "lucide-react";
import { useSystemStatus } from "@/components/dashboard/use-system-status";
import { OPEN_COMMAND_MENU_EVENT } from "@/components/dashboard/command-menu";
import { getStore } from "@/lib/api";
import { ThemeSwitcher } from "@/components/theme-switcher";import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconSearch, IconWarning } from "./icons";
import type { ComponentState, StoreInfo } from "@/lib/api";

/* Aurora Glass top bar: chrome glass with the signature search pill
   and mono shortcut chip from the reference. Assumes .dashboard-app scope. */

const STATE_META: Record<ComponentState, { label: string; dot: string; text: string }> = {
  CONNECTED: { label: "Connected", dot: "bg-neutral-400", text: "text-muted" },
  UNCONFIGURED: { label: "Unconfigured", dot: "bg-amber-600", text: "text-accent-strong" },
  DEGRADED: { label: "Degraded", dot: "bg-amber-600", text: "text-accent-strong" },
  ERROR: { label: "Error", dot: "bg-red-600", text: "text-red-700" },
  OFFLINE: { label: "Offline", dot: "bg-red-600", text: "text-red-700" },
};

function Pill({ label, state, detail, dotClass }: { label: string; state?: ComponentState | null; detail?: string; dotClass?: string }) {
  const meta = state ? STATE_META[state] : null;
  return (
    <div className="flex items-center gap-1 min-h-[24px]" title={detail || undefined} role="status">
      <span className={`size-1.5 rounded-full shrink-0 ${dotClass ?? (meta ? meta.dot : "bg-neutral-300")}`} />
      <span className="text-[11px] text-muted">
        {label}
      </span>
      <span
        className={`text-[11px] font-medium ${meta ? meta.text : "text-faint"}`}
      >
        {meta ? meta.label : "…"}
      </span>
    </div>
  );
}

function openCommandMenu() {
  window.dispatchEvent(new Event(OPEN_COMMAND_MENU_EVENT));
}

/** Store identity menu on Base UI primitives — real fields only
    (name, merchant_id, role). Positioning/collision comes from the
    popover engine; 12px drop offset below the trigger. */
function AccountMenu({ store, fallback }: { store: StoreInfo | null; fallback: string }) {
  const router = useRouter();

  const rows: Array<{ label: string; href: string; Icon: typeof Settings }> = [
    { label: "Store settings", href: "/dashboard/settings", Icon: Settings },
    { label: "Selling rules", href: "/dashboard/selling-rules", Icon: ShieldCheck },
    { label: "Developers", href: "/dashboard/developers", Icon: Code2 },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full px-2 py-1 -mx-2 text-left transition-colors hover:bg-ink/[0.04] cursor-pointer focus-visible:outline-2 focus-visible:outline-accent">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink truncate">
          {store?.name ?? fallback}
        </span>
        <ChevronDown size={14} aria-hidden className="shrink-0 text-faint" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={12}
        collisionPadding={12}
        className="w-[280px] bg-popover p-2 shadow-pop border border-hairline"
      >
        <div className="px-2.5 pt-2 pb-3">
          <div className="flex items-center gap-2.5">
            <span
              className="flex items-center justify-center size-9 rounded-[12px] bg-panel-3 text-ink-2 shrink-0"
              aria-hidden
            >
              <Store size={17} />
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-ink truncate">
                {store?.name ?? fallback}
              </div>
              <div className="font-mono text-[11px] text-faint truncate">
                {store?.merchant_id ?? ""}
              </div>
            </div>
          </div>
          {store?.role ? (
            <span className="mt-2.5 inline-flex items-center rounded-full bg-accent-soft text-accent-strong px-2 py-0.5 text-[11px] font-medium capitalize leading-none">
              {store.role}
            </span>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {rows.map(({ label, href, Icon }) => (
          <DropdownMenuItem key={href} onClick={() => router.push(href)}>
            <Icon size={15} className="text-faint" aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DashboardTopBar() {
  const { data: status, error } = useSystemStatus();
  const [store, setStore] = useState<StoreInfo | null>(null);
  // Until the store loads (or when it cannot), show a neutral workspace
  // word instead of a bare dash.
  const storeLabel = store?.name ?? "Your store";

  useEffect(() => {
    let cancelled = false;
    getStore()
      .then((s) => {
        if (!cancelled) setStore(s);
      })
      .catch(() => {
        if (!cancelled) setStore(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="h-[64px] sticky top-0 z-40 bg-panel border-b border-hairline flex items-center gap-3 sm:gap-5 pl-16 pr-4 sm:px-6">
      {/* Left: store identity menu */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <AccountMenu store={store} fallback={storeLabel} />
      </div>

      {/* Center: signature search pill */}
      <button
        type="button"
        onClick={openCommandMenu}
        aria-label="Search sales, reports, or products (Command K)"
        className="hidden md:flex flex-1 min-w-0 max-w-[520px] items-center gap-2.5 h-[42px] rounded-full bg-panel border border-hairline pl-4 pr-1.5 shadow-card hover:shadow-lift transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-accent"
      >
        <IconSearch size={15} className="text-faint shrink-0" />
        <span className="text-[14px] text-faint truncate text-left">
          Search sales, reports, or products…
        </span>
        <span className="kbd-chip ml-auto shrink-0">⌘ + K</span>
      </button>

      {/* Right: quick search on small screens + status indicators */}
      <div className="flex items-center gap-2 sm:gap-4 ml-auto shrink-0">
        <button
          type="button"
          onClick={openCommandMenu}
          aria-label="Search pages (Command K)"
          className="md:hidden inline-flex items-center justify-center size-9 rounded-full bg-panel border border-hairline text-muted shadow-card transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent"
        >
          <IconSearch size={16} />
        </button>
        <div className="hidden md:flex items-center gap-3 px-1">
          <ThemeSwitcher />
          {error ? (
            <div
              className="flex items-center gap-2 text-muted"
              title={error.message}
              role="status"
            >
              <IconWarning size={14} className="text-amber-600" />
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
              <Pill label="Razorpay" state={status?.payment_rail.state} detail={status?.payment_rail.detail} dotClass="bg-neutral-400" />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
