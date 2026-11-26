# Code Inspection Implementation Plan
Project: Sellable | Stack: Python 3.11/3.12 FastAPI, Next.js, Supabase/PostgreSQL, Cloudflare Workers + Containers | Initial audit: 2026-11-24 | Targeted follow-up: 2026-11-26
Files scanned: approximately 422 repository files | Domains covered: Bug, Security, Architecture, Dependencies, Deployment

## Deployment Verdict

BLOCKED — deterministic CI and sandbox hardening pass, but a clean, isolated Cloudflare/Vercel/Razorpay Test Mode staging run has not been performed. The staging account resources still need to be provisioned. Keep the service sandbox-only and do not enable live transactions.

## Executive Summary

The codebase has draft changes covering SSRF controls, production configuration, dependency locks, Cloudflare deployment, Razorpay-only deployed provider selection, refund idempotency, readiness checks, and a staging runbook. PR #14 contains the pending-refund/idempotency fix and currently passes Python/eval, frontend, and Cloudflare CI. Targeted follow-ups also fixed ambiguous refund-response balance release, an IPv6 NAT64 SSRF bypass, a payment-webhook currency correction deduplication gap (PR #32), and non-terminal Razorpay link-cancel responses that could otherwise release held stock (PR #34). PR #26 adds signed, replay-safe refund-status reconciliation on the platform branch; its CI passed with fake providers after review fixes moved signature verification before JSON parsing, changed replay claims to hash the signed raw body rather than the unsigned event-ID header, and rejected fractional paise refund amounts. PR #25 verifies the actual required index definitions and its CI passed. Focused review of PR #14 also found that delegation-frequency checks scanned only 500 events and treated ledger failures as zero use; PR #27 now counts all history and denies when usage cannot be verified, with passing CI. These checks do not prove Cloudflare Container scheduling, Supabase staging migrations/index creation, Razorpay Test Mode checkout, signed provider webhook delivery, or provider refund behavior. The first release also depends on one Cloudflare Container instance while consent and payment-attempt serialization use process-local locks.

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
- **Status:** PR #26 now returns HTTP 409 for signed known-refund amount/payment mismatches and event/status contradictions so the provider is not told to stop retrying; the fake-provider regression passed in Actions run 45791171989. This still does not verify actual Razorpay delivery or staging Postgres behavior.
- **Acceptance:** Pending refunds reserve balance; only processed refund totals can mark the order REFUNDED; duplicate and out-of-order signed events produce one stable settlement; provider state matches local state.

### [P1-002] Preserve the single-instance topology constraint
- **Location:** `docs/DEPLOYMENT.md` (production topology and first-release constraints); `cloudflare/worker.js` (fixed Durable Object name)
- **Finding:** Consent and payment-attempt transitions still use process-local locks. A fixed Durable Object name and one container are deliberate mitigations, not horizontal-scaling safety. Cloudflare's documented scheduling policy is currently public beta, and the runbook requires account enablement.
- **Action:** Before first deployment, confirm the account supports Cloudflare Containers with the `durable_object` scheduling policy and that the deployed topology really maintains one service instance. Cloudflare currently marks this policy public beta and immutable per Container application; changing it requires a replacement application and new Durable Object namespace. Keep staging and production namespaces separate, validate the policy before initial creation, and keep autoscaling/multiple API replicas disabled. Plan atomic database transitions before scaling.
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

### [P1-011] Preserve corrected payment webhook events that change currency
- **Location:** `services/commerce/sellable/payments/service.py`; `tests/unit/test_payment_webhook_hardening.py`; PR #32
- **Finding:** Payment delivery claims previously keyed event name, provider payment/link ID, and amount but omitted currency. A signed event with the right amount and wrong currency could claim the key; a corrected event for the same payment and amount then looked like a duplicate and could not settle.
- **Status:** Fixed in focused draft PR #32 by requiring an explicit INR currency in the payment or linked payment entity and including provider currency in the delivery claim. Regressions prove a capture with no currency in either entity leaves the order pending, a mismatched USD event leaves it pending, a corrected INR event settles it, and exact replay remains idempotent. Exact-head Actions run 45806533818 passed Python 3.11/3.12, frontend, and Cloudflare. Staging provider behavior remains unverified.
- **Acceptance:** Corrected authenticated events are not discarded by earlier mismatches; identical replays remain idempotent. Keep provider behavior in staging as a separate check.

