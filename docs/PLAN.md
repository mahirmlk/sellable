# SELLABLE — Build Plan

**Track:** Razorpay AI Buildathon 2026 — Track 01, AI Growth & Agentic Commerce

**Primary objective:** Build a production-shaped but hackathon-sized agentic commerce system that makes a merchant discoverable, negotiable, and transactable by AI buyers while also growing merchant revenue through bounded negotiation and contextual upsells.

---

## 1. Guiding Objective

The system must prove one coherent story:

> **An AI buyer can discover a merchant, understand its catalog, negotiate within merchant policy, obtain valid consent, complete a Razorpay test-mode payment, and receive an explainable transaction trail — while the merchant can use the same system to increase revenue safely.**

The implementation priority is the track's explicit bar:

> **Every money action must be explainable, bounded, and gated; the audit trail must be visible; and at least one failure must be handled gracefully.**

Do not optimize for the number of features shipped. Optimize for a small number of capabilities that are complete, deterministic where safety matters, and highly demonstrable.

### Success equation

```text
AI Buyer Discovery
        ↓
Catalog Grounding
        ↓
Negotiation / Revenue Optimization
        ↓
Deterministic Policy Gate
        ↓
Consent / HITL
        ↓
Razorpay Test Payment
        ↓
Webhook Reconciliation
        ↓
XAI Ledger
        ↓
Replayable Explanation
        ↓
Failure Recovery
```

---

# 2. Build Principles

These principles govern implementation decisions throughout the project.

## 2.1 The LLM proposes; deterministic systems decide

An LLM may:

- search through tool interfaces
- recommend products
- draft offers
- select among policy-approved negotiation responses
- propose upsells
- explain decisions in human-readable language

An LLM must never directly:

- authorize payment
- bypass a policy
- alter a floor price
- increase a buyer's budget
- decide that consent exists
- mark a payment as successful
- mutate financial state without deterministic validation

The critical boundary is:

```text
LLM proposal
    ↓
validated command
    ↓
Policy Engine
    ↓
ALLOW / DENY / NEEDS_HUMAN_APPROVAL
    ↓
state transition
```

---

## 2.2 Money operations are state-machine operations

Do not represent commerce as a loose collection of API calls.

Use explicit states:

```text
DISCOVERED
→ QUOTED
→ NEGOTIATING
→ ACCEPTED
→ AWAITING_CONSENT
→ CONSENTED
→ PAYMENT_PENDING
→ PAID
→ FULFILLED

Alternative terminal states:
→ DENIED
→ ABORTED
→ PAYMENT_FAILED
→ REFUNDED
```

Every transition must have:

- actor
- previous state
- requested transition
- policy result
- timestamp
- trace ID
- explanation
- external provider reference where relevant

---

## 2.3 Ledger-first implementation

Do not add explainability at the end.

The ledger contract should be established before the agents and commerce flows are finished.

Every meaningful action must leave an event:

```text
catalog.search
quote.created
negotiation.countered
upsell.offered
upsell.accepted
policy.checked
policy.denied
human.approval_requested
human.approval_granted
consent.issued
order.created
payment.attempted
payment.failed
payment.captured
retry.started
retry.aborted
refund.executed
```

The final demo should be able to replay a transaction from beginning to end using only these events plus the underlying commerce records.

---

## 2.4 Build the vertical slice before the platform

The first milestone is not "architecture complete."

The first milestone is:

```text
Buyer → Merchant Agent → Policy → Razorpay → Ledger
```

working end to end.

Only after that should the project gain extra discovery surfaces, analytics, visual polish, or protocol-adjacent features.

---

## 2.5 One merchant, one strong demo scenario

Use:

- one merchant
- approximately 8–15 products
- a small number of product categories
- explicit floor prices
- explicit stock
- one buyer mission
- one or two strong upsell relationships

The goal is controlled behavior, easy debugging, and a highly repeatable demo.

