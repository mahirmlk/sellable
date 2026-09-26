"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { DashboardSidebar } from "./dashboard-sidebar";
import { CommandMenu } from "./command-menu";
import { ToastViewport } from "./toasts";
import { getConsoleApprovals } from "@/lib/api";

const STORAGE_KEY = "sellable_sidebar_collapsed";
const CHANGE_EVENT = "sellable:sidebar-collapsed-changed";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Server snapshot: the rail always starts expanded during SSR. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Owns the sidebar collapse state so the content margin and the sidebar
 * width move together. The choice persists across reloads via localStorage;
 * useSyncExternalStore keeps SSR hydration consistent (expanded on server)
 * without a setState-in-effect flash.
 */
export function DashboardShell({ children }: { children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [badges, setBadges] = useState<Record<string, number | string>>({});

  // Live sidebar counts (NavItem.badgeKey) — pending approvals today.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getConsoleApprovals()
        .then((list) => {
          if (cancelled) return;
          const pending = list.filter((a) => a.status === "PENDING").length;
          setBadges((prev) => (prev.approvals === pending ? prev : { ...prev, approvals: pending }));
        })
        .catch(() => {});
    };
    load();
    const t = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const toggleCollapsed = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, getSnapshot() ? "0" : "1");
    } catch {
      // Persistence is best-effort; the toggle still applies for the session.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  // next-themes drives data-theme (light/dark/system) on <html>;
  // the dashboard CSS keys off [data-theme], not .dark.
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
    <div className="dashboard-app flex min-h-screen text-ink">
      <DashboardSidebar collapsed={collapsed} onToggle={toggleCollapsed} badges={badges} />
      <div
        className={`flex-1 flex flex-col min-h-screen min-w-0 transition-[margin] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          collapsed ? "lg:ml-[64px]" : "lg:ml-[240px]"
        }`}
      >
        {children}
      </div>
      <CommandMenu />
      <ToastViewport />
    </div>
    </ThemeProvider>
  );
}
