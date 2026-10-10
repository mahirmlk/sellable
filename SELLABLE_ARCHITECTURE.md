# SELLABLE — End-to-End Agentic Commerce Platform Architecture

**Status:** Target platform architecture  
**Product:** SELLABLE  
**Architecture intent:** Production-oriented agentic commerce infrastructure.

> **Core product thesis:** SELLABLE is the infrastructure layer that makes merchants understandable, trustworthy, discoverable, purchasable, and supportable by AI agents while keeping commerce state, authorization, risk, pricing, payments, and customer-impacting actions under deterministic control.

> **Core safety principle:** **Agents propose and orchestrate; deterministic services authorize and execute; merchants retain commercial control; customers retain delegated authority; every consequential action is observable, evaluable, and auditable.**

---

# 1. Executive Summary

SELLABLE is an **agentic commerce operating layer for merchants**.

The platform has two kinds of intelligent participants that SELLABLE operates directly:

1. **Seller Agent** — the merchant-side commerce agent responsible for product discovery assistance, selling, negotiation, promotions, cart/checkout assistance, customer context, revenue optimization, and bounded post-purchase actions.
2. **Customer Service Agent** — the merchant-side service agent responsible for authenticated customer support, order assistance, shipping status, returns, exchanges, refunds, issue resolution, and escalation.

SELLABLE does **not** run a Buyer Agent as a core platform component.

External customer-side agents are treated as **clients of SELLABLE**. They connect through the Agent Gateway and protocol interoperability layer, discover merchant capabilities, negotiate supported capabilities, authenticate or link customer identity where required, and invoke commerce operations under customer delegation and merchant policy.

The platform therefore separates the system into five major planes:

```text
                         SELLABLE PLATFORM

 ┌───────────────────────────────────────────────────────────────────┐
 │ EXPERIENCE / INTELLIGENCE PLANE                                   │
 │                                                                   │
 │ Seller Agent          Customer Service Agent     External Agents   │
 └───────────────────────────────┬───────────────────────────────────┘
                                 │
 ┌────────────────────────────────▼──────────────────────────────────┐
 │ PROTOCOL + ACCESS PLANE                                           │
 │                                                                   │
 │ Protocol Gateway · Discovery · Capability Negotiation · Identity   │
 │ OAuth/API Keys · Delegation · Scopes · Rate Limits · Sessions      │
 └────────────────────────────────┬──────────────────────────────────┘
                                  │
 ┌────────────────────────────────▼──────────────────────────────────┐
 │ COMMERCE CONTROL PLANE                                            │
 │                                                                   │
 │ Catalog · Search · Recommendations · Pricing · Promotions         │
 │ Cart · Quote · Checkout · Tax · Shipping · Order · Returns        │
 │ Refunds · Inventory/Availability · Merchant Policies              │
 └────────────────────────────────┬──────────────────────────────────┘
                                  │
 ┌────────────────────────────────▼──────────────────────────────────┐
 │ TRUST + EXECUTION PLANE                                           │
 │                                                                   │
 │ Guardrails · Authorization/Mandates · Risk/Fraud · Payment        │
 │ Trust/Reputation · Webhooks · Idempotency · Basic Fulfillment     │
 └────────────────────────────────┬──────────────────────────────────┘
                                  │
 ┌────────────────────────────────▼──────────────────────────────────┐
 │ EVENT + EVIDENCE + OPERATIONS PLANE                               │
 │                                                                   │
 │ Event Bus · Agent Observability · Evaluation · Audit Ledger        │
 │ Analytics · Notifications · Replay · Platform Operations           │
 └───────────────────────────────────────────────────────────────────┘
```

The architecture is intentionally designed so that adding another agent framework, model provider, payment provider, or commerce protocol does not require rewriting the commerce core.

---

# 2. Architectural Goals

SELLABLE should make the following properties true:

### 2.1 Agent-native merchant access

A merchant should be machine-readable and transaction-capable without requiring every agent platform to build a custom integration.

### 2.2 Deterministic commerce

The authoritative state of products, prices, promotions, carts, checkout sessions, orders, refunds, shipping status, customer permissions, and payment state must live outside LLM context.

### 2.3 Delegated autonomy

A customer can delegate a bounded set of commerce actions to an agent without giving the agent unrestricted authority.

### 2.4 Merchant control

Merchants define catalog, pricing, promotion, negotiation, shipping, refund, risk, category, and agent-access policies. Agents cannot silently override them.

### 2.5 Trust between three parties

The platform must reason about trust among:

```text
Customer ↔ Agent
Customer ↔ Merchant
Agent ↔ Merchant
```

Trust is represented through identity, authentication, delegation, reputation, risk signals, history, policy compliance, and cryptographic or signed evidence where appropriate.

### 2.6 Complete lifecycle coverage

The platform should support:

```text
discovery
→ search
→ recommendation
→ product understanding
→ cart
→ quote / negotiation
→ promotion
→ checkout
→ authorization
→ payment
→ order
→ basic fulfillment/shipping
→ support
→ return/exchange/refund
→ analytics
```

### 2.7 Observable and evaluable agents

Every production agent run must be measurable. Agent quality must be testable before deployment and continuously monitored after deployment.

---

# 3. What SELLABLE Owns vs What It Integrates

SELLABLE is not required to replace a merchant's entire commerce stack.

The platform should expose a canonical commerce model and then connect merchant systems through adapters.

```text
                 SELLABLE CANONICAL MODEL
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
   Merchant API      Merchant Connector   Native Data
        │                 │                 │
        │          ┌──────┼────────┐        │
        │          │      │        │        │
      Custom     Shopify WooCommerce ERP   SELLABLE Store
      REST/API   /other  /other     /OMS
```

SELLABLE owns or normalizes the agentic control plane. Merchant systems remain the source for merchant-owned operational data where configured.

### SELLABLE authoritative domains

- agent identity
- external agent registrations
- customer identity linkage
- permissions and delegation
- merchant identity and onboarding state
- machine-readable merchant profile
- normalized agent capability profile
- normalized catalog representation
- search/recommendation indexes
- cart sessions
- checkout sessions
- quote state
- promotion evaluation
- authorization/mandates
- risk decisions
- payment orchestration state
- order orchestration state
- customer-service cases
- event stream
- agent observability
- evaluation results
- trust/reputation records
- audit ledger

### Merchant-integrated domains

- source inventory systems
- warehouse systems
- carrier systems
- ERP/OMS/CRM
- existing customer systems
- existing storefront
- payment providers

---

# 4. Architectural Principles

## 4.1 Agents are intelligence, not system-of-records

The Seller Agent and Customer Service Agent may reason, plan, retrieve context, call tools, and recommend actions.

They do not own authoritative commerce state.

```text
Agent output
    ↓
validated tool request
    ↓
authorization + guardrails
    ↓
deterministic domain service
    ↓
state change
    ↓
event
    ↓
ledger + analytics + observability
```

## 4.2 LLM proposes; deterministic systems dispose

The model may propose:

- products
- ranking explanations
- negotiation strategies
- promotion opportunities
- customer-service replies
- next-best actions
- cross-sells
- bundles
- recovery suggestions

The model may not directly:

- set authoritative prices
- mutate policy
- modify inventory
- authorize payments
- issue unrestricted refunds
- access arbitrary customer data
- grant itself permissions
- create credentials
- mark money as settled
- bypass fraud/risk
- bypass customer delegation
- bypass required human approval

## 4.3 Customer delegation is separate from merchant consent

A customer may authorize an agent, while the merchant still evaluates whether that agent and proposed action are acceptable.

```text
Customer authority
       +
Agent identity
       +
Merchant capability/policy
       +
Risk decision
       +
Transaction state
       ↓
Executable action
```

## 4.4 Every consequential agent action is attributable

Every tool action should carry:

```text
principal_id
agent_id
agent_version
merchant_id
customer_id (when known)
delegation_id (when applicable)
session_id
trace_id
tool_call_id
policy_decision_id
risk_decision_id
idempotency_key
```

## 4.5 Event Bus and Ledger are different systems

The **Event Bus** is for distributed system communication and asynchronous processing.

The **Audit Ledger** is for durable evidence and reconstruction of material actions.

Do not use the ledger as an event queue.

## 4.6 Agent telemetry is different from business analytics

Agent observability answers:

> What did the agent and its tools do, how did the model behave, what did it cost, and where did it fail?

Business analytics answers:

> What happened to conversion, revenue, AOV, promotions, customer retention, returns, and agent-assisted commerce?

---

# 5. Platform Planes

## 5.1 Intelligence Plane

Contains:

- Seller Agent
- Customer Service Agent
- agent runtime
- model gateway
- tool registry
- prompt/version registry
- agent memory/context policy
- agent planning and execution
- agent guardrail middleware

## 5.2 Protocol and Access Plane

Contains:

- protocol gateway
- discovery
- capability negotiation
- authentication
- identity linking
- delegation
- permissions/scopes
- request signing
- session management
- rate limits
- quotas
- API versioning

## 5.3 Commerce Control Plane

Contains:

- merchant
- catalog
- inventory/availability
- search
- recommendation
- pricing
- promotions
- cart
- quotes
- negotiation
- tax
- checkout
- order
- shipping
- returns
- refunds

## 5.4 Trust and Execution Plane

Contains:

- agent trust
- customer trust
- merchant trust
- risk engine
- fraud engine
- policy engine
- authorization/mandates
- human approval
- payment orchestration
- payment provider adapters
- idempotency
- webhook reconciliation

## 5.5 Event, Evidence, Analytics and Operations Plane

Contains:

- event bus
- durable event store
- audit ledger
- trace storage
- metrics
- logs
- agent evaluation
- analytics warehouse/model
- notification service
- replay service
- operational dashboards
- platform admin

---

# 6. High-Level System Architecture

```text
                         EXTERNAL ECOSYSTEM

    Customer Apps       AI Platforms        Agent Frameworks
         │                    │                     │
         └────────────────────┼─────────────────────┘
                              │
                     UCP / MCP / A2A / REST
                              │
                              ▼
                    ┌──────────────────────┐
                    │   PROTOCOL GATEWAY   │
                    │ discovery / auth /   │
                    │ negotiation / rate  │
                    │ limit / translation  │
                    └──────────┬───────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
            ▼                  ▼                  ▼
     Identity & Trust   Capability Registry   Delegation
            │                  │                  │
            └──────────────────┼──────────────────┘
                               │
                               ▼
                   ┌─────────────────────────┐
                   │   COMMERCE ORCHESTRATOR │
                   └────────────┬────────────┘
                                │
         ┌──────────────────────┼────────────────────────────┐
         │                      │                            │
         ▼                      ▼                            ▼
   Discovery Stack       Transaction Stack             Support Stack
   Search               Cart / Quote / Checkout       Cases
   Recommendation       Pricing / Promotions           Order help
   Catalog              Tax / Shipping                 Returns/refunds
         │                      │                            │
         └──────────────────────┼────────────────────────────┘
                                │
               ┌────────────────┼────────────────┐
               │                │                │
               ▼                ▼                ▼
          Policy Engine     Risk/Fraud       Authorization
               │                │                │
               └────────────────┼────────────────┘
                                │
                                ▼
                     Payment Orchestrator
                                │
                  ┌─────────────┼─────────────┐
                  ▼             ▼             ▼
              Razorpay     Provider B     Provider C
                                │
                                ▼
                             Order
                                │
                                ▼
                       Basic Fulfillment
                       + Shipping Tracking
                                │
                                ▼
                     Customer Service Agent

     Cross-cutting:

     Event Bus ── Observability ── Evaluation ── Ledger ── Analytics
```

---

# 7. Agent Model

SELLABLE should not become a collection of dozens of loosely controlled agents.

Use a small number of well-defined agents backed by deterministic domain services.

## 7.1 Seller Agent

The Seller Agent is the main commercial intelligence layer for the merchant.

### Responsibilities

```text
merchant context
→ understand customer intent
→ discover relevant products
→ compare products
→ explain trade-offs
→ build cart
→ create/update quote
→ negotiate within policy
→ evaluate promotion opportunities
→ recommend cross-sell / bundle
→ guide checkout
→ answer product questions
→ understand customer history when permitted
→ initiate allowed post-purchase actions
→ hand off to Customer Service Agent
```

### The Seller Agent should be able to act as

- sales assistant
- product specialist
- negotiation assistant
- promotion assistant
- merchandising assistant
- cart assistant
- checkout assistant
- revenue optimization assistant
- commerce concierge

### The Seller Agent must NOT own

- authoritative product prices
- price floors
- discount limits
- inventory
- promotion eligibility rules
- customer permissions
- payment credentials
- fraud decisions
- refund authority
- merchant policy configuration

### Seller Agent tool groups

```text
catalog.search
catalog.get
catalog.compare
catalog.availability

search.query
recommendations.get

cart.create
cart.get
cart.add_item
cart.remove_item
cart.update_quantity
cart.apply_promotion

quote.create
quote.refresh
quote.negotiate

promotion.evaluate
promotion.explain

checkout.create
checkout.get
checkout.update
checkout.request_approval

customer.get_context
customer.get_preferences

shipping.get_options
shipping.get_estimate

order.get
order.cancel_request

service.create_case
service.handoff
```

Every tool call is permissioned and schema validated.

## 7.2 Seller Agent state machine

```text
UNDERSTAND_INTENT
      ↓
SEARCH
      ↓
RECOMMEND
      ↓
BUILD_CART
      ↓
PRICE
      ↓
NEGOTIATE (optional)
      ↓
PROMOTION
      ↓
CHECKOUT
      ↓
AUTHORIZATION
      ↓
PAYMENT
      ↓
ORDER_CONFIRMATION
      ↓
POST_PURCHASE_HANDOFF (optional)
```

## 7.3 Customer Service Agent

The Customer Service Agent handles post-purchase and account-support interactions.

### Responsibilities

- authenticate customer context
- retrieve order history within permissions
- explain order status
- provide basic shipping information
- handle delivery-status questions
- create service cases
- initiate eligible return requests
- initiate eligible exchange requests
- initiate refund requests within policy
- explain refund status
- answer product/policy questions
- identify policy exceptions
- escalate complex or sensitive cases to human support
- summarize cases for support staff

### Customer Service Agent tool groups

```text
customer.authenticate_context
customer.profile
customer.orders
customer.permissions

order.get
order.timeline
order.cancel_request

shipping.track
shipping.estimate
shipping.address_status

return.create
return.get
exchange.create
refund.request
refund.get

policy.lookup
support.case.create
support.case.update
support.case.escalate
```

### Customer Service Agent state machine

```text
INTAKE
  ↓
AUTHENTICATE
  ↓
LOAD_CONTEXT
  ↓
CLASSIFY
  ├───────────────┐
  ↓               ↓
RESOLVE        ESCALATE
  ↓               ↓
EXECUTE_ALLOWED HUMAN HANDOFF
  ↓
CONFIRM
  ↓
CLOSE
```

The Customer Service Agent cannot issue arbitrary refunds, modify account security, reveal private information, or override merchant policy.

## 7.4 External buyer/customer agents

External agents are not deployed inside the core SELLABLE runtime.

They interact through the protocol gateway as first-class external principals.

```text
External Agent
      ↓
SELLABLE Protocol Gateway
      ↓
Identity + Delegation + Trust
      ↓
Capability Negotiation
      ↓
Commerce API
```

This is the core model for scaling SELLABLE across different customer-side agent platforms.

---

# 8. Agent Runtime and Model Gateway

## 8.1 Agent Runtime

Recommended responsibilities:

- stateful execution
- tool routing
- checkpoints
- retries
- timeouts
- max-step enforcement
- context management
- structured outputs
- human escalation
- versioned execution graphs

LangGraph can implement the initial runtime because its state-machine/checkpoint model fits bounded commerce flows.

## 8.2 Model Gateway

The model layer must be provider-agnostic.

```text
Agent Runtime
      ↓
Model Gateway
      ├── provider A
      ├── provider B
      ├── local model
      └── fallback provider
```

The gateway records:

```text
model_provider
model_name
model_version
request_id
latency_ms
input_tokens
output_tokens
estimated_cost
finish_reason
error
retry_count
```

## 8.3 Prompt and agent versioning

Every agent execution must identify:

```text
agent_id
agent_version
prompt_version
policy_bundle_version
tool_registry_version
model_version
```

This makes evaluations and incident replay reproducible.

---

# 9. Agent Guardrails

Guardrails apply to **every agent**, not only the Seller Agent.

## 9.1 Guardrail stack

```text
Incoming request
      ↓
identity check
      ↓
tenant isolation
      ↓
input validation
      ↓
prompt-injection / untrusted-content detection
      ↓
agent scope check
      ↓
model execution
      ↓
structured output validation
      ↓
tool authorization
      ↓
policy evaluation
      ↓
risk/fraud evaluation
      ↓
execution
      ↓
output sanitization
```

## 9.2 Guardrail categories

### Identity guardrails

- valid agent identity
- valid merchant/customer relationship
- credential status
- credential expiry
- tenant boundary
- session ownership

### Permission guardrails

- tool allowlists
- action scopes
- object-level authorization
- delegation scope
- spend limits
- category restrictions
- merchant restrictions
- time limits

### Model guardrails

- model allowlist
- maximum context
- maximum tool steps
- timeout
- retry limits
- token budget
- cost budget
- loop detection
- unsafe output filtering

### Commerce guardrails

- SKU existence
- price source validation
- promotion eligibility
- inventory validation
- tax calculation
- shipping validity
- cart totals
- authorization validity
- risk score threshold
- payment amount binding

### Data guardrails

