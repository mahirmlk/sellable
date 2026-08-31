# Data Model

All contracts are Pydantic v2 models defined in `sellable/contracts.py`.

---

## Intent Mandate

Represents the human-authorized bounds available to a buyer agent.

```python
class IntentMandate(StrictModel):
    mandate_id: str              # auto-generated UUID
    buyer_agent_id: str          # identifies the buyer agent
    budget_ceiling_paise: int    # maximum spend in paise
    allowed_categories: list[str]  # product categories allowed
    purpose: str                 # human-readable purpose
    created_at: datetime         # auto-set
    expires_at: datetime         # must be in the future
```

**Rules:**
- `expires_at` must be in the future
- `budget_ceiling_paise` is the hard limit for the entire transaction
- `allowed_categories` restricts which catalog items can be purchased

---

## Product

A catalog item with pricing and stock.

```python
class Product(StrictModel):
    sku: str               # unique identifier (e.g., "COFFEE-BEANS-01")
    title: str             # display name
    description: str       # product description
    price_paise: int       # list price in paise
    floor_paise: int       # minimum acceptable price
    category: str          # product category
    stock: int             # available quantity
    attributes: dict       # flexible key-value (e.g., {"upsell_sku": "..."})
```

**Rules:**
- `floor_paise` must be <= `price_paise`
- `floor_paise` is enforced by the policy engine

---

## Cart Mandate

An offer negotiated between buyer and merchant.

```python
class CartMandate(StrictModel):
    mandate_id: str              # auto-generated UUID
    intent_ref: str              # links to IntentMandate
    items: list[CartItem]        # line items
    subtotal_paise: int          # sum of unit_price * quantity
    discount_paise: int          # total discount
    total_paise: int             # final amount
    upsell_offered: bool         # whether upsell was proposed
    upsell_rationale: str | None # why the upsell was suggested
    negotiation_round: int       # 0 = first offer, 1+ = counter
    created_at: datetime
```

---

## Cart Item

A single line item in a cart.

```python
class CartItem(StrictModel):
    sku: str
    quantity: int
    unit_price_paise: int
    offered_price_paise: int     # what the buyer pays per unit
```

---

## Order

Represents a confirmed transaction awaiting payment.

```python
class Order(StrictModel):
    order_id: str                # auto-generated UUID
    trace_id: str                # links to ledger events
    quote_id: str                # links to CartMandate
    buyer_agent_id: str
    merchant_id: str
    amount_paise: int
    status: OrderStatus
    idempotency_key: str         # prevents duplicate orders
    requires_approval: bool      # held for HITL until merchant approval
    approved_at: datetime | None # set by explicit merchant approval
    created_at: datetime
```

### Order Status State Machine

```
QUOTED → AWAITING_CONSENT → CONSENTED → PAYMENT_PENDING → PAID → FULFILLED
                                  ↓              ↓
                               ABORTED      PAYMENT_FAILED → PAYMENT_PENDING (retry)
                                                    ↓
                                                 ABORTED
```

Valid transitions:
| From | To |
|------|----|
| `QUOTED` | `AWAITING_CONSENT`, `ABORTED` |
| `AWAITING_CONSENT` | `CONSENTED`, `ABORTED` |
| `CONSENTED` | `PAYMENT_PENDING`, `ABORTED` |
| `PAYMENT_PENDING` | `PAID`, `PAYMENT_FAILED` |
| `PAYMENT_FAILED` | `PAYMENT_PENDING`, `ABORTED` |
| `PAID` | `FULFILLED`, `REFUNDED` |
| `FULFILLED` | `REFUNDED` |

---

## Consent

Single-use, transaction-bound authorization.

```python
class Consent(StrictModel):
    consent_id: str          # auto-generated UUID
    order_id: str            # bound to one order
    amount_paise: int        # exact amount authorized
    payee_id: str            # merchant ID
    purpose: str             # "single_transaction"
    expires_at: datetime     # time-limited
    status: ConsentStatus    # ISSUED, CONSUMED, EXPIRED
    approved_at: datetime | None
    single_use: bool         # always true
```

**Rules:**
- Can only be consumed once
- Must match order ID, amount, and payee
- Expires after `lifetime_minutes` (default: 10)

---

## Policy Decision

Result of the deterministic policy engine evaluation.

```python
class PolicyDecision(StrictModel):
    verdict: PolicyVerdict   # ALLOW, DENY, NEEDS_HUMAN_APPROVAL
    reason_code: str | None  # e.g., "BELOW_FLOOR_PRICE", "OVER_BUDGET"
    reasoning_summary: str   # human-readable explanation
    policy_refs: list[str]   # which rules were consulted
```

### Verdicts

| Verdict | Meaning |
|---------|---------|
| `ALLOW` | All policy rules passed |
| `DENY` | A rule blocked the transaction |
| `NEEDS_HUMAN_APPROVAL` | Transaction exceeds HITL threshold |

### Reason Codes

| Code | Trigger |
|------|---------|
| `BELOW_FLOOR_PRICE` | Offer < floor price |
| `OVER_BUDGET` | Total > buyer budget ceiling |
| `CATEGORY_BLOCKED` | Product not in allowed categories |
| `STOCK_UNAVAILABLE` | Requested quantity > stock |
| `ABOVE_APPROVAL_THRESHOLD` | Amount > HITL threshold |
| `INVALID_SKU` | Unknown product SKU |

---

## Ledger Event

Append-only audit record.

```python
class LedgerEvent(StrictModel):
    event_id: str                # auto-generated UUID
    trace_id: str                # groups events per transaction
    timestamp: datetime
    actor: LedgerActor           # who performed the action
    action: str                  # event type (e.g., "quote.created")
    inputs: dict                 # what was requested
    output: dict                 # what happened
    reasoning_summary: str       # why this happened
    policy_refs: list[str]       # which policies applied
    outcome_effect: dict | None  # state change
    provider_ref: str | None     # external reference (e.g., Razorpay ID)
```

### Actors

| Actor | Description |
|-------|-------------|
| `SELLER_AGENT` | Seller agent tool calls |
| `BUYER_AGENT` | Buyer agent actions |
| `COMMERCE_CORE` | Deterministic commerce operations |
| `POLICY_ENGINE` | Policy evaluation |
| `CONSENT_SERVICE` | Consent issuance and consumption |
