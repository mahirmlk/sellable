# SELLABLE — AI Buyer Workflow

**Purpose:** Define how the AI Buyer layer, LLM/model provider, backend services, and Next.js merchant frontend work together as one system.

This document is the implementation-level workflow for the AI Buyer side of SELLABLE. It complements `ARCHITECTURE.md` and `PLAN.md` and should be treated as the source of truth for the agent execution flow.

---

## 1. Core Principle

The system is split into four responsibilities:

```text
LLM / Model
    = reasoning and language

LangGraph
    = agent orchestration and state

Backend / Commerce Core
    = tools, business rules, authorization, money, persistence

Next.js
    = merchant visibility and human control
```

The model is **not** the payment authority.

The agent can propose actions, choose tools, negotiate, and explain. The deterministic backend validates and executes the actions that are actually allowed.

The central rule is:

```text
LLM proposes
    ↓
Tool / command
    ↓
Deterministic backend validation
    ↓
Policy / consent / state checks
    ↓
Execution
    ↓
Ledger event
    ↓
Frontend observes the result
```

---

# 2. What the AI Buyer Layer Is

The AI Buyer is a reference autonomous purchasing agent.

Its purpose is to prove that an external AI buyer can:

1. Discover the merchant.
2. Understand the merchant's machine-readable catalog.
3. Express a purchase mission.
4. Research available products.
5. Request a quote.
6. Negotiate within the merchant's constraints.
7. Accept or reject an upsell.
8. Respect its own buyer-side budget.
9. Obtain transaction-specific consent.
10. Pay through the merchant's supported payment flow.
11. Verify the resulting order/payment state.
12. Report the completed transaction.

The architecture defines the buyer workflow as:

```text
DISCOVER
→ RESEARCH
→ RFP
→ NEGOTIATE
→ CONSENT
→ PAY
→ VERIFY
→ REPORT
```

The buyer agent also maintains its own hard budget guard and can escalate to its human when the mission exceeds that budget.

---

# 3. The AI Buyer Is a Backend Component

The AI Buyer should run on the backend, not inside the Next.js browser application.

Recommended placement:

```text
agents/
└── buyer/
    ├── agent.py
    ├── graph.py
    ├── state.py
    ├── prompts.py
    ├── tools.py
    └── policies.py
```

The browser should never contain:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
OPENROUTER_API_KEY
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
buyer signing secrets
```

The frontend communicates with the backend through API/SSE/WebSocket interfaces.

---

# 4. Full System

```text
                          ┌──────────────────────┐
                          │      Next.js         │
                          │  Merchant Console    │
                          └──────────┬───────────┘
                                     │
                              REST / SSE / WS
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │       FastAPI        │
                          │    Backend API       │
                          └──────────┬───────────┘
                                     │
             ┌───────────────────────┼───────────────────────┐
             │                       │                       │
             ▼                       ▼                       ▼
      ┌─────────────┐        ┌─────────────┐        ┌─────────────┐
      │ Buyer Agent │        │Seller Agent │        │   Gateway   │
      │  LangGraph  │        │  LangGraph  │        │ Discovery / │
      └──────┬──────┘        └──────┬──────┘        │   A2A API   │
             │                      │               └──────┬──────┘
             │                      │                      │
             └──────────────┬───────┴──────────────────────┘
                            ▼
                      ┌──────────────┐
                      │ LLM Provider │
                      │ / Model      │
                      └──────┬───────┘
                             │
                      tool selection
                             │
                             ▼
                    ┌──────────────────┐
                    │  Commerce Core   │
                    │                  │
                    │ Catalog          │
                    │ Quotes           │
                    │ Policy           │
                    │ Orders           │
                    │ Consent          │
                    │ Refunds          │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Payment Adapter  │
                    │     Razorpay     │
                    └────────┬─────────┘
                             │
                             ▼
                        Razorpay
                             │
                          webhook
                             │
                             ▼
                      ┌─────────────┐
                      │ XAI Ledger  │
                      └──────┬──────┘
                             │
                             ▼
                      Next.js replay
```

---

# 5. LLM Provider Independence

The architecture must not depend on one specific model vendor.

You can use **any model/provider** that supports the capabilities required by your agent implementation.

Examples include:

```text
OpenAI
Anthropic
Google
DeepSeek
GLM / Zhipu
OpenRouter
other compatible providers
```

The application should never hardcode a provider assumption into the business logic.

Use an abstraction:

```python
llm = get_llm()
```

rather than:

```python
openai_client = ...
```

inside agent/business modules.

Recommended structure:

```text
agents/
└── llm/
    ├── factory.py
    ├── config.py
    └── adapters/
        ├── openai.py
        ├── anthropic.py
        ├── openrouter.py
        └── ...
```

The exact provider list is an implementation choice. The critical requirement is provider/model interchangeability.

---

# 6. Model Factory

The factory should choose a provider/model from configuration.

Example:

```env
LLM_PROVIDER=openrouter
LLM_MODEL=<chosen-model>
LLM_TEMPERATURE=0
```

or:

```env
LLM_PROVIDER=openai
LLM_MODEL=<chosen-model>
```

or:

```env
LLM_PROVIDER=anthropic
LLM_MODEL=<chosen-model>
```

The rest of the agent should use:

```python
llm = get_llm()
```

and should not care which provider is active.

---

# 7. What the LLM Does

The LLM is responsible for:

- understanding natural-language intent
- selecting relevant tools
- interpreting tool results
- generating candidate product selections
- proposing negotiation actions
- choosing among policy-approved strategies
- proposing contextual upsells
- communicating decisions naturally
- producing concise decision explanations

The LLM is not responsible for:

- inventing product data
- determining actual prices
- authorizing money movement
- bypassing policies
- deciding that consent is valid
- marking payments captured
- changing the database directly
- calling Razorpay with secret credentials
- overriding buyer budget constraints
- overriding merchant floor prices

---

# 8. LangGraph's Role

LangGraph is the orchestration/state layer.

Conceptually:

```text
LLM
  +