---

# 3. Scope Definition

## 3.1 P0 — Required for submission

Everything below is mandatory:

- Merchant catalog
- Machine-readable catalog endpoint
- Seller Agent
- Reference Buyer Agent
- Deterministic Policy Engine
- Bounded negotiation
- One contextual upsell
- Consent flow
- HITL approval path
- Razorpay test-mode payment
- Signature-verified webhook handling
- Idempotent payment/order operations
- Explicit order state machine
- XAI ledger
- Human-readable audit/replay view
- One deliberate payment failure flow
- Graceful retry or abort
- No double settlement
- Basic automated tests for critical safety cases
- Repeatable demo script

---

## 3.2 P1 — Strong differentiators

Build after the P0 transaction path is stable:

- `/.well-known/agents.json`
- `llms.txt`
- `catalog.ai.json`
- Agent Storefront endpoints
- Agent-to-agent negotiation
- HMAC request signing
- Saved-deal insights
- Minimal merchant console
- Live activity feed
- Approval queue
- Refund flow
- Golden scenario evaluation runner

---

## 3.3 P2 — Polish and protocol literacy

Only build these after P0 and P1 are reliable:

- x402-style metered endpoint
- ACP-shaped feed conventions
- Advanced OpenTelemetry tracing
- Redis queues/rate limits
- Rich analytics dashboards
- Advanced pricing recommendations
- sophisticated multi-merchant abstractions
- full protocol compliance
- elaborate animation or UI effects

Do not allow P2 work to delay the core bar.

---

# 4. Repository Strategy

Use a clear separation between deterministic commerce, agent behavior, trust/audit, and presentation.

```text
sellable/
├── apps/
│   └── console/
│       ├── chat/
│       ├── approvals/
│       ├── activity/
│       └── replay/
│
├── services/
│   ├── commerce/
│   │   ├── catalog/
│   │   ├── quotes/
│   │   ├── policy/
│   │   ├── orders/
│   │   ├── consent/
│   │   ├── refunds/
│   │   └── gateway/
│   │
│   ├── payments/
│   │   └── razorpay/
│   │
│   └── ledger/
│
├── agents/
│   ├── seller/
│   └── buyer/
│
├── evals/
│   ├── scenarios/
│   └── runner/
│
├── infra/
│   ├── docker/
│   ├── seed/
│   └── webhook/
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PLAN.md
│   └── DEMO.md
│
├── scripts/
│   ├── seed.py
│   ├── demo.py
│   └── replay.py
│
├── .env.example
├── docker-compose.yml
├── README.md
└── INCIDENTS.md
```

### Dependency rule

Keep the dependency direction approximately:

```text
apps
  ↓
agents
  ↓
commerce interfaces
  ↓
deterministic domain services
  ↓
external adapters

ledger is cross-cutting, but financial state must not depend on LLM output.
```

The Policy Engine must be usable without importing the LLM client.

---

# 5. Core Data Contracts

Freeze these early.

## 5.1 Intent Mandate

Represents the human-authorized bounds available to the buyer agent.

```python
class IntentMandate:
    mandate_id: str
    buyer_agent_id: str
    budget_ceiling_paise: int
    allowed_categories: list[str]
    purpose: str
    created_at: datetime
    expires_at: datetime
```

---

## 5.2 Quote / Cart

Represents an offer negotiated between buyer and merchant.

```python
class CartMandate:
    mandate_id: str
    intent_ref: str
    items: list[CartItem]
    subtotal_paise: int
    discount_paise: int
    total_paise: int
    upsell_offered: bool
    upsell_rationale: str | None
    negotiation_round: int
    created_at: datetime
    gate_verdict: str
    gate_reason_code: str | None
```

---

## 5.3 Consent

Consent must be bound to the specific transaction rather than treated as a generic approval flag.

