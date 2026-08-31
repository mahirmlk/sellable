# Understanding & Building the "AI Growth & Agentic Commerce" Track

Before the docs, here's my read of the problem and our approach. One note upfront: I'm working from the screenshot's visible content (title, tagline, the three sections) plus the publicly known context of this track (Razorpay's agentic commerce brief, NPCI's 2025 agent-payment protocols). Where the image text was ambiguous, I've stated assumptions in `PLAN.md` — tell me if any bullet differs and I'll adjust the docs.

---

## Part 1 — What the problem statement is actually asking

**The shift ("WHY NOW"):** NPCI (which runs UPI) has published protocols allowing **AI agents to initiate and approve payments on a user's behalf**. Combined with AI buyers (Perplexity, OpenAI, Google shopping agents) starting to *purchase*, commerce is moving from "human clicks Buy" to **agent-negotiates-and-buys**. Razorpay already runs pilots here. This is now a build-this-year problem, not a someday problem.

**The gap:** Merchants today are built for human eyeballs — HTML storefronts, carts, coupon codes. They are **invisible and unusable to AI buyers**: no machine-readable catalog, no agent-facing API, no negotiation policy, no consent flow, no audit trail when an agent spends money.

**The ask:** Build the merchant side of agent commerce — **(a) grow the merchant's revenue** using agents, and **(b) make the merchant sellable to AI buyers.**

**Example directions (4):** conversational in-app checkout, AI-readable storefronts/catalogs, agent-to-agent negotiation/procurement, and autonomous merchant growth agents.

**The Bar (decoded):**
| Bar requirement | What judges actually mean |
|---|---|
| **Explainable transactions** | Every agent action that touches money leaves a human-readable audit trail: what it did, why, which policy/price it consulted, and what it cost |
| Real rails, not mocks | Payments via Razorpay sandbox, real webhooks, real refunds |
| Consent & guardrails | Per-transaction consent (NPCI-style), spend caps, human-in-the-loop above thresholds |
| End-to-end working demo | Discovery → negotiation → consent → payment → receipt → refund, all live |

---

## Part 2 — Our solution: **SELLABLE**

A platform with **two agents + a trust layer**, built on one core principle that matches the bar:

> **"The LLM proposes, the policy engine disposes — and every action leaves an explanation."**

The agent never has final authority over money. It proposes; a deterministic Policy/Guardrail engine validates; the XAI Ledger records everything.

**Components:**
1. **Commerce Core** — catalog, pricing/floor policies, orders, consent, refunds
2. **Agent Gateway** — makes the merchant *discoverable*: `/.well-known/agents.json` manifest, `llms.txt`, machine-readable catalog, agent API with signed-key auth
3. **Seller Agent** — chat checkout (conversational, with upsells) + A2A negotiation within merchant policy
4. **Buyer Agent** (reference AI buyer) — mission planner with budget guard, proves the A2A loop works
5. **Payment Rail** — Razorpay test-mode payment links, webhook confirmation, refunds
6. **Trust Layer** — XAI Ledger (explainable events), guardrails (spend caps, floor prices, HITL), replay UI
7. **Merchant Console** — live agent activity, negotiation logs, revenue + saved-deal analytics (the "growth" half)

**How we match the bar:** explainability = ledger event per action with policy refs; safety = hard-coded rails outside the LLM; realism = Razorpay sandbox + webhooks; revenue = upsell attach-rate, negotiation-that-protects-margin, and AI discoverability.

---