State
  +
Tools
  +
Transitions
  =
Buyer Agent
```

The graph controls where the agent is in the purchasing lifecycle.

Example:

```text
START
  ↓
DISCOVER
  ↓
RESEARCH
  ↓
REQUEST_QUOTE
  ↓
NEGOTIATE
  ↓
DECISION
 ┌┴───────────────┐
 ▼                ▼
ACCEPT           WALK_AWAY
 │
 ▼
UPSELL_DECISION
 │
 ▼
CONSENT
 │
 ▼
PAY
 │
 ▼
VERIFY
 │
 ▼
REPORT
 │
END
```

Some states can loop, especially research and negotiation.

---

# 9. Buyer Agent State

Maintain structured state rather than relying only on chat messages.

Example:

```python
class BuyerState:
    mission: str
    merchant_id: str | None
    buyer_agent_id: str
    budget_ceiling_paise: int
    allowed_categories: list[str]

    discovered_products: list
    selected_items: list
    quote_id: str | None

    negotiation_round: int
    max_negotiation_rounds: int

    upsell_offered: bool
    upsell_accepted: bool

    consent_id: str | None
    payment_id: str | None
    order_id: str | None

    status: str
    trace_id: str
```

The exact implementation can differ, but critical financial constraints should be explicit fields.

---

# 10. Buyer-Side Policy

The buyer agent has its own rules.

Example:

```text
BUYER_BUDGET = ₹6,000
ALLOWED_CATEGORIES = ["desk", "accessories"]
MANDATE_EXPIRY = configured
MAX_ORDER_VALUE = ₹6,000
```

The buyer's hard cap must be enforced independently from the merchant's policy.

Therefore:

```text
Buyer Policy
        AND
Merchant Policy
        AND
Consent
```

must all be satisfied before payment.

A cart can satisfy merchant policy and still be rejected because it exceeds the buyer's authorized amount.

---

# 11. Step 1 — DISCOVER

The buyer begins with a mission.

Example:

```text
Find a desk setup under ₹6,000.
Prefer one main desk and one complementary accessory.
Do not exceed my authorized budget.
```

The Buyer Agent identifies the merchant endpoint.

Discovery can use:

```http
GET /.well-known/agents.json
GET /llms.txt
GET /catalog.ai.json
```

The gateway exposes:

- merchant identity
- capabilities
- supported tools
- authentication requirements
- machine-readable catalog information

The Buyer Agent should not need a human to explain the merchant.

---

# 12. Step 2 — RESEARCH

The buyer reads the available merchant information and calls tools.

Example:

```text
catalog.search(
    query="desk",
    filters={
        "category": "desk"
    }
)
```

The backend returns actual products:

```json
{
  "sku": "DESK-01",
  "name": "Standing Desk",
  "price_paise": 550000,
  "stock": 12
}
```

The agent is allowed to reason over this data.

It must not invent:

```text
SKU
price
stock
discount
```

that did not come from the tool/backend.

---

# 13. Step 3 — REQUEST / RFP

The buyer turns its mission into a structured request.

Example:

```json
{
  "items": [
    {
      "sku": "DESK-01",
      "quantity": 1
    }
  ],
  "constraints": {
    "max_total_paise": 600000,
    "categories": ["desk", "accessories"]
  }
}
```

The gateway passes the request into the Seller Agent / Commerce Core flow.

---

# 14. Step 4 — QUOTE

The seller system generates a quote.

Flow:

```text
Buyer Agent
    ↓
Gateway
    ↓
quotes.create
    ↓
Commerce Core
    ↓
Pricing + policy validation
    ↓
Quote
```

Example:

```text
List price        ₹5,500
Negotiated price  ₹5,100
Possible accessory ₹100
Total              ₹5,200
```

A quote is data, not an LLM-generated financial claim.

The canonical amount comes from the backend.

---

# 15. Step 5 — NEGOTIATION

The buyer may make a counter-offer.

Example:

```text
Buyer:
"Can you do ₹4,700?"
```

The Buyer Agent may call:

```text
quotes.negotiate(
    quote_id="qt_123",
    counter_paise=470000
)
```

The Seller Agent may reason about the response, but the merchant Policy Engine checks the actual financial limits.

Example:

```text
Merchant floor = ₹4,900

₹4,700
   ↓
Policy Engine
   ↓
DENY / COUNTER
```

The seller agent then communicates:

```text
"I can't offer ₹4,700,
but I can offer ₹4,950."
```

The LLM chooses the conversational response; the backend defines the allowed financial boundary.

---

# 16. Bounded Negotiation

Negotiation must have a maximum number of rounds.

Example:

```text
MAX_NEGOTIATION_ROUNDS = 5
```

At each round:

```text
buyer proposal
    ↓
seller agent
    ↓
policy validation
    ↓
allowed response space
    ↓
LLM selects response
```

The LLM can choose:

```text
ACCEPT
COUNTER
WALK_AWAY
```

inside the allowed space.

If the floor is reached or the round limit is reached:

```text
WALK_AWAY
```

and the transaction is safely terminated.

A walk-away can generate a saved-deal analytics event.

---

# 17. Step 6 — UPSELL

The Seller Agent may suggest one bounded contextual upsell.

Example:

```text
Selected:
Standing Desk

Suggested:
Desk Mat

Reason:
Complements the selected desk and fits the configured
merchant upsell policy.
```

Important:

```text
LLM proposes upsell
       ↓
backend verifies SKU
       ↓
backend verifies stock
       ↓
backend verifies price
       ↓
