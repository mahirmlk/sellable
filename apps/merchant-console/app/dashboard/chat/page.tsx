"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { formatPaise, formatTimestamp } from "@/lib/formatters";
import { openRazorpayCheckout } from "@/lib/razorpay";
import {
  getConsolePolicy,
  getConsoleTransactionDetail,
  getStore,
  consoleSellerRespond,
  consoleCreateOrder,
  consoleRequestConsent,
  consoleStartPayment,
  consoleRetryPayment,
  refundOrder,
  simulatePaymentCapture,
  simulatePaymentFailure,
  type SellerDecisionPayload,
  type IntentMandate,
  type CartPayload,
  type PolicyDecisionPayload,
  type ConsentInfo,
  type PaymentAttemptPayload,
  type OrderCreateResult,
  type ConsolePolicySettings,
} from "@/lib/api";

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
const RAZORPAY_KEY = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "";
const PAYMENT_TERMINAL = ["PAID", "FULFILLED", "PAYMENT_FAILED", "ABORTED", "REFUNDED"];

function ToolRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-[3px] border border-[var(--bb-line-soft)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.5rem] tracking-[0.06em] text-[var(--bb-grey-3)]">
      <span className="text-green-400">{icon}</span>
      {label}
    </span>
  );
}

function CartCard({ cart, highlight }: { cart: CartPayload; highlight?: boolean }) {
  return (
    <div className={`border ${highlight ? "border-[var(--bb-orange)]/40 bg-[var(--bb-orange-wash)]" : "border-[var(--bb-line)]"} p-4`}>
      <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-3">
        {highlight ? "CANDIDATE CART" : "CART"}
      </div>
      <div className="space-y-2 mb-3">
        {cart.items.map((item) => (
          <div key={item.sku} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-white)]">{item.sku}</div>
              <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">
                {item.quantity} × {formatPaise(item.offered_price_paise)}
              </div>
            </div>
            <div className="font-[var(--font-mono)] text-[0.8rem] text-[var(--bb-white)]">
              {formatPaise(item.line_total_paise ?? item.quantity * item.offered_price_paise)}
            </div>
          </div>
        ))}
      </div>
      {cart.upsell_offered && (
        <div className="border-l-2 border-[var(--bb-orange)] pl-3 py-1 mb-3">
          <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] uppercase text-[var(--bb-orange)] mb-1">UPSELL INCLUDED</div>
          {cart.upsell_rationale && (
            <div className="font-[var(--font-sans)] text-[0.7rem] text-[var(--bb-grey-2)] leading-relaxed">{cart.upsell_rationale}</div>
          )}
        </div>
      )}
      {cart.discount_paise > 0 && (
        <div className="flex items-center justify-between py-1 border-t border-[var(--bb-line-soft)]">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Discount</span>
          <span className="font-[var(--font-mono)] text-[0.7rem] text-green-400">−{formatPaise(cart.discount_paise)}</span>
        </div>
      )}
      <div className="flex items-center justify-between py-1 border-t border-[var(--bb-line-soft)]">
        <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Negotiation round</span>
        <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-2)]">{cart.negotiation_round}</span>
      </div>
      <div className="flex items-center justify-between pt-2 mt-1 border-t border-[var(--bb-line)]">
        <span className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)]">FINAL</span>
        <span className="font-[var(--font-mono)] text-[1.05rem] text-[var(--bb-white)]">{formatPaise(cart.total_paise)}</span>
      </div>
    </div>
  );
}