```python
class Consent:
    consent_id: str
    order_id: str
    amount_paise: int
    payee_id: str
    purpose: str
    expires_at: datetime
    status: str
    approved_at: datetime | None
    single_use: bool
```

For the hackathon implementation, a signed artifact/token can model this behavior. Do not claim full protocol compliance unless actually implemented.

---

## 5.4 Execution Record

```python
class ExecutionRecord:
    order_id: str
    idempotency_key: str
    razorpay_order_id: str | None
    razorpay_payment_id: str | None
    status: str
    failure_reason: str | None
    executed_at: datetime | None
```

All monetary values are integer paise.

---

# 6. Ledger Contract

Use an append-only event model.

```json
{
  "event_id": "evt_...",
  "trace_id": "trc_...",
  "timestamp": "2026-08-28T13:56:42Z",
  "actor": "seller_agent",
  "action": "quote.negotiated",
  "inputs": {},
  "outputs": {},
  "reasoning_summary": "The requested discount was above the buyer budget but remained within the merchant discount cap.",
  "policy_refs": [
    "POLICY.max_discount",
    "POLICY.buyer_budget"
  ],
  "provider_refs": {},
  "flags": []
}
```

### Explainability rule

Store a concise **decision explanation**, not private model chain-of-thought.

Good:

```text
Countered at ₹5,100 because ₹4,800 would violate the configured floor price.
```

Bad:

```text
Full hidden chain-of-thought...
```

Every money-touching event should have:

- `reasoning_summary`
- `policy_refs`
- relevant monetary values
- actor
- trace ID
- result
- provider reference if applicable

---

# 7. Policy Engine

This is the most important deterministic component.

Implement it as a pure, testable module.

```python
validate(action, context) -> PolicyDecision
```

Possible results:

```text
ALLOW
DENY
NEEDS_HUMAN_APPROVAL
```

### Initial rules

Use configurable values such as:

```text
MAX_ORDER_VALUE
MAX_SINGLE_ITEM_VALUE
MAX_DISCOUNT_PERCENT
ALLOWED_CATEGORIES
MAX_NEGOTIATION_ROUNDS
MAX_UPSELLS_PER_SESSION
BUYER_DAILY_SPEND_CAP
HUMAN_APPROVAL_THRESHOLD
```

### Example policy checks

```text
1. Is the SKU valid?
2. Is the category allowed?
3. Is stock available?
4. Is the total within the buyer mandate?
5. Is the discount within merchant limits?
6. Is the negotiated amount above the floor?
7. Has the negotiation limit been reached?
8. Has the buyer daily cap been exceeded?
9. Is human approval required?
10. Is consent valid for this exact transaction?
```

### Important boundary

```text
LLM chooses among valid options.
Policy Engine defines the valid options.
```

---

# 8. Seller Agent

The Seller Agent is the reasoning layer representing the merchant.

## Required tools

```text
catalog.search
catalog.get
quotes.create
quotes.negotiate
upsell.suggest
consent.request
orders.create
orders.status
refunds.create
```

Every tool should return structured data rather than free-form text.

### Tool-grounding rule

The agent must not invent:

- SKU
- price
- stock
- discount
- payment status

All factual commerce values must originate from deterministic tools.

### Negotiation behavior

The agent may:

- accept an offer
- counter
- propose a bounded upsell
- walk away

The agent may not:

- go below floor price
- exceed discount cap
- create an unauthorized order
- silently alter the buyer's constraints

---

# 9. Buyer Agent

The reference Buyer Agent exists to make the A2A claim credible and testable.

Use an explicit state machine:

```text
DISCOVER
→ RESEARCH
→ REQUEST
→ NEGOTIATE
→ ACCEPT / REJECT
→ CONSENT
→ PAY
→ VERIFY
→ REPORT
```

The buyer agent must maintain its own budget constraints.

### Example mission

```text
Find a suitable product bundle under ₹6,000,
prefer one main product plus a complementary accessory,
and do not purchase anything outside the allowed categories.
```

