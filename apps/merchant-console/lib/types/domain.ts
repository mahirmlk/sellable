// UI display types. These mirror the backend contracts in
// services/commerce/sellable/contracts.py exactly:
//   TransactionStatus <-> OrderStatus
//   PolicyVerdictType  <-> PolicyVerdict
//   ActorType          <-> LedgerActor
// The canonical wire shapes (snake_case) live in lib/api.ts; the mappers in
// each page convert api types -> these display types. Do NOT add backend
// fields here that do not exist in contracts.py.

// Mirrors backend OrderStatus. Policy verdicts (ALLOW/DENY/NEEDS_HUMAN_APPROVAL)
// are a separate axis (PolicyVerdictType) — never an order status.
type TransactionStatus =
  | "AWAITING_CONSENT"
  | "CONSENTED"
  | "PAYMENT_PENDING"
  | "PAID"
  | "FULFILLED"
  | "PAYMENT_FAILED"
  | "ABORTED"
  | "REFUNDED";

type PolicyVerdictType = "ALLOW" | "DENY" | "NEEDS_HUMAN_APPROVAL";

// Mirrors backend LedgerActor.
type ActorType =
  | "buyer_agent"
  | "seller_agent"
  | "policy_engine"
  | "consent_service"
  | "human"
  | "razorpay"
  | "commerce_core";

interface Transaction {
  id: string;
  traceId: string;
  status: TransactionStatus;
  amountPaise: number;
  buyer: { id: string; type: "human" | "agent" };
  channel: "human_chat" | "agent_to_agent";
  policy: {
    verdict: PolicyVerdictType;
    reasonCode?: string;
    policyRefs: string[];
    explanation?: string;
  };
  consent?: {
    status: string;
    amountPaise: number;
    expiresAt: string;
    singleUse: boolean;
  };
  buyerBudgetPaise?: number;
  payment?: {
    provider: string;
    orderId?: string;
    paymentId?: string;
    status: string;
    verifiedByWebhook?: boolean;
  };
  items?: { sku: string; unitPaise: number; linePaise: number; qty: number }[];
  updatedAt: string;
}

// Mirrors backend LedgerEvent.
interface LedgerEvent {
  eventId: string;
  traceId: string;
  timestamp: string;
  actor: ActorType;
  action: string;
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
  reasoningSummary?: string;
  policyRefs: string[];
  outcome_effect: Record<string, unknown> | null;
  provider_ref: string | null;
  flags: string[];
}

interface ApprovalRequest {
  orderId: string;
  buyerId: string;
  amountPaise: number;
  reason: string;
  requestedAt: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

export type {
  TransactionStatus,
  PolicyVerdictType,
  ActorType,
  Transaction,
  LedgerEvent,
  ApprovalRequest,
};
