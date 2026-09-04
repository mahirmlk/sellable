"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Loader2,
  CheckCircle2,
  RotateCcw,
  Wallet,
  ShieldCheck,
  Sparkles,
  Copy,
  RefreshCw,
  ArrowRight,
  ShieldAlert,
  ExternalLink,
} from "lucide-react";
import { formatPaise, formatTimestamp, formatDateTime } from "@/lib/formatters";
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
  type CartPayload,
  type PolicyDecisionPayload,
  type ConsentInfo,
  type PaymentAttemptPayload,
  type OrderCreateResult,
  type ConsolePolicySettings,
} from "@/lib/api";
import ChatHistory from "@/components/dashboard/chat-history";

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

function ToolRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-[3px] border border-[var(--bb-line-soft)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.5rem] tracking-[0.06em] text-[var(--bb-grey-2)]">
      <span className="text-green-400">{icon}</span>
      {label}
    </span>
  );
}

function CartCard({ cart }: { cart: CartPayload }) {
  return (
    <div className="border border-[var(--bb-line)] p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-[var(--bb-grey-1)]">Cart</span>
        <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.08em] uppercase text-[var(--bb-grey-1)]">
          ROUND {cart.negotiation_round}
        </span>
      </div>
      <div className="space-y-2 mb-3">
        {cart.items.map((item) => (
          <div key={item.sku} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-[var(--font-mono)] text-[0.72rem] text-[var(--bb-white)]">{item.sku}</div>
              <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-2)] tabular-nums">
                {item.quantity} × {formatPaise(item.offered_price_paise)}
              </div>
            </div>
            <div className="font-[var(--font-mono)] text-[0.78rem] text-[var(--bb-white)] tabular-nums">
              {formatPaise(item.line_total_paise ?? item.quantity * item.offered_price_paise)}
            </div>
          </div>
        ))}
      </div>
      {cart.upsell_offered && (
        <div className="border-l-2 border-[var(--bb-orange)] pl-3 py-1 mb-3">
          <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] mb-1">UPSELL</div>
          {cart.upsell_rationale && (
            <div className="font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-1)] leading-relaxed">{cart.upsell_rationale}</div>
          )}
        </div>
      )}
      {cart.discount_paise > 0 && (
        <div className="flex items-center justify-between py-1.5 border-t border-[var(--bb-line-soft)]">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Discount</span>
          <span className="font-[var(--font-mono)] text-[0.7rem] text-green-400 tabular-nums">−{formatPaise(cart.discount_paise)}</span>
        </div>
      )}
      <div className="flex items-center justify-between pt-2.5 mt-1 border-t border-[var(--bb-line)]">
        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-1)]">Total</span>
        <span className="font-[var(--font-mono)] text-[1.05rem] text-[var(--bb-white)] tabular-nums">{formatPaise(cart.total_paise)}</span>
      </div>
    </div>
  );
}

