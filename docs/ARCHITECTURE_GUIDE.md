# Architecture Guide

Deep dive into SELLABLE's system design and component interactions.

---

## Core Principle

> **The LLM proposes, the policy engine disposes, and every action leaves an explanation.**

No LLM output directly mutates financial state. Every money-touching action must pass through deterministic validation.

---

## Component Map

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Buyer                             │
│                  (Perplexity, OpenAI, etc.)                  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Agent Gateway                           │
│                                                             │
│  /.well-known/agents.json    (discovery)                    │
│  /llms.txt                   (capabilities)                 │
│  /catalog.ai.json            (machine-readable catalog)     │
│                                                             │
│  /agent/catalog.search       (product search)               │
│  /agent/catalog.get          (product lookup)               │
│  /agent/quotes.create        (quote generation)             │
│  /agent/quotes.negotiate     (negotiation)                  │
│                                                             │
│  Auth: X-Agent-Key header                                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Seller Agent                            │
│                   (LangGraph state machine)                 │
│                                                             │
│  search_catalog → create_quote → consider_upsell → format   │
│                                                             │
│  Tools (deterministic):                                     │
│    catalog_search    → CatalogService.search()              │
│    catalog_get       → CatalogService.get()                 │
│    quote_create      → negotiation logic                    │
│    upsell_suggest    → attribute-based recommendation       │
│                                                             │
│  All tool calls → LedgerEvent                               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Commerce Core                             │
│                 (Deterministic layer)                        │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Catalog   │  │Policy Engine │  │ Order State  │       │
│  │   Service   │  │              │  │   Machine    │       │
│  └─────────────┘  └──────────────┘  └──────────────┘       │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Consent   │  │    Refund    │  │   Ledger     │       │
│  │   Service   │  │   Service    │  │  Repository  │       │
│  └─────────────┘  └──────────────┘  └──────────────┘       │
│                                                             │
│  Rules:                                                     │
│    - Every transition has actor, previous state, policy     │
│    - Every monetary value is integer paise                  │
│    - Idempotency keys prevent duplicates                    │
└───────────────────────────┬─────────────────────────────────┘
                            │
                      ALLOW / DENY
                       / HUMAN
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Razorpay                               │
│                    (Test Mode)                               │
│                                                             │
│  POST /orders/{id}/payment   → create test order            │
│  POST /webhooks/razorpay     → receive payment event        │
│  POST /orders/{id}/refund    → issue refund                 │
│                                                             │
│  Signature verification via X-Razorpay-Signature            │
└───────────────────────────┬─────────────────────────────────┘
                            │
                        webhook
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      XAI Ledger                             │
│                  (Append-only events)                        │
│                                                             │
│  Every money action → LedgerEvent with:                     │
│    - reasoning_summary (why)                                │
│    - policy_refs (which rules)                              │
│    - inputs/output (what changed)                           │
│    - provider_ref (external ID)                             │
│                                                             │
│  Queryable by trace_id for replay                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Request Flow

### 1. Buyer Discovers Merchant

```
AI Buyer
  → GET /.well-known/agents.json
  → Reads capabilities, settlement authority, consent model
```

### 2. Buyer Searches Catalog

```
AI Buyer
  → POST /agent/catalog.search {"query": "desk setup"}
  → Gateway returns matching Product[]
```

### 3. Buyer Requests Quote

```
AI Buyer
  → POST /agent/quotes.create {message, intent, ...}
  → Seller Agent runs LangGraph graph:
      1. catalog_search → find products
      2. quote_create → build CartMandate
      3. policy_engine.evaluate_cart → ALLOW/DENY/NEEDS_HUMAN
      4. upsell_suggest → optional add-on
      5. format_response → SellerDecision
  → Returns SellerDecision with cart, policy, tool_calls
```

### 4. Buyer Accepts → Create Order

```
Commerce Core
  → create_order(cart, intent, trace_id)
  → Policy engine re-validates
  → Order created in AWAITING_CONSENT state
  → Ledger: order.created
```

### 5. Consent

