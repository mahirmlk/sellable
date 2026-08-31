# Backend Schema

Database tables, API schemas, and seed data.

---

## Database Tables

### ledger_events

Append-only audit trail for all system events.

```sql
CREATE TABLE ledger_events (
    event_id        TEXT PRIMARY KEY,
    trace_id        TEXT NOT NULL,
    timestamp       DATETIME NOT NULL,
    actor           TEXT NOT NULL,
    action          TEXT NOT NULL,
    inputs          JSON,
    output          JSON,
    reasoning_summary TEXT,
    policy_refs     JSON,
    outcome_effect  JSON,
    provider_ref    TEXT
);

CREATE INDEX idx_ledger_trace ON ledger_events(trace_id);
CREATE INDEX idx_ledger_action ON ledger_events(action);
CREATE INDEX idx_ledger_actor ON ledger_events(actor);
```

**Actor values:** `SELLER_AGENT`, `BUYER_AGENT`, `COMMERCE_CORE`, `POLICY_ENGINE`, `CONSENT_SERVICE`

**Action values:**
```
catalog.search          catalog.get
quote.created           quote.received
negotiation.countered
policy.checked
upsell.offered          upsell.skipped
order.created           order.paid
consent.issued          consent.used
payment.pending         payment.failed
refund.initiated
seller.response_ready
buyer.discovered_merchant
buyer.catalog_researched
buyer.mission_evaluated
```

---

## Seed Catalog

Located at `infra/seed/catalog.json`. 10 products across 3 categories.

| SKU | Title | Price | Floor | Category | Upsell |
|-----|-------|-------|-------|----------|--------|
| `COFFEE-BEANS-01` | Premium Coffee Beans | ₹1,948 | ₹1,500 | snacks | `COFFEE-MUG-01` |
| `COFFEE-MUG-01` | Ceramic Coffee Mug | ₹749 | ₹500 | snacks | — |
| `DESK-01` | Ergonomic Standing Desk | ₹12,999 | ₹10,000 | accessories | `DESK-MAT-01` |
| `DESK-MAT-01` | Premium Desk Mat | ₹1,499 | ₹1,000 | accessories | — |
| `HEADPHONES-01` | Noise-Cancelling Headphones | ₹8,999 | ₹7,000 | accessories | `HEADPHONE-CASE-01` |
| `HEADPHONE-CASE-01` | Headphone Carry Case | ₹999 | ₹700 | accessories | — |
| `NOTEBOOK-01` | Leather-Bound Notebook | ₹599 | ₹400 | gifting | `PEN-01` |
| `PEN-01` | Premium Fountain Pen | ₹1,299 | ₹900 | gifting | — |
| `GIFT-BOX-01` | Deluxe Gift Box | ₹2,499 | ₹2,000 | gifting | — |
| `KEYBOARD-01` | Mechanical Keyboard | ₹4,999 | ₹3,800 | accessories | `KEYCAPS-01` |

---

## Merchant Policy

Located at `infra/seed/merchant_policy.json`.

```json
{
  "merchant_id": "mrc_demo_store",
  "max_discount_percent": 30,
  "human_approval_threshold_paise": 200000,
  "max_negotiation_rounds": 3,
  "hitl_categories": ["gifting"]
}
```

| Field | Value | Description |
|-------|-------|-------------|
| `merchant_id` | `mrc_demo_store` | Merchant identifier |
| `max_discount_percent` | `30` | Maximum discount allowed (%) |
| `human_approval_threshold_paise` | `200000` | Orders above ₹2,000 need approval |
| `max_negotiation_rounds` | `3` | Maximum counter-offers |
| `hitl_categories` | `["gifting"]` | Categories always requiring approval |

---

## API Request/Response Schemas

### SellerRequest

```json
{
  "message": "string (1-1000 chars, required)",
  "intent": "IntentMandate (required)",
  "requested_sku": "string or null (max 64 chars)",
  "quantity": "integer (1-100, default 1)",
  "buyer_offer_paise": "integer or null (> 0)",
  "request_upsell": "boolean (default true)"
}
```

### SellerDecision

