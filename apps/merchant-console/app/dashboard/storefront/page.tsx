"use client";

import { Globe, ExternalLink, Copy, Check, KeyRound, Plus, RotateCw, Ban, ShieldAlert, ChevronDown } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import {
  getAgentManifest,
  apiBaseUrl,
  listAgentKeys,
  createAgentKey,
  rotateAgentKey,
  revokeAgentKey,
  getAgentsStatus,
  getConsoleCatalog,
  getConsoleTransactions,
  getConsoleInsights,
  type AgentApiKeyView,
  type AgentsStatusResponse,
  type Product,
  type ConsoleTransaction,
  type ConsoleGrowthMetrics,
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

interface EndpointRow {
  label: string;
  path: string;
  description: string;
}

const DISCOVERY_DESCRIPTIONS: Record<string, string> = {
  catalog: "Machine-readable product catalog",
  instructions: "LLM-facing store guidance",
};

const SECONDARY_PILL =
  "inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:text-neutral-900 hover:shadow hover:bg-neutral-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]";
const SMALL_PILL =
  "inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white border border-black/10 shadow-sm text-[12px] font-medium text-neutral-600 hover:text-neutral-900 hover:shadow transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]";
const SMALL_DANGER_PILL =
  "inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-red-50/60 border border-red-200/70 shadow-sm text-[12px] font-medium text-red-700 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]";
const PRIMARY_PILL =
  "inline-flex items-center gap-2 h-9 px-5 rounded-full bg-[#0071e3] text-white text-[13px] font-semibold shadow-sm hover:bg-[#0077ed] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]";
const APPLE_INPUT =
  "h-9 rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-3 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow";

function ChannelRow({ name, detail, state }: { name: string; detail: string; state: "ACTIVE" | "AVAILABLE" | "OFFLINE" }) {
  const tone =
    state === "ACTIVE"
      ? "bg-green-50 text-green-700"
      : state === "AVAILABLE"
        ? "bg-neutral-100 text-neutral-600"
        : "bg-red-50 text-red-700";
  const label = state === "ACTIVE" ? "Active" : state === "AVAILABLE" ? "Available" : "Offline";
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-black/[0.06] last:border-b-0">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-neutral-900">{name}</div>
        <div className="text-[13px] text-neutral-500 mt-0.5">{detail}</div>
      </div>
      <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${tone}`}>
        {label}
      </span>
    </div>
  );
}

export default function StorefrontPage() {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<AgentsStatusResponse | null>(null);
  const [catalog, setCatalog] = useState<Product[] | null>(null);
  const [transactions, setTransactions] = useState<ConsoleTransaction[] | null>(null);
  const [insights, setInsights] = useState<ConsoleGrowthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);

  // Agent API keys: external AI buyers authenticate with these; only the
  // hash lives on the backend, so the plaintext is shown exactly once.
  const [keys, setKeys] = useState<AgentApiKeyView[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [keyLabel, setKeyLabel] = useState("");
  const [keyBuyerId, setKeyBuyerId] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<{ plaintext: string; prefix: string } | null>(null);
  const [keyActionError, setKeyActionError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setKeysLoading(true);
    setKeysError(null);
    try {
      setKeys(await listAgentKeys());
    } catch {
      setKeysError("Agent keys could not be loaded from the backend.");
    } finally {
      setKeysLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchKeys(), 0);
    return () => window.clearTimeout(t);
  }, [fetchKeys]);

  const handleCreateKey = async () => {
    if (busyKey === "__create__") return;
    setBusyKey("__create__");
    setKeyActionError(null);
    try {
      const created = await createAgentKey({ label: keyLabel.trim(), buyer_agent_id: keyBuyerId.trim() });
      setFreshKey({ plaintext: created.plaintext, prefix: created.key.key_prefix });
      setCreateOpen(false);
      setKeyLabel("");
      setKeyBuyerId("");
      await fetchKeys();
    } catch {
      setKeyActionError("The backend refused the key creation. Check your role (owner required) and try again.");
    } finally {
      setBusyKey(null);
    }
  };

  const handleRotateKey = async (keyId: string) => {
    if (busyKey) return;
    setBusyKey(keyId);
    setKeyActionError(null);
    try {
      const created = await rotateAgentKey(keyId);
      setFreshKey({ plaintext: created.plaintext, prefix: created.key.key_prefix });
      await fetchKeys();
    } catch {
      setKeyActionError("Rotation failed — the old key is still active. Try again.");
    } finally {
      setBusyKey(null);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (busyKey) return;
    setBusyKey(keyId);
    setKeyActionError(null);
    try {
      await revokeAgentKey(keyId);
      await fetchKeys();
    } catch {
      setKeyActionError("Revocation failed — the key is still active. Try again.");
    } finally {
      setBusyKey(null);
    }
  };

  const handleCopyKey = (plaintext: string) => {
    navigator.clipboard.writeText(plaintext);
    setCopiedPath(plaintext);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setPartialError(null);
    const settled = await Promise.allSettled([
      getAgentManifest(),
      getAgentsStatus(),
      getConsoleCatalog(),
      getConsoleTransactions(),
      getConsoleInsights(),
    ]);
    const [m, s, c, t, i] = settled;
    if (m.status === "fulfilled") setManifest(m.value);
    else {
      // Failure keeps manifest null: banners below must report offline,
      // never claim discoverability without evidence.
      setManifest(null);
    }
    if (s.status === "fulfilled") setStatus(s.value);
    else setStatus(null);
    if (c.status === "fulfilled") setCatalog(c.value);
    else setCatalog(null);
    if (t.status === "fulfilled") setTransactions(t.value);
    else setTransactions(null);
    if (i.status === "fulfilled") setInsights(i.value);
    else setInsights(null);
    const failed = settled.filter((r) => r.status === "rejected").length;
    if (m.status === "rejected" && failed === settled.length) {
      setLoadError("The storefront could not be loaded from the backend.");
    } else if (failed > 0) {
      const missing: string[] = [];
      if (m.status === "rejected") missing.push("agent manifest");
      if (s.status === "rejected") missing.push("system status");
      if (c.status === "rejected") missing.push("product catalog");
      if (t.status === "rejected") missing.push("transactions");
      if (i.status === "rejected") missing.push("sales metrics");
      setPartialError(`Part of the storefront failed to load (${missing.join(", ")}) — sections below show what is available.`);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedPath(url);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const discovery = (manifest?.discovery ?? {}) as Record<string, string>;
  const txEndpoints = (manifest?.transaction_endpoints ?? {}) as Record<string, string>;
  const capabilities = Array.isArray(manifest?.capabilities)
    ? (manifest.capabilities as string[])
    : [];
  const payment = (manifest?.payment ?? {}) as Record<string, string>;

  const endpoints: EndpointRow[] = manifest
    ? [
        {
          label: "Manifest",
          path: "/.well-known/agents.json",
          description: "Agent discovery manifest",
        },
        ...Object.entries(discovery).map(([key, path]) => ({
          label: key,
          path,
          description: DISCOVERY_DESCRIPTIONS[key] ?? "Discovery surface",
        })),
        ...Object.entries(txEndpoints).map(([key, path]) => ({
          label: key.replace(/_/g, " "),
          path,
          description: "Agent-to-agent transaction endpoint",
        })),
      ]
    : [];

  const fullUrl = (path: string) => `${apiBaseUrl()}${path}`;

  // --- Derived commerce sections (existing data only) ---
  const hasHumanChat = (transactions ?? []).some((t) => t.channel === "human_chat");
  const hasAgentOrders = (transactions ?? []).some((t) => t.channel === "agent_to_agent");
  const discoverable = manifest !== null;
  const awaitingConsent = (transactions ?? []).filter((t) => t.status === "AWAITING_CONSENT").length;
  const pendingPayment = (transactions ?? []).filter((t) => t.status === "PAYMENT_PENDING" || t.status === "CONSENTED").length;
  const paidOrders = (transactions ?? []).filter((t) => t.status === "PAID" || t.status === "FULFILLED").length;
  const inStock = (catalog ?? []).filter((p) => p.stock > 0).length;

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="AI Storefront"
        subtitle="Your store's AI sales channel."
        actions={
          <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
        }
      />

      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}
      {partialError && <PartialBanner message={partialError} />}

      {loading ? (
        <TableSkeleton rows={6} />
      ) : !manifest && !status && !catalog && !transactions ? (
        <EmptyState
          title="Storefront unavailable"
          message="Nothing could be loaded from the backend. Check connectivity and retry."
          action={
            <RefreshButton onRefresh={() => void fetchData()} loading={loading} label="Retry" />
          }
        />
      ) : (
        <>
          {/* Store availability */}
          <Section title="Store availability" hint="Live backend state">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <span className={`inline-flex items-center gap-2 text-[14px] font-semibold ${discoverable ? "text-green-700" : "text-[#b25e00]"}`}>
                <Globe size={16} /> {discoverable ? "Discoverable" : "Offline — not verified"}
              </span>
              <span className="text-[14px] text-neutral-600">
                {discoverable
                  ? `Fetched live from ${fullUrl("/.well-known/agents.json")} — this is what autonomous AI buyers read.`
                  : "The agent manifest could not be fetched. Nothing below is claimed live."}
              </span>
            </div>
            {status && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                {[
                  { label: "Seller agent", value: status.seller_agent.state },
                  { label: "Agent gateway", value: status.agent_gateway.state },
                  { label: "Policy engine", value: status.policy_engine.state },
                ].map((r) => (
                  <div key={r.label} className="rounded-[10px] bg-neutral-50 border border-black/[0.06] px-3 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-neutral-500">{r.label}</span>
                    <span className={`text-[13px] font-semibold ${r.value === "CONNECTED" ? "text-green-700" : r.value === "UNCONFIGURED" ? "text-[#b25e00]" : "text-red-700"}`}>
                      {r.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* AI discovery */}
          <Section title="AI discovery" hint="From the live manifest only">
            {manifest ? (
              <div className="space-y-0">
                {endpoints.map((ep, i) => {
                  const url = fullUrl(ep.path);
                  const openable = !ep.path.includes("{");
                  return (
                    <div key={ep.path} className={`py-3 flex items-center justify-between gap-3 ${i < endpoints.length - 1 ? "border-b border-black/[0.06]" : ""}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                          <span className="text-[13px] font-medium text-neutral-900 break-all">{ep.path}</span>
                          <span className="text-[12px] text-neutral-500">{ep.label}</span>
                        </div>
                        <div className="text-[13px] text-neutral-500">{ep.description}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => handleCopy(url)} className={SMALL_PILL}>
                          {copiedPath === url ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                        </button>
                        {openable && (
                          <a href={url} target="_blank" rel="noopener noreferrer" className={SMALL_PILL}>
                            <ExternalLink size={12} /> Open
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[14px] text-neutral-500">
                Discovery links are unavailable because the live manifest could not be fetched.
              </div>
            )}
          </Section>

          {/* Capabilities — live manifest only */}
          <Section title="Capabilities" hint="Live manifest only — nothing claimed without evidence">
            {manifest ? (
              capabilities.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {capabilities.map((cap) => (
                    <span key={cap} className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-[12px] font-medium text-neutral-600">{cap}</span>
                  ))}
                </div>
              ) : (
                <div className="text-[14px] text-neutral-500">The live manifest lists no capabilities.</div>
              )
            ) : (
              <div className="text-[14px] text-neutral-500">Capabilities are unknown — the live manifest could not be fetched.</div>
            )}
            {manifest && (
              <div className="mt-4 pt-4 border-t border-black/[0.06]">
                <div className="text-[12px] font-medium text-neutral-500 mb-1">Merchant</div>
                <div className="text-[17px] font-semibold tracking-[-0.01em] text-neutral-900">{String(manifest.name ?? "—")}</div>
                <div className="text-[12px] text-neutral-400 tabular-nums">{String(manifest.merchant_id ?? "")}</div>
              </div>
            )}
          </Section>

          {/* Commerce pipeline: catalog / quotes / negotiation / checkout / payment */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section title="Product catalog" hint={catalog ? `${catalog.length} products · ${inStock} in stock` : "Unavailable"}>
              {catalog === null ? (
                <div className="text-[14px] text-neutral-500">Catalog could not be loaded.</div>
              ) : catalog.length === 0 ? (
                <div className="text-[14px] text-neutral-500">No products yet — the AI seller only sells what you stock.</div>
              ) : (
                <div className="space-y-2">
                  {catalog.slice(0, 5).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3">
                      <span className="text-[14px] text-neutral-700 truncate" title={p.title}>{p.title}</span>
                      <span className="text-[14px] font-medium text-neutral-900 tabular-nums shrink-0">{formatPaise(p.price_paise)}</span>
                    </div>
                  ))}
                  {catalog.length > 5 && (
                    <div className="text-[12px] text-neutral-400">+ {catalog.length - 5} more in the Catalog page</div>
                  )}
                </div>
              )}
            </Section>

            <Section title="Quotes" hint={transactions ? `${transactions.length} orders on record` : "Unavailable"}>
              {transactions === null ? (
                <div className="text-[14px] text-neutral-500">Order data could not be loaded.</div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Total", value: String(transactions.length) },
                    { label: "Awaiting approval", value: String(awaitingConsent) },
                    { label: "Paid", value: String(paidOrders) },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="text-[12px] font-medium text-neutral-500 mb-1">{s.label}</div>
                      <div className="text-[24px] font-semibold tracking-[-0.01em] text-neutral-900 tabular-nums">{s.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Negotiation" hint="From sales metrics">
              {insights === null ? (
                <div className="text-[14px] text-neutral-500">Negotiation metrics could not be loaded.</div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Negotiations", value: String(insights.negotiations) },
                    { label: "Accepted", value: String(insights.negotiated_accepted) },
                    { label: "Countered", value: String(insights.countered) },
                    { label: "Walked away", value: String(insights.walked_away) },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="text-[12px] font-medium text-neutral-500 mb-1">{s.label}</div>
                      <div className="text-[24px] font-semibold tracking-[-0.01em] text-neutral-900 tabular-nums">{s.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Checkout" hint={transactions ? "Order state" : "Unavailable"}>
              {transactions === null ? (
                <div className="text-[14px] text-neutral-500">Checkout data could not be loaded.</div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[12px] font-medium text-neutral-500 mb-1">Pending payment</div>
                    <div className="text-[24px] font-semibold tracking-[-0.01em] text-neutral-900 tabular-nums">{pendingPayment}</div>
                  </div>
                  <div>
                    <div className="text-[12px] font-medium text-neutral-500 mb-1">Settled</div>
                    <div className="text-[24px] font-semibold tracking-[-0.01em] text-green-700 tabular-nums">{paidOrders}</div>
                  </div>
                </div>
              )}
            </Section>
          </div>

          <Section title="Payment" hint="Live status + order evidence">
            <div className="text-[13px] text-neutral-600">
              {status
                ? `Provider ${status.payment_rail.provider} · ${status.payment_rail.mode} · ${status.payment_rail.configured ? "Configured" : "Not configured"} · webhook ${status.payment_rail.webhook_configured ? "configured" : "not configured"}`
                : "Payment rail status could not be loaded."}
            </div>
            {payment.provider && (
              <div className="mt-2 text-[12px] text-neutral-500">
                Manifest settlement: {String(payment.provider)} {String(payment.mode ?? "")} · authority {String(payment.settlement_authority ?? "")}
              </div>
            )}
          </Section>

          {/* Sales channels */}
          <Section title="Sales channels" hint="Derived from live status + order history">
            <ChannelRow
              name="Human Chat"
              detail="Merchant-assisted checkout in the AI Sales inbox"
              state={!status && !transactions ? "OFFLINE" : hasHumanChat ? "ACTIVE" : "AVAILABLE"}
            />
            <ChannelRow
              name="AI Buyers"
              detail="Autonomous agent-to-agent purchases via the agent API"
              state={!status && !transactions ? "OFFLINE" : hasAgentOrders ? "ACTIVE" : "AVAILABLE"}
            />
            <ChannelRow
              name="AI Storefront"
              detail="Public agent discovery from the live manifest"
              state={discoverable ? "ACTIVE" : "OFFLINE"}
            />
          </Section>

          {/* API keys — secondary developer section, collapsed by default */}
          <details className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] overflow-hidden group">
            <summary className="px-6 py-4 flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-2.5 min-w-0">
                <KeyRound size={14} className="text-neutral-400 shrink-0" />
                <span className="text-[14px] font-semibold text-neutral-900">Agent API keys</span>
                <span className="text-[12px] text-neutral-400 hidden sm:inline truncate">Credentials for external AI buyers</span>
              </div>
              <ChevronDown size={14} className="text-neutral-400 group-open:rotate-180 transition-transform shrink-0" />
            </summary>

            {keyActionError && (
              <div className="px-6 pt-4">
                <ErrorBanner message={keyActionError} />
              </div>
            )}

            <div className="px-6 py-4 border-t border-black/[0.06] flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-neutral-400">The key is stored hashed — plaintext is shown once at creation.</span>
              <div className="flex items-center gap-2">
                <RefreshButton onRefresh={() => void fetchKeys()} loading={keysLoading} />
                {createOpen ? (
                  <button onClick={() => setCreateOpen((v) => !v)} className={SECONDARY_PILL}>
                    <Ban size={13} /> Cancel
                  </button>
                ) : (
                  <button onClick={() => setCreateOpen((v) => !v)} className={PRIMARY_PILL}>
                    <Plus size={13} /> Generate key
                  </button>
                )}
              </div>
            </div>

            {createOpen && (
              <div className="px-6 py-5 border-t border-black/[0.06] bg-neutral-50/60 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] text-neutral-500">Label (optional)</span>
                    <input
                      value={keyLabel}
                      onChange={(e) => setKeyLabel(e.target.value)}
                      placeholder="perplexity shopping agent"
                      className={`${APPLE_INPUT} w-full`}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] text-neutral-500">Buyer agent ID (optional)</span>
                    <input
                      value={keyBuyerId}
                      onChange={(e) => setKeyBuyerId(e.target.value.toLowerCase())}
                      placeholder="perplexity_buyer_01"
                      className={`${APPLE_INPUT} w-full tabular-nums`}
                    />
                  </label>
                </div>
                <div className="flex items-center justify-end">
                  <button
                    onClick={() => void handleCreateKey()}
                    disabled={busyKey === "__create__"}
                    className={PRIMARY_PILL}
                  >
                    <KeyRound size={13} /> {busyKey === "__create__" ? "Generating…" : "Generate"}
                  </button>
                </div>
              </div>
            )}

            {freshKey && (
              <div className="px-6 py-5 border-t border-black/[0.06] bg-green-50/60">
                <div className="flex items-start gap-2 mb-2">
                  <ShieldAlert size={14} className="text-green-700 mt-0.5 shrink-0" />
                  <span className="text-[13px] font-medium text-green-800">Copy now — shown only this once ({freshKey.prefix}…)</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-[10px] bg-neutral-50 border border-black/[0.06] text-neutral-800 text-[13px] px-3 py-2 overflow-x-auto whitespace-nowrap tabular-nums">{freshKey.plaintext}</code>
                  <button onClick={() => handleCopyKey(freshKey.plaintext)} className={SMALL_PILL}>
                    {copiedPath === freshKey.plaintext ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                  </button>
                </div>
              </div>
            )}

            {keysLoading ? (
              <div className="px-6 py-8 text-center text-[13px] text-neutral-400">Loading keys…</div>
            ) : keysError ? (
              <div className="px-6 py-4 border-t border-black/[0.06]">
                <PartialBanner message={keysError} />
              </div>
            ) : keys.length === 0 ? (
              <div className="px-6 py-8 text-center border-t border-black/[0.06]">
                <div className="text-[15px] font-semibold text-neutral-900 mb-1">No agent keys issued yet</div>
                <div className="text-[14px] text-neutral-500">
                  Generate a key and hand it to an external AI buyer so it can call your agent API.
                </div>
              </div>
            ) : (
              keys.map((k) => (
                <div key={k.key_id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between border-t border-black/[0.06]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="text-[13px] font-semibold text-neutral-900 tabular-nums">{k.key_prefix}…</span>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${k.revoked_at ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                        {k.revoked_at ? "Revoked" : "Active"}
                      </span>
                      {k.label && <span className="text-[13px] text-neutral-600 truncate">{k.label}</span>}
                    </div>
                    <div className="text-[12px] text-neutral-400">
                      {k.buyer_agent_id ? `buyer: ${k.buyer_agent_id} · ` : ""}created {new Date(k.created_at).toLocaleString()}
                      {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleString()}` : " · never used"}
                    </div>
                  </div>
                  {!k.revoked_at && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => void handleRotateKey(k.key_id)} disabled={busyKey !== null} className={SMALL_PILL}>
                        <RotateCw size={12} /> {busyKey === k.key_id ? "Working…" : "Rotate"}
                      </button>
                      <button onClick={() => void handleRevokeKey(k.key_id)} disabled={busyKey !== null} className={SMALL_DANGER_PILL}>
                        <Ban size={12} /> Revoke
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </details>
        </>
      )}
    </div>
  );
}
