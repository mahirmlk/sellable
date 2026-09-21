"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Copy,
  Check,
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
import { RefreshButton } from "@/components/dashboard/commerce-ui";
import {
  Section,
  PartialBanner,
} from "@/components/dashboard/tier-fallbacks";

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
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="Developers"
        subtitle="API, webhooks, keys and discovery"
        actions={
          <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
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
          <Section title="Agent API" hint="Existing backend contracts only">
            <div className="text-[14px] text-neutral-600 leading-relaxed mb-3">
              External AI buyers authenticate with an agent key (<code className="rounded-[6px] bg-neutral-100 border border-black/[0.06] px-1.5 py-0.5 text-[12px] text-neutral-700">X-Agent-Key</code>) on
              discovery and transaction endpoints. Transactional requests use timestamp + nonce + body-bound HMAC signatures with replay protection.
            </div>
            <div className="text-[13px] text-neutral-500">
              Base URL: <span className="font-medium text-neutral-900">{apiBaseUrl()}</span>
            </div>
          </Section>

          {/* Webhooks */}
          <Section title="Webhooks" hint="From live payment rail status">
            {status ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-neutral-500">Webhook configured</span>
                  <span className={`text-[13px] font-semibold ${status.payment_rail.webhook_configured ? "text-green-700" : "text-[#b25e00]"}`}>
                    {status.payment_rail.webhook_configured ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-neutral-500">Last verified</span>
                  <span className="text-[13px] font-medium text-neutral-900 tabular-nums">
                    {status.payment_rail.webhook_last_verified_at
                      ? new Date(status.payment_rail.webhook_last_verified_at).toLocaleString("en-IN", { hour12: false })
                      : "—"}
                  </span>
                </div>
                <div className="text-[13px] text-neutral-500 leading-relaxed pt-1">
                  Settlement is confirmed exclusively by the signed provider webhook — the browser can never mark an order paid itself.
                </div>
              </div>
            ) : (
              <div className="text-[14px] text-neutral-500">Webhook status unavailable — system status could not be loaded.</div>
            )}
          </Section>

          {/* API keys — primary surface */}
          <Section title="API keys" hint="Primary management surface · plaintext shown once">
            {keyActionError && (
              <div className="mb-4">
                <ErrorBanner message={keyActionError} />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <span className="text-[12px] text-neutral-400">Keys are stored hashed server-side.</span>
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
              <div className="rounded-2xl bg-neutral-50/70 border border-black/[0.06] px-4 py-4 mb-4 space-y-4">
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
                <div className="flex justify-end">
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
              <div className="rounded-2xl bg-green-50/60 border border-green-200/60 px-4 py-4 mb-4">
                <div className="flex items-start gap-2 mb-2">
                  <ShieldAlert size={14} className="text-green-700 mt-0.5 shrink-0" />
                  <span className="text-[13px] font-medium text-green-800">Copy now — shown only this once ({freshKey.prefix}…)</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-[10px] bg-neutral-50 border border-black/[0.06] text-neutral-800 text-[13px] px-3 py-2 overflow-x-auto whitespace-nowrap tabular-nums">{freshKey.plaintext}</code>
                  <button onClick={() => handleCopy(freshKey.plaintext)} className={SMALL_PILL}>
                    {copied === freshKey.plaintext ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                  </button>
                </div>
              </div>
            )}

            {keysLoading ? (
              <div className="py-6 text-center text-[13px] text-neutral-400">Loading keys…</div>
            ) : keysError ? (
              <PartialBanner message={keysError} />
            ) : keys.length === 0 ? (
              <div className="py-6 text-center">
                <div className="text-[15px] font-semibold text-neutral-900 mb-1">No agent keys issued yet</div>
                <div className="text-[14px] text-neutral-500">Generate a key and hand it to an external AI buyer.</div>
              </div>
            ) : (
              keys.map((k) => (
                <div key={k.key_id} className="py-4 border-b border-black/[0.06] last:border-b-0 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
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
          </Section>

          {/* Agent discovery */}
          <Section title="Agent discovery" hint="Live manifest">
            {manifest ? (
              <div className="space-y-2">
                {[{ label: "Manifest", path: "/.well-known/agents.json" }, ...Object.entries(discovery).map(([label, path]) => ({ label, path }))].map((row) => {
                  const url = fullUrl(row.path);
                  return (
                    <div key={row.path} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[13px] font-medium text-neutral-900 break-all">{row.path}</span>
                        <span className="ml-3 text-[12px] text-neutral-500">{row.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => handleCopy(url)} className={SMALL_PILL}>
                          {copied === url ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                        </button>
                        {!row.path.includes("{") && (
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
              <div className="text-[14px] text-neutral-500">Discovery surfaces unknown — the live manifest could not be fetched.</div>
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
                      <td data-label="Endpoint" className="text-[13px] font-medium text-neutral-900">{row.name}</td>
                      <td data-label="Path" className="text-[13px] text-neutral-600 break-all tabular-nums">{row.path}</td>
                      <td data-label="Kind">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${row.kind === "TRANSACTION" ? "bg-blue-50 text-blue-700" : "bg-neutral-100 text-neutral-600"}`}>
                          {row.kind === "TRANSACTION" ? "Transaction" : "Discovery"}
                        </span>
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
