"use client";

import { Globe, ExternalLink, Copy, Check, RefreshCw, AlertTriangle } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { getAgentManifest, apiBaseUrl } from "@/lib/api";

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
    </div>
  );
}
