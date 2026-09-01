type TransactionStatus =
  | "QUOTED"
  | "AWAITING_CONSENT"
  | "CONSENTED"
  | "PAYMENT_PENDING"
  | "PAID"
  | "PAYMENT_FAILED"
  | "DENIED"
  | "NEEDS_HUMAN_APPROVAL"
  | "ABORTED"
  | "REFUNDED";

type PolicyVerdictType = "ALLOW" | "DENY" | "NEEDS_HUMAN_APPROVAL";

type ActorType =
  | "buyer_agent"
  | "seller_agent"
  | "policy_engine"
  | "human"
  | "razorpay"
  | "system";

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
  items?: { sku: string; title: string; pricePaise: number; qty: number }[];
  updatedAt: string;
}

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
  providerRefs?: Record<string, string>;
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

interface PolicySettings {
  merchantId: string;
  currency: string;
  maxOrderValuePaise: number;
  maxSingleItemValuePaise: number;
  maxDiscountPercent: number;
  allowedCategories: string[];
  maxNegotiationRounds: number;
  maxUpsellsPerSession: number;
  humanApprovalThresholdPaise: number;
  dailySpendCapPaise: number;
}

interface GrowthMetrics {
  revenue: number;
  agentAssistedRevenue: number;
  upsellRevenue: number;
  avgOrderValue: number;
  upsellOffers: number;
  upsellAccepted: number;
  negotiations: number;
  negotiatedAccepted: number;
  countered: number;
  walkedAway: number;
}

interface AgentManifest {
  merchantName: string;
  status: "discoverable" | "offline";
  endpoints: { label: string; path: string; description: string }[];
  capabilities: string[];
  authentication: string;
}

export type {
  TransactionStatus,
  PolicyVerdictType,
  ActorType,
  Transaction,
  LedgerEvent,
  ApprovalRequest,
  PolicySettings,
  GrowthMetrics,
  AgentManifest,
};
