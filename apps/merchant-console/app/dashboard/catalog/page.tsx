"use client";

// Products (route /dashboard/catalog): header + search, client-side stock
// tabs, toolbar (search / sort / category filter), table/grid toggle over the
// same loaded records, saved views, CSV export. All derivations (stock band,
// AI availability) come from loaded Product records only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, X, AlertCircle, Check, Download } from "lucide-react";
import { formatPaise } from "@/lib/formatters";
import {
  getConsoleCatalog,
  getConsolePolicy,
  createConsoleProduct,
  ApiError,
  type Product,
} from "@/lib/api";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { DataTable } from "@/components/dashboard/data-table";
import {
  AiBadge,
  FilterTabs,
  RefreshButton,
  SavedViewsBar,
  StockBadge,
} from "@/components/dashboard/commerce-ui";
import { exportToCsv } from "@/lib/csv";
import {
  LOW_STOCK_THRESHOLD,
  aiAvailable,
  stockState,
  type StockState,
} from "@/lib/commerce-view";

interface FormState {
  sku: string;
  title: string;
  description: string;
  priceRupees: string;
  floorRupees: string;
  stock: string;
  category: string;
  upsellSku: string;
}

const EMPTY_FORM: FormState = {
  sku: "",
  title: "",
  description: "",
  priceRupees: "",
  floorRupees: "",
  stock: "10",
  category: "",
  upsellSku: "",
};

type ProductTab = "all" | StockState | "ai";
type SortKey = "default" | "name" | "price-asc" | "price-desc" | "stock-asc" | "stock-desc";
type ViewMode = "table" | "grid";

interface ProductView {
  tab: ProductTab;
  sort: SortKey;
  category: string;
}

