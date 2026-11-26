# Code Inspection Implementation Plan
Project: Sellable | Stack: Python 3.11/3.12 FastAPI, Next.js, Supabase/PostgreSQL, Cloudflare Workers + Containers | Initial audit: 2026-11-24 | Targeted follow-up: 2026-11-26
Files scanned: approximately 422 repository files | Domains covered: Bug, Security, Architecture, Dependencies, Deployment

## Deployment Verdict

BLOCKED — deterministic CI and sandbox hardening pass, but a clean, isolated Cloudflare/Vercel/Razorpay Test Mode staging run has not been performed. The staging account resources still need to be provisioned. Keep the service sandbox-only and do not enable live transactions.

## Executive Summary

The codebase has draft changes covering SSRF controls, production configuration, dependency locks, Cloudflare deployment, Razorpay-only deployed provider selection, refund idempotency, readiness checks, and a staging runbook. PR #14 contains the pending-refund/idempotency fix and currently passes Python/eval, frontend, and Cloudflare CI. A targeted follow-up found and fixed both ambiguous refund-response balance release and an IPv6 NAT64 SSRF classification bypass. PR #26 adds signed, replay-safe refund-status reconciliation on the platform branch; its latest CI passed with fake providers after review fixes moved signature verification before JSON parsing and changed replay claims to hash the signed raw body, not the unsigned event-ID header. PR #25 verifies the actual required index definitions and its CI passed. Focused review of PR #14 also found that delegation-frequency checks scanned only 500 events and treated ledger failures as zero use; PR #27 now counts all history and denies when usage cannot be verified, with passing CI. These checks do not prove Cloudflare Container scheduling, Supabase staging migrations/index creation, Razorpay Test Mode checkout, signed provider webhook delivery, or provider refund behavior. The first release also depends on one Cloudflare Container instance while consent and payment-attempt serialization use process-local locks.

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
- **Location:** PR #14, `feat/platform-completion`; focused follow-ups #25 and #26
- **Finding:** PR #14 remains a 100+ file draft. Focused reviews have covered refund balance/idempotency and response validation, merchant-scoped payment routes, inventory expiry/cancellation, webhook signature/replay reconciliation, startup/index gates, safety-eval CI, Cloudflare forwarding, and outbound URL controls. Review of the complete auth, data, payment, frontend, and deployment diff is still outstanding, as is independent maintainer review. PR #25 verifies the database index definitions that the startup gate requires.
- **Action:** Finish reviewing PR #14 by security boundary and its focused follow-ups. Keep the dependencies ordered and resolve review findings before any merge.
- **Acceptance:** No unresolved high-severity review findings; the final merged tree retains both refund fixes and validates actual unique-index definitions; every prerequisite change has passing required CI.

### [P1-004] Scope legacy agent routes and discovery to the selected merchant
- **Location:** `services/commerce/sellable/main.py:2115-2145,3140-3398`; `docs/STAGING_SANDBOX_RUNBOOK.md:65-73`
- **Finding:** The A2A task handler and legacy `/agent/*` routes were wired to the global demo commerce core/gateway. Public agent discovery lacked merchant selection, and payment start/retry used the global demo core even after order routes were scoped.
- **Action:** Route authenticated reads, writes, consent, and payment start/retry through the signed API key's merchant core; require HMAC on mutating agent routes; let public discovery resolve known merchants. Keep route-family regressions and merchant-scoped runbook URLs.
- **Status:** Implemented in draft PR #22. Run 45403432662 passed Python 3.11/3.12, frontend, and Cloudflare checks after adding tenant-bound payment start/retry tests. Vercel preview status was rate-limited.
- **Acceptance:** An agent from merchant A cannot read or mutate merchant B's order, consent, or payment state; all agent-facing payment operations use the authenticated merchant core. Continue to require staging verification.

### [P1-007] Bind canonical checkout authorization to the presenting agent
- **Location:** `services/commerce/sellable/authorization.py`; `services/commerce/sellable/core.py`; PR #29
- **Finding:** The delegation decision supports checking the subject agent, and the legacy order path passed the buyer agent ID, but canonical checkout order creation omitted it. That allowed a direct core checkout call to skip the agent-to-delegation binding.
- **Action:** Pass the buyer agent identity into the core authorization decision and reject mismatches before persisting an order.
- **Status:** Fixed in focused draft PR #29 with a canonical checkout regression. Python 3.11/3.12, frontend, and Cloudflare checks passed in run 45400311667.
- **Acceptance:** Every delegated order path checks the actual presenting agent against the delegation subject, and a mismatch creates no order. Review this follow-up before merging the platform branch.

