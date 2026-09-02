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
| `CORS_ORIGINS` | Yes (prod) | Comma-separated frontend origins |

**Never commit `.env` with real credentials.**

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

`railway.json` uses the Dockerfile builder with a `/health` healthcheck.

### Frontend — Vercel

Vercel projects (monorepo):

- `merchant-console` — Root Directory: `apps/merchant-console`, framework Next.js
- `commerce` — Root Directory: `services/commerce` (legacy Python backend)

Set the frontend env vars in Vercel:
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_AGENT_KEY`.

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

## Production Checklist

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