function PolicyCard({ decision }: { decision: PolicyDecisionPayload }) {
  const allowed = decision.verdict === "ALLOW";
  const hitl = decision.verdict === "NEEDS_HUMAN_APPROVAL";
  return (
    <div className="border border-[var(--bb-line)] p-4">
      <div className="flex items-center justify-between mb-2.5">
        <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-[var(--bb-grey-1)]">Policy Decision</span>
        <span className={`font-[var(--font-mono)] text-[0.62rem] tracking-[0.1em] ${allowed ? "text-green-400" : hitl ? "text-amber-400" : "text-red-400"}`}>
          {allowed ? "✓ ALLOW" : hitl ? "HITL REQUIRED" : "✕ DENIED"}
        </span>
      </div>
      {decision.reason_code && (
        <div className="font-[var(--font-mono)] text-[0.62rem] text-[var(--bb-white)] mb-1">{decision.reason_code}</div>
      )}
      <div className="font-[var(--font-sans)] text-[0.74rem] text-[var(--bb-grey-1)] leading-relaxed mb-3">{decision.reasoning_summary}</div>
      {decision.policy_refs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {decision.policy_refs.map((ref) => (
            <span key={ref} className="font-[var(--font-mono)] text-[0.46rem] tracking-[0.06em] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-2)]">{ref}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ConsentCard({ consent }: { consent: ConsentInfo }) {
  return (
    <div className="border border-[var(--bb-line)] p-4">
      <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-1)] mb-3">CONSENT</div>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Status</span>
          <span className="font-[var(--font-mono)] text-[0.7rem] text-green-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />{consent.status}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Amount</span>
          <span className="font-[var(--font-mono)] text-[0.8rem] text-[var(--bb-white)]">{formatPaise(consent.amount_paise)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Payee</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-1)]">{consent.payee_id}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Purpose</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-1)]">{consent.purpose}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Single use</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-white)]">{consent.single_use ? "Yes" : "No"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Expires</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-white)]">{formatDateTime(consent.expires_at)}</span>
        </div>
      </div>
    </div>
  );
}

function ReceiptCard({ order, payment }: { order: OrderCreateResult; payment?: PaymentAttemptPayload | null }) {
  return (
    <div className="border border-green-400/30 bg-green-400/5 p-5">
      <div className="flex items-center gap-3 mb-4">
        <CheckCircle2 size={22} className="text-green-400" />
        <div>
          <div className="font-[var(--font-sans)] text-[1rem] text-[var(--bb-white)]">Payment captured</div>
          <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)]">Verified via signed Razorpay webhook</div>
        </div>
      </div>
      <div className="space-y-2 border-t border-green-400/20 pt-3">
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Order</span>
          <Link href={`/dashboard/transactions/${order.order_id}`} className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-orange)] hover:text-[var(--bb-orange-bright)] flex items-center gap-1">{order.order_id} <ExternalLink size={10} /></Link>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Amount</span>
          <span className="font-[var(--font-mono)] text-[0.9rem] text-[var(--bb-white)]">{formatPaise(order.amount_paise)}</span>
        </div>
        {payment?.provider_order_id && (
          <div className="flex items-center justify-between">
            <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Razorpay order</span>
            <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">{payment.provider_order_id}</span>
          </div>
        )}
        {payment?.provider_payment_id && (
          <div className="flex items-center justify-between">
            <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Payment ID</span>
            <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-1)]">{payment.provider_payment_id}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Status</span>
          <span className="font-[var(--font-mono)] text-[0.65rem] text-green-400">PAID</span>
        </div>
      </div>
      <Link
        href={`/dashboard/transactions/${order.order_id}/replay`}
        className="mt-4 inline-flex items-center justify-center w-full h-[38px] border border-green-400/30 bg-green-400/10 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-green-400 hover:bg-green-400/20 transition-colors"
      >
        <RotateCcw size={12} className="mr-2" /> VIEW REPLAY
      </Link>
    </div>
  );
}

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
  // Chat history sidebar + two-pane layout state.
  const [sessions, setSessions] = useState<CheckoutSessionListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyUnsupported, setHistoryUnsupported] = useState(false);
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
        if (storedDecision) setDecision(storedDecision);
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
    async (message: string, opts: { upsell: boolean; offer?: number | null; sku?: string | null; isFollowUp?: boolean }) => {
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
        });
        sessionMessageRef.current = message;
        lastTraceIdRef.current = result.trace_id;
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
    await runRespond(message, { upsell: next, offer: offerRef.current, sku: null, isFollowUp: true });
  }, [upsellOn, runRespond, busy, readOnly]);

  const handleNegotiate = useCallback(async () => {
    const paise = Math.round(parseFloat(offerInput) * 100);
    if (!paise || paise <= 0 || busy || readOnly) return;
    const message = sessionMessageRef.current;
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
    await runRespond(message, { upsell: upsellOn, offer: paise, sku: null, isFollowUp: true });
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
      <div className="px-6 py-4 border-b border-[var(--bb-line)] flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.35rem] tracking-[-0.04em] text-[var(--bb-white)]">Checkout</h1>
          <p className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-grey-1)] mt-1">
            AGENT-ASSISTED · POLICY-BOUND · HUMAN APPROVED
          </p>
        </div>
        <button onClick={resetSession} className="inline-flex items-center gap-2 h-[30px] px-3 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.52rem] tracking-[0.12em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer">
          <RefreshCw size={11} /> NEW SESSION
        </button>
      </div>

      {/* Main grid */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {!historyUnsupported && (
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
        {/* Conversation column */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div ref={listRef} onScroll={handleListScroll} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
            {loadingSession && (
              <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)]">
                Loading conversation…
              </div>
            )}
            {sessionError && (
              <div className="border border-amber-400/30 bg-amber-400/5 px-4 py-3 font-[var(--font-mono)] text-[0.62rem] text-amber-400">
                {sessionError}
              </div>
            )}
            {readOnly && (
              <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] px-4 py-3 font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-2)] leading-relaxed">
                Historical session — review only. Start a NEW SESSION for a new purchase; replay and transaction links below keep working.
              </div>
            )}
            {messages.length === 0 && phase === "idle" && (
              <div className="max-w-[480px] mx-auto mt-[7vh]">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles size={15} className="text-[var(--bb-orange)]" />
                  <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.18em] uppercase text-[var(--bb-orange)]">Seller Agent</span>
                </div>
                {catalogEmpty ? (
                  <>
                    <div className="font-[var(--font-sans)] text-[1.15rem] text-[var(--bb-white)] mb-2 leading-snug">Your catalog is empty.</div>
                    <div className="font-[var(--font-sans)] text-[0.82rem] text-[var(--bb-grey-2)] leading-relaxed mb-5">
                      The agent only sells what you actually stock. Add a few products first —
                      then come back and describe what a buyer might ask for.
                    </div>
                    <Link
                      href="/dashboard/catalog"
                      className="inline-flex items-center gap-2 h-[34px] px-4 bg-[var(--bb-orange)] text-[var(--bb-black)] font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase hover:bg-[var(--bb-orange-bright)] transition-colors cursor-pointer"
                    >
                      Add products <ArrowRight size={12} />
                    </Link>
                  </>
                ) : (
                  <>
                    <div className="font-[var(--font-sans)] text-[1.15rem] text-[var(--bb-white)] mb-2 leading-snug">Describe what you need.</div>
                    <div className="font-[var(--font-sans)] text-[0.82rem] text-[var(--bb-grey-2)] leading-relaxed mb-6">
                      I search your catalog, quote a policy-valid cart, and negotiate within your
                      guardrails. Every step lands in the ledger.
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {[
                        "I need a coffee setup for my desk under ₹2,000",
                        "A protective travel case for my headphones",
                        "A workday gift box under ₹2,500",
                      ].map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSend(s)}
                          className="self-start text-left px-3.5 py-2 border border-[var(--bb-line-soft)] text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-colors cursor-pointer"
                        >
                          <span className="font-[var(--font-mono)] text-[0.65rem]">{s}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {phase === "thinking" && (
              <div className="flex items-center gap-3">
                <Loader2 size={14} className="animate-spin text-[var(--bb-orange)]" />
                <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)]">SEARCHING CATALOG · CHECKING POLICY · PREPARING QUOTE</span>
              </div>
            )}

            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[70%] px-3.5 py-2 bg-[var(--bb-panel)]">
                      <div className="font-[var(--font-sans)] text-[0.82rem] text-[var(--bb-grey-1)] leading-relaxed">{msg.text}</div>
                    </div>
                  </div>
                );
              }
              if (msg.role === "system") {
                const color = msg.status === "error" ? "border-l-2 border-red-400/60 text-red-400" : msg.status === "warning" ? "border-l-2 border-amber-400/60 text-amber-400" : "border-l-2 border-[var(--bb-grey-4)] text-[var(--bb-grey-2)]";
                return (
                  <div key={msg.id} className={`px-4 py-2 bg-[var(--bb-panel)] ${color}`}>
                    <div className="font-[var(--font-mono)] text-[0.68rem] leading-relaxed">{msg.text}</div>
                  </div>
                );
              }
              return (
                <div key={msg.id} className="max-w-[85%]">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-[5px] h-[5px] bg-[var(--bb-orange)]" />
                    <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.14em] uppercase text-[var(--bb-orange)]">SELLER AGENT</span>
                  </div>
                  <div className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-1)] leading-relaxed">{msg.text}</div>
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {msg.toolCalls.includes("catalog.search") && <ToolRow icon={<CheckCircle2 size={10} />} label="catalog.search" />}
                      {msg.toolCalls.includes("catalog.get") && <ToolRow icon={<CheckCircle2 size={10} />} label="catalog.get" />}
                      {msg.toolCalls.includes("quotes.create") && <ToolRow icon={<CheckCircle2 size={10} />} label="quotes.create" />}
                      {msg.toolCalls.includes("quotes.negotiate") && <ToolRow icon={<CheckCircle2 size={10} />} label="quotes.negotiate" />}
                      {msg.toolCalls.includes("upsell.suggest") && <ToolRow icon={<Sparkles size={10} />} label="upsell.suggest" />}
                      {msg.toolCalls.includes("policy.evaluate") && <ToolRow icon={<ShieldCheck size={10} />} label="policy.evaluate" />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Input */}
          <div className="px-6 py-4 border-t border-[var(--bb-line)] flex-shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend(input);
              }}
              className="flex items-center gap-2.5"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={readOnly ? "Historical session — start a NEW SESSION for a new purchase" : phase === "payment" || phase === "receipt" ? "Session is processing a payment — start a new session to continue" : "Describe what you need…"}
                disabled={busy || phase === "thinking" || readOnly}
                className="flex-1 h-[42px] font-[var(--font-sans)] text-[0.85rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-4 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={busy || phase === "thinking" || readOnly || !input.trim()}
                className="inline-flex items-center justify-center w-[42px] h-[42px] bg-[var(--bb-orange)] text-[var(--bb-black)] hover:bg-[var(--bb-orange-bright)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                aria-label="Send message"
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        </div>

        {/* Checkout panel */}
        <div className="flex flex-col min-h-0 lg:w-[380px] border-t lg:border-t-0 lg:border-l border-[var(--bb-line)]">
          <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-grey-2)]">Checkout Session</div>
              <span
                title={
                  syncState === "error"
                    ? "Session sync failed — your order itself is always saved server-side; the next action retries this snapshot."
                    : syncState === "saving"
                      ? "Saving session snapshot…"
                      : "Session snapshot saved server-side"
                }
                className={`font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase ${
                  syncState === "error" ? "text-red-400" : syncState === "saving" ? "text-yellow-400" : "text-green-400"
                }`}
              >
                {syncState === "error" ? "● UNSYNCED" : syncState === "saving" ? "● SAVING" : "● SAVED"}
              </span>
            </div>
            {phase === "quote" && decision?.trace_id && (
              <button onClick={() => handleCopy(decision.trace_id!)} className="inline-flex items-center gap-1 h-[22px] px-2 border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.48rem] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] transition-colors cursor-pointer">
                <Copy size={9} /> {copied ? "COPIED" : "TRACE"}
              </button>
            )}
          </div>
          <div className="overflow-y-auto p-5 space-y-4 max-h-[50vh] lg:max-h-none lg:flex-1">
            {/* Session settings — always visible */}
            <div className="space-y-2.5 pb-4 border-b border-[var(--bb-line-soft)]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)]">Session budget</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">₹</span>
                  <input
                    type="number"
                    min="1"
                    value={budgetDraft}
                    onChange={(e) => { setBudgetDraft(e.target.value); setBudgetMsg(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyBudget(); } }}
                    className="w-[84px] font-[var(--font-mono)] text-[0.68rem] text-right bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2 py-1 tabular-nums focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
                    aria-label="Session budget in rupees (press Apply to confirm)"
                  />
                  <button
                    onClick={applyBudget}
                    className="h-[26px] px-2.5 border border-[var(--bb-orange)]/50 bg-[var(--bb-orange)]/10 font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:bg-[var(--bb-orange)]/20 transition-colors cursor-pointer"
                  >
                    APPLY
                  </button>
                </div>
              </div>
              {budgetMsg && (
                <div className={`font-[var(--font-mono)] text-[0.55rem] tracking-[0.06em] text-right ${budgetMsg.kind === "ok" ? "text-green-400" : "text-red-400"}`}>
                  {budgetMsg.text}
                </div>
              )}
              <div className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-2)] leading-relaxed">
                Buyer-side session ceiling ({formatPaise(budgetPaise)} applied) — merchant caps below still apply.
              </div>
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)]">Upsells</span>
                <button
                  onClick={() => setUpsellOn((v) => !v)}
                  className={`h-[24px] w-[44px] font-[var(--font-mono)] text-[0.52rem] tracking-[0.08em] uppercase border transition-all cursor-pointer ${upsellOn ? "border-[var(--bb-orange)]/50 bg-[var(--bb-orange)]/10 text-[var(--bb-orange)]" : "border-[var(--bb-line)] bg-transparent text-[var(--bb-grey-2)] hover:text-[var(--bb-white)]"}`}
                  aria-pressed={upsellOn}
                >
                  {upsellOn ? "ON" : "OFF"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)]">HITL threshold</span>
                <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)] tabular-nums">
                  {policy ? formatPaise(policy.human_approval_threshold_paise) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)]">Max item value</span>
                <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)] tabular-nums">
                  {policy ? formatPaise(policy.max_single_item_value_paise) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-2)] leading-relaxed">Merchant caps live in Settings</span>
                <Link href="/dashboard/settings" className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:text-[var(--bb-orange-bright)] transition-colors">
                  EDIT IN SETTINGS →
                </Link>
              </div>
            </div>

            {phase === "idle" && (
              <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-2)] leading-relaxed">
                Policy and budget are enforced by the backend Policy Engine — never by the
                browser. Quotes appear here as you negotiate.
              </div>
            )}
            {phase === "thinking" && (
              <div className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">Evaluating request…</div>
            )}

            {phase === "quote" && decision && cart && (
              <>
                <CartCard cart={cart} />
                {decision.policy_decision && <PolicyCard decision={decision.policy_decision} />}

                {isDenied ? (
                  <div className="border border-red-400/30 bg-red-400/5 p-4">
                    <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-2)] leading-relaxed">
                      The proposal was rejected by the deterministic Policy Engine. No Razorpay order was created and no money moved.
                    </div>
                  </div>
                ) : (
                  <>
                    {cart.upsell_offered ? (
                      <button
                        onClick={handleUpsellToggle}
                        disabled={busy}
                        className="w-full h-[36px] border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50"
                      >
                        REMOVE UPSELL
                      </button>
                    ) : (
                      <button
                        onClick={handleUpsellToggle}
                        disabled={busy}
                        className="w-full h-[36px] border border-[var(--bb-orange)]/40 bg-[var(--bb-orange)]/10 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:bg-[var(--bb-orange)]/20 transition-all cursor-pointer disabled:opacity-50"
                      >
                        ADD COMPATIBLE UPSELL
                      </button>
                    )}

                    <div className="border border-[var(--bb-line)]">
                      <button onClick={() => setNegotiating((v) => !v)} className="w-full h-[36px] flex items-center justify-center gap-2 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] transition-colors cursor-pointer">
                        <Wallet size={12} /> NEGOTIATE
                      </button>
                      {negotiating && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleNegotiate();
                          }}
                          className="px-4 py-3 border-t border-[var(--bb-line-soft)] flex items-center gap-2"
                        >
                          <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">₹</span>
                          <input
                            type="number"
                            value={offerInput}
                            onChange={(e) => setOfferInput(e.target.value)}
                            placeholder="Target price"
                            className="flex-1 font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2 py-1.5 focus:outline-none focus:border-[var(--bb-orange)]"
                          />
                          <button type="submit" disabled={busy} className="h-[30px] px-3 border border-[var(--bb-orange)]/40 text-[var(--bb-orange)] font-[var(--font-mono)] text-[0.55rem] uppercase cursor-pointer disabled:opacity-50">
                            OFFER
                          </button>
                        </form>
                      )}
                    </div>

                    <button
                      onClick={handleCheckout}
                      disabled={busy}
                      className="w-full h-[40px] bg-[var(--bb-orange)] text-[var(--bb-black)] font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase hover:bg-[var(--bb-orange-bright)] transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      PROCEED TO CHECKOUT <ArrowRight size={13} />
                    </button>
                  </>
                )}
              </>
            )}

            {phase === "checkout" && (
              <div className="flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-[var(--bb-orange)]" />
                <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">Creating order and validating consent…</span>
              </div>
            )}

            {phase === "approval" && order && (
              <div className="border border-amber-400/30 bg-amber-400/5 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <ShieldAlert size={20} className="text-amber-400" />
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-amber-400">HUMAN APPROVAL REQUIRED</div>
                    <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-2)] mt-1">
                      Order {order.order_id} exceeds the configured HITL threshold. Payment remains blocked until a merchant approves it.
                    </div>
                  </div>
                </div>
                <Link href="/dashboard/approvals" className="inline-flex items-center justify-center w-full h-[38px] border border-amber-400/40 bg-amber-400/10 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-amber-400 hover:bg-amber-400/20 transition-colors">
                  OPEN APPROVAL QUEUE
                </Link>
              </div>
            )}

            {phase === "consent" && consent && order && (
              <>
                <ConsentCard consent={consent} />
                <div className="border border-[var(--bb-line)] p-4">
                  <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-1)] mb-3">ORDER READY</div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Order</span>
                    <Link href={`/dashboard/transactions/${order.order_id}`} className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-orange)]">{order.order_id}</Link>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Amount</span>
                    <span className="font-[var(--font-mono)] text-[0.9rem] text-[var(--bb-white)]">{formatPaise(order.amount_paise)}</span>
                  </div>
                </div>
                <button
                  onClick={handlePay}
                  disabled={busy}
                  className="w-full h-[42px] bg-[var(--bb-orange)] text-[var(--bb-black)] font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase hover:bg-[var(--bb-orange-bright)] transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Wallet size={14} /> PAY {formatPaise(order.amount_paise)}
                </button>
              </>
            )}

            {phase === "payment" && payment && order && (
              <div className="space-y-4">
                <div className="border border-[var(--bb-line)] p-4">
                  <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-1)] mb-3">PAYMENT</div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Status</span>
                    <span className="font-[var(--font-mono)] text-[0.7rem] text-yellow-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-[blink_1.5s_ease-in-out_infinite]" />
                      {orderStatus === "PAYMENT_PENDING" ? "AWAITING PROVIDER" : "PAYMENT PENDING"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Provider</span>
                    <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)]">{payment.provider} · test</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-1)]">Order ID</span>
