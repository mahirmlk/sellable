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
    <div className="border border-[var(--bb-line)] overflow-hidden">
      {/* Desktop header — spec: SKU, Product, Category, Price, Floor, Stock, AI discoverable, Upsell candidate */}
      <div className="hidden md:grid grid-cols-[1fr_110px_90px_90px_90px_60px_80px_80px] gap-3 px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
        <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
          PRODUCT
        </div>
        <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
          SKU
        </div>
        <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
          CATEGORY
        </div>
        <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] text-right">
          PRICE
        </div>
        <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] text-right">
          FLOOR
        </div>
        <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] text-right">
          STOCK
        </div>
        <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] text-center">
          AI
        </div>
        <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] text-center">
          UPSELL
        </div>
      </div>

      {/* Rows */}
      {products.map((product, i) => (
        <div
          key={product.id}
          className={`hover-panel transition-colors ${
            i < products.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
          }`}
        >
          {/* Desktop row */}
          <div className="hidden md:grid grid-cols-[1fr_110px_90px_90px_90px_60px_80px_80px] gap-3 px-5 py-3.5 items-center">
            <div className="min-w-0">
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-white)] truncate">
                {product.title}
              </div>
            </div>
            <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">
              {product.sku}
            </div>
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.08em] uppercase text-[var(--bb-grey-3)]">
              {product.category}
            </div>
            <div className="font-[var(--font-mono)] text-[0.8rem] text-[var(--bb-white)] text-right tabular-nums">
              {formatPaise(product.price_paise)}
            </div>
            <div className="font-[var(--font-mono)] text-[0.8rem] text-[var(--bb-grey-2)] text-right tabular-nums">
              {formatPaise(product.floor_paise)}
            </div>
            <div className="font-[var(--font-mono)] text-[0.8rem] text-right tabular-nums">
              <span
                className={
                  product.stock > 20
                    ? "text-[var(--bb-grey-1)]"
                    : product.stock > 5
                      ? "text-[var(--bb-orange)]"
                      : "text-red-500"
                }
              >
                {product.stock}
              </span>
            </div>
            <div className="flex justify-center">
              <Check size={14} className="text-green-400" />
            </div>
            <div className="flex justify-center">
              {upsellCandidates.includes(product.sku) ? (
                <Check size={14} className="text-[var(--bb-orange)]" />
              ) : (
                <span className="text-[var(--bb-grey-4)]">—</span>
              )}
            </div>
          </div>

          {/* Mobile row */}
          <div className="md:hidden px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)]">
                  {product.title}
                </div>
                <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] text-[var(--bb-grey-3)] mt-1 uppercase">
                  {product.sku} · {product.category}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-white)]">
                  {formatPaise(product.price_paise)}
                </div>
                <div className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-3)] mt-0.5">
                  Floor: {formatPaise(product.floor_paise)}
                </div>
                <div className="flex items-center gap-3 mt-1 justify-end">
                  <span className="font-[var(--font-mono)] text-[0.5rem] text-green-400">AI ✓</span>
                  {upsellCandidates.includes(product.sku) && (
                    <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-orange)]">UPSELL ✓</span>
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
