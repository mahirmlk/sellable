// Demo Mode data adapter (UPDATE.md §6).
//
// Dedicated demo boundary: every function below serves curated,
// version-controlled fixtures plus a localStorage overlay. NOTHING here
// performs a network request — demo operations cannot mutate production
// data, charge payments, or use production credentials by construction
// (this module imports no fetch, no apiFetch, no secrets).
//
// Interactive behavior (chat, approvals, policy edits, notifications) is
// deterministic and fixture-grounded: scripted responses reference only
// catalog/policy/order records below, never LLM-generated business data.

import { ApiError } from "../api";
import type {
  AgentApiKeyView,
  AgentKeyCreated,
  AnalyticsDay,
  AnalyticsOverview,
  AgentsStatusResponse,
  BillingView,
  BuyerMissionPayload,
  BuyerResultPayload,
  CheckoutSession,
  CheckoutSessionListItem,
  CheckoutSessionPatch,
  CheckoutSessionStatus,
  CheckoutSessionUpsert,
  ConsoleApproval,
  ConsoleGrowthMetrics,
  ConsolePolicySettings,
  ConsoleTransaction,
  ConsoleTransactionDetail,
  ConnectorView,
  CSResponse,
  DriftMetric,
  EvalCaseResult,
  EvalRunSummary,
  EvalSuiteView,
  LedgerEvent,
  MerchantNotification,
  OpsOverview,
  PaymentAttemptPayload,
  Product,
  RefundResult,
  ReplayView,
  SellerDecisionPayload,
  StoreInfo,
  StreamHandlers,
  StreamOptions,
  WebhookDispatchView,
  WebhookSubscriptionView,
  ConsentInfo,
  OrderCreateResult,
  ReadinessView,
} from "../api";
import {
  getFixtures,
  loadOverlay,
  mutateOverlay,
  type DemoOverlay,
} from "./store";

const DEMO_MERCHANT = "mrc_demo_store";

let demoCounter = 0;
function demoId(prefix: string): string {
  demoCounter += 1;
  return `${prefix}_demo_${Date.now().toString(36)}_${demoCounter}`;
}