policy checks limit
       ↓
buyer accepts/rejects
```

The buyer must be able to reject the upsell without breaking checkout.

---

# 18. Step 7 — FINAL CART

Once negotiation and upsell are finished, create a locked cart/quote snapshot.

The final cart should contain:

```text
SKU
quantity
unit price
discount
final amount
currency
buyer reference
merchant reference
negotiation round
upsell information
```

The final amount must be calculated by deterministic backend code.

Do not ask the LLM to calculate the payment amount as the source of truth.

---

# 19. Step 8 — BUYER BUDGET CHECK

Before consent:

```text
Cart amount
    ≤
Buyer authorized budget
```

Example:

```text
Cart       ₹5,200
Budget     ₹6,000

✓ PASS
```

If:

```text
Cart       ₹6,400
Budget     ₹6,000
```

the Buyer Agent must stop.

Expected result:

```text
OVER_BUDGET
NO_PAYMENT
LEDGER_EVENT
```

---

# 20. Step 9 — CONSENT

Once the buyer accepts the final transaction:

```text
Buyer Agent
    ↓
consents.request(order)
    ↓
Consent Service
```

The consent artifact should be bound to:

```text
order
amount
payee
purpose
expiry
single-use scope
```

The backend must verify it before creating/advancing the payment operation.

The frontend shows consent metadata, not the secret/token itself.

---

# 21. Step 10 — HUMAN-IN-THE-LOOP

HITL is a merchant-side safety gate.

Example:

```text
HITL_THRESHOLD = ₹2,000
```

If:

```text
Order = ₹5,200
```

the system can produce:

```text
NEEDS_HUMAN_APPROVAL
```

The transaction pauses.

```text
Buyer Agent
    ↓
Seller Agent
    ↓
Commerce Core
    ↓
Policy Engine
    ↓
NEEDS_HUMAN_APPROVAL
    ↓
Approval Queue
    ↓
Merchant Dashboard
```

The merchant can approve or reject.

Only after approval can the transaction continue.

The agent itself cannot approve its own HITL request.

---

# 22. Frontend Approval Flow

Next.js receives:

```text
GET /approvals
```

and displays:

```text
Approval Required

Order: ORD-1028
Buyer: AI Buyer
Amount: ₹5,200

Reason:
ABOVE_HITL_THRESHOLD

Buyer budget:
₹6,000

Merchant floor:
₹4,900

[Reject] [Approve]
```

Clicking Approve calls a backend command:

```http
POST /approvals/ORD-1028/approve
```

The backend performs the actual authorization/state transition.

The browser never edits the order directly.

---

# 23. Step 11 — PAYMENT

After all required conditions pass:

```text
Buyer budget
    ✓

Merchant policy
    ✓

Consent
    ✓

HITL
    ✓ / not required

Cart locked
    ✓
```

the backend may initiate payment.

The Seller Agent does not directly call Razorpay.

Correct:

```text
Seller Agent
    ↓
orders.create
    ↓
Commerce Core
    ↓
Payment Service
    ↓
Razorpay adapter
    ↓
Razorpay
```

The architecture uses Razorpay test mode for the payment rail.

---

# 24. Payment Links vs Orders

Use the appropriate payment mechanism for the surface.

### Human chat checkout

```text
Payment Link
```

because the buyer can click and complete the sandbox payment.

### Headless A2A

```text
Orders API / payment flow
```

because the reference Buyer Agent is demonstrating machine-to-machine commerce.

The payment implementation remains behind the Razorpay adapter.

---

# 25. Step 12 — RAZORPAY WEBHOOK

Payment status should not be trusted solely from the browser.

The authoritative backend flow is:

```text
Razorpay
    ↓
signed webhook
    ↓
FastAPI webhook endpoint
    ↓
signature verification
    ↓
event deduplication
    ↓
order/payment consistency checks
    ↓
state transition
    ↓
ledger event
```

Examples:

```text
payment.captured
payment.failed
order.paid
```

The frontend observes the resulting backend state.

---

# 26. Step 13 — VERIFY

The Buyer Agent verifies the completed order.

Example:

```text
orders.status(order_id)
```

Expected result:

```json
{
  "status": "PAID",
  "amount_paise": 520000,
  "payment_id": "pay_..."
}
```

The buyer must not infer success just because a payment UI closed successfully.

The backend's verified transaction state is the source of truth.

---

# 27. Step 14 — REPORT

The Buyer Agent produces a structured result:

```text
Purchase complete

Merchant:
SELLABLE Demo Store

Order:
ORD-1028

Items:
Standing Desk
Desk Mat

Total:
₹5,200

Payment:
Captured

Trace:
trc_88f2
```

The same transaction remains available to the merchant in the dashboard.

---

# 28. XAI Ledger Flow

Every meaningful action writes an event.

Example:

```text
buyer.intent.created
catalog.searched
product.selected
quote.created
negotiation.countered
upsell.offered
upsell.accepted
policy.checked
consent.requested
consent.approved
order.created
payment.attempted
payment.captured
order.settled
```

A failure produces corresponding events:

```text
payment.attempted
payment.failed
failure.classified
retry.started
retry.failed
order.aborted
```

The same trace ID links the transaction together.

---

# 29. What the Frontend Receives

Next.js should consume backend state and ledger events.

Example:

```text
GET /transactions/:id
GET /transactions/:id/events
GET /approvals
GET /activity
```

For live activity:

```text
FastAPI
   ↓
event stream
   ↓
SSE/WebSocket
   ↓
Next.js
```

The dashboard does not recreate agent behavior; it displays the recorded behavior.

---

# 30. Frontend Representation of the Agent

The dashboard should make agent activity visible.

Example:

```text
SELLER AGENT
Searching catalog

Query:
"desk setup"

