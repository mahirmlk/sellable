# API Reference

Base URLs:

- Production: `https://api.sellable.shop`
- Local development: `http://localhost:8000`

## Authentication

SELLABLE keeps two authentication surfaces separate (`WORKFLOW.md` §55):

- **Agent-facing endpoints** (`/agent/*`, `/orders/*`) require an agent API key
  (`X-Agent-Key` header) or an HMAC-SHA256 signed request with
  `Authorization: Bearer <key>`, `X-Agent-Id`, `X-Timestamp`, `X-Nonce`, and
  `X-Signature` headers. The signature binds `timestamp.nonce.agent_id.method.path.query.body-sha256`.
- **Console/merchant endpoints** require a merchant session
  (`get_merchant_session`): a Supabase access token (`Authorization: Bearer`)
  in production, or the demo `X-Agent-Key` in local demo mode.

Public discovery endpoints (`/.well-known/agents.json`, `/llms.txt`,
`/catalog.ai.json`, `/health`) require no authentication.

---

## Health

### `GET /health`

Returns service health status.

**Response:**
```json
{
  "status": "ok",
  "environment": "development",
  "database": "connected",
  "razorpay_configured": false
}
```

---

## Seller Agent

### `POST /agent/seller/respond`

Create a policy-evaluated candidate cart from a buyer request.

**Headers:** `X-Agent-Key: sellable_demo_key_001`

**Request:**
```json
{
  "message": "I need coffee for my desk",
  "intent": {
    "buyer_agent_id": "buyer_001",
    "budget_ceiling_paise": 200000,
    "allowed_categories": ["accessories", "gifting", "snacks"],
    "purpose": "Buy coffee",
    "expires_at": "2026-08-28T15:00:00Z"
  },
  "requested_sku": null,
  "quantity": 1,
  "buyer_offer_paise": null,
  "request_upsell": true
}
```

**Response (`SellerDecision`):**
```json
{
  "trace_id": "trc_abc123",
  "action": "QUOTE_READY",
  "response_message": "Here is a policy-valid candidate cart.",
  "cart": {
    "mandate_id": "...",
    "intent_ref": "...",
    "items": [{"sku": "COFFEE-BEANS-01", "quantity": 1, "unit_price_paise": 194800, "offered_price_paise": 194800}],
    "subtotal_paise": 194800,
    "discount_paise": 0,
    "total_paise": 194800,
    "negotiation_round": 0
  },
  "policy_decision": {
    "verdict": "ALLOW",
    "reason_code": null,
    "reasoning_summary": "Cart is within budget and all policy rules passed."
  },
  "selected_product": {"sku": "COFFEE-BEANS-01", "title": "...", "price_paise": 194800},
  "upsell_product": null,
  "tool_calls": ["catalog.search", "quotes.create", "policy.evaluate"]
}
```

**Actions:** `QUOTE_READY`, `COUNTERED`, `NEEDS_HUMAN_APPROVAL`, `DENIED`, `NO_MATCH`

---

## Agent Gateway

### `GET /.well-known/agents.json`

Machine-readable merchant manifest for AI buyer discovery.

**Response:**
```json
{
  "merchant_id": "mrc_demo_store",
  "name": "Sellable Demo Store",
  "capabilities": ["catalog.search", "catalog.get", "quotes.create", "quotes.negotiate"],
  "settlement_authority": "merchant_held",
  "consent_model": "single_use_per_transaction"
}
```

### `GET /llms.txt`

Plain-text instructions for AI buyers. Returns `text/plain`.

### `GET /catalog.ai.json`

Machine-readable catalog with SKUs, prices, floors, and stock.

### `POST /agent/catalog.search`

**Headers:** `X-Agent-Key: sellable_demo_key_001`

**Request:**
```json
{"query": "coffee", "categories": []}
```

**Response:** `list[Product]`

### `POST /agent/catalog.get`

**Headers:** `X-Agent-Key: sellable_demo_key_001`

**Request:**
```json
{"sku": "COFFEE-BEANS-01"}
```

**Response:** `Product`

### `POST /agent/quotes.create`

**Headers:** `X-Agent-Key: sellable_demo_key_001`

**Request:** Same as `/agent/seller/respond`

**Response:** `SellerDecision`

### `POST /agent/quotes.negotiate`

**Headers:** `X-Agent-Key: sellable_demo_key_001`

**Request:** Same as `/agent/seller/respond` (include `buyer_offer_paise` for negotiation)

**Response:** `SellerDecision`

### `POST /agent/consents.request`

Issue transaction-bound, single-use consent for an order.

**Request:**
```json
{"order_id": "ord_..."}
```

**Response:**
```json
{
  "consent_id": "con_...",
  "order_id": "ord_...",
  "amount_paise": 69900,
  "payee_id": "mrc_demo_store",
  "single_use": true,
  "status": "ISSUED"
}
```

Consent is refused while an order is held for human approval
(`409 Order requires merchant approval before consent can be issued`).

### `POST /agent/orders.create`

Create an authoritative order (idempotent). A duplicate call with the same
`idempotency_key` returns the original order with `"replayed": true`.

