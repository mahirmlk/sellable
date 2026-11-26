# Staging Sandbox Runbook

This runbook deploys the backend as a separate Cloudflare Worker and Container. It is for Razorpay **Test Mode** only. It must use an isolated Supabase staging project and must never point at production data. No production Worker or Vercel production variables are changed by these steps.

The staging config is `wrangler.staging.jsonc`; its worker name and Durable Object namespace are separate from production. `SELLABLE_ENVIRONMENT=staging` keeps production security checks enabled while allowing only the test Razorpay key prefix.

## Prerequisites

- Cloudflare Containers and Durable Object scheduling are enabled for the account.
- Confirm the account can use Containers with the `durable_object` scheduling policy, which Cloudflare currently documents as public beta. This policy is immutable for a Container application: changing it requires a replacement application and a new Durable Object class/namespace. Keep staging and production namespaces separate, and validate the selected policy before the first deployment.
- A disposable Supabase staging project with Auth enabled and a PostgreSQL pooler URL that uses TLS. Format `DATABASE_URL` for this service as `postgresql+psycopg://...` and include `sslmode=require` (or `verify-ca`/`verify-full`); plain `postgresql://` URLs fail the production startup check.
- A Razorpay account with **Test Mode** enabled and a webhook endpoint reachable from Razorpay.
- A Vercel preview or staging deployment configured against the staging API and staging Supabase project.
- Node.js, npm, Docker, and Wrangler access from the deployer environment.

The API needs the exact HTTPS origin for the staging console. Replace `https://staging.sellable.shop` in the staging config if the Vercel staging origin differs. Never add a wildcard or production origin to a staging allowlist.

## Deploy the isolated backend

From the repository root:

```bash
npm ci
npx wrangler login
npx wrangler whoami
```

Generate fresh agent credentials in a private, unlogged terminal and copy the output directly into your secret manager. The bootstrap plaintext is for the operator only; the Worker receives only its SHA-256 hash. The merchant-scoped purchase key is issued later from the console.

```bash
python3 - <<'PY'
import hashlib
import secrets

bootstrap_key = secrets.token_urlsafe(32)
hmac_secret = secrets.token_urlsafe(32)
print(f"bootstrap_key (operator only): {bootstrap_key}")
print(f"BUYER_AGENT_API_KEY_HASH: {hashlib.sha256(bootstrap_key.encode()).hexdigest()}")
print(f"BUYER_AGENT_HMAC_SECRET: {hmac_secret}")
PY
```

Store staging-only credentials as secrets on the staging Worker. Do not use the production Supabase URL, production service-role key, or live payment keys.

```bash
npx wrangler secret put DATABASE_URL --config wrangler.staging.jsonc
npx wrangler secret put SUPABASE_URL --config wrangler.staging.jsonc
npx wrangler secret put SUPABASE_ANON_KEY --config wrangler.staging.jsonc
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config wrangler.staging.jsonc
npx wrangler secret put BUYER_AGENT_API_KEY_HASH --config wrangler.staging.jsonc
npx wrangler secret put BUYER_AGENT_HMAC_SECRET --config wrangler.staging.jsonc
npx wrangler secret put RAZORPAY_KEY_ID --config wrangler.staging.jsonc
npx wrangler secret put RAZORPAY_KEY_SECRET --config wrangler.staging.jsonc
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET --config wrangler.staging.jsonc
```

`RAZORPAY_KEY_ID` must start with `rzp_test_`. `BUYER_AGENT_API_KEY_HASH` must be a lowercase 64-character SHA-256 hex digest of a random staging-only bootstrap key; `BUYER_AGENT_HMAC_SECRET` must contain at least 32 UTF-8 bytes. Keep the bootstrap plaintext key in the operator secret manager and do not use it for the merchant purchase flow: the static key selects the platform demo merchant. Give the HMAC secret to the external test agent through a secret manager. For the purchase flow, issue a separate merchant-scoped key in the console and use that key with the HMAC signature. Keep all plaintext credentials out of browser code and this repository.

Deploy and record the generated staging Worker URL:

```bash
npm run cf:deploy:staging
```

Set the Vercel **preview/staging** environment's `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SITE_URL` to staging values, then redeploy that preview. Do not edit the Vercel production environment as part of staging verification.

## Configure Razorpay Test Mode

In the Razorpay dashboard, explicitly select **Test Mode** and create a webhook for:

```
https://<staging-worker-host>/webhooks/razorpay
```

Use the same webhook secret as the staging Worker's `RAZORPAY_WEBHOOK_SECRET`. Subscribe to `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, and `refund.failed`. Confirm the webhook URL is the staging Worker host, not the production API.

Use Razorpay's official [Payment Links test flow](https://hdfcbank-collectnow-docs.razorpay.com/payments/payment-links/create/) to open the hosted link and select the test success or failure outcome. Use no live credentials or real payment instrument.

