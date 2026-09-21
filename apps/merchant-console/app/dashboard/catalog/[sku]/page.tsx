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
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import {
  AiBadge,
  RefreshButton,
  StockBadge,
} from "@/components/dashboard/commerce-ui";
import { LOW_STOCK_THRESHOLD, aiAvailable } from "@/lib/commerce-view";

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-black/[0.06] last:border-b-0">
      <span className="text-[12px] text-neutral-500 shrink-0">{label}</span>
      <span className="text-[13px] text-neutral-900 text-right break-words">{value}</span>
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
    <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-6 py-4 border-b border-black/[0.06]">
        <div className="text-[15px] font-semibold text-neutral-900">{title}</div>
      </div>
      {children}
    </div>
  );
}

function YesNo({ yes, hint }: { yes: boolean; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-black/[0.06] last:border-b-0">
      <span className="text-[13px] text-neutral-600">{hint}</span>
      <span
        className={
          yes
            ? "inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-green-50 text-green-700"
            : "inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-neutral-100 text-neutral-500"
        }
      >
        {yes ? "Yes" : "No"}
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
      <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
        <PageHeader title={sku || "Product"} subtitle="Product detail" />
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-2 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft size={14} /> Back to products
        </Link>
        <ErrorBanner message={loadError} onRetry={() => void fetchData()} />
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-2 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft size={14} /> Back to products
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
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-2 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft size={14} /> Back to products
        </Link>
        <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
      </div>

      <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Package size={18} className="text-[#0071e3]" />
              <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900">
                {product.title}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <span className="text-[12px] font-medium px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600">
                {product.sku}
              </span>
              <span className="text-[13px] text-neutral-500">{product.category}</span>
              <AiBadge available={available} />
            </div>
          </div>
          <StockBadge stock={product.stock} threshold={LOW_STOCK_THRESHOLD} />
        </div>
        {product.description && (
          <p className="text-[13px] text-neutral-600 leading-relaxed max-w-[640px] mt-4">
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
              value={product.description || <span className="text-neutral-400">—</span>}
            />
          </Section>

          <Section title="Inventory">
            <DetailRow label="Available stock" value={`${product.stock} units`} />
            <DetailRow
              label="Status"
              value={<StockBadge stock={product.stock} threshold={LOW_STOCK_THRESHOLD} />}
            />
            {product.stock > 0 && product.stock <= LOW_STOCK_THRESHOLD && (
              <div className="px-6 py-4">
                <span className="inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-amber-50 text-amber-800">
                  Running low — at or below {LOW_STOCK_THRESHOLD} units. Restock to keep the AI Seller offering
                  this product.
                </span>
              </div>
            )}
            {product.stock <= 0 && (
              <div className="px-6 py-4 text-[13px] text-neutral-500 leading-relaxed">
                Out of stock — hidden from the AI Seller until restocked.
              </div>
            )}
          </Section>

          <Section title="Attributes">
            {otherAttributes.length === 0 && !upsellSku ? (
              <div className="px-6 py-6 text-center text-[13px] text-neutral-400">
                No extra attributes on this product.
              </div>
            ) : (
              <>
                {otherAttributes.map(([k, v]) => (
                  <DetailRow key={k} label={k.replace(/_/g, " ")} value={String(v)} />
                ))}
                {upsellSku && (
                  <div className="px-6 py-4">
                    <div className="text-[12px] text-neutral-500 mb-2">Paired upsell product</div>
                    <Link
                      href={`/dashboard/catalog/${upsellSku}`}
                      className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-neutral-50 transition-colors group"
                    >
                      <span className="text-[13px] font-medium text-neutral-900">{upsellSku}</span>
                      <ArrowRight size={14} className="text-neutral-400 group-hover:text-[#0071e3] transition-colors" />
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
                <span
                  className={
                    negotiationEnabled
                      ? "inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-green-50 text-green-700"
                      : "inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-neutral-100 text-neutral-500"
                  }
                >
                  {negotiationEnabled ? "Yes" : "No"}
                </span>
              }
            />
            <div className="px-6 py-4 border-t border-black/[0.06] flex items-start gap-2">
              <ShieldAlert size={14} className="text-[#0071e3] mt-0.5 flex-shrink-0" />
              <p className="text-[13px] text-neutral-500 leading-relaxed">
                Offers below the minimum price are rejected by the deterministic Policy Engine. This is a
                configured boundary, not a UI field.
              </p>
            </div>
          </Section>

          <Section title="AI selling">
            <YesNo yes={available} hint="Available to AI Seller" />
            <YesNo yes={available} hint="Shown in catalog search" />
            <YesNo yes={available && negotiationEnabled} hint="Open to negotiation" />
            <div className="px-6 py-4 text-[13px] text-neutral-500 leading-relaxed">
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
