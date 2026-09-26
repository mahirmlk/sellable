"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_SECTIONS } from "./nav-config";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* Apple-style sidebar: white frosted glass, small caps group labels,
   soft pill rows, ink count badge. Assumes the .dashboard-app scope. */

function MobileIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
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

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      {/* Mobile hamburger — floating glass button */}
      <button
        className="lg:hidden fixed top-4 left-4 z-[60] w-10 h-10 flex items-center justify-center rounded-full bg-panel border border-hairline shadow-lift text-ink cursor-pointer active:scale-95 transition-transform"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
      >
        <MobileIcon open={mobileOpen} />
      </button>

      {/* Mobile drawer — same nav as the desktop rail, always expanded. */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[240px] max-w-[85vw] gap-0 border-r border-hairline bg-panel p-0"
        >
          <SheetTitle className="sr-only">Dashboard navigation</SheetTitle>
          <SidebarBody
            collapsed={false}
            showCollapseControls={false}
            badges={badges}
            pathname={pathname}
            isActive={isActive}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Desktop rail — collapsed mode is desktop-only (hidden below lg so
          the mobile drawer stays a full-width list even when the user
          collapsed the rail). */}
      <aside
        data-lenis-prevent
        className={`fixed top-0 left-0 z-50 hidden h-full w-[240px] bg-panel border-r border-hairline lg:flex flex-col transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          collapsed ? "lg:w-[64px]" : ""
        }`}
      >
        <SidebarBody
          collapsed={collapsed}
          showCollapseControls
          onToggle={onToggle}
          badges={badges}
          pathname={pathname}
          isActive={isActive}
        />
      </aside>
    </>
  );
}

function SidebarBody({
  collapsed,
  showCollapseControls,
  onToggle,
  onNavigate,
  badges,
  pathname,
  isActive,
}: {
  collapsed: boolean;
  showCollapseControls: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  badges?: Record<string, number | string>;
  pathname: string;
  isActive: (href: string) => boolean;
}) {
  const navRef = useRef<HTMLElement>(null);

  // Keep the active destination visible when the route changes.
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  return (
    <>
      {/* Logo row — expanded shows the theme-aware brand mark plus the
          collapse control; collapsed shows an explicit expand button so
          the rail can always be reopened. */}
      <div
        className={`h-[56px] flex items-center border-b border-hairline ${
          collapsed ? "lg:justify-center lg:px-0" : "pl-4 pr-2 justify-between"
        }`}
      >
        <Link
          href="/"
          onClick={onNavigate}
          className={`flex items-center min-w-0 ${collapsed ? "lg:hidden" : ""}`}
          aria-label="SELLABLE home"
        >
          <Image
            src="/sellable-logo-dark.png"
            alt="SELLABLE"
            width={130}
            height={28}
            className="logo-for-light h-[22px] w-auto"
            priority
          />
          <Image
            src="/sellable-logo.png"
            alt="SELLABLE"
            width={130}
            height={28}
            className="logo-for-dark h-[22px] w-auto"
            priority
          />
        </Link>
        {showCollapseControls && !collapsed && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                type="button"
                onClick={onToggle}
                aria-label="Collapse sidebar"
                aria-pressed={false}
                className="hidden lg:flex items-center justify-center size-8 rounded-full text-faint hover:text-ink hover:bg-ink/[0.05] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent"
              >
                <PanelLeftClose size={17} aria-hidden />
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="bg-ink text-panel text-[12px]"
              >
                Collapse sidebar
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {showCollapseControls && collapsed && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                type="button"
                onClick={onToggle}
                aria-label="Expand sidebar"
                aria-pressed
                className="hidden lg:flex items-center justify-center size-9 rounded-full text-muted hover:text-ink hover:bg-ink/[0.05] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent"
              >
                <PanelLeftOpen size={18} aria-hidden />
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="bg-ink text-panel text-[12px]"
              >
                Expand sidebar
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Nav — independent overlay-scroll region (wheel/touch scroll here
          never chains into the page). Active item scrolls into view. */}
      <nav
        ref={navRef}
        data-lenis-prevent
        className={`scroll-overlay flex-1 overflow-y-auto overscroll-contain py-2.5 px-2 ${collapsed ? "lg:overflow-visible lg:px-2" : "overflow-x-hidden"}`}
        aria-label="Dashboard navigation"
      >
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-2">
            <div
              className={`px-3 pt-1 pb-1 text-[11px] font-semibold tracking-[0.08em] uppercase text-faint ${
                collapsed ? "lg:hidden" : ""
              }`}
              aria-hidden
            >
              {section.label}
            </div>
            <div className="space-y-px">
            {section.items.map((link) => {
              const Icon = link.icon;
              const active = isActive(link.href);
              const badge =
                link.badgeKey && badges ? badges[link.badgeKey] : undefined;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onNavigate}
                  className={`relative flex items-center gap-2.5 rounded-[12px] min-h-[36px] px-3 transition-all duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-accent ${
                    collapsed ? "lg:justify-center lg:px-0" : ""
                  } ${
                    active
                      ? "bg-panel text-ink shadow-lift"
                      : "text-muted hover:bg-ink/[0.04] hover:text-ink"
                  }`}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? link.label : undefined}
                  title={collapsed ? link.label : undefined}
                >
                  <Icon
                    size={17}
                    className={`shrink-0 transition-colors ${active ? "text-ink" : "text-faint"}`}
                  />
                  <span className={`text-[14px] leading-tight tracking-[-0.005em] truncate ${collapsed ? "lg:hidden" : ""}`}>
                    {link.label}
                  </span>
                  {badge !== undefined && badge !== 0 && badge !== "" && (
                    <span
                      className={`ml-auto min-w-[22px] h-[22px] inline-flex items-center justify-center rounded-full px-1.5 text-[12px] font-semibold tabular-nums bg-ink text-panel-2 ${collapsed ? "lg:hidden" : ""}`}
                    >
                      {badge}
                    </span>
                  )}
                  {/* Hover label — only rendered when the rail is collapsed. */}
                  {collapsed && (
                    <span className="hidden lg:flex absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2 z-[70] items-center px-3 py-1.5 rounded-[10px] bg-panel border border-hairline shadow-lift text-[13px] font-medium text-ink whitespace-nowrap pointer-events-none opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150">
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
    </>
  );
}
