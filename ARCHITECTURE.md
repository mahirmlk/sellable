# SELLABLE — Hybrid Architecture

**Track:** Razorpay AI Buildathon 2026 — Track 01: AI Growth & Agentic Commerce  
**Architecture basis:** Combined from the provided **SELLABLE** and **Warrant** architecture documents, with the implementation scope deliberately constrained toward a demonstrable hackathon vertical slice.

> **Core product thesis:** Build the infrastructure that lets an AI buyer discover, negotiate with, and safely purchase from a merchant — while simultaneously giving the merchant bounded mechanisms to increase revenue through contextual upsell/cross-sell and negotiation.

> **Core safety principle:** **The LLM proposes, deterministic policy disposes, consent authorizes, Razorpay settles, and the ledger explains every material action.**

---

## 1. Executive Summary

The project should satisfy both sides of the Track 01 brief without turning into two unrelated products:

1. **Make a merchant sellable to AI buyers end-to-end.**
2. **Grow merchant revenue through agentic negotiation, upsell/cross-sell, and transaction insights.**

The primary product direction is **AI-native merchant commerce**. Revenue growth is integrated into the same transaction lifecycle rather than implemented as a separate marketing system.

The architecture therefore has two cooperating agents and one deterministic commerce backbone:

- **Buyer Agent** — represents an AI buyer's mission, budget, and authorization boundary.
- **Seller Agent** — represents the merchant, discovers products, proposes/counters offers, and suggests bounded upsells.
- **Commerce Core** — catalog, quoting, negotiation constraints, order state machine, consent, policy enforcement, and payment orchestration.
- **Trust Layer** — append-only transaction/event ledger, explanations, policy references, and replayable audit history.
- **Agent Gateway** — discovery and machine-facing APIs that make the merchant understandable and purchasable by AI buyers.
- **Merchant Console** — a focused UI for live transactions, audit/replay, approvals, and a small set of growth insights.

The architecture intentionally does **not** attempt to become a fully compliant implementation of ACP, AP2, NPCI UAP, or x402. Those concepts inform the design patterns, while the implementation remains a buildathon-sized system using Razorpay test-mode APIs.

---

# 2. Requirements Interpretation

## 2.1 Track objective

The supplied brief is framed around:

> **“Grow the merchant's revenue, and make them sellable to AI buyers.”**

The brief provides two broad directions:

- grow a merchant's revenue on Razorpay test-mode APIs;
- make a merchant transactable by an AI buyer end-to-end.

The architecture chooses the second direction as the primary path and obtains the first through transaction-level revenue optimization: contextual upsells/cross-sells, bounded negotiation, and merchant-facing outcome insights.

This is preferable to building a generic conversational upsell chatbot because the project demonstrates an actual **AI buyer → merchant → payment** loop and then shows how the merchant can optimize that loop.

## 2.2 Example directions mapped to the architecture

| Track direction | Architecture capability |
|---|---|
| Conversational in-app checkout | Buyer conversation / merchant Seller Agent / Razorpay Payment Link |
| Agent-readable catalog | Agent Gateway + machine-readable catalog |
| Upsell & cross-sell agent | Bounded Seller Agent upsell tool constrained by policy |
| Campaign/revenue orchestration | Deferred growth analytics and saved-deal insights rather than a separate campaign platform |
| Agent-to-agent commerce | Reference Buyer Agent ↔ Agent Gateway ↔ Seller Agent |
| Explainable money actions | XAI Ledger + policy references + replay UI |
| Safe commerce | Policy Engine + consent + deterministic order state machine + idempotency |
| Failure handling | Classified payment failure + bounded retry/abort + ledgered outcome |

---

# 3. The Bar: What Must Be Demonstrably True

The architecture is designed around the strongest requirement in the brief:

> **Every money action must be explainable, bounded, and gated. Show the audit trail and one failure handled gracefully.**

These words are implementation requirements, not presentation language.

## 3.1 Explainable

Every material action must create a structured ledger event containing enough information to answer:

- Who acted?
- What did they attempt?
- What inputs were used?
- What output/decision resulted?
- Which deterministic policy rules applied?
- What happened to the order/payment state?
- Why was the action allowed, denied, or escalated?

The system should store a concise **reasoning summary**, not hidden chain-of-thought.

Example:

```json
{
  "action": "upsell.suggest",
  "reasoning_summary": "Suggested the laptop sleeve because it is compatible with the selected laptop and remains within the buyer budget.",
  "policy_refs": [
    "POLICY.upsell_allowed",
    "POLICY.buyer_budget"
  ]
}
```

## 3.2 Bounded

The AI must operate inside deterministic limits such as:

- buyer budget ceiling;
- merchant maximum order value;
- per-SKU floor price;
- maximum discount;
- allowed categories;
- maximum negotiation rounds;
- maximum upsells per session;
- daily spend cap where appropriate;
- human-approval threshold.

The LLM cannot modify these constraints.

## 3.3 Gated

No money-changing action can go directly from an LLM decision to Razorpay.

Required sequence:

```text
LLM proposal
    ↓
deterministic validation
    ↓
ALLOW / DENY / NEEDS_HUMAN_APPROVAL
    ↓
consent / authorization
    ↓
payment execution
```

## 3.4 Failure handled gracefully

At least one reproducible Razorpay test-mode failure must be intentionally demonstrated.

Required behavior:

```text
payment attempt
    ↓
provider failure
    ↓
classify error
    ↓
ledger event
    ↓
bounded retry OR clean abort
    ↓
structured user-facing result
    ↓
final audit state
```

There must be no silent retry storm, stack trace shown to the buyer, or ambiguous transaction state.

---

# 4. Product Architecture