### [P1-008] Gate CI on the versioned agent-safety evaluation battery
- **Location:** `.github/workflows/ci.yml`; `evals/run_all.py`; PR #30
- **Finding:** CI ran the deterministic scenarios, but skipped the versioned evaluation suites and their regression gates. The external-agent HTTP sandbox flow already runs as part of the full pytest suite.
- **Action:** Run the full evaluation entry point in CI with the mock LLM adapter so safety suites, regression thresholds, and deterministic scenarios all fail the build on errors without calling an external model.
- **Status:** Implemented in draft PR #30. Run 45401459117 passed Python 3.11/3.12, frontend, and Cloudflare checks; the test log confirms P0 safety and commerce gates at 100%, zero P0 failures, and RESULT: PASS. Vercel preview deployed successfully.
- **Acceptance:** The full suite and release gates run on every relevant pull request, and the documented external-agent flow stays inside the mandatory test job. Isolated Razorpay Test Mode staging remains a separate release gate.

### [P1-009] Reject reserved IPv6 NAT64 addresses in outbound URL validation
- **Location:** `services/commerce/sellable/outbound.py`; `tests/unit/test_outbound_security.py`; PR #14
- **Finding:** Python classifies the reserved `64:ff9b::/96` NAT64 well-known prefix as `is_global`; an embedded private IPv4 destination could pass the prior public-unicast check.
- **Status:** Fixed in PR #14 commit `383e3b1951fffbc68d6544448fdf9c8df4533383`. Egress validation rejects reserved addresses; regressions cover literal NAT64 addresses embedding loopback/private IPv4 and a DNS AAAA answer in the range. Actions run 45788328597 passed Python 3.11/3.12, frontend, and Cloudflare checks.
- **Acceptance:** Production egress rejects all non-global and reserved destination addresses at validation and immediately before direct connection; redirects remain blocked.

### [P1-010] Keep refund balances reserved after inconsistent provider responses
- **Location:** `services/commerce/sellable/payments/razorpay.py`; `services/commerce/sellable/refunds.py`; `tests/unit/test_payment_webhook_hardening.py`; PR #14
- **Finding:** Treating a missing/mismatched amount or currency as a definitive failure releases the refundable balance even though the provider may have accepted the request.
- **Status:** Fixed in PR #14 commit `9a4fb4a99a53147da51255519120dff742e67e30`. Missing or malformed status, amount, currency, or refund ID is ambiguous/retryable; the regression verifies the reservation blocks an over-refund and same-key retry reconciles it. Actions run 45787428144 passed Python 3.11/3.12, frontend, and Cloudflare checks.
- **Acceptance:** Only an explicit provider `failed` status releases a refund reservation; ambiguous responses remain pending until reconciled with the same provider idempotency key.

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
- **Action:** Persist a per-order/SKU reservation, conditionally reserve only available stock, retain it through retryable failures, commit it on verified payment, and release it only after a safe abort. Expire every unpaid order after 15 minutes. For PAYMENT_PENDING/FAILED, reconcile the link by stable order reference, cancel any payable link, and release stock only after the provider confirms it is cancelled, expired, or absent; uncertain outcomes retain the hold. Serialize cancellation and abort against payment retries and webhook settlement. Before rollout from a version without reservations, stop new checkouts and cancel/verify all old provider links on the old backend.
- **Status:** Implemented in draft PR #28 based on PR #14. Production startup now fails closed if legacy PAYMENT_PENDING/PAYMENT_FAILED orders lack active reservations, so the old-link drain must finish before the new backend accepts traffic. Python 3.11/3.12, frontend, Cloudflare, and Vercel checks passed for the expiry implementation and consistent DATABASE.md/DEPLOYMENT.md wording in run 45411445017.
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

- Initial baseline Actions run [45386624830](https://github.com/mahirmlk/sellable/actions/runs/45386624830), PR #25's index verification [45381931393](https://github.com/mahirmlk/sellable/actions/runs/45381931393), PR #26's webhook review fixes [45387676861](https://github.com/mahirmlk/sellable/actions/runs/45387676861), and PR #27's frequency-limit fix [45390551118](https://github.com/mahirmlk/sellable/actions/runs/45390551118) passed on their recorded heads.
- Latest PR #14 checks passed after ambiguous refund handling in [45787428144](https://github.com/mahirmlk/sellable/actions/runs/45787428144) and after NAT64 egress filtering in [45788328597](https://github.com/mahirmlk/sellable/actions/runs/45788328597): Python 3.11/3.12, frontend, Cloudflare, and Vercel preview.
- PR #18's current staging-runbook head passed in [45783777905](https://github.com/mahirmlk/sellable/actions/runs/45783777905). These are code/configuration checks, not external staging proof.
- No Razorpay API call, live payment, or production deployment was made.
- Staging resources are not yet provisioned. Do not mark this plan CLEAR until the acceptance criteria above are met.
