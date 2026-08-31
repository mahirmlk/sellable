# Troubleshooting

Common issues and how to fix them.

---

## Import Errors

### `ModuleNotFoundError: No module named 'langgraph'`

```bash
pip install langgraph
```

### `ModuleNotFoundError: No module named 'razorpay'`

```bash
pip install razorpay
```

### `ModuleNotFoundError: No module named 'sellable'`

Make sure you installed the package in editable mode:

```bash
python -m pip install -e ".[dev]"
```

Check that `pyproject.toml` has:
```toml
[tool.setuptools.packages.find]
where = ["services/commerce"]
include = ["sellable*"]
```

### `ImportError: cannot import name 'SellerTools' from 'agents.seller.tools'`

Make sure `agents/` is in the Python path. The `pyproject.toml` should have:
```toml
pythonpath = ["services/commerce"]
```

---

## Test Failures

### `401 Unauthorized` on agent endpoints

Agent endpoints require the `X-Agent-Key` header:

```python
headers={"X-Agent-Key": "sellable_demo_key_001"}
```

### `TypeError: RefundService.__init__() takes 2 positional arguments but 3 were given`

`RefundService` only takes `commerce` as an argument:

```python
# Wrong
refund_service = RefundService(commerce_core, RazorpayAdapter(settings))

# Correct
refund_service = RefundService(commerce_core)
```

### `InvalidOrderTransitionError: Cannot transition from X to Y`

The order state machine only allows specific transitions:

```
QUOTED → AWAITING_CONSENT → CONSENTED → PAYMENT_PENDING → PAID → FULFILLED
```

You must follow the correct sequence:
1. `create_order` (→ AWAITING_CONSENT)
2. `issue_consent`
3. `consume_consent` (→ CONSENTED)
4. `mark_payment_pending` (→ PAYMENT_PENDING)
5. `mark_paid` (→ PAID)

### `PydanticValidationError: String should have at least 16 characters`

`idempotency_key` must be at least 16 characters:

```python
# Wrong
idempotency_key="eval_001"

# Correct
idempotency_key="eval_valid_purchase_001"
```

---

## Razorpay Issues

### `RazorpayConfigurationError: Razorpay credentials are not configured`

Set these in your `.env` file:

```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

### `RazorpayRequestError: Payment creation failed`

1. Verify your test credentials are valid
2. Check that you're using test-mode keys (starting with `rzp_test_`)
3. Ensure the Razorpay account is active

### Webhook not received

1. Check that the tunnel is running (ngrok/zrok/localtunnel)
2. Verify the webhook URL in Razorpay dashboard matches your tunnel
3. Check the tunnel URL ends with `/webhooks/razorpay`
4. Look at tunnel logs for connection errors

### `InvalidWebhookSignatureError`

1. Verify `RAZORPAY_WEBHOOK_SECRET` matches the value in Razorpay dashboard
2. Check for extra whitespace in the `.env` file
3. Ensure the webhook secret is for the correct mode (test/live)

---

## Docker Issues

### `ERROR: failed to connect to the docker API`

Docker daemon is not running. Start Docker Desktop or Docker Engine.

### Build fails with `pip install` error

The Dockerfile installs dependencies before copying code. If `pyproject.toml` has issues, the build fails early. Check:

1. `pyproject.toml` is valid
2. All dependencies are available on PyPI
3. Python version matches `requires-python = ">=3.11"`

### Container starts but health check fails

```bash
docker logs <container_id>
```

Check if:
1. The database initialized correctly
2. Razorpay credentials are set
3. Port 8000 is exposed

---

## Database Issues

### `sqlite3.OperationalError: database is locked`

Another process is using the database. Either:
1. Stop the other process
2. Use a different database file
3. Use in-memory SQLite for testing: `sqlite+pysqlite:///:memory:`

### `sqlite3.OperationalError: no such table`

Run the database initialization:

```python
from sellable.ledger.database import initialise_database
initialise_database()
```

Or ensure the app starts with the lifespan handler (which calls `initialise_database()`).

---

## Agent Issues

### Seller agent returns `NO_MATCH`

The catalog search found no products matching the query. Check:
1. The query terms match product titles or descriptions
2. The catalog is seeded (`infra/seed/catalog.json` exists)
3. The product category is in the buyer's `allowed_categories`

### Seller agent returns `DENIED`

The policy engine blocked the transaction. Check the `reason_code`:
- `BELOW_FLOOR_PRICE` — offer is too low
- `OVER_BUDGET` — total exceeds buyer's ceiling
- `CATEGORY_BLOCKED` — product not in allowed categories
- `STOCK_UNAVAILABLE` — requested quantity exceeds stock
- `INVALID_SKU` — product doesn't exist

### Upsell not proposed

Check:
1. `request_upsell` is `true` in the seller request
2. The primary product has an `upsell_sku` in its attributes
3. The upsell product exists in the catalog
4. The enriched cart passes policy validation

---

## Performance Issues

### Tests are slow

Run specific test levels:

```bash
python -m pytest tests/unit/ -v      # ~3s
python -m pytest tests/integration/ -v  # ~5s
python -m pytest tests/e2e/ -v       # ~5s
```

### Eval scenarios are slow

Each scenario creates an in-memory database and seeds the catalog. This takes ~2-3 seconds per scenario. Total: ~15-20 seconds.

---

## Getting Help

1. Check the logs (uvicorn output)
2. Run `python -m pytest tests/ -v` to isolate which test fails
3. Check `docs/API.md` for endpoint details
4. Check `docs/DATA_MODEL.md` for contract details
5. Check `docs/POLICY_ENGINE.md` for policy rule details
