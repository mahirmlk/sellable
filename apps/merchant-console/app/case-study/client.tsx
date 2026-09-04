"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/* --- small helpers --- */
function useInViewOnce(threshold = 0.18) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true);
          obs.unobserve(el);
        }
      },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

/* --- plain-language callout: same facts, no jargon --- */
function PlainWords({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 border border-dashed border-[#ff6900]/50 bg-[#fffaf6] px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#ff6900]" />
        <span className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-[#ff6900]">In plain words</span>
      </div>
      <p className="mt-1.5 font-sans text-[0.94rem] leading-[1.62] text-[#3a3a36]">{children}</p>
    </div>
  );
}

/* --- Excalidraw-style hand-drawn diagram primitives ---
   Wobble comes from a displacement filter over clean geometry; the boxes
   are simple rects/paths so the whole diagram keeps a fixed viewBox size
   and scales proportionally at every breakpoint. */
const HAND_FONT = "'Segoe Print', 'Comic Sans MS', 'Bradley Hand', cursive";

function SketchDefs() {
  return (
    <defs>
      <filter id="sketch-wobble" x="-4%" y="-4%" width="108%" height="108%">
        <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="11" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" />
      </filter>
      <filter id="sketch-wobble-soft" x="-4%" y="-4%" width="108%" height="108%">
        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="4" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" />
      </filter>
      <marker id="sk-arrow" viewBox="0 0 10 8" refX="8.5" refY="4" markerWidth="8" markerHeight="6.5" orient="auto-start-reverse">
        <path d="M0.5 0.5 L9 4 L0.5 7.5 L3 4 Z" fill="#4a4a46" stroke="none" />
      </marker>
      <marker id="sk-arrow-orange" viewBox="0 0 10 8" refX="8.5" refY="4" markerWidth="8" markerHeight="6.5" orient="auto-start-reverse">
        <path d="M0.5 0.5 L9 4 L0.5 7.5 L3 4 Z" fill="#ff6900" stroke="none" />
      </marker>
    </defs>
  );
}

function SketchBox({
  x, y, w, h, title, sub, stroke = "#33312e", fill = "#ffffff", titleFill = "#1a1a18", dashed = false,
}: {
  x: number; y: number; w: number; h: number;
  title: string; sub?: string;
  stroke?: string; fill?: string; titleFill?: string; dashed?: boolean;
}) {
  return (
    <g filter="url(#sketch-wobble)">
      {/* hand-drawn double border: offset second pass like a re-traced line */}
      <rect x={x} y={y} width={w} height={h} rx={10} fill={fill} stroke={stroke} strokeWidth={dashed ? 1.6 : 2} strokeDasharray={dashed ? "7 5" : undefined} />
      <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} rx={8} fill="none" stroke={stroke} strokeWidth={0.9} opacity={0.35} />
      <text x={x + w / 2} y={sub ? y + h / 2 - 4 : y + h / 2 + 4} textAnchor="middle" fontFamily={HAND_FONT} fontSize={17} fontWeight={600} fill={titleFill}>
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 15} textAnchor="middle" fontFamily={HAND_FONT} fontSize={11.5} fill="#6b6b66">
          {sub}
        </text>
      )}
    </g>
  );
}

function SketchArrow({ x1, y1, x2, y2, label, orange = false, dashed = false }: { x1: number; y1: number; x2: number; y2: number; label?: string; orange?: boolean; dashed?: boolean }) {
  const stroke = orange ? "#ff6900" : "#4a4a46";
  const mx = (x1 + x2) / 2 + (orange ? 4 : -3);
  const my = (y1 + y2) / 2;
  return (
    <g filter="url(#sketch-wobble-soft)">
      <path
        d={`M ${x1} ${y1} C ${x1 + (mx - x1) * 0.4} ${my - 6}, ${x2 + (mx - x2) * 0.4} ${my + 6}, ${x2} ${y2}`}
        fill="none" stroke={stroke} strokeWidth={1.8} strokeDasharray={dashed ? "6 4" : undefined}
        markerEnd={orange ? "url(#sk-arrow-orange)" : "url(#sk-arrow)"}
      />
      {label && (
        <text x={mx} y={my - 7} textAnchor="middle" fontFamily={HAND_FONT} fontSize={11} fill={orange ? "#e25700" : "#6b6b66"}>
          {label}
        </text>
      )}
    </g>
  );
}

function SketchNote({ x, y, text, anchor = "start", fill = "#8a5a00" }: { x: number; y: number; text: string; anchor?: "start" | "middle" | "end"; fill?: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontFamily={HAND_FONT} fontSize={11.5} fill={fill}>
      {text}
    </text>
  );
}

/** Hand-drawn flow: how an AI buyer buys from the store, start to PAID. */
function SketchArchitectureDiagram() {
  return (
    <svg viewBox="0 0 720 660" className="w-full h-auto" role="img" aria-label="Hand-drawn diagram of the agentic commerce flow: AI buyer discovers the store, gets a policy-checked quote, one-time consent, Razorpay payment, and every step is written to the ledger">
      <SketchDefs />
      {/* column guide lines, like a notebook margin */}
      <g filter="url(#sketch-wobble-soft)">
        <path d="M 40 18 C 42 200, 36 420, 41 640" stroke="#e7e5e0" strokeWidth={1.4} fill="none" />
        <path d="M 680 22 C 678 220, 684 430, 679 638" stroke="#e7e5e0" strokeWidth={1.4} fill="none" />
      </g>

      <SketchBox x={255} y={14} w={210} h={54} title="AI Buyer" sub="a shopping agent, not a person" stroke="#33312e" />
      <SketchArrow x1={360} y1={68} x2={360} y2={108} label="reads your store" />
      <SketchBox x={205} y={110} w={310} h={54} title="AI Storefront" sub="agents.json · catalog the machine can read" stroke="#33312e" />
      <SketchArrow x1={360} y1={164} x2={360} y2={204} label="asks for a price" />
      <SketchBox x={205} y={206} w={310} h={54} title="Seller Agent" sub="builds a quote from your real catalog" stroke="#ff6900" fill="#fff7f0" />
      <SketchArrow x1={360} y1={260} x2={360} y2={300} label="is this deal allowed?" orange />
      <SketchBox x={205} y={302} w={310} h={54} title="Policy Engine" sub="budget · floor · categories · limits" stroke="#2f9e6e" fill="#f2fbf6" />

      {/* DENY branch */}
      <SketchArrow x1={515} y1={329} x2={600} y2={329} label="" orange dashed />
      <SketchBox x={602} y={302} w={104} h={54} title="Stops." sub="explains why" stroke="#c4453a" fill="#fdf3f2" dashed />
      <SketchNote x={654} y={296} text="no money moves" anchor="middle" fill="#c4453a" />

      <SketchArrow x1={360} y1={356} x2={360} y2={396} label="allowed → one-time permission" />
      <SketchBox x={205} y={398} w={310} h={54} title="Consent" sub="single-use · exact amount · expires" stroke="#7c5cd6" fill="#f8f5ff" />
      <SketchArrow x1={360} y1={452} x2={360} y2={492} label="pays for real" />
      <SketchBox x={205} y={494} w={310} h={54} title="Razorpay" sub="test-mode rails · signed webhook confirms" stroke="#b9952e" fill="#fffdf2" />
      <SketchArrow x1={360} y1={548} x2={360} y2={588} label="verified → paid" />
      <SketchBox x={235} y={590} w={250} h={48} title="PAID — and written down" stroke="#2f9e6e" fill="#f2fbf6" />

      {/* ledger side rail: everything is recorded */}
      <SketchArrow x1={214} y1={520} x2={140} y2={520} label="" orange dashed />
      <SketchBox x={12} y={488} w={126} h={64} title="The Ledger" sub="every step recorded" stroke="#2f9e6e" fill="#f2fbf6" dashed />
      <SketchNote x={75} y={576} text="why, what, which rule — replayable" anchor="middle" />
    </svg>
  );
}

/** Hand-drawn gate: the LLM proposes, the deterministic engine decides. */
function SketchPolicyGateDiagram() {
  return (
    <svg viewBox="0 0 720 240" className="w-full h-auto" role="img" aria-label="Hand-drawn diagram: the language model proposes, the deterministic policy engine allows, denies, or asks a human — it can never touch money directly">
      <SketchDefs />
      <SketchBox x={14} y={82} w={200} h={70} title="The AI" sub="suggests a price, an upsell, a cart" stroke="#ff6900" fill="#fff7f0" />
      <SketchArrow x1={216} y1={117} x2={296} y2={117} label="proposes" orange />
      <SketchBox x={298} y={72} w={190} h={90} title="Policy Engine" sub="plain rules, no AI inside —" stroke="#2f9e6e" fill="#f2fbf6" />
      <text x={393} y={180} textAnchor="middle" fontFamily={HAND_FONT} fontSize={11.5} fill="#2f9e6e">same inputs, same answer, every time</text>

      <SketchArrow x1={490} y1={92} x2={580} y2={60} label="ALLOW" />
      <SketchBox x={584} y={34} w={122} h={48} title="go ahead" stroke="#2f9e6e" fill="#f2fbf6" />
      <SketchArrow x1={490} y1={122} x2={580} y2={126} label="DENY" orange dashed />
      <SketchBox x={584} y={100} w={122} h={48} title="blocked" sub="with a reason" stroke="#c4453a" fill="#fdf3f2" dashed />
      <SketchArrow x1={490} y1={150} x2={580} y2={192} label="too big?" dashed />
      <SketchBox x={584} y={168} w={122} h={48} title="ask a human" sub="merchant approves" stroke="#b9952e" fill="#fffdf2" dashed />
      <SketchNote x={16} y={210} text="The AI never signs the payment. It can only ask — the rules and the human say yes or no." />
    </svg>
  );
}

