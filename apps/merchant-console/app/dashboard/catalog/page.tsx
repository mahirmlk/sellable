"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { formatPaise } from "@/lib/formatters";
import { searchCatalog, type Product } from "@/lib/api";

export default function CatalogPage() {
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await searchCatalog(searchQuery);
      setCatalog(data);
    } catch {} finally { setLoading(false); }
  }, [searchQuery]);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Catalog</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">DETERMINISTIC PRODUCT SOURCE</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
        </button>
      </div>

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
              {loading ? "Loading catalog..." : "No products found."}
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
        </div>
      </div>

      <div className="border border-[var(--bb-line)] p-5">
        <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)] leading-relaxed">
          Offers below the floor price are blocked by the Policy Engine. Floor prices are merchant-configured and enforced deterministically — the agent cannot override them.
        </div>
      </div>
    </div>
  );
}