3 products returned
```

Then:

```text
BUYER AGENT
Requested quote

Budget:
₹6,000
```

Then:

```text
SELLER AGENT
Countered offer

Proposed:
₹4,950
```

Then:

```text
POLICY ENGINE
✓ ALLOW

Floor:
₹4,900

Buyer budget:
₹6,000
```

Then:

```text
RAZORPAY
✓ PAYMENT CAPTURED

₹5,200

Webhook verified
```

This is the visual bridge between the AI layer and the commerce layer.

---

# 31. Agent Decision vs Backend Decision

This distinction must remain visible in implementation.

Example:

```text
AGENT DECISION

"I should propose the desk mat."
```

Then:

```text
BACKEND VALIDATION

SKU exists       ✓
Stock available  ✓
Upsell allowed   ✓
Price valid      ✓
Session limit    ✓
```

Then:

```text
OUTCOME

Upsell offered
```

The dashboard should not label the LLM as the authority.

---

# 32. Explanation Design

Store concise decision explanations.

Good:

```text
Countered at ₹4,950 because ₹4,700 is below the merchant floor.
```

Good:

```text
Order escalated because the amount exceeds the configured HITL threshold.
```

Good:

```text
Payment was accepted after Razorpay sent a verified payment.captured event.
```

Do not store or display private chain-of-thought.

The explanation layer should answer:

```text
What happened?
Why was it allowed?
Which policy was involved?
What changed?
What was the outcome?
```

---

# 33. Failure Workflow

The AI Buyer must handle a failed payment without crashing.

```text
PAY
 ↓
Razorpay failure
 ↓
payment.failed webhook
 ↓
classify failure
 ↓
ledger event
 ↓
retry allowed?
 ├── YES → one bounded retry
 └── NO  → abort
 ↓
final state
 ↓
REPORT
```

The retry must preserve idempotency guarantees.

The system must not blindly create multiple orders for a single buyer mission.

---

# 34. Duplicate Protection

The payment flow must protect against duplicate delivery and duplicate execution.

Use:

```text
idempotency_key
```

for payment operations.

Use the provider webhook event identifier to deduplicate webhook processing.

Conceptually:

```text
event received
    ↓
already processed?
 ┌──┴───┐
 YES    NO
 ↓       ↓
ignore  process
         ↓
      store event ID
```

This protects the `PAID` state and financial ledger from duplicate provider events.

---

# 35. A2A Sequence

The complete agent-to-agent path is:

```text
Buyer Agent
    │
    │ GET agents.json
    ▼
Agent Gateway
    │
    │ catalog / quote
    ▼
Seller Agent
    │
    │ negotiation
    ▼
Policy Engine
    │
    │ allowed response
    ▼
Seller Agent
    │
    │ counter / accept
    ▼
Buyer Agent
    │
    │ accept quote
    ▼
Consent Service
    │
    │ consent
    ▼
Payment Service
    │
    ▼
Razorpay
    │
    │ webhook
    ▼
Commerce Core
    │
    ▼
XAI Ledger
    │
    ▼
Buyer Agent + Merchant Console
```

---

# 36. Human Chat Sequence

The same Seller Agent can serve a human chat surface.

```text
Human Buyer
    ↓
Next.js / chat surface
    ↓
FastAPI
    ↓
Seller Agent
    ↓
LLM
    ↓
tools
    ↓
Commerce Core
    ↓
Policy
    ↓
Consent
    ↓
Payment
    ↓
Webhook
    ↓
Ledger
    ↓
Next.js receipt/replay
```

The important architectural decision is that the human and A2A surfaces reuse the same underlying Seller Agent tools.

---

# 37. One Seller Agent, Two Transports

Do not implement separate business logic for:

```text
human chat
```

and:

```text
agent-to-agent
```

Instead:

```text
             ┌─────────────────┐
Human Chat → │                 │
             │  Seller Agent   │
A2A Gateway→ │   same tools    │
             │                 │
             └─────────────────┘
```

Different transport.

Same commerce capabilities.

This prevents the A2A and human paths from diverging.

---

# 38. Buyer Agent Can Start Scripted

For early development, the reference Buyer Agent does not need to be fully LLM-driven.

You can start with:

```text
scripted Buyer
    ↓
Gateway
    ↓
Seller Agent
```

This is useful for reliable integration testing.

Once the complete commerce path works, replace the scripted buyer logic with a LangGraph Buyer Agent backed by an LLM.

Recommended progression:

```text
Phase 1
Scripted Buyer

Phase 2
LLM Seller Agent

Phase 3
LLM Buyer Agent

Phase 4
Full A2A demo
```

This keeps the most important payment and safety flows testable before introducing additional model nondeterminism.

---

# 39. Recommended LLM Configuration

For the buildathon demo, prioritize:

```text
tool calling
structured output
low latency
reasonable cost
stable instruction following
provider availability
```

Temperature can be kept low for deterministic behavior.

The exact model is intentionally not fixed.

A model change should require only configuration changes:

```env
LLM_PROVIDER=...
LLM_MODEL=...
```

not rewrites to:

```text
Policy Engine
Commerce Core
Consent
Payments
Ledger
Frontend
```

---

# 40. Agent Tool Boundary

Buyer/Seller agents should interact through typed tools.

Example:

```text
catalog.search
catalog.get
quotes.create
quotes.negotiate
upsell.suggest
consents.request
orders.create
orders.status
refunds.create
```

Tools should expose structured schemas.

For example:

```json
{
  "name": "quotes.negotiate",
  "arguments": {
    "quote_id": "qt_123",
    "counter_offer_paise": 495000
  }
}
```

The backend validates the arguments.

---

# 41. Never Give the Agent Database Access

The agent should not receive:

```text
SQL access
direct Postgres credentials
Razorpay secret
Redis credentials
```

Instead:

```text
Agent
 ↓
