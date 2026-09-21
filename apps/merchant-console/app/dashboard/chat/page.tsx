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
    done: "bg-[#1f9d55]",
    active: "bg-[#0071e3] animate-[blink_1.5s_ease-in-out_infinite]",
    blocked: "bg-[#b25e00]",
    failed: "bg-[#d92d20]",
  };
  const textTone: Record<string, string> = {
    done: "text-neutral-600",
    active: "text-neutral-900",
    blocked: "text-[#b25e00]",
    failed: "text-[#d92d20]",
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

function ToolRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-[3px] border border-black/[0.05] bg-white font-[var(--font-mono)] text-[0.5rem] tracking-[0.06em] text-neutral-600 rounded-full">
      <span className="text-[#1f9d55]">{icon}</span>
      {label}
    </span>
  );
}

function CartCard({ cart, productTitle }: { cart: CartPayload; productTitle?: string | null }) {
  return (
    <div className="border border-black/[0.06] p-4 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
      <div className="flex items-center justify-between mb-1">
        <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-neutral-600">Cart</span>
        <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.08em] uppercase text-neutral-600">
          ROUND {cart.negotiation_round}
        </span>
      </div>
      {productTitle && (
        <div className="font-[var(--font-sans)] text-[0.8rem] text-neutral-900 mb-3 truncate" title={productTitle}>
          {productTitle}
        </div>
      )}
      <div className="space-y-2 mb-3">
        {cart.items.map((item) => (
          <div key={item.sku} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-[var(--font-mono)] text-[0.72rem] text-neutral-900">{item.sku}</div>
              <div className="font-[var(--font-mono)] text-[0.55rem] text-neutral-600 tabular-nums">
                {item.quantity} × {formatPaise(item.offered_price_paise)}
              </div>
            </div>
            <div className="font-[var(--font-mono)] text-[0.78rem] text-neutral-900 tabular-nums">
              {formatPaise(item.line_total_paise ?? item.quantity * item.offered_price_paise)}
            </div>
          </div>
        ))}
      </div>
      {cart.upsell_offered && (
        <div className="border-l-2 border-[#0071e3]/30 pl-3 py-1 mb-3">
          <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[#0071e3] mb-1">UPSELL</div>
          {cart.upsell_rationale && (
            <div className="font-[var(--font-sans)] text-[0.72rem] text-neutral-600 leading-relaxed">{cart.upsell_rationale}</div>
          )}
        </div>
      )}
      {cart.discount_paise > 0 && (
        <div className="flex items-center justify-between py-1.5 border-t border-black/[0.05]">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Discount</span>
          <span className="font-[var(--font-mono)] text-[0.7rem] text-[#1f9d55] tabular-nums">−{formatPaise(cart.discount_paise)}</span>
        </div>
      )}
      <div className="flex items-center justify-between pt-2.5 mt-1 border-t border-black/[0.06]">
        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-neutral-600">Total</span>
        <span className="font-[var(--font-mono)] text-[1.05rem] text-neutral-900 tabular-nums">{formatPaise(cart.total_paise)}</span>
      </div>
    </div>
  );
}

