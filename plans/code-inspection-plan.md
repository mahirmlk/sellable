# Code Inspection Implementation Plan
Project: Sellable | Stack: Python 3.11/3.12 FastAPI, Next.js, Supabase/PostgreSQL, Cloudflare Workers + Containers | Inspected: 2026-11-24
Files scanned: approximately 422 repository files | Domains covered: Bug, Security, Architecture, Dependencies, Deployment

## Deployment Verdict

BLOCKED — deterministic CI and sandbox hardening pass, but a clean, isolated Cloudflare/Vercel/Razorpay Test Mode staging run has not been performed. The staging account resources still need to be provisioned. Keep the service sandbox-only and do not enable live transactions.

## Executive Summary

The codebase has draft changes covering SSRF controls, production configuration, dependency locks, Cloudflare deployment, Razorpay-only deployed provider selection, refund idempotency, readiness checks, and a staging runbook. PR #14 now contains the pending-refund/idempotency fix and its Python/eval, frontend, and Cloudflare CI passed. PR #26 adds signed, replay-safe refund-status reconciliation on the platform branch; its latest CI passed with fake providers after review fixes moved signature verification before JSON parsing and changed replay claims to hash the signed raw body, not the unsigned event-ID header. PR #25 verifies the actual required index definitions and its CI passed. Focused review of PR #14 also found that delegation-frequency checks scanned only 500 events and treated ledger failures as zero use; PR #27 now counts all history and denies when usage cannot be verified, with passing CI. These checks do not prove Cloudflare Container scheduling, Supabase staging migrations/index creation, Razorpay Test Mode checkout, signed provider webhook delivery, or provider refund behavior. The first release also depends on one Cloudflare Container instance while consent and payment-attempt serialization use process-local locks.

The highest risk is treating the sandbox as production-proven before staging verifies the provider boundary and database constraints. The exploit/correctness paths compound when an external retry or duplicate webhook meets partially completed payment/refund state: local idempotency, provider idempotency, ledger settlement, and the order status must agree.

## P0 — Critical (must be resolved before staging is called proven)

### [P0-001] Complete isolated staging verification
- **Location:** `docs/STAGING_SANDBOX_RUNBOOK.md:3-12,65-75`
- **Finding:** The runbook explicitly requires a separate Cloudflare Worker/Container, disposable Supabase project, Razorpay Test Mode credentials, and Vercel preview. These resources have not yet been provisioned or exercised. CI mocks cannot establish that the real provider signatures, Cloudflare routing, or deployment secrets are wired correctly.
- **Action:** Provision isolated staging resources; execute onboarding, catalog publish, external-agent discovery/negotiation, one-time consent, Test Mode checkout, signed payment webhook, receipt retrieval, idempotent refund, and duplicate webhook replay. Record non-secret evidence for each step.
- **Acceptance:** The runbook checklist is complete, order and ledger state match the provider records, duplicate requests create no duplicate order/refund, and no production endpoint or live credential is used.

## P1 — High (resolve before broad production use)

### [P1-001] Verify automatic refund status reconciliation in staging
- **Location:** `services/commerce/sellable/refunds.py`; `services/commerce/sellable/main.py`; `docs/STAGING_SANDBOX_RUNBOOK.md`
- **Finding:** PR #14 now includes the refund idempotency fix. Draft PR #26 adds signed, deduplicated, monotonic refund-status reconciliation and recovery for ambiguous create responses on top of the platform branch. Its CI uses signed fixtures and fake providers; it cannot prove actual Razorpay Test Mode delivery or staging database behavior.
- **Action:** Review the platform-based refund webhook PR, then replay pending/processed/failed refund webhooks in isolated staging and verify ledger/order state.
- **Acceptance:** Pending refunds reserve balance; only processed refund totals can mark the order REFUNDED; duplicate and out-of-order signed events produce one stable settlement; provider state matches local state.

