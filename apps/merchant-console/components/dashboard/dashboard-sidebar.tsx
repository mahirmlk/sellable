"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  Activity,
  ShoppingCart,
  ShieldCheck,
  Package,
  TrendingUp,
  Globe,
  Settings,
  Menu,
  X,
} from "lucide-react";
import { getAgentsStatus, type AgentsStatusResponse, type ComponentState } from "@/lib/api";

const sidebarLinks = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Chat", href: "/dashboard/chat", icon: MessageSquare },
  { label: "Activity", href: "/dashboard/activity", icon: Activity },
  { label: "Transactions", href: "/dashboard/transactions", icon: ShoppingCart },
  { label: "Approvals", href: "/dashboard/approvals", icon: ShieldCheck },
  { label: "Catalog", href: "/dashboard/catalog", icon: Package },
  { label: "Growth", href: "/dashboard/growth", icon: TrendingUp },
  { label: "AI Storefront", href: "/dashboard/storefront", icon: Globe },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

const STATE_LABEL: Record<ComponentState, string> = {
  CONNECTED: "Connected",
  UNCONFIGURED: "Unconfigured",
  DEGRADED: "Degraded",
  ERROR: "Error",
  OFFLINE: "Offline",
};

const STATE_DOT: Record<ComponentState, string> = {
  CONNECTED: "bg-green-500",
  UNCONFIGURED: "bg-yellow-400",
  DEGRADED: "bg-amber-400",
  ERROR: "bg-red-400",
  OFFLINE: "bg-red-400",
};

function HealthRow({ name, state, detail }: { name: string; state?: ComponentState | null; detail?: string }) {
  const meta = state ? STATE_LABEL[state] : null;
  const dot = state ? STATE_DOT[state] : "bg-[var(--bb-grey-4)]";
  return (
    <div className="flex items-center gap-2" title={detail || undefined}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
        {name} {meta ?? "…"}
      </span>
    </div>
  );
}

export function DashboardSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [status, setStatus] = useState<AgentsStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAgentsStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="lg:hidden fixed top-4 left-4 z-[60] w-10 h-10 flex items-center justify-center bg-[var(--bb-panel)] border border-[var(--bb-line)] rounded-md text-[var(--bb-white)]"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
      >
        {mobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-[240px] bg-[var(--bb-black)] border-r border-[var(--bb-line)] flex flex-col transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="h-[64px] flex items-center px-5 border-b border-[var(--bb-line)]">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/sellable-logo.png"
              alt="SELLABLE"
              width={130}
              height={28}
              className="h-[24px] w-auto"
              priority
            />
          </Link>
        </div>

        {/* Environment badge */}
        <div className="px-5 py-3 border-b border-[var(--bb-line)]">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-[blink_2s_ease-in-out_infinite]" />
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
              TEST MODE
            </span>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-3 px-3 overflow-y-auto" aria-label="Dashboard navigation">
          {sidebarLinks.map((link) => {
            const Icon = link.icon;
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-[0.8rem] transition-all duration-200 mb-0.5 group ${
                  active
                    ? "bg-[var(--bb-panel)] text-[var(--bb-white)] shadow-[inset_2px_0_0_0_var(--bb-orange)]"
                    : "text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:bg-[var(--bb-panel)] hover:shadow-[inset_2px_0_0_0_var(--bb-grey-4)]"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={16} strokeWidth={1.5} className={`transition-colors ${active ? "text-[var(--bb-orange)]" : "group-hover:text-[var(--bb-grey-1)]"}`} />
                <span className="font-[var(--font-sans)]">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* System health strip */}
        <div className="px-5 py-4 border-t border-[var(--bb-line)]">
          <div className="space-y-2">
            <HealthRow name="Gateway" state={status?.agent_gateway.state} detail={status?.agent_gateway.detail} />
            <HealthRow name="Policy" state={status?.policy_engine.state} detail={status?.policy_engine.detail} />
            <HealthRow name="Ledger" state={status?.ledger.state} detail={status?.ledger.detail} />
          </div>
        </div>
      </aside>
    </>
  );
}
