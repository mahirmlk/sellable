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
    <div className="p-6 space-y-6">
      <PageHeader
        title="Products"
        subtitle="THE AGENT CAN ONLY SELL WHAT IS LISTED HERE"
        actions={
          <>
            <button
              onClick={handleExport}
              disabled={visible.length === 0}
              className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50"
            >
              <Download size={12} /> EXPORT
            </button>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-2 h-[32px] px-3.5 bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors cursor-pointer"
            >
              {showForm ? <X size={12} /> : <Plus size={12} />} {showForm ? "CANCEL" : "ADD PRODUCT"}
            </button>
            <RefreshButton onRefresh={() => fetchData(searchQuery)} loading={loading} />
          </>
        }
      />

      {createdSku && (
        <div className="border border-green-400/30 bg-green-400/5 px-5 py-3 flex items-center gap-2">
          <Check size={14} className="text-green-400" />
          <span className="font-[var(--font-mono)] text-[0.62rem] text-green-400">
            {createdSku} added — persisted in your store and immediately searchable by the agent.
          </span>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-5 space-y-4">
          <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-grey-3)]">NEW PRODUCT</div>
          {formError && (
            <div className="border border-red-400/30 bg-red-400/5 px-4 py-2.5 flex items-start gap-2">
              <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
              <span className="font-[var(--font-mono)] text-[0.62rem] text-red-400 leading-relaxed">{formError}</span>
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
          className="flex-1 min-w-[180px] max-w-[300px] font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="font-[var(--font-mono)] text-[0.62rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-grey-2)] px-2.5 py-2 cursor-pointer focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
          aria-label="Sort products"
        >
          <option value="default">SORT: DEFAULT</option>
          <option value="name">SORT: NAME A–Z</option>
          <option value="price-asc">SORT: PRICE LOW–HIGH</option>
          <option value="price-desc">SORT: PRICE HIGH–LOW</option>
          <option value="stock-asc">SORT: STOCK LOW–HIGH</option>
          <option value="stock-desc">SORT: STOCK HIGH–LOW</option>
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="font-[var(--font-mono)] text-[0.62rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-grey-2)] px-2.5 py-2 cursor-pointer focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
          aria-label="Filter by category"
        >
          <option value="all">CATEGORY: ALL</option>
          {loadedCategories.map((c) => (
            <option key={c} value={c}>CATEGORY: {c.toUpperCase()}</option>
          ))}
        </select>
        <div className="inline-flex border border-[var(--bb-line)]" role="group" aria-label="View mode">
          {(["table", "grid"] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase px-3 py-2 transition-colors cursor-pointer ${
                viewMode === m ? "bg-[var(--bb-orange)]/10 text-[var(--bb-orange)]" : "text-[var(--bb-grey-4)] hover:text-[var(--bb-white)]"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] ml-auto">
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
                className="inline-flex items-center gap-2 h-[32px] px-4 bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors cursor-pointer"
              >
                <Plus size={12} /> ADD PRODUCT
              </button>
            ) : undefined
          }
        />
      ) : viewMode === "table" ? (
        <DataTable>
          <div className="hidden lg:grid grid-cols-[1fr_110px_110px_100px_110px_70px_130px] gap-3 px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
            {["PRODUCT", "SKU", "CATEGORY", "PRICE", "MINIMUM PRICE", "STOCK", "AI STATUS"].map((h) => (
              <div key={h} className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">{h}</div>
            ))}
          </div>
          {visible.map((p, i) => (
            <Link
              key={p.id}
              href={`/dashboard/catalog/${p.sku}`}
              className={`hidden lg:grid grid-cols-[1fr_110px_110px_100px_110px_70px_130px] gap-3 px-5 py-3 items-center hover:bg-[var(--bb-panel)] transition-colors ${
                i < visible.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
              }`}
            >
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-white)] truncate">{p.title}</div>
              <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">{p.sku}</div>
              <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] uppercase text-[var(--bb-grey-3)]">{p.category}</div>
              <div className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-white)] tabular-nums">{formatPaise(p.price_paise)}</div>
              <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-3)] tabular-nums">{formatPaise(p.floor_paise)}</div>
              <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-2)] tabular-nums">{p.stock}</div>
              <AiBadge available={aiAvailable(p.stock, p.floor_paise, p.price_paise)} />
            </Link>
          ))}
          {/* Mobile cards */}
          <div className="lg:hidden divide-y divide-[var(--bb-line-soft)]">
            {visible.map((p) => (
              <Link key={p.id} href={`/dashboard/catalog/${p.sku}`} className="block px-5 py-3.5 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">{p.sku}</span>
                  <span className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-white)] tabular-nums">{formatPaise(p.price_paise)}</span>
                </div>
                <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-white)] leading-snug">{p.title}</div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] uppercase text-[var(--bb-grey-3)]">
                    MIN {formatPaise(p.floor_paise)} · STOCK {p.stock} · {p.category}
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
              className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-5 space-y-3 hover:border-[var(--bb-grey-4)] transition-colors group"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase px-2 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-2)]">
                  {p.sku}
                </span>
                <StockBadge stock={p.stock} threshold={LOW_STOCK_THRESHOLD} />
              </div>
              <div className="font-[var(--font-sans)] text-[0.95rem] text-[var(--bb-white)] leading-snug group-hover:text-[var(--bb-orange)] transition-colors">
                {p.title}
              </div>
              <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] uppercase text-[var(--bb-grey-3)]">
                {p.category}
              </div>
              <div className="flex items-end justify-between pt-1 border-t border-[var(--bb-line-soft)]">
                <div>
                  <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">PRICE</div>
                  <div className="font-[var(--font-mono)] text-[1rem] text-[var(--bb-white)] tabular-nums">{formatPaise(p.price_paise)}</div>
                  <div className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-4)] tabular-nums">MIN {formatPaise(p.floor_paise)} · STOCK {p.stock}</div>
                </div>
                <AiBadge available={aiAvailable(p.stock, p.floor_paise, p.price_paise)} />
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="border border-[var(--bb-line)] p-5">
        <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)] leading-relaxed">
          Offers below the minimum price are blocked by the Policy Engine. Minimum prices are merchant-configured and
          enforced deterministically — the agent cannot override them. A product is available to the AI Seller only
          while it has stock.
        </div>
      </div>
    </div>
  );
}