typed tool
 ↓
service
 ↓
database
```

This creates a controlled capability boundary.

---

# 42. Never Let the Agent Mutate Financial State Directly

Bad:

```text
LLM → database:
order.status = "PAID"
```

Good:

```text
LLM
 ↓
orders.create
 ↓
Commerce Core
 ↓
consent + policy
 ↓
payment provider
 ↓
verified webhook
 ↓
order state = PAID
```

The final financial state is evidence-based.

---

# 43. Ledger Middleware

Where practical, instrument agent tools so every tool call automatically records:

```text
actor
action
inputs
outputs
trace_id
timestamp
reasoning_summary
policy_refs
```

This should reduce the risk of accidentally creating an un-audited money action.

---

# 44. Trace Propagation

Every transaction should receive a trace ID.

Example:

```text
trc_88f2
```

Propagate it through:

```text
Buyer Agent
Seller Agent
Gateway
Commerce Core
Policy
Consent
Order
Payment
Webhook
Ledger
Frontend
```

Then the frontend can fetch:

```text
GET /traces/trc_88f2
```

to render the full replay.

---

# 45. Frontend State Model

The frontend should derive its state from backend domain status.

Example:

```text
QUOTE
AWAITING_CONSENT
CONSENTED
PAYMENT_PENDING
PAID
PAYMENT_FAILED
DENIED
ABORTED
REFUNDED
```

Do not invent frontend-only payment states that conflict with backend state.

---

# 46. Live Event Flow to Next.js

Example:

```text
Seller Agent
    ↓
ledger event
    ↓
event bus / API
    ↓
SSE
    ↓
Next.js Activity
```

Activity row:

```text
12:42:13
seller_agent
upsell.offered

Desk Mat
₹100

Reason:
Complementary product
```

Then:

```text
12:42:14
policy_engine
ALLOW

Cart:
₹5,200
```

Then:

```text
12:42:25
razorpay
payment.captured

₹5,200
```

---

# 47. Dashboard Views Relevant to AI Buyers

The merchant should have a page showing:

## AI Storefront

```text
Discoverability
● Online

agents.json
Available

catalog.ai.json
Available

Transactional API
Available
```

## Agent Activity

```text
Buyer Agent
Seller Agent
Policy Engine
Payment
```

## Transaction Replay

```text
DISCOVER → RESEARCH → NEGOTIATE
→ CONSENT → PAY → VERIFY → REPORT
```

The frontend is demonstrating the backend agent flow, not implementing it.

---

# 48. Minimum APIs Needed

### Agent discovery

```http
GET /.well-known/agents.json
GET /llms.txt
GET /catalog.ai.json
```

### Buyer-facing agent API

```http
POST /agent/catalog.search
POST /agent/catalog.get
POST /agent/quotes.create
POST /agent/quotes.negotiate
POST /agent/consents.request
POST /agent/orders.create
POST /agent/orders.status
POST /agent/refunds.create
```

### Dashboard

```http
GET /activity
GET /transactions
GET /transactions/:id
GET /transactions/:id/events
GET /approvals
GET /growth
GET /agents/status
```

### Human commands

```http
POST /approvals/:id/approve
POST /approvals/:id/reject
POST /transactions/:id/refund
```

### Payment webhook

```http
POST /webhooks/razorpay
```

---

# 49. Complete Happy Path

This is the workflow that should work before adding advanced features.

```text
MISSION
"I need a desk setup under ₹6,000."
     ↓
BUYER AGENT
     ↓
DISCOVER
agents.json / catalog
     ↓
RESEARCH
catalog.search
     ↓
REQUEST
quotes.create
     ↓
NEGOTIATE
bounded counter-offers
     ↓
UPSELL
optional accessory
     ↓
FINAL CART
backend calculates total
     ↓
BUYER BUDGET
PASS
     ↓
MERCHANT POLICY
PASS
     ↓
CONSENT
single-use
     ↓
HITL
approve if required
     ↓
RAZORPAY
payment
     ↓
WEBHOOK
verified confirmation
     ↓
ORDER
PAID
     ↓
LEDGER
complete trace
     ↓
VERIFY
Buyer Agent confirms
     ↓
REPORT
success
```

---

# 50. Complete Denial Path

```text
Buyer requests ₹4,500
        ↓
Seller Agent proposes/counters
        ↓
Policy Engine
        ↓
BELOW_FLOOR_PRICE
        ↓
DENY
        ↓
NO RAZORPAY CALL
        ↓
LEDGER EVENT
        ↓
Seller Agent explains
        ↓
Buyer Agent decides:
counter / accept allowed price / walk away
```

This is the ideal safety demonstration.

---

# 51. Complete HITL Path

```text
Valid cart
   ↓
Policy Engine
   ↓
amount > HITL threshold
   ↓
NEEDS_HUMAN_APPROVAL
   ↓
Approval Queue
   ↓
Next.js Merchant Dashboard
   ↓
Human approves
   ↓
Consent continues
   ↓
Payment
   ↓
Webhook
   ↓
Ledger
```

---

# 52. Complete Failure Path

```text
Valid cart
   ↓
Policy ALLOW
   ↓
Consent
   ↓
Razorpay
   ↓
payment.failed
   ↓
webhook verification
   ↓
failure classification
   ↓
bounded retry?
   ├── yes → one retry
   └── no  → abort
   ↓
final transaction state
   ↓
ledger
   ↓
Buyer Agent report
   ↓
