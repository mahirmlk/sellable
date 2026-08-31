const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
// In demo mode (no Supabase configured) the console authenticates with the
// public demo key. With Supabase configured, merchant auth uses the JWT.
const isDemoMode = () => !process.env.NEXT_PUBLIC_SUPABASE_URL;
const AGENT_KEY =
  process.env.NEXT_PUBLIC_AGENT_KEY || (isDemoMode() ? "sellable_demo_key_001" : "");

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

async function getMerchantToken(): Promise<string | null> {
  try {
    const { isSupabaseConfigured } = await import("@/lib/supabase/client");
    if (!isSupabaseConfigured()) return null;
    const { createClient } = await import("@/lib/supabase/client");
    const {
      data: { session },
    } = await createClient().auth.getSession();
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
  if (AGENT_KEY) {
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
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
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
