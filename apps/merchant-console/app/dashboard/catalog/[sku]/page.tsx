"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, Package, ShieldAlert, ArrowRight, CheckCircle2 } from "lucide-react";
import { formatPaise } from "@/lib/formatters";
import { getConsoleCatalogItem, getConsolePolicy, type Product, type ConsolePolicySettings } from "@/lib/api";

function DetailRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--bb-line-soft)] last:border-b-0">
      <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)]">{label}</span>
      <span className={`font-[var(--font-mono)] text-[0.8rem] ${accent ? "text-[var(--bb-orange)]" : "text-[var(--bb-white)]"}`}>{value}</span>
    </div>
  );
}

export default function ProductDetailPage() {
  const params = useParams();
  const sku = (params.sku as string).toUpperCase();
  const [product, setProduct] = useState<Product | null>(null);
  const [policy, setPolicy] = useState<ConsolePolicySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const [p, pl] = await Promise.allSettled([getConsoleCatalogItem(sku), getConsolePolicy()]);
      if (p.status === "fulfilled") {
        setProduct(p.value);
      } else {
        setNotFound(true);
      }
      if (pl.status === "fulfilled") setPolicy(pl.value);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [sku]);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">Loading product…</div>
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="p-6">
        <Link href="/dashboard/catalog" className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors mb-6">
          <ArrowLeft size={14} /> BACK TO CATALOG
        </Link>
        <div className="border border-[var(--bb-line)] px-5 py-12 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-3)]">
          Product {sku} not found in the merchant catalog.
        </div>
      </div>
    );
  }

  const upsellSku = product.attributes?.upsell_sku as string | undefined;
  const stockLow = product.stock <= 10;
  const marginGap = product.price_paise - product.floor_paise;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/catalog" className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors">
          <ArrowLeft size={14} /> BACK TO CATALOG
        </Link>
        <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
          <RefreshCw size={12} /> REFRESH
        </button>
      </div>

      <div className="border border-[var(--bb-line)] p-6 stagger-child">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Package size={18} className="text-[var(--bb-orange)]" />
              <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">{product.title}</h1>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase px-2 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-2)]">{product.sku}</span>
              <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">{product.category}</span>
              <span className="inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-green-400">
                <CheckCircle2 size={11} /> AI DISCOVERABLE
              </span>
            </div>
          </div>
        </div>
        <p className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-2)] leading-relaxed max-w-[640px] mb-6">{product.description}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border border-[var(--bb-line)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
              <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">PRODUCT ATTRIBUTES</div>
            </div>
            <DetailRow label="Price" value={formatPaise(product.price_paise)} accent />
            <DetailRow label="Floor price" value={formatPaise(product.floor_paise)} />
            <DetailRow label="Stock" value={<span className={stockLow ? "text-amber-400" : "text-[var(--bb-white)]"}>{product.stock}</span>} />
            <DetailRow label="Category" value={product.category} />
            {policy && <DetailRow label="Discount cap" value={`${policy.max_discount_percent}%`} />}
          </div>

          <div className="space-y-4">
            <div className="border border-[var(--bb-line)] p-5">
              <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-3">PRICING EXPLANATION</div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Merchant floor</span>
                  <span className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-orange)]">{formatPaise(product.floor_paise)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Margin gap</span>
                  <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-2)]">{formatPaise(marginGap)}</span>
                </div>
                <div className="border-t border-[var(--bb-line-soft)] pt-3 flex items-start gap-2">
                  <ShieldAlert size={14} className="text-[var(--bb-orange)] mt-0.5 flex-shrink-0" />
                  <p className="font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-3)] leading-relaxed">
                    Offers below this amount are rejected by the deterministic Policy Engine. This is a configured boundary, not a UI field.
                  </p>
                </div>
              </div>
            </div>

            {upsellSku && (
              <div className="border border-[var(--bb-line)] p-5">
                <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-3">UPSELL RELATIONSHIP</div>
                <Link href={`/dashboard/catalog/${upsellSku}`} className="flex items-center justify-between gap-3 p-3 border border-[var(--bb-line)] hover:border-[var(--bb-grey-4)] hover:bg-[var(--bb-panel)] transition-colors group">
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">{upsellSku}</div>
                    <div className="font-[var(--font-sans)] text-[0.7rem] text-[var(--bb-grey-3)]">Compatible companion product</div>
                  </div>
                  <ArrowRight size={14} className="text-[var(--bb-grey-4)] group-hover:text-[var(--bb-orange)] transition-colors" />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}