Next.js replay
```

The failure must never become:

```text
agent crash
infinite retry
duplicate order
duplicate charge
silent failure
```

---

# 53. Definition of Done — AI Buyer Layer

## Agent

- [ ] Buyer Agent runs on backend
- [ ] Seller Agent runs on backend
- [ ] Both are orchestrated with LangGraph or equivalent state orchestration
- [ ] Agents use an LLM through a provider/model abstraction
- [ ] Provider/model can be changed through configuration
- [ ] Tools are structured and typed
- [ ] Agent state is explicit

## Grounding

- [ ] Catalog information comes from tools/backend
- [ ] No hallucinated SKUs
- [ ] No hallucinated prices
- [ ] No hallucinated stock
- [ ] Financial totals come from backend calculations

## Safety

- [ ] Buyer budget enforced
- [ ] Merchant floor enforced
- [ ] Discount cap enforced
- [ ] Category restrictions enforced
- [ ] Negotiation rounds bounded
- [ ] Upsell count bounded
- [ ] HITL threshold enforced
- [ ] Consent single-use
- [ ] Agent cannot directly mutate financial state

## Payment

- [ ] Razorpay Test Mode works
- [ ] Payment is initiated only after required checks
- [ ] Webhook signature verified
- [ ] Duplicate webhook protection exists
- [ ] Idempotency is used
- [ ] Payment state reconciles to the order
- [ ] Payment failure is handled gracefully

## Explainability

- [ ] Buyer actions create ledger events
- [ ] Seller actions create ledger events
- [ ] Policy decisions create ledger events
- [ ] Payment events create ledger events
- [ ] Every money-touching event has an explanation
- [ ] Policy references are stored
- [ ] Trace IDs link the full transaction
- [ ] Frontend can replay the trace

## Frontend

- [ ] Activity shows agent actions
- [ ] Transaction detail shows decision/policy state
- [ ] Approval queue works
- [ ] Payment state is explicit
- [ ] Failure state is explicit
- [ ] Replay shows the complete journey
- [ ] AI Storefront shows merchant discoverability
- [ ] Growth view shows upsell / negotiation outcomes

---

# 54. Final Mental Model

The entire project can be remembered as:

```text
                      INTENT
                        ↓
                  ┌──────────┐
                  │  Buyer   │
                  │  Agent   │
                  └────┬─────┘
                       │
                   discovers
                       ↓
                 Agent Gateway
                       │
                       ↓
                  Seller Agent
                       │
                  LLM reasoning
                       │
                       ▼
              ┌─────────────────┐
              │ Structured Tools │
              └────────┬────────┘
                       │
                       ▼
              Deterministic Core
                       │
             ┌─────────┼─────────┐
             ▼         ▼         ▼
          Catalog    Policy    Consent
                       │
                       ▼
                     Order
                       │
                       ▼
                  Razorpay
                       │
                    webhook
                       ▼
                    Ledger
                       │
                       ▼
                 Next.js UI
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
         Activity   Approval   Replay
```

And the provider/model abstraction sits behind the agent:

```text
                    Agent
                      │
                 get_llm()
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       Provider A  Provider B  Provider C
          │           │           │
       Model A1     Model B1     Model C1
```

Changing the LLM provider or model must **not** change:

```text
Policy Engine
Commerce Core
Consent
Order State Machine
Razorpay Integration
Ledger
Next.js Dashboard
```

Only the model adapter/configuration changes.

---

# 55. The Core Architecture Rule

The strongest way to think about SELLABLE is:

```text
                 LLM
                  │
          "What should I do?"
                  ↓
             LangGraph
                  │
          "Which tool?"
                  ↓
              Tool API
                  │
          "Is this allowed?"
                  ↓
          Policy / Commerce
                  │
           "Can this execute?"
                  ↓
          Consent / Payment
                  │
          "Did it really happen?"
                  ↓
          Razorpay Webhook
                  │
          "Can we prove it?"
                  ↓
              XAI Ledger
                  │
          "Can merchant see it?"
                  ↓
             Next.js
```

**LLM provides intelligence. The backend provides authority. The payment provider provides external financial state. The ledger provides evidence. The frontend provides merchant visibility and human control.**

---

# 55. Persistence, Supabase, and Authentication

SELLABLE should use **Supabase/Postgres as the primary persistent data layer**. SQLite may be useful for a throwaway local prototype, but it should not be the production/demo system of record for this architecture.

The architecture places the catalog, mandates, policies, orders, payments, consents, and audit/ledger data in Postgres. The more complete data model also relies on relational records plus JSON/JSONB fields, which fits Postgres well.

```text
                    SELLABLE
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
    Merchant Console          AI Buyer / A2A
       Next.js                    Agent
          │                         │
          │                         │
     Supabase Auth          API Key + HMAC
          │                         │
          └────────────┬────────────┘
                       ▼
                    FastAPI
                       │
             authentication / authz
                       │
                       ▼
                Commerce Core
                       │
                       ▼
                 Supabase
                  PostgreSQL
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
     Orders          Policies       Ledger
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                    Razorpay
```

## 55.1 Why Supabase/Postgres

Use Supabase/Postgres for:

- merchants
- merchant users
- products/catalog
- buyer identities
- quotes
- orders
- consent records
- payments
- refunds
- policies
- approval requests
- ledger events
- webhook processing/deduplication records

The important point is that **financial and trust state must be durable and queryable**. The Next.js dashboard should read the same backend state that drives the transaction rather than maintaining a separate frontend database.

Recommended core relationship:

```text
merchant
   │
   ├── merchant_users
   ├── products
   ├── policies
   ├── orders
   ├── quotes
   ├── consents
   ├── payments
   ├── refunds
   └── ledger_events
```

For the buildathon, keep the schema intentionally small. Do not introduce a large multi-merchant marketplace architecture. The existing architecture is explicitly scoped to a single demo merchant with a multi-tenant-capable schema.

---

## 55.2 Authentication Has Two Separate Problems

SELLABLE has two fundamentally different authentication surfaces:

```text
1. Merchant authentication
   Human → Next.js Dashboard