```text
                         ┌────────────────────────────┐
                         │          HUMAN             │
                         │ buyer / merchant operator  │
                         └─────────────┬──────────────┘
                                       │
                           chat / approval / replay
                                       │
                                       ▼
                    ┌───────────────────────────────────┐
                    │        MERCHANT CONSOLE            │
                    │ live activity / approval / replay  │
                    │ catalog / policy / growth insights │
                    └─────────────────┬─────────────────┘
                                      │
                                      ▼
┌──────────────────┐      ┌──────────────────────────────────┐
│   BUYER AGENT    │─────▶│          AGENT GATEWAY            │
│                  │ A2A  │ discovery + auth + agent APIs     │
└────────┬─────────┘      └──────────────────┬───────────────┘
         │                                   │
         │                                   ▼
         │                    ┌─────────────────────────────────┐
         └───────────────────▶│          SELLER AGENT           │
                              │ catalog / quote / negotiation   │
                              │ upsell / checkout coordination  │
                              └────────────────┬────────────────┘
                                               │
                                               ▼
                              ┌─────────────────────────────────┐
                              │          COMMERCE CORE          │
                              │                                 │
                              │ Catalog                         │
                              │ Quote & negotiation             │
                              │ Policy Engine                   │
                              │ Consent Service                 │
                              │ Order state machine             │
                              │ Refund service                  │
                              └───────────────┬─────────────────┘
                                              │
                                   ALLOW / DENY / HITL
                                              │
                                              ▼
                              ┌─────────────────────────────────┐
                              │        RAZORPAY ADAPTER         │
                              │ Orders / Payment Links /       │
                              │ Webhooks / Refunds             │
                              └───────────────┬─────────────────┘
                                              │
                                              ▼
                                      Razorpay test mode
                                              │
                                              │ signed webhook
                                              ▼
                              ┌─────────────────────────────────┐
                              │           TRUST LAYER           │
                              │                                 │
                              │ XAI Ledger                      │
                              │ explanations                    │
                              │ policy references               │
                              │ transaction replay              │
                              │ failure trace                   │
                              └─────────────────────────────────┘
```

The key structural decision is that **agents are orchestration and decision-making surfaces, while the Commerce Core owns authoritative business state and money-related invariants.**

---

# 5. Architectural Principles

## 5.1 LLM proposes; deterministic systems dispose

The model can:

- select products from tool results;
- choose a negotiation strategy;
- phrase a counter-offer;
- identify a contextual upsell;
- explain a decision in user-friendly language.

The model cannot:

- bypass the catalog;
- invent SKUs;
- lower a price below the configured floor;
- exceed a buyer's budget;
- authorize payment by itself;
- alter approval thresholds;
- mark a payment as successful;
- bypass consent;
- execute arbitrary Razorpay operations.

## 5.2 Business state belongs outside the LLM

The authoritative order state lives in the Commerce Core database.

Example:

```text
QUOTED
  ↓
AWAITING_CONSENT
  ↓
CONSENTED
  ↓
PAYMENT_PENDING
  ↓
PAID
  ↓
FULFILLED
```

Failure states should be explicit:

```text
PAYMENT_FAILED
ABORTED
REFUNDED
```

## 5.3 Money uses integer paise

All monetary values are integer paise.

Never use floating-point currency arithmetic.

## 5.4 Every material action leaves a ledger event

The ledger should be treated as a first-class output of the architecture rather than an afterthought added for the demo.

## 5.5 One transaction, one coherent trace

A transaction should have a stable `trace_id` connecting:

```text
buyer intent
→ discovery
→ quote
→ negotiation
→ upsell
→ consent
→ policy decision
→ payment
→ webhook
→ receipt
```

A judge opening one transaction in the console should be able to replay the complete path.

---

# 6. Components

## 6.1 Buyer Agent

**Location:** `agents/buyer`

The Buyer Agent is a reference implementation used to prove the agent-to-agent loop and to make the end-to-end demo reproducible.

### Responsibilities

- discover the merchant through the Gateway;
- understand a buyer mission;
- maintain its own budget/mission constraints;
- search merchant products;
- request and evaluate quotes;
- participate in bounded negotiation;
- decide whether to accept an upsell;
- request/receive consent;
- authorize a transaction;
- verify payment outcome;
- produce a buyer-facing summary.

### State machine

```text
DISCOVER
   ↓
RESEARCH
   ↓
REQUEST_QUOTE
   ↓
NEGOTIATE
   ↓
REVIEW_UPSELL
   ↓
CONSENT
   ↓
PAY
   ↓
VERIFY
   ↓
REPORT
```

The Buyer Agent's own budget must remain a separate boundary from merchant policy. A transaction should only proceed when **both buyer authorization and merchant policy allow it**.

---

## 6.2 Agent Gateway

**Location:** `services/commerce/sellable/gateway.py` (canonical) / `agents/seller` (also accessible)

The Agent Gateway makes the merchant machine-discoverable and exposes the transactional interface used by an AI buyer.

### Discovery surfaces

```text
GET /.well-known/agents.json
GET /llms.txt
GET /catalog.ai.json
```

These should communicate:

- merchant capabilities;
- supported tools;
- transactional endpoints;
- auth expectations;
- machine-readable product information.

### Transactional surfaces

```text
POST /agent/catalog.search
POST /agent/catalog.get
POST /agent/quotes.create
POST /agent/quotes.negotiate
POST /agent/consents.request
POST /agent/orders.create
POST /agent/orders.status
POST /agent/refunds.create
```

### Authentication

A simple buildathon implementation may use an API key and request-signing mechanism, while keeping credential material out of the agent prompt.

Where request signing is used, include:

- agent identity;
- timestamp;
- nonce;
- signature.

Replay protection should be deterministic.

---

# 7. Seller Agent

**Location:** `agents/seller`

The Seller Agent is the merchant-facing intelligence layer.

It should use the same core commerce tools for both:

- human conversational checkout;
- machine-to-machine A2A checkout.

This avoids creating two separate business implementations.

## 7.1 Tool set

### Catalog

```text
catalog.search(query, filters)
catalog.get(sku)
```

Only tool-returned products can be proposed.

### Quotes

```text
quotes.create(items)
quotes.negotiate(quote_id, counter)
```

The Seller Agent can choose strategy and language, but the Policy Engine determines what counter-offers are legal.

