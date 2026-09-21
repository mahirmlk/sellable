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
        className="absolute inset-0 bg-black/60"
        onClick={close}
        aria-hidden
      />
      <div className="relative w-full max-w-[480px] overflow-hidden border border-[var(--bb-line)] bg-[var(--bb-panel)] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[var(--bb-line)] px-4">
          <span
            className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-3)]"
            aria-hidden
          >
            ⌘K
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
            placeholder="Go to… (type a page name)"
            aria-label="Go to page"
            className="h-12 w-full bg-transparent font-[var(--font-sans)] text-[0.9rem] text-[var(--bb-white)] outline-none placeholder:text-[var(--bb-grey-3)]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="cursor-pointer font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-3)] hover:text-[var(--bb-white)]"
            >
              CLEAR
            </button>
          ) : null}
        </div>
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1" role="listbox">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-2)]">
              No pages match “{query.trim()}”.
            </p>
          ) : (
            results.map((item, i) => {
              const Icon = item.icon;
              const active = i === safeIndex;
              return (
                <button
                  key={item.href}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-active={active}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => go(item.href)}
                  className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    active ? "bg-[var(--bb-panel-3)]" : "bg-transparent"
                  }`}
                >
                  <Icon
                    size={14}
                    className={`shrink-0 ${active ? "text-[var(--bb-orange)]" : "text-[var(--bb-grey-3)]"}`}
                  />
                  <span className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)]">
                    {item.label}
                  </span>
                  <span className="ml-auto font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">
                    {item.section}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-[var(--bb-line)] px-4 py-2">
          <span className="font-[var(--font-mono)] text-[0.58rem] text-[var(--bb-grey-4)]">
            ↑↓ NAVIGATE
          </span>
          <span className="font-[var(--font-mono)] text-[0.58rem] text-[var(--bb-grey-4)]">
            ↵ OPEN
          </span>
          <span className="font-[var(--font-mono)] text-[0.58rem] text-[var(--bb-grey-4)]">
            ESC CLOSE
          </span>
        </div>
      </div>
    </div>
  );
}