## Reproduce the sandbox flow

For exact request signing headers and the canonical HMAC format, follow [`docs/AGENT_INTEGRATION.md`](AGENT_INTEGRATION.md). That guide matches the current staging API and requires the raw query and request-body hash for signed writes.

1. Open the Vercel staging console and sign in with a staging Supabase test user.
2. Complete merchant onboarding, create a test product, and publish the catalog. Record the returned merchant ID and confirm the product appears at `/catalog.ai.json?merchant=<merchant_id>`.
3. Issue a merchant-scoped API key in the console. Give the staging external agent that key and the staging HMAC signing secret through a secret manager.
4. From a separate external-agent process, fetch `/.well-known/ucp?merchant=<merchant_id>`, `/.well-known/agents.json?merchant=<merchant_id>`, and `/catalog.ai.json?merchant=<merchant_id>`; negotiate capabilities using the merchant-scoped key, discover the product, and create a cart.
5. Have the agent request checkout authorization and an order using stable idempotency keys. A human must review the exact merchant, item, amount, and spend mandate and issue single-use consent. Start payment only with that consent.
6. Open the returned Razorpay payment URL and complete checkout using Razorpay Test Mode values. Do not treat a browser return URL as proof of payment.
7. Wait for the signed `payment.captured` webhook. Confirm the staging order is `PAID`, then fetch `GET /orders/{order_id}/receipt` with the merchant-scoped agent key. The receipt must include the provider reference, amount, authorization reference, and trace ID.
8. As the test merchant owner, issue a full refund with a stable `idempotency_key` through `POST /orders/{order_id}/refund`. Repeat the identical request once and confirm it returns the same local refund ID. If Razorpay reports the refund as pending, verify the order stays `PAID` until the signed `refund.processed` event arrives; only then should it become `REFUNDED`.
9. Redeliver the refund webhook from Razorpay's dashboard and confirm the order remains `REFUNDED` with one settlement ledger event. Redeliver the payment webhook and confirm the order still has one payment settlement event.

The committed CI tests and evals use fake providers and in-memory databases; they prove deterministic business rules, not Razorpay behavior. `tests/unit/test_external_agent_sandbox_flow.py` also uses a fake Razorpay rail. Only this staging procedure proves the provider boundary.

## Monitor and recover

- Check `GET /health`, `GET /ready`, and the staging merchant's onboarding readiness before checkout.
- In Cloudflare, inspect Worker logs, Container status, scheduled heartbeat logs, and error rates. In Supabase, inspect staging database/Auth logs. In Razorpay Test Mode, inspect payment and webhook delivery attempts.
- If checkout remains `PAYMENT_PENDING`, inspect Razorpay's Test Mode payment and webhook delivery records. Retry delivery after verifying the URL and secret. Never manually mark an order paid.
- Every unpaid order holds stock for 15 minutes from creation. The maintenance sweep aborts consent-stage orders directly; for payment-pending/failed orders it first reconciles the Razorpay link and cancels any payable link. Cancellation is confirmed only when Razorpay returns the same payment-link ID with a terminal `cancelled` or `expired` status; a bare successful HTTP response, malformed result, mismatched ID, or still-payable status is ambiguous. In those cases the order remains held for retry or manual reconciliation. Never release its reservation directly in the database.
- If a refund is `initiated`/pending, do not treat it as settled. Pending amounts remain reserved and the order remains `PAID` until the signed provider status event reports `processed`.
- If a signed refund event cannot be matched to a local request, the endpoint returns 409 instead of acknowledging it. Check Cloudflare logs and the Razorpay Test Mode refund details/notes, repair the missing correlation through the same stable idempotency key, then retry delivery. Do not manually mark a refund processed.
- Retry a request only with the same idempotency key and identical parameters. If provider state is ambiguous, inspect the provider's Test Mode record before attempting a different refund.
- Before rolling back across a release that introduced inventory reservations, stop new staging checkouts, cancel and verify every open Razorpay Test Mode link, and reconcile in-flight payment webhooks. Confirm there are no payable pending/failed orders before switching to a version that does not understand reservation state. If link cancellation or payment state is ambiguous, keep the reservation-aware version running and reconcile forward; do not restore stock manually. After a safe rollback, verify `/ready` and the staging webhook endpoint again. Keep staging database and provider records disposable and separate from production.

## Release evidence checklist

- [ ] Cloudflare staging Worker deployed and healthy.
- [ ] Vercel staging console points only to staging API and Supabase.
- [ ] Test merchant onboarded and catalog published.
- [ ] External agent discovery, negotiation, consent, and payment completed.
- [ ] Signed Razorpay test webhook verified; receipt checked.
- [ ] Test refund processed by signed refund webhook; identical request retry and webhook replay did not duplicate it.
- [ ] Payment webhook replay did not duplicate payment settlement.
