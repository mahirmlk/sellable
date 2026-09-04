"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { RefreshCw, Radio, Play, X, Wallet, ShieldAlert, ExternalLink, History } from "lucide-react";
import { ActorBadge, ActorIcon } from "@/components/dashboard/actor-badge";
import { formatTimestamp, formatPaise } from "@/lib/formatters";
import { type ActorType, type LedgerEvent } from "@/lib/types/domain";
import {
  getConsoleEvents,
  streamConsoleEvents,
  consoleRunBuyerMission,
  getConsoleTransactionDetail,
  consoleStartPayment,
  continueBuyerMission,
  listBuyerMissions,
  simulatePaymentCapture,
  getConsolePolicy,
  getConsoleCatalogItem,
  type BuyerResultPayload,
  type ConsoleTransactionDetail,
  type ConsolePolicySettings,
  type Product,
} from "@/lib/api";

const actorFilters: { label: string; value: ActorType | "all" }[] = [
  { label: "All Actors", value: "all" },
  { label: "Buyer Agent", value: "buyer_agent" },
  { label: "Seller Agent", value: "seller_agent" },
  { label: "Policy Engine", value: "policy_engine" },
  { label: "Consent Service", value: "consent_service" },
  { label: "Human", value: "human" },
  { label: "Razorpay", value: "razorpay" },
  { label: "Commerce Core", value: "commerce_core" },
];

const eventTypeFilters = [
  "All Events",
  "catalog.search",
  "quote.created",
  "negotiation.*",
  "upsell.*",
  "policy.*",
  "consent.*",
  "payment.*",
  "order.*",
];

const DEMO_MODE = process.env.NEXT_PUBLIC_AGENT_KEY === "sellable_demo_key_001";
const ORDER_TERMINAL = ["PAID", "FULFILLED", "PAYMENT_FAILED", "ABORTED", "REFUNDED"];

interface MissionFormState {
  mission: string;
  budget: string;
  buyer: string;
  purpose: string;
  sku: string;
  quantity: string;
  offer: string;
  categories: string;
  upsell: boolean;
}

const EMPTY_MISSION: MissionFormState = {
  mission: "",
  budget: "",
  buyer: "buyer_demo_01",
  purpose: "",
  sku: "",
  quantity: "1",
  offer: "",
  categories: "",
  upsell: true,
};

/** Real state chips derived ONLY from backend output — never animated. */
function missionSteps(
  result: BuyerResultPayload | null,
  offerProvided: boolean,
  detail: ConsoleTransactionDetail | null
): { label: string; tone: "done" | "wait" | "block" }[] {
  if (!result) return [];
  const steps = result.steps ?? [];
  const round = result.seller_decision?.cart?.negotiation_round ?? 0;
  const verdict = result.seller_decision?.policy_decision?.verdict ?? null;
  const out: { label: string; tone: "done" | "wait" | "block" }[] = [];
  const done = (label: string) => out.push({ label, tone: "done" });
  const blocked = (label: string) => out.push({ label, tone: "block" });
  if (steps.includes("DISCOVER")) done("DISCOVERED");
  if (steps.includes("RESEARCH")) done("RESEARCHED");
  if (steps.includes("REQUEST_QUOTE")) done("QUOTE RECEIVED");
  if (offerProvided && round > 0) done("NEGOTIATED");
  if (verdict) done(`POLICY ${verdict}`);
  if (result.action === "NEEDS_HUMAN_APPROVAL") blocked("APPROVAL REQUIRED");
  else if (result.action === "READY_FOR_CONSENT") done("READY");
  else if (result.action === "DENIED") blocked("DENIED");
  else if (result.action === "NO_MATCH") blocked("NO MATCH");
  if (result.order_id) done("ORDER");
  if (detail) {
    if (detail.status === "PAYMENT_PENDING") done("PAYMENT");
    if (detail.status === "PAID" || detail.status === "FULFILLED") done("VERIFIED");
    if (detail.status === "PAYMENT_FAILED" || detail.status === "ABORTED") blocked("STOPPED");
  }
  if (result.consent_id || detail?.consent_status === "ISSUED" || detail?.consent_status === "CONSUMED") done("CONSENT");
  return out;
}

function mapEvent(e: { event_id: string; trace_id: string; timestamp: string; actor: string; action: string; inputs: Record<string, unknown>; output: Record<string, unknown>; reasoning_summary: string | null; policy_refs: string[]; outcome_effect: Record<string, unknown> | null; provider_ref: string | null; flags: string[] }): LedgerEvent {
  return {
    eventId: e.event_id,
    traceId: e.trace_id,
    timestamp: e.timestamp,
    actor: e.actor as ActorType,
    action: e.action,
    inputs: e.inputs,
    output: e.output,
    reasoningSummary: e.reasoning_summary ?? undefined,
    policyRefs: e.policy_refs,
    outcome_effect: e.outcome_effect ?? null,
    provider_ref: e.provider_ref ?? null,
    flags: e.flags,
  };
}

