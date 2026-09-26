"use client";

// Inventory (route /dashboard/inventory): backed ENTIRELY by
// getConsoleCatalog + Product.stock. Header counts, stock-band tabs, rows of
// Product / SKU / Available / Status. Column headers sort client-side
// (aria-sort on the th); the footer paginates 25 rows with totals. No history,
// warehouses, movements, or adjustments — there is no backend for those.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { getConsoleCatalog, type Product } from "@/lib/api";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { DataTable } from "@/components/dashboard/data-table";
import {
  FilterTabs,
  RefreshButton,
  SavedViewsBar,
  StockBadge,
} from "@/components/dashboard/commerce-ui";
import {
  dirOf,
  pageCountOf,
  pageSlice,
  sortBy,
  SortableTh,
  TablePagination,
  type SortColumn,
  type SortDir,
} from "@/components/dashboard/table-affordances";
import { exportToCsv } from "@/lib/csv";
import { toast } from "@/components/dashboard/toasts";
import {
  LOW_STOCK_THRESHOLD,
  stockState,
  type StockState,
} from "@/lib/commerce-view";

type InventoryTab = "all" | StockState;
type InventorySort =
  | "default"
  | "title-asc"
  | "title-desc"
  | "sku-asc"
  | "sku-desc"
  | "stock-asc"
  | "stock-desc"
  | "status-asc"
  | "status-desc";

const BAND_RANK: Record<StockState, number> = { out: 0, low: 1, in: 2 };

interface InventoryView {
  tab: InventoryTab;
  sort: InventorySort;
}

