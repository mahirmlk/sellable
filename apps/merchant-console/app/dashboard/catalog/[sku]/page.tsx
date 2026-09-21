"use client";

// Product detail (route /dashboard/catalog/[sku]): Product information,
// Pricing, Inventory, Attributes, AI selling. Negotiation availability and AI
// readiness are derived from the loaded Product (stock > 0 and floor <=
// price) — no invented config fields.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Package, ShieldAlert, ArrowRight } from "lucide-react";
import { formatPaise } from "@/lib/formatters";
import { getConsoleCatalogItem, ApiError, type Product } from "@/lib/api";
import {
  AiBadge,
  EmptyState,
  ErrorBanner,
  PageHeader,
  RefreshButton,
  StockBadge,
  TableSkeleton,
} from "../../_components/tier1-ui";
import { LOW_STOCK_THRESHOLD, aiAvailable } from "../../_components/tier1-data";

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-[var(--bb-line-soft)] last:border-b-0">
      <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] shrink-0">
        {label}
      </span>
      <span className="font-[var(--font-mono)] text-[0.78rem] text-[var(--bb-white)] text-right break-words">
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-[var(--bb-line)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
        <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
          {title}
        </div>
      </div>
      {children}
    </div>
  );
}

function YesNo({ yes, hint }: { yes: boolean; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-[var(--bb-line-soft)] last:border-b-0">
      <span className="font-[var(--font-mono)] text-[0.62rem] text-[var(--bb-grey-2)]">{hint}</span>
      <span
        className={`font-[var(--font-mono)] text-[0.62rem] tracking-[0.1em] uppercase ${
          yes ? "text-green-400" : "text-[var(--bb-grey-4)]"
        }`}
      >
        {yes ? "YES" : "NO"}
      </span>
    </div>
  );
}

