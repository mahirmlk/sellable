"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getAgentsStatus, type AgentsStatusResponse, type ComponentState } from "@/lib/api";
import {
  IconOverview,
  IconChat,
  IconActivity,
  IconTransactions,
  IconApprovals,
  IconCatalog,
  IconGrowth,
  IconStorefront,
  IconSettings,
} from "./icons";

const sidebarLinks = [
  { label: "Overview", href: "/dashboard", icon: IconOverview },
  { label: "Chat", href: "/dashboard/chat", icon: IconChat },
  { label: "Activity", href: "/dashboard/activity", icon: IconActivity },
  { label: "Transactions", href: "/dashboard/transactions", icon: IconTransactions },
  { label: "Approvals", href: "/dashboard/approvals", icon: IconApprovals },
  { label: "Catalog", href: "/dashboard/catalog", icon: IconCatalog },
  { label: "Growth", href: "/dashboard/growth", icon: IconGrowth },
  { label: "AI Storefront", href: "/dashboard/storefront", icon: IconStorefront },
  { label: "Settings", href: "/dashboard/settings", icon: IconSettings },
];

const STATE_DOT: Record<ComponentState, string> = {
  CONNECTED: "bg-green-500",
  UNCONFIGURED: "bg-yellow-400",
  DEGRADED: "bg-amber-400",
  ERROR: "bg-red-400",
  OFFLINE: "bg-red-400",
};

function HealthRow({ name, state, detail, compact }: { name: string; state?: ComponentState | null; detail?: string; compact?: boolean }) {
  const dot = state ? STATE_DOT[state] : "bg-[var(--bb-grey-4)]";
  return (
    <div
      className={`flex items-center justify-between gap-2 ${compact ? "lg:justify-center lg:w-full" : ""}`}
      title={detail || undefined}
    >
      <span className={`font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] ${compact ? "lg:hidden" : ""}`}>
        {name}
      </span>
      <span className={`w-[5px] h-[5px] ${dot}`} />
    </div>
  );
}

function MobileIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.25" aria-hidden>
      {open ? <path d="M3 3l10 10M13 3L3 13" /> : <path d="M2 4h12M2 8h12M2 12h12" />}
    </svg>
  );
}