interface MissionHistoryItem {
  traceId: string;
  mission: string;
  budgetPaise: number | null;
  timestamp: string;
  orderId: string | null;
  held: boolean;
  amountPaise: number | null;
  paid: boolean;
}

/**
 * Derive recent buyer missions from the ledger events already loaded in the
 * feed: one entry per `buyer.mission_received` trace, joined with the order
 * the mission produced (`buyer.order_requested` / `buyer.order_held`) and
 * its payment outcome. Two passes on purpose: the feed is newest-first, so
 * the order/payment events appear ABOVE the mission event — a single pass
 * saw `buyer.order_held` before its mission existed and dropped it, which
 * rendered resumable missions as "NO ORDER".
 */
function deriveMissionHistory(events: LedgerEvent[]): MissionHistoryItem[] {
  const byTrace = new Map<string, MissionHistoryItem>();
  for (const e of events) {
    if (e.action !== "buyer.mission_received") continue;
    const out = (e.output ?? {}) as Record<string, unknown>;
    byTrace.set(e.traceId, {
      traceId: e.traceId,
      mission:
        (e.reasoningSummary ?? "").replace(/^Received a buyer mission:\s*/, "").trim() || "—",
      budgetPaise: typeof out.budget_ceiling_paise === "number" ? out.budget_ceiling_paise : null,
      timestamp: e.timestamp,
      orderId: null,
      held: false,
      amountPaise: null,
      paid: false,
    });
  }
  for (const e of events) {
    const item = byTrace.get(e.traceId);
    if (!item) continue;
    if (e.action === "buyer.order_requested" || e.action === "buyer.order_held") {
      const out = (e.output ?? {}) as Record<string, unknown>;
      if (typeof out.order_id === "string") item.orderId = out.order_id;
      if (typeof out.amount_paise === "number") item.amountPaise = out.amount_paise;
      item.held = e.action === "buyer.order_held";
    } else if (e.action === "payment.captured" || e.action === "order.paid") {
      item.paid = true;
    }
  }
  return [...byTrace.values()];
}

