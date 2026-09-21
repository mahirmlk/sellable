"use client";

import { useState, useEffect, useCallback } from "react";
import { Save, RefreshCw, Check, AlertCircle, FlaskConical } from "lucide-react";
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
import {
  Section,
  PartialBanner,
} from "@/components/dashboard/tier-fallbacks";

type SimVerdict = "ALLOW" | "OFFER BELOW FLOOR" | "BLOCKED";

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
      <div className="py-3 flex items-center justify-between gap-3 border-b border-[var(--bb-line-soft)] last:border-b-0">
        <span className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase ${highlight ? "text-[var(--bb-orange)]" : "text-[var(--bb-grey-3)]"}`}>{label}</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={Math.round((value as number) / 100)}
            onChange={(e) => handleChange(key, String(parseInt(e.target.value || "0", 10) * 100))}
            className="w-[120px] font-[var(--font-mono)] text-[0.85rem] text-right bg-[var(--bb-panel)] border px-2 py-1 transition-colors focus:outline-none"
            style={{ borderColor: isEditing ? "var(--bb-orange)" : "var(--bb-line)", color: isEditing ? "var(--bb-orange)" : "var(--bb-white)" }}
            aria-label={label}
          />
          <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-4)] w-[20px]">₹</span>
        </div>
      </div>
    );
  };

  const countField = (label: string, key: "max_negotiation_rounds" | "max_upsells_per_session" | "max_discount_percent", suffix = "") => {
    if (!current) return null;
    const value = current[key];
    const isEditing = key in editing;
    return (
      <div className="py-3 flex items-center justify-between gap-3 border-b border-[var(--bb-line-soft)] last:border-b-0">
        <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)]">{label}</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={value as number}
            onChange={(e) => handleChange(key, e.target.value)}
            className="w-[80px] font-[var(--font-mono)] text-[0.85rem] text-right bg-[var(--bb-panel)] border px-2 py-1 transition-colors focus:outline-none"
            style={{ borderColor: isEditing ? "var(--bb-orange)" : "var(--bb-line)", color: isEditing ? "var(--bb-orange)" : "var(--bb-white)" }}
            aria-label={label}
          />
          <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-4)] w-[20px]">{suffix}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Selling Rules"
        subtitle="MERCHANT-CONTROLLED BOUNDARIES · ENFORCED BY THE POLICY ENGINE"
        actions={
          <>
            <button onClick={() => void fetchData()} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
            </button>
            <button onClick={() => void handleSave()} disabled={!hasChanges || saving} className="inline-flex items-center gap-2 h-[32px] px-4 border font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" style={{ borderColor: hasChanges ? "var(--bb-orange)" : "var(--bb-line)", backgroundColor: hasChanges ? "color-mix(in srgb, var(--bb-orange) 10%, transparent)" : "var(--bb-panel)", color: hasChanges ? "var(--bb-orange)" : "var(--bb-grey-3)" }}>
              <Save size={12} /> {saving ? "SAVING..." : "SAVE CHANGES"}
            </button>
          </>
        }
      />

      {saveMsg === "success" && (
        <div className="border border-green-400/30 bg-green-400/5 px-5 py-3 flex items-center gap-2">
          <Check size={14} className="text-green-400" />
          <span className="font-[var(--font-mono)] text-[0.65rem] text-green-400">Policy updated successfully. Changes are enforced immediately.</span>
        </div>
      )}
      {saveMsg === "error" && <ErrorBanner message="Failed to update policy. Please try again." onRetry={() => void handleSave()} />}
      {validationError && (
        <div className="border border-amber-400/30 bg-amber-400/5 px-5 py-3 flex items-center gap-2">
          <AlertCircle size={14} className="text-amber-400" />
          <span className="font-[var(--font-mono)] text-[0.65rem] text-amber-400">{validationError}</span>
        </div>
      )}
      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}
      {partialError && <PartialBanner message={partialError} />}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : !current ? (
        <EmptyState title="Selling rules unavailable" message="Policy could not be loaded from the backend." />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section title="PRICING" hint={hasChanges ? "UNSAVED CHANGES" : "MAX ORDER + MAX ITEM + MAX DISCOUNT"}>
              {paiseField("Max order value", "max_order_value_paise")}
              {paiseField("Max single-item value", "max_single_item_value_paise")}
              {countField("Max discount", "max_discount_percent", "%")}
            </Section>
            <Section title="NEGOTIATION" hint={hasChanges ? "UNSAVED CHANGES" : "ROUNDS THE SELLER MAY COUNTER"}>
              {countField("Max negotiation rounds", "max_negotiation_rounds")}
              <div className="pt-3 font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-3)] leading-relaxed">
                After this many rounds the seller holds its position or walks away, per backend policy.
              </div>
            </Section>
            <Section title="APPROVALS" hint={hasChanges ? "UNSAVED CHANGES" : "HUMAN-IN-THE-LOOP THRESHOLD"}>
              {paiseField("Human approval threshold", "human_approval_threshold_paise", true)}
              <div className="pt-3 font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-3)] leading-relaxed">
                Orders at or above this amount are held for merchant approval before consent and payment.
              </div>
            </Section>
            <Section title="PRODUCTS" hint={hasChanges ? "UNSAVED CHANGES" : "CATEGORIES THE SELLER MAY SELL"}>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-2">ALLOWED CATEGORIES</div>
              <input
                type="text"
                value={current.allowed_categories.join(", ")}
                onChange={(e) => handleChange("allowed_categories", e.target.value)}
                className="w-full font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
                style={{ borderColor: "allowed_categories" in editing ? "var(--bb-orange)" : undefined }}
              />
              <div className="font-[var(--font-mono)] text-[0.48rem] text-[var(--bb-grey-4)] mt-1">Comma-separated list of allowed product categories</div>
            </Section>
          </div>

          <Section title="UPSELLS" hint={hasChanges ? "UNSAVED CHANGES" : "ATTACH LIMIT PER SESSION"}>
            <div className="max-w-[420px]">
              {countField("Max upsells per session", "max_upsells_per_session")}
            </div>
          </Section>

          {/* Policy simulator — frontend-only preview */}
          <Section title="POLICY SIMULATOR" hint="PREVIEW ONLY — FINAL DECISIONS ARE MADE BY THE SERVER">
            <div className="flex items-start gap-2 mb-4">
              <FlaskConical size={14} className="text-[var(--bb-grey-3)] mt-0.5 shrink-0" />
              <p className="font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-2)] leading-relaxed">
                Pick a loaded product and enter a hypothetical buyer offer. The simulator compares it against
                the loaded policy values (floor, discount, category, item cap) in the browser only.
                Preview only — final decisions are made by the server.
              </p>
            </div>
            {catalog === null ? (
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">Catalog unavailable — the simulator needs loaded products.</div>
            ) : catalog.length === 0 ? (
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">No products loaded — add products in Catalog first.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <label className="flex flex-col gap-1">
                  <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">PRODUCT</span>
                  <select
                    value={simSku}
                    onChange={(e) => setSimSku(e.target.value)}
                    className="font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 cursor-pointer"
                  >
                    <option value="">Select a product…</option>
                    {catalog.map((p) => (
                      <option key={p.sku} value={p.sku}>
                        {p.sku} · {formatPaise(p.price_paise)} · floor {formatPaise(p.floor_paise)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">HYPOTHETICAL BUYER OFFER (₹)</span>
                  <input
                    type="number"
                    min="1"
                    value={simOffer}
                    onChange={(e) => setSimOffer(e.target.value)}
                    placeholder="1800"
                    className="font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 tabular-nums focus:outline-none focus:border-[var(--bb-orange)]"
                  />
                </label>
              </div>
            )}
            {simVerdict && (
              <div className={`border p-4 ${simVerdict === "ALLOW" ? "border-green-400/30 bg-green-400/5" : "border-red-400/30 bg-red-400/5"}`}>
                <div className={`font-[var(--font-mono)] text-[0.7rem] tracking-[0.12em] uppercase mb-2 ${simVerdict === "ALLOW" ? "text-green-400" : "text-red-400"}`}>
                  {simVerdict === "ALLOW" ? "✓ ALLOW" : `✕ ${simVerdict}`}
                </div>
                <ul className="space-y-1">
                  {simNotes.map((n, i) => (
                    <li key={i} className="font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-2)] leading-relaxed">{n}</li>
                  ))}
                </ul>
                <div className="mt-2 font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">
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
