"use client";

import { Globe, ExternalLink, Copy, Check, RefreshCw, AlertTriangle, KeyRound, Plus, RotateCw, Ban, ShieldAlert } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { getAgentManifest, apiBaseUrl, listAgentKeys, createAgentKey, rotateAgentKey, revokeAgentKey, type AgentApiKeyView } from "@/lib/api";

interface EndpointRow {
  label: string;
  path: string;
  description: string;
}

const DISCOVERY_DESCRIPTIONS: Record<string, string> = {
  catalog: "Machine-readable product catalog",
  instructions: "LLM-facing store guidance",
};

export default function StorefrontPage() {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    try {
      setManifest(await getAgentManifest());
    } catch {
      // Failure keeps manifest null: the banner below must report offline,
      // never claim discoverability without evidence.
      setManifest(null);
      setLoadError("The agent manifest could not be fetched from the backend.");
    } finally {
      setLoading(false);
    }
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">AI Storefront</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">HOW AI BUYERS SEE YOUR STORE</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
        </button>
      </div>

      {loading ? (
        <div className="border border-[var(--bb-line)] p-5">
          <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">Checking the live manifest…</div>
        </div>
      ) : manifest ? (
        <div className="border border-green-400/30 bg-green-400/5 p-5">
          <div className="flex items-center gap-3">
            <Globe size={20} className="text-green-400" />
            <div>
              <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-green-400">DISCOVERABLE</div>
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)]">Fetched live from {fullUrl("/.well-known/agents.json")} — this is what autonomous AI buyers read.</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-amber-400/30 bg-amber-400/5 p-5">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-amber-400" />
            <div>
              <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-amber-400">OFFLINE — NOT VERIFIED</div>
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)]">{loadError} Nothing below is claimed live.</div>
            </div>
          </div>
        </div>
      )}

      {manifest && (
        <>
          <div className="border border-[var(--bb-line)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
              <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">ENDPOINTS — FROM THE LIVE MANIFEST</div>
            </div>
            {endpoints.map((ep, i) => {
              const url = fullUrl(ep.path);
              const openable = !ep.path.includes("{");
              return (
                <div key={ep.path} className={`px-5 py-4 flex items-center justify-between hover:bg-[var(--bb-panel)] transition-colors ${i < endpoints.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">{ep.path}</span>
                      <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">{ep.label}</span>
                    </div>
                    <div className="font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-3)]">{ep.description}</div>
                  </div>
                  <div className="flex items-center gap-2">
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-[var(--bb-line)] p-5">
              <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-4">MERCHANT</div>
              <div className="font-[var(--font-sans)] text-[1.1rem] text-[var(--bb-white)] mb-1">{String(manifest.name ?? "—")}</div>
              <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] mb-4">{String(manifest.merchant_id ?? "")}</div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-2">CAPABILITIES</div>
              <div className="flex flex-wrap gap-2">
                {capabilities.map((cap) => (
                  <span key={cap} className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] px-2 py-1 border border-[var(--bb-grey-4)] text-[var(--bb-grey-2)]">{cap}</span>
                ))}
              </div>
              {payment.provider && (
                <div className="mt-4 pt-4 border-t border-[var(--bb-line-soft)] font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-3)]">
                  Settlement: {String(payment.provider)} {String(payment.mode ?? "")} · authority {String(payment.settlement_authority ?? "")}
                </div>
              )}
            </div>

            <div className="border border-[var(--bb-line)] p-5">
              <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-4">AUTHENTICATION</div>
              <div className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)] mb-1">Public discovery · API key or HMAC-signed requests for transactions</div>
              <div className="font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-3)] leading-relaxed mb-4">
                Discovery surfaces are public. Transactional endpoints authenticate with an agent key, with timestamp + nonce + body-bound HMAC signatures and replay protection on signed requests.
              </div>
              <div className="border-t border-[var(--bb-line)] pt-4">
                <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-2">LIVE MANIFEST (ABRIDGED)</div>
                <pre className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)] bg-[var(--bb-panel)] p-3 border border-[var(--bb-line)] overflow-x-auto">
                  {JSON.stringify(
                    {
                      merchant_id: manifest.merchant_id,
                      protocol_version: manifest.protocol_version,
                      capabilities,
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Agent API keys — how an external AI buyer authenticates here. */}
      <div className="border border-[var(--bb-line)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound size={13} className="text-[var(--bb-grey-3)]" />
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">AGENT API KEYS</div>
            <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] hidden sm:inline">CREDENTIALS FOR EXTERNAL AI BUYERS · PLAINTEXT IS SHOWN ONCE</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchKeys} disabled={keysLoading} className="inline-flex items-center gap-1 h-[28px] px-2 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
              <RefreshCw size={10} className={keysLoading ? "animate-spin" : ""} /> REFRESH
            </button>
            <button onClick={() => setCreateOpen((v) => !v)} className="inline-flex items-center gap-1 h-[28px] px-2 border border-[var(--bb-orange)]/40 bg-[var(--bb-orange)]/10 font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:bg-[var(--bb-orange)]/20 transition-all cursor-pointer">
              {createOpen ? <Ban size={10} /> : <Plus size={10} />} {createOpen ? "CANCEL" : "GENERATE KEY"}
            </button>
          </div>
        </div>

        {keyActionError && (
          <div className="px-5 py-3 border-b border-red-400/30 bg-red-400/5">
            <span className="font-[var(--font-mono)] text-[0.6rem] text-red-400">{keyActionError}</span>
          </div>
        )}

        {createOpen && (
          <div className="px-5 py-4 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] space-y-3">
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
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] leading-relaxed">The key is stored hashed — the plaintext is shown once at creation.</span>
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
          <div className="px-5 py-4 border-b border-green-400/30 bg-green-400/5">
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
            <div className="mt-2 font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] leading-relaxed">
              The buyer sends <span className="text-[var(--bb-grey-2)]">X-Agent-Key: …</span> on discovery and transaction endpoints. Rotate or revoke below at any time.
            </div>
          </div>
        )}

        {keysLoading ? (
          <div className="px-5 py-8 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">Loading keys…</div>
        ) : keysError ? (
          <div className="px-5 py-4 border-b border-amber-400/30 bg-amber-400/5">
            <span className="font-[var(--font-mono)] text-[0.62rem] text-amber-400">{keysError}</span>
          </div>
        ) : keys.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] mb-1">No agent keys issued yet.</div>
            <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-4)]">
              Generate a key and hand it to an external AI buyer so it can call your agent API — not just the built-in reference buyer.
            </div>
          </div>
        ) : (
          keys.map((k, i) => (
            <div key={k.key_id} className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between hover:bg-[var(--bb-panel)] transition-colors ${i < keys.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
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
      </div>
    </div>
  );
}