export default function ActivityPage() {
  const [actorFilter, setActorFilter] = useState<ActorType | "all">("all");
  const [typeFilter, setTypeFilter] = useState("All Events");
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [streamMode, setStreamMode] = useState<"live" | "polling" | "offline">("polling");
  const [runningMission, setRunningMission] = useState(false);
  const [missionMsg, setMissionMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Real interactive buyer mission (no hardcoded scenario).
  const [missionFormOpen, setMissionFormOpen] = useState(false);
  const [missionForm, setMissionForm] = useState<MissionFormState>(EMPTY_MISSION);
  const [missionResult, setMissionResult] = useState<BuyerResultPayload | null>(null);
  const [missionOfferGiven, setMissionOfferGiven] = useState(false);
  const [missionOrderDetail, setMissionOrderDetail] = useState<ConsoleTransactionDetail | null>(null);
  const missionPollRef = useRef<number | null>(null);
  const missionPollDeadlineRef = useRef<number>(0);
  const seenIds = useRef<Set<string>>(new Set());
  // Merchant policy context: prefills the mission form's categories and shows
  // the real floor/HITL caps next to it (same source the chat panel uses).
  const [policy, setPolicy] = useState<ConsolePolicySettings | null>(null);
  const [resumingTrace, setResumingTrace] = useState<string | null>(null);

  useEffect(() => {
    getConsolePolicy().then(setPolicy).catch(() => {
      // Policy context is additive — the form still works with defaults.
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Bounded initial window (backend pagination intact): the feed shows
      // the recent operational slice; the live stream appends from there.
      const data = await getConsoleEvents(100);
      if (data.events) {
        const mapped = data.events.map(mapEvent);
        for (const e of mapped) seenIds.current.add(e.eventId);
        setEvents(mapped);
      }
    } catch (err) {
      setLoadError(
        err instanceof TypeError
          ? "Backend unreachable — the activity feed could not be loaded."
          : "Activity feed could not be loaded from the backend."
      );
    } finally { setLoading(false); }
  }, []);

  // Strictly sequenced lifecycle: bounded initial load FIRST (rendered),
  // then exactly one live stream. The stream client owns bounded reconnects;
  // this page owns at most one 5s polling fallback, started only after the
  // initial load has settled and only when the stream reports failure.
  const streamLiveRef = useRef(false);
  const initialDoneRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | null = null;
    let stopStream: (() => void) | null = null;

    const startPolling = () => {
      // Single-poller invariant: never a second interval while one exists,
      // never before the initial load settles, never after unmount.
      if (pollTimer !== null || cancelled || !initialDoneRef.current) return;
      pollTimer = window.setInterval(async () => {
        try {
          const data = await getConsoleEvents(20);
          if (cancelled) return;
          if (data.events) {
            // Backend is newest-first: filter unseen, then prepend in the
            // same order. (Reversing here used to flip fresh batches
            // oldest-first after every reconnect.)
            const fresh = data.events.map(mapEvent).filter((e) => !seenIds.current.has(e.eventId));
            for (const e of fresh) seenIds.current.add(e.eventId);
            if (fresh.length > 0) setEvents((prev) => [...fresh, ...prev].slice(0, 500));
          }
        } catch {}
      }, 5000);
    };

    (async () => {
      await fetchData();
      if (cancelled) return;
      initialDoneRef.current = true;
      if (streamLiveRef.current) return; // never two concurrent streams
      streamLiveRef.current = true;
      stopStream = streamConsoleEvents({
        onEvent: (event) => {
          setStreamMode("live");
          if (seenIds.current.has(event.event_id)) return;
          seenIds.current.add(event.event_id);
          setEvents((prev) => [mapEvent(event), ...prev].slice(0, 500));
        },
        onError: () => {
          setStreamMode("polling");
          startPolling();
        },
      });
    })();

    return () => {
      cancelled = true;
      streamLiveRef.current = false;
      if (stopStream) stopStream();
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  }, [fetchData]);

  const stopMissionPoll = useCallback(() => {
    if (missionPollRef.current !== null) {
      window.clearInterval(missionPollRef.current);
      missionPollRef.current = null;
    }
  }, []);

  useEffect(() => stopMissionPoll, [stopMissionPoll]);

  /** Read the authoritative order state for the mission's order (read-only). */
  const pollMissionOrder = useCallback(
    (orderId: string) => {
      stopMissionPoll();
      missionPollDeadlineRef.current = Date.now() + 5 * 60 * 1000;
      const timer = window.setInterval(async () => {
        if (Date.now() > missionPollDeadlineRef.current) {
          stopMissionPoll();
          return;
        }
        try {
          const detail = await getConsoleTransactionDetail(orderId);
          setMissionOrderDetail(detail);
          if (ORDER_TERMINAL.includes(detail.status)) stopMissionPoll();
        } catch {
          // transient network errors are tolerated while polling
        }
      }, 2500);
      missionPollRef.current = timer;
    },
    [stopMissionPoll]
  );

  const parsePaise = (rupees: string): number | null => {
    const n = parseFloat(rupees);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  };

  const handleRunMission = useCallback(async () => {
    if (runningMission) return;
    const missionText = missionForm.mission.trim();
    if (!missionText) {
      setMissionMsg({ kind: "error", text: "Describe the mission first." });
      return;
    }
    const budget = parsePaise(missionForm.budget);
    if (budget === null) {
      setMissionMsg({ kind: "error", text: "Enter a positive budget amount in rupees." });
      return;
    }
    setRunningMission(true);
    setMissionMsg(null);
    setMissionResult(null);
    setMissionOrderDetail(null);
    stopMissionPoll();
    const categories = missionForm.categories
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    const quantity = Math.max(1, Math.round(parseFloat(missionForm.quantity) || 1));
    const offer = parsePaise(missionForm.offer);
    setMissionOfferGiven(offer !== null);
    // Empty categories now mean the merchant's real policy categories —
    // the old hardcoded trio only applies when the policy is unreachable.
    const policyCategories = (policy?.allowed_categories ?? [])
      .map((c) => c.toLowerCase())
      .filter(Boolean);
    try {
      const result = await consoleRunBuyerMission({
        buyer_agent_id: missionForm.buyer.trim() || "buyer_demo_01",
        message: missionText,
        budget_ceiling_paise: budget,
        allowed_categories:
          categories.length > 0
            ? categories
            : policyCategories.length > 0
              ? policyCategories
              : ["accessories", "gifting", "snacks"],
        purpose: missionForm.purpose.trim() || missionText.slice(0, 280),
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        request_upsell: missionForm.upsell,
        requested_sku: missionForm.sku.trim() || null,
        quantity,
        buyer_offer_paise: offer,
      });
      setMissionResult(result);
      setMissionMsg(
        result.action === "READY_FOR_CONSENT"
          ? { kind: "success" as const, text: "Buyer mission completed — every step below is real backend state." }
          : { kind: "success" as const, text: `Buyer mission stopped at ${result.action.replace(/_/g, " ")}.` }
      );
      if (result.order_id) pollMissionOrder(result.order_id);
      fetchData();
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : "unknown error";
      setMissionMsg({ kind: "error", text: `Buyer mission failed: ${detail}` });
    } finally {
      setRunningMission(false);
    }
  }, [fetchData, runningMission, missionForm, pollMissionOrder, stopMissionPoll, policy]);

  const handleMissionPayment = useCallback(async () => {
    const result = missionResult;
    if (!result?.order_id || !missionOrderDetail) return;
    // Preferred path: the backend continuation re-verifies the order,
    // reuses/issues consent, and starts payment through the existing
    // PaymentService — idempotent under repeated clicks/refreshes.
    if (result.mission_id) {
      try {
        const mission = await continueBuyerMission(result.mission_id);
        if (mission.state === "NEEDS_HUMAN_APPROVAL") {
          setMissionMsg({ kind: "error", text: "Merchant approval is required before payment." });
        } else {
          setMissionMsg({ kind: "success", text: `Mission continued — state is now ${mission.state.replace(/_/g, " ")}.` });
        }
        pollMissionOrder(result.order_id);
      } catch (err) {
        const detail = err instanceof Error && err.message ? err.message : "unknown error";
        setMissionMsg({ kind: "error", text: `Mission could not be continued: ${detail}` });
      }
      return;
    }
    // Legacy fallback for runs persisted before missions existed.
    const consentId = missionOrderDetail.consent_id;
    if (!consentId || missionOrderDetail.consent_status !== "ISSUED") return;
    try {
      await consoleStartPayment(result.order_id, consentId);
      pollMissionOrder(result.order_id);
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : "unknown error";
      setMissionMsg({ kind: "error", text: `Payment could not be started: ${detail}` });
    }
  }, [missionResult, missionOrderDetail, pollMissionOrder]);

  const handleMissionSimulate = useCallback(async () => {
    const orderId = missionResult?.order_id;
    if (!orderId) return;
    try {
      await simulatePaymentCapture(orderId);
      pollMissionOrder(orderId);
    } catch {
      // backend may reject the simulation; polling reflects real state
    }
  }, [missionResult, pollMissionOrder]);

  const missionHistory = useMemo(() => deriveMissionHistory(events), [events]);

  /**
   * Resume a past mission to its order: rebuild the result panel from the
   * authoritative order + the trace's own ledger events, then continue the
   * lifecycle exactly where it stopped (payment, approval, replay).
   */
  const handleResumeMission = useCallback(
    async (item: MissionHistoryItem) => {
      if (!item.orderId || resumingTrace) return;
      setResumingTrace(item.traceId);
      try {
        const detail = await getConsoleTransactionDetail(item.orderId);
        const evs = detail.events ?? [];
        const has = (action: string) => evs.some((e) => e.action === action);
        const steps: string[] = [];
        if (has("buyer.mission_received") || has("buyer.discovered_merchant")) steps.push("DISCOVER");
        if (has("buyer.catalog_researched")) steps.push("RESEARCH");
        if (has("quote.created") || has("quote.received")) steps.push("REQUEST_QUOTE");
        const items = detail.items ?? [];
        const cart = items.length > 0
          ? {
              mandate_id: "",
              intent_ref: "",
              items: items.map((it) => ({
                sku: it.sku,
                quantity: it.quantity,
                unit_price_paise: it.unit_price_paise,
                offered_price_paise: it.offered_price_paise,
                line_total_paise: it.line_total_paise,
              })),
              subtotal_paise: detail.amount_paise,
              discount_paise: 0,
              total_paise: detail.amount_paise,
              upsell_offered: false,
              upsell_rationale: null,
              negotiation_round: 0,
            }
          : null;
        // Product title for the resumed card (best-effort; SKU already shows).
        let selectedProduct: Product | null = null;
        try {
          if (items[0]?.sku) selectedProduct = await getConsoleCatalogItem(items[0].sku);
        } catch {}
        const action: BuyerResultPayload["action"] =
          detail.status === "ABORTED" || detail.status === "PAYMENT_FAILED"
            ? "DENIED"
            : detail.policy_verdict === "NEEDS_HUMAN_APPROVAL" && !detail.consent_id
              ? "NEEDS_HUMAN_APPROVAL"
              : "READY_FOR_CONSENT";
        const resumed: BuyerResultPayload = {
          trace_id: detail.trace_id,
          action,
          buyer_summary: `Resumed from the ledger — mission restored for trace ${detail.trace_id}. The lifecycle continues from the authoritative order.`,
          merchant_manifest: {},
          seller_decision: cart
            ? {
                trace_id: detail.trace_id,
                action: "QUOTE_READY",
                response_message: "",
                cart,
                policy_decision: null,
                selected_product: selectedProduct,
                upsell_product: null,
                tool_calls: [],
              }
            : null,
          order_id: detail.order_id,
          consent_id: detail.consent_id ?? null,
          mission_id: null,
          steps,
        };
        // Re-attach the persisted mission id (if any) so the resumed panel
        // can use the server-side continuation instead of frontend-only
        // state. Best-effort: older runs may have no mission row.
        try {
          const missions = await listBuyerMissions();
          const match = missions.find((m) => m.order_id === detail.order_id);
          if (match) resumed.mission_id = match.mission_id;
        } catch {}
        setMissionResult(resumed);
        setMissionOfferGiven(false);
        setMissionOrderDetail(detail);
        if (!ORDER_TERMINAL.includes(detail.status)) pollMissionOrder(detail.order_id);
        setMissionMsg({
          kind: "success",
          text: `Mission resumed — order ${detail.order_id} restored from the ledger (${detail.status}).`,
        });
      } catch (err) {
        const detailText = err instanceof Error && err.message ? err.message : "unknown error";
        setMissionMsg({ kind: "error", text: `Mission could not be resumed: ${detailText}` });
      } finally {
        setResumingTrace(null);
      }
    },
    [pollMissionOrder, resumingTrace]
  );

  const filtered = events.filter((e) => {
    if (actorFilter !== "all" && e.actor !== actorFilter) return false;
    if (typeFilter !== "All Events" && !e.action.startsWith(typeFilter.replace(".*", ""))) return false;
    return true;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Activity</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">REAL-TIME OPERATIONAL FEED</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)]">
            <Radio size={12} className={streamMode === "live" ? "text-green-400 animate-[blink_2s_ease-in-out_infinite]" : streamMode === "polling" ? "text-yellow-400" : "text-red-400"} />
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
              {streamMode === "live" ? "LIVE" : streamMode === "polling" ? "POLLING" : "OFFLINE"}
            </span>
          </div>
          <button onClick={() => setMissionFormOpen((v) => !v)} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-orange)]/40 bg-[var(--bb-orange)]/10 font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:bg-[var(--bb-orange)]/20 transition-all cursor-pointer">
            {missionFormOpen ? <X size={12} /> : <Play size={12} />} {missionFormOpen ? "CLOSE MISSION" : "NEW BUYER MISSION"}
          </button>
          <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
          </button>
        </div>
      </div>

      {missionFormOpen && (
        <div className="border border-[var(--bb-orange)]/30 bg-[var(--bb-panel)] p-5 stagger-child">
          <div className="flex items-center gap-2 mb-4">
            <Play size={13} className="text-[var(--bb-orange)]" />
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-orange)]">NEW BUYER MISSION</span>
            <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-3)] ml-2">runs the real Buyer Agent against your store</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="md:col-span-2 flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">MISSION *</span>
              <textarea
                value={missionForm.mission}
                onChange={(e) => setMissionForm((f) => ({ ...f, mission: e.target.value }))}
                placeholder="I need an ergonomic office chair for my home office"
                rows={2}
                className="font-[var(--font-sans)] text-[0.8rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">BUDGET (₹) *</span>
              <input
                type="number"
                min="1"
                value={missionForm.budget}
                onChange={(e) => setMissionForm((f) => ({ ...f, budget: e.target.value }))}
                placeholder="15000"
                className="font-[var(--font-mono)] text-[0.72rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 tabular-nums focus:outline-none focus:border-[var(--bb-orange)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">BUYER IDENTITY</span>
              <input
                value={missionForm.buyer}
                onChange={(e) => setMissionForm((f) => ({ ...f, buyer: e.target.value }))}
                className="font-[var(--font-mono)] text-[0.72rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 focus:outline-none focus:border-[var(--bb-orange)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">PURPOSE</span>
              <input
                value={missionForm.purpose}
                onChange={(e) => setMissionForm((f) => ({ ...f, purpose: e.target.value }))}
                placeholder="defaults to the mission text"
                className="font-[var(--font-sans)] text-[0.72rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">CATEGORIES (OPTIONAL)</span>
              <input
                value={missionForm.categories}
                onChange={(e) => setMissionForm((f) => ({ ...f, categories: e.target.value }))}
                placeholder={
                  policy && policy.allowed_categories.length > 0
                    ? `${policy.allowed_categories.join(", ")} — empty = your policy`
                    : "accessories, snacks — defaults to all"
                }
                className="font-[var(--font-mono)] text-[0.72rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">SKU (OPTIONAL)</span>
              <input
                value={missionForm.sku}
                onChange={(e) => setMissionForm((f) => ({ ...f, sku: e.target.value.toUpperCase() }))}
                placeholder="CHAIR-PRO-01"
                className="font-[var(--font-mono)] text-[0.72rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)]"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">QUANTITY</span>
                <input
                  type="number"
                  min="1"
                  value={missionForm.quantity}
                  onChange={(e) => setMissionForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="font-[var(--font-mono)] text-[0.72rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 tabular-nums focus:outline-none focus:border-[var(--bb-orange)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">OFFER (₹, OPTIONAL)</span>
                <input
                  type="number"
                  min="1"
                  value={missionForm.offer}
                  onChange={(e) => setMissionForm((f) => ({ ...f, offer: e.target.value }))}
                  placeholder="11500"
                  className="font-[var(--font-mono)] text-[0.72rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 tabular-nums placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)]"
                />
              </label>
            </div>
            {/* Real policy context — same source the chat panel uses, so a
                mission can be framed against the merchant's actual caps. */}
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3 border border-[var(--bb-line-soft)] bg-[var(--bb-black)] px-3 py-2.5">
              <div>
                <div className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] mb-0.5">ALLOWED CATEGORIES</div>
                <div className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)] truncate" title={policy?.allowed_categories.join(", ")}>
                  {policy && policy.allowed_categories.length > 0 ? policy.allowed_categories.join(", ") : "—"}
                </div>
              </div>
              <div>
                <div className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] mb-0.5">HITL THRESHOLD</div>
                <div className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)] tabular-nums">
                  {policy ? `${formatPaise(policy.human_approval_threshold_paise)} — held for approval above this` : "—"}
                </div>
              </div>
              <div>
                <div className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] mb-0.5">MAX ITEM VALUE</div>
                <div className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)] tabular-nums">
                  {policy ? formatPaise(policy.max_single_item_value_paise) : "—"}
                </div>
              </div>
            </div>
            <div className="flex items-end justify-between gap-3 md:col-span-2">
              <button
                onClick={() => setMissionForm((f) => ({ ...f, upsell: !f.upsell }))}
                className={`h-[30px] px-3 font-[var(--font-mono)] text-[0.52rem] tracking-[0.08em] uppercase border transition-all cursor-pointer ${missionForm.upsell ? "border-[var(--bb-orange)]/50 bg-[var(--bb-orange)]/10 text-[var(--bb-orange)]" : "border-[var(--bb-line)] text-[var(--bb-grey-2)] hover:text-[var(--bb-white)]"}`}
                aria-pressed={missionForm.upsell}
              >
                UPSELLS {missionForm.upsell ? "ON" : "OFF"}
              </button>
              <button
                onClick={handleRunMission}
                disabled={runningMission}
                className="inline-flex items-center gap-2 h-[36px] px-5 bg-[var(--bb-orange)] text-[var(--bb-black)] font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase hover:bg-[var(--bb-orange-bright)] transition-colors cursor-pointer disabled:opacity-50"
              >
                {runningMission ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />} RUN
              </button>
            </div>
          </div>
        </div>
      )}

      {missionResult && (
        <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-5 stagger-child">
          <div className="flex items-center justify-between mb-3">
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-grey-1)]">BUYER MISSION RESULT</span>
            <span className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] ${missionResult.action === "READY_FOR_CONSENT" ? "text-green-400" : missionResult.action === "NEEDS_HUMAN_APPROVAL" ? "text-amber-400" : "text-red-400"}`}>
              {missionResult.action.replace(/_/g, " ")}
            </span>
          </div>
          {/* Real lifecycle steps — rendered only from backend output. */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {missionSteps(missionResult, missionOfferGiven, missionOrderDetail).map((s) => (
              <span
                key={s.label}
                className={`font-[var(--font-mono)] text-[0.5rem] tracking-[0.08em] px-2 py-0.5 border ${
                  s.tone === "done"
                    ? "border-green-400/40 text-green-400"
                    : s.tone === "block"
                      ? "border-amber-400/40 text-amber-400"
                      : "border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]"
                }`}
              >
                {s.label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-2)]">Mission</span>
              <span className="font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-white)] text-right truncate max-w-[70%]" title={missionForm.mission}>{missionForm.mission || "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-2)]">Product</span>
              <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)] text-right truncate max-w-[70%]" title={missionResult.seller_decision?.selected_product?.title ?? undefined}>
                {missionResult.seller_decision?.selected_product
                  ? `${missionResult.seller_decision.selected_product.title} · ${missionResult.seller_decision.selected_product.sku}`
                  : missionResult.seller_decision?.cart?.items?.[0]?.sku ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-2)]">Final price</span>
              <span className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-white)] tabular-nums">
                {missionResult.seller_decision?.cart ? formatPaise(missionResult.seller_decision.cart.total_paise) : "—"}
                {missionResult.seller_decision?.cart && missionResult.seller_decision.cart.discount_paise > 0 && (
                  <span className="text-green-400 ml-2 text-[0.6rem]">−{formatPaise(missionResult.seller_decision.cart.discount_paise)} · ROUND {missionResult.seller_decision.cart.negotiation_round}</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-2)]">Trace ID</span>
              <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-2)]">{missionResult.trace_id}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-2)]">Order ID</span>
              {missionOrderDetail ? (
                <Link href={`/dashboard/transactions/${missionOrderDetail.order_id}`} className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-orange)] hover:text-[var(--bb-orange-bright)] flex items-center gap-1">
                  {missionResult.order_id} <ExternalLink size={10} />
                </Link>
              ) : (
                <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">{missionResult.order_id ?? "—"}</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-2)]">Consent ID</span>
              <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-2)]">{missionResult.consent_id ?? missionOrderDetail?.consent_id ?? "—"}</span>
            </div>
            {missionResult.seller_decision?.response_message && (
              <div className="md:col-span-2 border-l-2 border-[var(--bb-orange)]/40 pl-3 py-1">
                <div className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] mb-0.5">SELLER REPLY</div>
                <div className="font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-1)] leading-relaxed">{missionResult.seller_decision.response_message}</div>
              </div>
            )}
            {missionResult.buyer_summary && (
              <div className="md:col-span-2 border-l-2 border-[var(--bb-line-soft)] pl-3 py-1">
                <div className="font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-2)] leading-relaxed">{missionResult.buyer_summary}</div>
              </div>
            )}
          </div>
          {/* Continuation: real order state drives the next allowed action. */}
          {missionOrderDetail && (
            <div className="flex items-center justify-between gap-3 mt-4 border border-[var(--bb-line-soft)] bg-[var(--bb-black)] px-4 py-2.5">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">AUTHORITATIVE ORDER STATE</span>
              <span className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] ${
                ORDER_TERMINAL.includes(missionOrderDetail.status)
                  ? missionOrderDetail.status === "PAID" || missionOrderDetail.status === "FULFILLED" ? "text-green-400" : "text-red-400"
                  : missionOrderDetail.status === "PAYMENT_PENDING" ? "text-yellow-400" : "text-amber-400"
              }`}>{missionOrderDetail.status.replace(/_/g, " ")}</span>
            </div>
          )}
          {missionOrderDetail && missionOrderDetail.status === "AWAITING_CONSENT" && missionOrderDetail.policy_verdict === "NEEDS_HUMAN_APPROVAL" && !missionOrderDetail.consent_id && (
            <div className="mt-4 border border-amber-400/30 bg-amber-400/5 px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldAlert size={14} className="text-amber-400" />
                <span className="font-[var(--font-mono)] text-[0.6rem] text-amber-400">{missionResult.mission_id ? "HELD FOR MERCHANT APPROVAL — the mission resumes automatically after approval" : "HELD FOR MERCHANT APPROVAL — no consent is issued until approved"}</span>
              </div>
              <Link href="/dashboard/approvals" className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-amber-400 hover:underline whitespace-nowrap">OPEN APPROVALS</Link>
            </div>
          )}
          {missionOrderDetail && missionOrderDetail.status === "AWAITING_CONSENT" && missionOrderDetail.consent_status === "ISSUED" && missionOrderDetail.consent_id && (
            <button
              onClick={handleMissionPayment}
              className="mt-4 w-full h-[36px] bg-[var(--bb-orange)] text-[var(--bb-black)] font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase hover:bg-[var(--bb-orange-bright)] transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Wallet size={12} /> START PAYMENT {formatPaise(missionOrderDetail.amount_paise)}
            </button>
          )}
          {missionOrderDetail && missionOrderDetail.status === "PAYMENT_PENDING" && (
            <div className="mt-4 space-y-2">
              <div className="border border-[var(--bb-line)] px-4 py-3 flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.6rem] text-yellow-400">AWAITING SIGNED PROVIDER WEBHOOK</span>
                {missionOrderDetail.payment_url && (
                  <a href={missionOrderDetail.payment_url} target="_blank" rel="noopener noreferrer" className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:underline">REOPEN PAYMENT LINK ↗</a>
                )}
              </div>
              {DEMO_MODE && (
                <button onClick={handleMissionSimulate} className="w-full h-[32px] border border-green-400/30 bg-green-400/5 font-[var(--font-mono)] text-[0.55rem] uppercase text-green-400 hover:bg-green-400/10 cursor-pointer">
                  SIMULATE CAPTURE (DEV)
                </button>
              )}
            </div>
          )}
          {missionOrderDetail && ORDER_TERMINAL.includes(missionOrderDetail.status) && (
            <Link
              href={`/dashboard/transactions/${missionOrderDetail.order_id}/replay`}
              className="mt-4 inline-flex items-center justify-center w-full h-[34px] border border-green-400/30 bg-green-400/10 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-green-400 hover:bg-green-400/20 transition-colors"
            >
              VIEW REPLAY
            </Link>
          )}
        </div>
      )}

      {/* Recent missions — derived from buyer.mission_received ledger events;
          resume-to-order restores the lifecycle from the authoritative order. */}
      {missionHistory.length > 0 && (
        <div className="border border-[var(--bb-line)] overflow-hidden stagger-child">
          <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center gap-2">
            <History size={13} className="text-[var(--bb-grey-3)]" />
            <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">RECENT MISSIONS</span>
            <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)]">DERIVED FROM buyer.mission_received LEDGER EVENTS · RESUME REBUILDS THE PANEL FROM THE ORDER</span>
          </div>
          {missionHistory.slice(0, 8).map((m, i) => (
            <div key={m.traceId} className={`px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-[var(--bb-panel)] transition-colors ${i < Math.min(missionHistory.length, 8) - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
              <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] w-[58px] shrink-0">{formatTimestamp(m.timestamp)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-2)] truncate" title={m.mission}>{m.mission}</div>
                <div className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] mt-0.5 truncate">
                  {m.budgetPaise !== null ? `budget ${formatPaise(m.budgetPaise)} · ` : ""}trace {m.traceId}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {m.orderId ? (
                  <>
                    <span className={`font-[var(--font-mono)] text-[0.5rem] tracking-[0.08em] uppercase px-1.5 py-0.5 border ${m.paid ? "border-green-400/40 text-green-400" : m.held ? "border-amber-400/40 text-amber-400" : "border-green-400/40 text-green-400"}`}>
                      {m.paid ? "PAID" : m.held ? "HELD" : "ORDER"}
                    </span>
                    <button
                      onClick={() => void handleResumeMission(m)}
                      disabled={resumingTrace !== null}
                      className="inline-flex items-center gap-1 h-[28px] px-2.5 border border-[var(--bb-orange)]/40 bg-[var(--bb-orange)]/10 font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:bg-[var(--bb-orange)]/20 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <Play size={10} /> {resumingTrace === m.traceId ? "RESUMING…" : "RESUME"}
                    </button>
                    <Link href={`/dashboard/transactions/${m.orderId}`} className="inline-flex items-center gap-1 h-[28px] px-2 border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all">
                      <ExternalLink size={10} /> ORDER
                    </Link>
                  </>
                ) : (
                  <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.08em] uppercase text-[var(--bb-grey-4)] px-1.5 py-0.5 border border-[var(--bb-line)]">NO ORDER</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 stagger-child">
        <div className="flex items-center gap-2">
          <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">ACTOR</span>
          <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value as ActorType | "all")} className="font-[var(--font-mono)] text-[0.65rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-1.5 cursor-pointer">
            {actorFilters.map((f) => (<option key={f.value} value={f.value}>{f.label}</option>))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">TYPE</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="font-[var(--font-mono)] text-[0.65rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-1.5 cursor-pointer">
            {eventTypeFilters.map((f) => (<option key={f} value={f}>{f}</option>))}
          </select>
        </div>
        <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">{filtered.length} events</span>
      </div>

      {missionMsg && (
        <div className={`px-4 py-3 border flex items-start gap-2 ${missionMsg.kind === "error" ? "border-red-400/30 bg-red-400/5" : "border-green-400/30 bg-green-400/5"}`}>
          <span className={`font-[var(--font-mono)] text-[0.62rem] leading-relaxed ${missionMsg.kind === "error" ? "text-red-400" : "text-green-400"}`}>
            {missionMsg.text}
          </span>
        </div>
      )}
      {loadError && (
        <div className="px-4 py-3 border border-amber-400/30 bg-amber-400/5 flex items-start gap-2">
          <span className="font-[var(--font-mono)] text-[0.62rem] text-amber-400">{loadError}</span>
        </div>
      )}

      <div className="border border-[var(--bb-line)] overflow-hidden stagger-child">
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
              {loading ? "Loading events..." : "No events match the current filters."}
            </div>
          </div>
        ) : filtered.map((event, i) => (
          <div key={event.eventId} className={`px-5 py-4 hover-panel transition-colors ${i < filtered.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
            <div className="flex items-start gap-4">
              <div className="flex items-center gap-2 w-[60px] flex-shrink-0">
                <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">{formatTimestamp(event.timestamp)}</span>
              </div>
              <ActorIcon actor={event.actor} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <ActorBadge actor={event.actor} />
                  <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">{event.action}</span>
                </div>
                {event.reasoningSummary && (
                  <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)] leading-relaxed mb-2">{event.reasoningSummary}</div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {event.policyRefs.map((ref) => (
                    <span key={ref} className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]">{ref}</span>
                  ))}
                  {event.flags.map((flag) => (
                    <span key={flag} className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 bg-[var(--bb-orange-wash-2)] text-[var(--bb-orange)]">{flag}</span>
                  ))}
                  {event.outcome_effect && Object.entries(event.outcome_effect).map(([key, val]) => (
                    <span key={key} className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 border border-green-400/40 text-green-400">{key}: {String(val)}</span>
                  ))}
                </div>
              </div>
              <div className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] flex-shrink-0">{event.traceId}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