This gives the seller agent an opportunity to demonstrate:

- discovery
- recommendation
- negotiation
- upsell
- safety
- purchase

---

# 10. Agent Gateway

The gateway makes the merchant machine-readable.

Minimum useful endpoints:

```http
GET /.well-known/agents.json
GET /llms.txt
GET /catalog.ai.json

POST /agent/catalog.search
POST /agent/catalog.get
POST /agent/quotes.create
POST /agent/quotes.negotiate
POST /agent/consents.request
POST /agent/orders.create
POST /agent/orders.status
POST /agent/refunds.create

POST /webhooks/razorpay
```

### Authentication evolution

Build in this order:

1. Local/dev identity
2. Buyer-agent API key
3. HMAC request signing with timestamp/nonce

Do not spend early build time on cryptographic infrastructure that is not required to prove the core transaction.

---

# 11. Razorpay Integration Strategy

Razorpay is the actual payment rail for the demonstration.

## Integration order

### First

Verify independently:

```text
credentials
→ create test order
→ create payment flow
→ observe payment state
```

### Then

Connect the payment flow to:

```text
Policy
→ Consent
→ Order
→ Razorpay
→ Webhook
→ Ledger
```

### Required protections

- test mode only
- signature verification
- idempotency keys
- payment state reconciliation
- no payment call before policy approval
- no "payment succeeded" based only on client-side UI state

The webhook becomes the authoritative trigger for the final payment state.

---

# 12. Failure Handling

This must be designed as a first-class flow rather than an exception handler.

## Required scripted scenario

```text
valid cart
   ↓
policy ALLOW
   ↓
Razorpay order/payment attempt
   ↓
deliberate payment failure
   ↓
classify failure
   ↓
audit event
   ↓
bounded retry OR abort
   ↓
final structured response
```

### The failure handler must

1. classify the failure
2. record the provider response
3. prevent blind retry
4. preserve the same transaction identity
5. use idempotency
6. retry at most once when retry is valid
7. otherwise abort cleanly
8. release any local reservation/hold
9. update the order state
10. expose a human-readable explanation
11. write the complete event chain

### Demo failure

Use a deterministic Razorpay test failure path so the pitch does not depend on a random provider error.

The audience should visibly see:

```text
PAYMENT_FAILED
→ reason identified
→ recovery decision
→ no duplicate order/payment
→ final audit trail
```

---

# 13. Consent and Human Approval

There are two different safety concepts.

## Buyer consent

Confirms that the buyer authorizes this specific transaction.

Bind the consent to:

```text
order ID
amount
payee
purpose
expiry
single use
```

## Merchant HITL

Protects the merchant when a transaction crosses a configured risk threshold.

Example:

```text
₹0–₹1,999   → automatic
₹2,000+     → NEEDS_HUMAN_APPROVAL
```

The exact number is demo configuration, not a universal business rule.

### Approval flow

```text
agent requests order
        ↓
policy detects HITL threshold
        ↓
order held
        ↓
approval queue
        ↓
human approves/rejects
        ↓
consent/payment may continue
```

This visibly demonstrates the "gated" requirement.

---

# 14. Merchant Revenue Growth

Do not treat growth as an unrelated dashboard.

Tie it directly to agent decisions.

## Revenue mechanisms

### A. Contextual upsell

The seller agent proposes one relevant add-on.

Example:

```text
Main item: Desk
Upsell: Desk mat
Reason: commonly paired accessory
```

The customer/buyer agent can reject it without breaking checkout.

### B. Margin-protected negotiation

The agent can offer a discount only inside configured bounds.

Example:

```text
Customer asks: ₹4,500
Floor price: ₹4,900
Agent response: ₹4,950
```

### C. Saved-deal insight

When the buyer walks away because the merchant's constraints are reached:

