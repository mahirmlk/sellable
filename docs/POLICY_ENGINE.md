# Policy Engine

The policy engine is the most important deterministic component. It validates every financial action before it can proceed.

**Core rule:** LLMs choose among valid options. The policy engine defines the valid options.

---

## How It Works

```python
decision = policy_engine.evaluate_cart(cart, intent, policy, products)
```

Input:
- `cart` — the proposed CartMandate
- `intent` — the buyer's IntentMandate (budget, categories)
- `policy` — the MerchantPolicy configuration
- `products` — catalog data for SKU validation

Output: `PolicyDecision` with verdict, reason code, and explanation.

---

## Evaluation Order

The engine checks rules in this order (short-circuits on first failure):

1. **SKU validity** — does the product exist in the catalog?
2. **Category allowed** — is the product category in the buyer's allowed list?
3. **Stock available** — is there enough inventory?
4. **Floor price** — is the offered price >= the product's floor price?
5. **Discount cap** — is the discount within the merchant's max discount %?
6. **Budget ceiling** — is the total <= the buyer's budget?
7. **HITL threshold** — does the total exceed the human approval threshold?

---

## Configuration

Defined in `infra/seed/merchant_policy.json` and loaded as `MerchantPolicy`.

```python
class MerchantPolicy(StrictModel):
    merchant_id: str
    max_discount_percent: int        # e.g., 30
    human_approval_threshold_paise: int  # e.g., 200_000 (₹2,000)
    max_negotiation_rounds: int      # e.g., 3
    hitl_categories: list[str]       # categories requiring approval
```

---

## Rule Details

### 1. SKU Validity

```python
if sku not in products:
    return DENY, "INVALID_SKU"
```

Prevents the agent from inventing products.

### 2. Category Check

```python
if product.category not in intent.allowed_categories:
    return DENY, "CATEGORY_BLOCKED"
```

Buyer agent specifies which categories it's allowed to purchase.

### 3. Stock Check

```python
if item.quantity > product.stock:
    return DENY, "STOCK_UNAVAILABLE"
```

### 4. Floor Price

```python
if item.offered_price_paise < product.floor_paise:
    return DENY, "BELOW_FLOOR_PRICE"
```

Merchant sets a floor per product. The seller agent can negotiate above it but never below.

### 5. Discount Cap

```python
discount_pct = (1 - offered_price / list_price) * 100
if discount_pct > policy.max_discount_percent:
    return DENY, "EXCEEDS_DISCOUNT_CAP"
```

### 6. Budget Ceiling

```python
if cart.total_paise > intent.budget_ceiling_paise:
    return DENY, "OVER_BUDGET"
```

### 7. HITL Threshold

```python
if cart.total_paise > policy.human_approval_threshold_paise:
    return NEEDS_HUMAN_APPROVAL, "ABOVE_APPROVAL_THRESHOLD"
```

High-value transactions require merchant approval before consent.

---

## Verdicts

| Verdict | Effect |
|---------|--------|
| `ALLOW` | Transaction may proceed to consent and payment |
| `DENY` | Transaction is blocked; no order is created |
| `NEEDS_HUMAN_APPROVAL` | Transaction is held; merchant must approve |

---

## Example Scenarios

### Valid Purchase

```
Cart: COFFEE-BEANS-01 × 1, ₹1,948
Budget: ₹6,000
Floor: ₹1,500
Threshold: ₹2,000

→ SKU valid ✓
→ Category allowed ✓
→ Stock available ✓
→ Price >= floor ✓
→ Discount within cap ✓
→ Within budget ✓
→ Below HITL threshold ✓

Verdict: ALLOW
```

### Below Floor

```
Cart: COFFEE-BEANS-01 × 1, offered ₹1,200
Floor: ₹1,500

→ SKU valid ✓
→ Category allowed ✓
→ Stock available ✓
→ Price < floor ✗

Verdict: DENY, reason: BELOW_FLOOR_PRICE
```

### Over Budget

```
Cart: GIFT-BOX-01 × 1, ₹2,499
Budget: ₹2,000

→ SKU valid ✓
→ Category allowed ✓
→ Stock available ✓
→ Price >= floor ✓
→ Discount within cap ✓
→ Total > budget ✗

Verdict: DENY, reason: OVER_BUDGET
```

### HITL Required

```
Cart: GIFT-BOX-01 × 1, ₹2,499
Budget: ₹6,000
Threshold: ₹2,000

→ All checks pass ✓
→ Total > threshold ✓

Verdict: NEEDS_HUMAN_APPROVAL, reason: ABOVE_APPROVAL_THRESHOLD
```

---

## Extending the Engine

To add a new rule:

1. Add the check to `sellable/policy.py` in `PolicyEngine.evaluate_cart()`
2. Add a new reason code to `PolicyDecision.reason_code`
3. Update `merchant_policy.json` if the rule needs configuration
4. Write a test in `tests/unit/test_commerce_core.py`
5. Update this document
