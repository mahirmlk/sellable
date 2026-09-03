"use client";

import { useEffect, useState, useCallback } from "react";
import { Save, RefreshCw, Check, AlertCircle } from "lucide-react";
import {
  getConsolePolicy,
  updateConsolePolicy,
  type ConsolePolicySettings,
} from "@/lib/api";
import { StatusIndicator } from "@/components/dashboard/status-indicator";
import { useSystemStatus, classifyError, type StatusError } from "@/components/dashboard/use-system-status";
import { providerLabel, modelLabel, llmDisplayState } from "@/lib/llm-display";

const LLM_STATE_TEXT: Record<string, { text: string; color: string }> = {
  connected: { text: "Connected", color: "text-green-400" },
  scripted: { text: "Scripted", color: "text-yellow-400" },
  unconfigured: { text: "Unconfigured", color: "text-yellow-400" },
  error: { text: "Error", color: "text-red-400" },
  unknown: { text: "Unknown", color: "text-[var(--bb-grey-4)]" },
};

function PolicyLoadBanner({ error, loading }: { error: StatusError | null; loading: boolean }) {
  if (loading) return null;
  if (!error) return null;
  const message =
    error.kind === "auth"
      ? "Authentication problem — policy could not be loaded. Sign in again or check the backend Supabase configuration."
      : error.kind === "endpoint"
        ? "Wrong endpoint — the policy route was not found on the backend."
        : error.kind === "network"
          ? "Backend unreachable — policy could not be loaded."
          : error.kind === "contract"
            ? "Malformed policy response from the backend."
            : `Backend error while loading policy: ${error.message}`;
  return (
    <div className="border border-red-400/30 bg-red-400/5 px-5 py-3 flex items-start gap-2">
      <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
      <span className="font-[var(--font-mono)] text-[0.6rem] text-red-400">{message}</span>
    </div>
  );
}

