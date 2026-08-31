# Database

Persistence layer for SELLABLE's commerce core. SQLite in local development,
PostgreSQL/Supabase for the demo and production system of record
(`WORKFLOW.md` §55). The schema is dialect-portable (JSON, Boolean, and
DateTime columns map cleanly onto both SQLite and Postgres).

---

## Configuration

| Setting | Default | Source |
|---------|---------|--------|
| `DATABASE_URL` | `sqlite+pysqlite:///./data/sellable.db` | Environment variable |
| Engine | SQLAlchemy with `pool_pre_ping=True` | `sellable/ledger/database.py` |
| SQLite kwargs | `check_same_thread: False` | Auto-detected for SQLite URLs |

For Supabase/Postgres, set `DATABASE_URL` to a Postgres connection string and
install the extra driver:

```bash
pip install ".[postgres]"
```

```env
DATABASE_URL=postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_JWT_SECRET=<dashboard jwt secret>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

The `config.py` module resolves relative SQLite paths against the project root.
On startup, `initialise_database()` creates all tables if they don't exist and
runs a lightweight migration that adds columns introduced after the initial
schema (e.g. `orders.requires_approval`, `orders.approved_at`) without dropping
existing data.

```python
# config.py
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+pysqlite:///./data/sellable.db")
```

---

## Tables

### `ledger_events`

Append-only audit trail. Every agent action, policy decision, payment event, and consent operation creates a row here. Never updated or deleted.

```sql
CREATE TABLE ledger_events (
    sequence          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id          VARCHAR(64) UNIQUE NOT NULL,
    trace_id          VARCHAR(128) NOT NULL,
    timestamp         DATETIME NOT NULL,
    actor             VARCHAR(64) NOT NULL,
    action            VARCHAR(128) NOT NULL,
    inputs_json       JSON NOT NULL DEFAULT '{}',
    output_json       JSON NOT NULL DEFAULT '{}',
    reasoning_summary VARCHAR(1000),
    policy_refs_json  JSON NOT NULL DEFAULT '[]',
    outcome_effect_json JSON,
    provider_ref      VARCHAR(256),
    flags_json        JSON NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_ledger_trace ON ledger_events(trace_id);
```

**Key fields:**
- `sequence` — auto-incrementing row ID for ordering
- `trace_id` — groups events belonging to one transaction (e.g., `trc_abc123`)
- `actor` — who performed the action: `buyer_agent`, `seller_agent`, `policy_engine`, `commerce_core`, `consent_service`, `human`, `razorpay`
- `action` — event type: `catalog.search`, `quote.created`, `policy.checked`, `order.created`, `payment.captured`, `consent.issued`, `policy.updated`, etc.
- `inputs_json` / `output_json` — structured data for the event
- `reasoning_summary` — human-readable explanation (the "explainable" in XAI)
- `policy_refs_json` — which policy rules were consulted
- `flags_json` — special markers: `webhook_verified`, `bounded_retry`, `no_duplicate_charge`

**Repository:** `sellable/ledger/service.py` → `LedgerRepository`
- `append(event)` — write
- `for_trace(trace_id)` — read all events for one transaction
- `all_events(limit, offset)` — paginated read (newest first)
- `count_events()` — total count

---

### `orders`

Persisted order state. Created when a buyer accepts a quote and the policy engine allows the transaction. Updated on every status transition.

```sql
CREATE TABLE orders (
    order_id          VARCHAR(64) PRIMARY KEY,
    trace_id          VARCHAR(128) NOT NULL,
    quote_id          VARCHAR(128) NOT NULL,
    buyer_agent_id    VARCHAR(128) NOT NULL,
    merchant_id       VARCHAR(64) NOT NULL,
    amount_paise      INTEGER NOT NULL,
    status            VARCHAR(32) NOT NULL,
    idempotency_key   VARCHAR(256) NOT NULL,
    created_at        DATETIME NOT NULL
);
```

**Key fields:**
- `order_id` — primary key (e.g., `ord_a1b2c3d4`)
- `trace_id` — links to ledger events for this order
- `quote_id` — links to the `CartMandate` that became this order
- `status` — current state in the order state machine
- `idempotency_key` — prevents duplicate order creation

**Order status state machine:**
```
QUOTED → AWAITING_CONSENT → CONSENTED → PAYMENT_PENDING → PAID → FULFILLED
                                ↓              ↓
                             ABORTED      PAYMENT_FAILED → PAYMENT_PENDING (retry)
                                                      ↓
                                                   ABORTED
```

**Repository:** `sellable/repositories.py` → `OrderRepository`
- `save(order)` — upsert (insert or update)
- `get(order_id)` — read one
- `all()` — read all (used by console API)

**Persistence points:**
- `CommerceCore.create_order()` — saves new order
- `CommerceCore.issue_consent()` — no order status change (consent only)
- `CommerceCore.consume_consent()` — saves updated status (`CONSENTED`)
- `CommerceCore._transition_order()` — saves on every status change

---

### `consents`

Single-use, transaction-bound payment authorizations. Created when a human approves an order, consumed when payment is initiated.

```sql
CREATE TABLE consents (
    consent_id    VARCHAR(64) PRIMARY KEY,
    order_id      VARCHAR(64) NOT NULL,
    amount_paise  INTEGER NOT NULL,
    payee_id      VARCHAR(64) NOT NULL,
    purpose       VARCHAR(280) NOT NULL,
    expires_at    DATETIME NOT NULL,
    status        VARCHAR(32) NOT NULL,
    single_use    INTEGER NOT NULL DEFAULT 1
);
```

**Key fields:**
- `consent_id` — primary key (e.g., `con_e5f6g7h8`)
- `order_id` — bound to exactly one order
- `amount_paise` — exact amount authorized (must match order)
- `payee_id` — merchant ID (must match order's merchant)
- `status` — `ISSUED`, `USED`, or `EXPIRED`
- `single_use` — always `1` (SQLite stores booleans as integers)
- `expires_at` — consent expires after `lifetime_minutes` (default: 10)

**Repository:** `sellable/repositories.py` → `ConsentRepository`
- `save(consent)` — upsert
- `get(consent_id)` — read one
- `all()` — read all (loaded into `ConsentService._consents` on startup)

**Persistence points:**
- `CommerceCore.issue_consent()` — saves new consent
- `CommerceCore.consume_consent()` — saves updated status (`USED`)

---

### `policy`

Stores the merchant's policy configuration. Updated via `PUT /console/policy`. Loaded on startup to restore the last-saved state.

```sql
CREATE TABLE policy (
    merchant_id  VARCHAR(64) PRIMARY KEY,
    policy_json  JSON NOT NULL
);
```

**Key fields:**
- `merchant_id` — primary key (e.g., `mrc_demo_store`)
- `policy_json` — full `MerchantPolicy` model as JSON blob

**Policy JSON structure:**
```json
{
  "merchant_id": "mrc_demo_store",
  "currency": "INR",
  "max_order_value_paise": 500000,
  "max_single_item_value_paise": 300000,
  "max_discount_percent": 10,
  "allowed_categories": ["accessories", "gifting", "snacks"],
  "max_negotiation_rounds": 5,
  "max_upsells_per_session": 1,
  "human_approval_threshold_paise": 200000
}
```

**Persistence points:**
- `PUT /console/policy` → `_save_policy_to_db()` — saves after every update
- Startup → `_load_policy_from_db()` — loads into `CommerceCore.policy`

---

## Startup Hydration

On application startup, `CommerceCore` loads persisted state from the database:

```python
# core.py — CommerceCore.__init__
def _hydrate(self) -> None:
    try:
        orders = self.order_repo.all()
        self._orders = {o.order_id: o for o in orders}
        self._idempotency_keys = {o.idempotency_key: o.order_id for o in orders}
        consents = self.consent_repo.all()
        for c in consents:
            self.consent_service._consents[c.consent_id] = c
    except Exception:
        # Tables may not exist yet on first run
        self._orders = {}
        self._idempotency_keys = {}
```

```python
# main.py — startup sequence
initialise_database()           # 1. Create tables if needed
_db_policy = _load_policy_from_db()  # 2. Load saved policy
commerce_core = CommerceCore.from_seed(
    LedgerRepository(),
    policy_override=_db_policy,  # 3. Use saved policy or seed
)
```

**Graceful fallback:** If tables don't exist (first run), `_hydrate()` catches the exception and starts with empty state. The policy loader returns `None` and the seed policy is used.

---

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                    API Request                           │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              CommerceCore                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ _orders dict  │  │ policy attr  │  │ consent_svc   │ │
│  │ (in-memory)   │  │ (in-memory)  │  │ (in-memory)   │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘ │
│         │                 │                  │           │
│         ▼                 ▼                  ▼           │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Repository Layer                     │   │
│  │  OrderRepository  ConsentRepository  Policy DB   │   │
│  └──────────────────────┬───────────────────────────┘   │
└─────────────────────────┼───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              SQLite Database                             │
│  ┌──────────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐  │
│  │ledger_events │ │ orders │ │consents │ │  policy   │  │
│  │  (append)    │ │(upsert)│ │(upsert) │ │ (upsert)  │  │
│  └──────────────┘ └────────┘ └─────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Write path:** In-memory state is updated first, then persisted to SQLite. This ensures the API response is fast while data is durably stored.

**Read path:** Console API reads directly from in-memory state (fast). The `_hydrate()` call on startup ensures in-memory state matches the database.

---

## Console API Endpoints

| Endpoint | Method | Table(s) | Description |
|----------|--------|----------|-------------|
| `/console/transactions` | GET | `orders` | List all orders |
| `/console/transactions/{id}` | GET | `orders`, `ledger_events` | Order detail + events |
| `/console/events` | GET | `ledger_events` | Paginated event feed |
| `/console/approvals` | GET | `orders`, `ledger_events` | Pending HITL approvals |
| `/console/approvals/{id}/approve` | POST | `orders`, `consents`, `ledger_events` | Issue consent |
| `/console/approvals/{id}/reject` | POST | `orders`, `ledger_events` | Abort order |
| `/console/insights` | GET | `orders`, `ledger_events` | Revenue analytics |
| `/console/policy` | GET | `policy` | Read current policy |
| `/console/policy` | PUT | `policy`, `ledger_events` | Update policy |

---

## First Run

On first startup with a fresh database:

1. `initialise_database()` creates all 4 tables
2. `_load_policy_from_db()` returns `None` (no rows)
3. `CommerceCore.from_seed()` uses seed policy from `infra/seed/merchant_policy.json`
4. `_hydrate()` catches missing table exception, starts with empty `_orders`

The database file is created at `data/sellable.db` (relative to project root).

---

## Docker

In Docker, the database is at `/app/data/sellable.db`. The `Dockerfile` creates the `data/` directory before switching to the non-root `appuser`:

```dockerfile
RUN mkdir -p data && \
    useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
```

The `.dockerignore` should NOT exclude `data/` if you want to persist across container rebuilds. For production, mount a volume:

```yaml
volumes:
  - sellable-data:/app/data
```

---

## Testing

Unit tests use in-memory SQLite with a separate engine per test:

```python
@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)
```

Each test gets a fresh database. The `engine` parameter ensures `OrderRepository` and `ConsentRepository` use the same in-memory database as the ledger.

---

## Files

| File | Purpose |
|------|---------|
| `sellable/ledger/database.py` | SQLAlchemy models, `make_engine()`, `initialise_database()` |
| `sellable/ledger/service.py` | `LedgerRepository` — append-only event writes + queries |
| `sellable/repositories.py` | `OrderRepository`, `ConsentRepository` — CRUD for orders/consents |
| `sellable/core.py` | `CommerceCore` — hydration, persistence orchestration |
| `sellable/config.py` | `Settings` — `DATABASE_URL` resolution |
| `sellable/main.py` | `_load_policy_from_db()`, `_save_policy_to_db()` — policy persistence |
