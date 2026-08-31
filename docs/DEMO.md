# SELLABLE — Demo Script

**Track:** Razorpay AI Buildathon 2026 — Track 01, AI Growth & Agentic Commerce

---

## Demo Duration

5 minutes

---

## Story A — Successful Agentic Purchase

**0:00–0:30 — Problem**

Commerce is built for human eyeballs. AI buyers cannot discover, understand, or negotiate with merchants. The shift is already happening: NPCI has published agent-payment protocols, and Razorpay is piloting agentic commerce. Merchants need to become machine-readable.

**0:30–1:15 — Architecture**

SELLABLE has two agents plus a trust layer. The LLM proposes, the policy engine disposes, and every action leaves an explanation in the XAI Ledger.

**1:15–2:15 — Successful Purchase**

Buyer agent sends: "I need a desk setup under ₹6,000."

```
Buyer Agent → Agent Gateway → Seller Agent
                                    ↓
                              catalog search
                                    ↓
                              quote creation
                                    ↓
                              policy ALLOW
                                    ↓
                              consent issued
                                    ↓
                              Razorpay test payment
                                    ↓
                              webhook confirmation
                                    ↓
                              receipt
```

Open the replay UI. Click through the ledger events. Each one shows: what happened, why, which policy, what changed financially.

---

## Story B — Negotiation + Upsell + Safety

**2:15–3:15**

**Bounded Negotiation:**

Buyer: "I want this item for ₹4,500."
Floor price: ₹4,900.
Seller agent counters at ₹4,950 — the lowest policy-valid price.

**Contextual Upsell:**

Seller: "I recommend a desk mat — commonly paired with your desk."
Buyer rejects. No break in checkout. Upsell attach rate is recorded.

**Policy DENY:**

Buyer: "Give me this premium item for ₹3,000."
Policy: DENY. Reason: BELOW_FLOOR_PRICE. Razorpay never called.

**HITL:**

Cart total exceeds threshold. Policy: NEEDS_HUMAN_APPROVAL. Payment held. Human approves. Flow continues.

---

## Story C — Failure + Recovery

**3:15–4:15**

Trigger the deterministic Razorpay test failure.

```
Payment attempt
    ↓
Provider failure
    ↓
Failure classified: PAYMENT_FAILED
    ↓
Bounded recovery: retry once or abort
    ↓
No duplicate charge
    ↓
Final ledger entry: payment.failed
```

Open the ledger. Show the complete event chain: order created, consent consumed, payment attempted, payment failed, order state updated.

---

## Story D — Replay + Audit

**4:15–4:45**

Open the replay UI. Select a completed transaction. Show:

- Timeline of all ledger events
- Each event: actor, action, inputs, outputs, reasoning, policy refs, provider refs
- Policy decisions with reason codes
- Consent binding (single-use, transaction-specific)
- Payment state transitions

A judge can understand the entire transaction lifecycle without needing the developer to explain.

---

## Story E — Merchant Growth

**4:45–5:00**

The same system demonstrates revenue growth:

- **Upsell:** Contextual add-ons increase basket size
- **Negotiation:** Margin-protected discounts — agent never goes below floor
- **Saved deals:** When buyer walks away, merchant gets intelligence: what was requested, what was the floor, why it failed
- **AI discoverability:** `/.well-known/agents.json`, `llms.txt`, `catalog.ai.json` make the merchant visible to AI buyers

Future direction: multi-merchant, advanced analytics, protocol compliance.

---

## Key Metrics to Show

| Metric | Value |
|--------|-------|
| Catalog items | 8–15 |
| Ledger events per transaction | 10–15 |
| Policy checks per transaction | 3–5 |
| Upsell attach rate | Measured |
| Negotiation margin protection | 100% |
| Duplicate payment protection | Idempotent |
| Failure recovery | Bounded (1 retry max) |

---

## Prerequisites

1. Razorpay test credentials configured
2. Webhook tunnel running (ngrok/localtunnel)
3. Database seeded
4. All tests passing
5. Demo rehearsed 3+ times

---

## Common Failure Modes During Demo

| Issue | Mitigation |
|-------|------------|
| Webhook not received | Check tunnel is running; use ngrok fallback |
| Razorpay timeout | Pre-create test order as backup |
| LLM hallucination | Tool-grounded catalog prevents this |
| Non-deterministic agent | Use fixed seed scenario for demo |
| Database locked | Use SQLite in-memory for demo |