### Upsell

```text
upsell.suggest(quote_id)
```

Upsells must be:

- relevant to the current purchase;
- present in the real catalog;
- within the buyer's budget;
- within merchant policy;
- limited by session-level upsell constraints;
- accompanied by a concise explanation.

### Consent

```text
consents.request(order_id)
```

### Orders

```text
orders.create(quote_id, consent)
orders.status(order_id)
```

### Refunds

```text
refunds.create(payment_id, amount, reason)
```

Refunds are a secondary feature and should not displace the core end-to-end flow during initial implementation.

---

# 8. Commerce Core

**Location:** `services/commerce/sellable`

The Commerce Core is the deterministic source of truth.

It should contain no agent reasoning logic and should remain usable without an LLM.

## 8.1 Catalog Service

Responsibilities:

- product storage;
- SKU identity;
- title/description;
- attributes;
- category;
- stock;
- price;
- floor price;
- machine-readable catalog serialization.

Example product model:

```python
class Product:
    id: str
    merchant_id: str
    sku: str
    title: str
    description: str
    price_paise: int
    floor_paise: int
    stock: int
    category: str
    attributes: dict
```

## 8.2 Quote Service

A quote is the negotiation boundary between discovery and an order.

A quote should contain:

```text
quote_id
merchant_id
buyer_id
items
base_total
negotiated_total
round_number
upsell_state
status
expires_at
```

The quote becomes immutable enough to snapshot into the eventual order/consent boundary.

## 8.3 Negotiation Service

Negotiation is bounded and deterministic.

Example merchant constraints:

```text
minimum floor price per SKU
maximum discount percentage
maximum rounds
maximum total discount
restricted products/categories
```

The Policy Engine determines the allowed response space.

Conceptually:

```text
buyer counter
    ↓
Policy Engine
    ├── ACCEPTABLE
    ├── COUNTER_WITHIN_BOUND
    ├── DENY
    └── ESCALATE
```

The LLM selects how to communicate the legal response.

If the negotiated price reaches the floor and no acceptable offer remains, the Seller Agent should walk away gracefully and record a saved-deal insight.

---

# 9. Policy Engine

**Location:** `services/commerce/sellable/policy.py`

This is one of the most important components in the entire project.

It must be deterministic, testable, and callable without a model.

## 9.1 Example rules

The exact values should be tuned to the demo catalog, but the architecture should support rules such as:

```python
MAX_ORDER_VALUE_PAISE = 500_000
MAX_SINGLE_ITEM_PAISE = 300_000
ALLOWED_CATEGORIES = {
    "gifting",
    "snacks",
    "accessories",
}
MAX_UPSELLS_PER_SESSION = 1
MAX_NEGOTIATION_ROUNDS = 5
HUMAN_APPROVAL_THRESHOLD = 200_000
```

## 9.2 Policy inputs

The engine should evaluate at least:

```text
merchant policy
buyer budget
cart contents
product category
SKU price/floor
negotiation round
upsell count
order amount
consent validity
```

## 9.3 Policy outputs

```text
ALLOW
DENY(reason_code)
NEEDS_HUMAN_APPROVAL(reason_code)
```

Representative reason codes:

```text
OVER_BUDGET
CATEGORY_NOT_ALLOWED
ITEM_OVER_LIMIT
BELOW_FLOOR_PRICE
MAX_DISCOUNT_EXCEEDED
MAX_NEGOTIATION_ROUNDS
DUPLICATE_UPSELL
ABOVE_APPROVAL_THRESHOLD
MANDATE_EXPIRED
CONSENT_INVALID
```

## 9.4 Double-bound safety

A cart should be evaluated against both:

1. the merchant's policy;
2. the buyer's own authorization boundary.

Example:

```text
Merchant allows: ₹4,000
Buyer budget:    ₹3,000
Cart total:      ₹3,500

Result: DENY — OVER_BUDGET
```

Conversely:

```text
Buyer allows:    ₹10,000
Merchant allows: ₹4,000
Cart total:      ₹6,000

Result: DENY — MERCHANT_POLICY_LIMIT
```

This is much stronger than relying on the agent to “behave.”

---

# 10. Consent / Authorization Service

**Location:** `services/commerce/sellable/consent.py`

The consent mechanism models the spirit of mandate-based agentic payments while remaining intentionally simpler than a full AP2 implementation.

## 10.1 Consent should be

- bound to an order;
- bound to an exact amount;
- bound to the merchant/payee;
- purpose-bound;
- expiring;
- single-use.

Example conceptual artifact:

```json
{
  "consent_id": "con_123",
  "order_id": "ord_456",
  "amount_paise": 185000,
  "payee": "merchant_001",
  "purpose": "single_transaction",
  "exp": "2026-08-28T15:00:00Z",
  "scope": "single_txn"
}
```

A signed token/JWT can be used for the prototype, but this should not be presented as full production AP2 cryptographic compliance.

## 10.2 Human approval

When the transaction exceeds the merchant's human-approval threshold:

```text
Policy Engine
    ↓
NEEDS_HUMAN_APPROVAL
    ↓
Merchant Console approval card
    ↓
Approved / rejected
    ↓
consent continues or transaction aborts
```

This provides a visible demonstration of “gated.”

---

# 11. Order State Machine

Orders must be controlled by deterministic state transitions.

Recommended v1 state machine:

```text
QUOTED
  ↓
AWAITING_CONSENT
  ↓
CONSENTED
  ↓
PAYMENT_PENDING
  ├───────────────→ PAYMENT_FAILED
  │                       ↓
  │                 RETRYING / ABORTED
  │
  ↓
PAID
  ↓
FULFILLED
```

Additional terminal state:

```text
REFUNDED
```

Invalid transitions must be rejected by the Commerce Core rather than by an agent prompt.

---

# 12. Razorpay Payment Rail

**Location:** `services/commerce/sellable/payments/razorpay.py`

Use Razorpay **test mode** as the real payment boundary required by the track.

