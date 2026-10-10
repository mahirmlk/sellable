# External Agent Integration Guide

SELLABLE treats customer-side agents as **first-class external principals**:
they discover merchants, negotiate capabilities, link customer identity,
delegate bounded permissions, and transact through one canonical commerce
core — over REST, MCP, A2A, or UCP.

## 1. Discover a merchant

```http
GET /.well-known/ucp          # full merchant declaration (identity, capabilities,
                              # protocols, auth, identity linking, payments, shipping)
GET /.well-known/agents.json  # lightweight manifest + delegation notice
GET /agent/profile            # platform agents and versions
GET /agent/capabilities       # negotiable capability profile
GET /llms.txt                 # human/agent-readable instructions
GET /catalog.ai.json          # machine-readable catalog
GET /a2a/card                # A2A actor card (seller + service)
GET /mcp/tools               # MCP-compatible tool list (agent key required)
```

## 2. Authenticate

Two mechanisms, usable together:

- **API key**: `X-Agent-Key` header (merchant-issued; plaintext shown once
  in the console under Storefront → Agent API Keys), or the demo key
  outside production.
- **Signed requests**: HMAC-SHA256 over
  `timestamp.nonce.agent_id.method.path` with `X-Timestamp`, `X-Nonce`,
  `X-Signature` headers and server-side replay protection.

Mutating canonical routes require the signed variant; reads accept either.

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

New agents prove themselves without real money or production data: a
synthetic merchant, catalog, and simulated payments, then the gated
workflow register → handshake → credential → connect → conformance →
security → scenarios → trust → approval → production marker. Ask the
merchant operator to run onboarding; bring your `agent_id` and capability
list.