```text
Saved Deal
SKU: DESK-01
Final requested price: ₹4,500
Merchant floor: ₹4,900
Outcome: walk-away
```

This becomes useful merchant intelligence rather than merely a failed transaction.

---

# 15. Merchant Console

Keep the first version minimal.

## Screen 1 — Activity

Show:

```text
Buyer discovered catalog
Quote created
Counter-offer
Upsell proposed
Policy check
Consent
Payment
Webhook
Settlement
```

## Screen 2 — Approval Queue

Show:

```text
Transaction
Amount
Reason for escalation
Approve / Reject
```

## Screen 3 — Replay

Timeline:

```text
13:52:01 Buyer intent
13:52:02 Catalog result
13:52:04 Quote created
13:52:06 Upsell proposed
13:52:08 Buyer accepted
13:52:09 Policy ALLOW
13:52:10 Consent issued
13:52:20 Payment captured
```

Clicking an event reveals:

```text
What happened?
Why did it happen?
Which policy allowed it?
What changed financially?
Which external provider reference was involved?
```

## Screen 4 — Growth

Only after the core flow is stable:

- upsell attach rate
- successful vs rejected negotiations
- saved deals
- average negotiated discount
- policy denials
- buyer conversion

---

# 16. Evaluation Harness

Build scenario-based tests around the safety contract.

## Required scenarios

### S1 — Valid purchase

Expected:

```text
ALLOW → payment → PAID → complete ledger
```

### S2 — Below-floor negotiation

Expected:

```text
DENY or counter
no unauthorized discount
ledger references floor policy
```

### S3 — Over-budget buyer

Expected:

```text
DENY
no Razorpay execution
reason = OVER_BUDGET
```

### S4 — HITL transaction

Expected:

```text
NEEDS_HUMAN_APPROVAL
no payment before approval
```

### S5 — Duplicate consent

Expected:

```text
first use succeeds
second use rejected
```

### S6 — Hallucinated SKU request

Expected:

```text
no invented product
only tool-returned products are offered
```

### S7 — Payment failure

Expected:

```text
classified failure
bounded recovery
no double settlement
complete audit trail
```

### S8 — Duplicate webhook

Expected:

```text
idempotent processing
no duplicate state transition
no duplicate financial result
```

### S9 — Refund

Expected:

```text
policy check
refund executed
ledger linked to original trace
```

---

# 17. Development Phases

## Phase 0 — Spike and contracts

**Goal:** remove uncertainty before building breadth.

Build:

- Razorpay test credentials
- one test order manually
- webhook tunnel
- repository scaffold
- database connection
- event schema
- data contracts

### Exit gate

```text
Razorpay test order creation confirmed
Webhook delivery confirmed
Database connected
Ledger schema committed
```

---

## Phase 1 — Deterministic Commerce Core

Build:

- catalog
- quote model
- order state machine
- policy engine
- consent model
- idempotency
- basic audit writes

### Exit gate

You can execute this without an LLM:

```text
catalog
→ quote
→ policy
→ consent
→ order
```

and every transition appears in the ledger.

---

## Phase 2 — Seller Agent

Build:

- LangGraph seller agent
- tool interfaces
- catalog grounding
- quote generation
- bounded negotiation
- upsell recommendation
- structured decision output

### Exit gate

A natural-language buyer request can become a valid candidate cart without bypassing policy.

---

## Phase 3 — Payment and Webhooks

Build:

- Razorpay adapter
- Payment Link / Order integration
- webhook verification
- reconciliation
- success path
- failure path
- idempotency

### Exit gate

A valid transaction reaches:

```text
CONSENTED → PAYMENT_PENDING → PAID
```

only through verified payment state.

---

## Phase 4 — Buyer Agent and A2A

Build:

- buyer state machine
- discovery manifest
- machine-readable catalog
- Agent Gateway
- request signing
- buyer budget guard
- negotiation loop

### Exit gate

Headless:

```text
Buyer Agent → Agent Gateway → Seller Agent → Razorpay
```

completes a transaction.

---

## Phase 5 — Trust and Demo UI

Build:

- replay timeline
- live activity
- approval queue
- denied-action view
- payment failure view
- explanation details

### Exit gate

A judge can understand a transaction's lifecycle without needing the developer to explain every backend implementation detail.

---

## Phase 6 — Growth and Evaluation

Build:

- saved-deal insights
- attach-rate metric
- golden scenarios
- failure injection
- regression tests
- basic growth analytics

### Exit gate

The system can prove both:

```text
safe commerce
+
merchant growth
```

with data from actual demo transactions.

---

# 18. Recommended 8-Day Execution Plan

This is the default schedule for a solo build.

## Day 0 — Today: Spike and Lock Contracts

### Objectives

- Razorpay credentials
- test order
- webhook
- repo
- database
- event schema
- core Pydantic/domain models
- catalog seed
- policy config

### Deliverables

```text
docker/dev environment
working Razorpay connectivity
ledger schema
8–15 seeded products
policy configuration
```

### Do not build

- polished frontend
- analytics
- protocol extras
- sophisticated agent prompts

---

## Day 1 — Commerce Core

Build:

```text
Catalog
Quote
Policy Engine
Order State Machine
Consent
Idempotency
Ledger writer
```

Write unit tests immediately.

### End-of-day demo

CLI or API can show:

```text
catalog → quote → policy → order → ledger
```

without an LLM.

---

## Day 2 — Seller Agent + Grounding

Build:

```text
LangGraph
catalog.search
catalog.get
quotes.create
quotes.negotiate
upsell.suggest
```

Enforce structured outputs.

### End-of-day demo

Natural-language buyer request becomes a policy-valid cart.

---

## Day 3 — Razorpay Happy Path

Build:

```text
consent.request
orders.create
Razorpay adapter
webhook verification
payment reconciliation
```

### End-of-day demo

```text
Buyer request
→ seller agent
→ policy
→ consent
→ Razorpay test payment
→ verified webhook
→ PAID
→ ledger
```

This is the most important milestone.

---

## Day 4 — Buyer Agent + A2A

Build:

```text
agents.json
catalog.ai.json
Agent Gateway
Buyer Agent
negotiation
buyer budget
```

### End-of-day demo

Two agents complete a transaction without human typing.

---

## Day 5 — Safety + Failure + HITL

Build:

```text
floor enforcement
budget enforcement
category blocking
HITL approval
failure classification
bounded retry/abort
duplicate-payment protection
```

### End-of-day demo

Run all three:

```text
valid purchase
blocked purchase
failed payment
```

---

## Day 6 — Trust UI + Replay

Build only the UI needed to make the bar undeniable:

```text
activity feed
approval queue
transaction replay
decision explanation
policy references
failure trace
```

If the UI starts consuming too much time, prioritize replay over visual polish.

---

## Day 7 — Hardening + Evals + Demo

Run:

```text
happy path ×3
upsell accepted ×2
upsell rejected ×2
below-floor ×3
over-budget ×3
HITL ×3
payment failure ×3
duplicate webhook ×3
duplicate consent ×3
```

Fix all nondeterministic failures.

Add fallback/demo-script mode only after the real flow works.

---

## Day 8 — Buffer and Submission

Use the final day only for:

- bug fixes
- demo rehearsal
- README
- architecture synchronization
- recording
- final cleanup
- submission

Do not start a major new feature.

---

# 19. Critical Milestones

## M1 — Commerce Core Works

The system can deterministically evaluate:

```text
valid
invalid
needs approval
```

and record each result.

## M2 — Money Moves

A real Razorpay test-mode transaction completes through the application.

## M3 — Agent Buys From Agent

The reference buyer agent can purchase from the merchant agent.

## M4 — The Bar Is Visible

A judge can see:

```text
Explainable
Bounded
Gated
Audit trail
Failure handled gracefully
```

## M5 — Growth Story

The same system demonstrates:

```text
upsell
negotiation
saved-deal insight
```

---

# 20. Demo Strategy

The demo should be built around three stories.

## Story A — Successful Commerce

```text
Buyer:
"I need a desk setup under ₹6,000."

Buyer Agent discovers merchant
        ↓
catalog search
        ↓
seller recommendation
        ↓
bounded upsell
        ↓
buyer accepts
        ↓
policy ALLOW
        ↓
consent
        ↓
Razorpay test payment
        ↓
webhook confirmation
        ↓
receipt
        ↓
ledger replay
```

---

## Story B — Safety

Ask for something that violates a rule.

Example:

```text
"Give me this item for ₹3,000."
```

when floor price is ₹4,900.

Show:

```text
Policy DENY
Reason: BELOW_FLOOR_PRICE
Razorpay not called
Ledger event created
```

Then show the HITL case:

```text
amount > threshold
→ approval required
→ payment held
```

---

## Story C — Failure

Trigger the deterministic Razorpay failure.

Show:

```text
payment attempt
→ provider failure
→ failure classification
→ bounded recovery
→ no double charge
→ final ledger
```

This is the most important resilience demonstration.

---

# 21. Demo Timing

Target a 5-minute presentation.

```text
0:00–0:30  Problem
0:30–1:15  Architecture
1:15–2:15  Successful agentic purchase
2:15–3:15  Negotiation + upsell + policy
3:15–4:15  Failure + recovery
4:15–4:45  Replay / audit / explanation
4:45–5:00  Growth story + future direction
```

The demo should show the product, not only diagrams.

---

# 22. Risk Register

| Risk | Mitigation |
|---|---|
| Razorpay integration surprises | Test Orders and webhooks before agent development |
| Webhook tunnel instability | Validate early and retain a controlled local development fallback |
| LLM produces invalid actions | Strict structured output + deterministic Policy Engine |
| LLM hallucinates products | Tool-grounded catalog only |
| Double settlement | Idempotency + explicit order state machine + webhook reconciliation |
| Failure is hard to reproduce | Script a deterministic test-mode failure |
| Scope explosion | P0/P1/P2 discipline |
| Console consumes too much time | Replay page before analytics |
| Protocol work consumes time | Implement protocol-shaped surfaces last |
| Prompt instability | Low temperature, structured tools, bounded action space |
| Ledger churn | Freeze event contract early; prefer additive changes |
| Demo instability | Rehearse the exact seeded scenario repeatedly |
| External dependency unavailable | Keep the demo scenario simple and locally controllable |

---

# 23. Fallback Strategy

The real system must remain the source of truth.

A fallback may be used for presentation only after real flows are verified.

Recommended hierarchy:

```text
1. Real end-to-end flow
2. Deterministic seeded scenario
3. Scripted agent decisions
4. Captured provider response replay for development
```

Never misrepresent a replayed or mocked provider event as a live payment.

---

# 24. Incidents Log

Maintain `INCIDENTS.md` from the first day.

For every meaningful problem record:

```text
timestamp
symptom
root cause
fix
architectural lesson
```

Examples:

```text
Webhook was delivered twice
→ handler was not idempotent
→ added event deduplication
→ strengthened financial state transition rules
```

This gives you real engineering material for the final presentation.

---

# 25. Definition of Done

The project is submission-ready only when all of the following are true.

## Core transaction

- [ ] Buyer Agent can discover the merchant
- [ ] Buyer Agent can search the catalog
- [ ] Seller Agent can create a quote
- [ ] Negotiation is bounded
- [ ] Upsell is proposed with rationale
- [ ] Upsell can be rejected without breaking the flow
- [ ] Policy Engine validates every financial action
- [ ] Buyer consent is transaction-bound and single-use
- [ ] HITL threshold is enforced
- [ ] Razorpay test payment succeeds
- [ ] Webhook is verified
- [ ] Order reaches PAID only after verified payment state
- [ ] Refund path works if included in the final submission

