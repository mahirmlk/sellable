"use client";

import { Globe, ExternalLink, Copy, Check, RefreshCw, KeyRound, Plus, RotateCw, Ban, ShieldAlert, ChevronDown } from "lucide-react";
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

function ChannelRow({ name, detail, state }: { name: string; detail: string; state: "ACTIVE" | "AVAILABLE" | "OFFLINE" }) {
  const tone =
    state === "ACTIVE"
      ? "border-green-400/40 text-green-400"
      : state === "AVAILABLE"
        ? "border-[var(--bb-grey-4)] text-[var(--bb-grey-2)]"
        : "border-red-400/40 text-red-400";
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-[var(--bb-line-soft)] last:border-b-0">
      <div className="min-w-0">
        <div className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)]">{name}</div>
        <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] mt-0.5">{detail}</div>
      </div>
      <span className={`shrink-0 font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase px-2 py-0.5 border ${tone}`}>
        {state}
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
    <div className="p-6 space-y-6">
      <PageHeader
        title="AI Storefront"
        subtitle="Your store's AI sales channel."
        actions={
          <button onClick={() => void fetchData()} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
          </button>
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
            <button onClick={() => void fetchData()} className="inline-flex items-center gap-2 h-[32px] px-4 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] transition-all cursor-pointer">
              <RefreshCw size={12} /> RETRY
            </button>
          }
        />
      ) : (
        <>
          {/* Store availability */}
          <Section title="STORE AVAILABILITY" hint="LIVE BACKEND STATE">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <span className={`inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase ${discoverable ? "text-green-400" : "text-amber-400"}`}>
                <Globe size={16} /> {discoverable ? "DISCOVERABLE" : "OFFLINE — NOT VERIFIED"}
              </span>
              <span className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)]">
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
                  <div key={r.label} className="border border-[var(--bb-line-soft)] bg-[var(--bb-black)] px-3 py-2.5 flex items-center justify-between gap-2">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-3)]">{r.label}</span>
                    <span className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.08em] ${r.value === "CONNECTED" ? "text-green-400" : r.value === "UNCONFIGURED" ? "text-yellow-400" : "text-red-400"}`}>
                      {r.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* AI discovery */}
          <Section title="AI DISCOVERY" hint="FROM THE LIVE MANIFEST ONLY">
            {manifest ? (
              <div className="space-y-0">
                {endpoints.map((ep, i) => {
                  const url = fullUrl(ep.path);
                  const openable = !ep.path.includes("{");
                  return (
                    <div key={ep.path} className={`py-3 flex items-center justify-between gap-3 ${i < endpoints.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                          <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)] break-all">{ep.path}</span>
                          <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">{ep.label}</span>
                        </div>
                        <div className="font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-3)]">{ep.description}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => handleCopy(url)} className="inline-flex items-center gap-1 h-[28px] px-2 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer">
                          {copiedPath === url ? <><Check size={10} /> COPIED</> : <><Copy size={10} /> COPY</>}
                        </button>
                        {openable && (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 h-[28px] px-2 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all">
                            <ExternalLink size={10} /> OPEN
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">
                Discovery links are unavailable because the live manifest could not be fetched.
              </div>
            )}
          </Section>

          {/* Capabilities — live manifest only */}
          <Section title="CAPABILITIES" hint="LIVE MANIFEST ONLY — NOTHING CLAIMED WITHOUT EVIDENCE">
            {manifest ? (
              capabilities.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {capabilities.map((cap) => (
                    <span key={cap} className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] px-2 py-1 border border-[var(--bb-grey-4)] text-[var(--bb-grey-2)]">{cap}</span>
                  ))}
                </div>
              ) : (
                <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">The live manifest lists no capabilities.</div>
              )
            ) : (
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">Capabilities are unknown — the live manifest could not be fetched.</div>
            )}
            {manifest && (
              <div className="mt-4 pt-4 border-t border-[var(--bb-line-soft)]">
                <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">MERCHANT</div>
                <div className="font-[var(--font-sans)] text-[1rem] text-[var(--bb-white)]">{String(manifest.name ?? "—")}</div>
                <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">{String(manifest.merchant_id ?? "")}</div>
              </div>
            )}
          </Section>

          {/* Commerce pipeline: catalog / quotes / negotiation / checkout / payment */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section title="PRODUCT CATALOG" hint={catalog ? `${catalog.length} PRODUCTS · ${inStock} IN STOCK` : "UNAVAILABLE"}>
              {catalog === null ? (
                <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">Catalog could not be loaded.</div>
              ) : catalog.length === 0 ? (
                <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">No products yet — the AI seller only sells what you stock.</div>
              ) : (
                <div className="space-y-2">
                  {catalog.slice(0, 5).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3">
                      <span className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-1)] truncate" title={p.title}>{p.title}</span>
                      <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)] tabular-nums shrink-0">{formatPaise(p.price_paise)}</span>
                    </div>
                  ))}
                  {catalog.length > 5 && (
                    <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">+ {catalog.length - 5} more in the Catalog page</div>
                  )}
                </div>
              )}
            </Section>

            <Section title="QUOTES" hint={transactions ? `${transactions.length} ORDERS ON RECORD` : "UNAVAILABLE"}>
              {transactions === null ? (
                <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">Order data could not be loaded.</div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Total", value: String(transactions.length) },
                    { label: "Awaiting approval", value: String(awaitingConsent) },
                    { label: "Paid", value: String(paidOrders) },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">{s.label}</div>
                      <div className="font-[var(--font-sans)] text-[1.3rem] text-[var(--bb-white)]">{s.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="NEGOTIATION" hint="FROM SALES METRICS">
              {insights === null ? (
                <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">Negotiation metrics could not be loaded.</div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Negotiations", value: String(insights.negotiations) },
                    { label: "Accepted", value: String(insights.negotiated_accepted) },
                    { label: "Countered", value: String(insights.countered) },
                    { label: "Walked away", value: String(insights.walked_away) },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">{s.label}</div>
                      <div className="font-[var(--font-sans)] text-[1.3rem] text-[var(--bb-white)]">{s.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="CHECKOUT" hint={transactions ? "ORDER STATE" : "UNAVAILABLE"}>
              {transactions === null ? (
                <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">Checkout data could not be loaded.</div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Pending payment</div>
                    <div className="font-[var(--font-sans)] text-[1.3rem] text-[var(--bb-white)]">{pendingPayment}</div>
                  </div>
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Settled</div>
                    <div className="font-[var(--font-sans)] text-[1.3rem] text-green-400">{paidOrders}</div>
                  </div>
                </div>
              )}
            </Section>
          </div>

          <Section title="PAYMENT" hint="LIVE STATUS + ORDER EVIDENCE">
            <div className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">
              {status
                ? `Provider ${status.payment_rail.provider} · ${status.payment_rail.mode} · ${status.payment_rail.configured ? "CONFIGURED" : "NOT CONFIGURED"} · webhook ${status.payment_rail.webhook_configured ? "CONFIGURED" : "NOT CONFIGURED"}`
                : "Payment rail status could not be loaded."}
            </div>
            {payment.provider && (
              <div className="mt-2 font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-3)]">
                Manifest settlement: {String(payment.provider)} {String(payment.mode ?? "")} · authority {String(payment.settlement_authority ?? "")}
              </div>
            )}
          </Section>

          {/* Sales channels */}
          <Section title="SALES CHANNELS" hint="DERIVED FROM LIVE STATUS + ORDER HISTORY">
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
          <details className="border border-[var(--bb-line)] overflow-hidden group">
            <summary className="px-5 py-3 bg-[var(--bb-panel)] flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-2">
                <KeyRound size={13} className="text-[var(--bb-grey-3)]" />
                <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">DEVELOPER — AGENT API KEYS</span>
                <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] hidden sm:inline">CREDENTIALS FOR EXTERNAL AI BUYERS · SECONDARY — PRIMARY LIVES IN DEVELOPERS</span>
              </div>
              <ChevronDown size={14} className="text-[var(--bb-grey-3)] group-open:rotate-180 transition-transform" />
            </summary>

            {keyActionError && (
              <div className="px-5 py-3 border-t border-red-400/30 bg-red-400/5">
                <span className="font-[var(--font-mono)] text-[0.6rem] text-red-400">{keyActionError}</span>
              </div>
            )}

            <div className="px-5 py-3 border-t border-[var(--bb-line-soft)] flex items-center justify-between gap-2">
              <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)]">The key is stored hashed — plaintext is shown once at creation.</span>
              <div className="flex items-center gap-2">
                <button onClick={() => void fetchKeys()} disabled={keysLoading} className="inline-flex items-center gap-1 h-[28px] px-2 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
                  <RefreshCw size={10} className={keysLoading ? "animate-spin" : ""} /> REFRESH
                </button>
                <button onClick={() => setCreateOpen((v) => !v)} className="inline-flex items-center gap-1 h-[28px] px-2 border border-[var(--bb-orange)]/40 bg-[var(--bb-orange)]/10 font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:bg-[var(--bb-orange)]/20 transition-all cursor-pointer">
                  {createOpen ? <Ban size={10} /> : <Plus size={10} />} {createOpen ? "CANCEL" : "GENERATE KEY"}
                </button>
              </div>
            </div>

            {createOpen && (
              <div className="px-5 py-4 border-t border-[var(--bb-line)] bg-[var(--bb-panel)] space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">LABEL (OPTIONAL)</span>
                    <input
                      value={keyLabel}
                      onChange={(e) => setKeyLabel(e.target.value)}
                      placeholder="perplexity shopping agent"
                      className="font-[var(--font-sans)] text-[0.75rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">BUYER AGENT ID (OPTIONAL)</span>
                    <input
                      value={keyBuyerId}
                      onChange={(e) => setKeyBuyerId(e.target.value.toLowerCase())}
                      placeholder="perplexity_buyer_01"
                      className="font-[var(--font-mono)] text-[0.72rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)]"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-end">
                  <button
                    onClick={() => void handleCreateKey()}
                    disabled={busyKey === "__create__"}
                    className="inline-flex items-center gap-2 h-[32px] px-4 bg-[var(--bb-orange)] text-[var(--bb-black)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase hover:bg-[var(--bb-orange-bright)] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <KeyRound size={11} /> {busyKey === "__create__" ? "GENERATING…" : "GENERATE"}
                  </button>
                </div>
              </div>
            )}

            {freshKey && (
              <div className="px-5 py-4 border-t border-green-400/30 bg-green-400/5">
                <div className="flex items-start gap-2 mb-2">
                  <ShieldAlert size={14} className="text-green-400 mt-0.5 shrink-0" />
                  <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.08em] uppercase text-green-400">COPY NOW — SHOWN ONLY THIS ONCE ({freshKey.prefix}…)</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)] bg-[var(--bb-black)] border border-[var(--bb-line)] px-3 py-2 overflow-x-auto whitespace-nowrap">{freshKey.plaintext}</code>
                  <button onClick={() => handleCopyKey(freshKey.plaintext)} className="inline-flex items-center gap-1 h-[32px] px-3 border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer">
                    {copiedPath === freshKey.plaintext ? <><Check size={10} /> COPIED</> : <><Copy size={10} /> COPY</>}
                  </button>
                </div>
              </div>
            )}

            {keysLoading ? (
              <div className="px-5 py-8 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">Loading keys…</div>
            ) : keysError ? (
              <div className="px-5 py-4 border-t border-amber-400/30 bg-amber-400/5">
                <span className="font-[var(--font-mono)] text-[0.62rem] text-amber-400">{keysError}</span>
              </div>
            ) : keys.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] mb-1">No agent keys issued yet.</div>
                <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-4)]">
                  Generate a key and hand it to an external AI buyer so it can call your agent API.
                </div>
              </div>
            ) : (
              keys.map((k, i) => (
                <div key={k.key_id} className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between border-t border-[var(--bb-line-soft)] ${i === 0 ? "" : ""}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">{k.key_prefix}…</span>
                      <span className={`font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase px-1.5 py-0.5 border ${k.revoked_at ? "border-red-400/40 text-red-400" : "border-green-400/40 text-green-400"}`}>
                        {k.revoked_at ? "REVOKED" : "ACTIVE"}
                      </span>
                      {k.label && <span className="font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-2)] truncate">{k.label}</span>}
                    </div>
                    <div className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)]">
                      {k.buyer_agent_id ? `buyer: ${k.buyer_agent_id} · ` : ""}created {new Date(k.created_at).toLocaleString()}
                      {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleString()}` : " · never used"}
                    </div>
                  </div>
                  {!k.revoked_at && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => void handleRotateKey(k.key_id)} disabled={busyKey !== null} className="inline-flex items-center gap-1 h-[28px] px-2 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
                        <RotateCw size={10} /> {busyKey === k.key_id ? "WORKING…" : "ROTATE"}
                      </button>
                      <button onClick={() => void handleRevokeKey(k.key_id)} disabled={busyKey !== null} className="inline-flex items-center gap-1 h-[28px] px-2 border border-red-400/30 bg-red-400/5 font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-red-400 hover:bg-red-400/10 transition-all cursor-pointer disabled:opacity-50">
                        <Ban size={10} /> REVOKE
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
