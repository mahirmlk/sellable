<div align="center">

<img src="apps/merchant-console/public/sellable-logo.png" alt="SELLABLE" width="320" />

<br/>

### Agentic Commerce Infrastructure

**Infrastructure that lets AI buyers discover, negotiate with, and safely purchase from merchants -- with deterministic policy enforcement and full audit trails.**

<br/>

[![CI](https://github.com/sellable/sellable/actions/workflows/ci.yml/badge.svg)](https://github.com/sellable/sellable/actions)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.2-143C5D.svg)](https://langchain-ai.github.io/langgraph/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000.svg?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4.svg?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Razorpay](https://img.shields.io/badge/Razorpay-Test%20Mode-07263E.svg?logo=razorpay&logoColor=white)](https://razorpay.com/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com/)
[![SQLite](https://img.shields.io/badge/SQLite-Dev-003B57.svg?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<br/>

[Features](#features) | [Architecture](#architecture) | [Quick Start](#quick-start) | [API](#api-reference) | [Docs](#documentation)

</div>

---

## What Is SELLABLE?

The commerce landscape is shifting. AI buyers -- Perplexity, OpenAI shopping agents, Google Procurement -- are beginning to **discover, negotiate, and purchase** products autonomously. Merchants today are built for human eyeballs: HTML storefronts, coupon codes, manual carts. They are **invisible and unusable to AI buyers**.

**SELLABLE** solves this. It makes any merchant:
- **Discoverable** -- via machine-readable `agents.json`, `llms.txt`, and a product catalog API
- **Negotiable** -- bounded, policy-governed agent-to-agent price negotiation
- **Safely transactable** -- deterministic policy engine, single-use consent, real Razorpay payments, full audit trail

> **The LLM proposes, the policy engine disposes -- and every action leaves an explanation.**

---

## The Bar We Meet

| Requirement | Implementation |
|---|---|
| **Explainable transactions** | XAI Ledger records every agent action with trace_id, policy refs, and reasoning summaries |
| **Real rails, not mocks** | Razorpay test-mode payments, HMAC webhook verification, real refund flow |
| **Consent & guardrails** | Per-transaction single-use consent, spend caps, floor prices, human-in-the-loop thresholds |
| **End-to-end demo** | Discovery -> negotiation -> consent -> payment -> receipt -> refund, all live |

---

## Features

- **Commerce Core** -- Catalog, pricing, quotes, orders, consent, refunds -- all deterministic
- **Agent Gateway** -- Machine-facing discovery (`/.well-known/agents.json`) and transactional API with HMAC signed-key auth
- **Seller Agent** -- LangGraph state machine: search -> quote -> upsell -> respond, bounded by policy
- **Buyer Agent** -- Reference implementation: discover -> research -> request_quote -> evaluate
- **Policy Engine** -- Pure, LLM-independent evaluator: budget, floor price, categories, stock, negotiation rounds, HITL threshold
- **XAI Ledger** -- Append-only audit trail with reasoning summaries for every material action
- **Merchant Console** -- Next.js dashboard: activity feed, approval queue, catalog management, growth insights
- **Payment Integration** -- Razorpay test-mode with webhook reconciliation and refund support
- **Evaluation Framework** -- 7 deterministic scenarios covering valid purchase, denial, HITL, payment failure, idempotency

---

## Architecture

### High-Level System Architecture

```mermaid
graph TB
    subgraph HumanLayer["Human Layer"]
        BUYER_HUMAN["Buyer Human"]
        MERCHANT_HUMAN["Merchant Operator"]
    end

    subgraph Frontend["Frontend"]
        MERCHANT_CONSOLE["Merchant Console\nNext.js 16 / React 19 / Tailwind 4"]
    end

    subgraph AgentLayer["Agent Layer"]
        BUYER_AGENT["Buyer Agent\nLangGraph State Machine"]
        SELLER_AGENT["Seller Agent\nLangGraph State Machine"]
    end

    subgraph Gateway["Gateway & Discovery"]
        AGENT_GATEWAY["Agent Gateway\nagents.json / llms.txt / catalog.ai.json"]
        AUTH["HMAC Signed-Key Auth"]
    end

    subgraph CommerceCore["Commerce Core"]
        CATALOG["Catalog Service"]
        QUOTE["Quote Engine"]
        ORDERS["Order State Machine"]
        CONSENT["Consent Service"]
        REFUNDS["Refund Service"]
    end

    subgraph PolicyTrust["Policy & Trust"]
        POLICY_ENGINE["Policy Engine\nDeterministic / LLM-Independent"]
        XAI_LEDGER["XAI Ledger\nAppend-Only Audit Trail"]
    end

    subgraph PaymentRail["Payment Rail"]
        RAZORPAY["Razorpay Adapter\nTest Mode / Webhooks / HMAC Verification"]
    end

    subgraph Infrastructure["Infrastructure"]
        DB[("PostgreSQL / SQLite")]
        DOCKER["Docker"]
        CI["GitHub Actions CI"]
    end

    BUYER_HUMAN -->|"talks to"| BUYER_AGENT
    MERCHANT_HUMAN -->|"manages via"| MERCHANT_CONSOLE

    BUYER_AGENT <-->|"A2A Protocol"| AGENT_GATEWAY
    AGENT_GATEWAY --> AUTH
    AUTH --> SELLER_AGENT

    SELLER_AGENT --> CATALOG
    SELLER_AGENT --> QUOTE
    QUOTE --> POLICY_ENGINE

    ORDERS --> CONSENT
    CONSENT --> RAZORPAY
    RAZORPAY -->|"webhook"| ORDERS

    ORDERS --> XAI_LEDGER
    POLICY_ENGINE --> XAI_LEDGER
    CONSENT --> XAI_LEDGER
    SELLER_AGENT --> XAI_LEDGER

    CATALOG --> DB
    ORDERS --> DB
    CONSENT --> DB
    XAI_LEDGER --> DB

    MERCHANT_CONSOLE -->|"API calls"| ORDERS
    MERCHANT_CONSOLE -->|"reads"| XAI_LEDGER
```

### Transaction Lifecycle

```mermaid
sequenceDiagram
    participant Buyer as Buyer Agent
    participant Gateway as Agent Gateway
    participant Seller as Seller Agent
    participant Policy as Policy Engine
    participant Consent as Consent Service
    participant Razorpay as Razorpay
    participant Ledger as XAI Ledger

    Buyer->>Gateway: Discover merchant (agents.json)
    Gateway-->>Buyer: Merchant manifest + catalog
    Buyer->>Gateway: Search catalog
    Gateway->>Seller: Forward request
    Seller->>Policy: Evaluate quote
    Policy-->>Seller: ALLOW / DENY / NEEDS_HUMAN
    Seller->>Ledger: Record quote event
    Seller-->>Buyer: Quote + cart

    opt Bounded Negotiation (max 5 rounds)
        Buyer->>Gateway: Counter-offer
        Gateway->>Seller: Forward negotiation
        Seller->>Policy: Re-evaluate
        Policy-->>Seller: Decision
        Seller->>Ledger: Record negotiation event
        Seller-->>Buyer: Updated quote
    end

    Buyer->>Gateway: Accept quote
    Gateway->>Consent: Issue single-use consent
    Consent->>Ledger: Record consent event
    Consent-->>Buyer: Consent token

    Buyer->>Gateway: Initiate payment
    Gateway->>Razorpay: Create order + payment link
    Razorpay-->>Buyer: Payment URL

    Buyer->>Razorpay: Complete payment
    Razorpay->>Razorpay: HMAC webhook
    Razorpay->>Gateway: Signed webhook
    Gateway->>Razorpay: Verify signature
    Gateway->>Consent: Mark consent consumed
    Gateway->>Ledger: Record payment event

    opt Refund
        Buyer->>Gateway: Request refund
        Gateway->>Razorpay: Process refund
        Razorpay-->>Gateway: Refund confirmed
        Gateway->>Ledger: Record refund event
    end
```

### Core Transaction State Machine

```mermaid
stateDiagram-v2
    [*] --> QUOTED
    QUOTED --> AWAITING_CONSENT : buyer accepts quote
    AWAITING_CONSENT --> CONSENTED : consent issued
    CONSENTED --> PAYMENT_PENDING : payment initiated
    PAYMENT_PENDING --> PAID : webhook confirmed
    PAYMENT_PENDING --> PAYMENT_FAILED : webhook failure
    PAYMENT_FAILED --> PAYMENT_PENDING : retry
    PAID --> FULFILLED : order complete
    CONSENTED --> ABORTED : buyer cancels
    PAID --> REFUNDED : refund processed
    AWAITING_CONSENT --> ABORTED : timeout/cancel
```

### Agent Interaction Flow

```mermaid
graph LR
    subgraph BuyerAgent["Buyer Agent"]
        B1[Discover] --> B2[Research]
        B2 --> B3[Request Quote]
        B3 --> B4[Evaluate]
        B4 -->|counter| B3
        B4 -->|accept| B5[Pay]
    end

    subgraph SellerAgent["Seller Agent"]
        S1[Search Catalog] --> S2[Create Quote]
        S2 --> S3[Consider Upsell]
        S3 --> S4[Format Response]
    end

    subgraph PolicyEngine["Policy Engine"]
        P1[Budget Check] --> P2[Floor Price]
        P2 --> P3[Category Check]
        P3 --> P4[Stock Check]
        P4 --> P5[Decision]
    end

    B3 <-->|"A2A Protocol"| S1
    S2 --> P1
    S3 --> P1
```

### Merchant Console Dashboard

```mermaid
graph TB
    subgraph DashboardPages["Dashboard Pages"]
        HOME["Home"]
        ACTIVITY["Activity Feed"]
        TRANSACTIONS["Transactions"]
        APPROVALS["Approvals"]
        CATALOG["Catalog"]
        GROWTH["Growth"]
        SETTINGS["Settings"]
        STOREFRONT["Storefront"]
    end

    subgraph Components["Components"]
        SIDEBAR["Sidebar Navigation"]
        TOPBAR["Top Bar"]
        ORDER_FEED["Order Feed"]
        LEDGER_VIEW["Ledger View"]
        METRIC_CARDS["Metric Cards"]
        POLICY_PANEL["Policy Panel"]
        HEALTH["Health Indicator"]
    end

    HOME --> ACTIVITY
    HOME --> TRANSACTIONS
    HOME --> APPROVALS
    HOME --> CATALOG
    HOME --> GROWTH
    HOME --> SETTINGS
    HOME --> STOREFRONT

    ACTIVITY --> ORDER_FEED
    TRANSACTIONS --> LEDGER_VIEW
    APPROVALS --> POLICY_PANEL
    GROWTH --> METRIC_CARDS
```

---

## Quick Start

### Prerequisites

- **Python 3.11+**
- **Node.js 18+** (for Merchant Console)
- **Razorpay test-mode keys** (optional, for payment integration)

### 1. Clone & Install

```bash
git clone https://github.com/sellable/sellable.git
cd sellable

# Backend
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"

# Frontend
cd apps/merchant-console
npm install
cd ../..
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your Razorpay test credentials:

```env
SELLABLE_ENVIRONMENT=development
DATABASE_URL=sqlite:///data/sellable.db
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

### 3. Run the Backend

```bash
python -m uvicorn sellable.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Run the Merchant Console

```bash
cd apps/merchant-console
npm install
npm run dev
```

The console runs at `http://localhost:3000` and connects to the backend at
`http://localhost:8000`. In local demo mode (no `NEXT_PUBLIC_SUPABASE_URL`), the
console authenticates with the public demo key automatically; with Supabase
configured, sign in at `/login` and the dashboard routes are protected.

### 5. Verify

```bash
# Health check
curl http://localhost:8000/health

# Run tests
python -m pytest

# Open Merchant Console
open http://localhost:3000
```

---

## API Reference

### Discovery

| Endpoint | Method | Description |
|---|---|---|
| `/.well-known/agents.json` | GET | Agent manifest for AI buyer discovery |
| `/llms.txt` | GET | Machine-readable merchant description |
| `/catalog.ai.json` | GET | Full product catalog for agents |

### Agent APIs

| Endpoint | Method | Description |
|---|---|---|
| `/agent/seller/respond` | POST | Seller agent processes buyer requests |
| `/agent/catalog.search` | POST | Search products by query/category |
| `/agent/catalog.get` | POST | Fetch a product by SKU |
| `/agent/quotes.create` | POST | Create a price quote |
| `/agent/quotes.negotiate` | POST | Bounded price negotiation |
| `/agent/consents.request` | POST | Issue transaction-bound, single-use consent |
| `/agent/orders.create` | POST | Create an order (idempotent) |
| `/agent/orders.status` | POST | Query authoritative order state |
| `/agent/refunds.create` | POST | Issue a refund for a paid order |
| `/agent/buyer/run` | POST | Run the reference buyer agent end-to-end |

### Payments

| Endpoint | Method | Description |
|---|---|---|
| `/orders/{id}/payment` | POST | Initiate Razorpay payment |
| `/orders/{id}/payment/retry` | POST | One bounded, idempotent retry after a verified failure |
| `/webhooks/razorpay` | POST | Receive signed webhook |
| `/orders/{id}/refund` | POST | Process refund (merchant auth) |

### Merchant Console

| Endpoint | Method | Description |
|---|---|---|
| `/console/transactions` | GET | Transaction list |
| `/console/events` | GET | XAI Ledger events |
| `/activity/stream` | GET | SSE live ledger stream |
| `/agents/status` | GET | Agent + payment-rail health |
| `/console/approvals` | GET | Pending approval queue |
| `/console/approvals/{id}/approve` | POST | Approve pending action (merchant auth) |
| `/console/approvals/{id}/reject` | POST | Reject pending action (merchant auth) |
| `/console/insights` | GET | Growth metrics |
| `/console/policy` | GET/PUT | Read/update merchant policy (PUT requires merchant auth) |
| `/catalog/products` | POST | Add a catalog product (merchant auth) |

---

## Authentication

SELLABLE keeps two auth surfaces separate:

- **Human merchants** -- Supabase Auth. The Next.js console has a `/login` page
  and a middleware that protects every `/dashboard/*` route. When Supabase is
  not configured the console runs in demo mode. Backend privileged actions
  (`approve`, `reject`, `refund`, policy updates, catalog writes) resolve the
  authenticated merchant from the Supabase access token and verify ownership.
- **Buyer agents** -- API key + HMAC request signing. Agent calls authenticate
  with `X-Agent-Key` (demo) or an HMAC-SHA256 signature over
  `timestamp.nonce.agent_id.method.path` with `X-Timestamp`, `X-Nonce`, and
  `X-Signature` headers, including server-side replay protection. Only a
  SHA-256 hash of the long-lived key is stored (`BUYER_AGENT_API_KEY_HASH`).

The model layer is provider-agnostic via `get_llm()` (`agents/llm/`). Changing
`LLM_PROVIDER`/`LLM_MODEL` in `.env` never touches policy, commerce, consent,
payments, the ledger, or the console.

---

## Project Structure

```
sellable/
├── agents/                     # LangGraph agent implementations
│   ├── buyer/                  #   Buyer agent (reference implementation)
│   ├── llm/                    #   LLM adapter layer (OpenAI, Anthropic, mock)
│   └── seller/                 #   Seller agent (bounded by policy)
├── apps/
│   └── merchant-console/       # Next.js 16 dashboard
│       ├── app/                #   App router pages
│       ├── components/         #   React components
│       ├── lib/                #   API client, types, utils
│       └── public/             #   Static assets (logo, favicon)
├── data/                       # SQLite dev database
├── docs/                       # Comprehensive documentation
│   ├── API.md                  #   Full API reference
│   ├── ARCHITECTURE_GUIDE.md   #   Architecture deep-dive
│   ├── DATABASE.md             #   Database schema
│   ├── DEMO.md                 #   5-minute demo script
│   └── DEPLOYMENT.md           #   Deployment guide
├── evals/                      # Deterministic evaluation scenarios
│   ├── runner/                 #   Scenario runner
│   └── scenarios/              #   7 test scenarios
├── infra/                      # Infrastructure configs
│   ├── docker/                 #   Dockerfile
│   ├── seed/                   #   Catalog + policy fixtures
│   └── webhook/                #   zrok tunnel launcher
├── services/commerce/sellable/ # Python backend
│   ├── main.py                 #   FastAPI application
│   ├── core.py                 #   CommerceCore orchestrator
│   ├── contracts.py            #   Pydantic models & enums
│   ├── policy.py               #   Deterministic policy engine
│   ├── orders.py               #   Order state machine
│   ├── consent.py              #   Single-use consent service
│   ├── gateway.py              #   Agent Gateway
│   ├── auth.py                 #   HMAC signed-key auth
│   ├── ledger/                 #   XAI Ledger
│   └── payments/               #   Razorpay adapter
└── tests/                      # Test suite
    ├── unit/                   #   Unit tests
    ├── integration/            #   Integration tests
    └── e2e/                    #   End-to-end tests
```

---

## Safety Invariants

These are **non-negotiable**. Every component enforces them:

| Invariant | Enforcement |
|---|---|
| Integer paise only | Pydantic models validate `int` for all money fields |
| No float money | Static analysis + tests reject float amounts |
| `trace_id` everywhere | Every API call and ledger event carries a trace ID |
| Ledger audit trail | Every material action emits a `LedgerEvent` with reasoning |
| Policy independence | Policy engine, consent, orders, payments are isolated from LLM code |
| Webhook authority | Only Razorpay webhooks can mark orders as PAID |
| Single-use consent | Consent tokens are consumed on use, never reusable |
| HMAC verification | All Razorpay webhooks are SHA-256 signature verified |
| Deterministic state machine | Invalid order transitions are rejected at the core level |

---

## Evaluation Scenarios

The `evals/` directory contains 7 deterministic scenarios:

| Scenario | What It Tests |
|---|---|
| `valid_purchase` | Happy path: search -> quote -> consent -> payment -> fulfilled |
| `below_floor` | Denies quotes below merchant floor price |
| `over_budget` | Denies orders exceeding buyer budget |
| `hitl` | Routes high-value orders to human approval |
| `payment_failure` | Handles Razorpay payment failures gracefully |
| `duplicate_webhook` | Idempotent webhook processing |
| `duplicate_consent` | Single-use consent enforcement |

```bash
# Run all evaluation scenarios
python -m evals.runner
```

---

## Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Complete system architecture & design decisions |
| [ARCHITECTURE_GUIDE.md](docs/ARCHITECTURE_GUIDE.md) | Architecture deep-dive for developers |
| [API.md](docs/API.md) | Full API reference with examples |
| [DATABASE.md](docs/DATABASE.md) | Database schema & migrations |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Domain model reference |
| [DEMO.md](docs/DEMO.md) | 5-minute demo walkthrough |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment guide |
| [LEDGER.md](docs/LEDGER.md) | XAI Ledger documentation |
| [POLICY_ENGINE.md](docs/POLICY_ENGINE.md) | Policy engine deep-dive |
| [TESTING.md](docs/TESTING.md) | Testing strategy & conventions |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common issues & fixes |
| [SECURITY.md](SECURITY.md) | Security policy & vulnerability reporting |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [WORKFLOW.md](WORKFLOW.md) | AI buyer workflow documentation |

---

## Tech Stack

**Backend**
- Python 3.11+
- FastAPI
- LangGraph
- Pydantic v2
- SQLAlchemy 2.0
- SlowAPI (rate limiting)
- Uvicorn

**Frontend**
- Next.js 16 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS 4
- Lucide Icons
- Geist Font

**Data & Payments**
- SQLite (dev) / PostgreSQL 16 (prod)
- Razorpay SDK (test mode)
- HMAC webhook verification

**DevOps & Testing**
- Docker + Docker Compose
- GitHub Actions CI
- pytest + httpx
- zrok v2 (tunneling)

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit with conventional format: `feat: add new feature`
4. Push and open a Pull Request

All PRs must pass CI (Python 3.11/3.12 matrix), maintain test coverage, and follow the existing code conventions.

---

## License

MIT License -- see [LICENSE](LICENSE) for details.

---

<div align="center">

**2026 SELLABLE. Agentic Commerce Infrastructure.**

</div>
