"use client";

// Global command menu: Cmd+K / Ctrl+K, navigation-only. Lists every item from
// nav-config with a subsequence fuzzy filter; Enter navigates via next/router.
// Pure frontend — no backend calls.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NAV_ITEMS_WITH_SECTION } from "./nav-config";

export const OPEN_COMMAND_MENU_EVENT = "sellable:open-command-menu";

/** Subsequence fuzzy match: all query chars appear in order in the target. */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const openMenu = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else openMenu();
      } else if (e.key === "Escape" && open) {
        close();
      }
    };
    const onOpenEvent = () => openMenu();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_MENU_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_MENU_EVENT, onOpenEvent);
    };
  }, [open, close, openMenu]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return NAV_ITEMS_WITH_SECTION;
    return NAV_ITEMS_WITH_SECTION.filter((item) =>
      fuzzyMatch(q, `${item.label} ${item.section}`)
    );
  }, [query]);

  // Clamped at render time so keyboard nav never points past the list.
  // (activeIndex resets to 0 whenever the query changes via onQueryChange.)
  const safeIndex = Math.max(0, Math.min(activeIndex, results.length - 1));

  const onQueryChange = useCallback((value: string) => {
    setQuery(value);
    setActiveIndex(0);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  // Keep the highlighted row visible while arrowing through the list.
  const onHighlight = useCallback((index: number) => {
    setActiveIndex(index);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector('[data-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Go to page"
    >
      <div
        className="absolute inset-0 bg-neutral-900/30 backdrop-blur-sm"
        onClick={close}
        aria-hidden
      />
      <div className="relative w-full max-w-[560px] overflow-hidden rounded-[14px] bg-white/80 backdrop-blur-2xl border border-white/40 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.25)]">
        <div className="flex items-center gap-3 border-b border-black/[0.06] px-4">
          <span
            className="text-[15px] text-neutral-400"
            aria-hidden
          >
            ⌕
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                onHighlight(Math.min(safeIndex + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                onHighlight(Math.max(safeIndex - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const target = results[safeIndex];
                if (target) go(target.href);
              }
            }}
            placeholder="Search pages…"
            aria-label="Go to page"
            aria-activedescendant={results[safeIndex] ? `cmd-${results[safeIndex].href}` : undefined}
            className="h-12 w-full bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="flex items-center justify-center size-7 rounded-full cursor-pointer text-[13px] text-neutral-400 hover:text-neutral-900 hover:bg-black/[0.05] transition-colors"
            >
              ×
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center h-5 px-1.5 rounded-md bg-white border border-black/10 shadow-sm text-[11px] font-medium text-neutral-500">
              ESC
            </kbd>
          )}
        </div>
        <div ref={listRef} className="max-h-[320px] overflow-y-auto p-2" role="listbox">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-[14px] text-neutral-500">
              No pages match “{query.trim()}”.
            </p>
          ) : (
            results.map((item, i) => {
              const Icon = item.icon;
              const active = i === safeIndex;
              return (
                <button
                  key={item.href}
                  id={`cmd-${item.href}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-active={active}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => go(item.href)}
                  className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
                    active ? "bg-black/[0.05]" : "bg-transparent"
                  }`}
                >
                  <span className={`flex items-center justify-center size-8 rounded-[10px] border shadow-sm shrink-0 ${active ? "bg-white border-black/10 text-neutral-900" : "bg-neutral-50 border-black/[0.06] text-neutral-500"}`}>
                    <Icon
                      size={15}
                      className="shrink-0"
                    />
                  </span>
                  <span className="text-[15px] font-medium text-neutral-900">
                    {item.label}
                  </span>
                  <span className="ml-auto text-[12px] text-neutral-400">
                    {item.section}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-black/[0.06] bg-white/60 px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400">
            <kbd className="inline-flex items-center h-5 px-1.5 rounded-md bg-white border border-black/10 shadow-sm text-[11px]">↑↓</kbd> Navigate
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400">
            <kbd className="inline-flex items-center h-5 px-1.5 rounded-md bg-white border border-black/10 shadow-sm text-[11px]">↵</kbd> Open
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400">
            <kbd className="inline-flex items-center h-5 px-1.5 rounded-md bg-white border border-black/10 shadow-sm text-[11px]">esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
