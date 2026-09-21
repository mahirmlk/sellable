// Presentation-only derivations from already-loaded API records.
// No new backend types, no new endpoints, no invented data. Pure functions
// shared by the commerce pages (Home, Products, Inventory, Orders, Buyers).

import type { ConsoleTransaction } from "@/lib/api";
import type { Transaction, TransactionStatus } from "@/lib/types/domain";

/** Stock threshold used for every low-stock derivation (products, inventory, home). */
export const LOW_STOCK_THRESHOLD = 5;

export type StockState = "in" | "low" | "out";

export function stockState(stock: number, threshold = LOW_STOCK_THRESHOLD): StockState {
  if (stock <= 0) return "out";
  if (stock <= threshold) return "low";
  return "in";
}

/** AI Seller can only sell what is in stock and priced at or above the floor. */
export function aiAvailable(stock: number, floorPaise: number, pricePaise: number): boolean {
  return stock > 0 && floorPaise <= pricePaise;
}

// --- Shared presentation mapper: ConsoleTransaction -> display Transaction.
// 1:1 with backend OrderStatus; approval need is never inferred by rewriting
// the status (same convention as the existing pages).

const STATUS_MAP: Record<string, TransactionStatus> = {
  AWAITING_CONSENT: "AWAITING_CONSENT",
  CONSENTED: "CONSENTED",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PAID: "PAID",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  ABORTED: "ABORTED",
  REFUNDED: "REFUNDED",
  FULFILLED: "FULFILLED",
};

export function mapConsoleTx(tx: ConsoleTransaction): Transaction {
  const channel = tx.channel === "human_chat" ? "human_chat" : "agent_to_agent";
  return {
    id: tx.order_id,
    traceId: tx.trace_id,
    status: STATUS_MAP[tx.status] || (tx.status as TransactionStatus),
    amountPaise: tx.amount_paise,
    buyer: { id: tx.buyer_agent_id, type: channel === "human_chat" ? "human" : "agent" },
    channel,
    policy: {
      verdict: (tx.policy_verdict as Transaction["policy"]["verdict"]) || "ALLOW",
      reasonCode: tx.policy_reason ?? undefined,
      policyRefs: tx.policy_refs || [],
      explanation: tx.policy_explanation ?? undefined,
    },
    buyerBudgetPaise: tx.buyer_budget_paise ?? undefined,
    payment: tx.payment_status
      ? {
          provider: "razorpay",
          orderId: tx.payment_order_id || undefined,
          paymentId: tx.payment_id || undefined,
          paymentUrl: tx.payment_url || undefined,
          status: tx.payment_status,
          verifiedByWebhook: tx.payment_status === "CAPTURED",
        }
      : undefined,
    items: tx.items?.map((item) => ({
      sku: item.sku,
      unitPaise: item.offered_price_paise,
      linePaise: item.line_total_paise,
      qty: item.quantity,
    })),
    updatedAt: tx.created_at,
  };
}

/** Order-tab buckets mapped from existing backend statuses (no invention). */
export type OrderTab =
  | "all"
  | "open"
  | "approval"
  | "payment"
  | "paid"
  | "failed"
  | "refunded";

export function orderTabOf(
  tx: Transaction,
  pendingApprovalIds: Set<string>
): Exclude<OrderTab, "all"> {
  if (tx.policy.verdict === "NEEDS_HUMAN_APPROVAL" || pendingApprovalIds.has(tx.id))
    return "approval";
  switch (tx.status) {
    case "AWAITING_CONSENT":
    case "CONSENTED":
      return "open";
    case "PAYMENT_PENDING":
      return "payment";
    case "PAID":
    case "FULFILLED":
      return "paid";
    case "PAYMENT_FAILED":
    case "ABORTED":
      return "failed";
    case "REFUNDED":
      return "refunded";
  }
}

/** "Open orders": created but no money captured yet and not dead/refunded. */
export function isOpenOrder(tx: Transaction): boolean {
  return (
    tx.status === "AWAITING_CONSENT" ||
    tx.status === "CONSENTED" ||
    tx.status === "PAYMENT_PENDING"
  );
}

export function isFailedPayment(tx: Transaction): boolean {
  return tx.status === "PAYMENT_FAILED" || tx.payment?.status === "FAILED";
}

/** One-line product summary from real line items, e.g. "SKU-A ×2 +1 more". */
export function itemsSummary(
  items: Transaction["items"],
  rawItems?: Array<{ sku: string; quantity: number }>
): string {
  const list = rawItems ?? items?.map((i) => ({ sku: i.sku, quantity: i.qty })) ?? [];
  if (list.length === 0) return "—";
  const first = list.slice(0, 2).map((i) => `${i.sku} ×${i.quantity}`);
  return list.length > 2 ? `${first.join(", ")} +${list.length - 2} more` : first.join(", ");
}
