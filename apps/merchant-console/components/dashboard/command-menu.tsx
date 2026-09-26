"use client";

// Global command palette: Cmd+K / Ctrl+K — real actions + real data search.
//
// With a query typed it shows three data sections: Commands (nav-config with
// the subsequence fuzzy filter), Products (getConsoleCatalog — server-side
// search, debounced 250ms with a generation guard) and Orders (client-side
// match over getConsoleTransactions on order id / buyer id / item SKU), plus
// an Actions group only when an action actually matches. With an empty query
// it shows Commands, Actions, and a small "Recent" group of records opened
// from here — ids persisted via lib/recent-records and re-resolved against
// the live API (unresolvable ids drop out; nothing is ever fabricated).
// Enter/click navigates to the real detail route; ⌘K toggles, Esc closes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CornerDownLeft,
  MessageSquarePlus,
  Package,
  Plus,
  Receipt,
  SunMoon,
} from "lucide-react";
import { NAV_ITEMS_WITH_SECTION, type NavIcon } from "./nav-config";
import { StatusBadge } from "./status-badge";
import { Kbd } from "@/components/ui/kbd";
import { useTheme } from "next-themes";
import { IconSearch } from "./icons";
import {
  getConsoleCatalog,
  getConsoleCatalogItem,
  getConsoleTransactions,
  type ConsoleTransaction,
  type Product,
} from "@/lib/api";
import { formatPaise } from "@/lib/formatters";
import { mapConsoleTx } from "@/lib/commerce-view";
import {
  readRecentRecords,
  recordRecentVisit,
  type RecentRecordRef,
} from "@/lib/recent-records";
import type { TransactionStatus } from "@/lib/types/domain";

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

/** Client-side order match: order id, buyer id, or any line-item SKU. */
function orderMatches(query: string, order: ConsoleTransaction): boolean {
  const needle = query.toLowerCase();
  const hay = `${order.order_id} ${order.buyer_agent_id} ${(order.items ?? [])
    .map((i) => i.sku)
    .join(" ")}`.toLowerCase();
  return hay.includes(needle);
}

// --- Row model ---------------------------------------------------------------

type PaletteItem =
  | {
      kind: "nav";
      key: string;
      label: string;
      meta: string;
      icon: NavIcon;
      href: string;
    }
  | {
      kind: "action";
      key: string;
      label: string;
      meta: string;
      icon: NavIcon;
      run: () => void;
    }
  | { kind: "product"; key: string; icon: NavIcon; href: string; product: Product }
  | {
      kind: "order";
      key: string;
      icon: NavIcon;
      href: string;
      order: ConsoleTransaction;
      status: TransactionStatus;
    };

interface PaletteSection {
  id: string;
  label: string;
  items: PaletteItem[];
  /** Inline status line shown under the header while loading or on error. */
  note?: string;
}

function productItem(product: Product): PaletteItem {
  return {
    kind: "product",
    key: `product:${product.sku}`,
    icon: Package,
    href: `/dashboard/catalog/${product.sku}`,
    product,
  };
}

function orderItem(order: ConsoleTransaction): PaletteItem {
  return {
    kind: "order",
    key: `order:${order.order_id}`,
    icon: Receipt,
    href: `/dashboard/transactions/${order.order_id}`,
    order,
    status: mapConsoleTx(order).status,
  };
}

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div role="presentation" className="flex items-baseline gap-1 px-3 pt-3 pb-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
        {label}
      </span>
      {count !== undefined ? (
        <span data-numeric className="text-[11px] text-faint">
          ({count})
        </span>
      ) : null}
    </div>
  );
}

