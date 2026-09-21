import { Product } from "@/lib/api";
import { Check } from "lucide-react";

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

interface CatalogTableProps {
  products: Product[];
}

const upsellCandidates = ["AUDIO-CASE-01", "WORK-WRISTREST-01", "SNACK-MUG-01", "WORK-NOTEBOOK-01", "GIFT-CANDLE-01"];

export function CatalogTable({ products }: CatalogTableProps) {
  return (
    <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] overflow-hidden">
      {/* Desktop header */}
      <div className="hidden md:grid grid-cols-[1fr_110px_90px_90px_90px_60px_80px_80px] gap-3 px-6 py-3 border-b border-black/[0.06] bg-neutral-50/80">
        <div className="text-[12px] font-medium text-neutral-500">
          Product
        </div>
        <div className="text-[12px] font-medium text-neutral-500">
          SKU
        </div>
        <div className="text-[12px] font-medium text-neutral-500">
          Category
        </div>
        <div className="text-[12px] font-medium text-neutral-500 text-right">
          Price
        </div>
        <div className="text-[12px] font-medium text-neutral-500 text-right">
          Floor
        </div>
        <div className="text-[12px] font-medium text-neutral-500 text-right">
          Stock
        </div>
        <div className="text-[12px] font-medium text-neutral-500 text-center">
          AI
        </div>
        <div className="text-[12px] font-medium text-neutral-500 text-center">
          Upsell
        </div>
      </div>

      {/* Rows */}
      {products.map((product, i) => (
        <div
          key={product.id}
          className={`transition-colors hover:bg-black/[0.02] focus-within:bg-black/[0.02] ${
            i < products.length - 1 ? "border-b border-black/[0.05]" : ""
          }`}
        >
          {/* Desktop row */}
          <div className="hidden md:grid grid-cols-[1fr_110px_90px_90px_90px_60px_80px_80px] gap-3 px-6 py-4 items-center">
            <div className="min-w-0">
              <div className="text-[15px] font-medium text-neutral-900 truncate">
                {product.title}
              </div>
            </div>
            <div className="text-[13px] text-neutral-500 tabular-nums">
              {product.sku}
            </div>
            <div className="text-[13px] text-neutral-500">
              {product.category}
            </div>
            <div className="text-[15px] font-semibold text-neutral-900 text-right tabular-nums">
              {formatPaise(product.price_paise)}
            </div>
            <div className="text-[13px] text-neutral-500 text-right tabular-nums">
              {formatPaise(product.floor_paise)}
            </div>
            <div className="text-[13px] text-right tabular-nums">
              <span
                className={
                  product.stock > 20
                    ? "text-neutral-600"
                    : product.stock > 5
                      ? "inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium bg-amber-50 text-amber-800"
                      : "inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium bg-red-50 text-red-700"
                }
              >
                {product.stock}
              </span>
            </div>
            <div className="flex justify-center">
              <span className="flex items-center justify-center size-6 rounded-full bg-green-50" aria-label="AI discoverable">
                <Check size={13} className="text-green-700" />
              </span>
            </div>
            <div className="flex justify-center">
              {upsellCandidates.includes(product.sku) ? (
                <span className="flex items-center justify-center size-6 rounded-full bg-[#fff4e5]" aria-label="Upsell candidate">
                  <Check size={13} className="text-[#b25e00]" />
                </span>
              ) : (
                <span className="text-neutral-300">—</span>
              )}
            </div>
          </div>

          {/* Mobile row */}
          <div className="md:hidden px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] font-medium text-neutral-900">
                  {product.title}
                </div>
                <div className="text-[12px] text-neutral-500 mt-1">
                  {product.sku} · {product.category}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[15px] font-semibold text-neutral-900 tabular-nums">
                  {formatPaise(product.price_paise)}
                </div>
                <div className="text-[12px] text-neutral-500 mt-0.5 tabular-nums">
                  Floor {formatPaise(product.floor_paise)}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 justify-end">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium bg-green-50 text-green-700">AI</span>
                  {upsellCandidates.includes(product.sku) && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium bg-[#fff4e5] text-[#b25e00]">Upsell</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