### [P1-002] Preserve the single-instance topology constraint
- **Location:** `docs/DEPLOYMENT.md` (production topology and first-release constraints); `cloudflare/worker.js` (fixed Durable Object name)
- **Finding:** Consent and payment-attempt transitions still use process-local locks. A fixed Durable Object name and one container are deliberate mitigations, not horizontal-scaling safety. Cloudflare's documented scheduling policy is currently public beta, and the runbook requires account enablement.
- **Action:** Before first deployment, confirm the account supports the selected Container/Durable Object policy and that the deployed topology really maintains one service instance. Keep autoscaling and multiple API replicas disabled. Plan atomic database transitions before scaling.
- **Acceptance:** Operational configuration and alerts detect a topology change; a future multi-instance release passes concurrent consent/payment tests using database-backed atomic guards.

### [P1-003] Complete independent review and safe sequencing of platform PRs
- **Location:** PR #14, `feat/platform-completion`; follow-ups #25 and #26
- **Finding:** PR #14 is a 100+ file draft. It contains the pending-refund/idempotency and sandbox-only provider fixes and has passing CI. Review also found and fixed a fail-open Cloudflare HTTPS check for missing/unknown environment values. #26 carries refund-webhook reconciliation on top of the platform branch and has passing CI after the webhook review fixes. Focused review of outbound URL validation and Cloudflare forwarding found no blocker in those inspected paths; review of the remaining auth, data, payment, frontend, and deployment diff is still outstanding. PR #25 verifies the database index definitions that the startup gate requires.
- **Action:** Finish reviewing PR #14 by security boundary and its focused follow-ups. Keep the dependencies ordered and resolve review findings before any merge.
- **Acceptance:** No unresolved high-severity review findings; the final merged tree retains both refund fixes and validates actual unique-index definitions; every prerequisite change has passing required CI.

### [P1-004] Scope legacy agent routes and discovery to the selected merchant
- **Location:** `services/commerce/sellable/main.py:2115-2145,3140-3398`; `docs/STAGING_SANDBOX_RUNBOOK.md:65-73`
- **Finding:** The A2A task handler and legacy `/agent/*` routes were wired to the global demo commerce core/gateway. The public agent manifest/catalog endpoints also had no merchant selector, so an external agent following the runbook could see the demo merchant instead of the newly onboarded staging merchant.
- **Action:** Route authenticated agent reads/writes through the API key's merchant core, require signed requests for mutating quote flows, and let public discovery resolve a known merchant ID. Update the runbook URLs and keep a regression for each route family.
- **Status:** Implemented as a focused draft in PR #22; PR #18's runbook now uses merchant-scoped discovery URLs. Review and merge the code before treating the runbook as executable evidence.

## P2 — Medium (before declaring the full sandbox goal complete)

### [P1-005] Fail closed on delegation frequency checks
- Location: services/commerce/sellable/authorization.py; services/commerce/sellable/core.py
- Finding: The authorization path previously skipped frequency limits when usage was unavailable, and the count scanned only the newest 500 ledger events. Repeated use could therefore exceed a configured frequency cap after older order events left that window.
- Action: Count all durable order-use events and deny when the usage count cannot be verified.
- Status: Implemented in focused draft PR #27; its CI passed in run 45390551118. Review and merge it after PR #14, then verify against staging data.
- Acceptance: Every order creation checks the complete merchant-scoped usage history; storage/query errors cannot permit a frequency-limited action.