- PII minimization
- sensitive-field access control
- customer-data scopes
- prompt/context filtering
- secrets never exposed to model context
- output redaction

### Tool-execution guardrails

No agent can directly invoke arbitrary network endpoints or database queries.

All actions must pass through registered tools with typed schemas and explicit authorization.

---

# 10. Merchant Onboarding

Merchant onboarding is a first-class platform domain, not a setup screen.

## 10.1 Onboarding lifecycle

```text
CREATED
  ↓
BUSINESS_PROFILED
  ↓
IDENTITY_VERIFIED
  ↓
COMMERCE_CONNECTED
  ↓
CATALOG_IMPORTED
  ↓
POLICIES_CONFIGURED
  ↓
PAYMENTS_CONFIGURED
  ↓
SHIPPING_CONFIGURED
  ↓
AGENT_PROFILE_PUBLISHED
  ↓
SANDBOX_TESTED
  ↓
READY_FOR_REVIEW
  ↓
LIVE
```

## 10.2 Merchant onboarding data

### Business

- merchant identity
- legal/business profile
- primary domain
- support contacts
- business categories
- operating regions
- supported currencies

### Commerce

- catalog source
- inventory source
- order source
- customer source
- connector credentials
- sync settings

### Commercial policies

- price policy
- discount/floor policy
- negotiation limits
- promotion rules
- refund rules
- return rules
- customer-service authority
- shipping options

### Agent policy

- supported agent capabilities
- supported protocols
- allowed external agent types
- allowed operations
- identity-linking requirements
- approval requirements
- spend / risk thresholds

### Payment

- provider configuration
- webhook secrets
- settlement configuration
- supported payment handlers

## 10.3 Merchant onboarding validation

Before activation, the platform should run automated checks:

```text
catalog completeness
policy consistency
promotion consistency
payment health
webhook health
shipping availability
return/refund policy completeness
agent capability profile validity
protocol endpoint health
sandbox transaction
```

---

# 11. Merchant Identity and Trust

## 11.1 Merchant identity

Each merchant receives a stable platform identity:

```text
merchant_id
merchant_domain
organization_id
verification_status
capability_profile_id
trust_profile_id
created_at
status
```

## 11.2 Merchant trust profile

The platform should maintain internal trust signals such as:

- verified domain
- account age
- policy consistency
- successful transaction history
- dispute/return patterns
- webhook integrity
- protocol compliance checks
- security posture
- customer complaint rate
- agent interaction reliability

A trust score should be explanatory and decomposable rather than a single opaque number.

---

# 12. Customer Identity and Trust

Customer identity must be separate from agent identity.

```text
Customer
   │
   ├── account identity
   ├── authentication
   ├── addresses
   ├── preferences
   ├── orders
   ├── payment references
   └── agent delegations
```

The customer can interact directly or through one or more agents.

## 12.1 Customer identity levels

```text
anonymous
   ↓
known_customer
   ↓
authenticated_customer
   ↓
identity_linked_customer
   ↓
verified_high_trust_context (when supported)
```

The system should not reveal higher-trust data simply because an agent claims to know the customer.

## 12.2 Customer trust signals

Use only necessary signals, for example:

- successful authenticated sessions
- transaction history
- account age
- prior chargebacks/abuse signals
- device/session risk signals
- verified contact channels
- delegation history

Risk data should be isolated from general LLM context and exposed only through purpose-specific tools.

---

# 13. Agent Identity and Trust

Every external or internal agent is a first-class identity.

```text
agent_id
agent_type
owner_id
issuer
client_id
credential_status
credential_expires_at
capability_profile
trust_profile
created_at
last_seen_at
```

## 13.1 Agent identity classes

```text
SELLABLE_INTERNAL_AGENT
MERCHANT_OWNED_AGENT
CUSTOMER_AGENT
PLATFORM_AGENT
INTEGRATION_AGENT
```

## 13.2 Agent trust signals

- verified owner
- verified domain/application
- credential age
- successful transactions
- policy violations
- fraud/risk incidents
- authentication quality
- tool abuse attempts
- rate-limit behavior
- failed authorization attempts
- chargeback/dispute correlation
- reputation attestations where available

## 13.3 Agent reputation

Agent reputation is distinct from identity.

Identity answers:

> Who is this agent?

Reputation answers:

> How has this agent behaved over time?

A reputation record can include:

```text
successful_transactions
failed_transactions
policy_denials
fraud_flags
abuse_flags
authorization_failures
average_order_value
support_incidents
merchant_acceptance_rate
customer_complaints
reputation_score
score_confidence
last_updated_at
```

Reputation should never be the sole authorization mechanism. It is a signal consumed by the risk and trust system.

---

# 14. Permission, Delegation and Authorization

This replaces a narrow one-time consent model with a broader **authorization and delegation system**.

## 14.1 Core model

```text
Customer
   │
   │ delegates
   ▼
Customer Agent
   │
   │ requests action
   ▼
SELLABLE Gateway
   │
   ├── delegation validation
   ├── merchant policy
   ├── risk policy
   └── action authorization
   │
   ▼
Commerce operation
```

## 14.2 Delegation grant

A delegation should contain at least:

```text
delegation_id
principal_customer_id
subject_agent_id
merchant_scope
operation_scopes
category_scopes
amount_limit
currency
frequency_limit
approval_mode
valid_from
expires_at
status
created_at
revoked_at
```

## 14.3 Example scopes

```text
catalog:read
search:read
recommendation:read
cart:write
checkout:write
order:read
order:cancel_request
shipping:read
return:create
refund:request
support:create
payment:authorize
```

Higher-risk scopes require stronger authorization.

## 14.4 Authorization decision

Authorization should return:

```text
ALLOW
DENY
REQUIRE_CUSTOMER
REQUIRE_HUMAN
```

with:

```text
reason_code
matched_policies
scope_used
amount_checked
delegration_checked
risk_reference
expires_at
```

## 14.5 Transaction-bound authorization

For payment or other irreversible actions, an action should bind authorization to the exact transaction state.

```text
customer intent
    ↓
delegation
    ↓
cart snapshot
    ↓
quote / checkout snapshot
    ↓
authorization
    ↓
risk decision
    ↓
payment mandate / provider authorization
    ↓
execution
```

The authorization must be rejected if the cart, amount, merchant, currency, or material risk context changes beyond allowed tolerance.

---

# 15. Agent Capability Discovery and Negotiation

Capability negotiation is a first-class protocol service.

A merchant and external agent should not assume that either side supports every commerce operation.

## 15.1 Capability profile

A capability declaration can describe:

```text
protocols
catalog search
catalog lookup
recommendations
cart
quotes
negotiation
promotions
checkout
identity linking
shipping
orders
returns
refund requests
customer support
payment methods
webhooks
```

Each capability should include:

```text
capability_id
version
transport
endpoint
required_scopes
auth_mode
limits
status
```

## 15.2 Negotiation flow

```text
Agent profile
      ↓
Merchant profile
      ↓
intersection
      ↓
version selection
      ↓
session capability set
      ↓
operation
```

No capability should be assumed merely because it exists in the global platform registry.

UCP currently uses a server-selects capability negotiation model where the active capability set is derived from supported versions/capabilities on the participating sides; SELLABLE should follow the same conceptual pattern behind its protocol abstraction. citeturn525419search0turn525419search9

## 15.3 Negotiated session

Each protocol session should have:

```text
session_id
agent_id
merchant_id
protocol
protocol_version
active_capabilities
auth_context
delegation_context
created_at
expires_at
```

---

# 16. Protocol Interoperability Layer

The goal is **one commerce core, many protocol surfaces**.

```text
                     Protocol Gateway
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
       REST               MCP                A2A
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                         UCP
                           │
                           ▼
                   Canonical Commerce API
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          Commerce      Identity     Authorization
           Services       Trust         Risk
```

## 16.1 Protocol targets

### REST

Primary canonical transport for SELLABLE services.

### MCP

Expose safe, typed commerce tools for compatible agent runtimes.

### A2A

Expose a SELLABLE-compatible agent surface for agent-to-agent interactions where appropriate.

### UCP

Provide a commerce interoperability adapter for standardized merchant discovery, capabilities, catalog, cart, checkout, identity linking, and order interactions.

### AP2-style authorization model

The internal authorization architecture should be capable of binding user intent/authorization to a specific checkout and payment operation. This makes the platform compatible with the conceptual direction of mandate-based agent payments without requiring the whole platform to become a certified AP2 implementation.

Current UCP documentation defines standardized capabilities including Cart, Checkout, Identity Linking and Order and uses explicit capability negotiation. UCP also supports REST, MCP and A2A integration patterns. citeturn525419search1turn525419search9turn592286search11

Current AP2 materials describe typed authorization artifacts that bind user intent/approval to specific commerce/payment context and provide verifiable transaction evidence. SELLABLE's delegation and transaction authorization model should preserve that separation of intent, merchant offer, authorization, and payment execution. citeturn592286search3turn592286search1

