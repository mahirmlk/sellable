// Production backend is https://api.sellable.shop; localhost is only the
// development fallback. NEXT_PUBLIC_API_URL overrides both when set.
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "production" ? "https://api.sellable.shop" : "http://localhost:8000");
// In demo mode (no Supabase configured) the console authenticates with the
// public demo key. With Supabase configured, merchant auth uses the JWT.
const isDemoMode = () => !process.env.NEXT_PUBLIC_SUPABASE_URL;
const AGENT_KEY =
  process.env.NEXT_PUBLIC_AGENT_KEY || "sellable_demo_key_001";

export interface Product {
  id: string;
  merchant_id: string;
  sku: string;
  title: string;
  description: string;
  price_paise: number;
  floor_paise: number;
  stock: number;
  category: string;
  attributes: Record<string, unknown>;
}

export interface HealthResponse {
  status: string;
  environment: string;
  database: string;
  razorpay_configured: boolean;
}

export interface LedgerEvent {
  event_id: string;
  trace_id: string;
  timestamp: string;
  actor: string;
  action: string;
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
  reasoning_summary: string | null;
  policy_refs: string[];
  outcome_effect: Record<string, unknown> | null;
  provider_ref: string | null;
  flags: string[];
}

export interface ConsoleTransaction {
  order_id: string;
  trace_id: string;
  status: string;
  amount_paise: number;
  buyer_agent_id: string;
  merchant_id: string;
  quote_id: string;
  idempotency_key: string;
  created_at: string;
  // Enrichment derived from the authoritative ledger (backend)
  channel?: "agent_to_agent" | "human_chat";
  items?: Array<{
    sku: string;
    quantity: number;
    unit_price_paise: number;
    offered_price_paise: number;
    line_total_paise: number;
  }>;
  policy_verdict?: string | null;
  policy_reason?: string | null;
  policy_refs?: string[];
  policy_explanation?: string | null;
  buyer_budget_paise?: number | null;
  consent_id?: string | null;
  consent_status?: string | null;
  consent_expires_at?: string | null;
  payment_status?: string | null;
  payment_order_id?: string | null;
  payment_id?: string | null;
}

export interface ConsoleTransactionDetail extends ConsoleTransaction {
  events: LedgerEvent[];
}

export interface ConsoleApproval {
  order_id: string;
  buyer_agent_id: string;
  amount_paise: number;
  reason: string;
  requested_at: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

export interface ConsoleGrowthMetrics {
  revenue: number;
  agent_assisted_revenue: number;
  upsell_revenue: number;
  avg_order_value: number;
  total_orders: number;
  upsell_offers: number;
  upsell_accepted: number;
  negotiations: number;
  negotiated_accepted: number;
  countered: number;
  walked_away: number;
}

export interface ConsolePolicySettings {
  merchant_id: string;
  currency: string;
  max_order_value_paise: number;
  max_single_item_value_paise: number;
  max_discount_percent: number;
  allowed_categories: string[];
  max_negotiation_rounds: number;
  max_upsells_per_session: number;
  human_approval_threshold_paise: number;
}

// --- Agents / system status ---

export type ComponentState = "CONNECTED" | "UNCONFIGURED" | "DEGRADED" | "ERROR" | "OFFLINE";

export interface SystemComponent {
  status: string;
  state: ComponentState;
  mode?: string;
  detail?: string;
  reason?: string | null;
}

export interface PaymentRailStatus {
  provider: string;
  mode: string;
  configured: boolean;
  state: ComponentState;
  webhook_configured: boolean;
  webhook_last_verified_at: string | null;
  reason?: string | null;
  detail?: string;
}

export interface LlmStatus {
  provider: string;
  model: string;
  enabled: boolean;
  status: "scripted" | "connected" | "unconfigured" | "error";
  state: ComponentState;
  mode?: string;
  reason?: string | null;
  detail?: string;
}

export interface AgentsStatusResponse {
  buyer_agent: SystemComponent;
  seller_agent: SystemComponent;
  agent_gateway: SystemComponent;
  policy_engine: SystemComponent;
  ledger: SystemComponent;
  payment_rail: PaymentRailStatus;
  llm: LlmStatus;
  summary: { total_orders: number; paid_orders: number };
}

// --- API error with a structured classification for the UI ---

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly body: unknown;

