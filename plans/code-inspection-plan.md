# Code Inspection Implementation Plan
Project: Sellable | Stack: Python 3.11/3.12 FastAPI, Next.js, Supabase/PostgreSQL, Cloudflare Workers + Containers | Inspected: 2026-11-24
Files scanned: approximately 422 repository files | Domains covered: Bug, Security, Architecture, Dependencies, Deployment

## Deployment Verdict

BLOCKED — deterministic CI and sandbox hardening pass, but a clean, isolated Cloudflare/Vercel/Razorpay Test Mode staging run has not been performed. The staging account resources still need to be provisioned. Keep the service sandbox-only and do not enable live transactions.

## Executive Summary

The codebase now has draft changes covering SSRF controls, production configuration and database-index gates, pinned dependencies, Cloudflare deployment, Razorpay-only deployed provider selection, refund idempotency, readiness checks, and a staging runbook. CI has passed for the inspected draft changes, including Python tests/evals, frontend checks, and Cloudflare configuration validation. Those checks use fake providers and do not prove Cloudflare Container scheduling, Supabase staging migrations/index creation, Razorpay Test Mode checkout, signed webhook delivery, or provider refund behavior. Automatic refund webhook reconciliation remains unfinished. The first release also depends on one Cloudflare Container instance while consent and payment-attempt serialization use process-local locks.

The highest risk is treating the sandbox as production-proven before staging verifies the provider boundary and database constraints. The exploit/correctness paths compound when an external retry or duplicate webhook meets partially completed payment/refund state: local idempotency, provider idempotency, ledger settlement, and the order status must agree.

## P0 — Critical (must be resolved before staging is called proven)

### [P0-001] Complete isolated staging verification
- **Location:** `docs/STAGING_SANDBOX_RUNBOOK.md:3-12,65-75`
- **Finding:** The runbook explicitly requires a separate Cloudflare Worker/Container, disposable Supabase project, Razorpay Test Mode credentials, and Vercel preview. These resources have not yet been provisioned or exercised. CI mocks cannot establish that the real provider signatures, Cloudflare routing, or deployment secrets are wired correctly.
- **Action:** Provision isolated staging resources; execute onboarding, catalog publish, external-agent discovery/negotiation, one-time consent, Test Mode checkout, signed payment webhook, receipt retrieval, idempotent refund, and duplicate webhook replay. Record non-secret evidence for each step.
- **Acceptance:** The runbook checklist is complete, order and ledger state match the provider records, duplicate requests create no duplicate order/refund, and no production endpoint or live credential is used.

## P1 — High (resolve before broad production use)

### [P1-001] Finish and verify automatic refund status reconciliation
- **Location:** `docs/STAGING_SANDBOX_RUNBOOK.md:82`; `services/commerce/sellable/refunds.py`
- **Finding:** Pending refunds reserve refundable balance; only processed refunds count toward fully-refunded order status. The runbook also marks automatic refund-webhook reconciliation unfinished. Without that path, an asynchronous provider status change may remain pending locally until an operator retry or manual recovery.
- **Action:** Implement authenticated, replay-safe refund webhook reconciliation with provider-event idempotency and ledger uniqueness, or explicitly restrict the first release to operator-driven retry/reconciliation with documented alerts and recovery steps.
- **Acceptance:** Pending refunds keep the order PAID; partial completion remains PAID; only when all refundable balance is processed does the order become REFUNDED. Duplicate and out-of-order events are safe.

### [P1-002] Preserve the single-instance topology constraint
- **Location:** `docs/DEPLOYMENT.md` (production topology and first-release constraints); `cloudflare/worker.js` (fixed Durable Object name)
- **Finding:** Consent and payment-attempt transitions still use process-local locks. A fixed Durable Object name and one container are deliberate mitigations, not horizontal-scaling safety. Cloudflare's documented scheduling policy is currently public beta, and the runbook requires account enablement.
- **Action:** Before first deployment, confirm the account supports the selected Container/Durable Object policy and that the deployed topology really maintains one service instance. Keep autoscaling and multiple API replicas disabled. Plan atomic database transitions before scaling.
- **Acceptance:** Operational configuration and alerts detect a topology change; a future multi-instance release passes concurrent consent/payment tests using database-backed atomic guards.

