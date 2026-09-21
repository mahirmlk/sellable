"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { RefreshCw, Radio, Play, X, Wallet, ShieldAlert, ExternalLink, History } from "lucide-react";
import { ActorBadge, ActorIcon } from "@/components/dashboard/actor-badge";
import { formatTimestamp, formatPaise } from "@/lib/formatters";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { exportToCsv } from "@/lib/csv";
import { useSavedViews } from "@/lib/saved-views";
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
  if (detail?.consent_status === "EXPIRED") blocked("CONSENT EXPIRED");
  else if (result.consent_id || detail?.consent_status === "ISSUED" || detail?.consent_status === "CONSUMED") done("CONSENT");
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
  // Mission id + auto-continuation guard. The mission id lives in a ref so
  // the order poll (which must not depend on panel state) can trigger the
  // backend continuation exactly once when approval unblocks the mission.
  const missionIdRef = useRef<string | null>(null);
  const autoContinuedRef = useRef<Set<string>>(new Set());
  const seenIds = useRef<Set<string>>(new Set());
  // Merchant policy context: prefills the mission form's categories and shows
  // the real floor/HITL caps next to it (same source the chat panel uses).
  const [policy, setPolicy] = useState<ConsolePolicySettings | null>(null);
  const [resumingTrace, setResumingTrace] = useState<string | null>(null);
  // Human-readable rows: technical details expand per event, collapsed default.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Saved filter views + CSV export over the current filter pair.
  const { getViews, saveView, deleteView } = useSavedViews<string>("sellable.saved-views.activity");
  const savedViews = getViews();
  const [viewName, setViewName] = useState("");

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
          if (ORDER_TERMINAL.includes(detail.status)) {
            stopMissionPoll();
            return;
          }
          // HITL must not end the buyer mission: the moment the ledger
          // shows a live consent (i.e. approval was granted), the backend
          // continuation runs ONCE — consent reuse/issue + payment start
          // through the existing PaymentService. Never from the frontend's
          // own judgement: the server re-derives everything from the order.
          const missionId = missionIdRef.current;
          if (
            missionId &&
            detail.status === "AWAITING_CONSENT" &&
            detail.consent_status === "ISSUED" &&
            detail.consent_id &&
            !autoContinuedRef.current.has(orderId)
          ) {
            autoContinuedRef.current.add(orderId);
            continueBuyerMission(missionId)
              .then((mission) => {
                if (mission.state === "PAYMENT_PENDING") {
                  setMissionMsg({ kind: "success", text: "Approval unblocked the mission — the buyer continuation started the A2A payment." });
                }
              })
              .catch(() => {
                // The manual continuation button and the poll still show
                // the authoritative state; nothing is faked here.
                autoContinuedRef.current.delete(orderId);
              });
          }
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
    missionIdRef.current = null;
    autoContinuedRef.current = new Set();
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
      missionIdRef.current = result.mission_id;
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
    // The ONLY continuation for a persisted AI-buyer mission: the backend
    // re-verifies the order, reuses/issues single-use consent, and starts
    // payment through the existing PaymentService. The browser never sends
    // an amount, order id, or consent id to any payment rail — a stale
    // browser-captured consent id is exactly what produced the old
    // "Consent is not available for use" 409.
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
        // Self-heal the panel from the authoritative state instead of
        // leaving a stale button behind.
        pollMissionOrder(result.order_id);
      }
      return;
    }
    // Legacy fallback for runs persisted before missions existed: the
    // existing order-payment endpoint with the consent the backend itself
    // reported as live.
    const consentId = missionOrderDetail.consent_id;
    if (!consentId || missionOrderDetail.consent_status !== "ISSUED") return;
    try {
      await consoleStartPayment(result.order_id, consentId);
      pollMissionOrder(result.order_id);
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : "unknown error";
      setMissionMsg({ kind: "error", text: `Payment could not be started: ${detail}` });
      pollMissionOrder(result.order_id);
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
          if (match) {
            resumed.mission_id = match.mission_id;
            missionIdRef.current = match.mission_id;
          }
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

  // Plain-language labels for the default row view. Technical details
  // (actor/action/trace/io/reasoning/refs) stay one click away underneath.
  const actionLabel = (action: string): string => {
    if (action === "buyer.mission_received") return "Buyer mission received";
    if (action === "buyer.discovered_merchant") return "Merchant discovered";
    if (action === "catalog.search") return "Catalog searched";
    if (action === "catalog.get") return "Product viewed";
    if (action === "buyer.catalog_researched") return "Catalog researched";
    if (action === "product.selected") return "Product selected";
    if (action === "quote.created") return "Quote created";
    if (action === "quote.received") return "Quote received";
    if (action.includes("negotiat")) return "Negotiation round";
    if (action.includes("upsell")) return "Upsell suggested";
    if (action === "policy.checked") return "Policy checked";
    if (action === "buyer.response_phrased") return "Seller replied";
    if (action === "buyer.order_requested") return "Order requested";
    if (action === "order.created") return "Order created";
    if (action === "buyer.order_held") return "Order held for approval";
    if (action.includes("consent")) return `Consent ${action.split(".")[1] ?? "updated"}`;
    if (action === "payment.pending" || action.includes("payment.attempted")) return "Payment started";
    if (action === "payment.captured" || action === "order.paid") return "Payment captured";
    if (action === "payment.failed") return "Payment failed";
    if (action.includes("webhook")) return "Webhook verified";
    if (action === "buyer.payment_verified") return "Payment verified by buyer";
    if (action.includes("settl")) return "Order settled";
    if (action === "seller.response_ready") return "Seller response ready";
    if (action.includes("refund")) return "Order refunded";
    if (action.includes("abort")) return "Order aborted";
    if (action.includes("retry")) return "Payment retried";
    return action.replace(/[._]/g, " ");
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filterKey = `${actorFilter}|${typeFilter}`;

  const handleExportCsv = () => {
    exportToCsv(
      `live-activity-${new Date().toISOString().slice(0, 10)}`,
      filtered.map((e) => ({
        time: e.timestamp,
        label: actionLabel(e.action),
        actor: e.actor,
        action: e.action,
        trace_id: e.traceId,
        reasoning: e.reasoningSummary ?? "",
        policy_refs: (e.policyRefs ?? []).join(";"),
        provider_ref: e.provider_ref ?? "",
        flags: (e.flags ?? []).join(";"),
      }))
    );
  };

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.02em] text-neutral-900">Live Activity</h1>
          <p className="text-[14px] text-neutral-500 mt-1">Real-time operational feed</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 h-9 px-3 border border-black/[0.06] bg-white rounded-full">
            <Radio size={12} className={streamMode === "live" ? "text-[#1f9d55] animate-[blink_2s_ease-in-out_infinite]" : streamMode === "polling" ? "text-[#b25e00]" : "text-[#d92d20]"} />
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-neutral-500">
              {streamMode === "live" ? "LIVE" : streamMode === "polling" ? "POLLING" : "OFFLINE"}
            </span>
          </div>
          <button onClick={() => setMissionFormOpen((v) => !v)} className="inline-flex items-center gap-2 h-9 px-3 border border-[#0071e3]/30 bg-[#0071e3]/10 text-[13px] text-[#0071e3] hover:bg-[#0071e3]/15 transition-all cursor-pointer font-medium rounded-full">
            {missionFormOpen ? <X size={12} /> : <Play size={12} />} {missionFormOpen ? "CLOSE MISSION" : "NEW BUYER MISSION"}
          </button>
          <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-2 h-9 px-3 border border-black/[0.06] bg-white text-[13px] text-neutral-500 hover:text-neutral-900 hover:border-black/[0.12] transition-all cursor-pointer disabled:opacity-50 font-medium rounded-full">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
          </button>
        </div>
      </div>

      {missionFormOpen && (
        <div className="border border-[#0071e3]/20 bg-white p-5 stagger-child rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
          <div className="flex items-center gap-2 mb-4">
            <Play size={13} className="text-[#0071e3]" />
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[#0071e3]">NEW BUYER MISSION</span>
            <span className="font-[var(--font-mono)] text-[0.5rem] text-neutral-500 ml-2">runs the real Buyer Agent against your store</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="md:col-span-2 flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-neutral-500">MISSION *</span>
              <textarea
                value={missionForm.mission}
                onChange={(e) => setMissionForm((f) => ({ ...f, mission: e.target.value }))}
                placeholder="I need an ergonomic office chair for my home office"
                rows={2}
                className="font-[var(--font-sans)] text-[14px] bg-white border border-black/[0.06] text-neutral-900 px-3 py-2 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] rounded-[12px] focus:ring-[3px] focus:ring-[#0071e3]/20"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-neutral-500">BUDGET (₹) *</span>
              <input
                type="number"
                min="1"
                value={missionForm.budget}
                onChange={(e) => setMissionForm((f) => ({ ...f, budget: e.target.value }))}
                placeholder="15000"
                className="font-[var(--font-mono)] text-[14px] bg-white border border-black/[0.06] text-neutral-900 px-3 py-2 tabular-nums focus:outline-none focus:border-[#0071e3] rounded-[12px] focus:ring-[3px] focus:ring-[#0071e3]/20"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-neutral-500">BUYER IDENTITY</span>
              <input
                value={missionForm.buyer}
                onChange={(e) => setMissionForm((f) => ({ ...f, buyer: e.target.value }))}
                className="font-[var(--font-mono)] text-[14px] bg-white border border-black/[0.06] text-neutral-900 px-3 py-2 focus:outline-none focus:border-[#0071e3] rounded-[12px] focus:ring-[3px] focus:ring-[#0071e3]/20"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-neutral-500">PURPOSE</span>
              <input
                value={missionForm.purpose}
                onChange={(e) => setMissionForm((f) => ({ ...f, purpose: e.target.value }))}
                placeholder="defaults to the mission text"
                className="font-[var(--font-sans)] text-[14px] bg-white border border-black/[0.06] text-neutral-900 px-3 py-2 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] rounded-[10px] focus:ring-[3px] focus:ring-[#0071e3]/20"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-neutral-500">CATEGORIES (OPTIONAL)</span>
              <input
                value={missionForm.categories}
                onChange={(e) => setMissionForm((f) => ({ ...f, categories: e.target.value }))}
                placeholder={
                  policy && policy.allowed_categories.length > 0
                    ? `${policy.allowed_categories.join(", ")} — empty = your policy`
                    : "accessories, snacks — defaults to all"
                }
                className="font-[var(--font-mono)] text-[14px] bg-white border border-black/[0.06] text-neutral-900 px-3 py-2 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] rounded-[10px] focus:ring-[3px] focus:ring-[#0071e3]/20"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-neutral-500">SKU (OPTIONAL)</span>
              <input
                value={missionForm.sku}
                onChange={(e) => setMissionForm((f) => ({ ...f, sku: e.target.value.toUpperCase() }))}
                placeholder="CHAIR-PRO-01"
                className="font-[var(--font-mono)] text-[14px] bg-white border border-black/[0.06] text-neutral-900 px-3 py-2 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] rounded-[10px] focus:ring-[3px] focus:ring-[#0071e3]/20"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-neutral-500">QUANTITY</span>
                <input
                  type="number"
                  min="1"
                  value={missionForm.quantity}
                  onChange={(e) => setMissionForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="font-[var(--font-mono)] text-[14px] bg-white border border-black/[0.06] text-neutral-900 px-3 py-2 tabular-nums focus:outline-none focus:border-[#0071e3] rounded-[12px] focus:ring-[3px] focus:ring-[#0071e3]/20"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-neutral-500">OFFER (₹, OPTIONAL)</span>
                <input
                  type="number"
                  min="1"
                  value={missionForm.offer}
                  onChange={(e) => setMissionForm((f) => ({ ...f, offer: e.target.value }))}
                  placeholder="11500"
                  className="font-[var(--font-mono)] text-[14px] bg-white border border-black/[0.06] text-neutral-900 px-3 py-2 tabular-nums placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] rounded-[10px] focus:ring-[3px] focus:ring-[#0071e3]/20"
                />
              </label>
            </div>
            {/* Real policy context — same source the chat panel uses, so a
                mission can be framed against the merchant's actual caps. */}
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3 border border-black/[0.05] bg-white px-3 py-2.5">
              <div>
                <div className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.1em] uppercase text-neutral-400 mb-0.5">ALLOWED CATEGORIES</div>
                <div className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600 truncate" title={policy?.allowed_categories.join(", ")}>
                  {policy && policy.allowed_categories.length > 0 ? policy.allowed_categories.join(", ") : "—"}
                </div>
              </div>
              <div>
                <div className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.1em] uppercase text-neutral-400 mb-0.5">HITL THRESHOLD</div>
                <div className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600 tabular-nums">
                  {policy ? `${formatPaise(policy.human_approval_threshold_paise)} — held for approval above this` : "—"}
                </div>
              </div>
              <div>
                <div className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.1em] uppercase text-neutral-400 mb-0.5">MAX ITEM VALUE</div>
                <div className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600 tabular-nums">
                  {policy ? formatPaise(policy.max_single_item_value_paise) : "—"}
                </div>
              </div>
            </div>
            <div className="flex items-end justify-between gap-3 md:col-span-2">
              <button
                onClick={() => setMissionForm((f) => ({ ...f, upsell: !f.upsell }))}
                className={`h-9 px-4 rounded-full text-[13px] font-medium border transition-all cursor-pointer ${missionForm.upsell ? "border-[#0071e3]/30 bg-[#0071e3]/10 text-[#0071e3]" : "bg-white border-black/[0.06] text-neutral-600 hover:text-neutral-900"}`}
                aria-pressed={missionForm.upsell}
              >
                UPSELLS {missionForm.upsell ? "ON" : "OFF"}
              </button>
              <button
                onClick={handleRunMission}
                disabled={runningMission}
                className="inline-flex items-center gap-2 h-9 px-5 bg-[#0071e3] text-white text-[13px] hover:bg-[#0068d1] transition-colors cursor-pointer disabled:opacity-50 font-medium rounded-full"
              >
                {runningMission ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />} RUN
              </button>
            </div>
          </div>
        </div>
      )}

      {missionResult && (
        <div className="border border-black/[0.06] bg-white p-5 stagger-child rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
          <div className="flex items-center justify-between mb-3">
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-neutral-600">BUYER MISSION RESULT</span>
            <span className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] ${missionResult.action === "READY_FOR_CONSENT" ? "text-[#1f9d55]" : missionResult.action === "NEEDS_HUMAN_APPROVAL" ? "text-[#b25e00]" : "text-[#d92d20]"}`}>
              {missionResult.action.replace(/_/g, " ")}
            </span>
          </div>
          {/* Real lifecycle steps — rendered only from backend output. */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {missionSteps(missionResult, missionOfferGiven, missionOrderDetail).map((s) => (
              <span
                key={s.label}
                className={`rounded-full px-2.5 py-1 text-[12px] font-medium border ${
                  s.tone === "done"
                    ? "border-[#1f9d55]/20 bg-green-50 text-[#1f9d55]"
                    : s.tone === "block"
                      ? "border-[#b25e00]/20 bg-amber-50 text-[#b25e00]"
                      : "border-black/[0.06] bg-neutral-100 text-neutral-500"
                }`}
              >
                {s.label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-600">Mission</span>
              <span className="font-[var(--font-sans)] text-[0.72rem] text-neutral-900 text-right truncate max-w-[70%]" title={missionForm.mission}>{missionForm.mission || "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-600">Product</span>
              <span className="font-[var(--font-mono)] text-[0.65rem] text-neutral-900 text-right truncate max-w-[70%]" title={missionResult.seller_decision?.selected_product?.title ?? undefined}>
                {missionResult.seller_decision?.selected_product
                  ? `${missionResult.seller_decision.selected_product.title} · ${missionResult.seller_decision.selected_product.sku}`
                  : missionResult.seller_decision?.cart?.items?.[0]?.sku ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-600">Final price</span>
              <span className="font-[var(--font-mono)] text-[0.75rem] text-neutral-900 tabular-nums">
                {missionResult.seller_decision?.cart ? formatPaise(missionResult.seller_decision.cart.total_paise) : "—"}
                {missionResult.seller_decision?.cart && missionResult.seller_decision.cart.discount_paise > 0 && (
                  <span className="text-[#1f9d55] ml-2 text-[0.6rem]">−{formatPaise(missionResult.seller_decision.cart.discount_paise)} · ROUND {missionResult.seller_decision.cart.negotiation_round}</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-600">Trace ID</span>
              <span className="font-[var(--font-mono)] text-[0.55rem] text-neutral-600">{missionResult.trace_id}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-600">Order ID</span>
              {missionOrderDetail ? (
                <Link href={`/dashboard/transactions/${missionOrderDetail.order_id}`} className="font-[var(--font-mono)] text-[0.6rem] text-[#0071e3] hover:text-[#0068d1] flex items-center gap-1">
                  {missionResult.order_id} <ExternalLink size={10} />
                </Link>
              ) : (
                <span className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600">{missionResult.order_id ?? "—"}</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-600">Consent ID</span>
              <span className="font-[var(--font-mono)] text-[0.55rem] text-neutral-600">{missionResult.consent_id ?? missionOrderDetail?.consent_id ?? "—"}</span>
            </div>
            {missionResult.seller_decision?.response_message && (
              <div className="md:col-span-2 border-l-2 border-[#0071e3]/30 pl-3 py-1">
                <div className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.1em] uppercase text-neutral-400 mb-0.5">SELLER REPLY</div>
                <div className="font-[var(--font-sans)] text-[0.72rem] text-neutral-600 leading-relaxed">{missionResult.seller_decision.response_message}</div>
              </div>
            )}
            {missionResult.buyer_summary && (
              <div className="md:col-span-2 border-l-2 border-black/[0.05] pl-3 py-1">
                <div className="font-[var(--font-sans)] text-[0.72rem] text-neutral-600 leading-relaxed">{missionResult.buyer_summary}</div>
              </div>
            )}
          </div>
          {/* Continuation: real order state drives the next allowed action. */}
          {missionOrderDetail && (
            <div className="flex items-center justify-between gap-3 mt-4 border border-black/[0.05] bg-white px-4 py-2.5">
              <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-neutral-400">AUTHORITATIVE ORDER STATE</span>
              <span className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] ${
                ORDER_TERMINAL.includes(missionOrderDetail.status)
                  ? missionOrderDetail.status === "PAID" || missionOrderDetail.status === "FULFILLED" ? "text-[#1f9d55]" : "text-[#d92d20]"
                  : missionOrderDetail.status === "PAYMENT_PENDING" ? "text-[#b25e00]" : "text-[#b25e00]"
              }`}>{missionOrderDetail.status.replace(/_/g, " ")}</span>
            </div>
          )}
          {missionOrderDetail && missionOrderDetail.status === "AWAITING_CONSENT" && missionOrderDetail.policy_verdict === "NEEDS_HUMAN_APPROVAL" && !missionOrderDetail.consent_id && (
            <div className="mt-4 border border-[#b25e00]/20 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3 rounded-2xl">
              <div className="flex items-center gap-2">
                <ShieldAlert size={14} className="text-[#b25e00]" />
                <span className="font-[var(--font-mono)] text-[0.6rem] text-[#b25e00]">{missionResult.mission_id ? "HELD FOR MERCHANT APPROVAL — the mission resumes automatically after approval" : "HELD FOR MERCHANT APPROVAL — no consent is issued until approved"}</span>
              </div>
              <Link href="/dashboard/approvals" className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[#b25e00] hover:underline whitespace-nowrap">OPEN APPROVALS</Link>
            </div>
          )}
          {missionOrderDetail && missionOrderDetail.status === "AWAITING_CONSENT" && missionOrderDetail.consent_status === "EXPIRED" && (
            <div className="mt-4 border border-[#b25e00]/20 bg-amber-50 px-4 py-3 rounded-2xl">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert size={14} className="text-[#b25e00]" />
                <span className="font-[var(--font-mono)] text-[0.6rem] text-[#b25e00]">CONSENT EXPIRED — the single-use authorization timed out; a fresh consent will be issued under the same rules on continue</span>
              </div>
              {missionResult.mission_id && (
                <button
                  onClick={handleMissionPayment}
                  className="w-full h-9 border border-[#b25e00]/20 bg-amber-50 text-[13px] text-[#b25e00] hover:bg-amber-100 transition-colors flex items-center justify-center gap-2 cursor-pointer font-medium rounded-full"
                >
                  <Wallet size={12} /> CONTINUE MISSION — RE-ISSUE CONSENT
                </button>
              )}
            </div>
          )}
          {missionOrderDetail && missionOrderDetail.status === "AWAITING_CONSENT" && missionOrderDetail.consent_status === "ISSUED" && missionOrderDetail.consent_id && (
            missionResult.mission_id ? (
              <button
                onClick={handleMissionPayment}
                className="mt-4 w-full h-9 bg-[#0071e3] text-white text-[13px] hover:bg-[#0068d1] transition-colors flex items-center justify-center gap-2 cursor-pointer font-medium rounded-full"
              >
                <Wallet size={12} /> PAYMENT READY — CONTINUE MISSION {formatPaise(missionOrderDetail.amount_paise)}
              </button>
            ) : (
              <button
                onClick={handleMissionPayment}
                className="mt-4 w-full h-9 bg-[#0071e3] text-white text-[13px] hover:bg-[#0068d1] transition-colors flex items-center justify-center gap-2 cursor-pointer font-medium rounded-full"
              >
                <Wallet size={12} /> CONTINUE TO PAYMENT {formatPaise(missionOrderDetail.amount_paise)}
              </button>
            )
          )}
          {missionOrderDetail && missionOrderDetail.status === "PAYMENT_PENDING" && (
            <div className="mt-4 space-y-2">
              <div className="border border-[#b25e00]/20 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3 rounded-2xl">
                <div>
                  <div className="font-[var(--font-mono)] text-[0.6rem] text-[#b25e00]">PAYMENT AUTHORIZATION REQUIRED</div>
                  <div className="font-[var(--font-mono)] text-[0.5rem] text-neutral-500 mt-0.5">The buyer&apos;s provider authorization is pending — the order settles ONLY on a signature-verified webhook</div>
                </div>
                {missionOrderDetail.payment_url && (
                  <a href={missionOrderDetail.payment_url} target="_blank" rel="noopener noreferrer" className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[#0071e3] hover:underline whitespace-nowrap">OPEN PAYMENT LINK ↗</a>
                )}
              </div>
              {DEMO_MODE && (
                <button onClick={handleMissionSimulate} className="w-full h-9 border border-[#1f9d55]/20 bg-green-50 text-[13px] text-[#1f9d55] hover:bg-green-100 cursor-pointer font-medium rounded-full">
                  SIMULATE CAPTURE (DEV)
                </button>
              )}
            </div>
          )}
          {missionOrderDetail && ORDER_TERMINAL.includes(missionOrderDetail.status) && (
            <Link
              href={`/dashboard/transactions/${missionOrderDetail.order_id}/replay`}
              className="mt-4 inline-flex items-center justify-center w-full h-9 border border-[#1f9d55]/20 bg-green-50 text-[13px] text-[#1f9d55] hover:bg-green-100 transition-colors font-medium rounded-full"
            >
              VIEW REPLAY
            </Link>
          )}
        </div>
      )}

      {/* Recent missions — derived from buyer.mission_received ledger events;
          resume-to-order restores the lifecycle from the authoritative order. */}
      {missionHistory.length > 0 && (
        <div className="border border-black/[0.06] overflow-hidden stagger-child rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
          <div className="px-5 py-3 border-b border-black/[0.06] bg-white flex items-center gap-2 rounded-[12px]">
            <History size={13} className="text-neutral-500" />
            <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-neutral-500">RECENT MISSIONS</span>
            <span className="font-[var(--font-mono)] text-[0.5rem] text-neutral-400">DERIVED FROM buyer.mission_received LEDGER EVENTS · RESUME REBUILDS THE PANEL FROM THE ORDER</span>
          </div>
          {missionHistory.slice(0, 8).map((m, i) => (
            <div key={m.traceId} className={`px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-neutral-50 transition-colors ${i < Math.min(missionHistory.length, 8) - 1 ? "border-b border-black/[0.05]" : ""}`}>
              <span className="font-[var(--font-mono)] text-[0.55rem] text-neutral-400 w-[58px] shrink-0">{formatTimestamp(m.timestamp)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-[var(--font-sans)] text-[0.78rem] text-neutral-600 truncate" title={m.mission}>{m.mission}</div>
                <div className="font-[var(--font-mono)] text-[0.5rem] text-neutral-400 mt-0.5 truncate">
                  {m.budgetPaise !== null ? `budget ${formatPaise(m.budgetPaise)} · ` : ""}trace {m.traceId}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {m.orderId ? (
                  <>
                    <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium border ${m.paid ? "border-[#1f9d55]/20 bg-green-50 text-[#1f9d55]" : m.held ? "border-[#b25e00]/20 bg-amber-50 text-[#b25e00]" : "border-[#1f9d55]/20 bg-green-50 text-[#1f9d55]"}`}>
                      {m.paid ? "PAID" : m.held ? "HELD" : "ORDER"}
                    </span>
                    <button
                      onClick={() => void handleResumeMission(m)}
                      disabled={resumingTrace !== null}
                      className="inline-flex items-center gap-1 h-9 px-2.5 border border-[#0071e3]/30 bg-[#0071e3]/10 text-[13px] text-[#0071e3] hover:bg-[#0071e3]/15 transition-all cursor-pointer disabled:opacity-50 font-medium rounded-full"
                    >
                      <Play size={10} /> {resumingTrace === m.traceId ? "RESUMING…" : "RESUME"}
                    </button>
                    <Link href={`/dashboard/transactions/${m.orderId}`} className="inline-flex items-center gap-1 h-9 px-2 border border-black/[0.06] font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-neutral-500 hover:text-neutral-900 hover:border-black/[0.12] transition-all rounded-full">
                      <ExternalLink size={10} /> ORDER
                    </Link>
                  </>
                ) : (
                  <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.08em] uppercase text-neutral-400 px-1.5 py-0.5 border border-black/[0.06] rounded-full">NO ORDER</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 stagger-child">
        <div className="flex items-center gap-2">
          <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-neutral-400">ACTOR</span>
          <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value as ActorType | "all")} className="font-[var(--font-mono)] text-[14px] bg-white border border-black/[0.06] text-neutral-900 px-3 py-1.5 cursor-pointer h-9 rounded-[10px] focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20">
            {actorFilters.map((f) => (<option key={f.value} value={f.value}>{f.label}</option>))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-neutral-400">TYPE</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="font-[var(--font-mono)] text-[14px] bg-white border border-black/[0.06] text-neutral-900 px-3 py-1.5 cursor-pointer h-9 rounded-[10px] focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20">
            {eventTypeFilters.map((f) => (<option key={f} value={f}>{f}</option>))}
          </select>
        </div>
        <span className="font-[var(--font-mono)] text-[0.55rem] text-neutral-400">{filtered.length} events</span>
        <button
          onClick={handleExportCsv}
          disabled={filtered.length === 0}
          className="text-[13px] px-3 py-1.5 border border-black/[0.06] bg-transparent text-neutral-500 hover:text-neutral-900 hover:border-black/[0.12] transition-all cursor-pointer disabled:opacity-40 h-9 font-medium rounded-full"
        >
          EXPORT CSV
        </button>
      </div>

      {/* Saved views over the current actor/type filter pair */}
      <div className="flex flex-wrap items-center gap-2 stagger-child">
        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-neutral-400">SAVED VIEWS</span>
        <input
          value={viewName}
          onChange={(e) => setViewName(e.target.value)}
          placeholder="Name this view…"
          className="font-[var(--font-mono)] text-[14px] bg-white border border-black/[0.06] text-neutral-900 px-3 py-1.5 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] rounded-[10px] focus:ring-[3px] focus:ring-[#0071e3]/20"
        />
        <button
          onClick={() => {
            saveView(viewName, filterKey);
            setViewName("");
          }}
          disabled={!viewName.trim()}
          className="text-[13px] px-3 py-1.5 border border-[#0071e3]/30 bg-[#0071e3]/10 text-[#0071e3] hover:bg-[#0071e3]/15 transition-all cursor-pointer disabled:opacity-40 h-9 font-medium rounded-full"
        >
          SAVE CURRENT
        </button>
        {savedViews.map((v) => (
          <span key={v.name} className="inline-flex items-center gap-1 border border-black/[0.06] bg-white pl-2.5">
            <button
              onClick={() => {
                const [a, t] = v.value.split("|");
                if (a) setActorFilter(a as ActorType | "all");
                if (t) setTypeFilter(t);
              }}
              className="text-[13px] text-neutral-600 hover:text-neutral-900 py-1.5 cursor-pointer h-9 font-medium rounded-full"
              title={`Apply: ${v.value}`}
            >
              {v.name}
            </button>
            <button
              onClick={() => deleteView(v.name)}
              className="px-1.5 py-1.5 font-[var(--font-mono)] text-[0.6rem] text-neutral-400 hover:text-[#d92d20] cursor-pointer"
              aria-label={`Delete view ${v.name}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {missionMsg && (
        <div className={`px-4 py-3 border flex items-start gap-2 ${missionMsg.kind === "error" ? "border-[#d92d20]/20 bg-red-50" : "border-[#1f9d55]/20 bg-green-50"}`}>
          <span className={`font-[var(--font-mono)] text-[0.62rem] leading-relaxed ${missionMsg.kind === "error" ? "text-[#d92d20]" : "text-[#1f9d55]"}`}>
            {missionMsg.text}
          </span>
        </div>
      )}
      {loadError && (
        <ErrorBanner message={loadError} onRetry={() => void fetchData()} />
      )}

      {loading && events.length === 0 ? (
        <TableSkeleton rows={8} />
      ) : (
      <div className="border border-black/[0.06] overflow-hidden stagger-child rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
        {filtered.length === 0 ? (
          <EmptyState
            title={loading ? "Loading events…" : "No activity yet."}
            message={
              loading
                ? "Fetching the latest ledger events."
                : events.length === 0
                  ? "Events appear here once buyers interact with your store — run a checkout in AI Sales or launch a buyer mission above."
                  : "No events match the current filters."
            }
          />
        ) : filtered.map((event, i) => {
          const expanded = expandedIds.has(event.eventId);
          return (
          <div key={event.eventId} className={`hover-panel transition-colors ${i < filtered.length - 1 ? "border-b border-black/[0.05]" : ""}`}>
            <button
              onClick={() => toggleExpanded(event.eventId)}
              className="w-full text-left px-5 py-3.5 flex items-center gap-3 cursor-pointer"
              aria-expanded={expanded}
            >
              <span className="font-[var(--font-mono)] text-[0.55rem] text-neutral-400 w-[62px] shrink-0 tabular-nums">{formatTimestamp(event.timestamp)}</span>
              <span className="font-[var(--font-sans)] text-[0.85rem] text-neutral-900 flex-1 min-w-0 truncate">{actionLabel(event.action)}</span>
              <span className="hidden sm:inline shrink-0"><ActorBadge actor={event.actor} /></span>
              <span className={`font-[var(--font-mono)] text-[0.6rem] text-neutral-500 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
            </button>
            {expanded && (
            <div className="px-5 pb-4 ml-[74px] border-l border-black/[0.06] pl-4 space-y-3 expand-enter rounded-[12px]">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-400 mb-1">Actor</div>
                  <div className="flex items-center gap-2">
                    <ActorIcon actor={event.actor} />
                    <ActorBadge actor={event.actor} />
                  </div>
                </div>
                <div>
                  <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-400 mb-1">Action</div>
                  <div className="font-[var(--font-mono)] text-[0.7rem] text-neutral-900 break-all">{event.action}</div>
                </div>
              </div>
              <div>
                <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-400 mb-1">Trace</div>
                <div className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600 break-all">{event.traceId}</div>
              </div>
              {event.reasoningSummary && (
                <div>
                  <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-400 mb-1">Reasoning</div>
                  <div className="font-[var(--font-sans)] text-[0.8rem] text-neutral-600 leading-relaxed">{event.reasoningSummary}</div>
                </div>
              )}
              <div>
                <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-400 mb-1">Inputs / Output</div>
                <pre className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600 bg-white p-2 border border-black/[0.06] overflow-x-auto max-h-[240px] overflow-y-auto rounded-[12px]">
                  {JSON.stringify({ inputs: event.inputs, output: event.output }, null, 2)}
                </pre>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <div>
                  <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-400 mb-1">Policy refs</div>
                  <div className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600">{event.policyRefs.length > 0 ? event.policyRefs.join(", ") : "—"}</div>
                </div>
                <div>
                  <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-400 mb-1">Provider ref</div>
                  <div className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600">{event.provider_ref ?? "—"}</div>
                </div>
                {event.flags.length > 0 && (
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-neutral-400 mb-1">Flags</div>
                    <div className="flex flex-wrap gap-1.5">
                      {event.flags.map((flag) => (
                        <span key={flag} className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 bg-[#0071e3]/10 text-[#0071e3]">{flag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}
          </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