The payment adapter should hide provider-specific operations from the rest of the system.

## 12.1 Payment operations

Depending on the flow, support:

- Orders API for headless/A2A transaction creation;
- Payment Links for a clickable conversational checkout experience;
- payment-status retrieval;
- signature-verified webhooks;
- refund operation as a secondary feature.

## 12.2 Adapter interface

Keep Razorpay behind a small internal interface:

```python
class PaymentRail(Protocol):
    def create_order(...): ...
    def create_payment_link(...): ...
    def get_payment(...): ...
    def refund(...): ...
```

The rest of the system should not need to know whether the payment provider is Razorpay.

## 12.3 Idempotency

Every payment-changing request must have a stable idempotency key derived from the transaction boundary.

Conceptually:

```text
same order + same payment attempt
                ↓
        same idempotency key
                ↓
retry cannot create a duplicate operation
```

This is essential to the failure demo.

## 12.4 Webhooks

Webhook processing must:

1. validate the provider signature;
2. identify the order/payment;
3. apply a valid state transition;
4. append a ledger event;
5. return a deterministic response.

The webhook must not trust an arbitrary client to claim “payment succeeded.”

---

# 13. Failure Handling Architecture

**This is a first-class requirement, not an edge case.**

## 13.1 Required demo failure

Use a reproducible Razorpay test-mode failure mechanism.

A failure should be intentionally triggered after a valid cart and authorization flow.

## 13.2 Failure handler

```text
Razorpay failure
      ↓
Failure classifier
      ↓
Is error retryable?
      ├── yes ──→ one bounded retry
      │               ↓
      │         same transaction identity
      │               ↓
      │        re-enter payment flow
      │
      └── no ──→ ABORT
                      ↓
                 release hold
                      ↓
                 ledger event
                      ↓
               structured response
```

## 13.3 Classification

At minimum distinguish:

```text
retryable
non_retryable
unknown
```

Never automatically retry unknown failures.

## 13.4 User-facing behavior

The Buyer Agent should receive something like:

> “The payment was declined. No successful charge was recorded. The system attempted the configured recovery path and the transaction is now marked aborted.”

The exact wording can be model-generated, but the factual state must come from the Commerce Core and ledger.

## 13.5 Required audit entries

A failed payment should leave an explicit trail:

```text
payment.attempted
payment.failed
failure.classified
retry.attempted    # if retry is permitted
payment.succeeded  # if recovery succeeds
OR
transaction.aborted
```

---

# 14. Trust Layer / XAI Ledger

**Location:** `services/commerce/sellable/ledger`

The Trust Layer is the primary mechanism for satisfying the explainability bar.

## 14.1 Ledger characteristics

- append-only;
- immutable event records;
- linked by `trace_id`;
- machine-readable and human-readable;
- queryable by transaction/order;
- replayable in the UI.

## 14.2 Event schema

```python
class LedgerEvent(BaseModel):
    event_id: str
    trace_id: str
    timestamp: datetime
    actor: Literal[
        "buyer_agent",
        "seller_agent",
        "policy_engine",
        "consent_service",
        "human",
        "razorpay",
        "commerce_core"
    ]
    action: str
    inputs: dict
    output: dict
    reasoning_summary: str | None
    policy_refs: list[str]
    outcome_effect: dict | None
    provider_ref: str | None
    flags: list[str]
```

## 14.3 Example event

```json
{
  "event_id": "evt_123",
  "trace_id": "trc_456",
  "actor": "policy_engine",
  "action": "policy.validate_order",
  "inputs": {
    "total_paise": 185000,
    "buyer_budget_paise": 250000
  },
  "output": {
    "decision": "ALLOW"
  },
  "reasoning_summary": "Order is within both buyer budget and merchant order limits.",
  "policy_refs": [
    "POLICY.buyer_budget",
    "POLICY.max_order_value"
  ],
  "outcome_effect": {
    "order_state": "AWAITING_CONSENT"
  },
  "flags": []
}
```

## 14.4 Replay

The Merchant Console should expose a timeline:

```text
13:56:42  buyer_agent      catalog.search
13:56:44  seller_agent     quote.created
13:56:46  seller_agent     negotiation.countered
13:56:48  seller_agent     upsell.offered
13:56:50  policy_engine    order.allowed
13:56:51  consent_service  consent.issued
13:57:02  razorpay         payment.attempted
13:57:06  razorpay         payment.captured
13:57:07  commerce_core    order.paid
```

A transaction detail view should answer:

> **Why did the system do this?**

without exposing internal chain-of-thought.

---

# 15. Revenue Growth Layer

Revenue growth should stay tightly connected to the commerce flow rather than becoming a separate campaign product in v1.

## 15.1 Contextual upsell

The Seller Agent may propose at most a bounded number of relevant add-ons.

Example:

```text
Buyer selects laptop
        ↓
Agent identifies compatible sleeve
        ↓
Policy checks price/category/budget
        ↓
Upsell offered
```

The recommendation must have a concise explanation.

## 15.2 Negotiation for merchant value

The Seller Agent should protect the merchant's floor price while trying to close the sale.

Example:

```text
Buyer: ₹4,500
Merchant floor: ₹5,000
Current price: ₹6,000

Agent can counter within configured limits:
₹5,700 → ₹5,400 → ₹5,100

Cannot go below ₹5,000.
```

If no acceptable price is reached:

```text
walk away
↓
saved deal recorded
```

## 15.3 Growth insights

A small set of derived merchant insights is sufficient for v1:

- upsell attach rate;
- successful vs abandoned negotiations;
- common walk-away reasons;
- average negotiated discount;
- saved-deal count.

Do not build a complete marketing automation platform during the buildathon.

---

# 16. Merchant Console

**Location:** `apps/console`

The UI should focus on proving the architecture rather than becoming a large admin dashboard.

### Real users, real stores

