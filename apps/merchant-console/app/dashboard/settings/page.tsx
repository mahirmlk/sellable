"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Save, Check, ArrowRight } from "lucide-react";
import {
  getConsolePolicy,
  updateConsolePolicy,
  type ConsolePolicySettings,
} from "@/lib/api";
import { StatusIndicator } from "@/components/dashboard/status-indicator";
import { useSystemStatus, classifyError, type StatusError } from "@/components/dashboard/use-system-status";
import { providerLabel, modelLabel, llmDisplayState } from "@/lib/llm-display";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { RefreshButton } from "@/components/dashboard/commerce-ui";
import {
  Section,
  PartialBanner,
} from "@/components/dashboard/tier-fallbacks";

const LLM_STATE_TEXT: Record<string, { text: string; color: string }> = {
  connected: { text: "Connected", color: "text-green-700" },
  scripted: { text: "Scripted", color: "text-[#b25e00]" },
  unconfigured: { text: "Unconfigured", color: "text-[#b25e00]" },
  error: { text: "Error", color: "text-red-700" },
  unknown: { text: "Unknown", color: "text-neutral-400" },
};

const PRIMARY_PILL =
  "inline-flex items-center gap-2 h-9 px-5 rounded-full bg-[#0071e3] text-white text-[13px] font-semibold shadow-sm hover:bg-[#0077ed] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]";
const APPLE_INPUT =
  "h-9 rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-3 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow";
const CROSS_LINK =
  "mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#0071e3] hover:underline focus-visible:outline-2 focus-visible:outline-[#0071e3]";
