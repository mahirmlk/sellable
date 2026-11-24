# External Agent Integration Guide

SELLABLE treats customer-side agents as **first-class external principals**:
they discover merchants, negotiate capabilities, link customer identity,
delegate bounded permissions, and transact through one canonical commerce
core — over REST, MCP, A2A, or UCP.

## 1. Discover a merchant

```http
GET /.well-known/ucp?merchant=<merchant_id> # full merchant declaration (identity, capabilities,
                              # protocols, auth, identity linking, payments, shipping)
GET /.well-known/agents.json?merchant=<merchant_id> # lightweight manifest + delegation notice
GET /agent/profile?merchant=<merchant_id> # platform agents and versions
GET /agent/capabilities?merchant=<merchant_id> # negotiable capability profile
GET /llms.txt?merchant=<merchant_id> # human/agent-readable instructions
GET /catalog.ai.json?merchant=<merchant_id> # machine-readable catalog
GET /a2a/card                # A2A actor card (seller + service)
GET /mcp/tools               # MCP-compatible tool list (agent key required)
GET /acp/status              # ACP scaffold status (disabled by default; no placement claims)
```

The UCP declaration pins `ucp_version: "ucp-1"` (SELLABLE's adapter
version) plus `ucp_spec_reference` and advertises only live capabilities —
no certification is claimed.

## 2. Authenticate

Read requests accept a merchant-issued key in `X-Agent-Key`; its hash resolves
the owning merchant and buyer identity. The demo key works only against local
development data.

Mutating agent requests outside development/test must use a signed bearer
request. Send the merchant-issued key as `Authorization: Bearer <key>`; do not
send `X-Agent-Key` on a signed request, because that selects the legacy static
key path. Build the HMAC canonical string from the exact request values:

```text
timestamp.nonce.agent_id.method.path.query.sha256(body)
```

`query` is the raw URL query without `?`; hash the exact body bytes with
SHA-256, or use an empty string for an empty body. Join the seven fields with
literal periods, HMAC-SHA256 the UTF-8 canonical bytes with the staging
`BUYER_AGENT_HMAC_SECRET`, and send the lowercase hex digest in
`X-Signature`, along with `X-Agent-Id`, `X-Timestamp`, and a unique
`X-Nonce`. The timestamp window is five minutes, and a nonce can be used only
once. See `sellable.auth.sign_request` for the test/client reference helper.

Production and staging require this signed form for mutating agent routes;
read-only requests may use the API key alone. Deployed payments accept
Razorpay Test Mode only.

## 3. Negotiate capabilities

```http
POST /commerce/sessions/negotiate   # AgentProfile {agent_id, protocol,
                                    # capabilities[]} → session with the
                                    # intersected (server-selected) set
POST /ucp/negotiate                 # same handshake, protocol "ucp"
```

Pass `X-Session-Id` on later calls. Calls outside the negotiated set get
`403 CAPABILITY_NOT_NEGOTIATED`. Nothing is assumed from the registry.

## 4. Link customer identity (when needed)

Public browsing needs no identity. Anything customer-scoped does:

```http
POST /commerce/identity/link            # {customer_id, agent_id?} → link + one-time code
POST /commerce/identity/link/approve    # {link_id, link_code} or merchant approval
GET  /commerce/identity/me?link_id=…    # resolved linked context
```

## 5. Delegate bounded permissions

The customer grants a `DelegationGrant` (scopes, amount/frequency limits,
expiry, approval mode). Send it as `X-Delegation-Id`:

- valid delegation → `ALLOW`, call proceeds;
- revoked/expired/scope mismatch → `403`, nothing executes;
- `REQUIRE_CUSTOMER` / `REQUIRE_HUMAN` → `409` hold, resolve approval first.

High-risk scopes (`payment:authorize`, `refund:request`) always need
transaction-bound authorization — a standing delegation alone never
suffices. See `SELLABLE_ARCHITECTURE.md` §14.

## 6. Transact (canonical flow)

```http
POST /commerce/cart                    # open a versioned cart
POST /commerce/cart/items              # {op: add|set|remove, sku, quantity, expected_version}
POST /commerce/quotes                  # snapshot a bounded offer
POST /commerce/quotes/negotiate        # propose within floor/round bounds
POST /commerce/promotions/evaluate     # deterministic eligibility + stacking
POST /commerce/checkout                # lock cart → checkout session
POST /commerce/checkout/authorize      # validate → price → risk → authorize
POST /commerce/orders                  # {checkout_id, intent, idempotency_key}
GET  /commerce/orders/{id}             # authoritative state + payment ref
POST /commerce/returns                 # settled orders only
POST /commerce/refunds/requests        # merchant-gated ask (never executes)
POST /commerce/support/cases           # case-managed support
```

Every canonical path is mirrored under `/v1/*` (e.g.
`POST /v1/commerce/cart`) — same implementation, versioned address.

Money moves only after a signed provider webhook; the webhook uses Razorpay's
provider signature, not agent HMAC:

```http
POST /agent/consents.request   # {order_id} → single-use, amount+payee-bound consent
POST /orders/{id}/payment      # {consent_id} → provider attempt (PAYMENT_PENDING)
# provider webhook, Razorpay-signature-verified → reconciled → PAID
# (staging accepts Razorpay Test Mode only; delivery claims and strict
# transitions make duplicates collapse to one settlement)
```

Or drive one tool at a time:

```http
POST /mcp/call   # {tool: catalog_search|…|checkout_authorize|…, arguments: {...}}
```

Or talk to an agent actor:

```http
POST /a2a/tasks  # {actor: seller|service, input: {...}}
```

## 7. Track everything

Every call accepts `X-Trace-Id` (server mints `trc_*` otherwise and echoes
it back). Subscribe to outcomes:

```http
POST /console/webhooks/subscriptions   # merchant-owned; secret shown once
```

Deliveries are HMAC-signed (`X-Sellable-Signature`). Replays are
idempotent — consumers must tolerate redelivery.

## 8. Onboard through the sandbox

Local development may use a synthetic merchant and simulated payments.
Staging uses a disposable merchant and Razorpay Test Mode, following
`docs/STAGING_SANDBOX_RUNBOOK.md`; do not use production data or live payment
credentials. Live transactions and a production marker are outside this
sandbox workflow. Ask the staging operator to run onboarding; bring your
`agent_id` and capability list.