The console authenticates against Supabase Auth. Access tokens are ES256 and
verified against the project JWKS (kid-matched, cached, rotation-aware).
Authentication (who you are) and merchant authorization (what you can access)
are separate steps: the verified `sub` is resolved through `merchant_users`
to the caller's own merchant, and every console endpoint is scoped to it.
An authenticated user with no store gets an explicit onboarding state and
creates their own merchant via `POST /console/onboarding` — the system never
auto-links users to the demo merchant, never substitutes demo data, and never
marks a failing component as healthy.

## 16.1 Core views

### Live transaction feed

Shows:

- buyer discovery;
- negotiation;
- upsell;
- policy decision;
- consent;
- payment status;
- failure/recovery.

### Approval queue

Transactions requiring human approval appear with:

```text
order
amount
buyer
reason for escalation
policy triggered
approve / reject
```

### Transaction replay

Timeline of ledger events with expandable explanations.

### Catalog/policy view

Minimal controls for demo configuration:

- product catalog;
- floor price;
- discount limit;
- max negotiation rounds;
- approval threshold.

### Growth insights

Only a few clearly useful metrics.

---

# 17. Data Model

Use Postgres/Supabase for persistent state.

Implemented tables (every store is a real row; the demo store is a seed row
accessed through the same flow, never a fallback):

```text
merchants           -- one row per store (id, name, created_at)
merchant_users      -- auth_user_id -> merchant_id + role (explicit linking only)
catalog_products    -- per-merchant products (persisted; survive restarts)
orders              -- per-merchant orders
consents            -- single-use payment consents
ledger_events       -- append-only XAI ledger (trace-scoped)
policy              -- per-merchant policy row
```

All application tables have RLS enabled and no grants for the public
`anon`/`authenticated` roles — the browser only holds the public Supabase
client key and never touches these tables directly.

## 17.1 Suggested fields

```text
merchants(
    id,
    name,
    hitl_threshold_paise,
    created_at
)

products(
    id,
    merchant_id,
    sku,
    title,
    description,
    price_paise,
    floor_paise,
    stock,
    category,
    attributes_json
)

policies(
    id,
    merchant_id,
    kind,
    config_json
)

buyers(
    id,
    type,
    api_key_hash,
    daily_cap_paise
)

quotes(
    id,
    merchant_id,
    buyer_id,
    price_paise,
    round,
    status,
    expires_at
)

orders(
    id,
    quote_id,
    amount_paise,
    status,
    idempotency_key,
    created_at
)

consents(
    id,
    order_id,
    amount_paise,
    payee,
    token,
    status,
    approved_at,
    expires_at
)

payments(
    id,
    order_id,
    provider,
    provider_ref,
    status,
    captured_at
)

refunds(
    id,
    payment_id,
    amount_paise,
    reason,
    status
)

ledger_events(
    event_id,
    trace_id,
    timestamp,
    actor,
    action,
    inputs_json,
    output_json,
    reasoning_summary,
    policy_refs_json,
    outcome_effect_json,
    provider_ref,
    flags_json
)
```

---

# 18. Transaction Lifecycle

This is the central vertical slice the team should implement first.

```text
┌──────────────┐
│ Buyer Agent  │
└──────┬───────┘
       │
       │ 1. Discover merchant
       ▼
┌────────────────┐
│ Agent Gateway  │
└──────┬─────────┘
       │
       │ 2. Search catalog
       ▼
┌────────────────┐
│ Seller Agent   │
└──────┬─────────┘
       │
       │ 3. Create quote
       │ 4. Negotiate
       │ 5. Suggest upsell
       ▼
┌────────────────────┐
│ Deterministic      │
│ Policy Engine      │
└──────┬─────────────┘
       │
       ├── DENY ───────────────→ explain + ledger
       │
       ├── HITL ───────────────→ approval queue
       │                         │
       │                         ▼
       │                     approve/reject
       │
       ▼
┌────────────────────┐
│ Consent Service    │
└─────────┬──────────┘
          │
          │ 6. Single-use consent
          ▼
┌────────────────────┐
│ Order Service      │
└─────────┬──────────┘
          │
          │ 7. Create payment
          ▼
┌────────────────────┐
│ Razorpay Test Mode │
└─────────┬──────────┘
          │
          │ webhook
          ▼
┌────────────────────┐
│ Payment Reconciler │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ XAI Ledger         │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Receipt + Replay   │
└────────────────────┘
```

---

# 19. Key Flow: Agent-to-Agent Procurement

```text
Buyer Agent
   │
   ├── GET /.well-known/agents.json
   │
   ├── POST catalog.search
   │
   ├── POST quotes.create
   │
   ├── POST quotes.negotiate
   │
   │                  Seller Agent
   │                       │
   │                       ├── catalog tools
   │                       ├── pricing tools
   │                       └── upsell tools
   │
   ├── accept quote
   │
   ├── request consent
   │
   ▼
Consent Service
   │
   ├── validate order
   ├── validate amount
   ├── validate payee
   ├── check expiry
   └── single-use enforcement
   │
   ▼
Policy / Order Core
   │
   ├── ALLOW
   │
   ▼
Razorpay
   │
   ├── payment success
   │
   └── signed webhook
   │
   ▼
Ledger
   │
   ▼
Receipt + explanation bundle
```

---

# 20. Key Flow: Conversational Human Checkout

The same Seller Agent should be reusable for human chat.

```text
Human Buyer
   ↓
Chat UI
   ↓
Seller Agent
   ↓
catalog.search
   ↓
quote.create
   ↓
upsell.suggest
   ↓
policy.validate
   ↓
consent card
   ↓
Razorpay Payment Link
   ↓
signed webhook
   ↓
receipt
   ↓
"Why was this recommended?"
   ↓
ledger replay
```

This gives the project a visually understandable demo path while the Buyer Agent proves the deeper A2A path.

---

# 21. Key Flow: Denied Transaction

A judge should be able to deliberately cause a policy denial.

Example:

```text
Buyer budget = ₹2,000
Cart = ₹2,850

Buyer Agent
   ↓
Seller Agent
   ↓
Policy Engine
   ↓
DENY
   reason = OVER_BUDGET
   ↓
No payment call
   ↓
Ledger event
   ↓
Human-readable explanation
```

