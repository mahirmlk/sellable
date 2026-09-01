"use client";

import { Globe, ExternalLink, Copy, Check, RefreshCw } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { getAgentManifest } from "@/lib/api";

interface ManifestData {
  merchantName: string;
  status: string;
  endpoints: Array<{ label: string; path: string; description: string }>;
  capabilities: string[];
  authentication: string;
}

const defaultEndpoints = [
  { label: "Manifest", path: "/.well-known/agents.json", description: "Agent discovery manifest" },
  { label: "AI Catalog", path: "/catalog.ai.json", description: "Machine-readable product catalog" },
  { label: "LLM Guidance", path: "/llms.txt", description: "LLM-facing store guidance" },
  { label: "Transactional API", path: "/agent/*", description: "Agent-to-agent transaction endpoints" },
];

export default function StorefrontPage() {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ManifestData>({
    merchantName: "SELLABLE Demo Store",
    status: "discoverable",
    endpoints: defaultEndpoints,
    capabilities: [],
    authentication: "HMAC request signing",
  });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAgentManifest();
      const m = data as Record<string, unknown>;
      setManifest({
        merchantName: (m.name as string) || "SELLABLE Demo Store",
        status: "discoverable",
        endpoints: defaultEndpoints,
        capabilities: Array.isArray(m.capabilities) ? m.capabilities as string[] : [],
        authentication: "HMAC request signing",
      });
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const handleCopy = (path: string) => {
    navigator.clipboard.writeText(`https://api.sellable.shop${path}`);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">AI Storefront</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">YOUR STORE IS DISCOVERABLE BY AI BUYERS</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
        </button>
      </div>

      <div className="border border-green-400/30 bg-green-400/5 p-5">
        <div className="flex items-center gap-3">
          <Globe size={20} className="text-green-400" />
          <div>
            <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-green-400">DISCOVERABLE</div>
            <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)]">Your agent manifest is live and accessible to autonomous AI buyers.</div>
          </div>
        </div>
      </div>

      <div className="border border-[var(--bb-line)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
          <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">ENDPOINTS</div>
        </div>
        {manifest.endpoints.map((ep, i) => (
          <div key={ep.path} className={`px-5 py-4 flex items-center justify-between hover:bg-[var(--bb-panel)] transition-colors ${i < manifest.endpoints.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">{ep.path}</span>
                <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">{ep.label}</span>
              </div>
              <div className="font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-3)]">{ep.description}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => handleCopy(ep.path)} className="inline-flex items-center gap-1 h-[28px] px-2 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer">
                {copiedPath === ep.path ? <><Check size={10} /> COPIED</> : <><Copy size={10} /> COPY</>}
              </button>
              <a href={ep.path} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 h-[28px] px-2 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all">
                <ExternalLink size={10} /> OPEN
              </a>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-[var(--bb-line)] p-5">
          <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-4">MERCHANT</div>
          <div className="font-[var(--font-sans)] text-[1.1rem] text-[var(--bb-white)] mb-4">{manifest.merchantName}</div>
          <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-2">CAPABILITIES</div>
          <div className="flex flex-wrap gap-2">
            {manifest.capabilities.map((cap) => (
              <span key={cap} className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] px-2 py-1 border border-[var(--bb-grey-4)] text-[var(--bb-grey-2)]">{cap}</span>
            ))}
          </div>
        </div>

        <div className="border border-[var(--bb-line)] p-5">
          <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-4">AUTHENTICATION</div>
          <div className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)] mb-4">{manifest.authentication}</div>
          <div className="border-t border-[var(--bb-line)] pt-4">
            <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-2">SAMPLE MANIFEST</div>
            <pre className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)] bg-[var(--bb-panel)] p-3 border border-[var(--bb-line)] overflow-x-auto">
{`{
  "merchant": "${manifest.merchantName}",
  "status": "discoverable",
  "endpoints": {
    "catalog": "/catalog.ai.json",
    "llms": "/llms.txt",
    "api": "/agent/*"
  },
  "auth": "hmac"
}`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
