"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  KeyRound,
  Plus,
  RotateCw,
  Ban,
  ShieldAlert,
} from "lucide-react";
import {
  getAgentManifest,
  apiBaseUrl,
  listAgentKeys,
  createAgentKey,
  rotateAgentKey,
  revokeAgentKey,
  getAgentsStatus,
  type AgentApiKeyView,
  type AgentsStatusResponse,
} from "@/lib/api";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { DataTable } from "@/components/dashboard/data-table";
import {
  Section,
  PartialBanner,
} from "@/components/dashboard/tier-fallbacks";

export default function DevelopersPage() {
  const [copied, setCopied] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<AgentsStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);

  // API keys — primary management surface (full create/rotate/revoke).
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

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setPartialError(null);
    const [m, s] = await Promise.allSettled([getAgentManifest(), getAgentsStatus()]);
    if (m.status === "fulfilled") setManifest(m.value);
    else setManifest(null);
    if (s.status === "fulfilled") setStatus(s.value);
    else setStatus(null);
    if (m.status === "rejected" && s.status === "rejected") {
      setLoadError("Developer resources could not be loaded from the backend.");
    } else if (m.status === "rejected" || s.status === "rejected") {
      setPartialError(
        m.status === "rejected"
          ? "Agent manifest failed to load — discovery and endpoint sections are unavailable."
          : "System status failed to load — gateway and webhook details are unavailable."
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(null), 2000);
  };

  const fullUrl = (path: string) => `${apiBaseUrl()}${path}`;
  const discovery = (manifest?.discovery ?? {}) as Record<string, string>;
  const txEndpoints = (manifest?.transaction_endpoints ?? {}) as Record<string, string>;
  const endpointRows = [
    ...Object.entries(txEndpoints).map(([k, v]) => ({ name: k.replace(/_/g, " "), path: v, kind: "TRANSACTION" })),
    ...Object.entries(discovery).map(([k, v]) => ({ name: k, path: v, kind: "DISCOVERY" })),
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Developers"
        subtitle="AGENT API · WEBHOOKS · KEYS · DISCOVERY · ENDPOINTS"
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
      ) : !manifest && !status ? (
        <EmptyState title="Developer resources unavailable" message="Nothing could be loaded from the backend. Check connectivity and retry." />
      ) : (
        <>
          {/* Agent API */}
          <Section title="AGENT API" hint="EXISTING BACKEND CONTRACTS ONLY">
            <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)] leading-relaxed mb-3">
              External AI buyers authenticate with an agent key (<span className="font-[var(--font-mono)] text-[0.72rem]">X-Agent-Key</span>) on
              discovery and transaction endpoints. Transactional requests use timestamp + nonce + body-bound HMAC signatures with replay protection.
            </div>
            <div className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-3)]">
              Base URL: <span className="text-[var(--bb-white)]">{apiBaseUrl()}</span>
            </div>
          </Section>

          {/* Webhooks */}
          <Section title="WEBHOOKS" hint="FROM LIVE PAYMENT RAIL STATUS">
            {status ? (
              <div className="space-y-2 font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase text-[var(--bb-grey-4)]">Webhook configured</span>
                  <span className={status.payment_rail.webhook_configured ? "text-green-400" : "text-amber-400"}>
                    {status.payment_rail.webhook_configured ? "YES" : "NO"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase text-[var(--bb-grey-4)]">Last verified</span>
                  <span className="text-[var(--bb-white)]">
                    {status.payment_rail.webhook_last_verified_at
                      ? new Date(status.payment_rail.webhook_last_verified_at).toLocaleString("en-IN", { hour12: false })
                      : "—"}
                  </span>
                </div>
                <div className="font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-3)] leading-relaxed pt-1">
                  Settlement is confirmed exclusively by the signed provider webhook — the browser can never mark an order paid itself.
                </div>
              </div>
            ) : (
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">Webhook status unavailable — system status could not be loaded.</div>
            )}
          </Section>

          {/* API keys — primary surface */}
          <Section title="API KEYS" hint="PRIMARY MANAGEMENT SURFACE · PLAINTEXT SHOWN ONCE">
            {keyActionError && (
              <div className="mb-3 px-4 py-2.5 border border-red-400/30 bg-red-400/5">
                <span className="font-[var(--font-mono)] text-[0.6rem] text-red-400">{keyActionError}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)]">Keys are stored hashed server-side.</span>
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
              <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] px-4 py-3 mb-3 space-y-3">
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
                <div className="flex justify-end">
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
              <div className="px-4 py-3 border border-green-400/30 bg-green-400/5 mb-3">
                <div className="flex items-start gap-2 mb-2">
                  <ShieldAlert size={14} className="text-green-400 mt-0.5 shrink-0" />
                  <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.08em] uppercase text-green-400">COPY NOW — SHOWN ONLY THIS ONCE ({freshKey.prefix}…)</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)] bg-[var(--bb-black)] border border-[var(--bb-line)] px-3 py-2 overflow-x-auto whitespace-nowrap">{freshKey.plaintext}</code>
                  <button onClick={() => handleCopy(freshKey.plaintext)} className="inline-flex items-center gap-1 h-[32px] px-3 border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer">
                    {copied === freshKey.plaintext ? <><Check size={10} /> COPIED</> : <><Copy size={10} /> COPY</>}
                  </button>
                </div>
              </div>
            )}

            {keysLoading ? (
              <div className="py-6 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">Loading keys…</div>
            ) : keysError ? (
              <div className="px-4 py-3 border border-amber-400/30 bg-amber-400/5">
                <span className="font-[var(--font-mono)] text-[0.62rem] text-amber-400">{keysError}</span>
              </div>
            ) : keys.length === 0 ? (
              <div className="py-6 text-center">
                <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] mb-1">No agent keys issued yet.</div>
                <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-4)]">Generate a key and hand it to an external AI buyer.</div>
              </div>
            ) : (
              keys.map((k) => (
                <div key={k.key_id} className="py-3 border-b border-[var(--bb-line-soft)] last:border-b-0 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
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
          </Section>

          {/* Agent discovery */}
          <Section title="AGENT DISCOVERY" hint="LIVE MANIFEST">
            {manifest ? (
              <div className="space-y-2">
                {[{ label: "Manifest", path: "/.well-known/agents.json" }, ...Object.entries(discovery).map(([label, path]) => ({ label, path }))].map((row) => {
                  const url = fullUrl(row.path);
                  return (
                    <div key={row.path} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)] break-all">{row.path}</span>
                        <span className="ml-3 font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">{row.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => handleCopy(url)} className="inline-flex items-center gap-1 h-[28px] px-2 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer">
                          {copied === url ? <><Check size={10} /> COPIED</> : <><Copy size={10} /> COPY</>}
                        </button>
                        {!row.path.includes("{") && (
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
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">Discovery surfaces unknown — the live manifest could not be fetched.</div>
            )}
          </Section>

          {/* Endpoints */}
          {manifest && endpointRows.length > 0 && (
            <DataTable>
              <table>
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>Path</th>
                    <th>Kind</th>
                  </tr>
                </thead>
                <tbody>
                  {endpointRows.map((row) => (
                    <tr key={`${row.kind}-${row.path}`}>
                      <td data-label="Endpoint" className="font-[var(--font-mono)] text-[0.65rem]">{row.name}</td>
                      <td data-label="Path" className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)] break-all">{row.path}</td>
                      <td data-label="Kind">
                        <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">{row.kind}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          )}
        </>
      )}
    </div>
  );
}
