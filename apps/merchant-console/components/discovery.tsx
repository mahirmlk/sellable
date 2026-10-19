"use client";

import { useEffect, useState } from "react";
import { Eyebrow } from "./ui/eyebrow";
import { CornerBrackets } from "./ui/corner-brackets";
import { AgentJourney } from "./narrative-diagrams";
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

// How an outside agent comes here and buys through the merchant's agents
// is drawn, end to end, by <AgentJourney /> below — arrival on public
// files, identity at the gateway, quote and counter-offers by the Seller
// Agent under policy, consent-bound settlement on a verified webhook, and
// aftercare by the Service Agent. Every label on that drawing is a real
// header, endpoint, or mechanism — no invented steps.

export function Discovery() {
  const { ref, isInView } = useInView();
  const [state, setState] = useState<FetchState>({ status: "loading", manifest: "" });
  const [chars, setChars] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const retry = () => {
    setState({ status: "loading", manifest: "" });
    setChars(0);
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    if (!isInView) return;
    let cancelled = false;

    const timeout = { signal: AbortSignal.timeout(6000) };

    Promise.all([
      fetch(`${API_BASE}/.well-known/agents.json`, timeout).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
      fetch(`${API_BASE}/catalog.ai.json`, timeout)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`${API_BASE}/mcp/tools`, timeout)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([manifest, catalog, mcp]) => {
        if (cancelled) return;
        const doc = {
          name: manifest.name,
          merchant_id: manifest.merchant_id,
          protocol_version: manifest.protocol_version,
          capabilities: manifest.capabilities,
          discovery: manifest.discovery,
          payment: manifest.payment,
          api_versions: manifest.api_versions,
          catalog_products: catalog?.products?.length ?? null,
          mcp_tools: Array.isArray(mcp)
            ? mcp.length
            : Array.isArray(mcp?.tools)
              ? mcp.tools.length
              : null,
        };
        setState({
          status: "live",
          manifest: JSON.stringify(doc, null, 2),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "offline", manifest: "" });
      });

    return () => {
      cancelled = true;
    };
  }, [isInView, attempt]);

  // Progressive reveal — coarse chunks so the whole animation costs ~25
  // renders total instead of re-rendering per character.
  useEffect(() => {
    if (state.status !== "live") return;
    if (chars >= state.manifest.length) return;
    const remaining = state.manifest.length - chars;
    const step = Math.max(24, Math.ceil(remaining / 24));
    const t = window.setTimeout(() => {
      setChars((c) => Math.min(c + step, state.manifest.length));
    }, 55);
    return () => window.clearTimeout(t);
  }, [state, chars]);

  return (
    <section id="discovery" className="technical-section py-[clamp(80px,10vw,160px)]">
      <div className="page-frame relative" ref={ref}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-[clamp(48px,7vw,112px)] items-center">
          {/* Copy */}
          <div>
            <Eyebrow label="Built for agents" />
            <h2 className="section-title mt-6 text-[var(--bb-white)]">
              Any agent can find you. You decide who buys.
            </h2>
            <p className="body-copy mt-6">
              A shopping agent does not load your storefront. It reads three
              public files: who you are, what you sell, and how to behave.
              Any assistant&apos;s agent can read them.
            </p>
            <p className="body-copy mt-4">
              To buy, it presents a key or a signed request. You issue,
              rotate, and revoke those keys from the console — and the
              gateway rejects anything signed wrong, replayed, or revoked.
            </p>

            <div className="mt-8">
              <div className="mb-3 font-[var(--font-mono)] text-[0.52rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)]">
                Public · no key required
              </div>
              <div className="space-y-2">
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
                    <span className="font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-white)] group-hover:text-[var(--bb-white)] transition-colors truncate">
                      {path}
                    </span>
                    <span className="ml-auto font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] hidden sm:block shrink-0">
                      {note}
                    </span>
                    <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] group-hover:text-[var(--bb-white)] transition-colors">↗</span>
                  </a>
                ))}
              </div>
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
                      ? "bg-[var(--bb-orange)] live-dot rounded-full"
                      : state.status === "loading"
                        ? "bg-[var(--bb-grey-3)]"
                        : "bg-[var(--bb-grey-4)]"
                  }`} />
                  <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
                    /.well-known/agents.json
                  </span>
                </div>
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] text-[var(--bb-grey-2)]">
                  {state.status === "live"
                    ? "LIVE · FETCHED NOW"
                    : state.status === "loading"
                      ? "FETCHING…"
                      : "NO REPLY"}
                </span>
              </div>

              {state.status === "offline" ? (
                <div className="flex min-h-[380px] max-h-[420px] flex-col justify-center px-6 py-10 sm:px-8">
                  {/* the request that came back empty */}
                  <div className="space-y-2.5 font-[var(--font-mono)] text-[0.62rem]">
                    <div className="flex items-baseline gap-3">
                      <span className="w-[28px] shrink-0 text-[var(--bb-grey-3)]">
                        GET
                      </span>
                      <span className="truncate text-[var(--bb-grey-2)]">
                        api.sellable.shop/.well-known/agents.json
                      </span>
                    </div>
                    <div className="flex items-baseline gap-3">
                      <span className="w-[28px] shrink-0 text-[var(--bb-grey-4)]">
                        RES
                      </span>
                      <span className="inline-flex items-center gap-2 text-[var(--bb-grey-2)]">
                        <span
                          className="w-[5px] h-[5px] bg-[var(--bb-grey-4)]"
                          aria-hidden="true"
                        />
                        no answer
                      </span>
                    </div>
                  </div>

                  <p className="mt-9 max-w-[46ch] font-[var(--font-sans)] text-[0.95rem] leading-relaxed text-[var(--bb-grey-1)]">
                    The API that serves this file is down right now. This
                    panel prints what the live endpoint returns, so there is
                    nothing to show until it answers.
                  </p>
                  <p className="mt-4 max-w-[46ch] font-[var(--font-sans)] text-[0.92rem] leading-relaxed text-[var(--bb-grey-2)]">
                    The file itself is public and needs no key. Open it
                    straight from the URL, or fetch it again from here.
                  </p>

                  <div className="mt-9 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={retry}
                      className="inline-flex items-center gap-2 border border-[var(--bb-line)] px-4 py-2.5 font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-white)] transition-colors hover:border-[var(--bb-grey-3)] hover:bg-[var(--bb-panel-2)]"
                    >
                      <span
                        className="w-[6px] h-[6px] bg-[var(--bb-orange)]"
                        aria-hidden="true"
                      />
                      Fetch again
                    </button>
                    <a
                      href={`${API_BASE}/.well-known/agents.json`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 border border-[var(--bb-line)] px-4 py-2.5 font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)] transition-colors hover:border-[var(--bb-grey-3)] hover:text-[var(--bb-white)]"
                    >
                      Open the URL
                      <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                </div>
              ) : (
                <pre className="code-content px-5 py-4 min-h-[380px] max-h-[420px] overflow-auto font-[var(--font-mono)] text-[0.68rem] leading-[1.6] text-[var(--bb-grey-1)]">
                  {state.manifest.slice(0, chars)}
                  {chars < state.manifest.length && (
                    <span className="inline-block w-[7px] h-[13px] bg-[var(--bb-white)] ml-0.5 -mb-[2px] animate-[blink_0.9s_steps(1)_infinite]" />
                  )}
                </pre>
              )}

              {state.status === "live" && (
                <div className="px-5 pb-4 font-[var(--font-mono)] text-[0.52rem] tracking-[0.04em] text-[var(--bb-grey-4)]">
                  fetched from api.sellable.shop while you were reading. This is the merchant&apos;s real discovery document — every visiting agent starts here
                </div>
              )}
            </div>
          </div>
        </div>

        {/* How an outside agent buys — arrival through settlement to support */}
        <div className="mt-[clamp(56px,7vw,104px)]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 py-4 border-t border-b border-[var(--bb-line)]">
            <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.14em] uppercase text-[var(--bb-grey-2)]">
              How an outside agent buys here
            </span>
            <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">
              through your agents · under your policy
            </span>
          </div>

          <div className="pt-10 sm:pt-12">
            <AgentJourney />
          </div>
        </div>
      </div>
    </section>
  );
}