<span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-1)]">{payment.provider_order_id}</span>
                  </div>
                  <div className="mt-3 border-t border-[var(--bb-line-soft)] pt-3 font-[var(--font-sans)] text-[0.7rem] text-[var(--bb-grey-2)] leading-relaxed">
                    Awaiting verified provider confirmation. The order will not be marked PAID from the browser — only a signature-verified webhook settles it.
                  </div>
                  {payment.payment_url && (
                    <a
                      href={payment.payment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center justify-center w-full h-[36px] border border-[var(--bb-orange)]/50 bg-[var(--bb-orange)]/10 font-[var(--font-mono)] text-[0.58rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:bg-[var(--bb-orange)]/20 transition-colors"
                    >
                      REOPEN PAYMENT LINK ↗
                    </a>
                  )}
                </div>

                {DEMO_MODE && (
                  <div className="border border-[var(--bb-line)] p-4">
                    <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)] mb-2">DEV HELPERS (SIGNED WEBHOOK BOUNDARY)</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => handleSimulate("capture")} disabled={busy} className="h-[32px] border border-green-400/30 bg-green-400/5 font-[var(--font-mono)] text-[0.55rem] uppercase text-green-400 hover:bg-green-400/10 cursor-pointer disabled:opacity-50">
                        CAPTURE
                      </button>
                      <button onClick={() => handleSimulate("failure")} disabled={busy} className="h-[32px] border border-red-400/30 bg-red-400/5 font-[var(--font-mono)] text-[0.55rem] uppercase text-red-400 hover:bg-red-400/10 cursor-pointer disabled:opacity-50">
                        FAIL
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {phase === "failed" && order && (
              <div className="space-y-4">
                <div className="border border-red-400/30 bg-red-400/5 p-5">
                  <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-red-400 mb-2">PAYMENT FAILED</div>
                  <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-2)] leading-relaxed mb-3">
                    Payment was declined in Razorpay Test Mode. The failure was classified by the backend and a single bounded retry is available. No duplicate settlement is possible.
                  </div>
                  <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-2)]">
                    Final state: {orderStatus || "PAYMENT_FAILED"}
                  </div>
                </div>
                <button onClick={handleRetry} disabled={busy} className="w-full h-[38px] border border-[var(--bb-orange)]/50 bg-[var(--bb-orange)]/10 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:bg-[var(--bb-orange)]/20 transition-colors cursor-pointer disabled:opacity-50">
                  RETRY (BOUNDED)
                </button>
                {DEMO_MODE && (
                  <button onClick={() => handleSimulate("capture")} disabled={busy} className="w-full h-[34px] border border-green-400/30 bg-green-400/5 font-[var(--font-mono)] text-[0.55rem] uppercase text-green-400 hover:bg-green-400/10 transition-colors cursor-pointer disabled:opacity-50">
                    SIMULATE CAPTURE (DEV)
                  </button>
                )}
              </div>
            )}

            {phase === "aborted" && (
              <div className="border border-red-400/30 bg-red-400/5 p-5">
                <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-red-400 mb-2">ORDER ABORTED</div>
                <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-2)] leading-relaxed">
                  The bounded retry limit was reached. The order was aborted without a duplicate payment or settlement. Inventory and cart holds are released.
                </div>
                <button onClick={resetSession} className="mt-4 w-full h-[36px] border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.6rem] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] transition-colors cursor-pointer">
                  START NEW SESSION
                </button>
              </div>
            )}

            {phase === "receipt" && order && (
              <>
                <ReceiptCard order={order} payment={payment} />
                {orderStatus === "REFUNDED" && (
                  <div className="border border-[var(--bb-line)] p-4">
                    <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-1)] mb-2">REFUNDED</div>
                    <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-2)]">This order has been refunded. The refund is recorded in the ledger and replayable.</div>
                  </div>
                )}
                {orderStatus !== "REFUNDED" && (
                  <button onClick={handleRefund} disabled={busy} className="w-full h-[36px] border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-red-400 hover:border-red-400/40 transition-colors cursor-pointer disabled:opacity-50">
                    REFUND ORDER
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