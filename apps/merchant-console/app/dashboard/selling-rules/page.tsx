"use client";

import { useState, useEffect, useCallback } from "react";
import { Save, Check, FlaskConical } from "lucide-react";
import {
  getConsolePolicy,
  updateConsolePolicy,
  getConsoleCatalog,
  type ConsolePolicySettings,
  type Product,
} from "@/lib/api";
import { formatPaise } from "@/lib/formatters";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { RefreshButton } from "@/components/dashboard/commerce-ui";
import {
  Section,
  PartialBanner,
} from "@/components/dashboard/tier-fallbacks";

type SimVerdict = "ALLOW" | "OFFER BELOW FLOOR" | "BLOCKED";

const SIM_VERDICT_LABEL: Record<SimVerdict, string> = {
  ALLOW: "Allow",
  "OFFER BELOW FLOOR": "Offer below floor",
  BLOCKED: "Blocked",
};

const PRIMARY_PILL =
  "inline-flex items-center gap-2 h-9 px-5 rounded-full bg-[#0071e3] text-white text-[13px] font-semibold shadow-sm hover:bg-[#0077ed] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]";
const APPLE_INPUT =
  "h-9 rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-3 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow";
const ROW = "py-3 flex items-center justify-between gap-3 border-b border-black/[0.06] last:border-b-0";