export default function CatalogPage() {
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<ProductTab>("all");
  const [sort, setSort] = useState<SortKey>("default");
  const [category, setCategory] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [categories, setCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdSku, setCreatedSku] = useState<string | null>(null);

  // Generation guard: a slow earlier search must never overwrite a newer one.
  const requestGen = useRef(0);
  const fetchData = useCallback(async (query: string) => {
    const gen = ++requestGen.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getConsoleCatalog(query);
      if (requestGen.current === gen) setCatalog(data);
    } catch (err) {
      if (requestGen.current === gen) {
        setLoadError(
          err instanceof TypeError
            ? "Backend unreachable — the product list could not be loaded."
            : "The product list could not be loaded from the backend."
        );
      }
    } finally {
      if (requestGen.current === gen) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Debounced search: one request per pause in typing, not per keystroke.
    const t = window.setTimeout(() => void fetchData(searchQuery), searchQuery ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [searchQuery, fetchData]);

  useEffect(() => {
    getConsolePolicy()
      .then((p) => setCategories(p.allowed_categories))
      .catch(() => setCategories([]));
  }, []);

  const setField = (key: keyof FormState, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const sku = form.sku.trim().toUpperCase();
    const title = form.title.trim();
    const categoryValue = form.category.trim().toLowerCase();
    const price = Math.round(parseFloat(form.priceRupees || "0") * 100);
    const floor = Math.round(parseFloat(form.floorRupees || "0") * 100);
    const stock = parseInt(form.stock || "0", 10);

    if (!sku || !title || !categoryValue) {
      setFormError("SKU, title, and category are required.");
      return;
    }
    if (price <= 0 || floor <= 0) {
      setFormError("Price and floor price must be greater than zero.");
      return;
    }
    if (floor > price) {
      setFormError("Floor price cannot exceed the list price — the agent would counter every offer.");
      return;
    }
    if (!/^\d+$/.test(form.stock.trim()) || !Number.isInteger(stock) || stock < 0) {
      setFormError("Stock must be a whole number of 0 or more.");
      return;
    }

    setSaving(true);
    try {
      const attributes: Record<string, unknown> = {};
      if (form.upsellSku.trim()) attributes.upsell_sku = form.upsellSku.trim().toUpperCase();
      await createConsoleProduct({
        sku,
        title,
        description: form.description.trim(),
        price_paise: price,
        floor_paise: floor,
        stock,
        category: categoryValue,
        attributes,
      });
      setCreatedSku(sku);
      setTimeout(() => setCreatedSku(null), 4000);
      setForm(EMPTY_FORM);
      setShowForm(false);
      fetchData("");
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.detail || "The backend rejected the product."
          : "Could not reach the backend. Try again."
      );
    } finally {
      setSaving(false);
    }
  };

  // --- Client-side derived views over loaded records ---
  const loadedCategories = useMemo(
    () => Array.from(new Set(catalog.map((p) => p.category))).sort(),
    [catalog]
  );

  const counts = useMemo(() => {
    const c: Record<ProductTab, number> = { all: catalog.length, in: 0, low: 0, out: 0, ai: 0 };
    for (const p of catalog) {
      c[stockState(p.stock)] += 1;
      if (aiAvailable(p.stock, p.floor_paise, p.price_paise)) c.ai += 1;
    }
    return c;
  }, [catalog]);

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let rows = catalog.filter((p) => {
      if (tab === "ai") {
        if (!aiAvailable(p.stock, p.floor_paise, p.price_paise)) return false;
      } else if (tab !== "all" && stockState(p.stock) !== tab) {
        return false;
      }
      if (category !== "all" && p.category !== category) return false;
      if (q && !`${p.sku} ${p.title} ${p.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
    switch (sort) {
      case "name":
        rows = [...rows].sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "price-asc":
        rows = [...rows].sort((a, b) => a.price_paise - b.price_paise);
        break;
      case "price-desc":
        rows = [...rows].sort((a, b) => b.price_paise - a.price_paise);
        break;
      case "stock-asc":
        rows = [...rows].sort((a, b) => a.stock - b.stock);
        break;
      case "stock-desc":
        rows = [...rows].sort((a, b) => b.stock - a.stock);
        break;
      default:
        break;
    }
    return rows;
  }, [catalog, tab, category, searchQuery, sort]);

  const handleExport = useCallback(() => {
    exportToCsv(
      "products.csv",
      visible.map((p) => ({
        sku: p.sku,
        title: p.title,
        category: p.category,
        price_inr: (p.price_paise / 100).toFixed(2),
        minimum_price_inr: (p.floor_paise / 100).toFixed(2),
        stock: p.stock,
        ai_available: aiAvailable(p.stock, p.floor_paise, p.price_paise) ? "YES" : "NO",
      }))
    );
  }, [visible]);

  const applyView = useCallback((v: ProductView) => {
    setTab(v.tab);
    setSort(v.sort);
    setCategory(v.category);
  }, []);

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="Products"
        subtitle="Everything your AI seller can offer"
        actions={
          <>
            <button
              onClick={handleExport}
              disabled={visible.length === 0}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:text-neutral-900 hover:shadow transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]"
            >
              <Download size={14} /> Export
            </button>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-2 h-9 px-5 rounded-full bg-neutral-900 text-[13px] font-semibold text-white shadow-sm hover:bg-black transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]"
            >
              {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "Cancel" : "Add product"}
            </button>
            <RefreshButton onRefresh={() => fetchData(searchQuery)} loading={loading} />
          </>
        }
      />

      {createdSku && (
        <div className="rounded-2xl bg-green-50/80 backdrop-blur-xl border border-green-200/60 px-4 py-3 flex items-center gap-2.5">
          <span className="flex items-center justify-center size-6 rounded-full bg-green-100 shrink-0" aria-hidden>
            <Check size={13} className="text-green-700" />
          </span>
          <span className="text-[13px] text-green-900">
            {createdSku} added — persisted in your store and immediately searchable by the agent.
          </span>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] p-6 space-y-5">
          <div className="text-[15px] font-semibold tracking-[-0.01em] text-neutral-900">New product</div>
          {formError && (
            <div className="rounded-2xl bg-red-50/80 border border-red-200/60 px-4 py-3 flex items-start gap-2.5">
              <AlertCircle size={14} className="text-red-700 mt-0.5 shrink-0" />
              <span className="text-[13px] text-red-900 leading-relaxed">{formError}</span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <label className="block">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] block mb-1.5">SKU *</span>
              <input value={form.sku} onChange={(e) => setField("sku", e.target.value)} required placeholder="DESK-MAT-01" className="w-full font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2.5 py-2 uppercase placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors" />
            </label>
            <label className="block sm:col-span-2">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] block mb-1.5">TITLE *</span>
              <input value={form.title} onChange={(e) => setField("title", e.target.value)} required placeholder="Felt Desk Mat — Large" className="w-full font-[var(--font-sans)] text-[0.8rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2.5 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors" />
            </label>
            <label className="block">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] block mb-1.5">CATEGORY *</span>
              {categories.length > 0 ? (
                <select value={form.category} onChange={(e) => setField("category", e.target.value)} required className="w-full font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2.5 py-2 cursor-pointer focus:outline-none focus:border-[var(--bb-orange)] transition-colors">
                  <option value="">Select…</option>
                  {categories.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              ) : (
                <input value={form.category} onChange={(e) => setField("category", e.target.value)} required placeholder="accessories" className="w-full font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2.5 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors" />
              )}
            </label>
            <label className="block">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] block mb-1.5">PRICE ₹ *</span>
              <input type="number" min="1" value={form.priceRupees} onChange={(e) => setField("priceRupees", e.target.value)} required placeholder="1499" className="w-full font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2.5 py-2 tabular-nums placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors" />
            </label>
            <label className="block">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] block mb-1.5">FLOOR PRICE ₹ *</span>
              <input type="number" min="1" value={form.floorRupees} onChange={(e) => setField("floorRupees", e.target.value)} required placeholder="1299" className="w-full font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2.5 py-2 tabular-nums placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors" />
            </label>
            <label className="block">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] block mb-1.5">STOCK *</span>
              <input type="number" min="0" value={form.stock} onChange={(e) => setField("stock", e.target.value)} required className="w-full font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2.5 py-2 tabular-nums focus:outline-none focus:border-[var(--bb-orange)] transition-colors" />
            </label>
            <label className="block">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] block mb-1.5">UPSELL SKU <span className="normal-case tracking-normal">(optional)</span></span>
              <input value={form.upsellSku} onChange={(e) => setField("upsellSku", e.target.value)} placeholder="CABLE-KIT-01" className="w-full font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2.5 py-2 uppercase placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors" />
            </label>
            <label className="block sm:col-span-2 lg:col-span-4">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] block mb-1.5">DESCRIPTION</span>
              <textarea value={form.description} onChange={(e) => setField("description", e.target.value)} rows={2} placeholder="What the agent should tell buyers about this product." className="w-full font-[var(--font-sans)] text-[0.8rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2.5 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors resize-none" />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)]">
              The agent quotes between floor and list price — it can never go below the floor.
            </span>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 h-[36px] px-5 bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors cursor-pointer disabled:opacity-50">
              {saving ? "SAVING…" : "CREATE PRODUCT"}
            </button>
          </div>
        </form>
      )}

      <FilterTabs<ProductTab>
        tabs={[
          { key: "all", label: "All", count: counts.all },
          { key: "in", label: "In stock", count: counts.in },
          { key: "low", label: "Low stock", count: counts.low },
          { key: "out", label: "Out of stock", count: counts.out },
          { key: "ai", label: "AI available", count: counts.ai },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* Toolbar: search / sort / category filter / table-grid toggle */}
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search products…"
          aria-label="Search products"
          className="flex-1 min-w-[180px] max-w-[320px] h-9 rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-3 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-9 rounded-[10px] bg-white border border-black/[0.12] text-[13px] text-neutral-700 px-2.5 cursor-pointer focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
          aria-label="Sort products"
        >
          <option value="default">Default</option>
          <option value="name">Name A–Z</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="stock-asc">Stock: low to high</option>
          <option value="stock-desc">Stock: high to low</option>
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-[10px] bg-white border border-black/[0.12] text-[13px] text-neutral-700 px-2.5 cursor-pointer focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {loadedCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div className="inline-flex rounded-full bg-black/[0.06] p-1" role="group" aria-label="View mode">
          {(["table", "grid"] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              aria-pressed={viewMode === m}
              className={`h-8 px-4 rounded-full text-[13px] font-medium transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
                viewMode === m ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {m === "table" ? "Table" : "Grid"}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-neutral-400 ml-auto tabular-nums">
          {visible.length} of {catalog.length} products
        </span>
      </div>

      <SavedViewsBar<ProductView>
        storageKey="products"
        current={{ tab, sort, category }}
        onApply={applyView}
      />

      {loadError && <ErrorBanner message={loadError} onRetry={() => fetchData(searchQuery)} />}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={catalog.length === 0 ? "No products yet" : "No products match"}
          message={
            catalog.length === 0
              ? "Your catalog is empty — add your first product so the AI Seller has something to sell."
              : "No products match the current search and filters. Clear them to see the full catalog."
          }
          action={
            catalog.length === 0 && !showForm ? (
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-2 h-9 px-5 rounded-full bg-neutral-900 text-[13px] font-semibold text-white shadow-sm hover:bg-black transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]"
              >
                <Plus size={14} /> Add product
              </button>
            ) : undefined
          }
        />
      ) : viewMode === "table" ? (
        <DataTable>
          <div className="hidden lg:grid grid-cols-[1fr_110px_110px_100px_110px_70px_130px] gap-3 px-6 py-3 border-b border-black/[0.06] bg-neutral-50/80">
            {["Product", "SKU", "Category", "Price", "Minimum", "Stock", "AI status"].map((h) => (
              <div key={h} className="text-[12px] font-medium text-neutral-500">{h}</div>
            ))}
          </div>
          {visible.map((p, i) => (
            <Link
              key={p.id}
              href={`/dashboard/catalog/${p.sku}`}
              className={`hidden lg:grid grid-cols-[1fr_110px_110px_100px_110px_70px_130px] gap-3 px-6 py-4 items-center hover:bg-black/[0.02] transition-colors focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
                i < visible.length - 1 ? "border-b border-black/[0.05]" : ""
              }`}
            >
              <div className="text-[15px] font-medium text-neutral-900 truncate">{p.title}</div>
              <div className="text-[13px] text-neutral-500 tabular-nums">{p.sku}</div>
              <div className="text-[13px] text-neutral-500">{p.category}</div>
              <div className="text-[15px] font-semibold text-neutral-900 tabular-nums">{formatPaise(p.price_paise)}</div>
              <div className="text-[13px] text-neutral-500 tabular-nums">{formatPaise(p.floor_paise)}</div>
              <div className="text-[13px] text-neutral-700 tabular-nums">{p.stock}</div>
              <AiBadge available={aiAvailable(p.stock, p.floor_paise, p.price_paise)} />
            </Link>
          ))}
          {/* Mobile cards */}
          <div className="lg:hidden divide-y divide-black/[0.05]">
            {visible.map((p) => (
              <Link key={p.id} href={`/dashboard/catalog/${p.sku}`} className="block px-5 py-4 space-y-1.5 hover:bg-black/[0.02]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12px] text-neutral-400 tabular-nums">{p.sku}</span>
                  <span className="text-[15px] font-semibold text-neutral-900 tabular-nums">{formatPaise(p.price_paise)}</span>
                </div>
                <div className="text-[15px] font-medium text-neutral-900 leading-snug">{p.title}</div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-neutral-400">
                    Min {formatPaise(p.floor_paise)} · Stock {p.stock} · {p.category}
                  </span>
                  <StockBadge stock={p.stock} threshold={LOW_STOCK_THRESHOLD} />
                </div>
              </Link>
            ))}
          </div>
        </DataTable>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/catalog/${p.sku}`}
              className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] p-5 space-y-3 transition-all duration-200 hover:-translate-y-px hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.18)]"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-[12px] font-medium text-neutral-600">
                  {p.sku}
                </span>
                <StockBadge stock={p.stock} threshold={LOW_STOCK_THRESHOLD} />
              </div>
              <div className="text-[17px] font-semibold tracking-[-0.01em] text-neutral-900 leading-snug">
                {p.title}
              </div>
              <div className="text-[13px] text-neutral-500">
                {p.category}
              </div>
              <div className="flex items-end justify-between pt-3 border-t border-black/[0.06]">
                <div>
                  <div className="text-[12px] text-neutral-400">Price</div>
                  <div className="text-[20px] font-semibold tracking-tight text-neutral-900 tabular-nums">{formatPaise(p.price_paise)}</div>
                  <div className="text-[12px] text-neutral-400 tabular-nums">Min {formatPaise(p.floor_paise)} · Stock {p.stock}</div>
                </div>
                <AiBadge available={aiAvailable(p.stock, p.floor_paise, p.price_paise)} />
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-neutral-50/80 border border-black/[0.05] p-5">
        <div className="text-[14px] text-neutral-500 leading-relaxed">
          Offers below the minimum price are blocked by the policy engine. Minimum prices are merchant-configured and
          enforced deterministically — the agent cannot override them. A product is available to the AI seller only
          while it has stock.
        </div>
      </div>
    </div>
  );
}