export function DashboardSidebar({
  collapsed = false,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
}) {
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
        className="lg:hidden fixed top-4 left-4 z-[60] w-10 h-10 flex items-center justify-center bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] cursor-pointer"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
      >
        <MobileIcon open={mobileOpen} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — collapsed mode is desktop-only (lg:) so the mobile drawer
          stays a full-width list even when the user collapsed the rail. */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-[240px] bg-[var(--bb-black)] border-r border-[var(--bb-line)] flex flex-col transition-[transform,width] duration-300 ease-in-out ${
          collapsed ? "lg:w-[56px]" : ""
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        {/* Logo (compact monogram replaces the wordmark when collapsed) */}
        <div
          className={`h-[60px] flex items-center border-b border-[var(--bb-line)] ${
            collapsed ? "lg:justify-center lg:px-0" : "px-5"
          }`}
        >
          <Link href="/" className={`flex items-center gap-2.5 ${collapsed ? "lg:hidden" : ""}`} aria-label="SELLABLE home">
            <Image
              src="/sellable-logo.png"
              alt="SELLABLE"
              width={130}
              height={28}
              className="h-[22px] w-auto"
              priority
            />
          </Link>
          {collapsed && (
            <Link
              href="/"
              className="hidden lg:flex items-center justify-center w-full h-full"
              aria-label="SELLABLE home"
            >
              <span className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-orange)] border border-[var(--bb-orange)]/40 px-[7px] py-[2px]">
                S
              </span>
            </Link>
          )}
        </div>

        {/* Environment badge */}
        <div
          className={`py-3 border-b border-[var(--bb-line)] flex items-center gap-2 ${
            collapsed ? "lg:justify-center lg:px-0" : "px-5"
          }`}
          title="Test Mode"
        >
          <span className="w-[5px] h-[5px] bg-yellow-400 animate-[blink_2s_ease-in-out_infinite]" />
          <span className={`font-[var(--font-mono)] text-[0.52rem] tracking-[0.16em] uppercase text-[var(--bb-grey-3)] ${collapsed ? "lg:hidden" : ""}`}>
            Test Mode
          </span>
        </div>

        {/* Nav links — when collapsed, icons only with hover name tooltips.
            Collapsed + lg drops the scroll clipping (overflow-x-hidden would
            clip the hover labels that escape the 56px rail). */}
        <nav
          className={`flex-1 py-2 ${collapsed ? "lg:overflow-visible" : "overflow-y-auto overflow-x-hidden"}`}
          aria-label="Dashboard navigation"
        >
          {sidebarLinks.map((link, index) => {
            const Icon = link.icon;
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`relative flex items-center gap-3 group transition-colors duration-150 cursor-pointer ${
                  collapsed ? "lg:justify-center lg:px-0 lg:py-[11px]" : "pl-5 pr-3 py-[9px]"
                } ${
                  active ? "text-[var(--bb-white)]" : "text-[var(--bb-grey-2)] hover:text-[var(--bb-white)]"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span
                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-[2px] transition-all duration-150 ${
                    active ? "h-[18px] bg-[var(--bb-orange)]" : "h-0 group-hover:h-[18px] bg-[var(--bb-grey-4)]"
                  }`}
                />
                <span
                  className={`font-[var(--font-mono)] text-[0.52rem] w-[16px] tabular-nums ${
                    collapsed ? "lg:hidden" : ""
                  } ${
                    active ? "text-[var(--bb-orange)]" : "text-[var(--bb-grey-4)]"
                  }`}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Icon
                  size={15}
                  className={`shrink-0 transition-colors ${active ? "text-[var(--bb-orange)]" : "text-[var(--bb-grey-3)] group-hover:text-[var(--bb-grey-1)]"}`}
                />
                <span className={`font-[var(--font-sans)] text-[0.82rem] ${collapsed ? "lg:hidden" : ""}`}>
                  {link.label}
                </span>
                {/* Hover label — only rendered when the rail is collapsed.
                    z-index sits inside the aside's own stacking context, so
                    labels always paint above page content. */}
                {collapsed && (
                  <span className="hidden lg:flex absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2 z-[70] items-center px-2 py-1 bg-[var(--bb-panel)] border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.58rem] tracking-[0.1em] uppercase text-[var(--bb-white)] whitespace-nowrap pointer-events-none opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 shadow-lg">
                    {link.label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle (desktop only) */}
        <button
          onClick={onToggle}
          className={`hidden lg:flex items-center w-full h-[36px] border-t border-[var(--bb-line)] text-[var(--bb-grey-4)] hover:text-[var(--bb-white)] transition-colors cursor-pointer ${
            collapsed ? "justify-center" : "justify-end px-4"
          }`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight size={14} />
          ) : (
            <>
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase mr-1.5">COLLAPSE</span>
              <ChevronLeft size={14} />
            </>
          )}
        </button>

        {/* System health strip */}
        <div
          className={`py-4 border-t border-[var(--bb-line)] space-y-[7px] ${
            collapsed ? "lg:px-0 lg:flex lg:flex-col lg:items-center" : "px-5"
          }`}
        >
          <div className={`font-[var(--font-mono)] text-[0.45rem] tracking-[0.18em] uppercase text-[var(--bb-grey-4)] mb-2 ${collapsed ? "lg:hidden" : ""}`}>
            System
          </div>
          <HealthRow compact={collapsed} name="Gateway" state={status?.agent_gateway.state} detail={status?.agent_gateway.detail} />
          <HealthRow compact={collapsed} name="Policy" state={status?.policy_engine.state} detail={status?.policy_engine.detail} />
          <HealthRow compact={collapsed} name="Ledger" state={status?.ledger.state} detail={status?.ledger.detail} />
        </div>
      </aside>
    </>
  );
}
