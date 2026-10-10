"use client";

import { useState, useCallback } from "react";
import { Send } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import {
  consoleServiceRespond,
  type CSResponse,
} from "@/lib/api";

interface ChatMessage {
  id: string;
  role: "customer" | "service" | "system";
  text: string;
}

let messageSeq = 0;
function uid(): string {
  messageSeq += 1;
  return `msg-${Date.now()}-${messageSeq}`;
}

const ACTION_TONE: Record<string, string> = {
  ANSWERED: "border-green-600/20 bg-green-50 text-green-700",
  RETURN_CREATED: "border-green-600/20 bg-green-50 text-green-700",
  EXCHANGE_CREATED: "border-green-600/20 bg-green-50 text-green-700",
  REFUND_REQUESTED: "border-green-600/20 bg-green-50 text-green-700",
  CASE_ESCALATED: "border-amber-600/20 bg-amber-50 text-amber-800",
  AUTH_REQUIRED: "border-amber-600/20 bg-amber-50 text-amber-800",
  NEEDS_INFO: "border-amber-600/20 bg-amber-50 text-amber-800",
  DENIED: "border-red-600/20 bg-red-50 text-red-700",
};

export default function SupportPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<CSResponse | null>(null);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setMessages((prev) => [...prev, { id: uid(), role: "customer", text: message }]);
    setInput("");
    try {
      const result = await consoleServiceRespond({
        message,
        customer_id: customerId.trim() || null,
        order_id: orderId.trim() || null,
      });
      setLastResponse(result);
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "service", text: result.response_message },
        ...(result.action === "AUTH_REQUIRED"
          ? [
              {
                id: uid(),
                role: "system" as const,
                text: "Order tools need a linked customer identity.",
              },
            ]
          : []),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Support request failed");
    } finally {
      setBusy(false);
    }
  }, [input, busy, customerId, orderId]);

  return (
    <div className="mx-auto max-w-[720px] px-6 lg:px-8 py-6 space-y-6">
      <div className="min-w-0">
        <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint">
          Support
        </div>
        <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-ink">
          Support
        </h1>
        <p className="mt-1 max-w-[46rem] text-[13px] leading-relaxed text-muted">
          Order help, shipping, returns, exchanges, and refund requests.
          It can&apos;t issue refunds or override policy.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-sm">
          <span className="text-xs text-muted">Customer ID (optional)</span>
          <input
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="cust_…"
            className="mt-1 w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted">Order ID (optional)</span>
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="ord_…"
            className="mt-1 w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm"
          />
        </label>
      </div>

      {lastResponse && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full border px-2.5 py-1 font-medium ${
              ACTION_TONE[lastResponse.action] ?? "border-hairline bg-panel-2"
            }`}
          >
            {lastResponse.action}
          </span>
          {lastResponse.case_id && (
            <span className="rounded-full border border-hairline bg-panel-2 px-2.5 py-1">
              Case {lastResponse.case_id}
            </span>
          )}
          {lastResponse.order_status && (
            <span className="rounded-full border border-hairline bg-panel-2 px-2.5 py-1">
              Order {lastResponse.order_status}
            </span>
          )}
          {lastResponse.guardrail_blocks.length > 0 && (
            <span className="rounded-full border border-red-600/20 bg-red-50 px-2.5 py-1 text-red-700">
              Guarded: {lastResponse.guardrail_blocks.join(", ")}
            </span>
          )}
        </div>
      )}

      <div className="min-h-[240px] space-y-3 rounded-2xl border border-hairline bg-panel p-4">
        {messages.length === 0 ? (
          <EmptyState
            title="No conversation yet"
            message="Ask about an order, shipment, return, exchange, or refund. Order tools need an authenticated customer."
          />
        ) : (
          messages.map((msg) =>
            msg.role === "customer" ? (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm text-white">
                  {msg.text}
                </div>
              </div>
            ) : msg.role === "service" ? (
              <div key={msg.id} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl border border-black/[0.06] bg-white px-4 py-2.5 text-sm shadow-card">
                  {msg.text}
                </div>
              </div>
            ) : (
              <div key={msg.id} className="text-center text-xs text-muted">
                {msg.text}
              </div>
            )
          )
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Where is my order?"
          className="flex-1 h-9 rounded-full border border-hairline bg-panel px-4 text-sm"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-neutral-900 text-sm text-white disabled:opacity-50"
        >
          <Send size={14} /> {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