```json
{
  "trace_id": "string",
  "action": "QUOTE_READY | COUNTERED | NEEDS_HUMAN_APPROVAL | DENIED | NO_MATCH",
  "response_message": "string (1-1000 chars)",
  "cart": "CartMandate or null",
  "policy_decision": "PolicyDecision or null",
  "selected_product": "Product or null",
  "upsell_product": "Product or null",
  "tool_calls": ["string"]
}
```

### IntentMandate

```json
{
  "mandate_id": "string (auto-generated)",
  "buyer_agent_id": "string (required)",
  "budget_ceiling_paise": "integer (required)",
  "allowed_categories": ["string"],
  "purpose": "string (required)",
  "created_at": "datetime (auto-set)",
  "expires_at": "datetime (required, must be future)"
}
```

### CartMandate

```json
{
  "mandate_id": "string (auto-generated)",
  "intent_ref": "string (links to IntentMandate)",
  "items": ["CartItem"],
  "subtotal_paise": "integer",
  "discount_paise": "integer",
  "total_paise": "integer",
  "upsell_offered": "boolean",
  "upsell_rationale": "string or null",
  "negotiation_round": "integer",
  "created_at": "datetime"
}
```

### CartItem

```json
{
  "sku": "string",
  "quantity": "integer",
  "unit_price_paise": "integer",
  "offered_price_paise": "integer"
}
```

### Product

```json
{
  "sku": "string",
  "title": "string",
  "description": "string",
  "price_paise": "integer",
  "floor_paise": "integer",
  "category": "string",
  "stock": "integer",
  "attributes": {}
}
```

### PolicyDecision

```json
{
  "verdict": "ALLOW | DENY | NEEDS_HUMAN_APPROVAL",
  "reason_code": "string or null",
  "reasoning_summary": "string",
  "policy_refs": ["string"]
}
```

### Order

```json
{
  "order_id": "string (auto-generated)",
  "trace_id": "string",
  "quote_id": "string",
  "buyer_agent_id": "string",
  "merchant_id": "string",
  "amount_paise": "integer",
  "status": "QUOTED | AWAITING_CONSENT | CONSENTED | PAYMENT_PENDING | PAID | PAYMENT_FAILED | FULFILLED | REFUNDED | ABORTED",
  "idempotency_key": "string (min 16 chars)",
  "requires_approval": "boolean (held for HITL until merchant approval)",
  "approved_at": "datetime | null",
  "created_at": "datetime"
}
```

### Consent

```json
{
  "consent_id": "string (auto-generated)",
  "order_id": "string",
  "amount_paise": "integer",
  "payee_id": "string",
  "purpose": "string",
  "expires_at": "datetime",
  "status": "ISSUED | CONSUMED | EXPIRED",
  "approved_at": "datetime or null",
  "single_use": true
}
```

### LedgerEvent

```json
{
  "event_id": "string (auto-generated)",
  "trace_id": "string",
  "timestamp": "datetime",
  "actor": "SELLER_AGENT | BUYER_AGENT | COMMERCE_CORE | POLICY_ENGINE | CONSENT_SERVICE",
  "action": "string",
  "inputs": {},
  "output": {},
  "reasoning_summary": "string",
  "policy_refs": ["string"],
  "outcome_effect": {} | null,
  "provider_ref": "string or null"
}
```

### BuyerMission

```json
{
  "buyer_agent_id": "string (required)",
  "message": "string (required)",
  "budget_ceiling_paise": "integer (required)",
  "allowed_categories": ["string"],
  "purpose": "string (required)",
  "request_upsell": "boolean (default true)"
}
```

### BuyerResult

```json
{
  "trace_id": "string",
  "action": "READY_FOR_CONSENT | NEEDS_HUMAN_APPROVAL | DENIED | NO_MATCH",
  "buyer_summary": "string",
  "merchant_manifest": {},
  "seller_decision": "SellerDecision or null",
  "steps": ["DISCOVER", "RESEARCH", "REQUEST_QUOTE", "EVALUATE"]
}
```

---

## Agent Authentication

### Demo Keys

| Key ID | Merchant |
|--------|----------|
| `sellable_demo_key_001` | `mrc_demo_store` |

### Header

```
X-Agent-Key: sellable_demo_key_001
```

### HMAC Signature (Planned)

```
X-Agent-Signature: <hex-digest>
X-Agent-Timestamp: <unix-seconds>
X-Agent-Nonce: <random-string>
```

Message format: `{timestamp}.{nonce}.{body}`
