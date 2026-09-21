"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getAgentsStatus, type AgentsStatusResponse, type ComponentState } from "@/lib/api";
import { NAV_SECTIONS } from "./nav-config";

const STATE_DOT: Record<ComponentState, string> = {
  CONNECTED: "bg-[#1f9d55] ring-4 ring-[#1f9d55]/15",
  UNCONFIGURED: "bg-[#b25e00] ring-4 ring-[#b25e00]/15",
  DEGRADED: "bg-[#b25e00] ring-4 ring-[#b25e00]/15",
  ERROR: "bg-[#d92d20] ring-4 ring-[#d92d20]/15",
  OFFLINE: "bg-[#d92d20] ring-4 ring-[#d92d20]/15",
};

function HealthRow({ name, state, detail, compact }: { name: string; state?: ComponentState | null; detail?: string; compact?: boolean }) {
  const dot = state ? STATE_DOT[state] : "bg-[#d1d1d6]";
  return (
    <div
      className={`flex items-center justify-between gap-2 py-1 ${compact ? "lg:justify-center lg:w-full" : ""}`}
      title={detail || undefined}
      role="status"
    >
      <span className={`text-[13px] text-neutral-500 ${compact ? "lg:hidden" : ""}`}>
        {name}
      </span>
      <span className={`size-2 rounded-full shrink-0 ${dot}`} />
    </div>
  );
}

function MobileIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
      {open ? <path d="M3 3l10 10M13 3L3 13" /> : <path d="M2 4h12M2 8h12M2 12h12" />}
    </svg>
  );
}

export function DashboardSidebar({
  collapsed = false,
  onToggle,
  badges,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  /** Optional live counts keyed by NavItem.badgeKey (e.g. { approvals: 3 }). */
  badges?: Record<string, number | string>;
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
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      {/* Mobile hamburger — floating glass button */}
      <button
        className="lg:hidden fixed top-4 left-4 z-[60] w-10 h-10 flex items-center justify-center rounded-full bg-white/80 backdrop-blur-xl border border-black/10 shadow-[0_8px_24px_rgba(0,0,0,0.12)] text-neutral-900 cursor-pointer active:scale-95 transition-transform"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
      >
        <MobileIcon open={mobileOpen} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-neutral-900/30 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — collapsed mode is desktop-only (lg:) so the mobile drawer
          stays a full-width list even when the user collapsed the rail. */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-[264px] bg-[rgba(251,251,253,0.92)] backdrop-blur-[20px] backdrop-saturate-[180%] border-r border-black/[0.08] flex flex-col transition-[transform,width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          collapsed ? "lg:w-[72px]" : ""
        } ${mobileOpen ? "translate-x-0 rounded-r-[20px] shadow-[0_12px_40px_rgba(0,0,0,0.12)]" : "-translate-x-full lg:translate-x-0"}`}
      >
        {/* Logo */}
        <div
          className={`h-[60px] flex items-center border-b border-black/[0.06] ${
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
              <span className="flex items-center justify-center size-8 rounded-xl bg-neutral-900 text-white text-[15px] font-semibold shadow-sm">
                S
              </span>
            </Link>
          )}
        </div>

        {/* Environment badge — Apple pill */}
        <div
          className={`py-3 border-b border-black/[0.06] flex items-center gap-2 ${
            collapsed ? "lg:justify-center lg:px-0" : "px-5"
          }`}
          title="Test Mode — payments run on Razorpay Test"
        >
          <span className="size-2 rounded-full bg-[#b25e00] ring-4 ring-[#b25e00]/15 shrink-0" />
          <span className={`inline-flex items-center rounded-full bg-[#fff4e5] text-[#b25e00] px-2.5 py-1 text-[12px] font-medium leading-none ${collapsed ? "lg:hidden" : ""}`}>
            Test
          </span>
        </div>

        {/* Nav */}
        <nav
          className={`flex-1 overflow-y-auto py-3 px-2 ${collapsed ? "lg:overflow-visible lg:px-2" : "overflow-x-hidden"}`}
          aria-label="Dashboard navigation"
        >
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-4">
              <div
                className={`px-3 pt-1 pb-2 text-[11px] font-semibold tracking-[0.06em] uppercase text-black/40 ${
                  collapsed ? "lg:hidden" : ""
                }`}
                aria-hidden
              >
                {section.label}
              </div>
              <div className="space-y-0.5">
              {section.items.map((link) => {
                const Icon = link.icon;
                const active = isActive(link.href);
                const badge =
                  link.badgeKey && badges ? badges[link.badgeKey] : undefined;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className={`relative flex items-center gap-2.5 rounded-[10px] min-h-[40px] px-3 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
                      collapsed ? "lg:justify-center lg:px-0" : ""
                    } ${
                      active
                        ? "bg-black/[0.05] text-[#1d1d1f]"
                        : "text-black/55 hover:bg-black/[0.04] hover:text-[#1d1d1f]"
                    }`}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? link.label : undefined}
                    title={collapsed ? link.label : undefined}
                  >
                    <Icon
                      size={17}
                      className={`shrink-0 transition-colors ${active ? "text-[#1d1d1f]" : "text-black/45"}`}
                    />
                    <span className={`text-[15px] leading-tight tracking-[-0.01em] truncate ${collapsed ? "lg:hidden" : ""}`}>
                      {link.label}
                    </span>
                    {badge !== undefined && (
                      <span
                        className={`ml-auto min-w-[22px] h-[22px] inline-flex items-center justify-center rounded-full px-1.5 text-[12px] font-semibold tabular-nums ${collapsed ? "lg:hidden" : ""} ${
                          active ? "bg-[#1d1d1f] text-white" : "bg-black/[0.06] text-neutral-700"
                        }`}
                      >
                        {badge}
                      </span>
                    )}
                    {/* Hover label — only rendered when the rail is collapsed. */}
                    {collapsed && (
                      <span className="hidden lg:flex absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2 z-[70] items-center px-3 py-1.5 rounded-lg bg-white/85 backdrop-blur-xl border border-black/10 shadow-[0_12px_40px_rgba(0,0,0,0.12)] text-[13px] font-medium text-neutral-900 whitespace-nowrap pointer-events-none opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150">
                        {link.label}
                      </span>
                    )}
                  </Link>
                );
              })}
              </div>
            </div>
          ))}
        </nav>

        {/* Collapse toggle (desktop only) */}
        <button
          onClick={onToggle}
          className="hidden lg:flex items-center w-full min-h-[44px] border-t border-black/[0.06] text-black/40 hover:text-[#1d1d1f] hover:bg-black/[0.03] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0071e3]"
          style={{ justifyContent: collapsed ? "center" : "flex-end", paddingInline: collapsed ? 0 : 16 }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight size={16} />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
              Collapse
              <ChevronLeft size={16} />
            </span>
          )}
        </button>

        {/* System health strip */}
        <div
          className={`py-4 border-t border-black/[0.06] space-y-1 bg-white/60 backdrop-blur-xl ${
            collapsed ? "lg:px-0 lg:flex lg:flex-col lg:items-center" : "px-5"
          }`}
        >
          <div className={`text-[11px] font-semibold tracking-[0.06em] uppercase text-black/40 mb-1 ${collapsed ? "lg:hidden" : ""}`}>
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