## 16.2 Protocol adapter rule

Protocol adapters must translate into canonical commands.

```text
UCP request
   ↓
UCP adapter
   ↓
CanonicalCommand
   ↓
Authorization
   ↓
Commerce service
```

Never place business logic independently inside every protocol adapter.

---

# 17. Agent Gateway

The Agent Gateway is the single external entry layer for machine-facing commerce.

## 17.1 Gateway responsibilities

- merchant discovery
- protocol discovery
- capability negotiation
- authentication
- identity linking
- delegation resolution
- request normalization
- idempotency
- rate limiting
- abuse protection
- versioning
- routing
- protocol translation
- response shaping
- correlation IDs

## 17.2 Canonical discovery surfaces

```http
GET /.well-known/ucp
GET /.well-known/agents.json
GET /llms.txt
GET /catalog.ai.json
GET /agent/profile
GET /agent/capabilities
```

These should expose machine-readable, non-secret information about:

- merchant identity
- capabilities
- protocol support
- authentication expectations
- customer identity linking support
- payment methods/handlers
- shipping capabilities
- return/refund policy summaries
- support channels

## 17.3 Canonical commerce surfaces

```http
POST /commerce/search
POST /commerce/catalog/lookup
POST /commerce/recommendations
POST /commerce/cart
POST /commerce/cart/items
POST /commerce/quotes
POST /commerce/quotes/negotiate
POST /commerce/promotions/evaluate
POST /commerce/checkout
POST /commerce/checkout/authorize
POST /commerce/orders
GET  /commerce/orders/{id}
POST /commerce/returns
POST /commerce/refunds/requests
POST /commerce/support/cases
```

Adapters can expose protocol-specific paths without changing these canonical operations.

---

# 18. Canonical Commerce Model

The platform needs a normalized commerce model so different merchant backends and agent protocols behave consistently.

## 18.1 Product

```text
product_id
merchant_id
sku / variant_id
title
description
attributes
category
brand
images
price
currency
inventory_state
availability
shipping_constraints
return_policy_ref
warranty_ref
promotion_refs
compatibility_refs
trust_metadata
```

## 18.2 Cart

Cart is distinct from quote and order.

```text
cart_id
customer_id
agent_session_id
merchant_id
items
prices_snapshot
promotion_snapshot
tax_estimate
shipping_selection
subtotal
discount_total
tax_total
shipping_total
grand_total
status
expires_at
version
```

A cart is mutable.

## 18.3 Quote

A quote is a bounded commercial offer, especially useful where negotiated or time-limited pricing exists.

A quote contains snapshots of:

- items
- base prices
- negotiated prices
- applicable promotions
- taxes
- shipping
- expiration
- policy decision

## 18.4 Checkout

Checkout is the transaction-preparation state between cart/quote and order.

```text
CHECKOUT_CREATED
  ↓
PRICED
  ↓
SHIPPING_SELECTED
  ↓
TAXED
  ↓
PROMOTIONS_APPLIED
  ↓
RISK_REVIEW
  ↓
AUTHORIZATION_REQUIRED
  ↓
PAYMENT_PENDING
  ↓
COMPLETED
```

UCP's current checkout model similarly treats checkout as a deterministic commerce session covering cart/checkout operations, tax and payment context, with identity linking and order capabilities as related protocol surfaces. citeturn525419search7turn525419search8

## 18.5 Order

An order is immutable enough to represent a confirmed purchase and the downstream lifecycle.

```text
order_id
merchant_id
customer_id
agent_id
cart_snapshot
checkout_snapshot
payment_reference
shipping_snapshot
promotion_snapshot
tax_snapshot
status
created_at
```

---

# 19. Catalog, Search and Recommendation Engine

Search and recommendations must be deterministic/service-backed rather than generated from LLM memory.

## 19.1 Search architecture

```text
query
 ↓
query normalization
 ↓
lexical retrieval ──┐
semantic retrieval ─┼→ candidate merge
attribute filters ──┤
availability filters ┘
 ↓
ranking
 ↓
policy / inventory / trust constraints
 ↓
results
```

Initial implementation can use:

- PostgreSQL full-text search
- pgvector for semantic retrieval
- structured attribute filters
- deterministic ranking features

A separate search engine can be introduced later without changing agent semantics.

## 19.2 Search ranking features

- relevance
- product quality
- availability
- delivery eligibility
- price fit
- historical conversion
- customer preference
- merchant-defined boost/bury rules
- promotion eligibility
- margin objectives where permitted
- trust/safety constraints

## 19.3 Recommendation engine

Recommendation should be a separate service from the Seller Agent.

Candidate generators can include:

```text
co-purchase
content similarity
semantic similarity
customer history
session behavior
popular products
merchant-curated relationships
promotion eligibility
```

The Seller Agent consumes recommendation results and decides how to present them conversationally.

## 19.4 Recommendation safety

The recommendation system cannot recommend:

- unavailable products
- prohibited products
- products outside customer/agent permission scope
- products that violate regional constraints
- products whose promotion claims are not currently valid

---

# 20. Pricing, Negotiation and Promotions

Pricing is a dedicated deterministic service.

## 20.1 Pricing service

The pricing service calculates the authoritative price from:

```text
base price
+ quantity rules
+ customer pricing
+ merchant pricing
+ negotiated adjustment
+ promotion adjustments
+ shipping
+ tax
```

The result is a signed/snapshotted price breakdown for the transaction.

## 20.2 Negotiation service

The Seller Agent may propose a negotiation strategy, but the service enforces:

- floor price
- maximum discount
- max negotiation rounds
- allowed products
- excluded products
- customer segment rules
- campaign rules
- merchant margin limits
- time window

## 20.3 Promotion engine

Promotion is a first-class service.

Promotion primitives:

```text
coupon
percentage_discount
fixed_discount
bundle
buy_x_get_y
volume_discount
free_shipping
limited_time_offer
customer_segment_offer
agent_channel_offer
```

Each promotion has:

```text
promotion_id
merchant_id
status
start_at
end_at
eligibility_rule
stacking_rule
budget_limit
redemption_limit
channel_scope
product_scope
customer_scope
agent_scope
```

## 20.4 Promotion evaluation

Promotions are evaluated against authoritative cart state.

```text
candidate promotions
       ↓
eligibility engine
       ↓
stacking/conflict engine
       ↓
budget/cap engine
       ↓
selected promotion set
       ↓
price snapshot
```

The LLM can explain a promotion but cannot invent one.

---

# 21. Cart and Checkout

## 21.1 Cart service responsibilities

- cart creation
- item mutations
- inventory revalidation
- price refresh
- promotion evaluation
- customer/agent association
- cart versioning
- optimistic concurrency
- expiration

## 21.2 Checkout service responsibilities

- transform cart into checkout
- capture customer identity context
- validate shipping address
- calculate shipping
- calculate tax
- apply promotions
- run risk checks
- resolve delegation
- request authorization
- create payment session
- finalize order

## 21.3 Checkout invariants

```text
cart version must match checkout version
prices must be revalidated
promotion state must be revalidated
inventory must be revalidated
customer permission must still be valid
agent delegation must not be expired/revoked
risk decision must be current enough
payment amount must equal authorized amount
```

---

# 22. Tax

Tax must be a separate deterministic service.

For the initial India-oriented implementation, the abstraction should support GST concepts such as CGST/SGST/IGST while leaving room for other jurisdictions.

Tax output should include:

```text
tax_lines
jurisdiction
rate
amount
basis
calculation_reference
```

Agents should never calculate authoritative tax amounts from language-model reasoning.

---

# 23. Shipping and Basic Fulfillment

Fulfillment is intentionally kept basic.

The goal is to make shipping visible and transactionally correct without turning SELLABLE into a warehouse/OMS product.

## 23.1 Shipping service

Responsibilities:

- serviceability check
- shipping method selection
- shipping price
- delivery estimate
- address validation hooks
- tracking reference
- carrier status ingestion

Example methods:

```text
standard
express
pickup (optional)
```

## 23.2 Basic fulfillment state

```text
ORDER_CONFIRMED
   ↓
FULFILLMENT_PENDING
   ↓
SHIPPED
   ↓
IN_TRANSIT
   ↓
DELIVERED
```

Exceptions:

```text
CANCELLED
DELIVERY_FAILED
RETURN_REQUESTED
RETURNED
```

## 23.3 What is intentionally out of scope

Do not build:

- warehouse management
- route optimization
- complex carrier orchestration
- inventory planning
- procurement planning
- advanced delivery optimization

Use connector interfaces where those systems already exist.

---

# 24. Fraud and Risk Platform

Fraud prevention is separate from business policy.

## 24.1 Difference

**Policy Engine** answers:

> Is this action allowed according to merchant/customer/business rules?

**Risk Engine** answers:

> How risky does this action appear based on identity, behavior, transaction, and agent signals?

**Fraud Engine** answers:

> Is there evidence or pattern consistent with abuse, fraud, credential misuse, or payment attacks?

## 24.2 Risk inputs

```text
customer trust
agent identity
agent reputation
merchant trust
transaction amount
velocity
cart characteristics
shipping address signals
payment signals
failed attempts
credential history
IP/session/network signals
promotion abuse signals
previous disputes
```

The LLM should not receive raw risk internals unless necessary. Prefer a purpose-built risk decision tool.

## 24.3 Risk decisions

```text
ALLOW
LOW_RISK_REVIEW
STEP_UP_AUTH
REQUIRE_CUSTOMER
REQUIRE_HUMAN
BLOCK
```

## 24.4 Fraud controls

- velocity limits
- repeated failed authorization detection
- credential abuse detection
- promotion abuse detection
- bot/agent abuse detection
- unusual agent behavior
- high-frequency cart creation
- payment testing patterns
- suspicious account linkage

Agentic commerce systems need fraud controls in addition to ordinary payment security because legitimate agent automation must be distinguished from abusive automation. citeturn592286search2turn592286search9

---

# 25. Payment Orchestration

Payment should be provider-independent.

```text
Checkout
   ↓
Payment Orchestrator
   ├── Razorpay Adapter
   ├── Provider Adapter B
   └── Provider Adapter C
```

Razorpay can remain the first concrete payment provider implementation, while its APIs remain behind the adapter interface.

## 25.1 Payment flow

```text
checkout validated
      ↓
authorization validated
      ↓
risk validated
      ↓
payment request created
      ↓
provider
      ↓
provider callback/webhook
      ↓
reconciliation
      ↓
order/payment state transition
```

## 25.2 Payment invariants

```text
LLM cannot execute arbitrary payment
payment requires valid authorization
payment amount must equal authorized amount
merchant/payee must match authorization
currency must match
idempotency key required
provider state is reconciled from verified webhook/API response
```

## 25.3 Payment receipt

Every successful payment should produce a normalized receipt containing:

```text
payment_id
order_id
provider
provider_reference
amount
currency
timestamp
authorization_reference
risk_reference
trace_id
```

---

# 26. Customer Service and Case Management

Customer service should not be implemented only as a chat window.

## 26.1 Case entity

```text
case_id
customer_id
merchant_id
agent_id
order_id
category
priority
status
messages
actions_taken
policy_refs
escalation_reason
created_at
updated_at
```

## 26.2 Support categories

```text
order_status
shipping
late_delivery
return
exchange
refund
product_question
billing
account
promotion
technical_issue
other
```

## 26.3 Human escalation

Escalation payload should include:

```text
customer summary
issue classification
order context
actions already attempted
policy constraints
risk flags
recommended next action
full trace link
```

This avoids forcing a support employee to reconstruct the conversation manually.

---

# 27. Event Bus

The Event Bus is a core infrastructure component.

## 27.1 Why it exists

Many systems need to react to the same commerce event:

```text
order.paid
```

may trigger:

- analytics
- merchant notification
- receipt
- fulfillment creation
- customer-service context refresh
- recommendation updates
- trust/reputation updates
- agent observability

These systems should not be tightly coupled to the order transaction.

## 27.2 Event architecture

```text
Domain Service
     ↓
Outbox
     ↓
Event Bus
     ├── analytics consumer
     ├── notification consumer
     ├── fulfillment consumer
     ├── trust consumer
     ├── recommendation consumer
     ├── observability consumer
     └── integration consumer
```

## 27.3 Event envelope

```json
{
  "event_id": "evt_123",
  "event_type": "order.paid",
  "event_version": 1,
  "occurred_at": "...",
  "tenant_id": "tenant_123",
  "merchant_id": "merchant_123",
  "aggregate_type": "order",
  "aggregate_id": "order_123",
  "trace_id": "trace_123",
  "actor": {
    "type": "agent",
    "id": "agent_123"
  },
  "data": {}
}
```

## 27.4 Delivery semantics

Use at-least-once delivery with idempotent consumers.

Important patterns:

- transactional outbox
- event versioning
- consumer idempotency
- dead-letter queue
- retry policy
- replay support

Redis Streams, a managed queue, or a Kafka-compatible bus can implement the first version depending on scale. The architecture must keep the bus behind a small event interface.

---

# 28. Audit Ledger and Transaction Replay

The audit ledger is a durable evidence layer.

## 28.1 Ledger principles

- append-only
- tenant-aware
- immutable event records
- trace-correlated
- policy-linked
- provider-linked
- no hidden reasoning-chain storage
- sufficient detail to explain material actions

## 28.2 Ledger event

```text
event_id
trace_id
occurred_at
tenant_id
merchant_id
customer_id
agent_id
agent_version
action
resource_type
resource_id
inputs_summary
outputs_summary
policy_refs
risk_ref
authorization_ref
provider_ref
reason_code
outcome
```

## 28.3 Replay

Replay should reconstruct:

```text
customer request
→ agent run
→ retrieval
→ tool calls
→ recommendations
→ cart mutations
→ promotions
→ quote/negotiation
→ policy decision
→ risk decision
→ authorization
→ payment
→ webhook
→ order state
→ support actions
```

The replay service reads evidence; it does not re-execute money actions.

---

# 29. Agent Observability

Agent observability must be treated as a full subsystem, not a logging add-on.

## 29.1 Three telemetry levels

### Run level

```text
agent_run_id
trace_id
agent_id
agent_version
merchant_id
customer_id
session_id
start_time
end_time
duration
status
outcome
```

### Model level

```text
model_provider
model_name
model_version
request_id
input_tokens
output_tokens
cached_tokens
estimated_cost
latency
finish_reason
retry_count
error
```

### Tool level

```text
tool_call_id
tool_name
tool_version
input_schema_version
input_hash
output_schema_version
latency
status
error
policy_decision_id
risk_decision_id
authorization_id
```

## 29.2 Agent metrics

Track at minimum:

### Reliability

- run success rate
- tool failure rate
- timeout rate
- retry rate
- loop termination rate
- escalation rate

### Quality

- tool-call accuracy
- catalog grounding rate
- invalid action rate
- unsupported claim rate
- policy violation attempt rate
- recommendation acceptance
- negotiation success
- support resolution rate

### Commerce

- agent-assisted conversion
- average order value
- promotion usage
- upsell acceptance
- checkout abandonment
- refund rate
- return rate

### Economics

- model cost per run
- model cost per order
- tool cost
- total agent-assisted transaction cost

### Safety

- guardrail blocks
- authorization denials
- risk escalations
- fraud blocks
- prompt-injection detections
- data-access denials

## 29.3 Distributed tracing

Use OpenTelemetry-compatible traces.

Recommended trace hierarchy:

```text
commerce.request
  └── agent.run
       ├── model.call
       ├── tool.call
       │    ├── authorization.check
       │    ├── policy.check
       │    └── risk.check
       └── model.call
```

The same `trace_id` should connect API gateway, agent runtime, domain services, event processing and payment reconciliation.

## 29.4 Agent observability storage

Keep operational traces and business analytics logically separate:

```text
Postgres
  → transactional metadata

OpenTelemetry backend
  → traces / spans / timings

Log store
  → structured service logs

Analytics store
  → aggregate product/business metrics
```

---

# 30. Agent Evaluation Platform

Evaluation must cover the agent, the tools, the policies, and the complete transaction.

## 30.1 Evaluation layers

```text
Unit evaluations
     ↓
Tool evaluations
     ↓
Agent scenario evaluations
     ↓
Adversarial/safety evaluations
     ↓
End-to-end commerce evaluations
     ↓
Online production monitoring
```

## 30.2 Evaluation dataset

Create a versioned dataset of scenarios containing:

```text
user intent
merchant state
customer state
agent identity
permissions
catalog
promotions
shipping context
risk context
expected tool sequence
expected policy outcome
expected final state
```

## 30.3 Seller Agent evaluation categories

### Grounding

- only recommends existing products
- no fabricated price
- no fabricated stock
- no fabricated promotion

### Tool correctness

- correct tool selected
- valid parameters
- correct sequencing
- no forbidden tool use

### Commerce correctness

- cart totals match backend
- promotion application is valid
- negotiation respects bounds
- checkout state remains valid

### Safety

- cannot bypass delegation
- cannot bypass policy
- cannot bypass risk
- cannot access unauthorized customer data
- cannot initiate unauthorized payment

### Conversation quality

- concise
- accurate
- clear explanation
- useful alternatives
- correct escalation

## 30.4 Customer Service Agent evaluation

- correct identity handling
- correct order retrieval
- correct policy interpretation
- correct shipping explanation
- correct return eligibility
- refund authority compliance
- escalation correctness
- no data leakage

## 30.5 Adversarial evaluations

Test:

```text
prompt injection in product description
prompt injection in merchant content
malicious tool arguments
stale cart
expired delegation
revoked delegation
price changed after authorization
promotion expired mid-checkout
inventory changed mid-checkout
fake payment success message
replayed webhook
stolen agent credential
agent impersonation
cross-tenant access attempt
```

## 30.6 Regression gates

A new agent/model version should not deploy automatically when it causes regressions in critical scenarios.

Example release gates:

```text
critical safety suite = 100% pass
commerce invariant suite = 100% pass
no new P0 policy violations
schema/tool tests = 100% pass
quality score >= threshold
cost/run <= threshold
latency p95 <= threshold
```

## 30.7 Online evaluation

After deployment, compare versions using sampled traces and business outcomes.

Monitor:

- quality drift
- tool error drift
- policy-denial drift
- fraud/risk drift
- conversion drift
- cost drift
- support-resolution drift

---

# 31. Agent Sandbox

The sandbox provides a safe environment for onboarding new agents, integrations and model versions.

## 31.1 Sandbox capabilities

- synthetic customers
- synthetic merchants
- synthetic catalog
- synthetic promotions
- simulated shipping
- simulated risk decisions
- simulated payments
- no production payment execution
- isolated credentials
- rate-limited tools
- trace collection
- replay
- evaluation dataset execution

## 31.2 Sandbox workflow

```text
register agent
    ↓
capability handshake
    ↓
credential issuance
    ↓
connect to sandbox merchant
    ↓
run conformance suite
    ↓
run security suite
    ↓
run commerce scenario suite
    ↓
trust/reputation initialization
    ↓
approval
    ↓
production access
```

## 31.3 Sandbox permissions

Default sandbox permissions should be broader for testing but must still exclude:

- real payments
- real customer data
- unrestricted external network calls
- production credentials
- production merchant mutation

---

# 32. Trust, Reputation and Agent Access Control

Trust is a platform subsystem.

## 32.1 Trust graph

```text
Customer ───── trusts/delegates ─────► Agent
   │                                      │
   │                                      │
   └──────── transaction with ───────► Merchant
                                          │
                                          │
                                     platform trust
```

## 32.2 Trust decisions

Trust should combine:

```text
identity
+ authentication
+ delegation
+ capability support
+ reputation
+ risk
+ transaction history
+ merchant/customer policy
```

## 32.3 Agent access tiers

```text
PUBLIC_DISCOVERY
AUTHENTICATED_BROWSE
CUSTOMER_LINKED
TRANSACTION_CAPABLE
HIGH_VALUE_TRANSACTION
SENSITIVE_SUPPORT
```

Higher tiers require stronger trust and authorization.

---

# 33. Merchant Console

The merchant console becomes an operating system for agentic commerce.

## 33.1 Core areas

### Overview

- GMV
- agent-assisted revenue
- conversion
- AOV
- refunds
- returns
- support cases
- risk events

### Agent activity

- active sessions
- agent runs
- tool calls
- escalations
- failures
- blocked actions

### Customers

- customer profiles
- linked agents
- delegations
- orders
- cases
- trust/risk indicators

### Commerce

- catalog
- search quality
- recommendations
- carts
- checkouts
- orders
- promotions

### Trust and safety

- policy decisions
- fraud/risk events
- agent reputation
- denied actions
- delegation changes

### Operations

- event bus health
- webhook health
- connector health
- payment health
- agent runtime health

### Agent evaluation

- versions
- evaluation runs
- scenario results
- regressions
- deployment gates

## 33.2 Merchant controls

Merchants should be able to configure:

- agent capabilities
- allowed protocols
- allowed operations
- negotiation policies
- promotions
- customer-service permissions
- refund thresholds
- escalation thresholds
- risk rules
- shipping methods
- supported markets

---

# 34. Analytics Platform

Analytics should unify commerce and agent behavior without mixing transactional truth with analytical computation.

## 34.1 Event-driven analytics

```text
commerce events
agent events
support events
risk events
payment events
shipping events
        ↓
analytics ingestion
        ↓
modeled datasets
        ↓
metrics / dashboards / recommendations
```

## 34.2 Core metrics

### Commerce

- GMV
- net revenue
- AOV
- conversion
- checkout completion
- cart abandonment

### Agentic commerce

- agent-originated sessions
- agent-assisted conversion
- external agent acceptance rate
- capability negotiation success
- agent checkout completion

### Revenue optimization

- promotion lift
- cross-sell rate
- upsell rate
- bundle performance
- negotiation win rate
- discount leakage

### Customer

- repeat purchase
- return rate
- refund rate
- support resolution
- customer satisfaction proxy

### Trust/safety

- fraud rate
- risk escalation rate
- policy blocks
- authorization failures
- account/agent abuse attempts

---

# 35. Notifications and Communication

A notification service should be event-driven.

Supported channels can include:

```text
email
in-app
webhook
merchant dashboard
agent callback
```

Events include:

- checkout requires customer review
- payment success/failure
- order status change
- shipping update
- return status
- refund status
- support escalation
- fraud/risk escalation

Use an outbox/event consumer rather than sending messages inside core database transactions.

---

# 36. Webhooks and Integrations

## 36.1 Inbound webhooks

Examples:

```text
payment provider
shipping provider
merchant commerce system
CRM
ERP/OMS
```

All inbound webhooks require:

- signature verification where supported
- idempotency
- source identification
- schema validation
- timestamp/replay protection
- event version handling
- state-transition validation

## 36.2 Outbound webhooks

Merchants and agent platforms should be able to subscribe to normalized events.

Examples:

```text
cart.updated
checkout.completed
order.created
order.paid
order.shipped
order.delivered
return.created
refund.completed
support.case.updated
agent.run.completed
risk.action_taken
```

---

# 37. Security Architecture

Security must assume agents can be compromised, misconfigured, or tricked.

## 37.1 Identity security

- short-lived credentials where possible
- key rotation
- revocation
- scoped tokens
- secret management
- signed requests where supported
- OAuth for delegated identity flows

## 37.2 Tenant isolation

Every request resolves:

```text
tenant_id
merchant_id
customer_id
agent_id
```

Authorization must be evaluated before domain access.

## 37.3 Database security

For Supabase/Postgres:

- server-side privileged access only for commerce mutations
- strict row-level security where applicable
- no browser access to sensitive transaction tables
- service-role keys never exposed to the client
- audit/event tables protected from direct modification

## 37.4 Data minimization

Agents receive only the minimum context required by their current task.

---

# 38. Core Data Model

A conceptual relational model:

```text
tenants
organizations
merchants
merchant_verifications
merchant_capabilities
merchant_policies
merchant_connectors

customers
customer_identities
customer_sessions
customer_preferences
customer_addresses

agents
agent_credentials
agent_capabilities
agent_reputations
agent_sessions
agent_delegations
agent_trust_events

products
product_variants
inventory_snapshots
catalog_documents
search_documents
recommendation_edges

price_rules
promotion_campaigns
promotion_rules
promotion_redemptions

carts
cart_items
quotes
quote_items
checkouts
checkout_events

shipping_methods
shipping_quotes
fulfillments
tracking_events

orders
order_items
returns
exchanges
refund_requests
refunds

payment_intents
payments
payment_events

risk_cases
risk_decisions
fraud_events
policy_decisions
authorization_decisions

support_cases
support_messages
support_actions

platform_events
outbox_events
webhook_deliveries

agent_runs
agent_spans
model_calls
tool_calls
evaluation_suites
evaluation_runs
evaluation_cases
evaluation_results

ledger_events
analytics_events
notifications
```

---

# 39. Important State Machines

## 39.1 Agent session

```text
CREATED
  ↓
AUTHENTICATED
  ↓
CAPABILITIES_NEGOTIATED
  ↓
ACTIVE
  ↓
COMPLETED / REVOKED / EXPIRED
```

## 39.2 Cart

```text
ACTIVE
  ↓
CHECKOUT_STARTED
  ↓
CONVERTED / EXPIRED / ABANDONED
```

## 39.3 Checkout

```text
CREATED
  ↓
VALIDATED
  ↓
PRICED
  ↓
RISK_REVIEW
  ↓
AUTHORIZED
  ↓
PAYMENT_PENDING
  ↓
COMPLETED
```

Failure states:

```text
REJECTED
EXPIRED
CANCELLED
PAYMENT_FAILED
```

## 39.4 Order

```text
CREATED
  ↓
PAYMENT_CONFIRMED
  ↓
FULFILLMENT_PENDING
  ↓
SHIPPED
  ↓
DELIVERED
```

Post-purchase:

```text
RETURN_REQUESTED
RETURNED
REFUND_PENDING
REFUNDED
CANCELLED
```

## 39.5 Support case

```text
OPEN
  ↓
IN_PROGRESS
  ├── RESOLVED
  ├── ESCALATED
  └── WAITING_FOR_CUSTOMER
```

---

# 40. Canonical Transaction Flow