function notFound(what: string): never {
  throw new ApiError(404, "Not Found", `${what} not found in demo data`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

// --- Merged views (fixtures + demo-local overlay) ---

function catalog(): Product[] {
  const overlay = loadOverlay();
  return [
    ...(overlay.productsAdded as unknown as Product[]),
    ...(clone(getFixtures().catalog) as Product[]),
  ];
}

function orders(): ConsoleTransaction[] {
  const overlay = loadOverlay();
  const fixtures = clone(getFixtures().orders) as ConsoleTransaction[];
  const byId = new Map(fixtures.map((o) => [o.order_id, o]));
  for (const added of overlay.ordersAdded as unknown as ConsoleTransaction[]) {
    byId.set(added.order_id, clone(added));
  }
  for (const [id, patch] of Object.entries(overlay.orderPatches)) {
    const existing = byId.get(id);
    if (existing) byId.set(id, { ...existing, ...clone(patch) });
  }
  return [...byId.values()];
}

function findOrder(orderId: string): ConsoleTransaction {
  const order = orders().find((o) => o.order_id === orderId);
  if (!order) notFound(`Order ${orderId}`);
  return order;
}

function mapEvent(raw: Record<string, unknown>, index: number): LedgerEvent {
  return {
    event_id: `evt_demo_${String(index + 1).padStart(3, "0")}`,
    trace_id: (raw.trace_id as string) ?? "",
    timestamp: (raw.at as string) ?? "",
    actor: (raw.actor as string) ?? "system",
    action: (raw.action as string) ?? "",
    inputs: raw.order_id ? { order_id: raw.order_id } : {},
    output: (raw.outcome as Record<string, unknown>) ?? {},
    reasoning_summary: (raw.reasoning as string) ?? null,
    policy_refs: (raw.policies as string[]) ?? [],
    outcome_effect: (raw.outcome as Record<string, unknown>) ?? null,
    provider_ref: null,
    flags: (raw.flags as string[]) ?? [],
  };
}

function events(): LedgerEvent[] {
  const overlay = loadOverlay();
  const fixtures = getFixtures().events as Array<Record<string, unknown>>;
  const base = fixtures.map(mapEvent);
  const added = (overlay.eventsAdded as Array<Record<string, unknown>>).map((e, i) =>
    mapEvent(e, fixtures.length + i)
  );
  return [...base, ...added];
}

function eventsForOrder(orderId: string): LedgerEvent[] {
  return events().filter(
    (e) => (e.inputs as Record<string, unknown>).order_id === orderId
  );
}

function addEvent(
  action: string,
  traceId: string,
  orderId: string | null,
  outcome: Record<string, unknown>,
  reasoning: string,
  policies: string[] = []
): void {
  mutateOverlay((overlay) => {
    overlay.eventsAdded.push({
      action,
      actor: "merchant",
      at: new Date().toISOString(),
      flags: ["demo"],
      inputs: orderId ? { order_id: orderId } : {},
      order_id: orderId,
      outcome,
      policies,
      reasoning,
      trace_id: traceId,
    });
  });
}

function notifications(): MerchantNotification[] {
  const overlay = loadOverlay();
  return (clone(getFixtures().notifications) as MerchantNotification[]).map((n) =>
    overlay.notificationsRead.includes(n.notification_id)
      ? { ...n, status: "READ", read_at: n.read_at ?? new Date().toISOString() }
      : n
  );
}

function approvals(): ConsoleApproval[] {
  const overlay = loadOverlay();
  return (clone(getFixtures().approvals) as ConsoleApproval[]).map((a) => {
    const decided = overlay.approvalsDecided[a.order_id];
    return decided
      ? { ...a, status: decided as ConsoleApproval["status"] }
      : a;
  });
}

function policy(): ConsolePolicySettings {
  const overlay = loadOverlay();
  return {
    ...(clone(getFixtures().policy) as ConsolePolicySettings),
    ...(overlay.policy ?? {}),
  } as ConsolePolicySettings;
}

function sessions(): CheckoutSession[] {
  const overlay = loadOverlay();
  return Object.values(overlay.sessions).map((s) => clone(s) as unknown as CheckoutSession);
}

function missions(): BuyerMissionPayload[] {
  const overlay = loadOverlay();
  const fixtures = clone(getFixtures().missions) as BuyerMissionPayload[];
  const byId = new Map(fixtures.map((m) => [m.mission_id, m]));
  for (const added of overlay.missionsAdded as unknown as BuyerMissionPayload[]) {
    byId.set(added.mission_id, clone(added));
  }
  return [...byId.values()].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
}

function keys(): AgentApiKeyView[] {
  const overlay = loadOverlay();
  const base: AgentApiKeyView[] = [
    {
      key_id: "key_demo_001",
      label: "Demo buyer agent",
      buyer_agent_id: "buyer_demo_01",
      key_prefix: "sk_demo_…0001",
      created_at: "2026-10-01T09:00:00+00:00",
      revoked_at: null,
      last_used_at: "2026-10-13T14:02:00+00:00",
    },
  ];
  const merged = [...(overlay.keys as unknown as AgentApiKeyView[]), ...base];
  return merged.filter((k) => !overlay.keysRevoked.includes(k.key_id));
}

function webhookSubs(): WebhookSubscriptionView[] {
  const overlay = loadOverlay();
  const base = clone(getFixtures().webhookSubs) as Array<
    WebhookSubscriptionView & { created_at: string }
  >;
  const added = overlay.webhooksAdded as unknown as Array<
    WebhookSubscriptionView & { created_at: string }
  >;
  return [...added, ...base].filter(
    (s) => !overlay.webhooksRemoved.includes(s.subscription_id)
  );
}

function connectors(): ConnectorView[] {
  const overlay = loadOverlay();
  const base = clone(getFixtures().connectors) as ConnectorView[];
  const added = overlay.connectorsAdded as unknown as ConnectorView[];
  return [...added, ...base].filter(
    (c) => !overlay.connectorsRemoved.includes(c.connector_id)
  );
}

// --- Store / health / discovery ---

export async function getStore(): Promise<StoreInfo> {
  return clone(getFixtures().store) as StoreInfo;
}

export async function onboardMerchant(): Promise<StoreInfo> {
  // Demo never creates merchants — the sample store already exists.
  return getStore();
}

export async function getHealth(): Promise<{
  status: string;
  environment?: string;
  database?: string;
  razorpay_configured?: boolean;
}> {
  return {
    status: "ok",
    environment: "demo",
    database: "demo-fixtures",
    razorpay_configured: false,
  };
}

export async function getHealthPublic(): Promise<{
  status: string;
  environment?: string;
  database?: string;
  razorpay_configured?: boolean;
}> {
  return getHealth();
}

export async function getAgentsStatus(): Promise<AgentsStatusResponse> {
  const base = clone(getFixtures().agentsStatus) as AgentsStatusResponse;
  const all = orders();
  base.summary = {
    total_orders: all.length,
    paid_orders: all.filter((o) => o.status === "PAID").length,
  };
  return base;
}

export async function getAgentManifest(): Promise<Record<string, unknown>> {
  return clone(getFixtures().manifest) as Record<string, unknown>;
}

export async function searchCatalog(
  query = "",
  categories: string[] = []
): Promise<Product[]> {
  return filterCatalog(query, categories);
}

function filterCatalog(query: string, categories: string[]): Product[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return catalog().filter((p) => {
    if (categories.length > 0 && !categories.includes(p.category)) return false;
    if (tokens.length === 0) return true;
    const hay = `${p.title} ${p.description} ${p.sku} ${p.category}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

// --- Catalog ---

export async function getConsoleCatalog(query = ""): Promise<Product[]> {
  return filterCatalog(query, []);
}

export async function getConsoleCatalogItem(sku: string): Promise<Product> {
  const item = catalog().find((p) => p.sku === sku);
  if (!item) notFound(`Product ${sku}`);
  return item;
}

export async function createConsoleProduct(body: {
  sku: string;
  title: string;
  description: string;
  price_paise: number;
  floor_paise: number;
  stock: number;
  category: string;
  attributes: Record<string, unknown>;
}): Promise<Product> {
  const product: Product = {
    id: demoId("prd"),
    merchant_id: DEMO_MERCHANT,
    ...body,
  };
  mutateOverlay((overlay) => {
    overlay.productsAdded.push(product as unknown as Record<string, unknown>);
  });
  return clone(product);
}

// --- Transactions / orders ---

export async function getConsoleTransactions(
  opts: { limit?: number; offset?: number } = {}
): Promise<ConsoleTransaction[]> {
  const all = orders();
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? all.length;
  return all.slice(offset, offset + limit);
}

export async function getConsoleTransactionDetail(
  orderId: string
): Promise<ConsoleTransactionDetail> {
  const order = findOrder(orderId);
  return { ...order, events: eventsForOrder(orderId) };
}

export async function getTransactionReplay(
  orderId: string
): Promise<ReplayView> {
  const order = findOrder(orderId);
  const orderEvents = eventsForOrder(orderId);
  return {
    trace_id: order.trace_id,
    merchant_id: order.merchant_id,
    order_id: order.order_id,
    sections: [
      {
        section: "checkout",
        events: orderEvents.map((e) => ({
          action: e.action,
          actor: e.actor,
          summary: e.reasoning_summary,
          policies: e.policy_refs,
          outcome: e.output,
          at: e.timestamp,
        })),
      },
    ],
    event_count: orderEvents.length,
  };
}

export async function refundOrder(
  orderId: string,
  reason = "merchant_initiated"
): Promise<RefundResult> {
  const order = findOrder(orderId);
  const patched = {
    status: "REFUNDED",
    payment_status: "REFUNDED",
  };
  mutateOverlay((overlay) => {
    overlay.orderPatches[orderId] = {
      ...overlay.orderPatches[orderId],
      ...patched,
    };
  });
  addEvent(
    "refund.completed",
    order.trace_id,
    orderId,
    { amount_paise: order.amount_paise, reason },
    `Demo refund ({reason}): no live money moved.`.replace("{reason}", reason),
    ["refund_authority"]
  );
  return {
    refund_id: demoId("re"),
    order_id: orderId,
    amount_paise: order.amount_paise,
    provider_payment_id: order.payment_id ?? null,
    provider_refund_id: `ref_demo_${orderId}`,
    refund_status: "COMPLETED",
    reason,
    trace_id: order.trace_id,
  };
}

export async function fulfillOrder(
  orderId: string
): Promise<{ status: string; order_id: string }> {
  findOrder(orderId);
  mutateOverlay((overlay) => {
    overlay.orderPatches[orderId] = {
      ...overlay.orderPatches[orderId],
      status: "FULFILLED",
    };
  });
  return { status: "FULFILLED", order_id: orderId };
}

// --- Approvals ---

export async function getConsoleApprovals(
  opts: { limit?: number; offset?: number } = {}
): Promise<ConsoleApproval[]> {
  const all = approvals().filter((a) => a.status === "PENDING");
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? all.length;
  return all.slice(offset, offset + limit);
}

export async function approveConsoleOrder(
  orderId: string
): Promise<{ status: string; order_id: string; consent_id: string; mission_id: string | null }> {
  findOrder(orderId);
  const consentId = demoId("con");
  mutateOverlay((overlay) => {
    overlay.approvalsDecided[orderId] = "APPROVED";
    overlay.orderPatches[orderId] = {
      ...overlay.orderPatches[orderId],
      consent_id: consentId,
      consent_status: "ISSUED",
    };
  });
  return { status: "approved", order_id: orderId, consent_id: consentId, mission_id: null };
}

export async function rejectConsoleOrder(
  orderId: string
): Promise<{ status: string; order_id: string }> {
  findOrder(orderId);
  mutateOverlay((overlay) => {
    overlay.approvalsDecided[orderId] = "REJECTED";
    overlay.orderPatches[orderId] = {
      ...overlay.orderPatches[orderId],
      status: "ABORTED",
    };
  });
  return { status: "rejected", order_id: orderId };
}

// --- Policy / insights ---

export async function getConsolePolicy(): Promise<ConsolePolicySettings> {
  return policy();
}

export async function updateConsolePolicy(
  updates: Partial<ConsolePolicySettings>
): Promise<ConsolePolicySettings> {
  const merged = { ...policy(), ...updates };
  mutateOverlay((overlay) => {
    overlay.policy = { ...(overlay.policy ?? {}), ...updates };
  });
  return merged;
}

export async function getConsoleInsights(): Promise<ConsoleGrowthMetrics> {
  return {
    revenue: 799400,
    agent_assisted_revenue: 799400,
    upsell_revenue: 0,
    avg_order_value: 266467,
    total_orders: 6,
    upsell_offers: 2,
    upsell_accepted: 0,
    negotiations: 1,
    negotiated_accepted: 1,
    countered: 0,
    walked_away: 0,
  };
}

// --- Events / activity stream ---

export async function getConsoleEvents(
  limit = 200,
  offset = 0
): Promise<{ events: LedgerEvent[]; total: number; limit: number; offset: number }> {
  const all = events();
  return { events: all.slice(offset, offset + limit), total: all.length, limit, offset };
}

export function streamConsoleEvents(
  handlers: StreamHandlers,
  _opts: StreamOptions = {}
): () => void {
  let stopped = false;
  const all = events();
  let i = 0;
  const emit = () => {
    if (stopped || i >= all.length) return;
    handlers.onEvent(all[i]);
    i += 1;
    setTimeout(emit, 50);
  };
  setTimeout(emit, 0);
  return () => {
    stopped = true;
  };
}

// --- Checkout sessions (demo-local drafts) ---

export async function getCheckoutSession(
  buyerRef = "human_chat"
): Promise<CheckoutSession | null> {
  const found = sessions().find(
    (s) => s.buyer_ref === buyerRef && s.status === "ACTIVE"
  );
  return found ?? null;
}

export async function saveCheckoutSession(
  body: CheckoutSessionUpsert
): Promise<CheckoutSession> {
  const now = new Date().toISOString();
  const existing = body.session_id ? sessions().find((s) => s.session_id === body.session_id) : undefined;
  const session: CheckoutSession = {
    session_id: existing?.session_id ?? body.session_id ?? demoId("css"),
    merchant_id: DEMO_MERCHANT,
    buyer_ref: body.buyer_ref ?? existing?.buyer_ref ?? "human_chat",
    trace_id: body.trace_id ?? existing?.trace_id ?? null,
    status: existing?.status ?? "ACTIVE",
    budget_paise: body.budget_paise ?? existing?.budget_paise ?? null,
    message: body.message ?? existing?.message ?? null,
    cart: (body.cart as CheckoutSession["cart"]) ?? existing?.cart ?? null,
    decision: (body.decision as CheckoutSession["decision"]) ?? existing?.decision ?? null,
    order_id: body.order_id ?? existing?.order_id ?? null,
    messages: body.messages ?? existing?.messages ?? [],
    title: existing?.title ?? null,
    archived: existing?.archived ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  mutateOverlay((overlay) => {
    overlay.sessions[session.session_id] = session as unknown as Record<string, unknown>;
  });
  return clone(session);
}

export async function closeCheckoutSession(sessionId: string): Promise<CheckoutSession> {
  const session = sessions().find((s) => s.session_id === sessionId);
  if (!session) notFound(`Checkout session ${sessionId}`);
  const closed = { ...session, status: "ABANDONED" as CheckoutSessionStatus, updated_at: new Date().toISOString() };
  mutateOverlay((overlay) => {
    overlay.sessions[sessionId] = closed as unknown as Record<string, unknown>;
  });
  return clone(closed);
}

export async function listCheckoutSessions(
  opts: { buyer_ref?: string; include_archived?: boolean; limit?: number; offset?: number } = {}
): Promise<CheckoutSessionListItem[] | null> {
  const overlay = loadOverlay();
  let all = sessions();
  if (opts.buyer_ref) all = all.filter((s) => s.buyer_ref === opts.buyer_ref);
  if (!opts.include_archived) {
    all = all.filter(
      (s) => !s.archived && !overlay.sessionsArchived.includes(s.session_id)
    );
  }
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? all.length;
  return all.slice(offset, offset + limit).map((s) => ({
    session_id: s.session_id,
    title: s.title,
    status: s.status,
    archived: s.archived,
    order_id: s.order_id,
    trace_id: s.trace_id,
    message: s.message,
    message_count: s.messages.length,
    approval_pending: false,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));
}

export async function getCheckoutSessionById(
  sessionId: string
): Promise<CheckoutSession | null> {
  return sessions().find((s) => s.session_id === sessionId) ?? null;
}

export async function patchCheckoutSession(
  sessionId: string,
  patch: CheckoutSessionPatch
): Promise<CheckoutSession | null> {
  const session = sessions().find((s) => s.session_id === sessionId);
  if (!session) return null;
  const updated = { ...session, ...patch, updated_at: new Date().toISOString() };
  mutateOverlay((overlay) => {
    overlay.sessions[sessionId] = updated as unknown as Record<string, unknown>;
  });
  return clone(updated);
}

export async function archiveCheckoutSession(sessionId: string): Promise<void> {
  mutateOverlay((overlay) => {
    if (!overlay.sessionsArchived.includes(sessionId)) {
      overlay.sessionsArchived.push(sessionId);
    }
  });
}

export async function deleteCheckoutSession(sessionId: string): Promise<void> {
  await archiveCheckoutSession(sessionId);
}

// --- Scripted seller / buyer (fixture-grounded, deterministic) ---

interface SellerIntent {
  mandate_id: string;
  intent_ref?: string;
  buyer_agent_id?: string;
  budget_ceiling_paise?: number;
  allowed_categories?: string[];
  purpose?: string;
}

export async function consoleSellerRespond(body: {
  message: string;
  intent: SellerIntent;
  requested_sku?: string | null;
  quantity?: number;
  buyer_offer_paise?: number | null;
  request_upsell?: boolean;
  price_query?: boolean;
  trace_id?: string;
}): Promise<SellerDecisionPayload> {
  const traceId = /^trc_[0-9a-f]{32}$/.test(body.trace_id ?? "")
    ? (body.trace_id as string)
    : `trc_${"d".repeat(8)}emo${"0".repeat(20)}`.slice(0, 36);
  const message = body.message.toLowerCase();
  const currentPolicy = policy();

  const product =
    (body.requested_sku && catalog().find((p) => p.sku === body.requested_sku)) ||
    filterCatalog(body.message, body.intent.allowed_categories ?? [])[0] ||
    null;

  const toolCalls = ["catalog.search"];
  if (!product) {
    return {
      trace_id: traceId,
      action: "NO_MATCH",
      response_message: `I couldn't find anything matching that in the demo catalog (${catalog().length} sample products). Try "lamp", "chai set", or "coffee".`,
      cart: null,
      policy_decision: null,
      selected_product: null,
      upsell_product: null,
      tool_calls: toolCalls,
    };
  }

  const quantity = Math.min(Math.max(body.quantity ?? 1, 1), 10);
  let unitPrice = product.price_paise;

  if (body.buyer_offer_paise != null && body.buyer_offer_paise < unitPrice) {
    toolCalls.push("quote.negotiate");
    if (body.buyer_offer_paise >= product.floor_paise) {
      unitPrice = body.buyer_offer_paise;
    } else {
      const decision = {
        verdict: "ALLOW" as const,
        reason_code: "BELOW_FLOOR_COUNTER",
        reasoning_summary: `Offer below the demo floor; countering at floor price.`,
        policy_refs: ["floor_price"],
      };
      return {
        trace_id: traceId,
        action: "COUNTERED",
        response_message: `That's below what I can do — the lowest for the ${product.title} is ₹${(product.floor_paise / 100).toFixed(2)}. I can offer it at floor price.`,
        cart: buildCart(body.intent.mandate_id, product, quantity, product.floor_paise),
        policy_decision: decision,
        selected_product: product,
        upsell_product: null,
        tool_calls: toolCalls,
      };
    }
  }

  const total = unitPrice * quantity;
  if (total > currentPolicy.max_order_value_paise) {
    return {
      trace_id: traceId,
      action: "DENIED",
      response_message: `That cart (₹${(total / 100).toFixed(2)}) exceeds the demo max order value.`,
      cart: null,
      policy_decision: {
        verdict: "DENY",
        reason_code: "MAX_ORDER_VALUE",
        reasoning_summary: "Cart exceeds max_order_value_paise.",
        policy_refs: ["max_order_value"],
      },
      selected_product: product,
      upsell_product: null,
      tool_calls: [...toolCalls, "policy.evaluate"],
    };
  }

  if (total > currentPolicy.human_approval_threshold_paise) {
    return {
      trace_id: traceId,
      action: "NEEDS_HUMAN_APPROVAL",
      response_message: `This needs a merchant's approval in the demo (above ₹${(currentPolicy.human_approval_threshold_paise / 100).toFixed(2)}). It's queued under Approvals.`,
      cart: buildCart(body.intent.mandate_id, product, quantity, unitPrice),
      policy_decision: {
        verdict: "NEEDS_HUMAN_APPROVAL",
        reason_code: "HUMAN_APPROVAL_THRESHOLD",
        reasoning_summary: "Above approval threshold.",
        policy_refs: ["human_approval_threshold"],
      },
      selected_product: product,
      upsell_product: null,
      tool_calls: [...toolCalls, "policy.evaluate"],
    };
  }

  void message;
  return {
    trace_id: traceId,
    action: "QUOTE_READY",
    response_message:
      body.price_query === true
        ? `The ${product.title} is ₹${(unitPrice / 100).toFixed(2)}${quantity > 1 ? ` × ${quantity}` : ""} in the demo catalog.`
        : `Here's the ${product.title} at ₹${(unitPrice / 100).toFixed(2)}${quantity > 1 ? ` × ${quantity} = ₹${(total / 100).toFixed(2)}` : ""} — ready when you are.`,
    cart: buildCart(body.intent.mandate_id, product, quantity, unitPrice),
    policy_decision: {
      verdict: "ALLOW",
      reason_code: null,
      reasoning_summary: "Within demo policy limits.",
      policy_refs: ["max_order_value"],
    },
    selected_product: product,
    upsell_product: null,
    tool_calls: [...toolCalls, "policy.evaluate"],
  };
}

function buildCart(
  mandateId: string,
  product: Product,
  quantity: number,
  offered: number
): SellerDecisionPayload["cart"] {
  const line = offered * quantity;
  return {
    mandate_id: mandateId,
    intent_ref: mandateId,
    items: [
      {
        sku: product.sku,
        quantity,
        unit_price_paise: product.price_paise,
        offered_price_paise: offered,
        line_total_paise: line,
      },
    ],
    subtotal_paise: line,
    discount_paise: 0,
    total_paise: line,
    upsell_offered: false,
    upsell_rationale: null,
    negotiation_round: 0,
  };
}

export async function consoleCreateOrder(body: {
  intent: SellerIntent;
  message: string;
  idempotency_key: string;
  request_upsell: boolean;
  requested_sku?: string | null;
  quantity?: number;
  buyer_offer_paise?: number | null;
}): Promise<OrderCreateResult> {
  const existing = orders().find((o) => o.idempotency_key === body.idempotency_key);
  if (existing) {
    return {
      order_id: existing.order_id,
      trace_id: existing.trace_id,
      status: existing.status,
      amount_paise: existing.amount_paise,
      quote_id: existing.quote_id,
      idempotency_key: existing.idempotency_key,
      replayed: true,
    };
  }
  const decision = await consoleSellerRespond({
    message: body.message,
    intent: body.intent,
    requested_sku: body.requested_sku,
    quantity: body.quantity,
    buyer_offer_paise: body.buyer_offer_paise,
  });
  if (decision.action === "NO_MATCH" || !decision.cart || !decision.selected_product) {
    throw new ApiError(409, "Conflict", "No demo product matched this request");
  }
  if (decision.action === "DENIED") {
    throw new ApiError(409, "Conflict", "Demo policy denied this order");
  }
  const item = decision.cart.items[0];
  const orderId = demoId("ord");
  const order: ConsoleTransaction = {
    order_id: orderId,
    trace_id: decision.trace_id,
    status: decision.action === "NEEDS_HUMAN_APPROVAL" ? "AWAITING_CONSENT" : "AWAITING_CONSENT",
    amount_paise: decision.cart.total_paise,
    buyer_agent_id: body.intent.buyer_agent_id ?? "human_chat",
    merchant_id: DEMO_MERCHANT,
    quote_id: demoId("q"),
    idempotency_key: body.idempotency_key,
    created_at: new Date().toISOString(),
    channel: "human_chat",
    items: [
      {
        sku: item.sku,
        quantity: item.quantity,
        unit_price_paise: item.unit_price_paise,
        offered_price_paise: item.offered_price_paise,
        line_total_paise: item.line_total_paise ?? 0,
      },
    ],
    policy_verdict: decision.policy_decision?.verdict ?? null,
    policy_reason: decision.policy_decision?.reason_code ?? null,
    policy_refs: decision.policy_decision?.policy_refs ?? [],
    policy_explanation: decision.policy_decision?.reasoning_summary ?? null,
    buyer_budget_paise: body.intent.budget_ceiling_paise ?? null,
    consent_id: null,
    consent_status: null,
    consent_expires_at: null,
    payment_status: null,
    payment_order_id: null,
    payment_id: null,
    payment_url: null,
  };
  mutateOverlay((overlay) => {
    overlay.ordersAdded.push(order as unknown as Record<string, unknown>);
  });
  addEvent("order.created", decision.trace_id, orderId, { amount_paise: order.amount_paise }, "Demo order created locally; no live side effects.", ["max_order_value"]);
  return {
    order_id: orderId,
    trace_id: decision.trace_id,
    status: order.status,
    amount_paise: order.amount_paise,
    quote_id: order.quote_id,
    idempotency_key: order.idempotency_key,
    requires_approval: decision.action === "NEEDS_HUMAN_APPROVAL",
  };
}

export async function consoleRequestConsent(orderId: string): Promise<ConsentInfo> {
  const order = findOrder(orderId);
  const consentId = demoId("con");
  mutateOverlay((overlay) => {
    overlay.orderPatches[orderId] = {
      ...overlay.orderPatches[orderId],
      consent_id: consentId,
      consent_status: "ISSUED",
      consent_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  });
  return {
    consent_id: consentId,
    order_id: orderId,
    amount_paise: order.amount_paise,
    payee_id: DEMO_MERCHANT,
    purpose: "demo_checkout",
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    single_use: true,
    status: "ISSUED",
  };
}

export async function consoleStartPayment(
  orderId: string,
  _consentId: string
): Promise<PaymentAttemptPayload> {
  const order = findOrder(orderId);
  const attempt: PaymentAttemptPayload = {
    attempt_id: demoId("att"),
    order_id: orderId,
    provider: "razorpay",
    provider_order_id: `order_demo_${orderId}`,
    provider_payment_id: null,
    payment_url: `https://rzp.io/l/${orderId.slice(-8)}test`,
    status: "PAYMENT_PENDING",
    idempotency_key: demoId("idem"),
    failure_reason: null,
    created_at: new Date().toISOString(),
  };
  mutateOverlay((overlay) => {
    overlay.orderPatches[orderId] = {
      ...overlay.orderPatches[orderId],
      status: "PAYMENT_PENDING",
      payment_status: "PENDING",
      payment_order_id: attempt.provider_order_id,
      payment_url: attempt.payment_url,
    };
  });
  return attempt;
}

export async function consoleRetryPayment(orderId: string): Promise<PaymentAttemptPayload> {
  return consoleStartPayment(orderId, "");
}

export async function simulatePaymentCapture(orderId: string): Promise<PaymentAttemptPayload> {
  const order = findOrder(orderId);
  const paymentId = `pay_demo_${orderId.slice(-6)}${demoCounter}`;
  mutateOverlay((overlay) => {
    overlay.orderPatches[orderId] = {
      ...overlay.orderPatches[orderId],
      status: "PAID",
      payment_status: "CAPTURED",
      payment_id: paymentId,
    };
  });
  addEvent("payment.captured", order.trace_id, orderId, { provider_payment_id: paymentId }, "Demo sandbox capture; no live money moved.", ["webhook_authority"]);
  return {
    attempt_id: demoId("att"),
    order_id: orderId,
    provider: "razorpay",
    provider_order_id: order.payment_order_id ?? `order_demo_${orderId}`,
    provider_payment_id: paymentId,
    payment_url: null,
    status: "CAPTURED",
    idempotency_key: demoId("idem"),
    failure_reason: null,
    created_at: new Date().toISOString(),
  };
}

export async function simulatePaymentFailure(orderId: string): Promise<PaymentAttemptPayload> {
  const order = findOrder(orderId);
  mutateOverlay((overlay) => {
    overlay.orderPatches[orderId] = {
      ...overlay.orderPatches[orderId],
      status: "PAYMENT_FAILED",
      payment_status: "FAILED",
    };
  });
  return {
    attempt_id: demoId("att"),
    order_id: orderId,
    provider: "razorpay",
    provider_order_id: order.payment_order_id ?? `order_demo_${orderId}`,
    provider_payment_id: null,
    payment_url: null,
    status: "FAILED",
    idempotency_key: demoId("idem"),
    failure_reason: "demo_card_declined",
    created_at: new Date().toISOString(),
  };
}

// --- Buyer missions (scripted reference flow, demo-local) ---

export async function consoleRunBuyerMission(body: {
  buyer_agent_id: string;
  message: string;
  budget_ceiling_paise: number;
  allowed_categories: string[];
  purpose: string;
  expires_at: string;
  request_upsell: boolean;
  requested_sku?: string | null;
  quantity?: number;
  buyer_offer_paise?: number | null;
}): Promise<BuyerResultPayload> {
  const traceId = `trc_${"e".repeat(8)}mo${"0".repeat(20)}`.slice(0, 36);
  const match = filterCatalog(body.message, body.allowed_categories)[0] ?? null;
  const missionId = demoId("mis");
  if (!match) {
    const denied: BuyerMissionPayload = {
      mission_id: missionId,
      merchant_id: DEMO_MERCHANT,
      trace_id: traceId,
      buyer_agent_id: body.buyer_agent_id,
      order_id: null,
      state: "DENIED",
      required_action: "No demo product matched.",
      order_status: null,
      consent_id: null,
      mission_message: "Demo policy found no matching product.",
      budget_paise: body.budget_ceiling_paise,
      requested_sku: body.requested_sku ?? null,
      quantity: body.quantity ?? 1,
      buyer_offer_paise: body.buyer_offer_paise ?? null,
      negotiated_amount_paise: null,
      payment_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mutateOverlay((overlay) => {
      overlay.missionsAdded.push(denied as unknown as Record<string, unknown>);
    });
    return {
      trace_id: traceId,
      action: "DENIED",
      buyer_summary: "No matching demo product.",
      merchant_manifest: {},
      seller_decision: null,
      order_id: null,
      consent_id: null,
      mission_id: missionId,
      steps: ["search", "deny"],
    };
  }
  const total = match.price_paise * (body.quantity ?? 1);
  const needsApproval = total > policy().human_approval_threshold_paise;
  const orderId = demoId("ord");
  const order: ConsoleTransaction = {
    order_id: orderId,
    trace_id: traceId,
    status: "PAYMENT_PENDING",
    amount_paise: total,
    buyer_agent_id: body.buyer_agent_id,
    merchant_id: DEMO_MERCHANT,
    quote_id: demoId("q"),
    idempotency_key: demoId("idem"),
    created_at: new Date().toISOString(),
    channel: "agent_to_agent",
    items: [
      {
        sku: match.sku,
        quantity: body.quantity ?? 1,
        unit_price_paise: match.price_paise,
        offered_price_paise: match.price_paise,
        line_total_paise: total,
      },
    ],
    policy_verdict: needsApproval ? "NEEDS_HUMAN_APPROVAL" : "ALLOW",
    policy_reason: needsApproval ? "HUMAN_APPROVAL_THRESHOLD" : "ALLOW",
    policy_refs: ["max_order_value"],
    policy_explanation: needsApproval ? "Queued for demo approval." : "Within demo policy.",
    buyer_budget_paise: body.budget_ceiling_paise,
    consent_id: demoId("con"),
    consent_status: "ISSUED",
    consent_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    payment_status: "PENDING",
    payment_order_id: `order_demo_${orderId}`,
    payment_id: null,
    payment_url: `https://rzp.io/l/${orderId.slice(-8)}test`,
  };
  const mission: BuyerMissionPayload = {
    mission_id: missionId,
    merchant_id: DEMO_MERCHANT,
    trace_id: traceId,
    buyer_agent_id: body.buyer_agent_id,
    order_id: orderId,
    state: needsApproval ? "NEEDS_HUMAN_APPROVAL" : "PAYMENT_PENDING",
    required_action: needsApproval
      ? "Approve in the demo approvals queue, then continue."
      : "Complete the sandbox payment, then continue.",
    order_status: "PAYMENT_PENDING",
    consent_id: order.consent_id ?? null,
    mission_message: `Demo mission for the ${match.title}.`,
    budget_paise: body.budget_ceiling_paise,
    requested_sku: match.sku,
    quantity: body.quantity ?? 1,
    buyer_offer_paise: null,
    negotiated_amount_paise: total,
    payment_url: order.payment_url ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  mutateOverlay((overlay) => {
    overlay.ordersAdded.push(order as unknown as Record<string, unknown>);
    overlay.missionsAdded.push(mission as unknown as Record<string, unknown>);
  });
  return {
    trace_id: traceId,
    action: needsApproval ? "NEEDS_HUMAN_APPROVAL" : "READY_FOR_CONSENT",
    buyer_summary: `Demo mission ${missionId} ready for the ${match.title}.`,
    merchant_manifest: {},
    seller_decision: null,
    order_id: orderId,
    consent_id: order.consent_id ?? null,
    mission_id: missionId,
    steps: ["search", "quote", "consent", "payment_pending"],
  };
}

export async function getBuyerMission(missionId: string): Promise<BuyerMissionPayload> {
  const mission = missions().find((m) => m.mission_id === missionId);
  if (!mission) notFound(`Mission ${missionId}`);
  return mission;
}

export async function listBuyerMissions(limit = 20): Promise<BuyerMissionPayload[]> {
  return missions().slice(0, limit);
}

export async function continueBuyerMission(missionId: string): Promise<BuyerMissionPayload> {
  const mission = await getBuyerMission(missionId);
  if (mission.state !== "PAYMENT_PENDING" || !mission.order_id) return mission;
  await simulatePaymentCapture(mission.order_id);
  const updated: BuyerMissionPayload = {
    ...mission,
    state: "PAID",
    order_status: "PAID",
    required_action: "None — mission complete.",
    mission_message: "Sandbox payment captured in the demo.",
    updated_at: new Date().toISOString(),
  };
  mutateOverlay((overlay) => {
    const idx = overlay.missionsAdded.findIndex(
      (m) => (m as unknown as BuyerMissionPayload).mission_id === missionId
    );
    if (idx >= 0) {
      overlay.missionsAdded[idx] = updated as unknown as Record<string, unknown>;
    } else {
      overlay.missionsAdded.push(updated as unknown as Record<string, unknown>);
    }
  });
  return updated;
}

// --- Agent keys (demo-local credentials, clearly fake) ---

export async function listAgentKeys(): Promise<AgentApiKeyView[]> {
  return keys();
}

export async function createAgentKey(body: {
  label: string;
  buyer_agent_id: string;
}): Promise<AgentKeyCreated> {
  const key: AgentApiKeyView = {
    key_id: demoId("key"),
    label: body.label,
    buyer_agent_id: body.buyer_agent_id,
    key_prefix: "sk_demo_…demo",
    created_at: new Date().toISOString(),
    revoked_at: null,
    last_used_at: null,
  };
  mutateOverlay((overlay) => {
    overlay.keys.push(key as unknown as Record<string, unknown>);
  });
  return { plaintext: `sk_demo_${key.key_id}_not_a_real_credential`, key };
}

export async function rotateAgentKey(keyId: string): Promise<AgentKeyCreated> {
  const existing = keys().find((k) => k.key_id === keyId);
  if (!existing) notFound(`Key ${keyId}`);
  mutateOverlay((overlay) => {
    if (!overlay.keysRevoked.includes(keyId)) overlay.keysRevoked.push(keyId);
  });
  const created = await createAgentKey({
    label: existing.label,
    buyer_agent_id: existing.buyer_agent_id,
  });
  return { ...created, rotated_from: { ...existing, revoked_at: new Date().toISOString() } };
}

export async function revokeAgentKey(keyId: string): Promise<AgentApiKeyView> {
  const existing = keys().find((k) => k.key_id === keyId);
  if (!existing) notFound(`Key ${keyId}`);
  mutateOverlay((overlay) => {
    if (!overlay.keysRevoked.includes(keyId)) overlay.keysRevoked.push(keyId);
  });
  return { ...existing, revoked_at: new Date().toISOString() };
}

// --- Operations / notifications / analytics / webhooks ---

export async function getOpsOverview(): Promise<OpsOverview> {
  return clone(getFixtures().opsOverview) as OpsOverview;
}

export async function drainEventBus(): Promise<Record<string, number>> {
  return { drained: 0, dead_lettered: 0 };
}

export async function listDeadLetters(): Promise<
  Array<{
    event_id: string;
    event_type: string;
    merchant_id: string;
    aggregate_type: string;
    aggregate_id: string;
    trace_id: string;
    attempts: number;
    last_error: string | null;
    occurred_at: string;
  }>
> {
  return [];
}

export async function retryDeadLetter(_eventId: string): Promise<unknown> {
  return { status: "noop-demo" };
}

export async function listNotifications(
  unreadOnly = false
): Promise<MerchantNotification[]> {
  const all = notifications();
  return unreadOnly ? all.filter((n) => n.status === "UNREAD") : all;
}

export async function markNotificationRead(notificationId: string): Promise<unknown> {
  mutateOverlay((overlay) => {
    if (!overlay.notificationsRead.includes(notificationId)) {
      overlay.notificationsRead.push(notificationId);
    }
  });
  return { notification_id: notificationId, status: "READ" };
}

export async function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  return clone(getFixtures().analyticsOverview) as AnalyticsOverview;
}

export async function getAnalyticsTimeseries(): Promise<AnalyticsDay[]> {
  return clone(getFixtures().analyticsTimeseries) as AnalyticsDay[];
}

export async function listWebhookSubscriptions(): Promise<WebhookSubscriptionView[]> {
  return webhookSubs();
}

export async function createWebhookSubscription(
  url: string,
  events: string[]
): Promise<WebhookSubscriptionView & { secret: string }> {
  const sub: WebhookSubscriptionView & { created_at: string } = {
    subscription_id: demoId("sub"),
    url,
    events,
    active: true,
    created_at: new Date().toISOString(),
  };
  mutateOverlay((overlay) => {
    overlay.webhooksAdded.push(sub as unknown as Record<string, unknown>);
  });
  return { ...clone(sub), secret: "whsec_demo_not_a_real_secret" };
}

export async function deleteWebhookSubscription(subscriptionId: string): Promise<unknown> {
  mutateOverlay((overlay) => {
    if (!overlay.webhooksRemoved.includes(subscriptionId)) {
      overlay.webhooksRemoved.push(subscriptionId);
    }
  });
  return { subscription_id: subscriptionId, status: "DELETED" };
}

export async function listWebhookDispatches(): Promise<WebhookDispatchView[]> {
  return clone(getFixtures().webhookDispatches) as WebhookDispatchView[];
}

// --- Customer service (scripted, order-grounded) ---

export async function consoleServiceRespond(body: {
  message: string;
  customer_id?: string | null;
  order_id?: string | null;
  return_id?: string | null;
  action_hint?: string | null;
  items?: Array<{ sku: string; quantity: number }>;
  replacement_sku?: string | null;
  replacement_quantity?: number;
  amount_paise?: number | null;
  reason?: string | null;
}): Promise<CSResponse> {
  const traceId = `trc_${"f".repeat(8)}cs${"0".repeat(20)}`.slice(0, 36);
  const base = {
    trace_id: traceId,
    case_id: null as string | null,
    order_status: null as string | null,
    tool_calls: ["order.get"],
    stage: "RESOLVE",
    agent_id: "service_demo",
    agent_version: "1.0.0",
    prompt_version: "demo-v1",
    guardrail_blocks: [] as string[],
  };
  const order = body.order_id
    ? orders().find((o) => o.order_id === body.order_id) ?? null
    : null;
  if (body.order_id && !order) {
    return {
      ...base,
      action: "NO_ORDER",
      response_message: `I can't find demo order ${body.order_id}. Check the Orders page for sample order ids.`,
    };
  }
  if (order) {
    return {
      ...base,
      action: "ORDER_STATUS",
      response_message: `Demo order ${order.order_id} is ${order.status} for ₹${(order.amount_paise / 100).toFixed(2)}${order.payment_status ? ` (payment ${order.payment_status})` : ""}.`,
      order_status: order.status,
    };
  }
  void body.customer_id;
  return {
    ...base,
    action: "GREETING",
    response_message:
      "Demo support here. Ask about a sample order (e.g. ord_demo_001), shipping, or returns — answers come from demo records only.",
    tool_calls: [],
    stage: "INTAKE",
  };
}

// --- Evals ---

export async function listEvalSuites(): Promise<EvalSuiteView[]> {
  return clone(getFixtures().evalSuites) as EvalSuiteView[];
}

export async function runEvalSuite(suiteId: string): Promise<EvalRunSummary> {
  const suite = (clone(getFixtures().evalSuites) as EvalSuiteView[]).find(
    (s) => s.suite_id === suiteId
  );
  if (!suite) notFound(`Suite ${suiteId}`);
  return {
    run_id: demoId("run"),
    suite_id: suiteId,
    passed: suite.cases,
    failed: 0,
    duration_ms: 1200,
    cost_usd: 0,
  };
}

export async function getEvalRun(runId: string): Promise<{
  run_id: string;
  results: EvalCaseResult[];
}> {
  void runId;
  return { run_id: runId, results: [] };
}

export async function getEvalDrift(): Promise<{
  drifted: boolean;
  baseline: Record<string, number>;
  current: Record<string, number>;
  metrics: DriftMetric[];
}> {
  return clone(getFixtures().evalDrift) as {
    drifted: boolean;
    baseline: Record<string, number>;
    current: Record<string, number>;
    metrics: DriftMetric[];
  };
}

// --- Connectors ---

export async function listConnectors(): Promise<ConnectorView[]> {
  return connectors();
}

export async function registerConnector(body: {
  connector_id: string;
  provider?: string;
  kind?: string;
  base_url?: string;
  products_path?: string;
  field_map?: Record<string, string>;
  timeout_seconds?: number;
}): Promise<ConnectorView> {
  const connector: ConnectorView = {
    connector_id: body.connector_id,
    kind: body.kind ?? "custom_rest",
    provider: body.provider ?? "custom",
    base_url: body.base_url ?? "",
    active: true,
    status: "Illustrative connection — demo only, no live sync",
    last_sync_at: null,
  };
  mutateOverlay((overlay) => {
    overlay.connectorsAdded.push(connector as unknown as Record<string, unknown>);
  });
  return clone(connector);
}

export async function deleteConnector(connectorId: string): Promise<unknown> {
  mutateOverlay((overlay) => {
    if (!overlay.connectorsRemoved.includes(connectorId)) {
      overlay.connectorsRemoved.push(connectorId);
    }
  });
  return { connector_id: connectorId, status: "DELETED" };
}

export async function connectorHealth(
  connectorId: string
): Promise<{ connector_id: string; ok: boolean; detail: string }> {
  const found = connectors().find((c) => c.connector_id === connectorId);
  if (!found) notFound(`Connector ${connectorId}`);
  return {
    connector_id: connectorId,
    ok: found.active,
    detail: "Illustrative probe — demo only, no live system contacted.",
  };
}

export async function syncConnector(connectorId: string): Promise<Record<string, unknown>> {
  const found = connectors().find((c) => c.connector_id === connectorId);
  if (!found) notFound(`Connector ${connectorId}`);
  return { connector_id: connectorId, synced: catalog().length, errors: 0, demo: true };
}

// --- Billing / readiness / metrics ---

export async function getBilling(): Promise<BillingView> {
  return clone(getFixtures().billing) as BillingView;
}

export async function getOnboardingReadiness(): Promise<ReadinessView> {
  return clone(getFixtures().readiness) as ReadinessView;
}

export async function getAgentMetrics(): Promise<Record<string, unknown>> {
  return { runs: 64, failures: 1, demo: true };
}

export async function getCommerceMetrics(): Promise<Record<string, unknown>> {
  return {
    gmv_paise: 799400,
    orders: orders().length,
    paid_orders: orders().filter((o) => o.status === "PAID").length,
    demo: true,
  };
}

export function __demoOverlayForTests(): DemoOverlay {
  return loadOverlay();
}