function PaletteRow({
  item,
  active,
  onHover,
  onActivate,
}: {
  item: PaletteItem;
  active: boolean;
  onHover: (key: string) => void;
  onActivate: (item: PaletteItem) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      id={`cmd-${item.key}`}
      type="button"
      role="option"
      aria-selected={active}
      data-active={active}
      onMouseEnter={() => onHover(item.key)}
      onClick={() => onActivate(item)}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
        active ? "bg-panel-3" : "bg-transparent"
      }`}
    >
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-hairline shadow-card ${
          active ? "bg-panel text-ink" : "bg-panel-2 text-muted"
        }`}
      >
        <Icon size={15} className="shrink-0" />
      </span>
      {item.kind === "product" ? (
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[14px] font-medium text-ink">
            {item.product.title}
          </span>
          <span className="flex items-center gap-2 text-[12px] text-muted">
            <span data-numeric className="shrink-0">
              {formatPaise(item.product.price_paise)}
            </span>
            <span className="text-faint" aria-hidden>
              ·
            </span>
            <span className="truncate font-mono text-faint">{item.product.sku}</span>
          </span>
        </span>
      ) : item.kind === "order" ? (
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
          <span className="max-w-full truncate font-mono text-[13px] font-medium text-ink">
            #{item.order.order_id}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <span data-numeric className="text-[12px] text-muted">
              {formatPaise(item.order.amount_paise)}
            </span>
            <StatusBadge status={item.status} />
          </span>
        </span>
      ) : (
        <>
          <span className="truncate text-[15px] font-medium text-ink">{item.label}</span>
          <span className="ml-auto shrink-0 text-[12px] text-faint">{item.meta}</span>
        </>
      )}
      {active ? (
        <CornerDownLeft size={14} className="shrink-0 text-accent-strong" aria-hidden />
      ) : null}
    </button>
  );
}

// --- Palette (mounts fresh per open, so no state leaks between openings) ------

interface ProductSearch {
  q: string;
  done: boolean;
  failed: boolean;
  items: Product[];
}