Important invariant:

> **Razorpay must never be called when policy returns DENY.**

That invariant should be covered by automated tests.

---

# 22. Key Flow: Human Approval

```text
Order = ₹2,500
HITL threshold = ₹2,000

Policy Engine
    ↓
NEEDS_HUMAN_APPROVAL
    ↓
Console approval card
    ↓
Merchant approves
    ↓
Consent issued
    ↓
Payment
```

This is a highly visible proof that the agent is gated.

---

# 23. Key Flow: Payment Failure

```text
Valid order
   ↓
Policy ALLOW
   ↓
Consent valid
   ↓
Razorpay payment attempt
   ↓
FAIL
   ↓
Classify failure
   ↓
Ledger: payment.failed
   ↓
Retryable?
   │
   ├── YES → one bounded retry
   │            ↓
   │        success → settle
   │
   └── NO → abort
                ↓
          release hold
                ↓
          structured response
                ↓
             ledger
```

The failure path should be scripted for deterministic reproduction during judging.

---

# 24. API Surface

## Discovery

```http
GET /.well-known/agents.json
GET /llms.txt
GET /catalog.ai.json
```

## Agent APIs

```http
POST /agent/catalog.search
POST /agent/catalog.get
POST /agent/quotes.create
POST /agent/quotes.negotiate
POST /agent/consents.request
POST /agent/orders.create
POST /agent/orders.status
POST /agent/refunds.create
```

## Webhooks

```http
POST /webhooks/razorpay
```

## Console APIs

```http
GET /console/transactions
GET /console/transactions/:id/replay
GET /console/approvals
POST /console/approvals/:id/approve
POST /console/approvals/:id/reject
GET /console/insights
```

Exact endpoint structure can be adjusted during implementation; the contract should remain centered on the transaction lifecycle.

---

# 25. Repository Layout

```text
sellable/
│
├── apps/
│   └── console/                    # Next.js merchant console (planned)
│       ├── app/
│       ├── components/
│       └── lib/
│
├── services/
│   └── commerce/
│       └── sellable/               # Python package root
│           ├── __init__.py
│           ├── main.py             # FastAPI entrypoint
│           ├── config.py           # Runtime configuration
│           ├── core.py             # CommerceCore (orchestration)
│           ├── contracts.py        # Pydantic models & enums
│           ├── catalog.py          # Catalog service
│           ├── policy.py           # Deterministic policy engine
│           ├── orders.py           # Order state machine
│           ├── consent.py          # Single-use consent service
│           ├── gateway.py          # Agent Gateway (discovery + API)
│           ├── agents/
│           │   ├── seller.py       # Seller Agent (LangGraph)
│           │   └── buyer.py        # Buyer Agent (LangGraph)
│           ├── payments/
│           │   ├── service.py      # Payment orchestration
│           │   └── razorpay.py     # Razorpay adapter
│           └── ledger/
│               ├── service.py      # Ledger repository
│               └── database.py     # SQLAlchemy models & engine
│
├── agents/                         # Top-level agent packages
│   ├── seller/
│   │   ├── agent.py                # Seller Agent (canonical location)
│   │   ├── tools.py                # (planned: extracted tools)
│   │   ├── graph/                  # (planned: graph definitions)
│   │   └── prompts/                # (planned: prompt templates)
│   └── buyer/
│       ├── agent.py                # Buyer Agent (canonical location)
│       ├── tools.py                # (planned: extracted tools)
│       ├── graph/                  # (planned: graph definitions)
│       └── prompts/                # (planned: prompt templates)
│
├── evals/
│   ├── scenarios/
│   │   ├── valid_purchase.py       # Valid purchase scenario
│   │   ├── below_floor.py          # Below-floor offer denial
│   │   ├── over_budget.py          # Over-budget denial
│   │   ├── hitl.py                 # Human-in-the-loop approval
│   │   ├── payment_failure.py      # Payment failure handling
│   │   ├── duplicate_webhook.py    # Idempotent webhook
│   │   └── duplicate_consent.py    # Single-use consent enforcement
│   └── runner/
│       └── scenario_runner.py      # (planned: eval harness)
│
├── infra/
│   ├── docker/                     # (planned: Dockerfiles)
│   ├── seed/
│   │   ├── catalog.json            # Demo product catalog
│   │   └── merchant_policy.json    # Demo merchant policy
│   └── webhook/                    # (planned: webhook configs)
│
├── scripts/
│   └── start-webhook-tunnel.ps1    # zrok tunnel for Razorpay webhooks
│
├── docs/
│   └── RAZORPAY_TEST_SETUP.md      # Razorpay test credentials guide
│
├── tests/
│   ├── unit/
│   │   ├── test_contracts.py       # Contract validation tests
│   │   ├── test_commerce_core.py   # Commerce core flow tests
│   │   ├── test_seller_agent.py    # Seller agent behavior tests
│   │   ├── test_buyer_agent.py     # Buyer agent behavior tests
│   │   ├── test_payments.py        # Payment + webhook tests
│   │   └── test_foundation.py      # API endpoint + health tests
│   ├── integration/                # (planned)
│   └── e2e/                        # (planned)
│
├── tools/
│   └── zrok/                       # zrok binary for tunnel shares
│
├── data/
│   ├── .gitkeep
│   └── sellable.db                 # SQLite dev database
│
├── plans/
│   └── code-inspection-plan.md     # Code inspection report
│
├── .env.example
├── .gitignore
├── ARCHITECTURE.md
├── CONTEXT.md
├── INCIDENTS.md
├── PLAN.md
├── README.md
├── docker-compose.yml              # Postgres for production use
└── pyproject.toml                  # Package config + pytest + setuptools
```

---

# 26. Technology Stack

