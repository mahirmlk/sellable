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
schema (e.g. `orders.requires_approval`, `orders.provider_link_id`,
`consents.merchant_id`, the `(merchant_id, idempotency_key)` uniqueness
indexes) without dropping existing data — on both SQLite and Postgres.

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
    merchant_id       VARCHAR(64),  -- owning tenant; NULL only for legacy rows
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
CREATE INDEX ix_ledger_events_merchant_id ON ledger_events(merchant_id);
```

**Key fields:**
- `sequence` — auto-incrementing row ID for ordering
- `trace_id` — groups events belonging to one transaction (e.g., `trc_abc123`)
- `merchant_id` — owning tenant; every writer sets it (agent events included),
  and console reads always filter by it
- `actor` — who performed the action: `buyer_agent`, `seller_agent`, `policy_engine`, `commerce_core`, `consent_service`, `human`, `razorpay`
- `action` — event type: `catalog.search`, `quote.created`, `policy.checked`, `order.created`, `payment.attempted`, `webhook.reconciled`, `order.paid`, `refund.settled`, `consent.issued`, `policy.updated`, etc.
- `inputs_json` / `output_json` — structured data for the event
- `reasoning_summary` — human-readable explanation (the "explainable" in XAI)
- `policy_refs_json` — which policy rules were consulted
- `flags_json` — special markers; `simulated` marks dev-webhook-simulation
  money so replay never narrates it as verified provider money

**Repository:** `sellable/ledger/service.py` → `LedgerRepository`
- `append(event)` — write (insert-only; append-only is convention — no
  update/delete method exists, but there is no DB-level immutability trigger)
- `for_trace(trace_id, merchant_id=...)` — read all events for one transaction
- `all_events(limit, offset, merchant_id=...)` — paginated read (newest first)
- `events_after(sequence, limit, merchant_id=...)` — SSE cursor reads
- `count_events(merchant_id=...)` — total count
- `count_actions(trace_id, action)` — restart-proof budgets (retry counts)
- `last_provider_ref(trace_id)` — latest settlement payment id
- `claim_delivery(key)` — atomic webhook-delivery dedupe (see below)

---

### `orders`

Persisted order state. Created when a buyer accepts a quote and the policy engine allows the transaction. Updated on every status transition.

```sql
CREATE TABLE orders (
    order_id             VARCHAR(64) PRIMARY KEY,
    trace_id             VARCHAR(128) NOT NULL,
    quote_id             VARCHAR(128) NOT NULL,
    buyer_agent_id       VARCHAR(128) NOT NULL,
    merchant_id          VARCHAR(64) NOT NULL,
    amount_paise         INTEGER NOT NULL,
    status               VARCHAR(32) NOT NULL,
    idempotency_key      VARCHAR(256) NOT NULL,
    requires_approval    BOOLEAN NOT NULL DEFAULT FALSE,
    approved_at          DATETIME,
    provider_link_id     VARCHAR(256),
    provider_order_id    VARCHAR(256),
    provider_payment_url VARCHAR(512),
    created_at           DATETIME NOT NULL,
    UNIQUE (merchant_id, idempotency_key)  -- uq_orders_merchant_idempotency
);
```

**Key fields:**
- `order_id` — primary key (e.g., `ord_a1b2c3d4`)
- `trace_id` — links to ledger events for this order
- `quote_id` — links to the `CartMandate` that became this order
- `status` — current state in the order state machine
- `idempotency_key` — unique per merchant; the DB constraint backstops the
  in-memory guard against concurrent duplicate creates across workers
- `provider_link_id` / `provider_order_id` / `provider_payment_url` —
  persisted Razorpay references so webhook settlement and attempt rebuilds
  survive restarts

**Order status state machine:**
```
AWAITING_CONSENT → CONSENTED → PAYMENT_PENDING → PAID → FULFILLED
       ↓               ↓              ↓    ↓          ↓         ↓
    ABORTED         ABORTED        ABORTED  PAYMENT_FAILED  REFUNDED  REFUNDED
                                         (link cancelled first)  ↓
                                      PAYMENT_FAILED → PAYMENT_PENDING (one bounded retry)
                                                      ↓
                                                   ABORTED