function InteractionModelLive() {
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(0);
  const fullLeft = "may 31 - trying to get this game 7 recap into shape and i'm blanking on the fina";
  const suffix = "l score — Spurs 111, Thunder 103";
  useEffect(() => {
    const timers: number[] = [];
    const t1 = window.setTimeout(() => setStep(1), 500);
    const t2 = window.setTimeout(() => setStep(2), 1200);
    const t3 = window.setTimeout(() => setStep(3), 1800);
    timers.push(t1, t2, t3);
    let i = 0;
    const iv = window.setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= fullLeft.length) window.clearInterval(iv);
    }, 18);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(iv);
    };
  }, []);
  const visibleText = fullLeft.slice(0, typed);
  const showHold = step >= 2;
  const showInsert = step >= 3;

  return (
    <div className="mt-8 border border-black/10 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 sm:px-5 py-3 bg-[#fcfcfb]">
        <span className="font-sans text-[0.78rem] font-semibold tracking-[-0.01em] text-[#111]">
          Interaction Model
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[0.62rem] tracking-[0.06em] text-neutral-500">
            <span
              className={`w-1.5 h-1.5 rounded-full ${showHold ? "bg-emerald-500" : "bg-neutral-300"} animate-pulse`}
            />
          {showInsert ? "inserted ✓" : step >= 1 ? "sampling…" : "listening…"}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1.35fr_0.75fr] gap-0">
        <div className="px-5 py-5 sm:px-6 sm:py-6">
          {/* Fixed reserve: the tallest the sentence reaches, so the typing
              animation never shifts the panel below it. */}
          <p className="font-sans text-[0.92rem] leading-[1.68] tracking-[-0.01em] text-[#1a1a18] min-h-[7.2rem] sm:min-h-[4.6rem] md:min-h-[6.4rem]">
            {visibleText}
            {typed < fullLeft.length ? (
              <span className="inline-block w-[2px] h-[1.05em] translate-y-[2px] bg-[#111] animate-[blink_1s_steps(1)_infinite] ml-[1px]" />
            ) : showInsert ? (
              <span className="text-[#111] font-medium">{suffix}</span>
            ) : (
              <span className="inline-block w-[2px] h-[1.05em] translate-y-[2px] bg-[#111] animate-[blink_1s_steps(1)_infinite] ml-[1px]" />
            )}
          </p>
          <p className="mt-3 font-mono text-[0.68rem] leading-[1.5] text-neutral-500">
            The writer pauses on <em className="text-[#111] not-italic font-medium">“fina…”</em> — the model has already
            noticed the missing fact. It does not interrupt the sentence.
          </p>
          {/* Fixed reserve for the insertion banner: it appears at step 3. */}
          <p className="mt-2 font-mono text-[0.68rem] leading-[1.5] min-h-[2.6rem]">
            {showInsert ? (
              <span className="animate-[slide-up_0.4s_ease-out_both]">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                  <span className="w-1 h-1 rounded-full bg-emerald-500" /> Held fact released — “Spurs 111, Thunder 103” inserted where the sentence naturally wanted it.
                </span>
              </span>
            ) : null}
          </p>
        </div>
        <div className="border-t md:border-t-0 md:border-l border-black/10 bg-[#fdfdfb] px-5 py-5">
          <div className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-neutral-400">Model actions</div>
          <div className="mt-3 space-y-3">
            <div
              className={`flex gap-2.5 transition-all duration-400 ${step >= 1 ? "opacity-100 translate-x-0" : "opacity-20 translate-x-1"}`}
            >
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#ff6900] flex-shrink-0" />
              <div>
                <div className="font-mono text-[0.7rem] font-medium text-[#111]">lookup queued</div>
                <div className="font-sans text-[0.74rem] leading-[1.45] text-neutral-600">Missing final score detected before sentence ends.</div>
                <div className="mt-1 font-mono text-[0.62rem] text-neutral-400">query: Spurs Thunder Game 7 final score</div>
              </div>
            </div>
            <div
              className={`flex gap-2.5 transition-all duration-400 delay-100 ${step >= 2 ? "opacity-100 translate-x-0" : "opacity-20 translate-x-1"}`}
            >
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${showHold ? "bg-emerald-500" : "bg-neutral-300"}`} />
              <div>
                <div className="font-mono text-[0.7rem] font-medium text-[#111]">fact held</div>
                <div className="font-sans text-[0.74rem] leading-[1.45] text-neutral-600">Spurs 111 — Thunder 103 cached. Not yet inserted.</div>
                <div className="mt-1 inline-flex items-center gap-1 font-mono text-[0.62rem] text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded">policy: hold till anchor</div>
              </div>
            </div>
            <div
              className={`flex gap-2.5 transition-all duration-400 delay-200 ${step >= 3 ? "opacity-100 translate-x-0" : "opacity-20 translate-x-1"}`}
            >
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${showInsert ? "bg-[#0a0a0a]" : "bg-neutral-300"}`} />
              <div>
                <div className="font-mono text-[0.7rem] font-medium text-[#111]">anchor found → inserted</div>
                <div className="font-sans text-[0.74rem] leading-[1.45] text-neutral-600">Sentence reached “final score” — natural insertion point.</div>
              </div>
            </div>
          </div>
          <div className="mt-4 border-t border-black/5 pt-3 font-mono text-[0.62rem] leading-[1.6] text-neutral-500">
            <span className="text-[#111] font-medium">SELLABLE mirror:</span> Seller Agent holds a valid quote + upsell until single-use consent and policy both allow insertion at the payment step. The LLM never gets to write money directly.
          </div>
        </div>
      </div>
      <div className="h-[1px] bg-gradient-to-r from-transparent via-black/10 to-transparent" />
      <div className="px-5 py-2.5 flex items-center gap-2 font-mono text-[0.6rem] tracking-[0.06em] uppercase text-neutral-400 bg-[#fafaf8]">
        <span className="w-1 h-1 rounded-full bg-[#ff6900] animate-pulse" />
        Live held-fact pattern · same white editorial physics as the reference image
      </div>
    </div>
  );
}