### [P1-006] Reserve inventory atomically across checkout and payment transitions
- **Location:** `services/commerce/sellable/repositories.py`; `services/commerce/sellable/core.py`; PR #28
- **Finding:** Checkout could create multiple paid-capable orders against the same last unit because stock availability was only represented by catalog snapshots. In-flight consent and payment retries also needed to hold inventory across process interruptions and provider callbacks.
- **Action:** Persist a per-order/SKU reservation, conditionally reserve only available stock, retain it through retryable failures, commit it on verified payment, and release it only after a safe abort. Keep the 15-minute expiry limited to orders that cannot yet have a provider payment link; cancel and confirm payment-link cancellation before releasing stock for a payment-pending order. Before rollout from a version without reservations, stop new checkouts and cancel/verify all old provider links on the old backend.
- **Status:** Implemented in draft PR #28 based on PR #14. Production startup now fails closed if legacy PAYMENT_PENDING/PAYMENT_FAILED orders lack active reservations, so the old-link drain must finish before the new backend accepts traffic. Python 3.11/3.12, frontend, and Cloudflare checks passed in run 45398926256. Vercel preview status was account-rate-limited and did not deploy.
- **Acceptance:** Concurrent orders cannot oversell; replay and duplicate settlement/release are idempotent; retryable payment failures retain stock; old catalog snapshots cannot restore committed sales; startup rejects unreserved legacy payment orders. Complete the documented cancellation rollout and staging verification before launch.

### [P2-001] Keep simulated behavior clearly labeled
- **Location:** `docs/STAGING_SANDBOX_RUNBOOK.md:75,82`; `docs/DEPLOYMENT.md`
- **Finding:** Current unit/eval coverage uses fake providers and in-memory databases, while live provider behavior and refund-webhook automation remain incomplete.
- **Action:** Keep these boundaries visible in setup and operator docs. Avoid presenting fake-provider CI as proof of Razorpay or live payment readiness.
- **Acceptance:** Documentation distinguishes tested code paths, simulated provider paths, staging-verified paths, and unfinished paths.

### [P2-002] Retain fail-closed startup and readiness gates
- **Location:** `services/commerce/sellable/main.py`; `services/commerce/sellable/ledger/database.py`; PR #20
- **Finding:** Production safety depends on required database uniqueness/indexes and the maintenance worker. Falling back to process-local guards or serving traffic without required maintenance can invalidate idempotency and expiry behavior.
- **Action:** Keep production startup fail-closed on required index creation and maintenance-worker failure; draft PR #25 verifies actual index definitions, and draft PR #20 rejects disabled/unavailable maintenance workers and reports worker health in readiness. Review and merge both focused gates. Exercise them against the actual isolated Postgres staging database before launch.
- **Acceptance:** Missing constraints or worker health blocks readiness; recovery requires fixing configuration/data, not bypassing the gate.

## Cross-Cutting Answers

1. **Most dangerous path:** Declaring staging or production payment correctness from fake-provider CI without a real isolated Test Mode checkout and signed webhook.
2. **Compounding issues:** Provider retries, pending refund status, local idempotency/ledger state, and process-local locks can diverge under duplicate events or multiple replicas.
3. **Minimum safe deployment set:** Review and merge the security/platform PRs; keep Razorpay Test Mode only; verify database indexes and one-instance topology; complete the isolated staging flow; document refund reconciliation and recovery.
4. **Largest finding domain:** Deployment and operational verification, followed by architecture constraints; the highest impact security controls have been added but still need full PR review and staging evidence.

## Evidence and Limitations

- GitHub Actions passed for PR #14's latest head in run [45386624830](https://github.com/mahirmlk/sellable/actions/runs/45386624830), PR #25's index verification in run [45381931393](https://github.com/mahirmlk/sellable/actions/runs/45381931393), and PR #26's latest webhook review fixes in run [45387676861](https://github.com/mahirmlk/sellable/actions/runs/45387676861). PR #27's frequency-limit fix passed in run [45390551118](https://github.com/mahirmlk/sellable/actions/runs/45390551118). Earlier focused checks on #17, #18, #20, #22, and #23 also passed. These are code/configuration checks, not external staging proof.
- No Razorpay API call, live payment, or production deployment was made.
- Staging resources are not yet provisioned. Do not mark this plan CLEAR until the acceptance criteria above are met.