export default function SellingRulesPage() {
  const [policy, setPolicy] = useState<ConsolePolicySettings | null>(null);
  const [editing, setEditing] = useState<Partial<ConsolePolicySettings>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<"success" | "error" | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Policy simulator (frontend-only preview against LOADED policy values).
  const [catalog, setCatalog] = useState<Product[] | null>(null);
  const [simSku, setSimSku] = useState("");
  const [simOffer, setSimOffer] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setPartialError(null);
    const [p, c] = await Promise.allSettled([getConsolePolicy(), getConsoleCatalog()]);
    if (p.status === "fulfilled") {
      setPolicy(p.value);
      setEditing({});
    } else {
      setPolicy(null);
      setLoadError(
        p.reason instanceof TypeError
          ? "Backend unreachable — selling rules could not be loaded."
          : "Selling rules could not be loaded from the backend."
      );
    }
    if (c.status === "fulfilled") setCatalog(c.value);
    else {
      setCatalog(null);
      if (p.status === "fulfilled") setPartialError("Product catalog failed to load — the policy simulator needs it.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const handleChange = (key: keyof ConsolePolicySettings, value: string) => {
    if (!policy) return;
    let parsed: string | number | string[];
    if (key === "allowed_categories") {
      parsed = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key === "merchant_id" || key === "currency") {
      parsed = value;
    } else {
      parsed = parseInt(value, 10) || 0;
    }
    setEditing((prev) => ({ ...prev, [key]: parsed }));
  };

  const current = policy ? { ...policy, ...editing } : null;
  const hasChanges = Object.keys(editing).length > 0;

  const handleSave = async () => {
    if (!policy || !hasChanges) return;
    const merged = { ...policy, ...editing };
    for (const key of ["max_order_value_paise", "max_single_item_value_paise", "human_approval_threshold_paise"] as const) {
      const v = merged[key];
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
        setSaveMsg(null);
        setValidationError(`${String(key)} must be a positive whole paise amount.`);
        return;
      }
    }
    if (typeof merged.max_discount_percent !== "number" || merged.max_discount_percent < 0 || merged.max_discount_percent > 100) {
      setSaveMsg(null);
      setValidationError("max_discount_percent must be between 0 and 100.");
      return;
    }
    for (const key of ["max_negotiation_rounds", "max_upsells_per_session"] as const) {
      const v = merged[key];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        setSaveMsg(null);
        setValidationError(`${key} must be a whole number of 0 or more.`);
        return;
      }
    }
    if (merged.human_approval_threshold_paise > merged.max_order_value_paise) {
      setSaveMsg(null);
      setValidationError("The approval threshold cannot exceed the max order value.");
      return;
    }
    setValidationError(null);
    setSaving(true);
    setSaveMsg(null);
    try {
      const allowed = ["max_order_value_paise", "max_single_item_value_paise", "max_discount_percent", "allowed_categories", "max_negotiation_rounds", "max_upsells_per_session", "human_approval_threshold_paise"];
      const payload: Record<string, unknown> = {};
      for (const key of allowed) {
        if (key in editing) payload[key] = editing[key as keyof ConsolePolicySettings];
      }
      const updated = await updateConsolePolicy(payload);
      setPolicy(updated);
      setEditing({});
      setSaveMsg("success");
      setTimeout(() => setSaveMsg(null), 3000);
    } catch {
      setSaveMsg("error");
      setTimeout(() => setSaveMsg(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  // --- Simulator: compare a hypothetical offer against LOADED policy values.
  const simProduct = (catalog ?? []).find((p) => p.sku === simSku) ?? null;
  const simOfferPaise = Math.round(parseFloat(simOffer) * 100);
  const simOfferValid = Number.isFinite(simOfferPaise) && simOfferPaise > 0;
  let simVerdict: SimVerdict | null = null;
  let simNotes: string[] = [];
  if (current && simProduct && simOfferValid) {
    simNotes = [];
    const belowFloor = simOfferPaise < simProduct.floor_paise;
    const discountPct = simProduct.price_paise > 0
      ? ((simProduct.price_paise - simOfferPaise) / simProduct.price_paise) * 100
      : 0;
    const overDiscount = discountPct > current.max_discount_percent;
    const categoryOk = current.allowed_categories.length === 0 || current.allowed_categories.includes(simProduct.category);
    const itemTooBig = simProduct.price_paise > current.max_single_item_value_paise;
    if (belowFloor) {
      simVerdict = "OFFER BELOW FLOOR";
      simNotes.push(`Offer ${formatPaise(simOfferPaise)} is below the merchant floor ${formatPaise(simProduct.floor_paise)} for ${simProduct.sku}.`);
    } else {
      simVerdict = "ALLOW";
      simNotes.push(`Offer ${formatPaise(simOfferPaise)} meets the merchant floor ${formatPaise(simProduct.floor_paise)}.`);
    }
    if (overDiscount) {
      simVerdict = "BLOCKED";
      simNotes.push(`Discount ${discountPct.toFixed(1)}% exceeds the max discount ${current.max_discount_percent}%.`);
    }
    if (!categoryOk) {
      simVerdict = "BLOCKED";
      simNotes.push(`Category "${simProduct.category}" is not in allowed_categories.`);
    }
    if (itemTooBig) {
      simVerdict = "BLOCKED";
      simNotes.push(`List price ${formatPaise(simProduct.price_paise)} exceeds max single-item value ${formatPaise(current.max_single_item_value_paise)}.`);
    }
  }

  const paiseField = (label: string, key: "max_order_value_paise" | "max_single_item_value_paise" | "human_approval_threshold_paise", highlight = false) => {
    if (!current) return null;
    const value = current[key];
    const isEditing = key in editing;
    return (
      <div className={ROW}>
        <span className={`text-[13px] ${highlight ? "font-medium text-[#0071e3]" : "text-neutral-500"}`}>{label}</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={Math.round((value as number) / 100)}
            onChange={(e) => handleChange(key, String(parseInt(e.target.value || "0", 10) * 100))}
            className="w-[120px] h-9 rounded-[10px] bg-white border text-[14px] text-right tabular-nums px-2.5 text-neutral-900 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
            style={{ borderColor: isEditing ? "#0071e3" : "rgba(0,0,0,0.12)" }}
            aria-label={label}
          />
          <span className="text-[13px] text-neutral-400 w-[20px]">₹</span>
        </div>
      </div>
    );
  };

  const countField = (label: string, key: "max_negotiation_rounds" | "max_upsells_per_session" | "max_discount_percent", suffix = "") => {
    if (!current) return null;
    const value = current[key];
    const isEditing = key in editing;
    return (
      <div className={ROW}>
        <span className="text-[13px] text-neutral-500">{label}</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={value as number}
            onChange={(e) => handleChange(key, e.target.value)}
            className="w-[80px] h-9 rounded-[10px] bg-white border text-[14px] text-right tabular-nums px-2.5 text-neutral-900 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
            style={{ borderColor: isEditing ? "#0071e3" : "rgba(0,0,0,0.12)" }}
            aria-label={label}
          />
          <span className="text-[13px] text-neutral-400 w-[20px]">{suffix}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="Selling Rules"
        subtitle="Boundaries you control · ENFORCED BY THE POLICY ENGINE"
        actions={
          <>
            <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
            <button onClick={() => void handleSave()} disabled={!hasChanges || saving} className={PRIMARY_PILL}>
              <Save size={13} /> {saving ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      />

      {saveMsg === "success" && (
        <div className="rounded-2xl bg-green-50/80 backdrop-blur-xl border border-green-200/60 px-4 py-3 flex items-center gap-2.5">
          <span className="flex items-center justify-center size-6 rounded-full bg-green-100 shrink-0" aria-hidden>
            <Check size={13} className="text-green-700" />
          </span>
          <span className="text-[13px] text-green-900">
            Policy updated successfully. Changes are enforced immediately.
          </span>
        </div>
      )}
      {saveMsg === "error" && <ErrorBanner message="Failed to update policy. Please try again." onRetry={() => void handleSave()} />}
      {validationError && <PartialBanner message={validationError} />}
      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}
      {partialError && <PartialBanner message={partialError} />}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : !current ? (
        <EmptyState title="Selling rules unavailable" message="Policy could not be loaded from the backend." />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section title="Pricing" hint={hasChanges ? "Unsaved changes" : "Max order + max item + max discount"}>
              {paiseField("Max order value", "max_order_value_paise")}
              {paiseField("Max single-item value", "max_single_item_value_paise")}
              {countField("Max discount", "max_discount_percent", "%")}
            </Section>
            <Section title="Negotiation" hint={hasChanges ? "Unsaved changes" : "Rounds the seller may counter"}>
              {countField("Max negotiation rounds", "max_negotiation_rounds")}
              <div className="pt-3 text-[13px] text-neutral-500 leading-relaxed">
                After this many rounds the seller holds its position or walks away, per backend policy.
              </div>
            </Section>
            <Section title="Approvals" hint={hasChanges ? "Unsaved changes" : "Human-in-the-loop threshold"}>
              {paiseField("Human approval threshold", "human_approval_threshold_paise", true)}
              <div className="pt-3 text-[13px] text-neutral-500 leading-relaxed">
                Orders at or above this amount are held for merchant approval before consent and payment.
              </div>
            </Section>
            <Section title="Products" hint={hasChanges ? "Unsaved changes" : "Categories the seller may sell"}>
              <div className="text-[13px] text-neutral-500 mb-2">Allowed categories</div>
              <input
                type="text"
                value={current.allowed_categories.join(", ")}
                onChange={(e) => handleChange("allowed_categories", e.target.value)}
                className={`${APPLE_INPUT} w-full`}
                style={{ borderColor: "allowed_categories" in editing ? "#0071e3" : undefined }}
              />
              <div className="text-[12px] text-neutral-400 mt-1.5">Comma-separated list of allowed product categories</div>
            </Section>
          </div>

          <Section title="Upsells" hint={hasChanges ? "Unsaved changes" : "Attach limit per session"}>
            <div className="max-w-[420px]">
              {countField("Max upsells per session", "max_upsells_per_session")}
            </div>
          </Section>

          {/* Policy simulator — frontend-only preview */}
          <Section title="Policy simulator" hint="Preview only — final decisions are made by the server">
            <div className="flex items-start gap-2 mb-4">
              <FlaskConical size={14} className="text-neutral-400 mt-0.5 shrink-0" />
              <p className="text-[14px] text-neutral-600 leading-relaxed">
                Pick a loaded product and enter a hypothetical buyer offer. The simulator compares it against
                the loaded policy values (floor, discount, category, item cap) in the browser only.
                Preview only — final decisions are made by the server.
              </p>
            </div>
            {catalog === null ? (
              <div className="text-[14px] text-neutral-500">Catalog unavailable — the simulator needs loaded products.</div>
            ) : catalog.length === 0 ? (
              <div className="text-[14px] text-neutral-500">No products loaded — add products in Catalog first.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] text-neutral-500">Product</span>
                  <select
                    value={simSku}
                    onChange={(e) => setSimSku(e.target.value)}
                    className={`${APPLE_INPUT} w-full cursor-pointer`}
                  >
                    <option value="">Select a product…</option>
                    {catalog.map((p) => (
                      <option key={p.sku} value={p.sku}>
                        {p.sku} · {formatPaise(p.price_paise)} · floor {formatPaise(p.floor_paise)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] text-neutral-500">Hypothetical buyer offer (₹)</span>
                  <input
                    type="number"
                    min="1"
                    value={simOffer}
                    onChange={(e) => setSimOffer(e.target.value)}
                    placeholder="1800"
                    className={`${APPLE_INPUT} w-full tabular-nums`}
                  />
                </label>
              </div>
            )}
            {simVerdict && (
              <div className={`rounded-2xl border p-4 ${simVerdict === "ALLOW" ? "border-green-200/60 bg-green-50" : "border-red-200/60 bg-red-50"}`}>
                <div className={`mb-2 inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${simVerdict === "ALLOW" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                  {SIM_VERDICT_LABEL[simVerdict]}
                </div>
                <ul className="space-y-1">
                  {simNotes.map((n, i) => (
                    <li key={i} className="text-[14px] text-neutral-600 leading-relaxed">{n}</li>
                  ))}
                </ul>
                <div className="mt-2 text-[12px] text-neutral-400">
                  Preview only — final decisions are made by the server.
                </div>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
