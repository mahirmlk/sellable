# Deployment Guide

## Live Production Topology

The buildathon demo runs on three managed services. The frontend points to the
Railway backend (no localhost dependency in production).

| Service | Provider | Purpose | URL |
|---------|----------|---------|-----|
| Merchant Console | Vercel | Next.js frontend | `https://sellable.shop` |
| Commerce Core | Railway | FastAPI backend | `https://api.sellable.shop` |
| Postgres + Auth | Supabase | Database + merchant login | project `cptkhacsfmycjxxbufkx` |
| Payments | Razorpay | Test-mode payment rail | — |

Razorpay webhooks point at the Railway backend:
`https://api.sellable.shop/webhooks/razorpay`
(subscribed to `payment.captured` and `payment.failed`).

---

## Local Development

```bash
# Install
python -m pip install -e ".[dev]"

# Configure
cp .env.example .env
# Edit .env with Razorpay test credentials, LLM key, Supabase values

# Run backend
python -m uvicorn sellable.main:app --reload

# Run frontend
cd apps/merchant-console
npm install
npm run dev

# Test
python -m pytest
python -m evals.runner
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SELLABLE_ENVIRONMENT` | No | `development` or `production` |
| `DATABASE_URL` | Yes (prod) | Supabase pooler URL: `postgresql+psycopg://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require` |
| `SUPABASE_URL` | Yes (prod) | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes (prod) | Supabase anon/publishable key (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (prod) | Server-only; never exposed to the browser |
| `SUPABASE_JWT_SECRET` | No | Enables offline JWT verification; empty uses online Auth API |
| `LLM_PROVIDER` | No | `mock` (default, offline) or `opencode` / `openrouter` / `openai` / `anthropic` / `google` |
| `LLM_MODEL` | No | e.g. `deepseek-v4-flash` (OpenCode Zen) |
| `LLM_API_KEY` | Yes (real LLM) | Provider credential (server-only) |
| `RAZORPAY_KEY_ID` | Yes | Razorpay test-mode key ID |
| `RAZORPAY_KEY_SECRET` | Yes | Razorpay test-mode key secret |
| `RAZORPAY_WEBHOOK_SECRET` | Yes | Webhook signing secret |
| `BUYER_AGENT_API_KEY_HASH` | Yes (prod) | SHA-256 hashes of agent API keys |
| `BUYER_AGENT_HMAC_SECRET` | Yes (prod) | HMAC request-signing secret |
| `SELLABLE_ACP_ENABLED` | No | `1`/`true`/`yes` exposes the ACP scaffold (`/acp/*`); default off. No partner placement implied |
| `CORS_ORIGINS` | Yes (prod) | Comma-separated frontend origins, e.g. `https://sellable.shop,https://www.sellable.shop` |

**Never commit `.env` with real credentials.**

**Demo key vs remote data.** Demo-key sessions (console `_dev_session` and
agent-gateway static keys) are refused with `auth_not_configured` (401) when
the backend points at a remote database — even in `development`. Never
combine `SELLABLE_ENVIRONMENT=development` with a production `DATABASE_URL`;
use local SQLite for demo work, or configure Supabase on both sides.

**Production CORS is mandatory, not optional.** `CORS_ORIGINS` must list the
exact frontend origin(s) (e.g. `https://sellable.shop,https://www.sellable.shop`);
bare `"*"`/`"null"` values are rejected at startup. The built-in localhost
defaults in `config.py` exist for local development only. Production startup
fails when `CORS_ORIGINS` is omitted, and it also refuses SQLite so a copied
example configuration cannot silently use an ephemeral container database.
The production `DATABASE_URL` must also set `sslmode=require` or a stronger
certificate-verifying mode (`verify-ca` or `verify-full`) to prevent a
plaintext fallback for PostgreSQL connections.

At startup, the backend enables RLS on its PostgreSQL tables and revokes table
and sequence privileges from Supabase's `anon`, `authenticated`, and `PUBLIC`
roles, including default privileges for new tables. Browser clients use
Supabase Auth only; business data is served by the authenticated backend API.
The backend database owner and server-only service role retain their access.

Merchant-configured REST connectors and webhook subscriptions may only call
public HTTPS destinations in production. Private, loopback, link-local, and
reserved addresses are blocked after DNS resolution and again at connect time;
redirects are disabled so integration credentials and webhook signatures are
not forwarded to another host. Local HTTP integrations remain available only
in `development` and `test` environments.

The first production release must run one Railway replica. Consent consumption
and payment-attempt serialization still depend on process-local locks; the app
rejects multiple workers but cannot detect multiple replicas. Do not scale the
service horizontally until those transitions are backed by atomic database
operations. Payment adapters remain test-mode only, so live-money launch is
blocked pending a separately approved provider implementation.

---

## LLM Providers

SELLABLE uses a provider-agnostic adapter (`agents/llm/`). The demo uses
**OpenCode Zen** with the free `mimo-v2.5-free` model:

```env
LLM_PROVIDER=opencode
LLM_MODEL=mimo-v2.5-free
LLM_API_KEY=sk-...   # OpenCode Zen key
```

- `LLM_PROVIDER=opencode` uses the OpenAI-compatible Zen endpoint
  (`https://opencode.ai/zen/v1`). Sending a Zen key to the OpenRouter endpoint
  fails with `401 Missing Authentication header`.
- `OPENROUTER_API_KEY` is used **only** when `LLM_PROVIDER=openrouter`.
- Default `LLM_PROVIDER=mock` keeps tests/evals offline and deterministic.
- If a non-mock provider is selected but `LLM_API_KEY` is missing, `/agents/status`
  reports **UNCONFIGURED** (it does not silently fall back to mock).
- `/agents/status` performs a cached, time-boxed connectivity probe; the seller
  agent falls back to deterministic phrasing if the LLM call fails, so the
  commerce flow never breaks.

---

## Deployment

### Backend — Railway

The repo is linked to Railway (project `sellable`, service `backend`). Pushing
to `main` auto-deploys via the Dockerfile:

```bash
git push origin main
```

`railway.json` uses the Dockerfile builder with a `/ready` healthcheck that
includes database, outbox, and active payment-provider configuration checks.
The container binds to Railway's injected `PORT` and uses `8000` only as a
local fallback; its Docker health check probes the same port.
Railway has deprecated this legacy config format and documents a hard cutoff of
December 1, 2026. Migrate it to `.railway/railway.ts` and verify the plan while
linked to the correct Railway project, environment, and backend service before
that date.

### Frontend — Vercel

Vercel projects (monorepo):

- `merchant-console` — Root Directory: `apps/merchant-console`, framework Next.js
- `commerce` — Root Directory: `services/commerce` (legacy Python backend)

Set the frontend env vars in Vercel:
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
and `NEXT_PUBLIC_SITE_URL`. Leave `NEXT_PUBLIC_AGENT_KEY` unset in production;
it is only for local demo builds and is embedded in browser JavaScript.

Supabase Auth must allow the console as a redirect target: set the project
Site URL to the console origin and add `{site}/auth/callback` (plus
`http://localhost:3000/auth/callback` for local dev) to the redirect
allowlist, or verification/recovery links will not complete sign-in.

### Database — Supabase

Tables are created automatically at startup by SQLAlchemy
(`ledger/database.py`). A `merchant_users` row links a Supabase Auth user to the
demo merchant (`mrc_demo_store`).

---

## Webhook Setup

In Razorpay **Test Mode**:

1. Webhook URL: `https://api.sellable.shop/webhooks/razorpay`
2. Secret: same value as `RAZORPAY_WEBHOOK_SECRET`
3. Events: `payment.captured`, `payment.failed`

Webhook delivery is idempotent — duplicate events are ignored and never double-
settle an order.

---

## Tunnel / zrok safety

`tools/zrok/` publishes a local backend to the public internet. Ops rule:
**never share a non-development backend.** Only a `SELLABLE_ENVIRONMENT=development`
backend running against local/scratch data may be shared, and a public share must
never point at production data, staging with real credentials, or any shared/prod
database. Treat a share URL with the same care as a credential: it bypasses the
network boundary even though auth gates still apply.

---

## Historical Demo Verification Checklist

The checked items below record prior demo and sandbox verification. They are
not a production launch approval; use the deployment constraints and release
gates above for the current candidate.

- [x] Frontend production build passes (Vercel)
- [x] Backend starts in production config (Railway, Docker)
- [x] Database schema applied (Supabase, auto-init)
- [x] Environment variables configured (Railway + Vercel)
- [x] Supabase Auth works (merchant login)
- [x] Agent authentication works (API key + HMAC)
- [x] Real LLM enabled (OpenCode Zen `deepseek-v4-flash`)
- [x] Seller Agent works (LLM-phrased, tool-grounded)
- [x] Buyer Agent works (A2A loop)
- [x] Agent Gateway works (agents.json / llms.txt / catalog.ai.json)
- [x] Razorpay Test Mode works
- [x] Public webhook works (Railway)
- [x] Webhook signature verification works
- [x] Duplicate webhook protection works
- [x] Successful payment works
- [x] Failed payment works (classified, bounded retry/abort)
- [x] Policy denial works
- [x] HITL approval works
- [x] Consent protection works (single-use)
- [x] Ledger replay works
- [x] Frontend reflects backend state