export default function ProductDetailPage() {
  const params = useParams();
  const sku = String(params.sku ?? "").toUpperCase();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setLoadError(null);
    try {
      const p = await getConsoleCatalogItem(sku);
      setProduct(p);
    } catch (err) {
      if (err instanceof ApiError && err.isNotFound) {
        // Genuinely absent SKU — distinct from a backend outage below.
        setNotFound(true);
      } else {
        setLoadError(
          err instanceof TypeError
            ? "Backend unreachable — the product could not be loaded."
            : "The product could not be loaded from the backend."
        );
      }
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
      <div className="p-6 space-y-6">
        <PageHeader title={sku || "Product"} subtitle="PRODUCT DETAIL" />
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 space-y-6">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors"
        >
          <ArrowLeft size={14} /> BACK TO PRODUCTS
        </Link>
        <ErrorBanner message={loadError} onRetry={() => void fetchData()} />
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="p-6 space-y-6">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors"
        >
          <ArrowLeft size={14} /> BACK TO PRODUCTS
        </Link>
        <EmptyState
          title="Product not found"
          message={`Product ${sku} was not found in your catalog. It may have been removed.`}
        />
      </div>
    );
  }

  const upsellSku = product.attributes?.upsell_sku as string | undefined;
  const otherAttributes = Object.entries(product.attributes ?? {}).filter(([k]) => k !== "upsell_sku");
  const marginGap = product.price_paise - product.floor_paise;
  const negotiationEnabled = product.floor_paise <= product.price_paise && marginGap > 0;
  const available = aiAvailable(product.stock, product.floor_paise, product.price_paise);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors"
        >
          <ArrowLeft size={14} /> BACK TO PRODUCTS
        </Link>
        <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
      </div>

      <div className="border border-[var(--bb-line)] p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Package size={18} className="text-[var(--bb-orange)]" />
              <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">
                {product.title}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase px-2 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-2)]">
                {product.sku}
              </span>
              <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
                {product.category}
              </span>
              <AiBadge available={available} />
            </div>
          </div>
          <StockBadge stock={product.stock} threshold={LOW_STOCK_THRESHOLD} />
        </div>
        {product.description && (
          <p className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-2)] leading-relaxed max-w-[640px] mt-4">
            {product.description}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Section title="Product information">
            <DetailRow label="Title" value={product.title} />
            <DetailRow label="SKU" value={product.sku} />
            <DetailRow label="Category" value={product.category} />
            <DetailRow
              label="Description"
              value={product.description || <span className="text-[var(--bb-grey-4)]">—</span>}
            />
          </Section>

          <Section title="Inventory">
            <DetailRow label="Available stock" value={`${product.stock} units`} />
            <DetailRow
              label="Status"
              value={<StockBadge stock={product.stock} threshold={LOW_STOCK_THRESHOLD} />}
            />
            {product.stock > 0 && product.stock <= LOW_STOCK_THRESHOLD && (
              <div className="px-5 py-3 font-[var(--font-sans)] text-[0.75rem] text-amber-400 leading-relaxed">
                Running low — at or below {LOW_STOCK_THRESHOLD} units. Restock to keep the AI Seller
                offering this product.
              </div>
            )}
            {product.stock <= 0 && (
              <div className="px-5 py-3 font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-3)] leading-relaxed">
                Out of stock — hidden from the AI Seller until restocked.
              </div>
            )}
          </Section>

          <Section title="Attributes">
            {otherAttributes.length === 0 && !upsellSku ? (
              <div className="px-5 py-6 text-center font-[var(--font-mono)] text-[0.62rem] text-[var(--bb-grey-4)]">
                No extra attributes on this product.
              </div>
            ) : (
              <>
                {otherAttributes.map(([k, v]) => (
                  <DetailRow key={k} label={k.replace(/_/g, " ")} value={String(v)} />
                ))}
                {upsellSku && (
                  <div className="px-5 py-3">
                    <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)] mb-2">
                      PAIRED UPSELL PRODUCT
                    </div>
                    <Link
                      href={`/dashboard/catalog/${upsellSku}`}
                      className="flex items-center justify-between gap-3 p-3 border border-[var(--bb-line)] hover:border-[var(--bb-grey-4)] hover:bg-[var(--bb-panel)] transition-colors group"
                    >
                      <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">
                        {upsellSku}
                      </span>
                      <ArrowRight size={14} className="text-[var(--bb-grey-4)] group-hover:text-[var(--bb-orange)] transition-colors" />
                    </Link>
                  </div>
                )}
              </>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Pricing">
            <DetailRow label="Selling price" value={formatPaise(product.price_paise)} />
            <DetailRow label="Minimum price" value={formatPaise(product.floor_paise)} />
            <DetailRow label="Negotiation room" value={formatPaise(marginGap)} />
            <DetailRow
              label="Negotiation enabled"
              value={
                <span className={negotiationEnabled ? "text-green-400" : "text-[var(--bb-grey-4)]"}>
                  {negotiationEnabled ? "YES" : "NO"}
                </span>
              }
            />
            <div className="px-5 py-3 border-t border-[var(--bb-line-soft)] flex items-start gap-2">
              <ShieldAlert size={14} className="text-[var(--bb-orange)] mt-0.5 flex-shrink-0" />
              <p className="font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-3)] leading-relaxed">
                Offers below the minimum price are rejected by the deterministic Policy Engine. This
                is a configured boundary, not a UI field.
              </p>
            </div>
          </Section>

          <Section title="AI selling">
            <YesNo yes={available} hint="Available to AI Seller" />
            <YesNo yes={available} hint="Shown in catalog search" />
            <YesNo yes={available && negotiationEnabled} hint="Open to negotiation" />
            <div className="px-5 py-3 font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-3)] leading-relaxed">
              {available
                ? "This product can be discovered, quoted, and sold by your AI Seller right now."
                : product.stock <= 0
                  ? "Not sellable by AI while out of stock. Restock to re-enable."
                  : "Not sellable by AI — the minimum price is above the selling price, so no valid offer range exists."}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
