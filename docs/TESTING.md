# Testing Strategy

SELLABLE uses three levels of automated tests plus an eval harness.

---

## Test Structure

```
tests/
├── unit/                  # Fast, isolated tests
│   ├── test_contracts.py
│   ├── test_commerce_core.py
│   ├── test_payments.py
│   ├── test_seller_agent.py
│   ├── test_buyer_agent.py
│   └── test_foundation.py
│
├── integration/           # API + commerce core stack tests
│   └── test_full_stack.py
│
└── e2e/                   # Full flow tests
    └── test_full_flow.py

evals/
├── scenarios/             # Deterministic scenario implementations
│   ├── valid_purchase.py
│   ├── below_floor.py
│   ├── over_budget.py
│   ├── hitl.py
│   ├── payment_failure.py
│   ├── duplicate_webhook.py
│   └── duplicate_consent.py
│
└── runner/
    └── scenario_runner.py # Eval harness
```

---

## Running Tests

```bash
# All tests
python -m pytest tests/ -v

# Unit tests only
python -m pytest tests/unit/ -v

# Integration tests only
python -m pytest tests/integration/ -v

# E2E tests only
python -m pytest tests/e2e/ -v

# Run eval scenarios
python -m evals.runner.scenario_runner
```

---

## Unit Tests

### test_contracts.py

Tests Pydantic model validation:
- Product rejects floor above list price
- Intent mandate requires future expiry
- Cart mandate calculates totals correctly

### test_commerce_core.py

Tests the deterministic commerce core:
- Valid cart creates order with full ledger trace
- Below-floor offer cannot create order
- Duplicate consent is rejected
- Idempotent order creation returns original order

### test_payments.py

Tests Razorpay integration (mocked):
- Verified webhook is authoritative and idempotent
- Invalid webhook signature cannot settle order
- Missing test credentials do not consume consent
- Payment failure is explicit
- Payment and webhook endpoints use service boundary

### test_seller_agent.py

Tests the LangGraph seller agent:
- Agent creates grounded quote with policy-valid upsell
- Agent counters below lowest policy-valid price
- Agent never invents unknown catalog items
- High-value cart is held for human approval

### test_buyer_agent.py

Tests the reference buyer agent:
- Buyer discovers merchant and returns ready candidate cart
- Buyer budget guard denies over-budget mission
- Gateway manifest advertises safe settlement authority

### test_foundation.py

Tests basic infrastructure:
- Ledger schema is initialized
- Health endpoint reports configuration
- Seller endpoint returns candidate cart without order creation

---

## Integration Tests

### test_full_stack.py

Tests the full API + commerce core stack:
- Full quote-to-ledger flow (no HTTP)
- Agent gateway discovery endpoint
- Catalog search endpoint (with auth)
- Quote create endpoint (with auth)

All agent-facing endpoints require `X-Agent-Key: sellable_demo_key_001` header (or an
HMAC-signed request with `Authorization: Bearer`, `X-Agent-Id`, `X-Timestamp`,
`X-Nonce`, and `X-Signature` headers). Console endpoints require a merchant
session (Supabase JWT in production, the demo `X-Agent-Key` in local demo mode).

### test_workflow_gateway.py

Tests the WORKFLOW.md §48/§55 additions:
- HMAC signed requests (replay and body-tampering are rejected)
- Agent order + consent flow (with idempotent `orders.create`)
- Dashboard aliases and merchant-session gating
- Bounded payment retry (fails twice → aborted, no duplicate settlement)
- HITL order hold + approval + single consent per order
- Policy re-validation and webhook amount-mismatch refusal

---

## E2E Tests

### test_full_flow.py

Tests complete buyer-to-payment flows:
- Happy path: buyer mission → discovery → quote → evaluation
- Over-budget: mission exceeds budget → denied
- No match: no catalog item matches → no match

---

## Eval Scenarios

The eval harness runs 7 deterministic scenarios against an in-memory commerce core:

| Scenario | Expected | Tests |
|----------|----------|-------|
| `valid_purchase` | ALLOW → PAID | Full payment flow with ledger trace |
| `below_floor` | DENY | BELOW_FLOOR_PRICE reason code |
| `over_budget` | DENY | OVER_BUDGET reason code |
| `hitl` | NEEDS_HUMAN_APPROVAL | ABOVE_APPROVAL_THRESHOLD |
| `payment_failure` | PAYMENT_FAILED | Failure with ledger trace |
| `duplicate_webhook` | Idempotent | Second webhook rejected |
| `duplicate_consent` | Rejected | Second use of consent fails |

### Running Eval Scenarios

```bash
python -m evals.runner.scenario_runner
```

Output:
```
============================================================
  SELLABLE Eval Report — 7/7 passed, 0 failed
============================================================

  [PASS] below_floor                      2294.5ms
           verdict: DENY
           reason_code: BELOW_FLOOR_PRICE
  [PASS] duplicate_consent                  28.8ms
           duplicate_rejected: True
  ...
```

---

## What Each Test Level Covers

| Level | Speed | Scope | Uses |
|-------|-------|-------|------|
| Unit | ~5s | Individual modules | In-memory SQLite |
| Integration | ~10s | API + commerce core | TestClient, mocked deps |
| E2E | ~15s | Full agent flow | In-memory commerce core |
| Eval | ~10s | Safety scenarios | In-memory, deterministic |

---

## Writing New Tests

### Unit Test Pattern

```python
def test_example() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    core = CommerceCore.from_seed(LedgerRepository(engine))

    # Test the module
    result = core.some_operation(...)

    # Assert
    assert result.status == expected_status
    events = core.ledger.for_trace(trace_id)
    assert "some.action" in [e.action for e in events]
```

### Integration Test Pattern

```python
def test_endpoint(commerce_core: CommerceCore) -> None:
    agent = SellerAgent(commerce_core)
    gateway = AgentGateway(commerce_core, agent)
    app.dependency_overrides[get_agent_gateway] = lambda: gateway
    try:
        with TestClient(app) as client:
            response = client.post(
                "/agent/catalog.search",
                json={"query": "coffee", "categories": []},
                headers={"X-Agent-Key": "sellable_demo_key_001"},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
```

---

## CI Checklist

Before pushing, run:

```bash
python -m pytest tests/ -v && python -m evals.runner.scenario_runner
```

All 29 tests + 7 eval scenarios must pass.