function PolicyCard({ decision, budgetPaise }: { decision: PolicyDecisionPayload; budgetPaise?: number | null }) {
  const allowed = decision.verdict === "ALLOW";
  const hitl = decision.verdict === "NEEDS_HUMAN_APPROVAL";
  return (
    <div className={`border p-4 ${allowed ? "border-green-400/30 bg-green-400/5" : hitl ? "border-amber-400/30 bg-amber-400/5" : "border-red-400/30 bg-red-400/5"}`}>
      <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-2">POLICY DECISION</div>
      <div className={`font-[var(--font-mono)] text-[0.85rem] tracking-[0.12em] mb-2 ${allowed ? "text-green-400" : hitl ? "text-amber-400" : "text-red-400"}`}>
        {allowed ? "✓ ALLOW" : hitl ? "NEEDS HUMAN APPROVAL" : `✕ DENIED`}
      </div>
      {decision.reason_code && (
        <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)] mb-1">Reason: {decision.reason_code}</div>
      )}
      <div className="font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-2)] leading-relaxed mb-3">{decision.reasoning_summary}</div>
      {!allowed && !hitl && budgetPaise != null && (
        <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] mb-2">RAZORPAY: NOT ATTEMPTED</div>
      )}
      {decision.policy_refs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-[var(--bb-line-soft)] pt-3">
          {decision.policy_refs.map((ref) => (
            <span key={ref} className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]">{ref}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ConsentCard({ consent }: { consent: ConsentInfo }) {
  return (
    <div className="border border-[var(--bb-line)] p-4">
      <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-3">CONSENT</div>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Status</span>
          <span className="font-[var(--font-mono)] text-[0.7rem] text-green-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />{consent.status}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Amount</span>
          <span className="font-[var(--font-mono)] text-[0.8rem] text-[var(--bb-white)]">{formatPaise(consent.amount_paise)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Payee</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">{consent.payee_id}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Purpose</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">{consent.purpose}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Single use</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-white)]">{consent.single_use ? "Yes" : "No"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Expires</span>
          <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-white)]">{formatTimestamp(consent.expires_at)}</span>
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
          <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">Verified via signed Razorpay webhook</div>
        </div>
      </div>
      <div className="space-y-2 border-t border-green-400/20 pt-3">
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Order</span>
          <Link href={`/dashboard/transactions/${order.order_id}`} className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-orange)] hover:text-[var(--bb-orange-bright)] flex items-center gap-1">{order.order_id} <ExternalLink size={10} /></Link>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Amount</span>
          <span className="font-[var(--font-mono)] text-[0.9rem] text-[var(--bb-white)]">{formatPaise(order.amount_paise)}</span>
        </div>
        {payment?.provider_order_id && (
          <div className="flex items-center justify-between">
            <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Razorpay order</span>
            <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">{payment.provider_order_id}</span>
          </div>
        )}
        {payment?.provider_payment_id && (
          <div className="flex items-center justify-between">
            <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Payment ID</span>
            <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">{payment.provider_payment_id}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Status</span>
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

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [budgetPaise, setBudgetPaise] = useState(600000);
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
  const [storeName, setStoreName] = useState<string | null>(null);

  const sessionMessageRef = useRef<string>("");
  const lastTraceIdRef = useRef<string | null>(null);
  const offerRef = useRef<number | null>(null);
  const abortPollRef = useRef<boolean>(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sessionKeyRef = useRef<string>("");
  const phaseRef = useRef<ChatPhase>("idle");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const resetSession = useCallback(() => {
    abortPollRef.current = true;
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
    sessionMessageRef.current = "";
    lastTraceIdRef.current = null;
    sessionKeyRef.current = uid("session");
  }, []);

  useEffect(() => {
    getConsolePolicy()
      .then((p) => {
        setPolicy(p);
        setCategories(p.allowed_categories.length > 0 ? p.allowed_categories : ["accessories", "gifting", "snacks"]);
      })
      .catch(() => {});
    getStore()
      .then((s) => setStoreName(s.name))
      .catch(() => setStoreName(null));
    return () => {
      abortPollRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, phase]);

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

  const stopPolling = useCallback(() => {
    abortPollRef.current = true;
  }, []);

  const pollOrder = useCallback(
    (orderId: string) => {
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
      window.setTimeout(() => window.clearInterval(timer), 5 * 60 * 1000);
    },
    []
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
        if (opts.isFollowUp) {
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: "seller", text: result.response_message, toolCalls: result.tool_calls },
          ]);
        }
        setPhase(result.action === "NO_MATCH" ? "idle" : "quote");
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            text: "The Seller Agent is unavailable. New AI interactions are temporarily unavailable; existing transactions remain visible.",
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
      if (!trimmed || busy) return;
      sessionKeyRef.current = uid("session");
      setMessages((prev) => [...prev, { id: uid(), role: "user", text: trimmed }]);
      setInput("");
      setPhase("thinking");
      setDecision(null);
      setOrder(null);
      setConsent(null);
      setPayment(null);
      setOrderStatus(null);
      await runRespond(trimmed, { upsell: upsellOn, isFollowUp: false });
    },
    [busy, runRespond, upsellOn]
  );

  const handleUpsellToggle = useCallback(async () => {
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
  }, [upsellOn, runRespond]);

  const handleNegotiate = useCallback(async () => {
    const paise = Math.round(parseFloat(offerInput) * 100);
    if (!paise || paise <= 0 || busy) return;
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
  }, [offerInput, busy, upsellOn, runRespond]);

  const handleCheckout = useCallback(async () => {
    if (!intent || !decision || busy) return;
    setBusy(true);
    setPhase("checkout");
    try {
      const result = await consoleCreateOrder({
        intent,
        message: sessionMessageRef.current,
        idempotency_key: `idem_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
  }, [intent, decision, busy, upsellOn, pollOrder]);

  const handlePay = useCallback(async () => {
    if (!order || !consent || busy) return;
    setBusy(true);
    setPhase("payment");
    try {
      const attempt = await consoleStartPayment(order.order_id, consent.consent_id);
      setPayment(attempt);
      let opened = false;
      if (RAZORPAY_KEY) {
        opened = await openRazorpayCheckout({
          key: RAZORPAY_KEY,
          amountPaise: order.amount_paise,
          orderId: attempt.provider_order_id,
          name: storeName || "SELLABLE",
          description: `Order ${order.order_id}`,
          onSuccess: () => undefined,
        });
      }
      if (!opened) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            text: "Awaiting verified provider confirmation. The order stays in PAYMENT_PENDING until a signed Razorpay webhook settles it.",
            status: "info",
          },
        ]);
      }
      pollOrder(order.order_id);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "system",
          text: "Payment could not be started. Razorpay test-mode credentials or connectivity may be unavailable in this environment.",
          status: "error",
        },
      ]);
      setPhase("consent");
    } finally {
      setBusy(false);
    }
  }, [order, consent, busy, pollOrder, storeName]);

  const handleRetry = useCallback(async () => {
    if (!order || busy) return;
    setBusy(true);
    setPhase("payment");
    try {
      const attempt = await consoleRetryPayment(order.order_id);
      setPayment(attempt);
      let opened = false;
      if (RAZORPAY_KEY) {
        opened = await openRazorpayCheckout({
          key: RAZORPAY_KEY,
          amountPaise: order.amount_paise,
          orderId: attempt.provider_order_id,
          name: storeName || "SELLABLE",
          description: `Order ${order.order_id} (retry)`,
          onSuccess: () => undefined,
        });
      }
      if (!opened) {
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
  }, [order, busy, pollOrder, storeName]);

  const handleSimulate = useCallback(
    async (kind: "capture" | "failure") => {
      if (!order || busy) return;
      setBusy(true);
      try {
        const attempt = kind === "capture" ? await simulatePaymentCapture(order.order_id) : await simulatePaymentFailure(order.order_id);
        setPayment(attempt);
        if (kind === "capture") {
          setPhase("receipt");
        } else {
          setPhase("failed");
        }
        stopPolling();
      } catch {
        // leave current phase; the backend may have rejected the simulation
      } finally {
        setBusy(false);
      }
    },
    [order, busy, stopPolling]
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

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--bb-line)] flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.35rem] tracking-[-0.04em] text-[var(--bb-white)]">Checkout</h1>
          <p className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)] mt-1">
            AGENT-ASSISTED · POLICY-BOUND · HUMAN APPROVED
          </p>
        </div>
        <button onClick={resetSession} className="inline-flex items-center gap-2 h-[30px] px-3 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.52rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer">
          <RefreshCw size={11} /> NEW SESSION
        </button>
      </div>

      {/* Main grid */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Conversation column */}
        <div className="flex flex-col min-h-0">
          <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
            {messages.length === 0 && phase === "idle" && (
              <div className="max-w-[480px] mx-auto mt-[8vh]">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles size={16} className="text-[var(--bb-orange)]" />
                  <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-orange)]">Seller Agent</span>
                </div>
                <div className="font-[var(--font-sans)] text-[1.15rem] text-[var(--bb-white)] mb-2 leading-snug">Describe what you need.</div>
                <div className="font-[var(--font-sans)] text-[0.82rem] text-[var(--bb-grey-3)] leading-relaxed mb-6">
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
              </div>
            )}

            {phase === "thinking" && (
              <div className="flex items-center gap-3">
                <Loader2 size={14} className="animate-spin text-[var(--bb-orange)]" />
                <span className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">SEARCHING CATALOG · CHECKING POLICY · PREPARING QUOTE</span>
              </div>
            )}

            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[70%] px-4 py-2.5 bg-[var(--bb-orange)]/[0.08] border-l-2 border-[var(--bb-orange)]">
                      <div className="font-[var(--font-sans)] text-[0.82rem] text-[var(--bb-white)] leading-relaxed">{msg.text}</div>
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
                placeholder={phase === "payment" || phase === "receipt" ? "Session is processing a payment — start a new session to continue" : "Describe what you need…"}
                disabled={busy || phase === "thinking"}
                className="flex-1 h-[42px] font-[var(--font-sans)] text-[0.85rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-4 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={busy || phase === "thinking" || !input.trim()}
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
            <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-grey-3)]">Checkout Session</div>
            {phase === "quote" && decision?.trace_id && (
              <button onClick={() => handleCopy(decision.trace_id!)} className="inline-flex items-center gap-1 h-[22px] px-2 border border-[var(--bb-line)] font-[var(--font-mono)] text-[0.48rem] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors cursor-pointer">
                <Copy size={9} /> {copied ? "COPIED" : "TRACE"}
              </button>
            )}
          </div>
          <div className="overflow-y-auto p-5 space-y-4 max-h-[50vh] lg:max-h-none lg:flex-1">
            {/* Session settings — always visible */}
            <div className="space-y-2.5 pb-4 border-b border-[var(--bb-line-soft)]">
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">Session budget</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">₹</span>
                  <input
                    type="number"
                    value={Math.round(budgetPaise / 100)}
                    onChange={(e) => setBudgetPaise(Math.max(1, Math.round((parseFloat(e.target.value) || 0) * 100)))}
                    className="w-[76px] font-[var(--font-mono)] text-[0.68rem] text-right bg-[var(--bb-black)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2 py-1 tabular-nums focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
                    aria-label="Session budget in rupees"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">Upsells</span>
                <button
                  onClick={() => setUpsellOn((v) => !v)}
                  className={`h-[24px] w-[44px] font-[var(--font-mono)] text-[0.52rem] tracking-[0.08em] uppercase border transition-all cursor-pointer ${upsellOn ? "border-[var(--bb-orange)]/50 bg-[var(--bb-orange)]/10 text-[var(--bb-orange)]" : "border-[var(--bb-line)] bg-transparent text-[var(--bb-grey-4)] hover:text-[var(--bb-white)]"}`}
                  aria-pressed={upsellOn}
                >
                  {upsellOn ? "ON" : "OFF"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">HITL threshold</span>
                <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)] tabular-nums">
                  {policy ? formatPaise(policy.human_approval_threshold_paise) : "—"}
                </span>
              </div>
            </div>

            {phase === "idle" && (
              <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-3)] leading-relaxed">
                Policy and budget are enforced by the backend Policy Engine — never by the
                browser. Quotes appear here as you negotiate.
              </div>
            )}
            {phase === "thinking" && (
              <div className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-4)]">Evaluating request…</div>
            )}

            {phase === "quote" && decision && cart && (
              <>
                <CartCard cart={cart} highlight={decision.action === "COUNTERED"} />
                {decision.policy_decision && <PolicyCard decision={decision.policy_decision} budgetPaise={intent?.budget_ceiling_paise} />}

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
                          <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-3)]">₹</span>
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
                <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-3)]">Creating order and validating consent…</span>
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
                  <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-3">ORDER READY</div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Order</span>
                    <Link href={`/dashboard/transactions/${order.order_id}`} className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-orange)]">{order.order_id}</Link>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Amount</span>
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
                  <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-3">PAYMENT</div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Status</span>
                    <span className="font-[var(--font-mono)] text-[0.7rem] text-yellow-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-[blink_1.5s_ease-in-out_infinite]" />
                      {orderStatus === "PAYMENT_PENDING" ? "AWAITING PROVIDER" : "PAYMENT PENDING"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Provider</span>
                    <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)]">{payment.provider} · test</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Order ID</span>
                    <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)]">{payment.provider_order_id}</span>
                  </div>
                  <div className="mt-3 border-t border-[var(--bb-line-soft)] pt-3 font-[var(--font-sans)] text-[0.7rem] text-[var(--bb-grey-3)] leading-relaxed">
                    Awaiting verified provider confirmation. The order will not be marked PAID from the browser — only a signature-verified webhook settles it.
                  </div>
                </div>

                {DEMO_MODE && (
                  <div className="border border-[var(--bb-line)] p-4">
                    <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] mb-2">DEV HELPERS (SIGNED WEBHOOK BOUNDARY)</div>
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
                  <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">
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
                    <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] mb-2">REFUNDED</div>
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