```
(`QUOTED` was pruned — orders are created directly as `AWAITING_CONSENT`.)

**Repository:** `sellable/repositories.py` → `OrderRepository`
- `save(order)` — upsert (insert or update)
- `get(order_id)` — read one
- `all(merchant_id=...)` — tenant-scoped reads (used by console API)
- `for_idempotency_key(merchant_id, key)` — DB-backed replay detection
- `for_provider(link_id=..., provider_order_id=...)` — webhook resolution

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
    merchant_id   VARCHAR(64),  -- owning tenant (backfilled from payee_id)
    order_id      VARCHAR(64) NOT NULL,
    amount_paise  INTEGER NOT NULL,
    payee_id      VARCHAR(64) NOT NULL,
    purpose       VARCHAR(280) NOT NULL,
    expires_at    DATETIME NOT NULL,
    status        VARCHAR(32) NOT NULL,
    single_use    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX ix_consents_merchant_id ON consents(merchant_id);
```

**Key fields:**
- `consent_id` — primary key (e.g., `con_e5f6g7h8`)
- `merchant_id` — owning tenant; hydration loads only the caller's merchant
- `order_id` — bound to exactly one order
- `amount_paise` — exact amount authorized (must match order)
- `payee_id` — merchant ID (must match order's merchant)
- `status` — `ISSUED`, `USED`, `EXPIRED`, or `REVOKED`
- `single_use` — always `1` (SQLite stores booleans as integers)
- `expires_at` — consent expires after `lifetime_minutes` (default: 10);
  expired consents never block re-issue and their flip is persisted

**Repository:** `sellable/repositories.py` → `ConsentRepository`
- `save(consent)` — upsert
- `get(consent_id)` — read one
- `all(merchant_id=...)` — tenant-scoped (loaded into the core's
  `ConsentService` on hydration)

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
- `PUT /console/policy` → `save_policy_for()` — saves after every update
  (owner role only)
- Startup → `MerchantRegistry` `load_policy_for()` — loads into each
  merchant's cached `CommerceCore`

---

## Other tables

### `refunds`

One row per provider refund attempt; `(merchant_id, idempotency_key)` is
unique so retried refund requests return the existing record instead of
moving money twice.

```sql
CREATE TABLE refunds (
    refund_id            VARCHAR(64) PRIMARY KEY,
    merchant_id          VARCHAR(64) NOT NULL,
    order_id             VARCHAR(64) NOT NULL,
    amount_paise         INTEGER NOT NULL,
    provider_payment_id  VARCHAR(128),
    provider_refund_id   VARCHAR(128) UNIQUE,
    reason               VARCHAR(500) NOT NULL,
    status               VARCHAR(32) NOT NULL,  -- PENDING | PROCESSED | FAILED
    idempotency_key      VARCHAR(256) NOT NULL,
    created_at           DATETIME NOT NULL,
    UNIQUE (merchant_id, idempotency_key)
);
```

**Repository:** `sellable/repositories.py` → `RefundRepository`
(`save`, `for_idempotency_key`, `for_order` — all merchant-scoped).

### `webhook_deliveries`

Restart-proof webhook dedupe. The delivery key
`{event}:{provider_payment_id|link_id}:{amount}` is the primary key, so
claiming it is atomic across processes and replicas; duplicates return the
current attempt with no new ledger rows.

```sql
CREATE TABLE webhook_deliveries (
    delivery_key VARCHAR(128) PRIMARY KEY,
    received_at  DATETIME NOT NULL
);
```

**Claim:** `LedgerRepository.claim_delivery(key)` → `True` exactly once.

### `agent_nonces`

Persistent HMAC nonce store for agent-request replay protection (the
in-memory guard alone is wiped by restarts and is per-replica).

```sql
CREATE TABLE agent_nonces (
    agent_id VARCHAR(128),
    nonce    VARCHAR(128),
    seen_at  INTEGER NOT NULL,  -- epoch seconds; rows older than the
    PRIMARY KEY (agent_id, nonce)  -- timestamp window are pruned on claim
);
```

**Claim:** `sellable/repositories.py` → `NonceRepository.claim()`.

### `merchants` / `merchant_users` / `catalog_products`

- `merchants(merchant_id PK, name, created_at)` — one row per store.
- `merchant_users(id PK, merchant_id, auth_user_id UNIQUE, role, created_at)` —
  explicit auth-user → merchant links (`role`: `owner` | `operator`); no
  auto-linking, ever.
- `catalog_products(id PK `{merchant_id}:{sku}`, merchant_id, sku, title,
  description, price_paise, floor_paise, stock, category, attributes)` —
  per-merchant persisted catalog.

All application tables have RLS enabled with no `anon`/`authenticated`
grants on hosted Postgres — only the backend (service role / direct
connection) touches them.

---

## Startup Hydration

On application startup, each merchant's `CommerceCore` loads its own slice
of persisted state from the database:

```python
# core.py — CommerceCore.__init__ / _hydrate
orders = self.order_repo.all(merchant_id=self.merchant_scope)
self._orders = {o.order_id: o for o in orders}
self._idempotency_keys = {o.idempotency_key: o.order_id for o in orders}
consents = self.consent_repo.all(merchant_id=self.merchant_scope)
for c in consents:
    self.consent_service._consents[c.consent_id] = c
```

```python
# main.py — startup sequence
initialise_database()            # 1. Create tables + run migrations
registry = MerchantRegistry()    # 2. Per-merchant core cache
registry.ensure_demo_merchant()  # 3. Seed demo store, catalog, policy
commerce_core = registry.get(DEMO_MERCHANT_ID)
```

**Graceful fallback:** If tables don't exist (first run), `_hydrate()` catches the exception and starts with empty state.

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
│  │  Order/Consent/Refund/Nonce/CatalogRepository    │   │
│  └──────────────────────┬───────────────────────────┘   │
└─────────────────────────┼───────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              SQLite / Postgres Database                  │
│  ┌──────────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐  │
│  │ledger_events │ │ orders │ │consents │ │  policy   │  │
│  │  (append)    │ │(upsert)│ │(upsert) │ │ (upsert)  │  │
│  └──────────────┘ └────────┘ └─────────┘ └──────────┘  │
│  ┌────────┐ ┌──────────────────┐ ┌──────────────┐     │
│  │refunds │ │webhook_deliveries│ │ agent_nonces │     │
│  └────────┘ └──────────────────┘ └──────────────┘     │
│  ┌───────────┐ ┌────────────────┐ ┌─────────────────┐ │
│  │ merchants │ │ merchant_users │ │catalog_products │ │
│  └───────────┘ └────────────────┘ └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Write path:** In-memory state is updated first, then persisted. This ensures the API response is fast while data is durably stored.

**Read path:** Order reads are DB-first (`get_order` re-reads the row, so webhook settlement by another process is always visible); `_hydrate()` on startup restores each core's merchant slice.

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

1. `initialise_database()` creates all tables
2. `MerchantRegistry.ensure_demo_merchant()` seeds the demo store, catalog, and policy
3. Each `CommerceCore._hydrate()` loads its merchant slice (empty on first run)

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
| `sellable/ledger/database.py` | SQLAlchemy models, `make_engine()`, `initialise_database()`, migrations |
| `sellable/ledger/service.py` | `LedgerRepository` — event writes + queries + delivery claims |
| `sellable/repositories.py` | `OrderRepository`, `ConsentRepository`, `RefundRepository`, `NonceRepository`, `CatalogRepository`, `MerchantRepository` |
| `sellable/core.py` | `CommerceCore` — hydration, persistence orchestration |
| `sellable/config.py` | `Settings` — `DATABASE_URL` resolution |
| `sellable/registry.py` | `MerchantRegistry` — per-merchant cores, policy load/save |