  constructor(status: number, statusText: string, detail: string, body?: unknown) {
    super(`API error: ${status} ${statusText}${detail ? ` — ${detail}` : ""}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.body = body;
  }

  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

// --- Seller agent / chat contracts (mirror backend) ---

export interface IntentMandate {
  mandate_id: string;
  buyer_agent_id: string;
  budget_ceiling_paise: number;
  allowed_categories: string[];
  purpose: string;
  created_at: string;
  expires_at: string;
}

export interface SellerRequestPayload {
  message: string;
  intent: IntentMandate;
  requested_sku?: string | null;
  quantity?: number;
  buyer_offer_paise?: number | null;
  request_upsell?: boolean;
}

export interface CartItemPayload {
  sku: string;
  quantity: number;
  unit_price_paise: number;
  offered_price_paise: number;
  line_total_paise?: number;
}

export interface CartPayload {
  mandate_id: string;
  intent_ref: string;
  items: CartItemPayload[];
  subtotal_paise: number;
  discount_paise: number;
  total_paise: number;
  upsell_offered: boolean;
  upsell_rationale: string | null;
  negotiation_round: number;
}

export interface PolicyDecisionPayload {
  verdict: "ALLOW" | "DENY" | "NEEDS_HUMAN_APPROVAL";
  reason_code: string | null;
  reasoning_summary: string;
  policy_refs: string[];
}

export interface SellerDecisionPayload {
  trace_id: string;
  action: "QUOTE_READY" | "COUNTERED" | "NEEDS_HUMAN_APPROVAL" | "DENIED" | "NO_MATCH";
  response_message: string;
  cart: CartPayload | null;
  policy_decision: PolicyDecisionPayload | null;
  selected_product: Product | null;
  upsell_product: Product | null;
  tool_calls: string[];
}

export interface OrderCreateResult {
  order_id: string;
  trace_id: string;
  status: string;
  amount_paise: number;
  quote_id: string;
  idempotency_key: string;
  requires_approval?: boolean;
  replayed?: boolean;
}

export interface ConsentInfo {
  consent_id: string;
  order_id: string;
  amount_paise: number;
  payee_id: string;
  purpose: string;
  expires_at: string;
  single_use: boolean;
  status: string;
}

export interface PaymentAttemptPayload {
  attempt_id: string;
  order_id: string;
  provider: string;
  provider_order_id: string;
  provider_payment_id: string | null;
  status: "PAYMENT_PENDING" | "CAPTURED" | "FAILED";
  idempotency_key: string;
  failure_reason: string | null;
  created_at: string;
}

export interface BuyerResultPayload {
  trace_id: string;
  action: "READY_FOR_CONSENT" | "NEEDS_HUMAN_APPROVAL" | "DENIED" | "NO_MATCH";
  buyer_summary: string;
  merchant_manifest: Record<string, unknown>;
  seller_decision: SellerDecisionPayload | null;
  order_id: string | null;
  consent_id: string | null;
  steps: string[];
}

async function getMerchantToken(): Promise<string | null> {
  try {
    const { isSupabaseConfigured } = await import("@/lib/supabase/client");
    if (!isSupabaseConfigured()) return null;
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
      const { data: refreshed, error } = await supabase.auth.refreshSession();
      if (!error && refreshed?.session?.access_token) {
        return refreshed.session.access_token;
      }
    }

    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.headers as Record<string, string>) || {}),
  };
  // The public demo agent key is ONLY for demo mode (no Supabase configured).
  // It must never be sent in production — agent-gateway auth is separate from
  // merchant auth and rejects the well-known demo key there.
  if (isDemoMode() && AGENT_KEY) {
    headers["X-Agent-Key"] = AGENT_KEY;
  }
  const token = await getMerchantToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const detail = await extractErrorDetail(res);
    throw new ApiError(res.status, res.statusText, detail, null);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(200, "OK", `Malformed JSON from ${path}`, null);
  }
}

async function extractErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body?.detail === "string") return body.detail;
    if (body?.detail !== undefined) return JSON.stringify(body.detail);
  } catch {
    // Non-JSON error body; fall back to the status text.
  }
  return res.statusText;
}

// --- Health ---

export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health");
}

// --- Agent gateway ---

export async function searchCatalog(
  query = "",
  categories: string[] = []
): Promise<Product[]> {
  return apiFetch<Product[]>("/agent/catalog.search", {
    method: "POST",
    body: JSON.stringify({ query, categories }),
  });
}

export async function getAgentManifest(): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>("/.well-known/agents.json");
}

// --- Console: Transactions ---

export async function getConsoleTransactions(): Promise<ConsoleTransaction[]> {
  return apiFetch<ConsoleTransaction[]>("/console/transactions");
}

export async function getConsoleTransactionDetail(
  orderId: string
): Promise<ConsoleTransactionDetail> {
  return apiFetch<ConsoleTransactionDetail>(`/console/transactions/${orderId}`);
}

// --- Console: Events ---

export async function getConsoleEvents(
  limit = 200,
  offset = 0
): Promise<{ events: LedgerEvent[]; total: number; limit: number; offset: number }> {
  return apiFetch(`/console/events?limit=${limit}&offset=${offset}`);
}

// --- Console: Approvals ---

export async function getConsoleApprovals(): Promise<ConsoleApproval[]> {
  return apiFetch<ConsoleApproval[]>("/console/approvals");
}

export async function approveConsoleOrder(
  orderId: string
): Promise<{ status: string; order_id: string; consent_id: string }> {
  return apiFetch(`/console/approvals/${orderId}/approve`, { method: "POST" });
}

export async function rejectConsoleOrder(
  orderId: string
): Promise<{ status: string; order_id: string }> {
  return apiFetch(`/console/approvals/${orderId}/reject`, { method: "POST" });
}

// --- Console: Insights ---

export async function getConsoleInsights(): Promise<ConsoleGrowthMetrics> {
  return apiFetch<ConsoleGrowthMetrics>("/console/insights");
}

// --- Console: Policy ---

export async function getConsolePolicy(): Promise<ConsolePolicySettings> {
  return apiFetch<ConsolePolicySettings>("/console/policy");
}

export async function updateConsolePolicy(
  updates: Partial<Omit<ConsolePolicySettings, "merchant_id" | "currency">>
): Promise<ConsolePolicySettings> {
  return apiFetch<ConsolePolicySettings>("/console/policy", {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

// --- Health (public, no key) ---

export async function getHealthPublic(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

// --- Agents / system status ---

export async function getAgentsStatus(): Promise<AgentsStatusResponse> {
  return apiFetch<AgentsStatusResponse>("/agents/status");
}

// --- Seller agent / chat ---

export async function sellerRespond(body: SellerRequestPayload): Promise<SellerDecisionPayload> {
  return apiFetch<SellerDecisionPayload>("/agent/seller/respond", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createOrder(body: {
  intent: IntentMandate;
  message: string;
  idempotency_key: string;
  request_upsell: boolean;
  trace_id?: string;
}): Promise<OrderCreateResult> {
  return apiFetch<OrderCreateResult>("/agent/orders.create", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function requestConsent(orderId: string): Promise<ConsentInfo> {
  return apiFetch<ConsentInfo>("/agent/consents.request", {
    method: "POST",
    body: JSON.stringify({ order_id: orderId }),
  });
}

export async function startPayment(orderId: string, consentId: string): Promise<PaymentAttemptPayload> {
  return apiFetch<PaymentAttemptPayload>(`/orders/${orderId}/payment`, {
    method: "POST",
    body: JSON.stringify({ consent_id: consentId }),
  });
}

export async function retryPayment(orderId: string): Promise<PaymentAttemptPayload> {
  return apiFetch<PaymentAttemptPayload>(`/orders/${orderId}/payment/retry`, {
    method: "POST",
  });
}

export async function refundOrder(orderId: string, reason = "merchant_initiated"): Promise<{ status: string; order_id: string }> {
  return apiFetch<{ status: string; order_id: string }>(`/orders/${orderId}/refund?reason=${encodeURIComponent(reason)}`, {
    method: "POST",
  });
}

// --- Development-only webhook simulation (goes through the verified boundary) ---

export async function simulatePaymentCapture(orderId: string): Promise<PaymentAttemptPayload> {
  return apiFetch<PaymentAttemptPayload>(`/console/orders/${orderId}/simulate-capture`, {
    method: "POST",
  });
}

export async function simulatePaymentFailure(orderId: string): Promise<PaymentAttemptPayload> {
  return apiFetch<PaymentAttemptPayload>(`/console/orders/${orderId}/simulate-failure`, {
    method: "POST",
  });
}

export async function getCatalogItem(sku: string): Promise<Product> {
  return apiFetch<Product>("/agent/catalog.get", {
    method: "POST",
    body: JSON.stringify({ sku }),
  });
}

export async function runBuyerMission(body: {
  buyer_agent_id: string;
  message: string;
  budget_ceiling_paise: number;
  allowed_categories: string[];
  purpose: string;
  expires_at: string;
  request_upsell: boolean;
}): Promise<BuyerResultPayload> {
  return apiFetch<BuyerResultPayload>("/agent/buyer/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Realtime (SSE with fetch so the merchant auth headers are attached) ---

export interface StreamHandlers {
  onEvent: (event: LedgerEvent) => void;
  onError: (error: unknown) => void;
}

export function streamConsoleEvents(handlers: StreamHandlers): () => void {
  const controller = new AbortController();
  let stopped = false;

  async function read() {
    let buffer = "";
    try {
      const res = await fetch(`${API_BASE}/activity/stream`, {
        signal: controller.signal,
        headers: await buildHeaders(),
      });
      if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          try {
            handlers.onEvent(JSON.parse(payload));
          } catch {
            // Ignore malformed frames
          }
        }
      }
    } catch (error) {
      if (!stopped) handlers.onError(error);
    }
  }

  read();
  return () => {
    stopped = true;
    controller.abort();
  };
}

async function buildHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isDemoMode() && AGENT_KEY) headers["X-Agent-Key"] = AGENT_KEY;
  const token = await getMerchantToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}
