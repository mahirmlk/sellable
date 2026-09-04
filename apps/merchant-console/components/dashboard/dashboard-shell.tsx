"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { DashboardSidebar } from "./dashboard-sidebar";

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

  const toggleCollapsed = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, getSnapshot() ? "0" : "1");
    } catch {
      // Persistence is best-effort; the toggle still applies for the session.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return (
    <div className="flex min-h-screen">
      <DashboardSidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      <div
        className={`flex-1 flex flex-col min-h-screen transition-[margin] duration-300 ease-in-out ${
          collapsed ? "lg:ml-[56px]" : "lg:ml-[240px]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