```
Commerce Core
  → issue_consent(order_id)
  → Consent issued (single-use, bound to order/amount/payee)
  → Ledger: consent.issued

  → consume_consent(consent_id, order_id)
  → Consent consumed, order → CONSENTED
  → Ledger: consent.used
```

### 6. Payment

```
Commerce Core
  → mark_payment_pending(order_id)
  → Order → PAYMENT_PENDING
  → Ledger: payment.pending

Razorpay
  → Create test order via API
  → Buyer completes payment

Webhook
  → POST /webhooks/razorpay
  → Signature verified
  → mark_paid(order_id, provider_ref)
  → Order → PAID
  → Ledger: order.paid
```

### 7. Replay

```
Open replay UI
  → Select trace_id
  → Show all LedgerEvents in order:
      catalog.search → quote.created → policy.checked
      → order.created → consent.issued → consent.used
      → payment.pending → order.paid
  → Each event: what, why, which policy, what changed
```

---

## State Machines

### Order State Machine

```
QUOTED
  ↓ (issue consent)
AWAITING_CONSENT
  ↓ (consume consent) or ↓ (abort)
CONSENTED                    ABORTED
  ↓ (start payment)
PAYMENT_PENDING
  ↓ (webhook confirmed) or ↓ (provider failure)
PAID                         PAYMENT_FAILED
  ↓ (fulfill) or ↓ (refund)    ↓ (retry) or ↓ (abort)
FULFILLED                  PAYMENT_PENDING / ABORTED
  ↓ (refund)
REFUNDED
```

### Consent State Machine

```
ISSUED → CONSUMED (single use)
ISSUED → EXPIRED (timeout)
```

---

## Data Flow Integrity

### What prevents double spending?

1. **Single-use consent** — consumed once, cannot be reused
2. **Idempotency keys** — duplicate order creation returns original
3. **Order state machine** — invalid transitions raise errors
4. **Webhook verification** — only signed Razorpay events are accepted
5. **Duplicate webhook** — `mark_paid` rejects if already PAID

### What prevents unauthorized discounts?

1. **Floor price** — per-product minimum in catalog
2. **Discount cap** — merchant policy max_discount_percent
3. **Policy engine** — validates every cart before order creation
4. **Seller agent tools** — `_safe_offer` enforces floor and cap

### What ensures explainability?

1. **Ledger events** — every action creates an event
2. **reasoning_summary** — human-readable explanation
3. **policy_refs** — which rules were consulted
4. **trace_id** — groups events per transaction
5. **Replay** — reconstruct any transaction from events

---

## Technology Stack

| Layer | Technology | Why |
|-------|------------|-----|
| API framework | FastAPI | Async, type-safe, auto-docs |
| Data contracts | Pydantic v2 | Validation, serialization |
| Agent orchestration | LangGraph | State machine graph |
| Database | SQLite (dev) / PostgreSQL/Supabase (prod) | SQLAlchemy compatible |
| Payments | Razorpay | Test-mode, webhooks |
| Auth | API key + HMAC-SHA256 (agents) / Supabase Auth (merchants) | Request signing + JWT session |
| Container | Docker | Reproducible builds |

---

## Extending the System

### Add a new product

1. Edit `infra/seed/catalog.json`
2. Add SKU, title, price, floor, category, stock
3. Optionally add `upsell_sku` in attributes
4. Restart the server

### Add a new policy rule

1. Add check to `sellable/policy.py` in `PolicyEngine.evaluate_cart()`
2. Add reason code to `PolicyDecision.reason_code`
3. Add config to `infra/seed/merchant_policy.json` if needed
4. Write test in `tests/unit/test_commerce_core.py`

### Add a new ledger event

1. Add `action` string to the relevant module
2. Include `reasoning_summary` and `policy_refs`
3. Write test asserting event appears in trace

### Add a new API endpoint

1. Define request/response in `sellable/contracts.py`
2. Add endpoint in `sellable/main.py`
3. Add `get_agent_api_key` dependency for agent-facing endpoints, or `get_merchant_session` for console endpoints
4. Write integration test
