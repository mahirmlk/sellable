"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Loader2,
  CheckCircle2,
  Wallet,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Copy,
  ArrowRight,
  History,
  PanelLeft,
  SquarePen,
  XCircle,
  AlertTriangle,
  CircleCheck,
  Info,
} from "lucide-react";
import { formatPaise } from "@/lib/formatters";
import {
  ApiError,
  getConsoleCatalog,
  getConsolePolicy,
  getConsoleTransactionDetail,
  consoleSellerRespond,
  consoleCreateOrder,
  consoleRequestConsent,
  consoleStartPayment,
  consoleRetryPayment,
  refundOrder,
  simulatePaymentCapture,
  simulatePaymentFailure,
  getCheckoutSession,
  saveCheckoutSession,
  closeCheckoutSession,
  listCheckoutSessions,
  getCheckoutSessionById,
  archiveCheckoutSession,
  deleteCheckoutSession,
  type CheckoutSession,
  type CheckoutSessionListItem,
  type CheckoutSessionStatus,
  type SellerDecisionPayload,
  type IntentMandate,
  type ConsentInfo,
  type PaymentAttemptPayload,
  type OrderCreateResult,
  type ConsolePolicySettings,
} from "@/lib/api";
import ChatHistory from "@/components/dashboard/chat-history";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CartCard,
  ConsentCard,
  FieldRow,
  PolicyCard,
  ReceiptCard,
} from "@/components/dashboard/chat-commerce-cards";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ChatPhase =
  | "idle"
  | "thinking"
  | "quote"
  | "checkout"
  | "approval"
  | "consent"
  | "payment"
  | "receipt"
  | "failed"
  | "aborted";

interface ChatMessage {
  id: string;
  role: "user" | "seller" | "system";
  text: string;
  status?: "info" | "success" | "error" | "warning";
  toolCalls?: string[];
}

let uidCounter = 0;
function uid(prefix = "msg"): string {
  uidCounter += 1;
  return `${prefix}_${Date.now()}_${uidCounter}`;
}

const DEMO_MODE = process.env.NEXT_PUBLIC_AGENT_KEY === "sellable_demo_key_001";
const PAYMENT_TERMINAL = ["PAID", "FULFILLED", "PAYMENT_FAILED", "ABORTED", "REFUNDED"];

/** Lifecycle progress for the header stepper, derived only from the phase. */
function phaseProgress(phase: ChatPhase): { idx: number; tone: "active" | "blocked" | "failed" | "done" } | null {
  switch (phase) {
    case "thinking": return { idx: 0, tone: "active" };
    case "quote": return { idx: 0, tone: "done" };
    case "checkout": return { idx: 1, tone: "active" };
    case "approval": return { idx: 1, tone: "blocked" };
    case "consent": return { idx: 2, tone: "active" };
    case "payment": return { idx: 3, tone: "active" };
    case "receipt": return { idx: 3, tone: "done" };
    case "failed": return { idx: 3, tone: "failed" };
    case "aborted": return { idx: 2, tone: "failed" };
    default: return null;
  }
}

const PHASE_STEPS = ["QUOTE", "ORDER", "CONSENT", "PAID"] as const;