export default function SettingsPage() {
  const [policy, setPolicy] = useState<ConsolePolicySettings | null>(null);
  const [editing, setEditing] = useState<Partial<ConsolePolicySettings>>({});
  const [loading, setLoading] = useState(true);
  const [policyError, setPolicyError] = useState<StatusError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<"success" | "error" | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const { data: status, loading: statusLoading, error: statusError, reload: reloadStatus } = useSystemStatus();

  const fetchPolicy = useCallback(async () => {
    setLoading(true);
    setPolicyError(null);
    try {
      const p = await getConsolePolicy();
      setPolicy(p);
      setEditing({});
    } catch (err) {
      setPolicy(null);
      setPolicyError(classifyError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchPolicy(), 0);
    return () => window.clearTimeout(t);
  }, [fetchPolicy]);

  const handleRefresh = () => {
    void fetchPolicy();
    reloadStatus();
  };

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
    // Client-side guardrails mirror the backend contract (PositivePaise,
    // 0-100 discount, non-negative counts) so a cleared field fails fast
    // here instead of surfacing a generic 422 from the API.
    const merged = { ...policy, ...editing };
    const positivePaise: Array<keyof ConsolePolicySettings> = [
      "max_order_value_paise",
      "max_single_item_value_paise",
      "human_approval_threshold_paise",
    ];
    for (const key of positivePaise) {
      const v = merged[key];
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
        setSaveMsg(null);
        setValidationError(`${String(key)} must be a positive whole paise amount.`);
        return;
      }
    }
    if (
      typeof merged.max_discount_percent !== "number" ||
      merged.max_discount_percent < 0 ||
      merged.max_discount_percent > 100
    ) {
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

  const llmState = llmDisplayState(status?.llm ?? null);
  const llmMeta = LLM_STATE_TEXT[llmState] ?? LLM_STATE_TEXT.unknown;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Settings</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">MERCHANT-CONTROLLED BOUNDARIES</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleRefresh} disabled={loading || statusLoading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw size={12} className={loading || statusLoading ? "animate-spin" : ""} /> REFRESH
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
      {validationError && (
        <div className="border border-amber-400/30 bg-amber-400/5 px-5 py-3 flex items-center gap-2">
          <AlertCircle size={14} className="text-amber-400" />
          <span className="font-[var(--font-mono)] text-[0.65rem] text-amber-400">{validationError}</span>
        </div>
      )}

      {!current ? (
        <div className="border border-[var(--bb-line)] px-5 py-12 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">
          {loading ? "Loading policy..." : "Policy unavailable."}
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
              const unit = field.suffix ?? (field.isPaise ? "₹" : "");
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
                    <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-4)] w-[20px]">{unit}</span>
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

      <PolicyLoadBanner error={policyError} loading={loading} />

      <div className="border border-[var(--bb-line)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between">
          <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">AGENT & SYSTEM STATUS</div>
          <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">READ FROM BACKEND /agents/status</div>
        </div>
        <div className="px-5 py-2">
          {statusError ? (
            <div className="flex items-start gap-2 px-1 py-2" title={statusError.message}>
              <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
              <span className="font-[var(--font-mono)] text-[0.6rem] text-amber-400">
                {statusError.kind === "auth"
                  ? "Authentication problem fetching status."
                  : statusError.kind === "network"
                    ? "Backend unreachable while fetching status."
                    : statusError.kind === "endpoint"
                      ? "Wrong status endpoint on the backend."
                      : `Status fetch failed: ${statusError.message}`}
              </span>
            </div>
          ) : (
            <>
              <StatusIndicator label="Seller Agent" state={status?.seller_agent.state} detail={status?.seller_agent.detail} mode={status?.seller_agent.mode} loading={statusLoading} />
              <StatusIndicator label="Buyer Agent" state={status?.buyer_agent.state} detail={status?.buyer_agent.detail} mode={status?.buyer_agent.mode} loading={statusLoading} />
              <StatusIndicator label="Agent Gateway" state={status?.agent_gateway.state} detail={status?.agent_gateway.detail} loading={statusLoading} />
              <StatusIndicator label="Policy Engine" state={status?.policy_engine.state} detail={status?.policy_engine.detail} loading={statusLoading} />
              <StatusIndicator label="Payment Rail" state={status?.payment_rail.state} detail={status?.payment_rail.detail} loading={statusLoading} />
              <StatusIndicator label="Ledger" state={status?.ledger.state} detail={status?.ledger.detail} loading={statusLoading} />
            </>
          )}
        </div>
        <div className="px-5 py-4 border-t border-[var(--bb-line-soft)]">
          <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-2">AI / MODEL CONFIGURATION</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Provider</div>
              <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">{providerLabel(status?.llm.provider)}</div>
            </div>
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Model</div>
              <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">{modelLabel(status?.llm.model)}</div>
            </div>
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Status</div>
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${llmState === "connected" ? "bg-green-500" : llmState === "scripted" ? "bg-yellow-400" : llmState === "error" ? "bg-red-400" : "bg-yellow-400"}`} />
                <span className={`font-[var(--font-mono)] text-[0.7rem] ${llmMeta.color}`}>
                  {llmMeta.text}
                </span>
              </div>
              {status?.llm.reason && (
                <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)] mt-1">Reason: {status.llm.reason}</div>
              )}
              {status?.llm.detail && (
                <div className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] mt-1">{status.llm.detail}</div>
              )}
            </div>
          </div>
          {status?.payment_rail.webhook_last_verified_at && (
            <div className="mt-3 pt-3 border-t border-[var(--bb-line-soft)] font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)]">
              Payment API configured · Webhook configured · Last webhook verified {new Date(status.payment_rail.webhook_last_verified_at).toLocaleString("en-IN", { hour12: false })}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-[var(--bb-line-soft)] font-[var(--font-sans)] text-[0.7rem] text-[var(--bb-grey-3)] leading-relaxed">
            Provider and model can be substituted without changing Commerce Core, Policy, Payments, Ledger, or the console. Credentials never leave the backend.
          </div>
        </div>
      </div>
    </div>
  );
}