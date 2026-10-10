# Connector Guide

SELLABLE owns the canonical commerce model; merchant systems plug in
through adapters. A connector pulls source records, normalizes them to
canonical `Product`s, and upserts them into the merchant catalog. The
sync engine never learns provider specifics.

## Custom REST/API (available now)

Any merchant HTTP API that lists products works today:

```http
POST /console/connectors
{
  "connector_id": "con_erp_01",
  "provider": "custom_rest",
  "base_url": "https://erp.example.com/api",
  "products_path": "/v1/items",
  "field_map": {
    "sku": "item_code",
    "title": "label",
    "price_paise": "price_minor",
    "stock": "on_hand",
    "category": "department"
  }
}
```

Field mapping: `sku|id|code`, `title|name`, `description|body`,
`price_paise|price`, `floor_paise|floor` (default: 80% of price),
`stock|inventory|quantity`, `category|type` (default: `general`).
Unmapped source fields land in `attributes` verbatim.

```http
GET    /console/connectors/{id}/health   # probe without syncing
POST   /console/connectors/{id}/sync     # pull → normalize → upsert
DELETE /console/connectors/{id}
```

Syncs are atomic per run (`inserted`/`updated` counts in the response),
failures ledger `connector.sync_failed` with the catalog untouched, and
the long-lived catalog service refreshes from the database truth. Config
rows store mapping only — secret headers are stripped on write; bearer
material lives in env/secret manager.

## Shopify / WooCommerce / ERP (mapping configs)

These providers are mapping presets over the same REST surface, not
separate code paths (per the adapter rule: translate, don't fork):

| Provider | `products_path` | Key mappings |
|---|---|---|
| Shopify Admin API | `/products.json` | `sku→variants[0].sku`, `title→title`, `price_paise→variants[0].price (×100)`, `stock→variants[0].inventory_quantity` |
| WooCommerce REST | `/products` | `sku→sku`, `title→name`, `price_paise→price (×100)`, `stock→stock_quantity` |
| Generic ERP | `/items` | use `field_map` above |

Volumenote: price fields arriving in major units need a preprocessing
proxy (×100) until minor-unit mapping lands — never let float money
reach the catalog.

## Shipping carriers

`ManualCarrier` (default) issues labels by hand; tracking flows through
`POST /webhooks/shipping/{carrier}`. `GenericHttpCarrier` speaks any
JSON carrier API (`POST /shipments`, `GET /tracking/{ref}`) with a bearer
secret passed at construction — wire per-merchant carrier config through
ops tooling; per-merchant secrets persist in Phase 8+ (connector
follow-up).

## Payment providers

`PAYMENT_PROVIDER=razorpay` (default, test mode) or `stripe` (test mode;
live keys refused). Both satisfy the same `PaymentProvider` protocol, so
orchestration, consent, idempotency, and reconciliation never change.
Stripe events arrive at `POST /webhooks/stripe` (HMAC `Stripe-Signature`,
timestamp tolerance, `local_order_id` metadata binding). The
`simulated` provider exists for the sandbox only.