function PhaseStepper({ phase }: { phase: ChatPhase }) {
  const progress = phaseProgress(phase);
  if (!progress) return null;
  const dotTone: Record<string, string> = {
    done: "bg-green-600",
    active: "bg-ink animate-[blink_1.5s_ease-in-out_infinite]",
    blocked: "bg-amber-600",
    failed: "bg-red-600",
  };
  const textTone: Record<string, string> = {
    done: "text-neutral-600",
    active: "text-neutral-900",
    blocked: "text-amber-600",
    failed: "text-red-600",
  };
  return (
    <div className="hidden md:flex items-center gap-2" aria-label="Checkout lifecycle progress">
      {PHASE_STEPS.map((step, i) => {
        const state =
          i < progress.idx ? "done" : i === progress.idx ? progress.tone : "todo";
        const active = state !== "todo";
        return (
          <div key={step} className="flex items-center gap-2">
            {i > 0 && <span className={`w-[14px] h-px ${active ? "bg-black/[0.12]" : "bg-black/[0.06]"}`} />}
            <span className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${state === "todo" ? "bg-black/[0.06]" : dotTone[state]}`} />
              <span
                className={`font-[var(--font-mono)] text-[0.5rem] tracking-[0.12em] uppercase ${
                  state === "todo" ? "text-neutral-400" : textTone[state]
                }`}
              >
                {step}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* Message tool chips use the shadcn Badge inline in the seller bubble footer. */
/* Cart, policy, consent, and receipt visuals live in
   components/dashboard/chat-commerce-cards.tsx (shadcn Card + Badge). */

/** Most-recent visible session: ACTIVE rows first, then by recency. */
function pickMostRecentSession(
  pool: CheckoutSessionListItem[]
): CheckoutSessionListItem | null {
  if (pool.length === 0) return null;
  const byRecency = (a: CheckoutSessionListItem, b: CheckoutSessionListItem) =>
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  const active = pool.filter((item) => item.status === "ACTIVE").sort(byRecency);
  if (active.length > 0) return active[0];
  return [...pool].sort(byRecency)[0] ?? null;
}

export default function ChatPageInner() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [budgetPaise, setBudgetPaise] = useState(600000);
  // Draft vs applied: typing must never silently move the session ceiling.
  // Only Apply validates and commits the draft into budgetPaise, which is
  // what buildIntent sends as the buyer-side budget_ceiling_paise.
  const [budgetDraft, setBudgetDraft] = useState("6000");
  const [budgetMsg, setBudgetMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [categories, setCategories] = useState<string[]>(["accessories", "gifting", "snacks"]);
  const [upsellOn, setUpsellOn] = useState(true);
  const [decision, setDecision] = useState<SellerDecisionPayload | null>(null);
  const [intent, setIntent] = useState<IntentMandate | null>(null);
  const [order, setOrder] = useState<OrderCreateResult | null>(null);
  const [consent, setConsent] = useState<ConsentInfo | null>(null);
  const [payment, setPayment] = useState<PaymentAttemptPayload | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [negotiating, setNegotiating] = useState(false);
  const [offerInput, setOfferInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [policy, setPolicy] = useState<ConsolePolicySettings | null>(null);
  const [catalogEmpty, setCatalogEmpty] = useState<boolean | null>(null);
  // Durable checkout session (server-persisted; React state is only a cache).
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "saving" | "error">("idle");
  const restoringRef = useRef(false);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  // Set at the end of a restore: the state updates it triggers would
  // otherwise fire one redundant snapshot POST (harmless, but it pointlessly
  // bumps updated_at and reorders history). Skipped exactly once.
  const justRestoredRef = useRef(false);
  // Chat history rail state: desktop show/hide + a mobile drawer.
  const [sessions, setSessions] = useState<CheckoutSessionListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyUnsupported, setHistoryUnsupported] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyDrawer, setHistoryDrawer] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const showArchivedRef = useRef(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<CheckoutSessionStatus | null>(null);
  const [viewingHistory, setViewingHistory] = useState(false);
  const historyUnsupportedRef = useRef(false);
  const sessionsRef = useRef<CheckoutSessionListItem[]>([]);
  const restoreRunRef = useRef(0);
  const lastOpenedIdRef = useRef<string | null>(null);
  const nearBottomRef = useRef(true);
  const sendLockRef = useRef(false);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const sessionMessageRef = useRef<string>("");
  const lastTraceIdRef = useRef<string | null>(null);
  const offerRef = useRef<number | null>(null);
  // SKU of the quoted product: negotiation and checkout must re-quote the
  // SAME catalog item (a message-only re-search can drift to another match).
  const skuRef = useRef<string | null>(null);
  const abortPollRef = useRef<boolean>(false);
  const pollTimerRef = useRef<number | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sessionKeyRef = useRef<string>("");
  const phaseRef = useRef<ChatPhase>("idle");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stopPolling = useCallback(() => {
    // Synchronously kill any in-flight poll: the flag alone is not enough
    // because a new poll resets it while the old interval is still alive.
    abortPollRef.current = true;
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  // Reset all working (React-state) chat state to a blank slate. Used by NEW
  // SESSION and before applying a restored session — it never touches the
  // server, so switching history items cannot create or close rows.
  const clearWorkingState = useCallback(() => {
    stopPolling();
    setCheckoutSessionId(null);
    lastSavedSnapshotRef.current = null;
    justRestoredRef.current = false;
    setSessionStatus(null);
    setSyncState("idle");
    setBudgetMsg(null);
    setMessages([]);
    setDecision(null);
    setIntent(null);
    setOrder(null);
    setConsent(null);
    setPayment(null);
    setOrderStatus(null);
    setPhase("idle");
    setNegotiating(false);
    setOfferInput("");
    setBusy(false);
    setBudgetPaise(600000);
    setBudgetDraft("6000");
    sessionMessageRef.current = "";
    lastTraceIdRef.current = null;
    offerRef.current = null;
    skuRef.current = null;
    sessionKeyRef.current = uid("session");
  }, [stopPolling]);

  // Best-effort history refresh. No-op once the list endpoint is known to be
  // missing; never throws into callers.
  const refreshHistory = useCallback(async (opts?: { includeArchived?: boolean }) => {
    if (historyUnsupportedRef.current) return;
    try {
      const list = await listCheckoutSessions({
        include_archived: opts?.includeArchived ?? showArchivedRef.current,
      });
      if (list === null) {
        historyUnsupportedRef.current = true;
        setHistoryUnsupported(true);
        return;
      }
      setSessions(list);
    } catch {
      // History is best-effort: keep the stale list rather than hiding it.
    }
  }, []);

  const handleToggleArchived = useCallback(() => {
    const next = !showArchivedRef.current;
    setShowArchived(next);
    showArchivedRef.current = next;
    void refreshHistory({ includeArchived: next });
  }, [refreshHistory]);

  const resetSession = useCallback(async () => {
    // NEW SESSION explicitly abandons the durable row first. If the close
    // fails, abort the reset loudly and keep working state — never silently
    // fork or strand the server-side session.
    if (checkoutSessionId) {
      try {
        await closeCheckoutSession(checkoutSessionId);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            text: "Could not close the previous checkout session on the server. Your current session is intact — try NEW SESSION again.",
            status: "error",
          },
        ]);
        return;
      }
    }
    clearWorkingState();
    lastOpenedIdRef.current = null;
    setViewingHistory(false);
    setSessionError(null);
    setLoadingSession(false);
    router.replace("/dashboard/chat");
    void refreshHistory();
  }, [clearWorkingState, checkoutSessionId, router, refreshHistory]);

  useEffect(() => {
    getConsolePolicy()
      .then((p) => {
        setPolicy(p);
        setCategories(p.allowed_categories.length > 0 ? p.allowed_categories : ["accessories", "gifting", "snacks"]);
      })
      .catch(() => {});
    getConsoleCatalog()
      .then((items) => setCatalogEmpty(items.length === 0))
      .catch(() => setCatalogEmpty(null));
    return () => {
      abortPollRef.current = true;
    };
  }, []);

  // Scroll follows new messages only while the user is already near the
  // bottom (~120px threshold) — opening a session forces a jump to bottom,
  // but reading history is never yanked. The message column owns its scroll;
  // nothing here may cause page-level scrolling.
  const handleListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    if (nearBottomRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, phase, loadingSession]);

  const applyBudget = useCallback(() => {
    const rupees = parseFloat(budgetDraft);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setBudgetMsg({ kind: "error", text: "Enter a positive budget amount." });
      return;
    }
    const paise = Math.round(rupees * 100);
    if (!Number.isSafeInteger(paise) || paise <= 0) {
      setBudgetMsg({ kind: "error", text: "Enter a positive budget amount." });
      return;
    }
    setBudgetPaise(paise);
    setBudgetDraft(String(Math.round(paise / 100)));
    setBudgetMsg({ kind: "ok", text: `Budget updated to ${formatPaise(paise)}.` });
  }, [budgetDraft]);

  const buildIntent = useCallback(
    (message: string): IntentMandate => ({
      mandate_id: `im_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`,
      buyer_agent_id: "human_chat",
      budget_ceiling_paise: budgetPaise,
      allowed_categories: categories,
      purpose: message.slice(0, 280),
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    [budgetPaise, categories]
  );

  const pollOrder = useCallback(
    (orderId: string) => {
      // Never run two polls at once: a late webhook for a previous order
      // must not flip a newer session into receipt/failed.
      stopPolling();
      abortPollRef.current = false;
      const timer = window.setInterval(async () => {
        if (abortPollRef.current) {
          window.clearInterval(timer);
          return;
        }
        try {
          const detail = await getConsoleTransactionDetail(orderId);
          setOrderStatus(detail.status);
          if (PAYMENT_TERMINAL.includes(detail.status)) {
            window.clearInterval(timer);
            if (detail.status === "PAID" || detail.status === "FULFILLED" || detail.status === "REFUNDED") {
              if (detail.payment_status) {
                setPayment((prev) => (prev ? { ...prev, status: detail.payment_status as PaymentAttemptPayload["status"], provider_payment_id: detail.payment_id || prev.provider_payment_id } : prev));
              }
              setPhase("receipt");
            } else if (detail.status === "PAYMENT_FAILED") {
              setPhase("failed");
            } else if (detail.status === "ABORTED") {
              setPhase("aborted");
            }
          } else if (detail.status === "AWAITING_CONSENT" && phaseRef.current === "approval") {
            // Merchant approved the held order and consent was issued server-side.
            if (detail.consent_id && detail.consent_status === "ISSUED") {
              window.clearInterval(timer);
              setConsent({
                consent_id: detail.consent_id,
                order_id: orderId,
                amount_paise: detail.amount_paise,
                payee_id: detail.merchant_id,
                purpose: "single_transaction",
                expires_at: detail.consent_expires_at || new Date().toISOString(),
                single_use: true,
                status: "ISSUED",
              });
              setPhase("consent");
            }
          }
        } catch {
          // transient network errors are tolerated while polling
        }
      }, 2500);
      pollTimerRef.current = timer;
      // The watchdog must be tracked too: an untracked timeout can fire
      // after a newer poll started (timer ids get reused) and kill it.
      pollTimeoutRef.current = window.setTimeout(() => {
        window.clearInterval(timer);
        if (pollTimerRef.current === timer) pollTimerRef.current = null;
      }, 5 * 60 * 1000);
    },
    [stopPolling]
  );

  // Terminal sessions opened from history are read-only: the linked order is
  // settled (or the session row is closed), so the composer and every
  // money-moving button stay disabled with an explanatory note. Replay and
  // transaction links keep working; payment is never restarted from a
  // completed session. The live working session is unaffected (refunds and
  // follow-up messages there keep existing behavior).
  // (Declared here — above persistSession — so the saver can skip read-only
  // rows without a use-before-declaration error.)
  const isTerminal =
    sessionStatus === "COMPLETED" ||
    sessionStatus === "ABANDONED" ||
    (orderStatus !== null && ["PAID", "FULFILLED", "REFUNDED"].includes(orderStatus));
  const readOnly = viewingHistory && isTerminal;

  // Persist the working session after every meaningful change. Money state
  // always lives in the order row — this snapshot only lets the console
  // restore transcript, quote display, budget, and order linkage.
  const persistSession = useCallback(async () => {
    if (restoringRef.current) return;
    if (justRestoredRef.current) {
      justRestoredRef.current = false;
      return;
    }
    // Historical (read-only) sessions must never be written back: the row is
    // closed server-side and a POST would 409. Opening history stays GET-only.
    if (readOnly) return;
    if (messages.length === 0 && !decision && !order) return;
    const snapshot = {
      session_id: checkoutSessionId ?? undefined,
      buyer_ref: "human_chat",
      budget_paise: budgetPaise,
      message: sessionMessageRef.current || undefined,
      trace_id: lastTraceIdRef.current ?? undefined,
      cart: (decision?.cart ?? null) as Record<string, unknown> | null,
      decision: decision
        ? {
            action: decision.action,
            response_message: decision.response_message,
            cart: decision.cart,
            policy_decision: decision.policy_decision,
            tool_calls: decision.tool_calls ?? [],
          }
        : null,
      order_id: order?.order_id ?? undefined,
      messages: messages.map((m) => ({
        role: m.role,
        text: m.text,
        status: m.status ?? null,
        tool_calls: m.toolCalls ?? null,
      })),
      status: (phaseRef.current === "receipt" && order ? "COMPLETED" : undefined) as
        | "COMPLETED"
        | undefined,
    };
    // Restores (and any re-render with identical content) must not rewrite
    // the row: every write bumps updated_at and would reorder history.
    const fingerprint = JSON.stringify(snapshot);
    if (lastSavedSnapshotRef.current === fingerprint) return;
    const hadId = checkoutSessionId != null;
    setSyncState("saving");
    try {
      const saved = await saveCheckoutSession(snapshot);
      setCheckoutSessionId(saved.session_id);
      lastSavedSnapshotRef.current = fingerprint;
      setSyncState("idle");
      // First snapshot of a brand-new session: make it appear in history and
      // pin it in the URL so reload/share keeps this exact session.
      if (!hadId) {
        router.replace(`/dashboard/chat?session=${encodeURIComponent(saved.session_id)}`);
        void refreshHistory();
      }
    } catch {
      // Persistence is best-effort per action (the order itself is always
      // persisted); the header badge shows the failure honestly and the next
      // action retries.
      setSyncState("error");
    }
  }, [checkoutSessionId, messages, decision, order, budgetPaise, phase, readOnly, refreshHistory, router]);

  useEffect(() => {
    void persistSession();
  }, [persistSession]);

  // Restore a durable session object into working state: transcript + quote
  // display from the snapshot, authoritative state (status, amounts, consent,
  // payment link) re-read from the linked order. Shared by mount and history
  // selection. Read-only until the user acts — restoring never creates
  // orders, consents, payments, or sessions, and never calls the seller LLM.
  // A null session renders the empty state ("Start a new checkout session").
  const restoreSession = useCallback(
    async (s: CheckoutSession | null) => {
      const run = (restoreRunRef.current += 1);
      const alive = () => restoreRunRef.current === run;
      restoringRef.current = true;
      setLoadingSession(true);
      setSessionError(null);
      clearWorkingState();
      // Opening any session jumps to the bottom; subsequent messages follow
      // the near-bottom rule so history reading is never yanked.
      nearBottomRef.current = true;
      try {
        if (!s) {
          if (!alive()) return;
          lastOpenedIdRef.current = null;
          return;
        }
        if (!alive()) return;
        setCheckoutSessionId(s.session_id);
        setSessionStatus(s.status);
        lastOpenedIdRef.current = s.session_id;
        if (typeof s.budget_paise === "number" && s.budget_paise > 0) {
          setBudgetPaise(s.budget_paise);
          setBudgetDraft(String(Math.round(s.budget_paise / 100)));
        }
        if (s.message) sessionMessageRef.current = s.message;
        if (s.trace_id) lastTraceIdRef.current = s.trace_id;
        if (Array.isArray(s.messages) && s.messages.length > 0) {
          setMessages(
            s.messages.map((m) => ({
              id: uid(),
              role: m.role === "user" || m.role === "seller" ? m.role : "system",
              text: m.text,
              status: (m.status as ChatMessage["status"]) ?? undefined,
              toolCalls: Array.isArray(m.toolCalls)
                ? m.toolCalls.filter((t): t is string => typeof t === "string")
                : undefined,
            }))
          );
        }
        const storedDecision =
          s.decision && typeof s.decision === "object" && typeof (s.decision as { action?: unknown }).action === "string"
            ? (s.decision as unknown as SellerDecisionPayload)
            : null;
        if (storedDecision) {
          setDecision(storedDecision);
          // Restore-safe negotiation state: a persisted negotiated cart
          // (round > 0, offered < unit) deterministically reconstructs the
          // buyer offer so follow-up turns and checkout keep the same price.
          const c = storedDecision.cart;
          const item = c?.items?.[0] ?? null;
          if (item) {
            skuRef.current = item.sku;
            if ((c?.negotiation_round ?? 0) > 0 && item.offered_price_paise < item.unit_price_paise) {
              offerRef.current = item.offered_price_paise;
            }
          }
        }
        if (s.order_id) {
          try {
            const detail = await getConsoleTransactionDetail(s.order_id);
            if (!alive()) return;
            setOrder({
              order_id: detail.order_id,
              trace_id: detail.trace_id,
              status: detail.status,
              amount_paise: detail.amount_paise,
              quote_id: detail.quote_id,
              idempotency_key: detail.idempotency_key,
            });
            setOrderStatus(detail.status);
            if (detail.status === "PAID" || detail.status === "FULFILLED" || detail.status === "REFUNDED") {
              if (detail.payment_status) {
                setPayment({
                  attempt_id: "",
                  order_id: detail.order_id,
                  provider: "razorpay",
                  provider_order_id: detail.payment_order_id || "",
                  provider_payment_id: detail.payment_id ?? null,
                  payment_url: detail.payment_url || null,
                  status: "CAPTURED",
                  idempotency_key: detail.idempotency_key,
                  failure_reason: null,
                  created_at: detail.created_at,
                });
              }
              setPhase("receipt");
            } else if (detail.status === "PAYMENT_FAILED") {
              setPhase("failed");
            } else if (detail.status === "ABORTED") {
              setPhase("aborted");
            } else if (detail.status === "PAYMENT_PENDING" || detail.status === "CONSENTED") {
              setPayment({
                attempt_id: "",
                order_id: detail.order_id,
                provider: "razorpay",
                provider_order_id: detail.payment_order_id || "",
                provider_payment_id: detail.payment_id ?? null,
                payment_url: detail.payment_url || null,
                status: "PAYMENT_PENDING",
                idempotency_key: detail.idempotency_key,
                failure_reason: null,
                created_at: detail.created_at,
              });
              // CONSENTED with no recorded link (or a pre-URL order) means a
              // previous start did not finish: nothing was charged — only a
              // verified webhook settles — and there is no consent left to
              // spend, so PAY stays disabled until a fresh checkout.
              if (!detail.payment_url) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: uid(),
                    role: "system",
                    text: "Restored an interrupted payment start: no payment link was recorded and nothing was charged. Start a new checkout to retry — this order cannot be paid from here.",
                    status: "warning",
                  },
                ]);
              }
              setPhase("payment");
              pollOrder(detail.order_id);
            } else if (detail.status === "AWAITING_CONSENT" && detail.consent_id) {
              setConsent({
                consent_id: detail.consent_id,
                order_id: detail.order_id,
                amount_paise: detail.amount_paise,
                payee_id: detail.merchant_id,
                purpose: "single_transaction",
                expires_at: detail.consent_expires_at || new Date().toISOString(),
                single_use: true,
                status: "ISSUED",
              });
              setPhase("consent");
            } else if (
              detail.status === "AWAITING_CONSENT" &&
              detail.policy_verdict === "NEEDS_HUMAN_APPROVAL"
            ) {
              setPhase("approval");
              pollOrder(detail.order_id);
            } else if (storedDecision) {
              setPhase("quote");
            }
          } catch {
            // Linked order unreadable (deleted data, backend down): keep the
            // snapshot display so the transcript/cart are not lost.
            if (storedDecision) setPhase("quote");
          }
        } else if (storedDecision) {
          setPhase("quote");
        }
      } catch {
        // Backend unreachable on load: the blank console below (with its own
        // empty state) stands in; the next user action creates the session.
      } finally {
        if (alive()) {
          restoringRef.current = false;
          // Suppress the single auto-save that this restore's own state
          // updates would otherwise trigger (see justRestoredRef).
          justRestoredRef.current = true;
          setLoadingSession(false);
        }
      }
    },
    [clearWorkingState, pollOrder]
  );

  // Open the most recent visible session (active first, then by recency),
  // or the empty state when none can be opened. Used after mount fallback,
  // archive, and delete. GET-only: never creates a session or calls the LLM.
  const openMostRecent = useCallback(
    async (excludeId?: string) => {
      const pool = (sessionsRef.current ?? []).filter(
        (item) => !item.archived && item.session_id !== excludeId
      );
      const next = pickMostRecentSession(pool);
      if (!next) {
        router.replace("/dashboard/chat");
        setViewingHistory(false);
        await restoreSession(null);
        return;
      }
      let full: CheckoutSession | null = null;
      try {
        full = await getCheckoutSessionById(next.session_id);
      } catch {
        full = null;
      }
      if (full) {
        router.replace(`/dashboard/chat?session=${encodeURIComponent(full.session_id)}`);
        setViewingHistory(true);
        await restoreSession(full);
      } else {
        setSessionError(
          "That chat session is unavailable (moved, archived, or from another merchant). Start a new session below."
        );
        router.replace("/dashboard/chat");
        setViewingHistory(false);
        await restoreSession(null);
      }
    },
    [router, restoreSession]
  );

  // Mount: ?session=<id> wins when valid; else the most-recent ACTIVE row;
  // else the empty state. 404/foreign ids show a notice and fall back to
  // most-recent. StrictMode-safe: double-invoked GETs collapse via the
  // restore run guard, and no effect here may POST (persistence stays on the
  // existing persist-on-action path only).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("session");
      let list: CheckoutSessionListItem[] | null = null;
      try {
        list = await listCheckoutSessions();
      } catch {
        // Network/backend error on the list route: degrade to the legacy
        // single-session path rather than a blank console.
        list = null;
      }
      if (cancelled) return;
      if (list !== null) {
        setSessions(list);
        setHistoryUnsupported(false);
        historyUnsupportedRef.current = false;
        setHistoryLoading(false);
        if (requested) {
          let found: CheckoutSession | null = null;
          try {
            found = await getCheckoutSessionById(requested);
          } catch {
            found = null;
          }
          if (cancelled) return;
          if (found) {
            setViewingHistory(true);
            await restoreSession(found);
            return;
          }
          setSessionError(
            "That chat session is unavailable (moved, archived, or from another merchant). Showing the most recent session instead."
          );
        }
        const visible = list.filter((item) => !item.archived);
        const mostRecent = pickMostRecentSession(visible);
        if (mostRecent) {
          let full: CheckoutSession | null = null;
          try {
            full = await getCheckoutSessionById(mostRecent.session_id);
          } catch {
            full = null;
          }
          if (cancelled) return;
          if (full) {
            router.replace(`/dashboard/chat?session=${encodeURIComponent(full.session_id)}`);
            setViewingHistory(true);
            await restoreSession(full);
            return;
          }
          if (!requested) {
            // List worked but the full row is unreadable: try the legacy
            // active-session route before giving up.
            try {
              const legacy = await getCheckoutSession();
              if (cancelled) return;
              setViewingHistory(false);
              await restoreSession(legacy);
              return;
            } catch {
              if (cancelled) return;
            }
          }
        }
        if (requested) {
          await openMostRecent(requested);
          return;
        }
        setViewingHistory(false);
        await restoreSession(null);
        return;
      }
      // Legacy backend (history routes not deployed): single active session.
      historyUnsupportedRef.current = true;
      setHistoryUnsupported(true);
      setHistoryLoading(false);
      try {
        const s = await getCheckoutSession();
        if (cancelled) return;
        setViewingHistory(false);
        await restoreSession(s);
      } catch {
        if (cancelled) return;
        setViewingHistory(false);
        await restoreSession(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only: route changes must not re-run session resolution (selection
    // loads explicitly via handleSelectSession, also GET-only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // History selection: reflect in the URL without navigation, then load that
  // exact session through the shared restore path. GET-only — never creates a
  // session and never triggers an LLM/seller call.
  const handleSelectSession = useCallback(
    async (id: string) => {
      if (id === checkoutSessionId || loadingSession) return;
      lastOpenedIdRef.current = id;
      router.replace(`/dashboard/chat?session=${encodeURIComponent(id)}`);
      let full: CheckoutSession | null = null;
      try {
        full = await getCheckoutSessionById(id);
      } catch {
        full = null;
      }
      if (!full) {
        setSessionError(
          "That chat session is unavailable (moved, archived, or from another merchant). Showing the most recent session instead."
        );
        await openMostRecent(id);
        return;
      }
      setViewingHistory(true);
      await restoreSession(full);
    },
    [checkoutSessionId, loadingSession, router, restoreSession, openMostRecent]
  );

  const handleArchiveSession = useCallback(
    async (id: string) => {
      try {
        await archiveCheckoutSession(id);
      } catch {
        setSessionError("Could not archive that session. Try again.");
        return;
      }
      setSessions((prev) =>
        prev.map((item) => (item.session_id === id ? { ...item, archived: true } : item))
      );
      if (id === checkoutSessionId) await openMostRecent(id);
      else void refreshHistory();
    },
    [checkoutSessionId, openMostRecent, refreshHistory]
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await deleteCheckoutSession(id);
      } catch {
        setSessionError("Could not delete that session. Try again.");
        return;
      }
      // The DELETE route archives server-side (commerce rows are never
      // destroyed); drop it from the visible list immediately.
      setSessions((prev) => prev.filter((item) => item.session_id !== id));
      if (id === checkoutSessionId) await openMostRecent(id);
      else void refreshHistory();
    },
    [checkoutSessionId, openMostRecent, refreshHistory]
  );

  const runRespond = useCallback(
    async (message: string, opts: { upsell: boolean; offer?: number | null; sku?: string | null; isFollowUp?: boolean; accept?: boolean }) => {
      setBusy(true);
      try {
        const i = buildIntent(message);
        setIntent(i);
        const result = await consoleSellerRespond({
          message,
          intent: i,
          request_upsell: opts.upsell,
          buyer_offer_paise: opts.offer ?? null,
          requested_sku: opts.sku ?? null,
          accept_upsell: opts.accept ?? false,
          // Reuse the session trace: negotiation rounds must not fork fresh
          // traces — Activity and Replay show one consistent flow.
          trace_id: lastTraceIdRef.current ?? undefined,
        });
        sessionMessageRef.current = message;
        lastTraceIdRef.current = result.trace_id;
        const quotedSku =
          result.selected_product?.sku ?? result.cart?.items[0]?.sku ?? null;
        if (quotedSku) skuRef.current = quotedSku;
        setDecision(result);
        setUpsellOn(opts.upsell);
        // Always render the agent's reply — a first-message NO_MATCH must
        // never disappear silently.
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "seller", text: result.response_message, toolCalls: result.tool_calls },
        ]);
        if (result.action === "NO_MATCH") {
          const noResults =
            "Nothing in your catalog matched that request. Add products in the Catalog page, then ask again — the agent only sells what you actually stock.";
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: "system", text: noResults, status: "warning" },
          ]);
          setPhase("idle");
        } else {
          setPhase("quote");
        }
      } catch (err) {
        const detail =
          err instanceof ApiError ? err.detail : "The Seller Agent is unavailable right now.";
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            text: `Seller Agent request failed: ${detail}`,
            status: "error",
          },
        ]);
        setPhase("idle");
      } finally {
        setBusy(false);
      }
    },
    [buildIntent]
  );

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy || readOnly || sendLockRef.current) return;
      // Synchronous send-lock: React's async `busy` flip leaves a
      // double-submit window (double-click / Enter+button) that would append
      // the user message twice and fire two seller calls.
      sendLockRef.current = true;
      // A real user action always persists: cancel any restore-suppression
      // so this message is snapshotted even if it is the first post-restore
      // change.
      justRestoredRef.current = false;
      // A new message starts a new session: stop the previous order's poll
      // and drop its cached offer so neither leaks into the new flow.
      stopPolling();
      offerRef.current = null;
      sessionKeyRef.current = uid("session");
      setMessages((prev) => [...prev, { id: uid(), role: "user", text: trimmed }]);
      setInput("");
      setPhase("thinking");
      setDecision(null);
      setOrder(null);
      setConsent(null);
      setPayment(null);
      setOrderStatus(null);
      try {
        await runRespond(trimmed, { upsell: upsellOn, isFollowUp: false });
      } finally {
        sendLockRef.current = false;
      }
    },
    [busy, runRespond, upsellOn, stopPolling, readOnly]
  );

  const handleUpsellToggle = useCallback(async () => {
    if (readOnly || busy) return;
    const message = sessionMessageRef.current || "I need a product for my desk.";
    const next = !upsellOn;
    setUpsellOn(next);
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: "system",
        text: next ? "Adding the compatible upsell and re-checking policy…" : "Removing the upsell and re-checking policy…",
        status: "info",
      },
    ]);
    await runRespond(message, { upsell: next, offer: offerRef.current, sku: null, isFollowUp: true, accept: next });
  }, [upsellOn, runRespond, busy, readOnly]);

  const handleNegotiate = useCallback(async () => {
    const paise = Math.round(parseFloat(offerInput) * 100);
    if (!paise || paise <= 0 || busy || readOnly) return;
    // A restored session may not have re-sent the original message; the
    // offer itself is always a valid minimum request payload.
    const message = sessionMessageRef.current || `Offer for ${skuRef.current ?? "your product"}`;
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: "user",
        text: `Can you do ${formatPaise(paise)}?`,
      },
    ]);
    setOfferInput("");
    setNegotiating(false);
    setPhase("thinking");
    offerRef.current = paise;
    await runRespond(message, { upsell: upsellOn, offer: paise, sku: skuRef.current, isFollowUp: true });
  }, [offerInput, busy, upsellOn, runRespond, readOnly]);

  const handleCheckout = useCallback(async () => {
    // No `intent` guard: the fresh intent is rebuilt below, so a restored
    // quote (which never persisted its intent) checks out fine.
    if (readOnly || !decision || busy) return;
    setBusy(true);
    setPhase("checkout");
    try {
      // Rebuild the intent at checkout time so Apply-after-quote is
      // honored: the stored intent was minted when the quote was requested
      // and would otherwise carry a stale budget ceiling to order creation.
      const freshIntent = buildIntent(sessionMessageRef.current);
      setIntent(freshIntent);
      // Checkout must re-evaluate the SAME negotiated quote the seller
      // returned. The in-session offer lives in offerRef; after a restore
      // it is reconstructed deterministically from the persisted cart
      // (a negotiated cart always shows offered < unit and round > 0).
      const firstItem = decision.cart?.items[0] ?? null;
      const negotiatedCart =
        decision.cart !== null &&
        decision.cart.negotiation_round > 0 &&
        firstItem !== null &&
        firstItem.offered_price_paise < firstItem.unit_price_paise;
      const effectiveOffer =
        offerRef.current ??
        (negotiatedCart && firstItem ? firstItem.offered_price_paise : null);
      const effectiveSku = skuRef.current ?? firstItem?.sku ?? null;
      const effectiveQuantity = firstItem?.quantity ?? 1;
      // Reload retry must not mint a duplicate order: when the restored
      // order already covers this exact cart on this trace, reuse its
      // idempotency key so the backend replays it instead of duplicating.
      const replayingRestoredOrder =
        order !== null &&
        decision.cart !== null &&
        order.amount_paise === decision.cart.total_paise &&
        (lastTraceIdRef.current ?? null) === order.trace_id;
      const result = await consoleCreateOrder({
        intent: freshIntent,
        message: sessionMessageRef.current,
        idempotency_key: replayingRestoredOrder
          ? order.idempotency_key
          : `idem_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        request_upsell: upsellOn,
        trace_id: lastTraceIdRef.current || undefined,
        requested_sku: effectiveSku,
        quantity: effectiveQuantity,
        buyer_offer_paise: effectiveOffer,
      });
      setOrder(result);
      if (result.requires_approval) {
        setPhase("approval");
        pollOrder(result.order_id);
      } else {
        const c = await consoleRequestConsent(result.order_id);
        setConsent(c);
        setPhase("consent");
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "system",
          text: "The order could not be created because a backend policy blocked it. Review the policy decision above.",
          status: "error",
        },
      ]);
      setPhase("quote");
    } finally {
      setBusy(false);
    }
  }, [decision, busy, upsellOn, pollOrder, buildIntent, order, readOnly]);

  const handlePay = useCallback(async () => {
    if (readOnly || !order || !consent || busy) return;
    setBusy(true);
    setPhase("payment");
    try {
      const attempt = await consoleStartPayment(order.order_id, consent.consent_id);
      setPayment(attempt);
      // The backend returns a hosted Razorpay Payment Link — the browser never
      // holds payment credentials and can never mark the order PAID itself.
      if (attempt.payment_url) {
        const opened = window.open(attempt.payment_url, "_blank", "noopener,noreferrer");
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            text: opened
              ? "Razorpay test-mode payment link opened in a new tab. Complete the test payment there — this order stays PAYMENT_PENDING until the signed webhook settles it."
              : "Popup blocked: the payment link could not open automatically. Use REOPEN PAYMENT LINK below to complete the test payment.",
            status: "info",
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            text: "Payment started, but no payment link was returned. Awaiting provider confirmation.",
            status: "warning",
          },
        ]);
      }
      pollOrder(order.order_id);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : "Razorpay test-mode credentials or connectivity may be unavailable.";
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "system", text: `Payment could not be started: ${detail}`, status: "error" },
      ]);
      setPhase("consent");
    } finally {
      setBusy(false);
    }
  }, [order, consent, busy, pollOrder, readOnly]);

  const handleRetry = useCallback(async () => {
    if (readOnly || !order || busy) return;
    setBusy(true);
    setPhase("payment");
    try {
      const attempt = await consoleRetryPayment(order.order_id);
      setPayment(attempt);
      if (attempt.payment_url) {
        const opened = window.open(attempt.payment_url, "_blank", "noopener,noreferrer");
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            text: opened
              ? "A single bounded retry was started — a fresh payment link is open in a new tab. The order is again awaiting a verified provider event."
              : "Popup blocked: the retry payment link could not open automatically. Use REOPEN PAYMENT LINK below to complete the test payment.",
            status: "info",
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            text: "A single bounded retry was started. The order is again awaiting a verified provider event.",
            status: "info",
          },
        ]);
      }
      pollOrder(order.order_id);
    } catch {
      setPhase("aborted");
    } finally {
      setBusy(false);
    }
  }, [order, busy, pollOrder, readOnly]);

  const handleSimulate = useCallback(
    async (kind: "capture" | "failure") => {
      // Simulate buttons only exist in dev mode and never in read-only
      // history; refunds stay available since completed sessions are exactly
      // where post-payment refunds happen (owner-gated server-side).
      if (readOnly || !order || busy) return;
      setBusy(true);
      try {
        const attempt = kind === "capture" ? await simulatePaymentCapture(order.order_id) : await simulatePaymentFailure(order.order_id);
        setPayment(attempt);
        if (kind === "capture") {
          setOrderStatus("PAID");
          setPhase("receipt");
        } else {
          setOrderStatus("PAYMENT_FAILED");
          setPhase("failed");
        }
        stopPolling();
      } catch {
        // leave current phase; the backend may have rejected the simulation
      } finally {
        setBusy(false);
      }
    },
    [order, busy, stopPolling, readOnly]
  );

  const handleRefund = useCallback(async () => {
    if (!order || busy) return;
    setBusy(true);
    try {
      await refundOrder(order.order_id, "Merchant initiated refund from chat console");
      setPhase("receipt");
      setOrderStatus("REFUNDED");
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }, [order, busy]);

  const handleCopy = useCallback((value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, []);

  const cart = decision?.cart ?? null;
  const isDenied = decision?.policy_decision?.verdict === "DENY";
  // (isTerminal/readOnly live above persistSession; see the note there.)
  // The lightweight list row for the open session may predate live state —
  // overlay the authoritative order status and budget so its chip is current.
  const enrichedSessions = useMemo(
    () =>
      sessions.map((s) =>
        s.session_id === checkoutSessionId
          ? {
              ...s,
              order_status: orderStatus ?? s.order_status ?? null,
              budget_paise:
                typeof s.budget_paise === "number" && s.budget_paise > 0
                  ? s.budget_paise
                  : budgetPaise,
            }
          : s
      ),
    [sessions, checkoutSessionId, orderStatus, budgetPaise]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-hairline flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? "Hide chat history" : "Show chat history"}
            title={sidebarOpen ? "Hide chat history" : "Show chat history"}
            className="hidden lg:inline-flex items-center justify-center size-9 rounded-full border border-hairline bg-panel text-muted hover:text-ink hover:shadow-sm transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent"
          >
            <PanelLeft size={15} />
          </button>
          <button
            onClick={() => setHistoryDrawer(true)}
            aria-label="Open chat history"
            className="lg:hidden inline-flex items-center justify-center size-9 rounded-full border border-hairline bg-panel text-muted hover:text-ink transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent"
          >
            <History size={15} />
          </button>
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">AI Sales</h1>
            <p className="hidden sm:block text-[13px] leading-relaxed text-muted truncate max-w-[30rem]">
              Talk to your AI Seller. Discovery, quotes, negotiation, and checkout happen here first.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <PhaseStepper phase={phase} />
          <button onClick={resetSession} className="inline-flex items-center gap-2 h-9 px-4 border border-hairline bg-panel shadow-sm text-[13px] text-ink-2 hover:text-ink hover:shadow transition-all cursor-pointer font-medium rounded-full">
            <SquarePen size={13} /> New session
          </button>
        </div>
      </div>

      {/* Mobile history drawer */}
      <Sheet open={historyDrawer} onOpenChange={setHistoryDrawer}>
        <SheetContent side="left" className="w-[320px] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Chat history</SheetTitle>
          </SheetHeader>
          <ChatHistory
            sessions={enrichedSessions}
            loading={historyLoading}
            activeSessionId={checkoutSessionId}
            onSelect={(id) => {
              setHistoryDrawer(false);
              void handleSelectSession(id);
            }}
            onNew={() => {
              setHistoryDrawer(false);
              void resetSession();
            }}
            onArchive={handleArchiveSession}
            onDelete={handleDeleteSession}
            showArchived={showArchived}
            onToggleArchived={handleToggleArchived}
            className="flex w-full h-full flex-col min-h-0 border-r-0 bg-panel"
          />
        </SheetContent>
      </Sheet>

      {/* Main grid */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Collapsible history rail — camera-off when collapsed, drawer on mobile */}
        {!historyUnsupported && sidebarOpen && (
          <ChatHistory
            sessions={enrichedSessions}
            loading={historyLoading}
            activeSessionId={checkoutSessionId}
            onSelect={(id) => void handleSelectSession(id)}
            onNew={() => void resetSession()}
            onArchive={handleArchiveSession}
            onDelete={handleDeleteSession}
            showArchived={showArchived}
            onToggleArchived={handleToggleArchived}
          />
        )}
        {/* Conversation column — the chat window owns its scroll; the page never scrolls */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 p-3 sm:p-4 lg:pl-0 gap-3">
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="flex-1 min-h-0 rounded-[22px] border border-hairline bg-panel-2/70 shadow-card">
              <MessageScrollerViewport
                ref={listRef}
                onScroll={handleListScroll}
                aria-label="Conversation with the seller agent"
                className="px-4 sm:px-6 py-6"
              >
                <MessageScrollerContent>
                  {loadingSession && (
                    <div className="text-[12px] text-muted">
                      Loading conversation…
                    </div>
                  )}
                  {sessionError && (
                    <div className="rounded-2xl border border-amber-600/25 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
                      {sessionError}
                    </div>
                  )}
                  {readOnly && (
                    <div className="rounded-2xl border border-hairline bg-panel px-4 py-3 text-[13px] leading-relaxed text-muted shadow-card">
                      Historical session, review only. Start a new session for a new purchase. Replay and transaction links keep working.
                    </div>
                  )}
            {messages.length === 0 && phase === "idle" && (
              <div className="max-w-[520px] mx-auto my-auto w-full py-[8vh]">
                <div className="flex items-center justify-center mb-5">
                  <span className="flex size-11 items-center justify-center rounded-[16px] border border-hairline bg-panel shadow-card text-ink-2">
                    <Sparkles size={19} aria-hidden />
                  </span>
                </div>
                {catalogEmpty ? (
                  <>
                    <div className="text-center text-[19px] font-semibold tracking-[-0.01em] text-ink leading-snug mb-2">
                      Your catalog is empty
                    </div>
                    <div className="text-center text-[14px] leading-relaxed text-muted mb-6">
                      The agent only sells what you actually stock. Add a few products first,
                      then come back and describe what a buyer might ask for.
                    </div>
                    <div className="flex justify-center">
                      <Link
                        href="/dashboard/catalog"
                        className="inline-flex items-center gap-2 h-9 px-5 bg-ink text-panel text-[13px] hover:bg-ink-2 transition-colors cursor-pointer font-medium rounded-full"
                      >
                        Add products <ArrowRight size={12} />
                      </Link>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-center text-[19px] font-semibold tracking-[-0.01em] text-ink leading-snug mb-2">
                      Describe what you need
                    </div>
                    <div className="text-center text-[14px] leading-relaxed text-muted mb-7">
                      I search your catalog, quote a cart that fits your policy, and
                      negotiate within your guardrails. Every step lands in the ledger.
                    </div>
                    <div className="mb-2.5 text-center text-[11px] font-medium tracking-[0.12em] uppercase text-faint">
                      Try a mission
                    </div>
                    <div className="flex flex-col gap-2">
                      {[
                        "I need a coffee setup for my desk under ₹2,000",
                        "A protective travel case for my headphones",
                        "A workday gift box under ₹2,500",
                      ].map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSend(s)}
                          className="group flex items-center justify-between gap-3 text-left px-4 py-2.5 border border-hairline bg-panel shadow-sm hover:shadow hover:bg-panel-2 transition-all cursor-pointer rounded-[12px]"
                        >
                          <span className="text-[13px] text-muted group-hover:text-ink transition-colors">{s}</span>
                          <ArrowRight size={13} className="text-faint group-hover:text-ink transition-colors shrink-0" />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {phase === "thinking" && (
              <div className="flex items-center gap-3" aria-live="polite">
                <span className="flex gap-1">
                  <span className="size-1.5 bg-faint typing-dot rounded-full" />
                  <span className="size-1.5 bg-faint typing-dot [animation-delay:0.15s] rounded-full" />
                  <span className="size-1.5 bg-faint typing-dot [animation-delay:0.3s] rounded-full" />
                </span>
                <span className="text-[12px] text-muted">
                  Searching catalog, checking policy, preparing quote…
                </span>
              </div>
            )}

            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <MessageScrollerItem key={msg.id} messageId={msg.id}>
                    <Message align="end">
                      <MessageContent>
                        <Bubble align="end" variant="default" className="max-w-[88%] sm:max-w-[80%]">
                          <BubbleContent className="text-[14px]">{msg.text}</BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              }
              if (msg.role === "system") {
                return (
                  <MessageScrollerItem key={msg.id} messageId={msg.id}>
                    <Message align="start">
                      <MessageContent>
                        <Bubble
                          align="start"
                          variant={
                            msg.status === "error"
                              ? "destructive"
                              : msg.status === "warning"
                                ? "outline"
                                : "muted"
                          }
                          className="max-w-[94%] sm:max-w-[80%]"
                        >
                          <BubbleContent className="flex flex-row items-start gap-2.5 px-4 py-2.5">
                            {msg.status === "error" ? (
                              <XCircle size={14} className="text-red-600 mt-px shrink-0" aria-hidden />
                            ) : msg.status === "warning" ? (
                              <AlertTriangle size={14} className="text-amber-700 mt-px shrink-0" aria-hidden />
                            ) : msg.status === "success" ? (
                              <CircleCheck size={14} className="text-green-700 mt-px shrink-0" aria-hidden />
                            ) : (
                              <Info size={14} className="text-muted-foreground mt-px shrink-0" aria-hidden />
                            )}
                            <span className="pt-px">{msg.text}</span>
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              }
              const calls = (msg.toolCalls ?? []).filter((c) =>
                ["catalog.search", "catalog.get", "quotes.create", "quotes.negotiate", "upsell.suggest", "policy.evaluate"].includes(c)
              );
              return (
                <MessageScrollerItem key={msg.id} messageId={msg.id}>
                  <Message align="start">
                    <MessageAvatar>
                      <Avatar size="sm">
                        <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                          AI
                        </AvatarFallback>
                      </Avatar>
                    </MessageAvatar>
                    <MessageContent>
                      <MessageHeader>Seller agent</MessageHeader>
                      <Bubble align="start" variant="outline" className="max-w-[94%] sm:max-w-[85%]">
                        <BubbleContent className="px-4 py-3 text-[14px] text-ink-2">
                          {msg.text}
                        </BubbleContent>
                      </Bubble>
                      {calls.length > 0 && (
                        <MessageFooter>
                          <span className="flex flex-wrap gap-1.5">
                            {calls.map((call) => (
                              <Badge key={call} variant="outline" className="gap-1 font-mono text-[11px] font-normal">
                                {call === "upsell.suggest" ? (
                                  <Sparkles size={10} aria-hidden />
                                ) : call === "policy.evaluate" ? (
                                  <ShieldCheck size={10} aria-hidden />
                                ) : (
                                  <CheckCircle2 size={10} aria-hidden />
                                )}
                                {call}
                              </Badge>
                            ))}
                          </span>
                        </MessageFooter>
                      )}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              );
            })}
                  <MessageScrollerButton />
                </MessageScrollerContent>
              </MessageScrollerViewport>
            </MessageScroller>
          </MessageScrollerProvider>

          {/* Input — arcs onto the same rounded window */}
          <div className="px-3 sm:px-4 pb-1 -mt-1">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend(input);
              }}
              className="flex items-end gap-2 border border-hairline bg-panel rounded-[18px] shadow-card focus-within:shadow-lift focus-within:ring-[3px] focus-within:ring-accent/20 transition-all px-3 py-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(input);
                  }
                }}
                rows={1}
                placeholder={readOnly ? "Historical session, start a new session to buy again" : phase === "payment" || phase === "receipt" ? "Session is processing a payment, start a new session to continue" : "Describe what you need…"}
                disabled={busy || phase === "thinking" || readOnly}
                className="flex-1 max-h-[120px] resize-none bg-transparent border-0 text-[14px] leading-[1.6] text-ink placeholder:text-faint focus:outline-none disabled:opacity-50 py-2"
                aria-label="Message the seller agent"
              />
              <button
                type="submit"
                disabled={busy || phase === "thinking" || readOnly || !input.trim()}
                className="mb-1.5 inline-flex items-center justify-center size-8 bg-accent text-white shadow-sm hover:bg-accent-strong disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0 rounded-full"
                aria-label="Send message"
              >
                {busy || phase === "thinking" ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />}
              </button>
            </form>
            <div className="mt-1.5 flex items-center justify-between gap-4 px-1">
              <span className="text-[11px] text-faint truncate">
                {readOnly
                  ? "Read-only history. Start a new session to buy again."
                  : "Enter to send. Every quote and order lands in the ledger."}
              </span>
              {phase === "quote" && decision?.trace_id && (
                <span className="font-mono text-[11px] text-faint truncate shrink-0">
                  trace {decision.trace_id.slice(0, 14)}…
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Checkout panel */}
        <div className="flex flex-col min-h-0 lg:w-[380px] border-t lg:border-t-0 lg:border-l border-hairline">
          <div className="px-5 py-3 border-b border-hairline bg-panel-2 flex items-center justify-between flex-shrink-0 gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[12px] font-semibold text-ink truncate">Checkout session</span>
              <Badge
                variant="outline"
                title={
                  syncState === "error"
                    ? "Session sync failed. Your order itself is always saved server-side; the next action retries this snapshot."
                    : syncState === "saving"
                      ? "Saving session snapshot…"
                      : "Session snapshot saved server-side"
                }
                className={`gap-1.5 font-mono text-[11px] font-normal ${
                  syncState === "error"
                    ? "text-red-700 border-red-600/30"
                    : syncState === "saving"
                      ? "text-amber-700 border-amber-600/30"
                      : "text-green-700 border-green-600/30"
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    syncState === "error"
                      ? "bg-red-600"
                      : syncState === "saving"
                        ? "bg-amber-600"
                        : "bg-green-600"
                  }`}
                />
                {syncState === "error" ? "Unsynced" : syncState === "saving" ? "Saving" : "Saved"}
              </Badge>
            </div>
            {phase === "quote" && decision?.trace_id && (
              <button onClick={() => handleCopy(decision.trace_id!)} className="inline-flex items-center gap-1 h-7 px-2.5 border border-hairline bg-panel text-[12px] text-muted hover:text-ink hover:shadow-sm transition-colors cursor-pointer font-medium rounded-full shrink-0">
                <Copy size={10} /> {copied ? "Copied" : "Trace"}
              </button>
            )}
          </div>
          <div className="overflow-y-auto p-5 space-y-4 max-h-[50vh] lg:max-h-none lg:flex-1">
          {/* Session settings — always visible */}
            <Card size="sm" className="shadow-card">
              <CardHeader>
                <CardTitle className="text-[13px]">Session budget</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[13px] text-muted">₹</span>
                    <input
                      type="number"
                      min="1"
                      value={budgetDraft}
                      onChange={(e) => { setBudgetDraft(e.target.value); setBudgetMsg(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyBudget(); } }}
                      className="w-[88px] h-8 text-[14px] text-right tabular-nums bg-panel border border-input text-ink px-2 py-1 focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/20 transition-colors rounded-[10px]"
                      aria-label="Session budget in rupees (press Apply to confirm)"
                    />
                    <button
                      onClick={applyBudget}
                      className="h-8 px-3 border border-hairline bg-panel-2 text-[12px] text-ink hover:shadow-sm transition-colors cursor-pointer font-medium rounded-full"
                    >
                      Apply
                    </button>
                  </div>
                  <span className="text-[12px] text-faint tabular-nums">{formatPaise(budgetPaise)}</span>
                </div>
                {budgetMsg && (
                  <div className={`text-[12px] text-right ${budgetMsg.kind === "ok" ? "text-green-700" : "text-red-700"}`}>
                    {budgetMsg.text}
                  </div>
                )}
                <p className="text-[12px] leading-relaxed text-muted">
                  Buyer-side ceiling for this session. Merchant caps below still apply.
                </p>
                <div className="border-t border-hairline pt-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-muted">Upsells</span>
                    <button
                      onClick={() => setUpsellOn((v) => !v)}
                      className={`h-7 px-3 rounded-full text-[12px] font-medium border transition-all cursor-pointer ${upsellOn ? "border-accent/35 bg-accent-soft text-accent-strong" : "border-hairline bg-panel text-muted hover:text-ink"}`}
                      aria-pressed={upsellOn}
                    >
                      {upsellOn ? "On" : "Off"}
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-muted">Approval threshold</span>
                    <span className="text-[13px] font-medium tabular-nums text-ink">
                      {policy ? formatPaise(policy.human_approval_threshold_paise) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-muted">Max item value</span>
                    <span className="text-[13px] font-medium tabular-nums text-ink">
                      {policy ? formatPaise(policy.max_single_item_value_paise) : "—"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[12px] text-muted">Caps live in Settings</span>
                  <Link href="/dashboard/settings" className="text-[13px] font-medium text-accent-strong hover:underline">
                    Edit →
                  </Link>
                </div>
              </CardContent>
            </Card>

            {phase === "idle" && (
              <div className="font-[var(--font-sans)] text-[0.78rem] text-neutral-600 leading-relaxed">
                Policy and budget are enforced by the backend Policy Engine — never by the
                browser. Quotes appear here as you negotiate.
              </div>
            )}
            {phase === "thinking" && (
              <div className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600">Evaluating request…</div>
            )}

            {phase === "quote" && decision && cart && (
              <>
                <CartCard cart={cart} productTitle={decision.selected_product?.title ?? null} />
                {decision.policy_decision && <PolicyCard decision={decision.policy_decision} />}

                {isDenied ? (
                  <Card size="sm" className="border-red-600/25 bg-red-50 shadow-card dark:bg-red-950/20">
                    <CardContent>
                      <p className="text-[13px] leading-relaxed text-ink-2">
                        The policy engine rejected this proposal. No order was created and no money moved.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {cart.upsell_offered ? (
                      <button
                        onClick={handleUpsellToggle}
                        disabled={busy}
                        className="w-full h-9 border border-black/[0.06] text-[13px] text-neutral-600 hover:text-neutral-900 hover:border-black/[0.12] transition-all cursor-pointer disabled:opacity-50 font-medium rounded-full"
                      >
                        Remove upsell
                      </button>
                    ) : (
                      <button
                        onClick={handleUpsellToggle}
                        disabled={busy}
                        className="w-full h-9 border border-hairline bg-ink/10 text-[13px] text-ink hover:bg-accent/20 transition-all cursor-pointer disabled:opacity-50 font-medium rounded-full"
                      >
                        Add compatible upsell
                      </button>
                    )}

                    <div className="border border-black/[0.06]">
                      <button onClick={() => setNegotiating((v) => !v)} className="w-full h-9 flex items-center justify-center gap-2 text-[13px] text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer font-medium rounded-full">
                        <Wallet size={12} /> Negotiate
                      </button>
                      {negotiating && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleNegotiate();
                          }}
                          className="px-4 py-3 border-t border-black/[0.05] flex items-center gap-2 rounded-2xl"
                        >
                          <span className="font-[var(--font-mono)] text-[0.65rem] text-neutral-600">₹</span>
                          <input
                            type="number"
                            value={offerInput}
                            onChange={(e) => setOfferInput(e.target.value)}
                            placeholder="Target price"
                            className="flex-1 font-[var(--font-mono)] text-[0.7rem] bg-white border border-black/[0.06] text-neutral-900 px-2 py-1.5 focus:outline-none focus:border-hairline focus:ring-[3px] focus:ring-ink/20"
                          />
                          <button type="submit" disabled={busy} className="h-9 px-3 border border-hairline text-ink text-[13px] cursor-pointer disabled:opacity-50 font-medium rounded-full">
                            Offer
                          </button>
                        </form>
                      )}
                    </div>

                    <button
                      onClick={handleCheckout}
                      disabled={busy}
                      className="w-full h-10 bg-ink text-white text-[13px] hover:bg-ink-2 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 font-medium rounded-full"
                    >
                      Proceed to checkout <ArrowRight size={13} />
                    </button>
                  </>
                )}
              </>
            )}

            {phase === "checkout" && (
              <div className="flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-accent-strong" />
                <span className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600">Creating order and validating consent…</span>
              </div>
            )}

            {phase === "approval" && order && (
              <Card size="sm" className="border-amber-600/25 bg-amber-50 shadow-card dark:bg-amber-950/20">
                <CardHeader className="flex flex-row items-center gap-2.5">
                  <ShieldAlert size={18} className="shrink-0 text-amber-600" />
                  <div>
                    <CardTitle className="text-[13px] text-amber-700 dark:text-amber-400">
                      Waiting for your approval
                    </CardTitle>
                    <CardDescription className="text-[12px]">
                      Order {order.order_id} is above the approval threshold. Payment stays blocked until you decide.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <Link
                    href="/dashboard/approvals"
                    className="inline-flex h-9 w-full items-center justify-center rounded-full border border-amber-600/25 bg-panel text-[13px] font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-400"
                  >
                    Open approval queue
                  </Link>
                </CardContent>
              </Card>
            )}

            {phase === "consent" && consent && order && (
              <>
                <ConsentCard consent={consent} />
                <Card size="sm" className="shadow-card">
                  <CardHeader>
                    <CardTitle className="text-[13px]">Order ready</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <FieldRow label="Order">
                      <Link href={`/dashboard/transactions/${order.order_id}`} className="text-accent-strong hover:underline">
                        {order.order_id}
                      </Link>
                    </FieldRow>
                    <FieldRow label="Amount">{formatPaise(order.amount_paise)}</FieldRow>
                  </CardContent>
                </Card>
                <button
                  onClick={handlePay}
                  disabled={busy}
                  className="w-full h-10 bg-ink text-white text-[13px] hover:bg-ink-2 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 font-medium rounded-full"
                >
                  <Wallet size={14} /> Pay {formatPaise(order.amount_paise)}
                </button>
              </>
            )}

            {phase === "payment" && payment && order && (
              <div className="space-y-4">
                <Card size="sm" className="shadow-card">
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-[13px]">Payment</CardTitle>
                    <Badge variant="secondary" className="gap-1.5 bg-amber-50 text-amber-800">
                      <span className="size-1.5 rounded-full bg-amber-600 animate-[blink_1.5s_ease-in-out_infinite]" />
                      {orderStatus === "PAYMENT_PENDING" ? "Awaiting provider" : "Pending"}
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    <FieldRow label="Provider">
                      <span className="text-[12px]">{payment.provider} · test</span>
                    </FieldRow>
                    <FieldRow label="Order ID">
                      <span className="block truncate text-[12px]" title={payment.provider_order_id}>
                        {payment.provider_order_id}
                      </span>
                    </FieldRow>
                    <p className="mt-3 border-t border-hairline pt-3 text-[12px] leading-relaxed text-muted">
                      Waiting on provider confirmation. The browser cannot mark this paid, only a verified webhook settles it.
                    </p>
                    {payment.payment_url && (
                      <a
                        href={payment.payment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-full border border-hairline bg-ink/10 text-[13px] font-medium text-ink transition-colors hover:bg-accent/20"
                      >
                        Reopen payment link
                      </a>
                    )}
                  </CardContent>
                </Card>

                {DEMO_MODE && (
                  <Card size="sm" className="shadow-card">
                    <CardHeader>
                      <CardTitle className="text-[12px] text-muted">Dev helpers</CardTitle>
                      <CardDescription className="text-[12px]">
                        Settle through the signed webhook boundary, no tunnel needed.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-2">
                      <button onClick={() => handleSimulate("capture")} disabled={busy} className="h-9 border border-green-600/20 bg-green-50 text-[13px] text-green-600 hover:bg-green-100 cursor-pointer disabled:opacity-50 font-medium rounded-full">
                        Capture
                      </button>
                      <button onClick={() => handleSimulate("failure")} disabled={busy} className="h-9 border border-red-600/20 bg-red-50 text-[13px] text-red-600 hover:bg-red-100 cursor-pointer disabled:opacity-50 font-medium rounded-full">
                        Fail
                      </button>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {phase === "failed" && order && (
              <div className="space-y-4">
                <Card size="sm" className="border-red-600/25 bg-red-50 shadow-card dark:bg-red-950/20">
                  <CardHeader>
                    <CardTitle className="text-[13px] text-red-700 dark:text-red-400">Payment failed</CardTitle>
                    <CardDescription className="text-[12px]">
                      Declined in test mode. The backend classified the failure, and one bounded retry is available. Nothing was charged twice.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FieldRow label="Final state">{orderStatus || "PAYMENT_FAILED"}</FieldRow>
                  </CardContent>
                </Card>
                <button onClick={handleRetry} disabled={busy} className="w-full h-9 border border-hairline bg-ink/10 text-[13px] text-ink hover:bg-accent/20 transition-colors cursor-pointer disabled:opacity-50 font-medium rounded-full">
                  Retry payment
                </button>
                {DEMO_MODE && (
                  <button onClick={() => handleSimulate("capture")} disabled={busy} className="w-full h-9 border border-green-600/20 bg-green-50 text-[13px] text-green-600 hover:bg-green-100 transition-colors cursor-pointer disabled:opacity-50 font-medium rounded-full">
                    Simulate capture
                  </button>
                )}
              </div>
            )}

            {phase === "aborted" && (
              <Card size="sm" className="border-red-600/25 bg-red-50 shadow-card dark:bg-red-950/20">
                <CardHeader>
                  <CardTitle className="text-[13px] text-red-700 dark:text-red-400">Order aborted</CardTitle>
                  <CardDescription className="text-[12px]">
                    The retry limit was reached. The order closed without duplicate payment, and holds were released.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <button onClick={resetSession} className="w-full h-9 border border-hairline bg-panel text-[13px] text-ink-2 hover:text-ink transition-colors cursor-pointer font-medium rounded-full">
                    Start new session
                  </button>
                </CardContent>
              </Card>
            )}

            {phase === "receipt" && order && (
              <>
                <ReceiptCard order={order} payment={payment} />
                {orderStatus === "REFUNDED" && (
                  <Card size="sm" className="shadow-card">
                    <CardHeader>
                      <CardTitle className="text-[13px]">Refunded</CardTitle>
                      <CardDescription className="text-[12px]">
                        Recorded in the ledger and replayable.
                      </CardDescription>
                    </CardHeader>
                  </Card>
                )}
                {orderStatus !== "REFUNDED" && (
                  <button onClick={handleRefund} disabled={busy} className="w-full h-9 border border-black/[0.06] text-[13px] text-neutral-600 hover:text-red-600 hover:border-red-600/30 transition-colors cursor-pointer disabled:opacity-50 font-medium rounded-full">
                    Refund order
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}