| Layer | Recommended choice | Reason |
|---|---|---|
| Agent orchestration | LangGraph | Fits bounded stateful agent flows and deterministic checkpoints |
| API | FastAPI | Simple service boundaries and typed Python models |
| Model routing | Existing model factory / OpenRouter-compatible abstraction | Keeps agent implementation provider-agnostic |
| Database | Supabase/Postgres | Hosted persistence and simple inspection of ledger/order data |
| Cache/queues | Redis only when required | Avoid operational complexity until the core path works |
| ORM | SQLAlchemy | Clear transactional persistence and testability |
| Frontend | Next.js | Console + chat surface in one application |
| UI | Tailwind + shadcn-style components | Fast implementation of a polished demo UI |
| Payments | Razorpay test mode | Required payment rail for the track |
| Webhooks | Razorpay signed webhook flow | Provider-authoritative payment state |
| Evaluation | Pytest + scenario runner | Deterministic safety and transaction tests |
| Observability | Basic structured logs first; OpenTelemetry later | Avoid infrastructure work stealing time from the core demo |

---

# 27. What Is P0 vs P1 vs P2

This is the most important scope-control section.

## P0 — Must exist before the project is considered functional

```text
1. Product catalog
2. Seller Agent
3. Buyer Agent
4. Agent Gateway
5. Quote creation
6. Bounded negotiation
7. Deterministic Policy Engine
8. Consent boundary
9. Razorpay test-mode integration
10. Signed webhook handling
11. Idempotent payment operation
12. Order state machine
13. XAI Ledger
14. One graceful payment failure path
15. Minimal transaction replay UI
```

P0 should produce a complete transaction from discovery to payment/failure.

## P1 — Strong judging differentiators

```text
1. Contextual upsell
2. Human approval/HITL
3. Machine-readable discovery manifest
4. catalog.ai.json
5. Human conversational checkout
6. Merchant growth insights
7. Saved-deal tracking
```

## P2 — Only after the core is stable

```text
1. Advanced refund flows
2. Redis-based queues/rate limiting
3. OpenTelemetry tracing
4. Rich analytics
5. Advanced HMAC infrastructure
6. x402-inspired demonstration endpoint
7. More elaborate protocol adapters
8. Extra UI polish that does not improve the core demo
```

---

# 28. Explicit Non-Goals

The project should deliberately **not** attempt these during the main build:

- full AP2 cryptographic mandate implementation;
- production-grade W3C Verifiable Credentials;
- live NPCI UAP integration;
- certified ACP implementation;
- certified x402 implementation;
- multi-merchant marketplace federation;
- large-scale inventory management;
- real-money production payments;
- a complete marketing/campaign automation platform;
- voice commerce;
- autonomous unrestricted refunds;
- model-controlled payment execution.

Protocol references should be used to demonstrate architectural fluency, not to make unsupported compliance claims.

---

# 29. Security and Safety Invariants

These invariants should be explicitly encoded as tests.

## Money invariants

```text
No LLM call can directly execute payment.
No payment if policy = DENY.
No payment if consent is missing/expired/used.
No order above merchant hard limit.
No order above buyer authorization.
No price below SKU floor.
No unauthorized category.
No duplicate payment operation for one transaction attempt.
```

## Agent invariants

```text
Agent cannot invent a SKU.
Agent cannot create arbitrary prices.
Agent cannot alter policy configuration.
Agent cannot mark an order as PAID.
Agent cannot skip consent.
Agent cannot bypass HITL.
```

## Webhook invariants

```text
Signature must verify.
Unknown order/payment must not mutate state.
Invalid transition must be rejected.
Duplicate webhook must be idempotent.
```

## Audit invariants

```text
Every material money event has a ledger event.
Every policy decision has a reason code.
Every payment event has a provider reference when available.
Every transaction has a trace_id.
Failed actions are visible in replay.
```

---

# 30. Evaluation Harness

The evaluation harness should test the architecture rather than only the UI.

## Scenario categories

### Policy compliance

```text
within budget → allow
above budget → deny
below floor → deny/counter
restricted category → deny
above HITL threshold → escalate
```

### Hallucination guard

```text
unknown SKU requested
→ tool layer returns no such SKU
→ agent cannot invent it
```

### Consent enforcement

```text
expired consent → reject
used consent → reject
wrong amount → reject
wrong payee → reject
```

### Payment safety

```text
same idempotency key retry
→ no duplicate operation
```

### Explainability completeness

Every money-related scenario must produce:

```text
trace_id
ledger event(s)
policy_refs
reasoning_summary
provider reference when applicable
```

### Failure scenario

```text
payment failure
→ correct classification
→ correct retry/abort behavior
→ final deterministic state
→ complete ledger trace
```

---

# 31. Demo Strategy

The project should be designed around a short, repeatable story.

## Scene 1 — AI discovers the merchant

Show:

```text
Buyer Agent
  ↓
merchant manifest
  ↓
machine-readable catalog
```

The point is to prove the merchant is **sellable to AI buyers**, not merely searchable by a human.

## Scene 2 — AI negotiates and increases basket value

Show:

```text
buyer intent
→ product search
→ quote
→ negotiation
→ contextual upsell
```

The point is to prove the merchant gets a new AI-native revenue channel.

## Scene 3 — Safety gate

Intentionally exceed a limit.

Show:

```text
LLM proposal
→ Policy Engine
→ DENY / HITL
→ no payment
```

This proves that the agent does not control money directly.

## Scene 4 — Real Razorpay test payment

Show:

```text
consent
→ Razorpay
→ webhook
→ receipt
```

## Scene 5 — Failure recovery

Trigger a known test-mode failure.

Show:

```text
payment.failed
→ classify
→ bounded recovery OR abort
→ structured explanation
→ ledger replay
```

## Scene 6 — Replay the entire transaction

Open the Merchant Console and show the event timeline.

The strongest final UI moment is:

> **“Here is exactly why every money action happened.”**

---

# 32. Implementation Order

The order below is intentionally stricter than the full architecture.

## Phase 1 — Payment rail proof

Build first:

```text
Razorpay test mode
→ create order/payment link
→ webhook
→ verify payment state
```

