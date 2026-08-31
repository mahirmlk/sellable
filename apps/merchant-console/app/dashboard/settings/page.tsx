"use client";

import { useEffect, useState, useCallback } from "react";
import { Save, RefreshCw, Check, AlertCircle } from "lucide-react";
import { formatPaise } from "@/lib/formatters";
import { getConsolePolicy, updateConsolePolicy, type ConsolePolicySettings } from "@/lib/api";

export default function SettingsPage() {
  const [policy, setPolicy] = useState<ConsolePolicySettings | null>(null);
  const [editing, setEditing] = useState<Partial<ConsolePolicySettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<"success" | "error" | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getConsolePolicy();
      setPolicy(data);
      setEditing({});
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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

  const handleSave = async () => {
    if (!policy || Object.keys(editing).length === 0) return;
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
    } finally { setSaving(false); }
  };

  const hasChanges = Object.keys(editing).length > 0;

  const policyFields = [
    { label: "MAX ORDER VALUE", key: "max_order_value_paise" as const, isPaise: true },
    { label: "MAX ITEM VALUE", key: "max_single_item_value_paise" as const, isPaise: true },
    { label: "MAX DISCOUNT", key: "max_discount_percent" as const, isPaise: false, suffix: "%" },
    { label: "NEGOTIATION ROUNDS", key: "max_negotiation_rounds" as const, isPaise: false },
    { label: "MAX UPSELLS / SESSION", key: "max_upsells_per_session" as const, isPaise: false },
    { label: "HITL THRESHOLD", key: "human_approval_threshold_paise" as const, isPaise: true, highlight: true },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Settings</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">MERCHANT-CONTROLLED BOUNDARIES</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
          </button>
          <button onClick={handleSave} disabled={!hasChanges || saving} className="inline-flex items-center gap-2 h-[32px] px-4 border font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" style={{ borderColor: hasChanges ? "var(--bb-orange)" : "var(--bb-line)", backgroundColor: hasChanges ? "color-mix(in srgb, var(--bb-orange) 10%, transparent)" : "var(--bb-panel)", color: hasChanges ? "var(--bb-orange)" : "var(--bb-grey-3)" }}>
            <Save size={12} /> {saving ? "SAVING..." : "SAVE CHANGES"}
          </button>
        </div>
      </div>

      {saveMsg === "success" && (
        <div className="border border-green-400/30 bg-green-400/5 px-5 py-3 flex items-center gap-2">
          <Check size={14} className="text-green-400" />
          <span className="font-[var(--font-mono)] text-[0.65rem] text-green-400">Policy updated successfully. Changes are enforced immediately.</span>
        </div>
      )}
      {saveMsg === "error" && (
        <div className="border border-red-400/30 bg-red-400/5 px-5 py-3 flex items-center gap-2">
          <AlertCircle size={14} className="text-red-400" />
          <span className="font-[var(--font-mono)] text-[0.65rem] text-red-400">Failed to update policy. Please try again.</span>
        </div>
      )}

      {!current ? (
        <div className="border border-[var(--bb-line)] px-5 py-12 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">
          {loading ? "Loading policy..." : "Failed to load policy."}
        </div>
      ) : (
        <>
          <div className="border border-[var(--bb-line)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between">
              <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">POLICY SETTINGS</div>
              <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">
                {hasChanges ? "UNSAVED CHANGES" : "Configured by merchant · Enforced by Policy Engine"}
              </div>
            </div>

            <div className="px-5 py-4 border-b border-[var(--bb-line-soft)]">
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Merchant</div>
              <div className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-white)]">{current.merchant_id}</div>
            </div>

            {policyFields.map((field, i) => {
              const value = current[field.key];
              const isEditing = field.key in editing;
              return (
                <div key={field.key} className={`px-5 py-4 flex items-center justify-between ${i < policyFields.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
                  <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)]">{field.label}</span>
                  <div className="flex items-center gap-2">
                    {field.isPaise ? (
                      <input
                        type="number"
                        value={Math.round((value as number) / 100)}
                        onChange={(e) => handleChange(field.key, String(parseInt(e.target.value || "0", 10) * 100))}
                        className="w-[120px] font-[var(--font-mono)] text-[0.85rem] text-right bg-[var(--bb-panel)] border px-2 py-1 transition-colors focus:outline-none"
                        style={{ borderColor: isEditing ? "var(--bb-orange)" : "var(--bb-line)", color: isEditing ? "var(--bb-orange)" : "var(--bb-white)" }}
                      />
                    ) : (
                      <input
                        type="number"
                        value={value as number}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        className="w-[80px] font-[var(--font-mono)] text-[0.85rem] text-right bg-[var(--bb-panel)] border px-2 py-1 transition-colors focus:outline-none"
                        style={{ borderColor: isEditing ? "var(--bb-orange)" : "var(--bb-line)", color: isEditing ? "var(--bb-orange)" : "var(--bb-white)" }}
                      />
                    )}
                    <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-4)] w-[20px]">₹</span>
                  </div>
                </div>
              );
            })}

            <div className="px-5 py-4 border-t border-[var(--bb-line)]">
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-3">ALLOWED CATEGORIES</div>
              <input
                type="text"
                value={current.allowed_categories.join(", ")}
                onChange={(e) => handleChange("allowed_categories", e.target.value)}
                className="w-full font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
                style={{ borderColor: "allowed_categories" in editing ? "var(--bb-orange)" : undefined }}
              />
              <div className="font-[var(--font-mono)] text-[0.48rem] text-[var(--bb-grey-4)] mt-1">Comma-separated list of allowed product categories</div>
            </div>
          </div>

          <div className="border border-[var(--bb-line)] p-5">
            <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)] leading-relaxed">
              Changing a policy creates an auditable configuration event in the backend. All policy changes are logged in the XAI Ledger and enforced deterministically by the Policy Engine — never by the browser.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