### [P1-012] Reject coerced monetary amounts in signed webhooks
- **Location:** `services/commerce/sellable/payments/service.py`; `services/commerce/sellable/refunds.py`; `tests/unit/test_payment_webhook_hardening.py`; PRs #26 and #35
- **Finding:** Coercing signed provider amounts with `int()` could truncate a fractional paise value and settle an order/refund if the truncated value matched local state.
- **Status:** PR #35 rejects fractional, string, and boolean captured payment amounts; run 45795310705 passed Python 3.11/3.12, frontend, and Cloudflare. PR #26 rejects non-integer refund webhook amounts; signed-route regression confirms a fractional value is rejected and order stays PAID; run 45795698998 passed the same CI jobs.
- **Acceptance:** Signed payment/refund webhooks accept only integer currency subunits, reject malformed types without state changes, and remain retryable/reconcilable where appropriate. Complete real-provider verification in isolated staging.


### [P1-013] Confirm who may grant single-use purchase consent
- **Location:** PR #22 agent consent request route and merchant console consent action; isolated staging flow.
- **Finding:** PR #22 correctly prevents the agent from issuing consent and returns no consent ID. Its end-to-end fixture then uses a merchant-owner session to issue purchase consent. The product authorization policy has not selected whether the human approver must be the buyer/payer, merchant owner, or both; a separate merchant session does not prove buyer authorization.
- **Action:** Select the authorized human role before merging the consent-grant path. Bind the grant to an authenticated identity and the exact order, amount, payee, purpose, and expiry; add an authorization regression for the selected role.
- **Status:** Awaiting the product decision. Keep consent-grant behavior and staging acceptance blocked until the authority is explicit.
- **Acceptance:** Only the explicitly authorized human role can issue a single-use consent; the agent cannot grant it or alter the bound transaction terms.


### [P1-015] Reject coerced payment-link recovery amounts
- **Location:** `services/commerce/sellable/payments/razorpay.py`; `tests/unit/test_payments.py`; PR #14
- **Finding:** Payment-link recovery converted the provider's amount with `int()`. A malformed fractional paise amount could be truncated to the expected integer and the recovered link accepted. Provider create responses also need type validation because a malformed response may follow a successful provider-side create.
- **Action:** Require an actual integer (excluding booleans) matching the local order amount on both create and recovery responses. Keep uncertain malformed create results retryable so recovery by stable order reference can reconcile without issuing a second link.
- **Status:** Fixed on PR #14 head `302a3b3eacf93814c73b55cbc0a26a859769c303`; fake-provider regressions cover float, string, and boolean responses. Exact-head Actions run [45820898250](https://github.com/mahirmlk/sellable/actions/runs/45820898250) passed Python 3.11/3.12 tests/evals, frontend, and Cloudflare checks; Vercel is green.
- **Acceptance:** Recovery never truncates or coerces provider monetary values; malformed responses remain retryable and no second link is created automatically.

### [P1-014] Remove vulnerable frontend dependencies and align Node runtime
- **Location:** `apps/merchant-console/package.json`; `apps/merchant-console/package-lock.json`; `.github/workflows/ci.yml`
- **Finding:** The resolved Next.js 16.3.3 was covered by critical/high advisories; the frontend lock also contained high advisories in `sharp`, `source-map-js`, and `zod`. CI used Node 20 although resolved Supabase packages require Node 22 or newer.
- **Action:** Upgrade Next.js and its ESLint config to a patched same-major release, refresh the lockfile to remove affected transitive packages, use a compatible Node runtime, and make high-severity npm audit a required CI gate.
- **Status:** Fixed in PR #14: Next.js and `eslint-config-next` are pinned to 16.4.6, the lockfile was refreshed with `npm audit fix`, and frontend CI uses Node 22 with `npm audit --audit-level=high`. Exact-head run 45817869519 passed the audit, frontend typecheck/lint/build, Python 3.11/3.12 tests/evals, and Cloudflare checks; Vercel is green.
- **Acceptance:** Fresh `npm ci` followed by high-severity audit returns no findings in CI, and the Vercel runtime remains on a supported Node 22+ release.

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
- **Status:** Implemented in draft PR #28 based on PR #14. Production startup fails closed if legacy PAYMENT_PENDING/PAYMENT_FAILED orders lack active reservations, so the old-link drain must finish before the new backend accepts traffic. Focused PR #34 verifies the payment-link cancellation response ID and terminal status before PR #28 can abort and release stock. Count-only source snapshots cannot identify which order was applied, so committed offsets now remain until a merchant owner confirms that exact paid/fulfilled order after syncing the source; the console requires typing `SYNCED`. Regression coverage proves unrelated external stock decreases do not clear local offsets and owner/member access is enforced. Exact-head CI run 45815764616 passed Python 3.11/3.12, frontend typecheck/lint/build, and Cloudflare checks; Vercel is green.
- **Acceptance:** Concurrent orders cannot oversell; replay and duplicate settlement/release are idempotent; retryable payment failures retain stock; old catalog snapshots cannot restore committed sales; startup rejects unreserved legacy payment orders. Complete the documented cancellation rollout and staging verification before launch.