The platform's main end-to-end commerce flow is:

```text
1. External agent discovers merchant
2. Merchant identity is verified / inspected
3. Protocol and capability profiles are negotiated
4. Agent authenticates
5. Customer identity is linked when needed
6. Customer delegation is resolved
7. Product search is executed
8. Recommendation service ranks relevant options
9. Seller Agent explains options
10. Customer/agent creates cart
11. Price service calculates authoritative totals
12. Promotion engine evaluates eligible offers
13. Shipping service provides valid options
14. Tax service calculates tax
15. Optional negotiation occurs within policy
16. Checkout session is created
17. Risk/fraud evaluates transaction
18. Authorization service checks delegation/mandate
19. Customer/human approval is requested when required
20. Payment orchestrator executes provider payment
21. Verified webhook reconciles payment
22. Order is committed
23. Basic fulfillment/shipping begins
24. Events are emitted
25. Ledger records material evidence
26. Analytics update
27. Customer Service Agent can manage post-purchase support
28. Trust/reputation signals update
```

---

# 41. Key Failure Scenarios

Failure handling is part of the architecture.

## 41.1 Stale cart

```text
cart version mismatch
→ re-read authoritative cart
→ recalculate price
→ require reauthorization if material
```

## 41.2 Promotion expires during checkout

```text
promotion invalid
→ remove/reprice
→ surface changed total
→ require approval if authority is exceeded
```

## 41. Inventory changes

```text
item unavailable
→ revalidation failure
→ recommend alternatives
→ preserve cart where possible
```

## 41. Payment failure

```text
provider failure
→ classify
→ retry only when safe/idempotent
→ otherwise mark payment failed
→ emit event
→ ledger evidence
→ notify customer
```

## 41.3 Delegation expires

```text
delegation expired
→ reject high-risk action
→ request fresh authorization
```

## 41.4 Agent credential compromise

```text
risk/anomaly detected
→ revoke credential
→ terminate active sessions
→ block sensitive operations
→ create security event
→ recalculate agent reputation
```

## 41.5 Fraud escalation

```text
risk score high
→ REQUIRE_CUSTOMER / REQUIRE_HUMAN / BLOCK
→ no payment execution until cleared
```

---

# 42. API Design

The canonical API should be resource- and command-oriented.

## Identity

```http
POST /v1/identity/link
POST /v1/identity/sessions
GET  /v1/identity/me
```

## Agent

```http
POST /v1/agents/register
GET  /v1/agents/{id}
GET  /v1/agents/{id}/capabilities
POST /v1/agents/{id}/credentials/rotate
GET  /v1/agents/{id}/reputation
```

## Delegation

```http
POST /v1/delegations
GET  /v1/delegations/{id}
POST /v1/delegations/{id}/revoke
```

## Catalog/Search

```http
POST /v1/catalog/search
GET  /v1/catalog/products/{id}
POST /v1/recommendations
```

## Cart/Checkout

```http
POST /v1/carts
GET  /v1/carts/{id}
POST /v1/carts/{id}/items
PATCH /v1/carts/{id}/items/{item_id}
POST /v1/checkouts
GET  /v1/checkouts/{id}
POST /v1/checkouts/{id}/authorize
POST /v1/checkouts/{id}/complete
```

## Promotions

```http
POST /v1/promotions/evaluate
GET  /v1/promotions/{id}
POST /v1/promotions/redemptions/validate
```

## Orders

```http
GET  /v1/orders/{id}
GET  /v1/orders/{id}/timeline
POST /v1/orders/{id}/cancel-request
```

## Shipping

```http
POST /v1/shipping/quote
GET  /v1/shipping/{tracking_id}
```

## Support

```http
POST /v1/support/cases
GET  /v1/support/cases/{id}
POST /v1/support/cases/{id}/messages
POST /v1/support/cases/{id}/escalate
```

## Returns/Refunds

```http
POST /v1/returns
POST /v1/exchanges
POST /v1/refunds/requests
GET  /v1/refunds/{id}
```

## Events

```http
POST /v1/webhooks/{provider}
POST /v1/events/subscriptions
GET  /v1/events/{id}
```

---

# 43. Repository Architecture

A clean monorepo structure:

```text
sellable/
│
├── apps/
│   └── merchant-console/
│
├── services/
│   ├── api-gateway/
│   ├── protocol-gateway/
│   ├── identity/
│   ├── delegation/
│   ├── merchant-onboarding/
│   ├── catalog/
│   ├── search/
│   ├── recommendations/
│   ├── pricing/
│   ├── promotions/
│   ├── cart/
│   ├── checkout/
│   ├── tax/
│   ├── shipping/
│   ├── orders/
│   ├── returns/
│   ├── refunds/
│   ├── payment/
│   ├── risk/
│   ├── fraud/
│   ├── trust/
│   ├── support/
│   ├── event-bus/
│   ├── analytics/
│   ├── observability/
│   └── evaluation/
│
├── agents/
│   ├── seller/
│   └── customer-service/
│
├── protocols/
│   ├── ucp/
│   ├── mcp/
│   ├── a2a/
│   └── rest/
│
├── adapters/
│   ├── payments/
│   │   └── razorpay/
│   ├── commerce/
│   ├── shipping/
│   └── identity/
│
├── packages/
│   ├── domain-models/
│   ├── authorization/
│   ├── guardrails/
│   ├── events/
│   ├── telemetry/
│   └── protocol-types/
│
├── evals/
│   ├── datasets/
│   ├── scenarios/
│   ├── safety/
│   └── regression/
│
├── infra/
├── migrations/
└── docs/
```

The exact service decomposition can remain modular-monolith first and split services only when operationally justified.

---

# 44. Technology Stack

| Layer | Preferred choice | Role |
|---|---|---|
| Backend | FastAPI / Python | Canonical API and domain services |
| Agent runtime | LangGraph | Stateful bounded agent execution |
| Frontend | Next.js + TypeScript | Merchant console and customer-facing surfaces |
| Database | PostgreSQL / Supabase | Transactional system of record |
| Vector search | pgvector initially | Semantic catalog/recommendation retrieval |
| Cache/queues | Redis initially | Cache, short-lived state, rate limiting, background jobs where appropriate |
| Eventing | Outbox + Redis Streams/Kafka-compatible bus | Durable asynchronous events |
| Payments | Provider adapter; Razorpay first | Payment orchestration |
| Observability | OpenTelemetry | traces, metrics, correlation |
| Logs | structured JSON logs | operational debugging |
| Evaluation | pytest + scenario runner + LLM judges where useful | deterministic + model-assisted evals |
| Secrets | managed secrets / environment injection | credential protection |
| Storage | object storage when needed | exports, large artifacts, evaluation assets |

Do not introduce distributed infrastructure merely because the architecture contains multiple logical domains. A modular monolith is a valid first deployment as long as boundaries are explicit.

---

# 45. Non-Negotiable Safety Invariants

These should be executable tests.

## Commerce

```text
No invented SKU can reach an order.
No stale price can silently become authoritative.
No promotion can be applied outside eligibility.
No inventory claim comes from model memory.
No order exceeds merchant/customer authorization.
```

## Authorization

```text
No sensitive action without valid identity.
No delegated action without valid delegation.
No payment without transaction-bound authorization.
Revoked delegation invalidates future actions.
Expired authorization cannot execute.
```

## Agent

```text
Agents cannot change policies.
Agents cannot grant themselves scopes.
Agents cannot execute arbitrary network requests.
Agents cannot directly mutate the database.
Agents cannot mark payments successful.
Agents cannot bypass fraud/risk decisions.
Agents cannot access cross-tenant data.
```

## Payment

```text
Payment amount must equal authorized amount.
Currency must match.
Payee must match.
Idempotency key is mandatory.
Provider webhooks must be verified.
Unknown provider events must not mutate state.
```

## Support

```text
Customer Service Agent cannot refund beyond authority.
Customer Service Agent cannot reveal another customer's data.
Account security changes require appropriate authentication.
Policy exceptions require escalation.
```

---

# 46. Platform Operations and Reliability

## 46.1 Required platform concerns

- configuration management
- feature flags
- secrets rotation
- database migrations
- background workers
- dead-letter queues
- idempotency store
- rate-limit store
- request timeouts
- circuit breakers for provider integrations
- health checks
- readiness checks
- backup/restore
- incident logs

## 46.2 Reliability boundaries

External dependencies must be isolated behind adapters and timeouts.

Examples:

```text
Payment provider unavailable
→ checkout remains pending/fails safely

Shipping provider unavailable
→ shipping estimate becomes unavailable, not fabricated

Recommendation engine unavailable
→ transaction remains usable with search fallback

LLM provider unavailable
→ deterministic commerce operations remain available
```

The platform must degrade without allowing the LLM to become the emergency source of truth.

---

# 47. Merchant and Platform Billing

A complete SaaS platform also needs a commercial control plane.

Conceptual capabilities:

- merchant plan
- API usage
- agent runs
- model usage
- event usage
- transaction usage
- connector usage
- quotas
- billing status
- invoice references

This subsystem is not required for the first commerce implementation but belongs in the platform architecture.

---

# 48. Platform Administration

Platform administrators need controlled access to:

- merchants
- agents
- credentials
- trust/reputation
- policy incidents
- fraud incidents
- system health
- evaluation runs
- protocol versions
- connector status
- tenant configuration

Administrative actions must be audited just like agent actions.

---

# 49. Implementation Priorities

The platform should be built in layers.

## Phase 1 — Foundation

```text
Postgres / Supabase
FastAPI
multi-tenancy
identity
merchant onboarding
agent registry
policy framework
audit model
idempotency
structured events
```

## Phase 2 — Core Commerce

```text
catalog
search
recommendations
pricing
promotions
cart
checkout
orders
shipping
returns/refunds
```

## Phase 3 — Trust and Authorization

```text
delegation
scopes
authorization service
agent trust
agent reputation
risk/fraud
human escalation
```

## Phase 4 — Agents

```text
Seller Agent
Customer Service Agent
agent tools
agent guardrails
agent runtime
model gateway
```

## Phase 5 — Protocol Interoperability

```text
REST
MCP
A2A
UCP adapter
capability negotiation
identity linking
protocol conformance tests
```

## Phase 6 — Event + Operations Layer

```text
transactional outbox
event bus
notifications
webhook subscriptions
OpenTelemetry
analytics
merchant observability
```

## Phase 7 — Agent Evaluation + Sandbox

```text
sandbox
scenario datasets
automated evaluation
adversarial tests
regression gates
agent version release workflow
```

## Phase 8 — Connectors and Ecosystem

```text
commerce connectors
ERP/CRM connectors
shipping adapters
more payment providers
external agent integrations
```

---

# 50. What Should Stay Basic

Some layers are intentionally not the main product surface.

## Basic fulfillment

Keep only enough to represent:

```text
shipping method
shipping cost
ETA
tracking reference
shipping events
```

Do not build a warehouse or carrier-optimization suite.

## Basic platform billing

Model it, but do not prioritize the billing UI over commerce functionality.

## Basic connector framework

Design adapters early, but implement only the connectors actually needed.

---

# 51. What Must Be Deep and Complete

The following are core differentiators and should receive the most engineering depth:

```text
1. Seller Agent
2. Customer Service Agent
3. Agent Identity
4. Customer Identity Linking
5. Permission / Delegation
6. Capability Discovery and Negotiation
7. Protocol Interoperability
8. Guardrails
9. Fraud / Risk
10. Agent Trust / Reputation
11. Cart / Checkout
12. Search / Recommendation
13. Promotions
14. Event Bus
15. Agent Observability
16. Agent Evaluation
17. Audit Ledger
18. Deterministic Commerce Core
```

---

# 52. Final Architecture Position

SELLABLE is best understood as:

> **An agentic commerce infrastructure platform that gives merchants a standardized, trusted interface for AI-driven discovery, selling, checkout, payments, support, and post-purchase interactions—while preserving deterministic control over commerce state, permissions, risk, money, and customer data.**

The architecture is deliberately centered on one principle:

```text
                     INTELLIGENCE
                          │
          ┌───────────────┴────────────────┐
          │                                │
   Seller Agent                    Customer Service Agent
          │                                │
          └───────────────┬────────────────┘
                          │
                  Guarded Tool Layer
                          │
          ┌───────────────┼────────────────────┐
          │               │                    │
       Identity        Delegation          Capability
        + Trust         + Auth             Negotiation
          │               │                    │
          └───────────────┼────────────────────┘
                          │
                   Commerce Core
                          │
       ┌──────────────────┼────────────────────┐
       │                  │                    │
     Search          Cart/Checkout       Pricing/Promotions
       │                  │                    │
       └──────────────────┼────────────────────┘
                          │
                   Risk + Fraud
                          │
                   Authorization
                          │
                   Payment Rail
                          │
                 Order + Shipping
                          │
                    Customer Support

    ───────────────────────────────────────────────────────
      Event Bus · Observability · Evaluation · Ledger
    ───────────────────────────────────────────────────────
```

The **Seller Agent and Customer Service Agent are intelligence layers, not the commerce platform itself**.

The **external customer agent is an interoperable client**, not a dependency embedded inside SELLABLE.

The **Commerce Core, Authorization, Risk, Event, Observability and Evaluation systems are what make agentic commerce reliable enough to operate as infrastructure rather than as a chatbot.**

---

# 53. Reference Protocol and Architecture Notes

The architecture uses current protocol concepts as interoperability targets, not as claims of certification.

### Universal Commerce Protocol (UCP)

Current UCP specifications define machine-readable merchant capability discovery and negotiation and standardized commerce capabilities such as Cart, Checkout, Identity Linking and Order. UCP supports multiple transport/integration patterns including REST, MCP and A2A. citeturn525419search1turn525419search9

### Identity Linking

UCP's current identity-linking capability separates public or agent-authenticated access from user-authenticated access and uses OAuth 2.0 in the current specification. SELLABLE's identity/delegation architecture should preserve the same separation: capability availability is not identical to customer identity authority. citeturn525419search2

### AP2-style authorization

Google's current AP2 materials describe explicit authorization artifacts and guardrails that bind agent transactions to user intent and payment context. SELLABLE should maintain the same conceptual separation between customer intent, merchant offer, authorization, and payment execution even when the implementation uses SELLABLE-native authorization records and provider adapters. citeturn592286search3turn592286search1

### Agentic commerce trust

Current agentic-commerce guidance emphasizes discovery, fraud protection, checkout, and payment as distinct platform concerns, along with structured merchant information such as product data, fulfillment/return information and contact/trust signals. SELLABLE therefore models discovery, risk, checkout, payments, shipping and support as separate but connected domains. citeturn592286search2turn592286search6

---

# 54. Architecture Checklist

Before calling the platform architecture complete, the implementation should answer “yes” to the following.

```text
[ ] No Buyer Agent is required inside SELLABLE.
[ ] External agents can discover SELLABLE merchants.
[ ] Merchant identity is verifiable.
[ ] External agent identity is verifiable.
[ ] Customer identity is separate from agent identity.
[ ] Customers can delegate bounded permissions to agents.
[ ] Delegations expire and can be revoked.
[ ] Agent capabilities are discoverable and negotiated.
[ ] Multiple protocols map to one canonical commerce API.
[ ] Seller Agent is backed by deterministic commerce tools.
[ ] Customer Service Agent is backed by deterministic support tools.
[ ] All agent actions pass through guardrails.
[ ] Search is service-backed, not LLM-memory-backed.
[ ] Recommendations are service-backed, not invented by the LLM.
[ ] Pricing is deterministic.
[ ] Promotions are deterministic and auditable.
[ ] Cart is separate from quote and order.
[ ] Checkout is a first-class state machine.
[ ] Tax is deterministic.
[ ] Shipping is modeled but intentionally basic.
[ ] Fraud and risk are separate from merchant policy.
[ ] Payment is provider-independent behind an adapter.
[ ] Event Bus is separate from the audit ledger.
[ ] Every material action is traceable.
[ ] Agent runs have complete observability.
[ ] Agent/model/tool versions are recorded.
[ ] Agent evaluations run before release.
[ ] Adversarial safety tests exist.
[ ] Sandbox can test agents without real money or production data.
[ ] Merchant onboarding validates readiness.
[ ] Merchant policies are configurable without code changes.
[ ] Trust/reputation signals are available to risk/access decisions.
[ ] Analytics consume domain and agent events.
[ ] Customer Service Agent can hand off to human support.
[ ] Basic post-purchase support works independently of the Seller Agent.
[ ] The platform can degrade safely when LLMs or external providers fail.
```

---

# 55. Summary

SELLABLE should be designed as a merchant-side agentic commerce infrastructure layer, with external customer agents treated as interoperable clients rather than as a core internal component.

The platform should instead be built as a **merchant-side agentic commerce infrastructure layer** with:

```text
Seller Agent
Customer Service Agent
External Agent Gateway
Identity + Trust
Permission + Delegation
Capability Negotiation
Protocol Interoperability
Merchant Onboarding
Catalog + Search
Recommendations
Pricing + Promotions
Cart + Checkout
Tax + Shipping
Risk + Fraud
Payment Orchestration
Orders + Basic Fulfillment
Returns + Refunds
Event Bus
Agent Guardrails
Agent Observability
Agent Evaluation
Agent Sandbox
Analytics
Audit Ledger
Merchant Operations
```

The core architectural boundary is:

> **Agents decide how to act; SELLABLE decides whether the action is authorized, safe, valid, and executable.**

That boundary should remain true regardless of which agent framework, model provider, protocol, merchant backend, payment provider, or external AI platform connects to SELLABLE.