### [P1-003] Complete independent review of the broad platform PR
- **Location:** PR #14, `feat/platform-completion`
- **Finding:** The core security and deployment changes are in a 100+ file draft PR. Targeted inspection covered the critical outbound URL guard, Worker forwarding, deployment policy, payment flow, and regression coverage, but a full line-by-line review is still outstanding.
- **Action:** Review the entire diff by security boundary (auth/merchant isolation, database/RLS/indexes, payments and webhooks, outbound network, Worker/Container configuration, frontend session handling, dependency and CI changes). Resolve findings in small follow-up PRs.
- **Acceptance:** No unresolved high-severity review findings; every prerequisite change has passing required CI before a maintainer merges it.

### [P1-004] Scope legacy agent routes and discovery to the selected merchant
- **Location:** `services/commerce/sellable/main.py:2115-2145,3140-3398`; `docs/STAGING_SANDBOX_RUNBOOK.md:65-73`
- **Finding:** The A2A task handler and legacy `/agent/*` routes were wired to the global demo commerce core/gateway. The public agent manifest/catalog endpoints also had no merchant selector, so an external agent following the runbook could see the demo merchant instead of the newly onboarded staging merchant.
- **Action:** Route authenticated agent reads/writes through the API key's merchant core, require signed requests for mutating quote flows, and let public discovery resolve a known merchant ID. Update the runbook URLs and keep a regression for each route family.
- **Status:** Implemented as a focused draft in PR #22; PR #18's runbook now uses merchant-scoped discovery URLs. Review and merge the code before treating the runbook as executable evidence.

## P2 — Medium (before declaring the full sandbox goal complete)

### [P2-001] Keep simulated behavior clearly labeled
- **Location:** `docs/STAGING_SANDBOX_RUNBOOK.md:75,82`; `docs/DEPLOYMENT.md`
- **Finding:** Current unit/eval coverage uses fake providers and in-memory databases, while live provider behavior and refund-webhook automation remain incomplete.
- **Action:** Keep these boundaries visible in setup and operator docs. Avoid presenting fake-provider CI as proof of Razorpay or live payment readiness.
- **Acceptance:** Documentation distinguishes tested code paths, simulated provider paths, staging-verified paths, and unfinished paths.

### [P2-002] Retain fail-closed startup and readiness gates
- **Location:** `services/commerce/sellable/main.py`; `services/commerce/sellable/ledger/database.py`; PR #20
- **Finding:** Production safety depends on required database uniqueness/indexes and the maintenance worker. Falling back to process-local guards or serving traffic without required maintenance can invalidate idempotency and expiry behavior.
- **Action:** Keep production startup fail-closed on required index creation and maintenance-worker failure; keep readiness unhealthy when a required worker is unavailable. Exercise these gates against the actual isolated Postgres staging database before launch.
- **Acceptance:** Missing constraints or worker health blocks readiness; recovery requires fixing configuration/data, not bypassing the gate.

## Cross-Cutting Answers

1. **Most dangerous path:** Declaring staging or production payment correctness from fake-provider CI without a real isolated Test Mode checkout and signed webhook.
2. **Compounding issues:** Provider retries, pending refund status, local idempotency/ledger state, and process-local locks can diverge under duplicate events or multiple replicas.
3. **Minimum safe deployment set:** Review and merge the security/platform PRs; keep Razorpay Test Mode only; verify database indexes and one-instance topology; complete the isolated staging flow; document refund reconciliation and recovery.
4. **Largest finding domain:** Deployment and operational verification, followed by architecture constraints; the highest impact security controls have been added but still need full PR review and staging evidence.

## Evidence and Limitations

- GitHub Actions passed for the current draft revisions of PRs #14, #16, #17, #18, #19, and #20 as reported in their run summaries. These are code and configuration checks, not external staging proof.
- No Razorpay API call, live payment, or production deployment was made.
- Staging resources are not yet provisioned. Do not mark this plan CLEAR until the acceptance criteria above are met.