function CommandPalette({
  recentRefs,
  onClose,
}: {
  recentRefs: RecentRecordRef[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // --- Real product search (server-side). Debounced 250ms; results are keyed
  // by the query they were fetched for and guarded by a generation counter, so
  // a slow earlier response can never overwrite a newer one (catalog page
  // pattern). While pending there are no rows — only the "Searching…" line.
  const [productSearch, setProductSearch] = useState<ProductSearch | null>(null);
  const productsGen = useRef(0);

  useEffect(() => {
    if (!q) return;
    const gen = ++productsGen.current;
    const timer = window.setTimeout(() => {
      setProductSearch({ q, done: false, failed: false, items: [] });
      getConsoleCatalog(q).then(
        (items) => {
          if (productsGen.current === gen) {
            setProductSearch({ q, done: true, failed: false, items });
          }
        },
        () => {
          if (productsGen.current === gen) {
            setProductSearch({ q, done: true, failed: true, items: [] });
          }
        }
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const productResult = productSearch && productSearch.q === q ? productSearch : null;
  const productsPending = Boolean(q) && (!productResult || !productResult.done);
  const productsFailed = Boolean(productResult?.done && productResult.failed);

  // --- Real order list (getConsoleTransactions): powers order search and
  // Recent order resolution. Fetched at most once per palette open, and only
  // when a query or a recent order ref actually needs it.
  const hasOrderRefs = recentRefs.some((r) => r.type === "order");
  const needsOrders = Boolean(q) || hasOrderRefs;
  const [orderLoad, setOrderLoad] = useState<{
    done: boolean;
    failed: boolean;
    orders: ConsoleTransaction[];
  }>({ done: false, failed: false, orders: [] });
  const ordersRequested = useRef(false);
  const ordersGen = useRef(0);

  useEffect(() => {
    if (ordersRequested.current || !needsOrders) return;
    ordersRequested.current = true;
    const gen = ++ordersGen.current;
    void getConsoleTransactions().then(
      (orders) => {
        if (ordersGen.current === gen) {
          setOrderLoad({ done: true, failed: false, orders });
        }
      },
      () => {
        if (ordersGen.current === gen) {
          setOrderLoad({ done: true, failed: true, orders: [] });
        }
      }
    );
  }, [needsOrders]);

  const ordersPending = needsOrders && !orderLoad.done;
  const ordersFailed = orderLoad.done && orderLoad.failed;

  // --- Recent: resolve persisted product refs to real records (orders resolve
  // from the list above). Unresolvable refs are skipped — never fabricated.
  const productRefIds = useMemo(
    () => recentRefs.filter((r) => r.type === "product").map((r) => r.id),
    [recentRefs]
  );
  const [recentResolved, setRecentResolved] = useState<{
    done: boolean;
    products: Product[];
  }>({ done: false, products: [] });
  const recentGen = useRef(0);

  useEffect(() => {
    if (productRefIds.length === 0) return;
    const gen = ++recentGen.current;
    void Promise.allSettled(productRefIds.map((id) => getConsoleCatalogItem(id))).then(
      (settled) => {
        if (recentGen.current !== gen) return;
        setRecentResolved({
          done: true,
          products: settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
        });
      }
    );
  }, [productRefIds]);

  const recentPending =
    (productRefIds.length > 0 && !recentResolved.done) || (hasOrderRefs && !orderLoad.done);

  // --- Derived row model ---
  const commandItems = useMemo<PaletteItem[]>(
    () =>
      NAV_ITEMS_WITH_SECTION.filter((item) =>
        fuzzyMatch(q, `${item.label} ${item.section}`)
      ).map((item) => ({
        kind: "nav",
        key: `nav:${item.href}`,
        label: item.label,
        meta: item.section,
        icon: item.icon,
        href: item.href,
      })),
    [q]
  );

  const { resolvedTheme, setTheme } = useTheme();
  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  // Real app capabilities only. CSV export is intentionally absent: the real
  // export lives on the Orders page over its loaded/filtered records and can
  // not be triggered from here without faking it.
  const actionItems = useMemo<PaletteItem[]>(() => {
    const actions: Array<{
      key: string;
      label: string;
      meta: string;
      icon: NavIcon;
      run: () => void;
    }> = [
      {
        key: "action:ai-sales",
        label: "Open new AI Sales session",
        meta: "AI Sales",
        icon: MessageSquarePlus,
        run: () => {
          onClose();
          router.push("/dashboard/chat");
        },
      },
      {
        key: "action:add-product",
        label: "Add a product",
        meta: "Products",
        icon: Plus,
        run: () => {
          onClose();
          router.push("/dashboard/catalog");
        },
      },
      {
        key: "action:toggle-theme",
        label: "Toggle theme",
        meta: "Appearance",
        icon: SunMoon,
        run: () => {
          toggleTheme();
          onClose();
        },
      },
    ];
    return actions
      .filter((a) => fuzzyMatch(q, `${a.label} ${a.meta}`))
      .map((a) => ({ kind: "action", ...a }));
  }, [onClose, router, toggleTheme, q]);

  const productItems = useMemo<PaletteItem[]>(
    () =>
      productResult?.done && !productResult.failed ? productResult.items.map(productItem) : [],
    [productResult]
  );

  const orderItems = useMemo<PaletteItem[]>(() => {
    const list = q ? orderLoad.orders.filter((o) => orderMatches(q, o)) : orderLoad.orders;
    return list.map(orderItem);
  }, [orderLoad.orders, q]);

  const recentItems = useMemo<PaletteItem[]>(() => {
    const bySku = new Map(recentResolved.products.map((p) => [p.sku, p]));
    const out: PaletteItem[] = [];
    for (const ref of recentRefs) {
      if (ref.type === "product") {
        const product = bySku.get(ref.id);
        if (product) out.push(productItem(product));
      } else {
        const order = orderLoad.orders.find((o) => o.order_id === ref.id);
        if (order) out.push(orderItem(order));
      }
    }
    return out;
  }, [recentRefs, recentResolved.products, orderLoad.orders]);

  const { sections, flatItems, indexByKey } = useMemo(() => {
    const out: PaletteSection[] = [];
    if (!q) {
      out.push({ id: "commands", label: "Commands", items: commandItems });
      out.push({ id: "actions", label: "Actions", items: actionItems });
      if (recentRefs.length > 0) {
        out.push({
          id: "recent",
          label: "Recent",
          items: recentItems,
          note: recentPending ? "Searching…" : undefined,
        });
      }
    } else {
      if (commandItems.length > 0) {
        out.push({ id: "commands", label: "Commands", items: commandItems });
      }
      if (actionItems.length > 0) {
        out.push({ id: "actions", label: "Actions", items: actionItems });
      }
      if (productItems.length > 0 || productsPending || productsFailed) {
        out.push({
          id: "products",
          label: "Products",
          items: productItems,
          note: productsPending
            ? "Searching…"
            : productsFailed
              ? "Products unavailable right now."
              : undefined,
        });
      }
      if (orderItems.length > 0 || ordersPending || ordersFailed) {
        out.push({
          id: "orders",
          label: "Orders",
          items: orderItems,
          note: ordersPending
            ? "Searching…"
            : ordersFailed
              ? "Orders unavailable right now."
              : undefined,
        });
      }
    }
    const visible = out.filter((s) => s.items.length > 0 || s.note);
    const flat: PaletteItem[] = [];
    const byKey = new Map<string, number>();
    for (const section of visible) {
      for (const item of section.items) {
        byKey.set(item.key, flat.length);
        flat.push(item);
      }
    }
    return { sections: visible, flatItems: flat, indexByKey: byKey };
  }, [
    q,
    commandItems,
    actionItems,
    productItems,
    orderItems,
    recentItems,
    recentRefs.length,
    recentPending,
    productsPending,
    productsFailed,
    ordersPending,
    ordersFailed,
  ]);

  // Clamped at render time so keyboard nav never points past the list.
  const safeIndex = Math.max(0, Math.min(activeIndex, flatItems.length - 1));
  const activeItem = flatItems[safeIndex];

  const onQueryChange = useCallback((value: string) => {
    setQuery(value);
    setActiveIndex(0);
  }, []);

  const activate = useCallback(
    (item: PaletteItem) => {
      if (item.kind === "action") {
        item.run();
        return;
      }
      if (item.kind === "product") {
        recordRecentVisit({ type: "product", id: item.product.sku });
      } else if (item.kind === "order") {
        recordRecentVisit({ type: "order", id: item.order.order_id });
      }
      onClose();
      router.push(item.href);
    },
    [onClose, router]
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

  const onHover = useCallback(
    (key: string) => {
      const index = indexByKey.get(key);
      if (index !== undefined) setActiveIndex(index);
    },
    [indexByKey]
  );

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search products, orders, and commands"
    >
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-[620px] overflow-hidden rounded-[20px] bg-panel border border-hairline shadow-pop">
        <div className="flex items-center gap-3 border-b border-hairline px-4">
          <IconSearch size={15} className="text-faint shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                onHighlight(Math.min(safeIndex + 1, flatItems.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                onHighlight(Math.max(safeIndex - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (activeItem) activate(activeItem);
              }
            }}
            placeholder="Search products, orders, or commands…"
            aria-label="Search products, orders, and commands"
            aria-activedescendant={activeItem ? `cmd-${activeItem.key}` : undefined}
            className="h-12 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="flex size-7 cursor-pointer items-center justify-center rounded-full text-[13px] text-faint transition-colors hover:bg-panel-3 hover:text-ink"
            >
              ×
            </button>
          ) : (
            <Kbd className="kbd-chip hidden sm:inline-flex">ESC</Kbd>
          )}
        </div>

        <div
          ref={listRef}
          className="max-h-[380px] overflow-y-auto p-2"
          role="listbox"
          aria-label="Results"
        >
          {sections.length === 0 ? (
            <p className="font-display px-4 py-10 text-center text-[16px] text-muted">
              No matches for “{q}”.
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.id} role="group" aria-label={section.label}>
                <SectionHeader
                  label={section.label}
                  count={section.note ? undefined : section.items.length}
                />
                {section.note ? (
                  <p className="px-3 pt-0.5 pb-1 text-[13px] text-faint">{section.note}</p>
                ) : null}
                {section.items.map((item) => (
                  <PaletteRow
                    key={item.key}
                    item={item}
                    active={activeItem?.key === item.key}
                    onHover={onHover}
                    onActivate={activate}
                  />
                ))}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-hairline px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-faint">
            <Kbd className="kbd-chip">↑↓</Kbd> Navigate
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-faint">
            <Kbd className="kbd-chip">↵</Kbd> Open
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-faint">
            <Kbd className="kbd-chip">esc</Kbd> Close
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-faint">
            <Kbd className="kbd-chip">/</Kbd> Search anywhere
          </span>
        </div>
      </div>
    </div>
  );
}

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [recentRefs, setRecentRefs] = useState<RecentRecordRef[]>([]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const openMenu = useCallback(() => {
    // localStorage is read in an event handler, never during render.
    setRecentRefs(readRecentRecords());
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else openMenu();
      } else if (e.key === "/" && !typing) {
        // "/" focuses search from anywhere (skips when already typing).
        e.preventDefault();
        openMenu();
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

  if (!open) return null;
  return <CommandPalette recentRefs={recentRefs} onClose={close} />;
}
