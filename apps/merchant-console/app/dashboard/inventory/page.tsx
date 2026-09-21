"use client";

// Inventory (route /dashboard/inventory): backed ENTIRELY by
// getConsoleCatalog + Product.stock. Header counts, stock-band tabs, rows of
// Product / SKU / Available / Status. No history, warehouses, movements, or
// adjustments — there is no backend for those.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { getConsoleCatalog, type Product } from "@/lib/api";
import {
  DataTable,
  EmptyState,
  ErrorBanner,
  FilterTabs,
  PageHeader,
  RefreshButton,
  StockBadge,
  TableSkeleton,
} from "../_components/tier1-ui";
import {
  LOW_STOCK_THRESHOLD,
  exportToCsv,
  stockState,
  type StockState,
} from "../_components/tier1-data";

type InventoryTab = "all" | StockState;

export default function InventoryPage() {
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<InventoryTab>("all");
  const [query, setQuery] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setCatalog(await getConsoleCatalog());
    } catch (err) {
      setCatalog([]);
      setLoadError(
        err instanceof TypeError
          ? "Backend unreachable — inventory could not be loaded."
          : "Inventory could not be loaded from the backend."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const counts = useMemo(() => {
    const c: Record<InventoryTab, number> = { all: catalog.length, in: 0, low: 0, out: 0 };
    for (const p of catalog) c[stockState(p.stock)] += 1;
    return c;
  }, [catalog]);

  const totalUnits = useMemo(() => catalog.reduce((sum, p) => sum + p.stock, 0), [catalog]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((p) => (tab === "all" ? true : stockState(p.stock) === tab))
      .filter((p) =>
        q ? `${p.sku} ${p.title} ${p.category}`.toLowerCase().includes(q) : true
      )
      .sort((a, b) => a.stock - b.stock || a.title.localeCompare(b.title));
  }, [catalog, tab, query]);

  const handleExport = useCallback(() => {
    exportToCsv(
      "inventory.csv",
      visible.map((p) => ({
        sku: p.sku,
        title: p.title,
        category: p.category,
        available: p.stock,
        status:
          stockState(p.stock) === "in"
            ? "IN STOCK"
            : stockState(p.stock) === "low"
              ? "LOW STOCK"
              : "OUT OF STOCK",
      }))
    );
  }, [visible]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Inventory"
        subtitle="LIVE STOCK LEVELS FROM YOUR CATALOG"
        actions={
          <>
            <button
              onClick={handleExport}
              disabled={visible.length === 0}
              className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50"
            >
              <Download size={12} /> EXPORT
            </button>
            <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
          </>
        }
      />

      {/* Header counts — derived from loaded records */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border border-[var(--bb-line)] p-4 bg-[var(--bb-panel)]">
              <div className="skeleton h-3 w-20 mb-3" />
              <div className="skeleton h-7 w-16" />
            </div>
          ))}
        </div>
      ) : loadError ? null : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Products tracked", value: String(catalog.length) },
            { label: "Units available", value: String(totalUnits) },
            { label: "Low stock", value: String(counts.low) },
            { label: "Out of stock", value: String(counts.out) },
          ].map((m) => (
            <div key={m.label} className="border border-[var(--bb-line)] p-4 bg-[var(--bb-panel)]">
              <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)] mb-3">
                {m.label}
              </div>
              <div className="font-[var(--font-mono)] text-[1.35rem] leading-none tabular-nums tracking-tight text-[var(--bb-white)]">
                {m.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <FilterTabs<InventoryTab>
        tabs={[
          { key: "all", label: "All", count: counts.all },
          { key: "in", label: "In stock", count: counts.in },
          { key: "low", label: "Low stock", count: counts.low },
          { key: "out", label: "Out of stock", count: counts.out },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search inventory…"
          className="flex-1 min-w-[180px] max-w-[300px] font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
        />
        <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] ml-auto">
          {visible.length} of {catalog.length} products
        </span>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={catalog.length === 0 ? "No inventory yet" : "Nothing in this view"}
          message={
            catalog.length === 0
              ? "Your inventory is empty — add products to your catalog and stock levels will appear here."
              : "No products fall into this stock band right now."
          }
          action={
            catalog.length === 0 ? (
              <Link
                href="/dashboard/catalog"
                className="inline-flex items-center h-[32px] px-4 bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors cursor-pointer"
              >
                GO TO PRODUCTS
              </Link>
            ) : undefined
          }
        />
      ) : (
        <DataTable>
          <div className="hidden lg:grid grid-cols-[1fr_140px_120px_140px] gap-3 px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
            {["PRODUCT", "SKU", "AVAILABLE", "STATUS"].map((h) => (
              <div key={h} className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">{h}</div>
            ))}
          </div>
          {visible.map((p, i) => (
            <Link
              key={p.id}
              href={`/dashboard/catalog/${p.sku}`}
              className={`hidden lg:grid grid-cols-[1fr_140px_120px_140px] gap-3 px-5 py-3 items-center hover:bg-[var(--bb-panel)] transition-colors ${
                i < visible.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
              }`}
            >
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-white)] truncate">
                {p.title}
                <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] uppercase text-[var(--bb-grey-4)] ml-2">
                  {p.category}
                </span>
              </div>
              <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">{p.sku}</div>
              <div className="font-[var(--font-mono)] text-[0.78rem] text-[var(--bb-white)] tabular-nums">{p.stock}</div>
              <StockBadge stock={p.stock} threshold={LOW_STOCK_THRESHOLD} />
            </Link>
          ))}
          {/* Mobile cards */}
          <div className="lg:hidden divide-y divide-[var(--bb-line-soft)]">
            {visible.map((p) => (
              <Link key={p.id} href={`/dashboard/catalog/${p.sku}`} className="block px-5 py-3.5 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-white)] leading-snug truncate">
                    {p.title}
                  </span>
                  <span className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-white)] tabular-nums shrink-0">
                    {p.stock}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] uppercase text-[var(--bb-grey-4)]">
                    {p.sku} · {p.category}
                  </span>
                  <StockBadge stock={p.stock} threshold={LOW_STOCK_THRESHOLD} />
                </div>
              </Link>
            ))}
          </div>
        </DataTable>
      )}
    </div>
  );
}
