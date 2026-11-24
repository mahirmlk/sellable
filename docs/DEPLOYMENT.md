# Deployment Guide

## Live Production Topology

The frontend is hosted on Vercel. The backend is a Dockerized FastAPI service
running in Cloudflare Containers, reached through a Cloudflare Worker and one
stable Durable Object instance. Supabase provides PostgreSQL and merchant auth.
Payments remain in sandbox/test mode.

| Service | Provider | Purpose | URL |
|---------|----------|---------|-----|
| Merchant Console | Vercel | Next.js frontend | `https://sellable.shop` |
| Commerce Core | Cloudflare Workers + Containers | FastAPI backend, one container instance | `https://api.sellable.shop` (after custom-domain setup) |
| Postgres + Auth | Supabase | Database + merchant login | project `cptkhacsfmycjxxbufkx` |
| Payments | Razorpay | Test-mode payment rail | — |

Razorpay webhooks point at the Cloudflare backend:
`https://api.sellable.shop/webhooks/razorpay`
(subscribed to `payment.captured` and `payment.failed`).

The Cloudflare Durable Object scheduling policy is currently documented as
public beta. This setup deliberately addresses one fixed Durable Object name
and starts one backend container; it does not autoscale. The Python service
still depends on process-local consent and payment-attempt locks. Confirm that
Containers and this beta scheduling policy are enabled for the Cloudflare
account before production traffic is moved.

Cloudflare documents that the Durable Object scheduling policy grants
processes root-equivalent Linux capabilities regardless of the Docker
`USER`. The image's `appuser` setting therefore does not provide a privilege
boundary in this policy. The backend does not execute arbitrary generated code;
keep it that way and do not treat this Container as an untrusted-code sandbox.

---

## Local Development

Install the locked development dependencies from the repository root:

```bash
python -m pip install --require-hashes -r requirements/runtime.txt -r requirements/dev.txt
python -m pip install --no-deps --no-build-isolation -e .
```

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
| `PAYMENT_PROVIDER` | No | `razorpay` by default; `razorpay` and `stripe` adapters are sandbox/test-only |
| `STRIPE_SECRET_KEY` | If Stripe selected | Stripe test-mode secret key; live keys are rejected |
| `STRIPE_WEBHOOK_SECRET` | If Stripe selected | Stripe test-mode webhook signing secret |
| `SHIPPING_WEBHOOK_SECRET` | No | Shared secret for inbound carrier status webhooks |
| `SMTP_HOST`, `SMTP_PORT` | No | Optional email relay; STARTTLS certificate verification is required |
| `SMTP_FROM`, `SMTP_RECIPIENTS` | No | Sender and comma-separated recipients for urgent notification emails |
| `SELLABLE_MAINTENANCE_WORKER` | No | Override production maintenance worker (`1` or `0`); defaults on in production |
| `SELLABLE_DEFAULT_PLAN` | No | Platform billing override; valid values are `FREE`, `GROWTH`, or `SCALE` |
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
Production startup also fails closed if required order-idempotency or active-session
unique indexes cannot be created; resolve duplicate legacy rows before deployment.

Merchant-configured REST connectors and webhook subscriptions may only call
public HTTPS destinations in production. Private, loopback, link-local, and
reserved addresses are blocked after DNS resolution and again at connect time;
redirects are disabled so integration credentials and webhook signatures are
not forwarded to another host. Local HTTP integrations remain available only
in `development` and `test` environments.

**Inventory reservation rollout gate.** Before deploying a version that enables
stock reservations over a database used by the previous backend, stop creating
new checkouts and use the previous backend to cancel every open Razorpay payment
link. Verify each cancellation with Razorpay and ensure its order reaches
`ABORTED`; if cancellation is ambiguous or fails, keep the previous backend
running and reconcile the payment outcome first. The new backend fails startup
when it finds any `PAYMENT_PENDING` or `PAYMENT_FAILED` order without an active
inventory reservation. Do not bypass this gate or accept a legacy link after
rollout; it could capture payment without reserving stock.

After rollout, every unpaid order holds stock for 15 minutes from order creation.
The maintenance sweep aborts consent-stage orders directly. For payment-pending
or payment-failed orders, it first reconciles the Razorpay link by the stable
order reference, cancels any payable link, and releases stock only after the
provider confirms the link is cancelled, expired, or absent. If the provider
cannot confirm that state, the order and stock hold remain for the next retry
or manual reconciliation.

The first production release must run one Cloudflare Container instance. Keep `WEB_CONCURRENCY` and `UVICORN_WORKERS` unset or set to `1`; startup rejects multiple workers while consent and payment-attempt transitions remain process-local. Consent consumption
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