**Request:**
```json
{
  "intent": { "buyer_agent_id": "buyer_001", "budget_ceiling_paise": 600000, "allowed_categories": ["accessories", "gifting", "snacks"], "purpose": "Buy coffee", "expires_at": "2026-08-28T15:00:00Z" },
  "message": "I need coffee for my desk",
  "idempotency_key": "idem_...",
  "request_upsell": true
}
```

**Response:**
```json
{
  "order_id": "ord_...",
  "trace_id": "trc_...",
  "status": "AWAITING_CONSENT",
  "amount_paise": 84900,
  "quote_id": "cart_...",
  "idempotency_key": "idem_...",
  "requires_approval": false
}
```

### `POST /agent/orders.status`

**Request:** `{"order_id": "ord_..."}`

**Response:** `{"order_id", "status", "amount_paise", "payment_id", "trace_id"}`

### `POST /agent/refunds.create`

Issue a refund for a paid order. Requires a merchant session.

**Request:** `{"order_id": "ord_...", "reason": "merchant_initiated"}`

**Response:** Refund confirmation with `refund_status`, `amount_paise`, and `trace_id`.

---

## Buyer Agent

### `POST /agent/buyer/run`

Run the reference buyer agent through a full mission.

**Request:**
```json
{
  "buyer_agent_id": "buyer_ref_001",
  "message": "I need a desk setup under 6000 rupees",
  "budget_ceiling_paise": 600000,
  "allowed_categories": ["accessories", "gifting", "snacks"],
  "purpose": "Desk setup",
  "request_upsell": true
}
```

**Response (`BuyerResult`):**
```json
{
  "trace_id": "trc_...",
  "action": "READY_FOR_CONSENT",
  "buyer_summary": "A catalog-grounded, policy-valid cart is ready for explicit transaction consent.",
  "merchant_manifest": {...},
  "seller_decision": {...},
  "order_id": "ord_...",
  "consent_id": "con_...",
  "steps": ["DISCOVER", "RESEARCH", "REQUEST_QUOTE", "EVALUATE", "ORDER", "CONSENT"]
}
```

For a `READY_FOR_CONSENT` result the buyer agent also creates the order and
requests consent (`order_id`/`consent_id` are populated). For `DENIED`,
`NO_MATCH`, or `NEEDS_HUMAN_APPROVAL` results the buyer stops after evaluation.

**Actions:** `READY_FOR_CONSENT`, `NEEDS_HUMAN_APPROVAL`, `DENIED`, `NO_MATCH`

---

## Payments

### `POST /orders/{order_id}/payment`

Start a Razorpay test-mode payment after consuming consent.

**Request:**
```json
{
  "consent_id": "cns_..."
}
```

**Response:** `PaymentAttempt`

### `POST /orders/{order_id}/payment/retry`

Perform one bounded, idempotent retry after a verified payment failure.

**Response:** `PaymentAttempt`

### `POST /webhooks/razorpay`

Receives Razorpay payment webhook. Verified via `X-Razorpay-Signature` header.

**Headers:** `X-Razorpay-Signature: <signature>`

**Response:** `PaymentAttempt`

### `POST /orders/{order_id}/refund`

Issue a refund for a paid order. Requires a merchant session.

**Request:**
```json
{
  "reason": "merchant_initiated"
}
```

**Response:**
```json
{
  "order_id": "...",
  "refund_status": "initiated",
  "amount_paise": 69900,
  "reason": "merchant_initiated",
  "trace_id": "trc_..."
}
```

---

## Merchant Console

All console endpoints require a merchant session (Supabase JWT, or the demo
`X-Agent-Key` in local demo mode).

| Endpoint | Method | Description |
|---|---|---|
| `/console/transactions` · `/transactions` | GET | Transaction list |
| `/console/transactions/{id}` · `/transactions/{id}` | GET | Transaction detail with ledger events |
| `/transactions/{id}/events` | GET | Ledger events for a transaction |
| `/console/events` · `/activity` | GET | XAI Ledger events (`limit` clamped to 500) |
| `/activity/stream` | GET | SSE live ledger stream |
| `/console/approvals` · `/approvals` | GET | Orders held for human approval |
| `/console/approvals/{id}/approve` · `/approvals/{id}/approve` | POST | Approve + issue consent |
| `/console/approvals/{id}/reject` · `/approvals/{id}/reject` | POST | Reject (aborts the order) |
| `/console/insights` · `/growth` | GET | Growth metrics |
| `/console/policy` · `/console/policy` | GET/PUT | Read/update merchant policy (PUT re-validates) |
| `/catalog/products` | POST | Add a catalog product |
| `/agents/status` | GET | Agent + payment-rail health |

---

## Error Responses

All errors follow this format:

```json
{
  "detail": "Error message"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request or invalid state transition |
| 401 | Missing/invalid agent credentials, merchant session, or webhook signature |
| 403 | Valid format but unknown key or unauthorized merchant |
| 404 | Resource not found (e.g., unknown SKU or order) |
| 409 | Idempotency conflict or blocked state transition |
| 502 | Razorpay request failed |
| 503 | Razorpay not configured |
