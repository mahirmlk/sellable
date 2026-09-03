"use client";

import { useEffect, useRef, useState } from "react";
import { Eyebrow } from "./ui/eyebrow";
import { CornerBrackets } from "./ui/corner-brackets";
import { useInView } from "@/lib/use-in-view";

// This section fetches the REAL discovery documents served by the deployed
// backend — /.well-known/agents.json and /catalog.ai.json are public
// endpoints, exactly what an AI buyer would request. If the backend is
// unreachable, the panel says so honestly instead of inventing data.

const API_BASE = "https://api.sellable.shop";

interface FetchState {
  status: "loading" | "live" | "offline";
  manifest: string;
}

export function Discovery() {
  const { ref, isInView } = useInView();
  const [state, setState] = useState<FetchState>({ status: "loading", manifest: "" });
  const [chars, setChars] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isInView || startedRef.current) return;
    startedRef.current = true;

    Promise.all([
      fetch(`${API_BASE}/.well-known/agents.json`).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
      fetch(`${API_BASE}/catalog.ai.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([manifest, catalog]) => {
        const doc = {
          name: manifest.name,
          merchant_id: manifest.merchant_id,
          protocol_version: manifest.protocol_version,
          capabilities: manifest.capabilities,
          discovery: manifest.discovery,
          payment: manifest.payment,
          catalog_products: catalog?.products?.length ?? null,
        };
        setState({
          status: "live",
          manifest: JSON.stringify(doc, null, 2),
        });
      })
      .catch(() => setState({ status: "offline", manifest: "" }));
  }, [isInView]);

  // Progressive reveal of the live JSON
  useEffect(() => {
    if (state.status !== "live") return;
    if (chars >= state.manifest.length) return;
    const t = window.setTimeout(() => {
      setChars((c) => Math.min(c + 96, state.manifest.length));
    }, 16);
    return () => window.clearTimeout(t);
  }, [state, chars]);

  return (
    <section id="discovery" className="technical-section py-[clamp(80px,10vw,160px)] overflow-hidden relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-[0.5]" style={{ background: "radial-gradient(640px 420px at 82% 60%, rgba(255,105,0,0.06), transparent 66%)" }} />
      </div>

      <div className="page-frame relative" ref={ref}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-[clamp(48px,7vw,112px)] items-center">
          {/* Right-order on desktop: panel first visual weight balance — copy left */}
          <div>
            <Eyebrow label="03 — AGENT DISCOVERY" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              AI buyers find you the way crawlers found the web
            </h2>
            <p className="body-copy mt-6">
              No SEO games. Your store serves a machine-readable manifest and
              catalog at well-known URLs, so an autonomous buyer can discover
              you, read your stock, and transact — without ever rendering a
              pixel of HTML.
            </p>

            <div className="mt-8 space-y-2">
              {[
                ["/.well-known/agents.json", "who you are + what agents may do"],
                ["/catalog.ai.json", "every SKU: price, floor, stock"],
                ["/llms.txt", "ground rules for LLM shoppers"],
              ].map(([path, note]) => (
                <a
                  key={path}
                  href={`${API_BASE}${path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 border border-[var(--bb-line-soft)] hover:border-[var(--bb-grey-4)] bg-[var(--bb-panel)]/60 px-4 py-2.5 transition-colors"
                >
                  <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.06em] px-1.5 py-0.5 border border-[var(--bb-line)] text-[var(--bb-grey-1)] shrink-0">
                    GET
                  </span>
                  <span className="font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-white)] group-hover:text-[var(--bb-orange)] transition-colors truncate">
                    {path}
                  </span>
                  <span className="ml-auto font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] hidden sm:block shrink-0">
                    {note}
                  </span>
                  <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] group-hover:text-[var(--bb-orange)] transition-colors">↗</span>
                </a>
              ))}
            </div>
          </div>

          {/* Live manifest panel */}
          <div className="relative">
            <div className="relative border border-[#30302E] bg-[var(--bb-panel)] overflow-hidden">
              <CornerBrackets />
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--bb-line)]">
                <div className="flex items-center gap-2.5">
                  <span className={`w-[5px] h-[5px] ${
                    state.status === "live"
                      ? "bg-emerald-400 animate-[pulse_1.6s_ease-in-out_infinite]"
                      : state.status === "loading"
                        ? "bg-yellow-400 animate-pulse"
                        : "bg-red-400"
                  }`} />
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                    /.well-known/agents.json
                  </span>
                </div>
                <span className={`font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] ${
                  state.status === "live"
                    ? "text-emerald-400"
                    : state.status === "loading"
                      ? "text-yellow-400"
                      : "text-red-400"
                }`}>
                  {state.status === "live"
                    ? "LIVE · FETCHED NOW"
                    : state.status === "loading"
                      ? "FETCHING…"
                      : "BACKEND UNREACHABLE"}
                </span>
              </div>

              <pre className="code-content px-5 py-4 min-h-[380px] max-h-[420px] overflow-auto font-[var(--font-mono)] text-[0.68rem] leading-[1.6] text-[var(--bb-grey-1)] whitespace-pre">
                {state.status === "offline" ? (
                  <span className="text-[var(--bb-grey-3)]">
                    {`// api.sellable.shop could not be reached from this browser.\n// The manifest is public — try again later or open the URL directly.`}
                  </span>
                ) : (
                  <>
                    {state.manifest.slice(0, chars)}
                    {chars < state.manifest.length && (
                      <span className="inline-block w-[7px] h-[13px] bg-[var(--bb-orange)] ml-0.5 -mb-[2px] animate-[blink_0.9s_steps(1)_infinite]" />
                    )}
                  </>
                )}
              </pre>

              {state.status === "live" && (
                <div className="px-5 pb-4 font-[var(--font-mono)] text-[0.52rem] tracking-[0.04em] text-[var(--bb-grey-4)]">
                  fetched from api.sellable.shop while you were reading — this is the merchant&apos;s real, current discovery document
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
