# Changelog

All notable changes to SELLABLE will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- LLM provider abstraction (`agents/llm/`) — `get_llm()` factory with openai, openrouter, anthropic, google, and mock adapters
- Buyer agent state/policies/prompts/graph modules (`agents/buyer/{state,policies,prompts,graph}.py`) with explicit financial guardrails
- Buyer agent now completes the order + consent steps (`order_id`/`consent_id` in `BuyerResult`)
- Agent endpoints: `/agent/consents.request`, `/agent/orders.create`, `/agent/orders.status`, `/agent/refunds.create`
- Dashboard aliases per §48: `/transactions`, `/transactions/{id}`, `/transactions/{id}/events`, `/approvals`, `/activity`, `/growth`, `/agents/status`
- `POST /orders/{order_id}/payment/retry` — one bounded, idempotent retry with `retry.started`/`retry.failed`/`retry.aborted` events
- SSE live ledger stream `/activity/stream`
- `POST /catalog/products` (merchant session required)
- Merchant authentication (`merchant_auth.py`) — Supabase access-token verification with offline HS256, role/exp validation, and dev fallback
- Supabase/Postgres support: `Boolean` columns, Postgres driver extra, and startup schema migration
- Merchant console login page + route protection middleware (demo mode when Supabase is unset)

### Changed
- `config.py` — full §55.13 env shape (LLM, Supabase, agent auth, CORS origins)
- Console endpoints now require a merchant session instead of the buyer-agent key
- `/agent/refunds.create` now requires a merchant session
- HMAC request signing now binds the request body SHA-256 and query string (via `RequestBodyCaptureMiddleware`)
- Orders above the human-approval threshold are created in a held state (`requires_approval`) and routed to the console approval queue; consent is gated until merchant approval
- Policy updates re-validate cross-field constraints
- Payment webhook refuses to settle when the captured amount mismatches the order
- Order transitions are idempotent (duplicate webhooks are no-ops, not 500s)
- Refund/reject state is persisted

### Security
- Demo API key is only accepted outside `SELLABLE_ENVIRONMENT=production`
- CORS restricted to configured origins (default localhost:3000)
- Event list limit clamped to 500; webhook amount mismatch rejected; single consent per order enforced
- `.env.example` documents the full §55.13 shape

### Added (scaffold)
- Repository restructure to match target directory layout
- `agents/seller/tools.py` — extracted `SellerTools` class
- `agents/buyer/tools.py` — extracted `BuyerTools` class
- `sellable/auth.py` — HMAC signed-key authentication for agent endpoints
- `sellable/refunds.py` — refund service with ledger integration
- `/orders/{id}/refund` API endpoint
- `X-Agent-Key` header auth on agent-facing endpoints
- 7 eval scenarios with real implementations (valid_purchase, below_floor, over_budget, hitl, payment_failure, duplicate_webhook, duplicate_consent)
- `evals/runner/scenario_runner.py` — eval harness with report output
- `infra/docker/Dockerfile` — container definition
- `infra/webhook/start-tunnel.ps1` — webhook tunnel script
- `tests/integration/` — full-stack API tests
- `tests/e2e/` — end-to-end flow tests
- `docs/DEMO.md` — 5-minute demo script
- `docs/PLAN.md` — build plan (moved from root)
- `docs/INCIDENTS.md` — incident log (moved from root)
- `SECURITY.md` — security policy
- `CONTRIBUTING.md` — contribution guidelines
- `CHANGELOG.md` — this file

### Changed
- `agents/seller/agent.py` — imports `SellerTools` from `tools.py`
- `agents/buyer/agent.py` — imports `BuyerTools` from `tools.py`
- `sellable/main.py` — added refund endpoint, auth dependencies
- `ARCHITECTURE.md` — updated repo layout section
- Tests updated to include `X-Agent-Key` header

### Removed
- Duplicate `sellable_commerce.egg-info` from root
- Root `PLAN.md` (moved to `docs/`)

## [0.1.0] - 2026-08-28

### Added
- Phase 0–3: Commerce core, seller agent, Razorpay integration, buyer agent
- Deterministic policy engine with floor price, budget, category, and HITL checks
- Single-use transaction-bound consent model
- Append-only XAI ledger with `reasoning_summary` on every event
- LangGraph seller agent with catalog grounding and bounded negotiation
- Reference buyer agent proving A2A discovery and quote loop
- Agent Gateway with `/.well-known/agents.json`, `llms.txt`, `catalog.ai.json`
- Razorpay test-mode adapter with signature-verified webhook reconciliation
- Idempotent order creation and payment processing
- Seed catalog with 10 products and merchant policy
- 22 unit tests covering core contracts, policy, consent, payments, and agents