The payment rail should be validated early because a late provider integration failure can invalidate the demo.

## Phase 2 — Commerce Core

Build:

```text
catalog
quotes
orders
policy engine
```

No agent dependency yet.

## Phase 3 — Consent and trust

Build:

```text
consent service
order state machine
ledger
```

At the end of Phase 3, a deterministic scripted transaction should work end-to-end.

## Phase 4 — Seller Agent

Connect:

```text
catalog tools
quote tools
negotiation
upsell
consent
checkout
```

## Phase 5 — Buyer Agent

Implement the reference mission flow:

```text
DISCOVER → RESEARCH → NEGOTIATE → CONSENT → PAY → VERIFY
```

## Phase 6 — Failure scenario

Implement the exact scripted failure path.

This must be completed before spending time on optional protocol surfaces or analytics.

## Phase 7 — Console

Implement only:

```text
live activity
approval queue
transaction replay
basic growth insights
```

## Phase 8 — Evaluation

Turn safety invariants into automated tests.

## Phase 9 — Optional protocol-adjacent polish

Only now add:

```text
agents.json polish
llms.txt
x402-style demonstration
richer traces
advanced analytics
```

---

# 33. Architecture Decisions

| Decision | Rationale |
|---|---|
| Primary direction is AI-buyer transactability | Creates a stronger end-to-end agentic commerce story than a standalone upsell bot |
| Revenue growth is embedded in the transaction | Upsell + negotiation naturally reinforce the primary transaction path |
| Seller Agent + Buyer Agent | A2A claim is much stronger when both sides are demonstrable |
| Policy engine is deterministic | Safety cannot depend on prompt compliance |
| Commerce Core owns state | Prevents the LLM from becoming the system of record |
| Consent is single-use and transaction-bound | Keeps authorization explicit and bounded |
| Razorpay behind an adapter | Provider details do not leak into agent logic |
| XAI Ledger is first-class | Directly satisfies the explainability/audit requirement |
| Replay UI exists in v1 | “Show the audit trail” requires a visible artifact |
| One scripted failure is mandatory | Directly satisfies the failure-handling requirement |
| Single merchant for v1 | Keeps the system focused and demoable |
| Test mode only | Matches the buildathon constraint and removes real-money risk |
| Protocol-inspired, not protocol-compliant | Avoids wasting the build window on large standards implementations |
| Redis/OpenTelemetry are optional | Infrastructure complexity must not outrank the transaction path |

---

# 34. Important Distinction: Agent vs Commerce System

The project should never be presented as though the Seller Agent itself is the entire product.

The architecture is:

```text
                    INTELLIGENCE
                         │
                         ▼
              ┌─────────────────────┐
              │     Seller Agent    │
              │  proposes actions   │
              └──────────┬──────────┘
                         │
                         ▼
                    CONTROL PLANE
                         │
              ┌─────────────────────┐
              │ Commerce Core       │
              │ Policy              │
              │ Consent             │
              │ Order state         │
              └──────────┬──────────┘
                         │
                         ▼
                     MONEY RAIL
                         │
              ┌─────────────────────┐
              │ Razorpay            │
              └──────────┬──────────┘
                         │
                         ▼
                     EVIDENCE
                         │
              ┌─────────────────────┐
              │ XAI Ledger          │
              │ Replay              │
              └─────────────────────┘
```

This separation is the central engineering argument of the project.

---

# 35. Final Architecture Position

The final implementation should be understood as a **hybrid of the best decisions from SELLABLE and Warrant**:

### From SELLABLE

- explicit requirement-to-capability mapping;
- Agent Gateway and AI discoverability;
- Buyer + Seller agents;
- deterministic Commerce Core;
- dedicated Consent Service;
- first-class XAI Ledger;
- replayable audit trail;
- conversational checkout;
- growth analytics;
- evaluation harness;
- clean separation between agent intelligence and authoritative business state.

### From Warrant

- prioritize end-to-end AI-buyer transactability;
- treat policy gating as the center of the judging story;
- use a small merchant/catalog for v1;
- make failure handling explicit and reproducible;
- avoid full protocol compliance claims;
- keep optional protocol work after the core transaction path;
- protect the build schedule through strong non-goals.

### The resulting product

```text
AI DISCOVERY
      ↓
PRODUCT RESEARCH
      ↓
NEGOTIATION
      ↓
CONTEXTUAL UPSELL
      ↓
DETERMINISTIC POLICY GATE
      ↓
HUMAN APPROVAL WHEN REQUIRED
      ↓
SINGLE-USE CONSENT
      ↓
RAZORPAY TEST PAYMENT
      ↓
WEBHOOK RECONCILIATION
      ↓
FAILURE RECOVERY / ABORT
      ↓
XAI LEDGER
      ↓
TRANSACTION REPLAY
      ↓
MERCHANT GROWTH INSIGHTS
```

This is the system the build should optimize for.

---

# 36. Final Success Criteria

The project is ready for judging when a fresh run can demonstrate all of the following without manual database edits:

1. A reference Buyer Agent discovers a merchant.
2. The merchant exposes an AI-readable catalog.
3. The Buyer Agent requests products and a quote.
4. Seller Agent negotiates within deterministic bounds.
5. Seller Agent proposes a contextual upsell within bounds.
6. Policy Engine evaluates the final cart independently of the LLM.
7. A denied cart never reaches Razorpay.
8. A high-value cart can pause for human approval.
9. A valid transaction receives explicit, bounded consent.
10. Razorpay test mode processes the payment.
11. A signed webhook reconciles payment state.
12. Every material step appears in the ledger.
13. The console can replay the full transaction.
14. A scripted payment failure is handled without crashing or silently retrying.
15. The merchant can see at least a small set of useful revenue/growth outcomes.

The strongest one-sentence description of the completed system is:

> **An AI-native merchant commerce system where agents can discover, negotiate, and purchase safely, while deterministic policies, explicit consent, Razorpay, and a replayable ledger ensure that every money action is bounded, gated, and explainable.**