## Safety

- [ ] Below-floor offers are rejected or safely countered
- [ ] Over-budget transactions are rejected
- [ ] Restricted categories are blocked
- [ ] Unauthorized SKUs cannot enter a cart
- [ ] Duplicate consent cannot be reused
- [ ] Duplicate webhook cannot produce duplicate settlement
- [ ] Payment retry is bounded and idempotent

## Explainability

- [ ] Every money event creates a ledger entry
- [ ] Ledger entries include human-readable decision explanations
- [ ] Policy references are recorded
- [ ] Provider references are recorded
- [ ] Entire transaction can be replayed
- [ ] Judge can understand why an action was allowed/denied

## Failure

- [ ] Payment failure can be reproduced deterministically
- [ ] Failure is classified
- [ ] No blind infinite retry
- [ ] No duplicate charge
- [ ] Final state is explicit
- [ ] Failure is visible in the ledger
- [ ] Buyer receives structured error information

## Revenue growth

- [ ] At least one contextual upsell works
- [ ] Merchant floor protects margin
- [ ] Negotiation outcome is recorded
- [ ] Saved-deal or equivalent growth insight is demonstrated

## Delivery

- [ ] README is complete
- [ ] `.env.example` is complete
- [ ] `docker compose up` or documented local equivalent works
- [ ] Seed script works
- [ ] Demo script works repeatedly
- [ ] Architecture document reflects what is actually implemented
- [ ] Submission assets are ready

---

# 26. What Not to Build Before the Bar Is Green

Do not start these while core submission requirements are broken:

```text
multi-merchant marketplace
voice agent
complex campaign orchestration
full AP2 cryptography
full ACP compliance
full x402 integration
large analytics suite
advanced recommendation models
complex distributed queues
microservice deployment complexity
elaborate frontend animation
```

A small, complete, highly explainable system is stronger than a broad incomplete platform.

---

# 27. Final Engineering Priorities

When choosing between two tasks, use this order:

```text
1. Prevent unsafe money movement
2. Make the end-to-end payment path work
3. Make every decision explainable
4. Make failure recoverable
5. Make the agent buyer loop work
6. Add revenue growth
7. Make the transaction visually compelling
8. Add protocol-adjacent polish
```

When a feature conflicts with one of these priorities, the feature loses.

---

# 28. Final Product Shape

The finished product should be understandable in one diagram:

```text
             ┌──────────────────┐
             │    AI Buyer      │
             └────────┬─────────┘
                      │
                      ▼
             ┌──────────────────┐
             │  Agent Gateway   │
             └────────┬─────────┘
                      │
                      ▼
             ┌──────────────────┐
             │   Seller Agent   │
             │ search/negotiate │
             │    /upsell       │
             └────────┬─────────┘
                      │
                      ▼
             ┌──────────────────┐
             │ Deterministic    │
             │ Commerce Core    │
             │                  │
             │ catalog          │
             │ policy           │
             │ order state      │
             │ consent          │
             └────────┬─────────┘
                      │
                ALLOW / DENY
                 / HUMAN
                      │
                      ▼
             ┌──────────────────┐
             │    Razorpay      │
             │    Test Mode     │
             └────────┬─────────┘
                      │
                  webhook
                      │
                      ▼
             ┌──────────────────┐
             │    XAI Ledger    │
             │ replay + audit   │
             └────────┬─────────┘
                      │
                      ▼
             ┌──────────────────┐
             │ Merchant Console │
             │ growth + trust   │
             └──────────────────┘
```

The central architectural message is:

> **The agent handles intent and strategy. Deterministic commerce services control authority. Razorpay executes payment. The ledger proves what happened and why.**

That is the implementation path to protect throughout the build.
