# XAI Ledger

The XAI (Explainable AI) Ledger is an append-only event store that records every meaningful action in the system. It provides a complete, replayable audit trail for every transaction.

---

## Design Principles

1. **Append-only** — events are never modified or deleted
2. **Every money action leaves a trace** — no financial state change without a ledger entry
3. **Human-readable explanations** — every event includes a `reasoning_summary`
4. **Policy references** — every event records which policies were consulted
5. **Trace grouping** — events are grouped by `trace_id` for transaction replay

---

## Event Schema

```python
class LedgerEvent(StrictModel):
    event_id: str                # unique identifier
    trace_id: str                # groups events per transaction
    timestamp: datetime          # when it happened
    actor: LedgerActor           # who did it
    action: str                  # what happened
    inputs: dict                 # request data
    output: dict                 # result data
    reasoning_summary: str       # why it happened
    policy_refs: list[str]       # which rules applied
    outcome_effect: dict | None  # state change
    provider_ref: str | None     # external reference (Razorpay ID, etc.)
```

---

## Actors

| Actor | Description |
|-------|-------------|
| `SELLER_AGENT` | Seller agent tool calls (catalog search, quote creation, upsell) |
| `BUYER_AGENT` | Buyer agent actions (discovery, research, evaluation) |
| `COMMERCE_CORE` | Deterministic commerce operations (order creation, consent, payment) |
| `POLICY_ENGINE` | Policy evaluation results |
| `CONSENT_SERVICE` | Consent issuance and consumption |

---

## Event Types

### Catalog Events

| Action | Actor | Description |
|--------|-------|-------------|
| `catalog.search` | `SELLER_AGENT` | Searched catalog with query |
| `catalog.get` | `SELLER_AGENT` | Retrieved product by SKU |

### Quote Events

| Action | Actor | Description |
|--------|-------|-------------|
| `quote.created` | `SELLER_AGENT` | Created a new quote |
| `quote.received` | `COMMERCE_CORE` | Received candidate cart for evaluation |
| `negotiation.countered` | `SELLER_AGENT` | Countered at lowest policy-valid price |

### Policy Events

| Action | Actor | Description |
|--------|-------|-------------|
| `policy.checked` | `POLICY_ENGINE` | Evaluated cart against policy rules |

### Upsell Events

| Action | Actor | Description |
|--------|-------|-------------|
| `upsell.offered` | `SELLER_AGENT` | Proposed a complementary product |
| `upsell.skipped` | `SELLER_AGENT` | Upsell rejected by policy |

### Order Events

| Action | Actor | Description |
|--------|-------|-------------|
| `order.created` | `COMMERCE_CORE` | Order created after policy ALLOW |
| `order.paid` | `COMMERCE_CORE` | Payment confirmed by webhook |

### Consent Events

| Action | Actor | Description |
|--------|-------|-------------|
| `consent.issued` | `CONSENT_SERVICE` | Single-use consent created |
| `consent.used` | `CONSENT_SERVICE` | Consent consumed for payment |

### Payment Events

| Action | Actor | Description |
|--------|-------|-------------|
| `payment.pending` | `COMMERCE_CORE` | Payment initiated |
| `payment.failed` | `COMMERCE_CORE` | Payment failed |

### Refund Events

| Action | Actor | Description |
|--------|-------|-------------|
| `refund.initiated` | `COMMERCE_CORE` | Refund issued |

---

## Querying the Ledger

### Get all events for a trace

```python
events = ledger.for_trace(trace_id)
```

### Get actions for a trace

```python
actions = [e.action for e in ledger.for_trace(trace_id)]
```

### Check if a specific action occurred

```python
has_paid = "order.paid" in [e.action for e in events]
```

---

## Replay

The eval runner and demo script use the ledger to replay transactions:

```
1. catalog.search       — Buyer request triggered catalog search
2. quote.created        — Seller agent created a grounded quote
3. policy.checked       — Policy engine evaluated the cart
4. order.created        — Order created after ALLOW verdict
5. consent.issued       — Single-use consent issued
6. consent.used         — Consent consumed for payment
7. payment.pending      — Razorpay payment initiated
8. order.paid           — Webhook confirmed payment
```

Each event shows:
- **What happened** — the action and inputs/outputs
- **Why it happened** — the reasoning summary
- **Which policy allowed it** — policy references
- **What changed financially** — monetary values in inputs/outputs
- **External references** — Razorpay payment/order IDs

---

## Storage

Events are stored in SQLite (development) or any SQLAlchemy-compatible database.

Table: `ledger_events`

```sql
CREATE TABLE ledger_events (
    event_id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    timestamp DATETIME NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    inputs JSON,
    output JSON,
    reasoning_summary TEXT,
    policy_refs JSON,
    outcome_effect JSON,
    provider_ref TEXT
);
```

---

## Why This Matters

For the hackathon bar:

- **Explainability** — every money event has a human-readable explanation
- **Auditability** — complete trail from buyer request to payment
- **Replayability** — entire transaction can be reconstructed from events
- **Safety proof** — judges can verify that no financial action bypassed policy
