"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { RefreshCw, Plus, X, AlertCircle, Check } from "lucide-react";
import { formatPaise } from "@/lib/formatters";
import { getConsoleCatalog, getConsolePolicy, createConsoleProduct, ApiError, type Product } from "@/lib/api";

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

export default function CatalogPage() {
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
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
    try {
      const data = await getConsoleCatalog(query);
      if (requestGen.current === gen) setCatalog(data);
    } catch {
      // keep the last good list; a banner would flicker on every keystroke
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
    const category = form.category.trim().toLowerCase();
    const price = Math.round(parseFloat(form.priceRupees || "0") * 100);
    const floor = Math.round(parseFloat(form.floorRupees || "0") * 100);
    const stock = parseInt(form.stock || "0", 10);

    if (!sku || !title || !category) {
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
        category,
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Catalog</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">THE AGENT CAN ONLY SELL WHAT IS LISTED HERE</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-2 h-[32px] px-3.5 bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors cursor-pointer">
            {showForm ? <X size={12} /> : <Plus size={12} />} {showForm ? "CANCEL" : "ADD PRODUCT"}
          </button>
          <button onClick={() => fetchData(searchQuery)} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
          </button>
        </div>
      </div>

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
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] block mb-1.5">UPSELL SKU <span className="normal-case tracking-normal text-[var(--bb-grey-4)]">(optional pairs)</span></span>
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

      <div className="flex items-center gap-3 stagger-child">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search products..."
          className="flex-1 max-w-[300px] font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
        />
        <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">{catalog.length} products</span>
      </div>

      <div className="stagger-child">
        <div className="border border-[var(--bb-line)] overflow-hidden">
          <div className="hidden lg:grid grid-cols-[80px_1fr_140px_100px_80px_80px] gap-3 px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
            {["SKU", "TITLE", "PRICE", "FLOOR", "STOCK", "CATEGORY"].map((h) => (
              <div key={h} className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">{h}</div>
            ))}
          </div>
          {catalog.length === 0 ? (
            <div className="px-5 py-12 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-3)]">
              {loading ? "Loading catalog..." : searchQuery ? "No products match the search." : "Catalog is empty — add your first product so the agent has something to sell."}
            </div>
          ) : catalog.map((p, i) => (
            <Link key={p.id} href={`/dashboard/catalog/${p.sku}`} className={`hidden lg:grid grid-cols-[80px_1fr_140px_100px_80px_80px] gap-3 px-5 py-3 items-center hover:bg-[var(--bb-panel)] transition-colors ${i < catalog.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
              <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">{p.sku}</div>
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-white)]">{p.title}</div>
              <div className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-white)]">{formatPaise(p.price_paise)}</div>
              <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-3)]">{formatPaise(p.floor_paise)}</div>
              <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-2)]">{p.stock}</div>
              <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] uppercase text-[var(--bb-grey-3)]">{p.category}</div>
            </Link>
          ))}
          {/* Mobile cards: the table rows above are desktop-only. */}
          {catalog.length > 0 && (
            <div className="lg:hidden divide-y divide-[var(--bb-line-soft)]">
              {catalog.map((p) => (
                <Link key={p.id} href={`/dashboard/catalog/${p.sku}`} className="block px-5 py-3.5 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">{p.sku}</span>
                    <span className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-white)]">{formatPaise(p.price_paise)}</span>
                  </div>
                  <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-white)] leading-snug">{p.title}</div>
                  <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] uppercase text-[var(--bb-grey-3)]">
                    FLOOR {formatPaise(p.floor_paise)} · STOCK {p.stock} · {p.category}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border border-[var(--bb-line)] p-5">
        <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)] leading-relaxed">
          Offers below the floor price are blocked by the Policy Engine. Floor prices are merchant-configured and enforced deterministically — the agent cannot override them. Products with an upsell SKU can suggest that companion item during checkout.
        </div>
      </div>
    </div>
  );
}