function WorkflowStepper() {
  const steps = [
    { k: "DISCOVER", d: "Buyer reads /.well-known/agents.json, llms.txt, catalog.ai.json", dot: "bg-sky-500" },
    { k: "RESEARCH", d: "catalog.search → grounded products, never invented SKUs", dot: "bg-sky-500" },
    { k: "QUOTE", d: "Seller creates quote · Policy validates budget, floor, category", dot: "bg-[#ff6900]" },
    { k: "NEGOTIATE", d: "Bounded counter-offers (max 5 rounds) · LLM chooses phrasing only", dot: "bg-[#ff6900]" },
    { k: "UPSELL", d: "One contextual add-on, stock- and budget-checked", dot: "bg-amber-500" },
    { k: "CONSENT", d: "Single-use, amount-bound, expiring token · HITL if over threshold", dot: "bg-violet-500" },
    { k: "PAY", d: "Razorpay test mode · Order + Payment Link · HMAC webhook authority", dot: "bg-emerald-500" },
    { k: "REPLAY", d: "XAI Ledger explains every money action with trace_id", dot: "bg-neutral-800" },
  ];
  const { ref, visible } = useInViewOnce(0.12);
  return (
    <div ref={ref} className="relative mt-8 border border-black/10 bg-white overflow-hidden">
      <div className="relative grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-0">
        <div className="px-6 sm:px-8 py-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[#fafaf8] px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-mono text-[0.62rem] tracking-[0.12em] uppercase text-neutral-600">Workflow</span>
            <span className="font-mono text-[0.62rem] text-neutral-400">live rails</span>
          </div>
          <h3 className="mt-4 font-serif text-[1.55rem] leading-[0.98] tracking-[-0.03em] text-[#111]">Discovery → Replay in one trace</h3>
          <p className="mt-3 font-sans text-[0.92rem] leading-[1.6] text-neutral-600 max-w-[42ch]">
            Every step leaves a ledger event with <span className="text-[#111] font-medium">actor · action · inputs · outputs · reasoning_summary · policy_refs</span>. Nothing about money is left to “the model felt like it”.
          </p>
          <div className="mt-6 space-y-3">
            {steps.map((s, i) => (
              <div
                key={s.k}
                className={`flex gap-3 transition-all duration-500 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}
                style={{ transitionDelay: `${i * 50}ms` }}
              >
                <div className="flex flex-col items-center">
                  <span className={`w-2.5 h-2.5 rounded-full ${s.dot} mt-1 shadow-[0_0_0_4px_rgba(255,255,255,1)] ring-1 ring-black/10`} />
                  {i < steps.length - 1 && <span className="w-px flex-1 bg-black/10 mt-1" />}
                </div>
                <div className={`flex-1 border border-black/[0.06] bg-white px-3 py-2.5 transition-all ${visible ? "border-black/10" : ""}`}>
                  <div className="font-mono text-[0.64rem] tracking-[0.11em] uppercase text-neutral-500">{String(i + 1).padStart(2, "0")} — {s.k}</div>
                  <div className="font-sans text-[0.84rem] leading-[1.5] text-[#1a1a18]">{s.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative border-t lg:border-t-0 lg:border-l border-black/10 bg-[#fcfcfa] px-6 sm:px-7 py-7 flex flex-col">
          <div className="font-mono text-[0.64rem] tracking-[0.12em] uppercase text-neutral-400">Live trace (trc_88f2)</div>
          <div className="mt-4 space-y-2.5 font-mono text-[0.72rem] leading-[1.6]">
            {[
              ["13:56:42", "buyer_agent", "catalog.search", "ALLOW"],
              ["13:56:44", "seller_agent", "quote.created", "₹5,100"],
              ["13:56:46", "policy_engine", "negotiation.countered", "₹4,950"],
              ["13:56:48", "seller_agent", "upsell.offered", "Desk Mat"],
              ["13:56:50", "policy_engine", "order.allowed", "ALLOW"],
              ["13:56:51", "consent_service", "consent.issued", "single-use"],
              ["13:57:02", "razorpay", "payment.attempted", "→"],
              ["13:57:06", "razorpay", "payment.captured", "✓"],
              ["13:57:07", "commerce_core", "order.paid", "PAID"],
            ].map(([t, actor, action, outcome], i) => (
              <div
                key={action}
                className={`grid grid-cols-[72px_108px_1fr] gap-2 items-center border border-black/[0.06] bg-white px-3 py-2 transition-all duration-400 ${visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-1"}`}
                style={{ transitionDelay: `${300 + i * 60}ms` }}
              >
                <span className="text-neutral-400">{t}</span>
                <span className="text-[#111] truncate">{actor}</span>
                <span className="flex items-center gap-2">
                  <span className="text-neutral-700 truncate">{action}</span>
                  <span className="ml-auto inline-flex items-center rounded-full bg-[#111] text-white px-2 py-0.5 text-[0.62rem] tracking-[0.04em]">{outcome}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 font-mono text-[0.6rem] tracking-[0.06em] uppercase text-neutral-400">One coherent trace from buyer intent to receipt — replayable in the Merchant Console.</div>
        </div>
      </div>
    </div>
  );
}

function TechStackWhite() {
  const cols = [
    {
      h: "Backend",
      items: ["Python 3.11+", "FastAPI + Uvicorn", "LangGraph state machines", "Pydantic v2 · SQLAlchemy 2.0", "SlowAPI rate limits", "HMAC signed-key auth"],
    },
    {
      h: "Frontend + Realtime",
      items: ["Next.js 16 App Router", "React 19 · TypeScript 5", "Tailwind CSS 4", "Geist Sans/Mono", "SSE /api/activity/stream", "Lenis smooth scroll"],
    },
    {
      h: "Data & Payments",
      items: ["SQLite (dev) / Postgres 16", "Razorpay test mode", "HMAC webhook verification", "Idempotency keys", "Single-use consent", "XAI Ledger (append-only)"],
    },
  ];
  const { ref, visible } = useInViewOnce(0.15);
  return (
    <div ref={ref} className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-3">
      {cols.map((c, i) => (
        <div
          key={c.h}
          className={`border border-black/10 bg-white p-5 transition-all duration-500 hover:border-black/20 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}
          style={{ transitionDelay: `${i * 60}ms` }}
        >
          <div className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-neutral-400 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-[#ff6900]" /> {c.h}
          </div>
          <ul className="mt-3 space-y-2">
            {c.items.map((it) => (
              <li key={it} className="flex gap-2 font-sans text-[0.84rem] leading-[1.5] text-neutral-700">
                <span className="mt-[7px] w-1 h-1 bg-neutral-300 flex-shrink-0" />
                {it}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function LedgerTimelineWhite() {
  const events = [
    { actor: "buyer_agent", action: "intent.created", why: "Mission: desk setup under ₹6,000" },
    { actor: "policy_engine", action: "policy.checked", why: "Budget ₹6,000 — cart ₹5,200 — ALLOW" },
    { actor: "consent_service", action: "consent.issued", why: "Single-use · amount-bound · exp 15m" },
    { actor: "razorpay", action: "payment.captured", why: "HMAC webhook verified · provider_ref pay_… " },
    { actor: "commerce_core", action: "order.paid", why: "State → PAID → FULFILLED · ledger appended" },
  ];
  const { ref, visible } = useInViewOnce(0.2);
  return (
    <div ref={ref} className="mt-6 border border-black/10 bg-white overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-0">
        <div className="px-6 py-6">
          <div className="font-mono text-[0.62rem] tracking-[0.12em] uppercase text-neutral-400">XAI Ledger — explainable money</div>
          <h4 className="mt-2 font-serif text-[1.25rem] leading-[0.98] tracking-[-0.02em] text-[#111]">Every material action leaves a sentence a human can audit.</h4>
          <div className="mt-4 space-y-3">
            {events.map((e, i) => (
              <div key={e.action} className={`flex gap-3 transition-all duration-500 ${visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-2"}`} style={{ transitionDelay: `${i * 80}ms` }}>
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#ff6900] flex-shrink-0" />
                <div className="flex-1 border border-black/5 bg-[#fcfcfa] px-3 py-2.5">
                  <div className="font-mono text-[0.66rem] tracking-[0.06em] text-neutral-500">{e.actor} · {e.action}</div>
                  <div className="font-sans text-[0.84rem] leading-[1.5] text-[#1a1a18]">{e.why}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t lg:border-t-0 lg:border-l border-black/10 bg-[#0a0a0a] text-white px-6 py-6 font-mono text-[0.72rem] leading-[1.7]">
          <div className="text-neutral-400 tracking-[0.08em] uppercase text-[0.62rem]">LedgerEvent JSON</div>
          <pre className="mt-3 whitespace-pre-wrap break-words text-[0.74rem] leading-[1.6] text-[#e8e8e5]">
{`{
  "event_id": "evt_7f3a",
  "trace_id": "trc_88f2",
  "actor": "policy_engine",
  "action": "policy.validate_order",
  "inputs": { "total_paise": 185000 },
  "output": { "decision": "ALLOW" },
  "reasoning_summary":
    "Order is within buyer budget and merchant floor.",
  "policy_refs": [
    "POLICY.buyer_budget",
    "POLICY.max_order_value"
  ],
  "outcome_effect": { "order_state": "AWAITING_CONSENT" }
}`}
          </pre>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[0.64rem] tracking-[0.06em] uppercase text-white/70">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> append-only · immutable · replayable
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CaseStudyClient() {
  return (
    <div className="bg-white text-[#0a0a0a] selection:bg-[#ff6900] selection:text-white">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap');
        .font-serif { font-family: 'Instrument Serif', Georgia, 'Times New Roman', serif; }
        @keyframes blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
        @keyframes slide-up { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>

      {/* LIGHT HEADER */}
      <header className="sticky top-0 z-40 backdrop-blur-[12px] bg-white/85 border-b border-black/10">
        <div className="mx-auto max-w-[1120px] px-6 sm:px-8 h-[64px] flex items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="font-mono text-[0.72rem] tracking-[0.14em] uppercase text-neutral-400 hidden sm:inline">SELLABLE</span>
            <span className="w-px h-4 bg-black/10 hidden sm:block" />
            <span className="font-mono text-[0.72rem] tracking-[0.12em] uppercase text-[#111]">Case Study</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 font-mono text-[0.7rem] tracking-[0.1em] uppercase text-neutral-500">
            <a href="#context" className="hover:text-[#111]">Context</a>
            <a href="#workflow" className="hover:text-[#111]">Workflow</a>
            <a href="#architecture" className="hover:text-[#111]">Architecture</a>
            <a href="#stack" className="hover:text-[#111]">Stack</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="hidden sm:inline-flex items-center justify-center h-10 px-5 rounded-full border-2 border-black bg-white font-sans text-[0.82rem] font-semibold tracking-tight hover:bg-gray-50 transition-colors">
              <span className="text-black">Dashboard</span>
            </Link>
            <Link href="/" className="inline-flex items-center justify-center h-10 px-5 rounded-full bg-black font-sans text-[0.82rem] font-semibold tracking-tight hover:bg-gray-800 transition-colors">
              <span className="text-white">Home</span>
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <div className="relative overflow-hidden border-b border-black/10">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white" />

        <div className="relative mx-auto max-w-[1120px] px-6 sm:px-8 pt-10 sm:pt-14 pb-8 sm:pb-10">
          <div className="mx-auto max-w-[760px] text-center">
            <div className="inline-flex flex-wrap items-center justify-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-1.5 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ff6900] animate-pulse" />
                <span className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-neutral-600">Case study</span>
                <span className="font-mono text-[0.6rem] text-neutral-400">·</span>
                <span className="font-mono text-[0.6rem] tracking-[0.06em] uppercase text-neutral-500">Sellable</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-[#0a0a0a] px-3 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-white">Live system</span>
              </span>
            </div>

            <div className="mt-5 inline-flex items-center gap-2 font-mono text-[0.64rem] tracking-[0.14em] uppercase text-neutral-400">
              <span className="w-2 h-2 bg-[#ff6900] inline-block" />
              The held fact — an editorial about timing, restraint, and money
            </div>

            <h1 className="font-serif text-[2.6rem] sm:text-[3.4rem] lg:text-[4.1rem] leading-[0.92] tracking-[-0.042em] text-[#0a0a0a] text-balance mt-3">
              Building the merchant side
              <br />
              of <em className="font-serif italic font-normal tracking-[-0.04em]">agentic commerce</em>
            </h1>

            <p className="mx-auto mt-5 max-w-[56ch] font-sans text-[1.02rem] sm:text-[1.08rem] leading-[1.65] tracking-[-0.015em] text-neutral-600 text-pretty">
              A white-page story about how SELLABLE makes any store <span className="text-[#111] font-medium">discoverable, negotiable, and safely transactable</span> by autonomous AI buyers — with deterministic policy and a ledger that explains every rupee.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 font-mono text-[0.66rem] tracking-[0.06em] uppercase text-neutral-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-neutral-300" /> Sep 1, 2026
              </span>
              <span className="w-px h-3 bg-black/10" />
              <span>14 min read</span>
              <span className="w-px h-3 bg-black/10" />
              <span>Razorpay AI Buildathon — Track 01</span>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <a
                href="#held-fact"
                className="inline-flex items-center gap-2.5 rounded-full border-2 border-black bg-black px-7 py-3.5 font-sans text-[0.9rem] font-semibold tracking-tight hover:bg-gray-800 transition-colors"
              >
                <span className="text-white">Start reading</span>
                <span aria-hidden="true" className="text-white text-[1.1rem]">→</span>
              </a>
              <a
                href="#architecture"
                className="inline-flex items-center gap-2.5 rounded-full border-2 border-black bg-white px-7 py-3.5 font-sans text-[0.9rem] font-semibold tracking-tight hover:bg-gray-50 transition-colors"
              >
                <span className="text-black">Jump to architecture</span>
                <span aria-hidden="true" className="text-black text-[1.1rem]">↗</span>
              </a>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 font-mono text-[0.62rem] tracking-[0.06em] uppercase text-neutral-400">
              <span>Agent Gateway: /.well-known/agents.json</span>
              <span className="w-px h-3 bg-black/10" />
              <span>Policy: deterministic</span>
              <span className="w-px h-3 bg-black/10" />
              <span>Ledger: recording</span>
            </div>
          </div>
        </div>
      </div>

      {/* NARROW EDITORIAL COLUMN — like the screenshot */}
      <main className="mx-auto max-w-[760px] px-6 sm:px-8">
        {/* Eyebrow + held fact intro */}
        <div id="held-fact" className="pt-10 sm:pt-12 scroll-mt-24">
          <div className="flex items-center gap-3">
            <span className="block w-3 h-3 bg-[#ff6900] flex-shrink-0" />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase text-neutral-500">Editorial — the held fact</span>
          </div>

          <h2 className="font-serif text-[1.75rem] sm:text-[2rem] leading-[0.98] tracking-[-0.03em] text-[#111] mt-4">The held fact</h2>

          <div className="mt-6 space-y-6 font-sans text-[1.02rem] leading-[1.75] tracking-[-0.015em] text-[#1a1a18]">
            <p>
              The first example is based on a note written after a Spurs-Thunder Game 7. While drafting a recap, the writer mentions that they cannot remember the
              final score. The model notices the missing information and starts a lookup <em className="font-medium not-italic text-[#111]">before the sentence is finished</em>.
            </p>
            <p>
              The result comes back as <span className="rounded bg-[#ff6900]/10 border border-[#ff6900]/15 px-1.5 py-0.5 font-mono text-[0.92rem] text-[#111]">Spurs 111, Thunder 103</span>, but the model does not immediately insert it into the draft. It
              keeps the information available while the user continues typing, then adds it when the writing reaches a place where the score naturally belongs.
            </p>
            <p>
              This is the &quot;held fact&quot; pattern. The fact is <em className="font-medium not-italic text-[#111]">not hidden</em> — it is <em className="font-medium not-italic text-[#111]">timed</em>. The model holds it in memory, aware of its relevance, but defers insertion until the context is right. Inserting it too early would disrupt the sentence flow. Inserting it too late would miss the moment. The discipline is in the timing.
            </p>
            <PlainWords>
              Think of a good assistant who has already found the answer but waits for the right moment to speak. The answer is ready; the timing is deliberate. SELLABLE applies that same &ldquo;wait for the right moment&rdquo; discipline to payments.
            </PlainWords>
            <p>
              In agentic commerce, the same pattern governs money. The Seller Agent holds a valid quote — a price computed from catalog, margin rules, and negotiation history. It holds an upsell suggestion — a complementary product checked against stock and budget. It holds a consent token — a single-use, amount-bound, expiring authorization. Each of these is a &quot;held fact&quot; about money. The agent cannot insert them arbitrarily. They must wait for the policy engine to confirm that every guardrail is satisfied, and then release exactly once.
            </p>
            <p>
              This is why the held fact is not just a UX metaphor. It is the safety architecture. The model proposes; the policy engine disposes; the ledger records the moment of insertion with a trace_id, a reasoning_summary, and the policy references that governed the decision. Every rupee has an explanation. Every hold has a reason. Every insertion has an anchor.
            </p>
            <PlainWords>
              In SELLABLE, the AI can suggest and negotiate, but it can never move money by itself. A rulebook (not another AI) checks every deal, and a receipt-style log explains every step in plain language.
            </PlainWords>
          </div>

          <div className="mt-3 font-mono text-[0.66rem] tracking-[0.08em] uppercase text-neutral-400">Reference interaction — white paper style, live sampling indicator</div>

          <InteractionModelLive />

          <div className="mt-8 border-l-2 border-[#ff6900] bg-[#fff7f0] px-5 py-4">
            <div className="font-mono text-[0.64rem] tracking-[0.12em] uppercase text-[#ff6900]">Sellable thesis — one line</div>
            <p className="mt-2 font-serif text-[1.15rem] leading-[1.35] tracking-[-0.02em] text-[#111]">
              “The LLM proposes, the policy engine disposes — and every action leaves an explanation.”
            </p>
            <p className="mt-2 font-sans text-[0.88rem] leading-[1.6] text-neutral-600">
              The agent never has final authority over money. It proposes; a deterministic Policy/Guardrail engine validates; the XAI Ledger records everything. The “held fact” timing discipline becomes a money discipline.
            </p>
          </div>
        </div>

        {/* Context */}
        <div id="context" className="pt-14 scroll-mt-24">
          <div className="flex items-center gap-3">
            <span className="block w-3 h-3 bg-[#111] flex-shrink-0" />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase text-neutral-500">Part 1 — Context</span>
          </div>
          <h2 className="font-serif text-[1.9rem] sm:text-[2.2rem] leading-[0.95] tracking-[-0.03em] text-[#111] mt-4">Why now. Why this track.</h2>

          <div className="mt-6 space-y-5 font-sans text-[1.0rem] leading-[1.72] tracking-[-0.012em] text-[#1e1e1c]">
            <p>
              In 2025, NPCI — which runs UPI — published agent payment protocols that let AI agents initiate and approve payments on a user&apos;s behalf with per-transaction
              consent, spend caps, and human-in-the-loop above thresholds. At the same time, AI buyers shifted from <em>recommending</em> to <em>purchasing</em>: Perplexity&apos;s
              buy-with-Pro, OpenAI&apos;s shopping agents, Google&apos;s procurement agents. Commerce is no longer &quot;human clicks Buy&quot;. It is &quot;agent negotiates and buys&quot;.
            </p>
            <p>
              This is not a future-state prediction. It is a present-tense infrastructure gap. Razorpay already runs pilot programs with merchants who receive orders from AI agents.
              NPCI&apos;s 2025 protocol specification defines consent tokens, spend limits, and audit requirements that merchants must implement <em>now</em> to participate in this channel.
              The merchants who build agent-facing infrastructure today will capture the first wave of autonomous procurement spend — estimated at $47B globally by 2027.
            </p>
            <PlainWords>
              Two things changed at once: the rules (India&apos;s payment network now says how an AI agent may pay on your behalf) and the buyers (shopping AIs that actually buy, not just recommend). Stores today are built for people clicking a &ldquo;Buy&rdquo; button — an AI literally cannot read them.
            </PlainWords>
            <p>
              Merchants today are built for human eyeballs: HTML storefronts, carts, coupon codes. They are <span className="bg-[#111] text-white px-1">invisible and unusable</span> to AI buyers: no
              machine-readable catalog, no agent-facing API, no negotiation policy, no consent flow, no audit trail when an agent spends money. The problem is not that AI cannot buy — it is that merchants have not been built to be bought <em>by</em> AI.
            </p>
            <p>
              The Track 01 brief asks for both: <span className="font-medium text-[#111]">(a) grow the merchant&apos;s revenue</span> using agents and{" "}
              <span className="font-medium text-[#111]">(b) make the merchant sellable to AI buyers</span>. We chose to solve (b) end-to-end and let (a) emerge from the
              same transaction — upsell attach, bounded negotiation that protects margin, and AI discoverability itself as a revenue channel.
            </p>
            <p>
              The core insight is timing. In writing, the &quot;held fact&quot; model teaches that information should be held until the natural insertion point. In commerce, the same discipline applies to money:
              the agent holds a valid quote, a negotiated price, and a consent token until the policy engine confirms that every gate — budget, floor, HITL, single-use — is clear.
              Then and only then does the payment execute. This is not just good UX. It is the safety invariant that makes autonomous commerce auditable.
            </p>
          </div>

          <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { k: "Invisible", v: "No agents.json, no llms.txt, no catalog.ai.json" },
              { k: "Unpriced", v: "Coupons & HTML — not policy-bound quotes" },
              { k: "Unauditable", v: "No trace_id, no reasoning_summary, no replay" },
            ].map((c) => (
              <div key={c.k} className="border border-black/10 bg-[#fcfcfa] px-4 py-4">
                <div className="font-mono text-[0.62rem] tracking-[0.12em] uppercase text-neutral-400">{c.k}</div>
                <div className="mt-1 font-sans text-[0.86rem] leading-[1.5] text-neutral-700">{c.v}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 overflow-hidden border border-black/10">
            <div className="grid grid-cols-4 divide-x divide-black/10 bg-white font-mono text-[0.64rem] tracking-[0.08em] uppercase">
              <div className="px-3 py-2.5 text-neutral-500">Bar requirement</div>
              <div className="col-span-3 px-3 py-2.5 text-neutral-700 font-mono text-[0.66rem] normal-case tracking-normal">What judges mean · how we meet it</div>
            </div>
            {[
              ["Explainable transactions", "Every agent action that touches money leaves a human-readable audit trail: what it did, why, which policy/price it consulted, what it cost.", "XAI Ledger event per action"],
              ["Real rails, not mocks", "Payments via Razorpay sandbox, real webhooks, real refunds - and real Supabase Auth (ES256 / JWKS) with per-merchant Postgres records.", "Razorpay test mode + JWKS auth + per-merchant DB"],
              ["Consent & guardrails", "Per-transaction consent (NPCI-style), spend caps, HITL above thresholds.", "Single-use consent + Policy Engine"],
              ["End-to-end demo", "Discovery → negotiation → consent → payment → receipt → refund, all live.", "Buyer ↔ Gateway ↔ Seller ↔ Razorpay"],
            ].map(([a, b, c]) => (
              <div key={a} className="grid grid-cols-1 sm:grid-cols-[1.2fr_1.8fr] gap-0 border-t border-black/10">
                <div className="px-4 py-3 bg-[#fcfcfa] border-b sm:border-b-0 sm:border-r border-black/5">
                  <div className="font-mono text-[0.66rem] tracking-[0.08em] uppercase text-[#111]">{a}</div>
                  <div className="mt-1 font-mono text-[0.62rem] tracking-[0.04em] uppercase text-emerald-700 bg-emerald-50 border border-emerald-100 inline-flex px-1.5 py-0.5 rounded">{c}</div>
                </div>
                <div className="px-4 py-3 font-sans text-[0.86rem] leading-[1.55] text-neutral-600">{b}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Workflow */}
        <div id="workflow" className="pt-14 scroll-mt-24">
          <div className="flex items-center gap-3">
            <span className="block w-3 h-3 bg-[#ff6900] flex-shrink-0" />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase text-neutral-500">Part 2 — Workflow</span>
          </div>
          <h2 className="font-serif text-[1.9rem] sm:text-[2.2rem] leading-[0.95] tracking-[-0.03em] text-[#111] mt-4">How a held fact becomes a paid order</h2>
          <p className="mt-3 font-sans text-[1.0rem] leading-[1.65] text-neutral-600">
            The same timing discipline from the Spurs example governs money. The agent may hold a valid quote while the system waits for the natural insertion point — consent, policy, HITL — then releases it exactly once.
          </p>
          <p className="mt-3 font-sans text-[1.0rem] leading-[1.65] text-neutral-600">
            Each step in the workflow is not just a UI state — it is a ledger event. The Buyer Agent discovers the merchant via <code className="font-mono text-[0.86rem] bg-black/5 px-1.5 py-0.5 border border-black/10">/.well-known/agents.json</code>, reads the machine-readable catalog, and initiates a quote request. The Seller Agent responds with a price computed from real catalog data, bounded negotiation rules, and margin floors. The Policy Engine validates both sides: the buyer&apos;s budget ceiling and the merchant&apos;s floor price. Only when both allow does the flow proceed to consent. The consent token is single-use, amount-bound, and expiring — it cannot be replayed, cannot exceed the amount, and cannot be reused after payment. If any gate fails, the flow stops gracefully with a structured explanation. Nothing is retried silently. Nothing is left ambiguous.
          </p>
          <PlainWords>
            Here is the whole purchase in one breath: an AI finds your store, asks for a price, haggles a little, gets a one-time permission token, pays through Razorpay, and every one of those steps is written down so you can replay it later. If a rule says no at any point, the flow stops — politely, with an explanation.
          </PlainWords>
          <WorkflowStepper />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-[0.66rem] leading-[1.5]">
            <div className="border border-black/10 bg-white px-3 py-3">
              <span className="text-neutral-400 uppercase tracking-[0.08em]">Invariant 1</span>
              <div className="mt-1 font-sans text-[0.84rem] leading-[1.45] text-[#111]">No float money — integer paise only, Pydantic-validated.</div>
            </div>
            <div className="border border-black/10 bg-white px-3 py-3">
              <span className="text-neutral-400 uppercase tracking-[0.08em]">Invariant 2</span>
              <div className="mt-1 font-sans text-[0.84rem] leading-[1.45] text-[#111]">Only Razorpay webhooks can mark PAID. LLM cannot.</div>
            </div>
            <div className="border border-black/10 bg-white px-3 py-3">
              <span className="text-neutral-400 uppercase tracking-[0.08em]">Invariant 3</span>
              <div className="mt-1 font-sans text-[0.84rem] leading-[1.45] text-[#111]">Single-use consent — consumed on payment, never reused.</div>
            </div>
          </div>
        </div>

        {/* Architecture */}
        <div id="architecture" className="pt-14 scroll-mt-24">
          <div className="flex items-center gap-3">
            <span className="block w-3 h-3 bg-[#0a0a0a] flex-shrink-0" />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase text-neutral-500">Part 3 — Architecture</span>
          </div>
          <h2 className="font-serif text-[1.9rem] sm:text-[2.2rem] leading-[0.95] tracking-[-0.03em] text-[#111] mt-4">Two agents and a trust layer</h2>
          <p className="mt-3 font-sans text-[1.0rem] leading-[1.65] text-neutral-600">
            Agents are orchestration and language surfaces; the Commerce Core owns authoritative business state and money invariants. The Trust Layer makes every decision replayable.
          </p>
          <PlainWords>
            Picture your shop with a new front door built for robots. Two AI workers (one buys, one sells) talk to each other; a strict rulebook and a cashier&apos;s desk (the Commerce Core) actually hold the till; and a security camera with a transcript (the Trust Layer) records every exchange.
          </PlainWords>

          {/* Hand-drawn (Excalidraw-style) diagrams — same style as
              ARCHITECTURE.md; fixed viewBoxes scale cleanly everywhere. */}
          <div className="mt-7 border border-black/10 bg-white overflow-hidden p-6">
            <div className="font-mono text-[0.62rem] tracking-[0.12em] uppercase text-neutral-400 mb-4">Architecture flow — how an AI buyer buys, start to PAID</div>
            <SketchArchitectureDiagram />
            <div className="mt-3 font-mono text-[0.6rem] leading-[1.5] text-neutral-400">Every arrow is one ledger event. Dashed = a gate that can say no. The LLM never touches payment directly.</div>
          </div>

          <div className="mt-4 border border-black/10 bg-white overflow-hidden p-6">
            <div className="font-mono text-[0.62rem] tracking-[0.12em] uppercase text-neutral-400 mb-4">The gate — the AI proposes, the rules decide</div>
            <SketchPolicyGateDiagram />
          </div>

          <div className="mt-7 border border-black/10 bg-white overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-0">
              <div className="px-6 py-6">
                <div className="font-mono text-[0.62rem] tracking-[0.12em] uppercase text-neutral-400">System map</div>
                <div className="mt-4 space-y-2.5">
                  {[
                    ["Human layer", "Buyer human · Merchant operator", "from-zinc-50 to-white"],
                    ["Agent layer", "Buyer Agent (LangGraph) ↔ Seller Agent (LangGraph)", "from-orange-50 to-white border-[#ff6900]/20"],
                    ["Gateway & Discovery", "agents.json · llms.txt · catalog.ai.json · HMAC auth", "from-sky-50 to-white"],
                    ["Commerce Core", "Catalog · Quote · Negotiation · Orders · Consent · Refunds", "from-violet-50 to-white"],
                    ["Policy & Trust", "Deterministic Policy Engine · XAI Ledger (append-only)", "from-emerald-50 to-white border-emerald-200"],
                    ["Payment Rail", "Razorpay adapter — Orders · Payment Links · Webhooks · Refunds", "from-neutral-50 to-white"],
                  ].map(([t, d]) => (
                    <div key={t} className="border border-black/10 bg-gradient-to-br from-white to-[#fcfcfa] px-4 py-3">
                      <div className="font-mono text-[0.66rem] tracking-[0.08em] uppercase text-[#111]">{t}</div>
                      <div className="font-sans text-[0.84rem] leading-[1.45] text-neutral-600">{d}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t lg:border-t-0 lg:border-l border-black/10 bg-[#fcfcfa] px-6 py-6">
                <div className="font-mono text-[0.62rem] tracking-[0.12em] uppercase text-neutral-400">Transaction state machine</div>
                <div className="mt-4 flex flex-wrap gap-2 font-mono text-[0.64rem]">
                  {["QUOTED", "AWAITING_CONSENT", "CONSENTED", "PAYMENT_PENDING", "PAID", "FULFILLED"].map((s, i) => (
                    <span key={s} className="inline-flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-full border ${i === 4 ? "bg-[#0a0a0a] text-white border-black" : i === 5 ? "bg-emerald-600 text-white border-emerald-700" : "bg-white text-[#111] border-black/15"}`}>{s}</span>
                      {i < 5 && <span className="text-neutral-300">→</span>}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 font-mono text-[0.62rem]">
                  <span className="px-2.5 py-1 rounded-full bg-amber-100 border border-amber-200 text-amber-800">PAYMENT_FAILED ↻ retry</span>
                  <span className="px-2.5 py-1 rounded-full bg-neutral-100 border border-black/10 text-neutral-600">ABORTED</span>
                  <span className="px-2.5 py-1 rounded-full bg-neutral-100 border border-black/10 text-neutral-600">REFUNDED</span>
                </div>
                <div className="mt-6 rounded-[10px] border border-black/10 bg-white p-4">
                  <div className="font-mono text-[0.62rem] tracking-[0.08em] uppercase text-neutral-400">Safety rails (deterministic, outside the LLM)</div>
                  <ul className="mt-2 space-y-1.5 font-mono text-[0.7rem] leading-[1.5] text-neutral-700">
                    <li className="flex gap-2"><span className="text-emerald-600">✓</span> Integer paise · no float arithmetic</li>
                    <li className="flex gap-2"><span className="text-emerald-600">✓</span> trace_id on every API call and ledger event</li>
                    <li className="flex gap-2"><span className="text-emerald-600">✓</span> Same idempotency_key → same payment attempt</li>
                    <li className="flex gap-2"><span className="text-emerald-600">✓</span> HMAC-SHA256 webhook verification</li>
                  </ul>
                </div>
                <div className="mt-4 font-mono text-[0.62rem] leading-[1.5] text-neutral-500">The LLM can phrase a counter-offer; it cannot set a price below the floor, exceed a budget, or mark an order PAID. Those are policy engine outputs.</div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="border border-black/10 bg-white p-5">
              <div className="font-mono text-[0.62rem] tracking-[0.12em] uppercase text-neutral-400">Seller Agent (LangGraph)</div>
              <div className="mt-2 font-sans text-[0.9rem] leading-[1.55] text-[#111]">search → quote → upsell → respond</div>
              <div className="mt-1 font-mono text-[0.7rem] leading-[1.5] text-neutral-500">Bounded by policy. Tools: catalog.search, quotes.create, quotes.negotiate, upsell.suggest. Only tool-returned products can be proposed.</div>
            </div>
            <div className="border border-black/10 bg-white p-5">
              <div className="font-mono text-[0.62rem] tracking-[0.12em] uppercase text-neutral-400">Buyer Agent (reference AI buyer)</div>
              <div className="mt-2 font-sans text-[0.9rem] leading-[1.55] text-[#111]">discover → research → request_quote → evaluate → pay</div>
              <div className="mt-1 font-mono text-[0.7rem] leading-[1.5] text-neutral-500">Maintains own budget_ceiling_paise. Proves the A2A loop is machine-to-machine, not a human-driven demo.</div>
            </div>
          </div>
        </div>

        {/* Tech stack */}
        <div id="stack" className="pt-14 scroll-mt-24">
          <div className="flex items-center gap-3">
            <span className="block w-3 h-3 bg-[#ff6900] flex-shrink-0" />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase text-neutral-500">Part 4 — Tech stack</span>
          </div>
          <h2 className="font-serif text-[1.9rem] sm:text-[2.2rem] leading-[0.95] tracking-[-0.03em] text-[#111] mt-4">What it’s built with, and why</h2>
          <p className="mt-3 font-sans text-[1.0rem] leading-[1.65] text-neutral-600">
            No speculative infrastructure. Every choice optimizes for a demonstrable hackathon vertical slice: deterministic commerce first, observability later.
          </p>
          <TechStackWhite />
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-[0.64rem]">
            <div className="border border-black/10 bg-[#0a0a0a] text-white px-4 py-4">
              <div className="tracking-[0.1em] uppercase text-white/60">Money</div>
              <div className="mt-1 font-sans text-[0.86rem] leading-[1.5] text-white">Integer paise · Pydantic models validate int on all money fields · static checks reject float amounts.</div>
            </div>
            <div className="border border-black/10 bg-white px-4 py-4">
              <div className="tracking-[0.1em] uppercase text-neutral-400">Discovery</div>
              <div className="mt-1 font-sans text-[0.86rem] leading-[1.5] text-[#111]">GET /.well-known/agents.json → manifest + capabilities. GET /catalog.ai.json → machine-readable product graph. GET /llms.txt → buyer instructions.</div>
            </div>
            <div className="border border-black/10 bg-white px-4 py-4">
              <div className="tracking-[0.1em] uppercase text-neutral-400">Deployment</div>
              <div className="mt-1 font-sans text-[0.86rem] leading-[1.5] text-[#111]">Docker · GitHub Actions (Python 3.11/3.12 matrix) · zrok v2 for Razorpay webhooks · Supabase Auth for merchants.</div>
            </div>
          </div>
        </div>

        {/* Policy engine deep dive */}
        <div className="pt-14">
          <div className="flex items-center gap-3">
            <span className="block w-3 h-3 bg-[#0a0a0a] flex-shrink-0" />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase text-neutral-500">Part 5 — Policy engine</span>
          </div>
          <h2 className="font-serif text-[1.7rem] sm:text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#111] mt-4">The LLM is not allowed to do math with money</h2>
          <p className="mt-3 font-sans text-[1.0rem] leading-[1.65] text-neutral-600">
            The Policy Engine is pure, LLM-independent, and testable without a model. It evaluates buyer budget and merchant constraints in the same call and returns
            <span className="font-mono text-[0.84rem] bg-black/5 border border-black/10 px-1 mx-1">ALLOW</span> /
            <span className="font-mono text-[0.84rem] bg-black/5 border border-black/10 px-1 mx-1">DENY(reason_code)</span> /
            <span className="font-mono text-[0.84rem] bg-black/5 border border-black/10 px-1 mx-1">NEEDS_HUMAN_APPROVAL</span>.
          </p>
          <p className="mt-3 font-sans text-[1.0rem] leading-[1.65] text-neutral-600">
            The engine is deterministic: given the same inputs, it always returns the same decision. This means it can be unit-tested without an LLM, debugged without a model, and audited without a prompt. The LLM&apos;s role is to <em className="text-[#111] font-medium">propose</em> — to phrase a counter-offer, to suggest an upsell, to present a quote. The engine&apos;s role is to <em className="text-[#111] font-medium">dispose</em> — to validate that the proposal falls within every guardrail. This separation is what makes the system explainable: every decision has a reason_code, every reason_code maps to a policy, and every policy is documented and testable.
          </p>
          <PlainWords>
            The AI is the talker; the rulebook is the bouncer. The rulebook never gets tired, never gets creative, and always explains its decision with a code you can look up.
          </PlainWords>

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ["OVER_BUDGET", "Cart exceeds buyer budget_ceiling_paise"],
              ["BELOW_FLOOR_PRICE", "Counter below SKU floor_paise"],
              ["CATEGORY_NOT_ALLOWED", "Cart category not in allowed_categories"],
              ["ABOVE_APPROVAL_THRESHOLD", "Amount exceeds HITL threshold → queue"],
              ["MAX_NEGOTIATION_ROUNDS", "Too many counter-offers"],
              ["DUPLICATE_UPSELL", "Upsell already offered this session"],
              ["ITEM_OVER_LIMIT", "Single item above max_single_item_paise"],
              ["CONSENT_INVALID", "Missing / expired / already consumed"],
            ].map(([code, desc]) => (
              <div key={code} className="border border-black/10 bg-white px-3 py-3">
                <div className="font-mono text-[0.62rem] tracking-[0.06em] font-semibold text-[#111]">{code}</div>
                <div className="mt-1 font-sans text-[0.76rem] leading-[1.45] text-neutral-600">{desc}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 border border-black/10 bg-[#fcfcfa] p-5">
            <div className="font-mono text-[0.62rem] tracking-[0.1em] uppercase text-neutral-500">Double-bound safety — both sides must allow</div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono text-[0.76rem]">
              <div className="border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="text-emerald-700 font-medium">Merchant allows ₹4,000 · Buyer budget ₹3,000 · Cart ₹3,500</div>
                <div className="mt-1 text-neutral-600">→ DENY · OVER_BUDGET · No Razorpay call · Ledger event + explanation.</div>
              </div>
              <div className="border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-amber-800 font-medium">Buyer allows ₹10,000 · Merchant allows ₹4,000 · Cart ₹6,000</div>
                <div className="mt-1 text-neutral-600">→ DENY · MERCHANT_POLICY_LIMIT · Agent is gated, not “well-behaved”.</div>
              </div>
            </div>
          </div>
        </div>

        {/* Consent & HITL */}
        <div className="pt-14">
          <div className="flex items-center gap-3">
            <span className="block w-3 h-3 bg-violet-600 flex-shrink-0" />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase text-neutral-500">Part 6 — Consent, HITL, and the graceful failure</span>
          </div>
          <h2 className="font-serif text-[1.7rem] sm:text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#111] mt-4">Gated. Single-use. Human-approvable. Idempotent.</h2>

          <div className="mt-4 font-sans text-[1.0rem] leading-[1.65] text-neutral-600">
            <p>
              Consent in NPCI&apos;s agent payment protocol is not a blanket authorization. It is a per-transaction, amount-bound, single-use token that expires if not consumed. This means the user (or their agent) must explicitly approve each payment, knowing the exact amount, payee, and purpose. The token cannot be reused, cannot be altered, and cannot exceed the authorized amount. If any condition changes — the cart total increases, the merchant changes, the scope expands — a new consent token is required.
            </p>
            <p>
              Human-in-the-loop (HITL) adds a second safety layer: orders above a configurable threshold (default ₹2,000) are routed to the merchant operator for manual approval before consent can proceed. This is not a UI nicety — it is a policy engine decision. The engine returns <code className="font-mono text-[0.86rem] bg-black/5 px-1.5 py-0.5 border border-black/10">NEEDS_HUMAN_APPROVAL</code> and the flow pauses until the operator acts. The operator sees the full context: order details, agent identity, policy evaluation, and the reason for escalation. They can approve, reject, or modify the order. This is the human-in-the-loop that NPCI&apos;s protocol requires for high-value transactions.
            </p>
            <PlainWords>
              Every payment needs its own one-time permission slip — no blanket &ldquo;charge me whenever&rdquo;. And if a cart is unusually expensive, the flow rings the shopkeeper: it waits for a real human to tap Approve before a single rupee moves.
            </PlainWords>
          </div>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="border border-black/10 bg-white p-5">
              <div className="font-mono text-[0.62rem] tracking-[0.1em] uppercase text-neutral-400">Consent</div>
              <div className="mt-2 font-sans text-[0.88rem] leading-[1.55] text-[#111]">Bound to order · exact amount · payee · purpose · expiry · single_use.</div>
              <pre className="mt-3 bg-[#0a0a0a] text-[#e8e8e5] p-3 font-mono text-[0.64rem] leading-[1.6] overflow-x-auto">{`{\n  "consent_id": "con_123",\n  "order_id": "ord_456",\n  "amount_paise": 185000,\n  "payee": "merchant_001",\n  "scope": "single_txn"\n}`}</pre>
            </div>
            <div className="border border-black/10 bg-white p-5">
              <div className="font-mono text-[0.62rem] tracking-[0.1em] uppercase text-neutral-400">HITL queue</div>
              <div className="mt-2 font-sans text-[0.88rem] leading-[1.55] text-[#111]">Order above approval threshold → NEEDS_HUMAN_APPROVAL → console card → approve/reject → consent continues or aborts.</div>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-100 border border-amber-200 px-3 py-1.5 font-mono text-[0.64rem] text-amber-800">Threshold: ₹2,000 · Order: ₹5,200 → Approval required</div>
            </div>
            <div className="border border-black/10 bg-white p-5">
              <div className="font-mono text-[0.62rem] tracking-[0.1em] uppercase text-neutral-400">Failure path</div>
              <div className="mt-2 font-sans text-[0.88rem] leading-[1.55] text-[#111]">payment.attempted → payment.failed → classify → bounded retry OR abort → ledger + structured response.</div>
              <div className="mt-3 font-mono text-[0.64rem] leading-[1.6] text-neutral-600">Never: silent retry storm, stack trace to buyer, or ambiguous PAID.</div>
            </div>
          </div>
        </div>

        {/* Ledger */}
        <div className="pt-14">
          <div className="flex items-center gap-3">
            <span className="block w-3 h-3 bg-emerald-600 flex-shrink-0" />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase text-neutral-500">Part 7 — Trust layer</span>
          </div>
          <h2 className="font-serif text-[1.7rem] sm:text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#111] mt-4">The ledger is the winning slide</h2>
          <p className="mt-3 font-sans text-[1.0rem] leading-[1.65] text-neutral-600">
            The bar says <em className="text-[#111] font-medium">&quot;every money action must be explainable&quot;</em>. The ledger makes that a data structure, not a slide. Each event answers: who acted, what they attempted, what inputs were used, which policy fired, what changed, why.
          </p>
          <p className="mt-3 font-sans text-[1.0rem] leading-[1.65] text-neutral-600">
            The XAI Ledger is append-only and immutable. Every event — from catalog search to payment confirmation — is recorded with a unique <code className="font-mono text-[0.86rem] bg-black/5 px-1.5 py-0.5 border border-black/10">trace_id</code> that links all actions in a single transaction. The event schema includes: <code className="font-mono text-[0.82rem] bg-black/5 px-1 py-0.5 border border-black/10">actor</code> (who initiated), <code className="font-mono text-[0.82rem] bg-black/5 px-1 py-0.5 border border-black/10">action</code> (what was attempted), <code className="font-mono text-[0.82rem] bg-black/5 px-1 py-0.5 border border-black/10">inputs</code> (what data was used), <code className="font-mono text-[0.82rem] bg-black/5 px-1 py-0.5 border border-black/10">output</code> (what decision was made), <code className="font-mono text-[0.82rem] bg-black/5 px-1 py-0.5 border border-black/10">reasoning_summary</code> (plain-English explanation), and <code className="font-mono text-[0.82rem] bg-black/5 px-1 py-0.5 border border-black/10">policy_refs</code> (which rules were consulted). This is not optional logging — it is the core of the trust architecture. Without it, an autonomous agent spending money is unauditable. With it, every rupee has a story.
          </p>
          <PlainWords>
            Think of it as a till receipt for decisions, not just for money. For every step you can ask: who did it, what exactly happened, which rule applied, and why — and the answer is stored forever, in order.
          </PlainWords>
          <LedgerTimelineWhite />
        </div>

        {/* Growth */}
        <div className="pt-14">
          <div className="flex items-center gap-3">
            <span className="block w-3 h-3 bg-amber-500 flex-shrink-0" />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase text-neutral-500">Part 8 — Growth, but honest</span>
          </div>
          <h2 className="font-serif text-[1.7rem] sm:text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#111] mt-4">Revenue without a separate marketing product</h2>
          <p className="mt-3 font-sans text-[1.0rem] leading-[1.65] text-neutral-600">
            The growth story is not a separate product — it emerges from the same transaction infrastructure. When an AI buyer discovers a merchant through <code className="font-mono text-[0.86rem] bg-black/5 px-1.5 py-0.5 border border-black/10">agents.json</code>, negotiates within policy, and pays via Razorpay, the merchant gains a new revenue channel that was previously invisible. The &quot;growth&quot; is not about adding marketing features — it is about making the merchant discoverable to a new class of buyer that did not exist before.
          </p>
          <PlainWords>
            You don&apos;t have to run ads to get this growth. The moment an AI shopper can find, haggle with, and pay your store, you have a new kind of customer — and the same transaction already does the upselling and the discount-limit enforcement for you.
          </PlainWords>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ["Contextual upsell", "At most 1/session, catalog-verified, stock-checked, budget-checked. With a concise why.", "₹5,100 → +₹100 desk mat = ₹5,200"],
              ["Negotiation that protects margin", "Agent counters within floor and discount limits; walks away gracefully if floor reached.", "Floor ₹4,900 · counters: ₹5,700 → ₹5,400 → ₹5,100"],
              ["Insights that are actually useful", "Upsell attach rate · saved vs abandoned deals · avg discount · walk-away reasons.", "Not a full campaign platform — a focused P1."],
            ].map(([t, d, e]) => (
              <div key={t} className="border border-black/10 bg-white p-5">
                <div className="font-mono text-[0.62rem] tracking-[0.1em] uppercase text-neutral-400">{t}</div>
                <div className="mt-2 font-sans text-[0.86rem] leading-[1.55] text-neutral-700">{d}</div>
                <div className="mt-3 font-mono text-[0.66rem] leading-[1.5] text-[#111] bg-[#fcfcfa] border border-black/5 px-2.5 py-1.5">{e}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Demo scenes */}
        <div className="pt-14">
          <div className="flex items-center gap-3">
            <span className="block w-3 h-3 bg-[#ff6900] flex-shrink-0" />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase text-neutral-500">Part 9 — Demo (6 scenes, one story)</span>
          </div>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              ["01 · Discover", "Buyer reads agents.json + catalog.ai.json — prove the merchant is AI-findable, not just SEO-findable."],
              ["02 · Negotiate + upsell", "Search → quote → bounded negotiation → one relevant add-on. LLM chooses words, policy chooses legality."],
              ["03 · Safety gate", "Exceed a limit on purpose → Policy DENY or NEEDS_HUMAN_APPROVAL → no Razorpay call. The agent is gated."],
              ["04 · Real payment", "Consent → Razorpay (test mode) → HMAC webhook → order PAID → receipt."],
              ["05 · Failure", "Trigger a reproducible test-mode failure → classify → bounded retry or abort → structured explanation."],
              ["06 · Replay", "Open the Merchant Console timeline: every step, every policy_ref, every provider_ref in one trace."],
            ].map(([h, d]) => (
              <div key={h} className="border border-black/10 bg-white px-5 py-4 hover:border-black/20 transition-colors">
                <div className="font-mono text-[0.64rem] tracking-[0.1em] uppercase text-[#111]">{h}</div>
                <div className="mt-1 font-sans text-[0.86rem] leading-[1.55] text-neutral-600">{d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Part 10 — Production hardening */}
        <div className="pt-14">
          <div className="flex items-center gap-3">
            <span className="block w-3 h-3 bg-[#ff6900] flex-shrink-0" />
            <span className="font-mono text-[0.7rem] tracking-[0.16em] uppercase text-neutral-500">Part 10 - Production hardening (real users, real stores)</span>
          </div>
          <p className="mt-4 max-w-[70ch] font-sans text-[0.95rem] leading-[1.65] text-neutral-700">
            A demo that fakes its own auth is a toy. The console now runs on real Supabase Auth
            with asymmetric ES256 session tokens verified against the project&apos;s JWKS - and
            every authenticated user gets their own real merchant record, not a shared demo
            store. The demo store still exists, but as an actual database row used by the
            agent-to-agent surface - never as a fallback for a human login.
          </p>
          <PlainWords>
            Most demo apps share one fake login. This one gives every real person their own real store with their own products, orders, and ledger — like actual software, not a stage prop.
          </PlainWords>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ["01 - Identity is verified, authorization is separate", "Signature, expiry, issuer and audience are checked against the JWKS (kid-matched, rotation-aware). Then the user id is resolved through merchant_users to their own store. No row means onboarding - never silent demo access."],
              ["02 - Every store is a real row", "merchants, catalog_products, policy, orders and the ledger are per-merchant database records. Catalog persists across restarts. The console shows only your rows; a foreign order id is a 404."],
              ["03 - No mock paths in production", "The browser authenticates with the merchant JWT end-to-end - quote, order, consent, Razorpay test-mode payment. The LLM adapter reports its real state (connected / degraded / error). If a component fails, the dashboard says so."],
            ].map(([h, d]) => (
              <div key={h} className="border border-black/10 bg-white px-5 py-4 hover:border-black/20 transition-colors">
                <div className="font-mono text-[0.64rem] tracking-[0.1em] uppercase text-[#111]">{h}</div>
                <div className="mt-1 font-sans text-[0.86rem] leading-[1.55] text-neutral-600">{d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Safety invariants table */}
        <div className="pt-14">
          <h3 className="font-serif text-[1.35rem] leading-[0.98] tracking-[-0.02em] text-[#111]">Safety invariants — encoded as tests</h3>
          <div className="mt-4 border border-black/10 overflow-hidden">
            {[
              ["Money", "No LLM call can directly execute payment  No payment if policy = DENY  No price below floor  No order above hard limits"],
              ["Agent", "Cannot invent SKU  Cannot create arbitrary prices  Cannot alter policy  Cannot mark PAID  Cannot skip consent/HITL"],
              ["Auth", "ES256 signature verified against JWKS  Authentication and merchant authorization are separate  No auto-linking to a demo store  Console data is scoped per merchant"],
              ["Webhook", "Signature must verify  Unknown order must not mutate state  Duplicate webhook is idempotent"],
              ["Audit", "Every money event has a ledger event + reason_code + trace_id  Failures are visible in replay"],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-0 border-t first:border-t-0 border-black/10">
                <div className="px-4 py-3 bg-[#fcfcfa] font-mono text-[0.66rem] tracking-[0.1em] uppercase text-neutral-500 border-b sm:border-b-0 sm:border-r border-black/5">{k}</div>
                <div className="px-4 py-3 font-sans text-[0.86rem] leading-[1.55] text-neutral-700">{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Closing */}
        <div className="pt-12 pb-4">
          <div className="border border-black/10 bg-[#0a0a0a] text-white p-6 sm:p-8 overflow-hidden relative">
            <div className="relative">
              <div className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-white/50">Closing — what the white page wanted to teach</div>
              <p className="mt-3 font-serif text-[1.45rem] sm:text-[1.7rem] leading-[0.96] tracking-[-0.03em] text-white text-balance">
                A held fact is not a hidden fact. It is a timed fact.
              </p>
              <p className="mt-3 max-w-[60ch] font-sans text-[0.95rem] leading-[1.65] text-white/70">
                In writing, timing is craft. In commerce, timing is safety. SELLABLE holds every money-relevant fact — quote, floor, consent, refund — until the policy engine says the sentence is ready for it. That is the whole case study in one interaction pattern.
              </p>
              <p className="mt-3 max-w-[60ch] font-sans text-[0.95rem] leading-[1.65] text-white/70">
                The merchant side of agentic commerce is not about building a chatbot or adding an API endpoint. It is about rebuilding the merchant&apos;s interface for a new class of buyer — one that reads machine-readable manifests, negotiates within deterministic policy, pays through real rails with real consent, and leaves an audit trail that explains every rupee. This is infrastructure, not features. And it is what makes a merchant truly sellable.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-mono text-[0.72rem] tracking-[0.11em] uppercase hover:bg-gray-100 transition-colors">
                  <span className="text-black">Open Merchant Console</span>
                </Link>
                <a href="https://github.com/mahirmlk/sellable" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-transparent px-5 py-3 font-mono text-[0.72rem] tracking-[0.11em] uppercase hover:bg-white/10 transition-colors">
                  <span className="text-white">Read the repo</span>
                </a>
              </div>
              <div className="mt-4 font-mono text-[0.62rem] tracking-[0.06em] uppercase text-white/40">Every money action is audit-logged. Every hold has a reason. Every insertion has an anchor.</div>
            </div>
          </div>
          <div className="mt-6 flex items-center justify-between gap-4 font-mono text-[0.62rem] tracking-[0.06em] uppercase text-neutral-400 border-t border-black/10 pt-4">
            <span>© 2026 SELLABLE — Agentic commerce infrastructure</span>
            <Link href="/" className="hover:text-[#111]">← Back to dark site</Link>
          </div>
        </div>
      </main>

      {/* light footer watermark */}
      <div className="pointer-events-none select-none overflow-hidden border-t border-black/10 bg-white">
        <div className="mx-auto max-w-[1120px] px-6 sm:px-8 py-2">
          <div className="font-serif text-[clamp(3.5rem,9vw,8rem)] font-black leading-none tracking-[-0.07em] text-black/[0.035] whitespace-nowrap">SELLABLE</div>
        </div>
      </div>
    </div>
  );
}