2. Agent authentication
   Buyer Agent → Agent Gateway
```

They should **not** use the same mechanism.

```text
Human merchant
     │
     ▼
Supabase Auth
     │
     ▼
merchant user session
     │
     ▼
Next.js / FastAPI


AI buyer agent
     │
     ▼
API key + HMAC signature
     │
     ▼
Agent Gateway
     │
     ▼
buyer identity
```

This separation makes the system easier to reason about and matches the architecture's requirement for auditable buyer-agent identity.

---

## 55.3 Merchant Authentication — Supabase Auth

The Next.js Merchant Console should use **Supabase Auth** for human login/session management.

Recommended first implementation:

```text
/login
   │
   ▼
Supabase Auth
   │
   ▼
authenticated user
   │
   ▼
merchant_users
   │
   ▼
merchant_id
   │
   ▼
/dashboard
```

A minimal `merchant_users` table can contain:

```text
merchant_users
--------------
id
merchant_id
auth_user_id
role
created_at
```

The Supabase Auth user represents the human identity. `merchant_users` connects that identity to the SELLABLE merchant account.

For the buildathon, roles can remain simple, for example:

```text
owner
operator
```

Do not spend significant build time on enterprise RBAC unless the product requires it.

### Recommended merchant login flow

```text
Browser
   │
   │ login
   ▼
Next.js
   │
   ▼
Supabase Auth
   │
   │ authenticated session
   ▼
Next.js Dashboard
   │
   │ authenticated API request
   ▼
FastAPI
   │
   ├── verify user identity
   ├── resolve merchant_id
   ├── verify merchant ownership
   └── execute authorized operation
```

The backend must not trust a `merchant_id` supplied by the browser merely because the UI is authenticated. Resolve the merchant identity from the authenticated session and verify ownership of the requested resource.

---

## 55.4 Protect Dashboard Routes

The following should require an authenticated merchant session:

```text
/dashboard
/activity
/transactions
/transactions/:id
/approvals
/catalog
/growth
/settings
```

Public discovery endpoints can remain public where appropriate:

```text
GET /.well-known/agents.json
GET /llms.txt
GET /catalog.ai.json
```

These are part of making the merchant discoverable to AI buyers and therefore should not depend on a human merchant being logged into the console.

The distinction is:

```text
Public machine discovery
        ↓
agents.json / catalog

Authenticated merchant control
        ↓
approvals / refunds / policy changes / dashboard
```

---

## 55.5 Protect Privileged Merchant Actions

Actions that change merchant or financial state must require authenticated authorization.

Examples:

```http
POST /approvals/:id/approve
POST /approvals/:id/reject
POST /transactions/:id/refund
POST /policies/:id/update
POST /catalog/products
```

The flow should be:

```text
Next.js
   │
   │ authenticated request
   ▼
FastAPI
   │
   ├── authenticate user
   ├── resolve merchant_id
   ├── authorize resource ownership
   ├── validate command
   ├── execute Commerce Core operation
   └── write ledger event
```

An approval is especially important:

```text
Merchant session
      ↓
POST /approvals/ORD-1028/approve
      ↓
FastAPI authentication
      ↓
merchant owns ORD-1028?
      ↓
YES
      ↓
approve HITL request
      ↓
continue consent/payment flow
      ↓
ledger: approval.granted
```

The LLM must never be able to impersonate this human approval.

---

## 55.6 Buyer-Agent Authentication — API Key + HMAC

The Agent Gateway has a different requirement.

The architecture specifies **per-buyer-agent API keys plus HMAC request signing using a key, timestamp, and nonce**, so the identity of the calling agent is auditable.

Conceptually:

```text
Buyer Agent
   │
   ├── buyer_agent_id
   ├── API key
   ├── timestamp
   ├── nonce
   └── request body
          │
          ▼
       HMAC-SHA256
          │
          ▼
      signature
          │
          ▼
    Agent Gateway
```

A request can conceptually contain:

```http
Authorization: Bearer <agent-api-key>
X-Agent-Id: buyer_demo_01
X-Timestamp: <unix-timestamp>
X-Nonce: <unique-request-nonce>
X-Signature: <hmac-signature>
```

The exact header names are an implementation choice. The security properties are what matter:

```text
identify caller
verify secret possession
verify freshness
prevent replay
record identity
```

The server should reject requests when:

- the API key is unknown
- the agent is disabled
- the timestamp is outside the allowed clock-skew window
- the nonce has already been used
- the HMAC signature does not match
- the agent is not authorized for the requested capability

Store only a **hash** of the long-lived API key where possible, not the plaintext secret.

---

## 55.7 Agent Identity Must Reach the Ledger

Authentication is not only about blocking unauthorized calls. It is part of explainability.

When the Buyer Agent calls SELLABLE, resolve:

```text
API key
   ↓
buyer_agent_id
   ↓
request identity
   ↓
trace_id
   ↓
ledger event
```

For example:

```json
{
  "actor": "buyer_agent",
  "buyer_agent_id": "buyer_demo_01",
  "action": "quotes.create",
  "trace_id": "trc_88f2"
}
```

This allows the replay UI to answer:

```text
Which agent made this request?
What did it request?
What did the merchant agent do?
Which policy allowed or denied it?
What happened to the payment?
```

---

## 55.8 Keep LLM Credentials Completely Separate

LLM provider credentials are backend secrets.

The browser must never receive:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
OPENROUTER_API_KEY
GOOGLE_API_KEY
```

Likewise, the browser must never receive:

```text
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
buyer-agent signing secrets
Supabase service-role key
Postgres credentials
```

The correct boundary is:

```text
Next.js Browser
      │
      │ authenticated API request
      ▼
FastAPI
      │
      ├── LLM provider credentials
      ├── Razorpay credentials
      ├── database credentials
      └── agent signing secrets
```

Public client-side configuration is different from secrets. Only values intentionally designed to be public should reach the browser.

---

## 55.9 Supabase Client Separation

Use two conceptual Supabase access levels:

```text
Next.js client
    ↓
public/client-safe Supabase configuration
    ↓
Supabase Auth / user-scoped access
```

and:

```text
FastAPI backend
    ↓
server-side Supabase/database access
    ↓
Commerce Core
```

The backend is the authority for financial operations.

Do not make the Next.js browser directly update:

```text
orders
payments
consents
ledger_events
```

through arbitrary client-side database writes.

Instead:

```text
Next.js
   ↓
FastAPI command
   ↓
authorization
   ↓
Commerce Core
   ↓
transactional database operation
   ↓
ledger event
```

This preserves the project's central principle that the backend, not the UI or LLM, controls commerce state.

---

## 55.10 Row-Level Security and Authorization

If Supabase Row Level Security is enabled for tables exposed through Supabase client access, use it as an additional data-isolation layer.

However, **RLS does not replace backend authorization** for SELLABLE's core financial operations.

The backend should still explicitly check:

```text
authenticated identity
        ↓
merchant_id
        ↓
resource ownership
        ↓
allowed operation
```

For the buildathon, keep this straightforward. The important property is that Merchant A cannot approve, refund, or inspect Merchant B's records.

---

## 55.11 Authentication Does Not Replace Consent

Authentication answers:

```text
Who is calling?
```

Authorization answers:

```text
What is this caller allowed to do?
```

Consent answers:

```text
Is this exact transaction authorized to proceed?
```

They are separate layers.

```text
Authentication
      ↓
Authorization
      ↓
Buyer budget
      ↓
Merchant policy
      ↓
Transaction-specific consent
      ↓
Payment
```

A valid Buyer Agent API key must **not** mean that the agent can automatically spend money.

Likewise, an authenticated merchant session must not allow arbitrary manipulation of payment state.

---

## 55.12 Authentication + Consent + Payment

The complete protected payment path should look like:

```text
Buyer Agent
    │
    │ API key + HMAC
    ▼
Agent Gateway
    │
    │ identify buyer
    ▼
Seller Agent
    │
    ▼
Commerce Core
    │
    ├── buyer budget ✓
    ├── merchant policy ✓
    ├── cart locked ✓
    └── consent required
              │
              ▼
       Consent Service
              │
              │ single-use token
              ▼
        Order Service
              │
              ▼
        Razorpay Adapter
              │
              ▼
           Razorpay
              │
              │ signed webhook
              ▼
        Commerce Core
              │
              ▼
        order = PAID
              │
              ▼
          XAI Ledger
```

The frontend can display the resulting state, but it does not manufacture the consent, payment success, or order state.

---

## 55.13 Environment Variables

Keep credentials in environment variables or a proper secret manager.

A development `.env.example` should document the shape without containing real secrets:

```env
# Database / Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# LLM
LLM_PROVIDER=openrouter
LLM_MODEL=
OPENROUTER_API_KEY=

# Razorpay
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# Agent authentication
BUYER_AGENT_API_KEY_HASH=
BUYER_AGENT_HMAC_SECRET=

# Application
APP_ENV=development
API_BASE_URL=http://localhost:8000
```

Never commit the real `.env` file.

The frontend should only receive the client-safe configuration required for its authenticated Supabase integration. Backend-only secrets remain on the server.

---

## 55.14 Recommended Implementation Order

Do not build every security feature at once. Implement authentication in the following order:

### Phase A — Database

```text
Supabase project
    ↓
Postgres schema
    ↓
merchants
products
policies
buyers
quotes
orders
consents
payments
ledger_events
```

### Phase B — Merchant Auth

```text
Supabase Auth
    ↓
/login
    ↓
merchant_users
    ↓
protected dashboard
```

### Phase C — Backend Authorization

Add FastAPI middleware/dependencies that:

```text
verify session/token
      ↓
resolve merchant
      ↓
check resource ownership
      ↓
allow command
```

### Phase D — Agent Authentication

Implement:

```text
buyer_agent_id
API key
HMAC
timestamp
nonce
replay protection
```

for `/agent/*` endpoints.

### Phase E — Financial Boundaries

Ensure:

```text
LLM
 ↓
typed tool
 ↓
Commerce Core
 ↓
policy + consent
 ↓
Razorpay
```

and never:

```text
LLM → database
LLM → Razorpay
Browser → payment state
Browser → ledger mutation
```

### Phase F — Audit Everything

Authentication and authorization decisions that materially affect a transaction should be visible in the appropriate audit trail where useful.

The ledger should preserve the transaction's actor, action, trace ID, outcome, policy references, and explanation.

---

## 55.15 Final Security Mental Model

Remember the layers as:

```text
                 WHO ARE YOU?
                      │
                      ▼
              Authentication
                      │
                      ▼
              WHAT CAN YOU DO?
                      │
                      ▼
               Authorization
                      │
                      ▼
             IS THIS PURCHASE
               ALLOWED?
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
    Buyer Policy            Merchant Policy
          │                       │
          └───────────┬───────────┘
                      ▼
                  Consent
                      │
                      ▼
                 Razorpay
                      │
                      ▼
             Verified Webhook
                      │
                      ▼
                   Ledger
                      │
                      ▼
                  Next.js
```

**Supabase/Postgres provides durable application state. Supabase Auth identifies human merchants. API key + HMAC identifies external buyer agents. FastAPI performs authorization and owns commerce operations. Consent authorizes the specific transaction. Razorpay provides payment state. The ledger provides evidence. Next.js provides visibility and human control.**