export default function InventoryPage() {
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<InventoryTab>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<InventorySort>("default");
  const [page, setPage] = useState(1);

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

  // Sortable columns. Available sorts on the stock number (title tiebreak,
  // matching the historical default order), Status on the derived stock band,
  // text columns locale-aware — all client-side over the loaded rows.
  const sortColumns = useMemo<Array<SortColumn<Product, InventorySort>>>(
    () => [
      { id: "product", label: "Product", asc: "title-asc", desc: "title-desc", first: "asc", value: (p) => p.title },
      { id: "sku", label: "SKU", asc: "sku-asc", desc: "sku-desc", first: "asc", width: "w-[140px]", value: (p) => p.sku },
      { id: "available", label: "Available", asc: "stock-asc", desc: "stock-desc", first: "asc", width: "w-[120px]", value: (p) => p.stock, tiebreak: (p) => p.title },
      { id: "status", label: "Status", asc: "status-asc", desc: "status-desc", first: "asc", width: "w-[140px]", value: (p) => BAND_RANK[stockState(p.stock)] },
    ],
    []
  );

  // The historical default (stock ascending, then title) is the "Available"
  // column sorted ascending — clicking it toggles straight to descending.
  const eff: InventorySort = sort === "default" ? "stock-asc" : sort;
  const activeCol = sortColumns.find((c) => dirOf(c, eff) !== null);
  const activeDir: SortDir | null = activeCol ? dirOf(activeCol, eff) : null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = catalog
      .filter((p) => (tab === "all" ? true : stockState(p.stock) === tab))
      .filter((p) =>
        q ? `${p.sku} ${p.title} ${p.category}`.toLowerCase().includes(q) : true
      );
    return activeCol && activeDir
      ? sortBy(rows, activeCol.value, activeDir, activeCol.tiebreak)
      : rows;
  }, [catalog, tab, query, activeCol, activeDir]);

  const handleExport = useCallback(() => {
    const rows = visible.map((p) => ({
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
    }));
    exportToCsv("inventory.csv", rows);
    toast({ tone: "success", title: "Exported inventory.csv", description: `${rows.length} rows` });
  }, [visible]);

  const applyView = useCallback((v: InventoryView) => {
    setTab(v.tab);
    setSort(v.sort);
    setPage(1);
  }, []);

  // Header click: idle column → its first direction; active column → toggle asc/desc.
  const handleSort = useCallback(
    (c: SortColumn<Product, InventorySort>) => {
      const dir = dirOf(c, eff);
      setSort(dir === null ? (c.first === "asc" ? c.asc : c.desc) : dir === "asc" ? c.desc : c.asc);
      setPage(1);
    },
    [eff]
  );

  const pageCount = pageCountOf(visible.length);
  const current = Math.min(page, pageCount);
  const pageRows = pageSlice(visible, current);

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="Inventory"
        subtitle="Live stock levels from your catalog"
        actions={
          <>
            <button
              onClick={handleExport}
              disabled={visible.length === 0}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:text-neutral-900 hover:shadow transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98]"
            >
              <Download size={14} /> Export
            </button>
            <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
          </>
        }
      />

      {/* Header counts — derived from loaded records */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl bg-panel border border-black/[0.05] p-6 space-y-3">
              <div className="h-3 w-20 animate-pulse rounded-lg bg-black/[0.06]" />
              <div className="h-7 w-16 animate-pulse rounded-lg bg-black/[0.06]" />
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
            <div key={m.label} className="rounded-[18px] bg-panel border border-hairline shadow-card p-5 transition-all duration-200 hover:-translate-y-px">
              <div className="text-[13px] font-medium text-neutral-500 mb-2">
                {m.label}
              </div>
              <div className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-neutral-900">
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
        onChange={(t) => {
          setTab(t);
          setPage(1);
        }}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search inventory…"
          aria-label="Search inventory"
          className="flex-1 min-w-[180px] max-w-[320px] h-9 rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-3 placeholder:text-neutral-400 focus:outline-none focus:border-hairline focus:ring-[3px] focus:ring-ink/20 transition-shadow"
        />
        <span className="text-[12px] text-neutral-400 ml-auto tabular-nums">
          {visible.length} of {catalog.length} products
        </span>
      </div>

      <SavedViewsBar<InventoryView>
        storageKey="inventory"
        current={{ tab, sort }}
        onApply={applyView}
      />

      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={catalog.length === 0 ? "No inventory yet" : "Nothing in this view"}
          message={
            catalog.length === 0
              ? "Your inventory is empty — add products to your catalog and stock levels will appear here."
              : query.trim()
                ? "No products match the current search and filters."
                : "No products fall into this stock band right now."
          }
          action={
            catalog.length === 0 ? (
              <Link
                href="/dashboard/catalog"
                className="inline-flex items-center h-9 px-5 rounded-full bg-ink text-[13px] font-semibold text-white shadow-sm hover:bg-ink-2 transition-colors"
              >
                Go to products
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          <DataTable>
            <div className="hidden lg:block">
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr>
                    {sortColumns.map((c) => {
                      const dir = dirOf(c, eff);
                      return (
                        <SortableTh
                          key={c.id}
                          label={c.label}
                          active={dir !== null}
                          dir={dir ?? c.first}
                          className={c.width}
                          onSort={() => handleSort(c)}
                        />
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr key={p.id} className="relative">
                      <td>
                        <div className="truncate text-[15px] font-medium text-neutral-900">
                          <Link
                            href={`/dashboard/catalog/${p.sku}`}
                            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            {p.title}
                          </Link>
                          <span className="text-[12px] font-normal text-neutral-400 ml-2">
                            {p.category}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="text-[13px] text-neutral-500 tabular-nums">{p.sku}</div>
                      </td>
                      <td>
                        <div className="text-[15px] font-semibold text-neutral-900 tabular-nums">{p.stock}</div>
                      </td>
                      <td>
                        <StockBadge stock={p.stock} threshold={LOW_STOCK_THRESHOLD} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-black/[0.05]">
              {pageRows.map((p) => (
                <Link key={p.id} href={`/dashboard/catalog/${p.sku}`} className="block px-5 py-4 space-y-1.5 hover:bg-black/[0.02]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-medium text-neutral-900 leading-snug truncate">
                      {p.title}
                    </span>
                    <span className="text-[15px] font-semibold text-neutral-900 tabular-nums shrink-0">
                      {p.stock}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] text-neutral-400">
                      {p.sku} · {p.category}
                    </span>
                    <StockBadge stock={p.stock} threshold={LOW_STOCK_THRESHOLD} />
                  </div>
                </Link>
              ))}
            </div>
          </DataTable>
          <TablePagination
            page={current}
            total={visible.length}
            noun="products"
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