const ROW = "py-3 flex items-center justify-between gap-3 border-b border-black/[0.06] last:border-b-0";

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
  return <ErrorBanner message={message} />;
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

  const sellingFields = [
    { label: "Max order value", key: "max_order_value_paise" as const, isPaise: true },
    { label: "Max item value", key: "max_single_item_value_paise" as const, isPaise: true },
    { label: "Max discount", key: "max_discount_percent" as const, isPaise: false, suffix: "%" },
    { label: "Negotiation rounds", key: "max_negotiation_rounds" as const, isPaise: false },
    { label: "Max upsells / session", key: "max_upsells_per_session" as const, isPaise: false },
    { label: "HITL threshold", key: "human_approval_threshold_paise" as const, isPaise: true, highlight: true },
  ];

  const llmState = llmDisplayState(status?.llm ?? null);
  const llmMeta = LLM_STATE_TEXT[llmState] ?? LLM_STATE_TEXT.unknown;

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="Settings"
        subtitle="Boundaries you control"
        actions={
          <>
            <RefreshButton onRefresh={handleRefresh} loading={loading || statusLoading} />
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

      <PolicyLoadBanner error={policyError} loading={loading} />

      {loading ? (
        <TableSkeleton rows={8} />
      ) : !current ? (
        <EmptyState title="Policy unavailable" message="Policy could not be loaded from the backend." />
      ) : (
        <>
          {/* Store — identity + what the seller may sell */}
          <Section title="Store" hint="Merchant identity · read-only + categories">
            <div className="py-2 border-b border-black/[0.06]">
              <div className="text-[13px] text-neutral-500 mb-1">Merchant</div>
              <div className="text-[15px] font-medium text-neutral-900">{current.merchant_id}</div>
            </div>
            <div className="py-2 border-b border-black/[0.06]">
              <div className="text-[13px] text-neutral-500 mb-1">Currency</div>
              <div className="text-[15px] font-medium text-neutral-900">{current.currency}</div>
            </div>
            <div className="pt-3">
              <div className="text-[13px] text-neutral-500 mb-2">Allowed categories</div>
              <input
                type="text"
                value={current.allowed_categories.join(", ")}
                onChange={(e) => handleChange("allowed_categories", e.target.value)}
                className={`${APPLE_INPUT} w-full`}
                style={{ borderColor: "allowed_categories" in editing ? "#0071e3" : undefined }}
              />
              <div className="text-[12px] text-neutral-400 mt-1.5">Comma-separated list of allowed product categories</div>
            </div>
          </Section>

          {/* Selling — the editable policy core (full editor lives in Selling Rules) */}
          <Section title="Selling" hint={hasChanges ? "Unsaved changes" : "Full editor in Selling Rules"}>
            {sellingFields.map((field) => {
              const value = current[field.key];
              const isEditing = field.key in editing;
              const unit = field.suffix ?? (field.isPaise ? "₹" : "");
              return (
                <div key={field.key} className={ROW}>
                  <span className={`text-[13px] ${field.highlight ? "font-medium text-[#0071e3]" : "text-neutral-500"}`}>{field.label}</span>
                  <div className="flex items-center gap-2">
                    {field.isPaise ? (
                      <input
                        type="number"
                        value={Math.round((value as number) / 100)}
                        onChange={(e) => handleChange(field.key, String(parseInt(e.target.value || "0", 10) * 100))}
                        className="w-[120px] h-9 rounded-[10px] bg-white border text-[14px] text-right tabular-nums px-2.5 text-neutral-900 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
                        style={{ borderColor: isEditing ? "#0071e3" : "rgba(0,0,0,0.12)" }}
                        aria-label={field.label}
                      />
                    ) : (
                      <input
                        type="number"
                        value={value as number}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        className="w-[80px] h-9 rounded-[10px] bg-white border text-[14px] text-right tabular-nums px-2.5 text-neutral-900 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
                        style={{ borderColor: isEditing ? "#0071e3" : "rgba(0,0,0,0.12)" }}
                        aria-label={field.label}
                      />
                    )}
                    <span className="text-[13px] text-neutral-400 w-[20px]">{unit}</span>
                  </div>
                </div>
              );
            })}
            <Link href="/dashboard/selling-rules" className={CROSS_LINK}>
              Open full selling rules + simulator <ArrowRight size={12} />
            </Link>
            <div className="mt-3 text-[13px] text-neutral-500 leading-relaxed">
              Changing a policy creates an auditable configuration event in the backend. All policy changes are logged in the XAI Ledger and enforced deterministically by the Policy Engine — never by the browser.
            </div>
          </Section>

          {/* Payments — read-only rail status */}
          <Section title="Payments" hint="Read from backend /agents/status">
            {statusError ? (
              <PartialBanner message="Backend unreachable while fetching status." />
            ) : (
              <>
                <StatusIndicator label="Payment Rail" state={status?.payment_rail.state} detail={status?.payment_rail.detail} loading={statusLoading} />
                {status?.payment_rail.webhook_last_verified_at && (
                  <div className="mt-2 text-[12px] text-neutral-500">
                    Payment API configured · Webhook configured · Last webhook verified {new Date(status.payment_rail.webhook_last_verified_at).toLocaleString("en-IN", { hour12: false })}
                  </div>
                )}
                <Link href="/dashboard/payments" className={CROSS_LINK}>
                  Open payment records <ArrowRight size={12} />
                </Link>
              </>
            )}
          </Section>

          {/* AI — model configuration + agent states */}
          <Section title="AI" hint="Provider substitutable without touching commerce">
            {statusError ? (
              <PartialBanner message="Backend unreachable while fetching status." />
            ) : (
              <>
                <StatusIndicator label="Seller Agent" state={status?.seller_agent.state} detail={status?.seller_agent.detail} mode={status?.seller_agent.mode} loading={statusLoading} />
                <StatusIndicator label="Buyer Agent" state={status?.buyer_agent.state} detail={status?.buyer_agent.detail} mode={status?.buyer_agent.mode} loading={statusLoading} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3 pt-3 border-t border-black/[0.06]">
                  <div>
                    <div className="text-[13px] text-neutral-500 mb-1">Provider</div>
                    <div className="text-[14px] font-medium text-neutral-900">{providerLabel(status?.llm.provider)}</div>
                  </div>
                  <div>
                    <div className="text-[13px] text-neutral-500 mb-1">Model</div>
                    <div className="text-[14px] font-medium text-neutral-900">{modelLabel(status?.llm.model)}</div>
                  </div>
                  <div>
                    <div className="text-[13px] text-neutral-500 mb-1">Status</div>
                    <div className="flex items-center gap-2">
                      <span className={`size-1.5 rounded-full ${llmState === "connected" ? "bg-green-600" : llmState === "scripted" ? "bg-amber-500" : llmState === "error" ? "bg-red-500" : "bg-neutral-300"}`} />
                      <span className={`text-[13px] font-medium ${llmMeta.color}`}>{llmMeta.text}</span>
                    </div>
                    {status?.llm.reason && (
                      <div className="text-[13px] text-neutral-500 mt-1">Reason: {status.llm.reason}</div>
                    )}
                    {status?.llm.detail && (
                      <div className="text-[12px] text-neutral-400 mt-1">{status.llm.detail}</div>
                    )}
                  </div>
                </div>
                <div className="mt-3 text-[13px] text-neutral-500 leading-relaxed">
                  Provider and model can be substituted without changing Commerce Core, Policy, Payments, Ledger, or the console. Credentials never leave the backend.
                </div>
              </>
            )}
          </Section>

          {/* Security — trust boundaries, read-only */}
          <Section title="Security" hint="Trust boundaries · read-only">
            {statusError ? (
              <PartialBanner message="Backend unreachable while fetching status." />
            ) : (
              <>
                <StatusIndicator label="Agent Gateway" state={status?.agent_gateway.state} detail={status?.agent_gateway.detail} loading={statusLoading} />
                <StatusIndicator label="Policy Engine" state={status?.policy_engine.state} detail={status?.policy_engine.detail} loading={statusLoading} />
                <StatusIndicator label="Ledger" state={status?.ledger.state} detail={status?.ledger.detail} loading={statusLoading} />
                <div className="mt-3 text-[13px] text-neutral-500 leading-relaxed">
                  Transactional endpoints authenticate with agent keys plus HMAC signatures and replay protection. Rotate or revoke keys in Developers at any time.
                </div>
              </>
            )}
          </Section>

          {/* Developer — pointers to the Developers page */}
          <Section title="Developer" hint="Keys · discovery · endpoints">
            <div className="text-[14px] text-neutral-600 leading-relaxed mb-1">
              Agent API keys, webhook verification, discovery surfaces, and transaction endpoints live on the Developers page.
            </div>
            <Link href="/dashboard/developers" className={CROSS_LINK}>
              Open developers <ArrowRight size={12} />
            </Link>
          </Section>
        </>
      )}
    </div>
  );
}