### Backend — Cloudflare Workers + Containers

The Wrangler configuration at the repository root builds the existing
`Dockerfile` and deploys a Cloudflare Worker that forwards API traffic to a
single Durable Object-managed Container. The Container listens on port 8000,
uses `/ready` before accepting requests, and receives only an explicit
allowlist of backend settings and secrets. A five-minute Worker cron heartbeat
keeps the in-process maintenance worker alive. Production requests must use
HTTPS; the Worker forwards only Cloudflare's client IP, never a caller-supplied
`X-Forwarded-For` value.

Containers need outbound internet for Supabase, payment/LLM providers, SMTP,
and merchant-configured integrations. The application-level outbound guard
still blocks private, loopback, link-local, reserved, and multicast targets for
merchant-configured HTTP integrations and does not follow redirects.

#### Local Cloudflare development

Install Node.js 24, npm, and Docker. Copy `.dev.vars.example` to the ignored
`.dev.vars`, then start the Worker and Container:

```bash
npm ci
npm run cf:dev
```

The local vars file uses development mode and SQLite. Use the existing
`python -m uvicorn sellable.main:app --reload` command for ordinary backend
work that does not require the Cloudflare proxy.

#### Configure and deploy production

1. Confirm the Cloudflare account has Containers and the Durable Object
   Container API enabled. Configure the Worker custom domain
   `api.sellable.shop` in the Cloudflare zone after reviewing the deployment.
2. Configure `CORS_ORIGINS` in `wrangler.jsonc` to the exact live Vercel
   frontend origins.
3. Store credentials as Worker secrets; do not put them in `wrangler.jsonc`,
   `.dev.vars`, or the frontend bundle. At minimum, configure:

   ```bash
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_ANON_KEY
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put BUYER_AGENT_API_KEY_HASH
   npx wrangler secret put BUYER_AGENT_HMAC_SECRET
   npx wrangler secret put RAZORPAY_KEY_ID
   npx wrangler secret put RAZORPAY_KEY_SECRET
   npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
   ```

   Set optional secrets only when their feature is enabled, such as
   `SUPABASE_JWT_SECRET`, `LLM_API_KEY` or provider-specific LLM keys,
   `SHIPPING_WEBHOOK_SECRET`, `SELLABLE_ADMIN_API_KEY`, and SMTP settings.
   `DATABASE_URL` must use PostgreSQL with `sslmode=require` or stronger.
   Payment credentials must be sandbox/test credentials.
4. Authenticate Wrangler, then deploy from the repository root:

   ```bash
   npx wrangler login
   npx wrangler whoami
   npm run cf:deploy
   ```

   Wrangler builds the Docker image and Worker. Verify the Worker health and
   readiness routes, Container status, cron execution, and database logs before
   switching production traffic.
5. After the Cloudflare API URL is healthy, update the Vercel
   `NEXT_PUBLIC_API_URL` environment variable and redeploy the frontend.
   Update the Razorpay test webhook URL to the new backend address.

The Worker currently exposes a `workers.dev` hostname. Bind the production
custom domain in the Cloudflare dashboard (or add a reviewed route to
`wrangler.jsonc`) before setting Vercel and Razorpay to
`https://api.sellable.shop`. Retire or disable any old Vercel project that
served the Python backend after the Cloudflare API has passed health checks;
keep the Merchant Console project live.

The Container uses Cloudflare's `standard-1` profile as an initial capacity
setting. Review Cloudflare's current account pricing and observed memory/CPU
before production traffic; adjust the profile deliberately.

### Frontend — Vercel

Vercel projects (monorepo):

- `merchant-console` — Root Directory: `apps/merchant-console`, framework Next.js

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
- [ ] Cloudflare Worker + Container deployment verified in the target account
- [x] Database schema applied (Supabase, auto-init)
- [ ] Cloudflare Worker secrets and Vercel frontend variables configured
- [x] Supabase Auth works (merchant login)
- [x] Agent authentication works (API key + HMAC)
- [x] Real LLM enabled (OpenCode Zen `deepseek-v4-flash`)
- [x] Seller Agent works (LLM-phrased, tool-grounded)
- [x] Buyer Agent works (A2A loop)
- [x] Agent Gateway works (agents.json / llms.txt / catalog.ai.json)
- [x] Razorpay Test Mode works
- [ ] Razorpay test webhook works against the Cloudflare backend
- [x] Webhook signature verification works
- [x] Duplicate webhook protection works
- [x] Successful payment works
- [x] Failed payment works (classified, bounded retry/abort)
- [x] Policy denial works
- [x] HITL approval works
- [x] Consent protection works (single-use)
- [x] Ledger replay works
- [x] Frontend reflects backend state