function PolicyCard({ decision }: { decision: PolicyDecisionPayload }) {
  const allowed = decision.verdict === "ALLOW";
  const hitl = decision.verdict === "NEEDS_HUMAN_APPROVAL";
  return (
    <div className="border border-black/[0.06] p-4 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
      <div className="flex items-center justify-between mb-2.5">
        <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-neutral-600">Policy Decision</span>
        <span className={`font-[var(--font-mono)] text-[0.62rem] tracking-[0.1em] ${allowed ? "text-[#1f9d55]" : hitl ? "text-[#b25e00]" : "text-[#d92d20]"}`}>
          {allowed ? "✓ ALLOW" : hitl ? "HITL REQUIRED" : "✕ DENIED"}
        </span>
      </div>
      {decision.reason_code && (
        <div className="font-[var(--font-mono)] text-[0.62rem] text-neutral-900 mb-1">{decision.reason_code}</div>
      )}
      <div className="font-[var(--font-sans)] text-[0.74rem] text-neutral-600 leading-relaxed mb-3">{decision.reasoning_summary}</div>
      {decision.policy_refs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {decision.policy_refs.map((ref) => (
            <span key={ref} className="font-[var(--font-mono)] text-[0.46rem] tracking-[0.06em] px-1.5 py-0.5 border border-black/[0.12] text-neutral-600 rounded-full">{ref}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ConsentCard({ consent }: { consent: ConsentInfo }) {
  return (
    <div className="border border-black/[0.06] p-4 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
      <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-neutral-600 mb-3">CONSENT</div>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Status</span>
          <span className="font-[var(--font-mono)] text-[0.7rem] text-[#1f9d55] flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#1f9d55]" />{consent.status}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Amount</span>
          <span className="font-[var(--font-mono)] text-[0.8rem] text-neutral-900">{formatPaise(consent.amount_paise)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Payee</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600">{consent.payee_id}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Purpose</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600">{consent.purpose}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Single use</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-neutral-900">{consent.single_use ? "Yes" : "No"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Expires</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-neutral-900">{formatDateTime(consent.expires_at)}</span>
        </div>
      </div>
    </div>
  );
}

function ReceiptCard({ order, payment }: { order: OrderCreateResult; payment?: PaymentAttemptPayload | null }) {
  return (
    <div className="border border-[#1f9d55]/20 bg-green-50 p-5 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-3 mb-4">
        <CheckCircle2 size={22} className="text-[#1f9d55]" />
        <div>
          <div className="font-[var(--font-sans)] text-[1rem] text-neutral-900">Payment captured</div>
          <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-neutral-600">Verified via signed Razorpay webhook</div>
        </div>
      </div>
      <div className="space-y-2 border-t border-[#1f9d55]/15 pt-3">
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Order</span>
          <Link href={`/dashboard/transactions/${order.order_id}`} className="font-[var(--font-mono)] text-[0.7rem] text-[#0071e3] hover:text-[#0068d1] flex items-center gap-1">{order.order_id} <ExternalLink size={10} /></Link>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Amount</span>
          <span className="font-[var(--font-mono)] text-[0.9rem] text-neutral-900">{formatPaise(order.amount_paise)}</span>
        </div>
        {payment?.provider_order_id && (
          <div className="flex items-center justify-between">
            <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Razorpay order</span>
            <span className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600">{payment.provider_order_id}</span>
          </div>
        )}
        {payment?.provider_payment_id && (
          <div className="flex items-center justify-between">
            <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Payment ID</span>
            <span className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600">{payment.provider_payment_id}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Status</span>
          <span className="font-[var(--font-mono)] text-[0.65rem] text-[#1f9d55]">PAID</span>
        </div>
      </div>
      <Link
        href={`/dashboard/transactions/${order.order_id}/replay`}
        className="mt-4 inline-flex items-center justify-center w-full h-9 border border-[#1f9d55]/20 bg-green-50 text-[13px] text-[#1f9d55] hover:bg-green-100 transition-colors font-medium rounded-full"
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
      <div className="px-6 py-4 border-b border-black/[0.06] flex items-center justify-between gap-4 flex-shrink-0">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold tracking-[-0.02em] text-neutral-900">AI Sales</h1>
          <p className="text-[14px] text-neutral-500 mt-1">
            Your AI seller handles product discovery, quotes, negotiation and checkout. Search → quote → negotiate → checkout
          </p>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <PhaseStepper phase={phase} />
          <button onClick={resetSession} className="inline-flex items-center gap-2 h-9 px-3 border border-black/[0.06] bg-transparent text-[13px] text-neutral-600 hover:text-neutral-900 hover:border-black/[0.12] transition-all cursor-pointer font-medium rounded-full">
            <RefreshCw size={11} /> NEW SESSION
          </button>
        </div>
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
              <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-neutral-600">
                Loading conversation…
              </div>
            )}
            {sessionError && (
              <div className="border border-[#b25e00]/20 bg-amber-50 px-4 py-3 font-[var(--font-mono)] text-[0.62rem] text-[#b25e00] rounded-2xl">
                {sessionError}
              </div>
            )}
            {readOnly && (
              <div className="border border-black/[0.06] bg-white px-4 py-3 font-[var(--font-sans)] text-[0.75rem] text-neutral-600 leading-relaxed rounded-2xl">
                Historical session — review only. Start a NEW SESSION for a new purchase; replay and transaction links below keep working.
              </div>
            )}
            {messages.length === 0 && phase === "idle" && (
              <div className="max-w-[520px] mx-auto mt-[7vh] tab-in">
                <div className="flex items-center gap-2 mb-5">
                  <span className="size-2 rounded-full bg-[#0071e3]" />
                  <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.18em] uppercase text-[#0071e3]">Seller Agent</span>
                </div>
                {catalogEmpty ? (
                  <>
                    <div className="font-[var(--font-sans)] text-[1.25rem] text-neutral-900 mb-2 leading-snug">Your catalog is empty.</div>
                    <div className="font-[var(--font-sans)] text-[0.85rem] text-neutral-600 leading-relaxed mb-6">
                      The agent only sells what you actually stock. Add a few products first —
                      then come back and describe what a buyer might ask for.
                    </div>
                    <Link
                      href="/dashboard/catalog"
                      className="inline-flex items-center gap-2 h-9 px-4 bg-[#0071e3] text-white text-[13px] hover:bg-[#0068d1] transition-colors cursor-pointer font-medium rounded-full"
                    >
                      Add products <ArrowRight size={12} />
                    </Link>
                  </>
                ) : (
                  <>
                    <div className="font-[var(--font-sans)] text-[1.25rem] text-neutral-900 mb-2 leading-snug">Describe what you need.</div>
                    <div className="font-[var(--font-sans)] text-[0.85rem] text-neutral-600 leading-relaxed mb-7">
                      I search your catalog, quote a policy-valid cart, and negotiate within your
                      guardrails. Every step lands in the ledger.
                    </div>
                    <div className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.14em] uppercase text-neutral-400 mb-2.5">Try a mission</div>
                    <div className="flex flex-col gap-2">
                      {[
                        "I need a coffee setup for my desk under ₹2,000",
                        "A protective travel case for my headphones",
                        "A workday gift box under ₹2,500",
                      ].map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSend(s)}
                          className="group flex items-center justify-between gap-3 text-left px-3.5 py-2.5 border border-black/[0.06] bg-white hover:border-[#0071e3]/40 hover:bg-[#0071e3]/5 transition-all cursor-pointer rounded-[12px]"
                        >
                          <span className="font-[var(--font-mono)] text-[0.65rem] text-neutral-600 group-hover:text-neutral-900 transition-colors">{s}</span>
                          <ArrowRight size={12} className="text-neutral-400 group-hover:text-[#0071e3] transition-colors shrink-0" />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {phase === "thinking" && (
              <div className="flex items-center gap-3 tab-in" aria-live="polite">
                <span className="flex gap-1">
                  <span className="size-2 bg-[#0071e3] typing-dot rounded-full" />
                  <span className="size-2 bg-[#0071e3] typing-dot [animation-delay:0.15s] rounded-full" />
                  <span className="size-2 bg-[#0071e3] typing-dot [animation-delay:0.3s] rounded-full" />
                </span>
                <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.1em] uppercase text-neutral-600">SEARCHING CATALOG · CHECKING POLICY · PREPARING QUOTE</span>
              </div>
            )}

            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id} className="flex justify-end tab-in">
                    <div className="max-w-[75%] px-4 py-2.5 rounded-2xl bg-[#0071e3] text-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                      <div className="font-[var(--font-sans)] text-[0.85rem] text-white leading-relaxed">{msg.text}</div>
                    </div>
                  </div>
                );
              }
              if (msg.role === "system") {
                const tone =
                  msg.status === "error"
                    ? "border-l-2 border-[#d92d20]/50 text-[#d92d20]"
                    : msg.status === "warning"
                      ? "border-l-2 border-[#b25e00]/50 text-[#b25e00]"
                      : msg.status === "success"
                        ? "border-l-2 border-[#1f9d55]/50 text-[#1f9d55]"
                        : "border-l-2 border-black/[0.12] text-neutral-600";
                return (
                  <div key={msg.id} className={`rounded-2xl bg-neutral-50 border border-black/[0.05] px-4 py-2.5 tab-in ${tone}`}>
                    <div className="font-[var(--font-mono)] text-[0.68rem] leading-relaxed flex items-start gap-2">
                      <span className={`mt-[3px] size-2 rounded-full rotate-45 shrink-0 ${msg.status === "error" ? "bg-[#d92d20]" : msg.status === "warning" ? "bg-[#b25e00]" : msg.status === "success" ? "bg-[#1f9d55]" : "bg-black/[0.12]"}`} />
                      {msg.text}
                    </div>
                  </div>
                );
              }
              return (
                <div key={msg.id} className="max-w-[85%] border border-black/[0.06] bg-white p-3.5 tab-in rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="size-2 rounded-full bg-[#0071e3]" />
                    <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.14em] uppercase text-[#0071e3]">SELLER AGENT</span>
                  </div>
                  <div className="font-[var(--font-sans)] text-[0.85rem] text-neutral-600 leading-relaxed">{msg.text}</div>
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
          <div className="px-6 py-4 border-t border-black/[0.06] flex-shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend(input);
              }}
              className="flex items-center gap-2.5 border border-black/[0.06] bg-white focus-within:border-[#0071e3] focus-within:ring-[3px] focus-within:ring-[#0071e3]/20 transition-colors px-3 h-11 rounded-[12px]"
            >
              <Sparkles size={14} className="text-neutral-400 shrink-0" aria-hidden />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={readOnly ? "Historical session — start a NEW SESSION for a new purchase" : phase === "payment" || phase === "receipt" ? "Session is processing a payment — start a new session to continue" : "Describe what you need…"}
                disabled={busy || phase === "thinking" || readOnly}
                className="flex-1 font-[var(--font-sans)] text-[0.85rem] bg-transparent border-0 text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-0 disabled:opacity-50"
                aria-label="Message the seller agent"
              />
              <button
                type="submit"
                disabled={busy || phase === "thinking" || readOnly || !input.trim()}
                className="inline-flex items-center justify-center size-9 bg-[#0071e3] text-white hover:bg-[#0068d1] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex-shrink-0 rounded-full"
                aria-label="Send message"
              >
                {busy || phase === "thinking" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </form>
            <div className="mt-2 flex items-center justify-between gap-4">
              <span className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] uppercase text-neutral-400 truncate">
                {readOnly
                  ? "READ-ONLY HISTORY — START A NEW SESSION TO BUY AGAIN"
                  : "ENTER TO SEND · EVERY QUOTE AND ORDER LANDS IN THE XAI LEDGER"}
              </span>
              {phase === "quote" && decision?.trace_id && (
                <span className="font-[var(--font-mono)] text-[0.48rem] text-neutral-400 shrink-0">TRACE {decision.trace_id.slice(0, 14)}…</span>
              )}
            </div>
          </div>
        </div>

        {/* Checkout panel */}
        <div className="flex flex-col min-h-0 lg:w-[380px] border-t lg:border-t-0 lg:border-l border-black/[0.06]">
          <div className="px-5 py-3 border-b border-black/[0.06] bg-white flex items-center justify-between flex-shrink-0 rounded-[12px]">
            <div className="flex items-center gap-2">
              <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-neutral-600">Checkout Session</div>
              <span
                title={
                  syncState === "error"
                    ? "Session sync failed — your order itself is always saved server-side; the next action retries this snapshot."
                    : syncState === "saving"
                      ? "Saving session snapshot…"
                      : "Session snapshot saved server-side"
                }
                className={`font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase ${
                  syncState === "error" ? "text-[#d92d20]" : syncState === "saving" ? "text-[#b25e00]" : "text-[#1f9d55]"
                }`}
              >
                {syncState === "error" ? "● UNSYNCED" : syncState === "saving" ? "● SAVING" : "● SAVED"}
              </span>
            </div>
            {phase === "quote" && decision?.trace_id && (
              <button onClick={() => handleCopy(decision.trace_id!)} className="inline-flex items-center gap-1 h-7 px-2 border border-black/[0.06] text-[13px] text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer font-medium rounded-full">
                <Copy size={9} /> {copied ? "COPIED" : "TRACE"}
              </button>
            )}
          </div>
          <div className="overflow-y-auto p-5 space-y-4 max-h-[50vh] lg:max-h-none lg:flex-1">
            {/* Session settings — always visible */}
            <div className="space-y-2.5 pb-4 border-b border-black/[0.05]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-neutral-600">Session budget</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-[var(--font-mono)] text-[0.65rem] text-neutral-600">₹</span>
                  <input
                    type="number"
                    min="1"
                    value={budgetDraft}
                    onChange={(e) => { setBudgetDraft(e.target.value); setBudgetMsg(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyBudget(); } }}
                    className="w-[84px] font-[var(--font-mono)] text-[14px] text-right bg-white border border-black/[0.06] text-neutral-900 px-2 py-1 tabular-nums focus:outline-none focus:border-[#0071e3] transition-colors focus:ring-[3px] focus:ring-[#0071e3]/20"
                    aria-label="Session budget in rupees (press Apply to confirm)"
                  />
                  <button
                    onClick={applyBudget}
                    className="h-7 px-2.5 border border-[#0071e3]/30 bg-[#0071e3]/10 text-[13px] text-[#0071e3] hover:bg-[#0071e3]/15 transition-colors cursor-pointer font-medium rounded-full"
                  >
                    APPLY
                  </button>
                </div>
              </div>
              {budgetMsg && (
                <div className={`font-[var(--font-mono)] text-[0.55rem] tracking-[0.06em] text-right ${budgetMsg.kind === "ok" ? "text-[#1f9d55]" : "text-[#d92d20]"}`}>
                  {budgetMsg.text}
                </div>
              )}
              <div className="font-[var(--font-mono)] text-[0.5rem] text-neutral-600 leading-relaxed">
                Buyer-side session ceiling ({formatPaise(budgetPaise)} applied) — merchant caps below still apply.
              </div>
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-neutral-600">Upsells</span>
                <button
                  onClick={() => setUpsellOn((v) => !v)}
                  className={`h-7 px-3 rounded-full text-[13px] font-medium border transition-all cursor-pointer ${upsellOn ? "border-[#0071e3]/30 bg-[#0071e3]/10 text-[#0071e3]" : "border-black/[0.06] bg-white text-neutral-600 hover:text-neutral-900"}`}
                  aria-pressed={upsellOn}
                >
                  {upsellOn ? "ON" : "OFF"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-neutral-600">HITL threshold</span>
                <span className="font-[var(--font-mono)] text-[0.65rem] text-neutral-900 tabular-nums">
                  {policy ? formatPaise(policy.human_approval_threshold_paise) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-neutral-600">Max item value</span>
                <span className="font-[var(--font-mono)] text-[0.65rem] text-neutral-900 tabular-nums">
                  {policy ? formatPaise(policy.max_single_item_value_paise) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.5rem] text-neutral-600 leading-relaxed">Merchant caps live in Settings</span>
                <Link href="/dashboard/settings" className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[#0071e3] hover:text-[#0068d1] transition-colors">
                  EDIT IN SETTINGS →
                </Link>
              </div>
            </div>

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
                  <div className="border border-[#d92d20]/20 bg-red-50 p-4 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                    <div className="font-[var(--font-sans)] text-[0.78rem] text-neutral-600 leading-relaxed">
                      The proposal was rejected by the deterministic Policy Engine. No Razorpay order was created and no money moved.
                    </div>
                  </div>
                ) : (
                  <>
                    {cart.upsell_offered ? (
                      <button
                        onClick={handleUpsellToggle}
                        disabled={busy}
                        className="w-full h-9 border border-black/[0.06] text-[13px] text-neutral-600 hover:text-neutral-900 hover:border-black/[0.12] transition-all cursor-pointer disabled:opacity-50 font-medium rounded-full"
                      >
                        REMOVE UPSELL
                      </button>
                    ) : (
                      <button
                        onClick={handleUpsellToggle}
                        disabled={busy}
                        className="w-full h-9 border border-[#0071e3]/30 bg-[#0071e3]/10 text-[13px] text-[#0071e3] hover:bg-[#0071e3]/15 transition-all cursor-pointer disabled:opacity-50 font-medium rounded-full"
                      >
                        ADD COMPATIBLE UPSELL
                      </button>
                    )}

                    <div className="border border-black/[0.06]">
                      <button onClick={() => setNegotiating((v) => !v)} className="w-full h-9 flex items-center justify-center gap-2 text-[13px] text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer font-medium rounded-full">
                        <Wallet size={12} /> NEGOTIATE
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
                            className="flex-1 font-[var(--font-mono)] text-[0.7rem] bg-white border border-black/[0.06] text-neutral-900 px-2 py-1.5 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20"
                          />
                          <button type="submit" disabled={busy} className="h-9 px-3 border border-[#0071e3]/30 text-[#0071e3] text-[13px] cursor-pointer disabled:opacity-50 font-medium rounded-full">
                            OFFER
                          </button>
                        </form>
                      )}
                    </div>

                    <button
                      onClick={handleCheckout}
                      disabled={busy}
                      className="w-full h-10 bg-[#0071e3] text-white text-[13px] hover:bg-[#0068d1] transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 font-medium rounded-full"
                    >
                      PROCEED TO CHECKOUT <ArrowRight size={13} />
                    </button>
                  </>
                )}
              </>
            )}

            {phase === "checkout" && (
              <div className="flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-[#0071e3]" />
                <span className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600">Creating order and validating consent…</span>
              </div>
            )}

            {phase === "approval" && order && (
              <div className="border border-[#b25e00]/20 bg-amber-50 p-5 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                <div className="flex items-center gap-3 mb-3">
                  <ShieldAlert size={20} className="text-[#b25e00]" />
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[#b25e00]">Orders waiting for your approval</div>
                    <div className="font-[var(--font-sans)] text-[0.78rem] text-neutral-600 mt-1">
                      Order {order.order_id} exceeds the configured HITL threshold. Payment remains blocked until a merchant approves it.
                    </div>
                  </div>
                </div>
                <Link href="/dashboard/approvals" className="inline-flex items-center justify-center w-full h-9 border border-[#b25e00]/20 bg-amber-50 text-[13px] text-[#b25e00] hover:bg-amber-100 transition-colors font-medium rounded-full">
                  OPEN APPROVAL QUEUE
                </Link>
              </div>
            )}

            {phase === "consent" && consent && order && (
              <>
                <ConsentCard consent={consent} />
                <div className="border border-black/[0.06] p-4 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                  <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-neutral-600 mb-3">ORDER READY</div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Order</span>
                    <Link href={`/dashboard/transactions/${order.order_id}`} className="font-[var(--font-mono)] text-[0.7rem] text-[#0071e3]">{order.order_id}</Link>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Amount</span>
                    <span className="font-[var(--font-mono)] text-[0.9rem] text-neutral-900">{formatPaise(order.amount_paise)}</span>
                  </div>
                </div>
                <button
                  onClick={handlePay}
                  disabled={busy}
                  className="w-full h-10 bg-[#0071e3] text-white text-[13px] hover:bg-[#0068d1] transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 font-medium rounded-full"
                >
                  <Wallet size={14} /> PAY {formatPaise(order.amount_paise)}
                </button>
              </>
            )}

            {phase === "payment" && payment && order && (
              <div className="space-y-4">
                <div className="border border-black/[0.06] p-4 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                  <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-neutral-600 mb-3">PAYMENT</div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Status</span>
                    <span className="font-[var(--font-mono)] text-[0.7rem] text-[#b25e00] flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-[#b25e00] animate-[blink_1.5s_ease-in-out_infinite]" />
                      {orderStatus === "PAYMENT_PENDING" ? "AWAITING PROVIDER" : "PAYMENT PENDING"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Provider</span>
                    <span className="font-[var(--font-mono)] text-[0.65rem] text-neutral-900">{payment.provider} · test</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-neutral-600">Order ID</span>
<span className="font-[var(--font-mono)] text-[0.6rem] text-neutral-600">{payment.provider_order_id}</span>
                  </div>
                  <div className="mt-3 border-t border-black/[0.05] pt-3 font-[var(--font-sans)] text-[0.7rem] text-neutral-600 leading-relaxed">
                    Awaiting verified provider confirmation. The order will not be marked PAID from the browser — only a signature-verified webhook settles it.
                  </div>
                  {payment.payment_url && (
                    <a
                      href={payment.payment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center justify-center w-full h-9 border border-[#0071e3]/30 bg-[#0071e3]/10 text-[13px] text-[#0071e3] hover:bg-[#0071e3]/15 transition-colors font-medium rounded-full"
                    >
                      REOPEN PAYMENT LINK ↗
                    </a>
                  )}
                </div>

                {DEMO_MODE && (
                  <div className="border border-black/[0.06] p-4 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                    <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-neutral-600 mb-2">DEV HELPERS (SIGNED WEBHOOK BOUNDARY)</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => handleSimulate("capture")} disabled={busy} className="h-9 border border-[#1f9d55]/20 bg-green-50 text-[13px] text-[#1f9d55] hover:bg-green-100 cursor-pointer disabled:opacity-50 font-medium rounded-full">
                        CAPTURE
                      </button>
                      <button onClick={() => handleSimulate("failure")} disabled={busy} className="h-9 border border-[#d92d20]/20 bg-red-50 text-[13px] text-[#d92d20] hover:bg-red-100 cursor-pointer disabled:opacity-50 font-medium rounded-full">
                        FAIL
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {phase === "failed" && order && (
              <div className="space-y-4">
                <div className="border border-[#d92d20]/20 bg-red-50 p-5 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                  <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-[#d92d20] mb-2">PAYMENT FAILED</div>
                  <div className="font-[var(--font-sans)] text-[0.78rem] text-neutral-600 leading-relaxed mb-3">
                    Payment was declined in Razorpay Test Mode. The failure was classified by the backend and a single bounded retry is available. No duplicate settlement is possible.
                  </div>
                  <div className="font-[var(--font-mono)] text-[0.55rem] text-neutral-600">
                    Final state: {orderStatus || "PAYMENT_FAILED"}
                  </div>
                </div>
                <button onClick={handleRetry} disabled={busy} className="w-full h-9 border border-[#0071e3]/30 bg-[#0071e3]/10 text-[13px] text-[#0071e3] hover:bg-[#0071e3]/15 transition-colors cursor-pointer disabled:opacity-50 font-medium rounded-full">
                  RETRY (BOUNDED)
                </button>
                {DEMO_MODE && (
                  <button onClick={() => handleSimulate("capture")} disabled={busy} className="w-full h-9 border border-[#1f9d55]/20 bg-green-50 text-[13px] text-[#1f9d55] hover:bg-green-100 transition-colors cursor-pointer disabled:opacity-50 font-medium rounded-full">
                    SIMULATE CAPTURE (DEV)
                  </button>
                )}
              </div>
            )}

            {phase === "aborted" && (
              <div className="border border-[#d92d20]/20 bg-red-50 p-5 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-[#d92d20] mb-2">ORDER ABORTED</div>
                <div className="font-[var(--font-sans)] text-[0.78rem] text-neutral-600 leading-relaxed">
                  The bounded retry limit was reached. The order was aborted without a duplicate payment or settlement. Inventory and cart holds are released.
                </div>
                <button onClick={resetSession} className="mt-4 w-full h-9 border border-black/[0.06] text-[13px] text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer font-medium rounded-full">
                  START NEW SESSION
                </button>
              </div>
            )}

            {phase === "receipt" && order && (
              <>
                <ReceiptCard order={order} payment={payment} />
                {orderStatus === "REFUNDED" && (
                  <div className="border border-black/[0.06] p-4 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                    <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-neutral-600 mb-2">REFUNDED</div>
                    <div className="font-[var(--font-sans)] text-[0.78rem] text-neutral-600">This order has been refunded. The refund is recorded in the ledger and replayable.</div>
                  </div>
                )}
                {orderStatus !== "REFUNDED" && (
                  <button onClick={handleRefund} disabled={busy} className="w-full h-9 border border-black/[0.06] text-[13px] text-neutral-600 hover:text-[#d92d20] hover:border-[#d92d20]/30 transition-colors cursor-pointer disabled:opacity-50 font-medium rounded-full">
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