### [P2-001] Keep simulated behavior clearly labeled
- **Location:** `docs/STAGING_SANDBOX_RUNBOOK.md:75,82`; `docs/DEPLOYMENT.md`
- **Finding:** Current unit/eval coverage uses fake providers and in-memory databases, while live provider behavior and refund-webhook automation remain incomplete.
- **Action:** Keep these boundaries visible in setup and operator docs. Avoid presenting fake-provider CI as proof of Razorpay or live payment readiness.
- **Acceptance:** Documentation distinguishes tested code paths, simulated provider paths, staging-verified paths, and unfinished paths.

### [P2-002] Retain fail-closed startup and readiness gates
- **Location:** `services/commerce/sellable/main.py`; `services/commerce/sellable/ledger/database.py`; PR #20
- **Finding:** Production safety depends on required database uniqueness/indexes and the maintenance worker. Falling back to process-local guards or serving traffic without required maintenance can invalidate idempotency and expiry behavior.
- **Action:** Keep production startup fail-closed on required index creation and maintenance-worker failure; draft PR #25 verifies actual index definitions. Draft PR #20 handles disabled/unavailable maintenance workers, while PR #14 also tracks maintenance-thread liveness, failed sweeps, and stale successes. Resolve the overlap when sequencing focused merges, then exercise both gates against isolated Postgres staging.
- **Status:** PR #14 head `cc5728e4da34acf1d696422273f9def6be1543d2` passed readiness regressions and all Actions checks in run 45790202229. Independent review and staging index/worker behavior remain outstanding.
- **Acceptance:** Missing constraints or worker health blocks readiness; recovery requires fixing configuration/data, not bypassing the gate.

## Cross-Cutting Answers

1. **Most dangerous path:** Declaring staging or production payment correctness from fake-provider CI without a real isolated Test Mode checkout and signed webhook.
2. **Compounding issues:** Provider retries, pending refund status, local idempotency/ledger state, and process-local locks can diverge under duplicate events or multiple replicas.
3. **Minimum safe deployment set:** Review and merge the security/platform PRs; keep Razorpay Test Mode only; verify database indexes and one-instance topology; complete the isolated staging flow; document refund reconciliation and recovery.
4. **Largest finding domain:** Deployment and operational verification, followed by architecture constraints; the highest impact security controls have been added but still need full PR review and staging evidence.

## Evidence and Limitations

- Initial baseline Actions run [45386624830](https://github.com/mahirmlk/sellable/actions/runs/45386624830), PR #25's index verification [45381931393](https://github.com/mahirmlk/sellable/actions/runs/45381931393), PR #26's webhook review fixes [45387676861](https://github.com/mahirmlk/sellable/actions/runs/45387676861), and PR #27's frequency-limit fix [45390551118](https://github.com/mahirmlk/sellable/actions/runs/45390551118) passed on their recorded heads.
- Latest PR #14 checks passed after ambiguous refund handling in [45787428144](https://github.com/mahirmlk/sellable/actions/runs/45787428144) and after NAT64 egress filtering in [45788328597](https://github.com/mahirmlk/sellable/actions/runs/45788328597): Python 3.11/3.12, frontend, Cloudflare, and Vercel preview.
- PR #14 maintenance readiness checks passed in [45790202229](https://github.com/mahirmlk/sellable/actions/runs/45790202229). PR #26 refund webhook conflict handling passed in [45791171989](https://github.com/mahirmlk/sellable/actions/runs/45791171989), and integer-only refund amount validation passed in [45795698998](https://github.com/mahirmlk/sellable/actions/runs/45795698998). PR #35 integer-only payment amount validation passed in [45795310705](https://github.com/mahirmlk/sellable/actions/runs/45795310705). PR #32's updated currency validation and correction deduplication passed exact-head CI in [45806533818](https://github.com/mahirmlk/sellable/actions/runs/45806533818). PR #34 cancellation-response validation passed in [45793114240](https://github.com/mahirmlk/sellable/actions/runs/45793114240).
- PR #18's current staging-runbook head passed in [45797692048](https://github.com/mahirmlk/sellable/actions/runs/45797692048), including a documented warning that the selected Container scheduling policy is beta and immutable. These are code/configuration checks, not external staging proof.
- No Razorpay API call, live payment, or production deployment was made.
- Staging resources are not yet provisioned. Do not mark this plan CLEAR until the acceptance criteria above are met.
