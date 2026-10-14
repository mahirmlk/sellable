# SELLABLE — Product and Architecture Update Plan

**Status:** Proposed implementation requirements  
**Purpose:** Restore Supabase authentication, bring back the sign-in/sign-up experience, add a realistic Demo Mode, introduce multi-page onboarding for both modes, and prioritize a genuine external-agent commerce flow.  
**Scope:** Product UX, authentication, onboarding, data isolation, dashboard behavior, commerce architecture, and implementation priorities.

---

## 1. Product Direction

SELLABLE is an agentic commerce platform for merchants. Merchants manage their store and commerce policies through SELLABLE, the platform's Seller Agent helps with selling, and the Customer Service Agent supports post-purchase interactions. Independently operated external shopping/buyer agents must be able to discover merchant capabilities and interact with the commerce platform through supported, authenticated interfaces.

The core product principle remains:

> External agents are clients of SELLABLE, not Buyer Agents that SELLABLE hosts. Agents may request actions; deterministic commerce services validate, authorize, and execute them.

SELLABLE must not introduce an internal fake Buyer Agent or represent simulated buyers as real external agents or customers. Demo Mode is a separate product-exploration environment, not a buyer-agent simulation.

### Product outcomes

1. A visitor can sign in, create an account, or explore SELLABLE in Demo Mode without creating an account.
2. A newly registered user completes a guided, multi-page onboarding flow and then reaches their own authenticated, backend-connected merchant dashboard.
3. A demo visitor completes the same onboarding experience with realistic, preconfigured demo information and then enters the same dashboard experience populated by isolated mock data.
4. The real dashboard and Demo Mode offer the same overall navigation and feature surface, while their data sources and side effects remain strictly separated.
5. A real external agent can eventually discover a merchant, retrieve authoritative catalog data, create a cart and checkout, pass required authorization, complete the supported payment flow, and receive a reconciled order.

---

## 2. Current UX and Behavior to Update

The supplied screenshots show these current behaviors:

- The public landing page at `sellable.shop` has an **Open Console** button that bypasses the authentication entry point and opens the dashboard directly.
- The sign-in and sign-up pages have been removed and need to be restored.
- The merchant dashboard Settings page currently displays **“Backend unreachable — policy could not be loaded”** and a **“Policy unavailable”** empty state. This needs to be investigated and handled correctly; the screenshot alone does not identify the root cause.
- The landing page communicates SELLABLE's agentic-commerce positioning. Retain the existing visual direction and branding while restoring the access and onboarding flows.

### Navigation behavior

- **Sign in** opens the sign-in page.
- **Get started / Sign up** opens the registration page.
- **Explore Demo / Try Demo Mode** opens the Demo Mode entry point without requiring an account.
- **Open Console** must no longer grant unauthenticated visitors access to the real merchant dashboard. It should route an authenticated user to their dashboard or unfinished onboarding; otherwise, route to the sign-in page, where Demo Mode is also available.
- Authenticated users who have completed onboarding go directly to their own dashboard.
- Authenticated users with incomplete onboarding resume at the first incomplete onboarding step.
- Demo users go to the demo onboarding/dashboard and must never be silently converted to an authenticated production session.

Preserve the existing console layout, navigation, and customizability unless a change is required to support these flows.

---

## 3. Restore and Re-enable Supabase Auth

Supabase Auth was disabled or disconnected earlier and must be re-enabled in the application. Check the Supabase project configuration and the application integration rather than assuming the cause is only a frontend route issue.

### Requirements

1. Re-enable the intended Supabase Auth providers in the Supabase project configuration. Email/password should be supported as the baseline unless the existing project intentionally uses a different provider. Preserve any currently configured and intended providers.
2. Restore the application-side Supabase Auth client/server integration and session handling used by the current Next.js application.
3. Restore sign-up, sign-in, sign-out, session refresh, and password recovery flows appropriate to the enabled providers. Include email verification where required by project configuration.
4. Restore the correct site URL and allowed redirect/callback URLs for the deployed application and local development environments.
5. Confirm the public Supabase project URL and publishable/anonymous key are configured correctly. Never expose a service-role key or other server secret to browser code.
6. Ensure protected dashboard routes check the authenticated session on the server where appropriate; frontend-only redirects are not an authorization boundary.
7. Handle expired sessions, failed authentication, verification-required states, and callback errors with clear messages and recovery paths.
8. After successful sign-up, link the Supabase Auth user to the SELLABLE application profile and merchant/workspace onboarding state. Do not rely on client-supplied user IDs for ownership.
9. Keep user authentication distinct from merchant identity, external agent identity, and customer identity used in commerce transactions.

Supabase Auth and Postgres Row Level Security (RLS) must work together. Every tenant-owned resource must be scoped to the authenticated user's authorized organization/workspace/merchant, using server-side authorization and RLS where appropriate.

### Authentication routes and expected behavior

Restore or create route equivalents for:

- `/sign-in`
- `/sign-up`
- `/forgot-password` and the required recovery/callback route
- the onboarding route group
- the authenticated dashboard route group
- a distinct demo entry/session route

Names can follow the project's current route conventions, but the behavior must remain equivalent.

### Auth flow

1. Visitor selects Sign up.
2. Supabase Auth creates/authenticates the user and completes any required verification.
3. SELLABLE creates or resolves the user's application profile and workspace ownership safely.
4. The user enters multi-page onboarding.
5. Onboarding progress is persisted to the real backend so the user can resume later.
6. On completion, the user reaches their own real dashboard, backed by the existing production backend and real tenant-scoped data.

A successful sign-in follows the same routing rule: go to the user's dashboard if onboarding is complete; otherwise resume onboarding.

---

## 4. Sign-in / Sign-up Experience and Demo Mode Entry

Restore a dedicated access experience instead of sending every visitor directly into the dashboard.

### Sign-in page

Must include:

- Email/password or the project's configured sign-in method(s).
- Link to create an account.
- Password recovery, when applicable.
- A visible **Explore Demo Mode** option that works without signing in.
- Clear loading, success, validation, and authentication-error states.

### Sign-up page

Must include:

- The configured registration method(s).
- Required validation and verification feedback.
- Link to sign in if the visitor already has an account.
- A visible **Explore Demo Mode** option that works without registering.

### Demo Mode must be clearly explained

Suggested copy:

> Explore the SELLABLE merchant console using a realistic sample store. No account or payment is required. Demo data is separate from live merchant data.

Demo Mode must not ask the visitor to pretend to be a buyer agent, and it must not create fake external-agent transactions in production records.

### Mode identity

- Show a persistent **DEMO MODE** indicator throughout the demo dashboard and demo onboarding.
- Show a production/authenticated state in the real dashboard; do not label authenticated merchant data as demo data.
- Provide an obvious route from Demo Mode to Sign up / Sign in without implying demo data will be converted to live data.
- A demo session must not gain production permissions by changing a client-side flag, URL parameter, or local-storage value.

---

## 5. Shared Multi-page Onboarding

Implement one onboarding experience that supports two distinct execution modes: authenticated production onboarding and no-account demo onboarding. Reuse the same page structure, components, step indicators, validation patterns, and navigation; vary the data adapters, initial values, persistence, and allowed side effects according to the active mode.

### Suggested onboarding steps

The exact page names may be adapted to the existing product, but the flow should cover the following areas:

1. **Welcome and workspace** — explain the setup process and establish the merchant/workspace context.
2. **Store profile** — store name, public/store URL or domain, business category, supported region/currency, and essential contact information.
3. **Catalog setup** — choose how products will be added: create/import catalog data, connect a supported source, or continue setup and finish catalog configuration later. Real mode must use the merchant's actual catalog records; demo mode should begin with curated sample catalog data.
4. **Selling rules** — configure or review allowed selling behavior, approval requirements, discount/negotiation limits, and other basic merchant policies. In demo mode, provide plausible editable examples stored only in the demo environment.
5. **Seller and service agents** — explain/configure the merchant-side Seller Agent and Customer Service Agent using the existing product's available settings. Do not create a Buyer Agent inside SELLABLE.
6. **Payments and fulfillment** — collect or link the production settings required for live sales. If information or verification is incomplete, allow the user to save progress where appropriate but clearly show that live transactions are not ready. Demo mode uses non-live examples and sandbox-only behavior.
7. **Review and finish** — summarize choices, show outstanding setup requirements, and take the user to the appropriate dashboard.

### Onboarding behavior

- Use a multi-page wizard with Back, Continue, validation, a clear progress indicator, and a completion state.
- Save progress after each completed step and allow users to resume after signing back in or refreshing.
- The current mode determines the persistence adapter. Production onboarding writes only authorized data to the authenticated user's tenant/workspace. Demo onboarding writes only to demo storage/session state.
- Pre-fill demo onboarding with coherent, realistic sample values while allowing the visitor to explore and edit them.
- Do not require visitors to connect a real payment provider or merchant integration merely to explore the demo.
- The demo should let users finish onboarding even when production-only checks cannot be completed; clearly mark those integrations as illustrative/unconfigured.
- Onboarding completion must not, by itself, imply that a real merchant is verified, payments are configured, products are live, or the store is ready to accept live orders.
- Allow the real onboarding flow to show required and optional setup tasks distinctly. Do not mark the store production-ready until the required backend checks actually pass.

---

## 6. Real Dashboard vs Demo Dashboard

Both modes should expose the same principal console navigation and allow the visitor to understand the product's capabilities. They must not share a mutable data source.

### Production / authenticated mode

- Uses the real backend and the currently implemented/customizable dashboard.
- Reads and writes data only for the authenticated user's authorized merchant/workspace.
- Uses live catalog, policies, settings, agent configuration, payment integration state, orders, and analytics where those data are actually available.
- Persist settings and policy changes through the backend, with validation and audit records as appropriate.
- Any real transaction or external side effect must pass through production authorization and risk controls.

### Demo mode

- Uses a clearly separated demo data adapter and curated, version-controlled fixtures rather than accidentally calling production write APIs.
- Provides realistic content across the full dashboard navigation: store configuration, product catalog, selling rules, approvals, analytics, live activity, evaluations, payments, operations, connectors, developers, and settings, to the extent those sections exist in the current product.
- All related demo records must be internally consistent. For example, order items should refer to products in the demo catalog; payment rows should match the corresponding demo orders; analytics totals should reconcile with the demo order/activity data; policy and approval examples should agree with the store configuration.
- Use domain-appropriate product names, SKUs, prices, dates, currencies, statuses, order patterns, and support cases. Values should feel like plausible business records, not generic filler.
- Mock data must be curated/static or deterministically generated from reviewed fixtures. Do not depend on an LLM generating fresh fake business data at runtime.
- Demo actions may update demo-local/session state to make the console interactive, but must never charge a real payment method, send a live customer email, create a production order, alter production merchant policy, or mutate real catalog/inventory records.
- Visibly label simulated status, payment, activity, and analytics data as demo data wherever there is a risk of confusing it with live operations.
- Demo integrations may show believable setup screens and illustrative connection statuses, but they must not claim that real provider accounts are connected.
- Re-entering Demo Mode should start from a predictable coherent fixture set, or provide a clearly named reset-demo action if demo changes persist within the session.

### Data isolation requirements

- Do not implement Demo Mode solely as a frontend boolean that changes labels while production APIs continue to receive writes.
- Use a dedicated demo adapter/repository/API boundary and dedicated demo fixtures or isolated demo tenant.
- Demo requests must not carry production merchant credentials or service-role credentials.
- The backend must reject demo-context requests against protected production mutations.
- Never merge demo orders, payments, customers, activity, or analytics into production records.
- Add tests proving demo operations cannot mutate production data.

---

## 7. Backend Health and Settings Error Handling

The provided Settings screenshot currently reports that the backend is unreachable and policy could not be loaded. Diagnose the actual failure before changing the visual message; the screenshot does not establish whether the cause is a stopped backend, wrong deployment URL, network/CORS error, authentication failure, or a failing policy endpoint.

### Required work

1. Check the frontend's configured API base URL for local and deployed environments.
2. Verify the backend deployment is running and its health/readiness endpoint responds.
3. Verify the policy/settings endpoint path, HTTP method, authentication headers/session token, response schema, and CORS configuration.
4. Check deployment and browser network logs for the actual HTTP status and error body; avoid exposing secrets in logs.
5. Confirm expected policy records exist for a new merchant and define the intended first-run behavior when no policy has been configured yet.
6. Distinguish among a network/backend failure, unauthenticated access, forbidden access, missing initial configuration, and an empty policy result.
7. Add retry/refresh behavior and actionable error messages. Do not show a successful policy state when the backend failed.
8. Disable or block production Save changes actions when policy state is unknown or authorization cannot be verified. Do not silently fall back to fake policy in real mode.
9. Include request/correlation IDs and safe structured logs to aid diagnosis.
10. Demo Mode may display its curated demo policy independently of production backend availability, but that data must remain clearly identified as demo data.

---

## 8. Update the Core Commerce and External-agent Architecture

Retain the existing Seller Agent, Customer Service Agent, deterministic commerce services, policy boundaries, audit approach, and tenant isolation. Refine implementation priorities so that the external-agent transaction pathway is exercised early.

### External agent boundary

External shopping/buyer agents remain independently operated clients. SELLABLE must not host an internal Buyer Agent and must not treat demo fixtures as real buyers.

External requests enter through a controlled gateway that handles the supported protocol, request validation, agent/application authentication, capability negotiation, rate limits, idempotency, tenant/merchant resolution, and authorization context.

### Canonical commerce core

Protocol adapters map requests to one canonical set of commerce commands. Do not implement different pricing, inventory, checkout, payment, or order rules in each adapter.

The initial end-to-end path should support:

1. Merchant/product discovery and authoritative product lookup.
2. Current price and availability validation.
3. Cart creation and mutations.
4. Authoritative totals and checkout-state management.
5. Shipping/tax options appropriate to the configured merchant and region.
6. Customer identity linking and bounded delegation when required.
7. Required customer approval or supported transaction-bound authorization.
8. Payment-provider sandbox integration and verified webhook reconciliation.
9. Order creation/status retrieval only after the appropriate payment/order state transitions.
10. Idempotent retry behavior, material audit evidence, and correlated logs/events.

A real live transaction requires a real merchant offer or genuine product/service, suitable merchant payment arrangements, and fulfillment or delivery obligations that can actually be met. Sandbox products and payment events must remain in the sandbox environment.

### Agent responsibilities

- **Seller Agent:** merchant-side product assistance and sales orchestration through authorized tools.
- **Customer Service Agent:** authenticated, policy-bounded post-purchase support and escalation.
- **External buyer agents:** external principals that discover and request commerce operations through the supported interfaces.
- **Deterministic services:** authoritative source for catalog, price, promotions, availability, checkout, authorization, payment state, and orders.

No agent may directly mutate the database, set authoritative prices, claim payment success, bypass delegation, or override merchant policy.

---

## 9. Protocol Integration Priorities

Use a staged, adapter-based implementation. All protocol surfaces must use the same canonical commerce services.

1. **Canonical REST API:** primary internal commerce contract.
2. **UCP-compatible merchant profile and commerce adapter:** implement supported discovery, capability negotiation, checkout, identity-linking, and order capabilities as appropriate to the selected specification version.
3. **Remote MCP server:** expose a narrowly scoped set of typed tools for compatible external agent clients, such as product search/lookup, availability, cart, checkout, and order status. Each tool must use the same server-side authorization and commerce services.
4. **ACP adapter:** keep the core compatible with a later OpenAI Agentic Commerce Protocol integration, including checkout session state, authoritative cart responses, signed/authenticated requests as specified, idempotency, order events, and the merchant's existing payment stack. Treat partner onboarding/approval as a separate external dependency; implementing the specification alone does not guarantee placement in ChatGPT or access to Instant Checkout.
5. **AP2-compatible or equivalent transaction-bound authorization:** add the required intent/authorization artifacts when supported by the chosen payment and protocol integration. Do not assume unattended payment authority exists merely because checkout endpoints are exposed.
6. **A2A:** implement when a specific agent-to-agent use case requires it; it is not a prerequisite for the first direct external-agent transaction.

Protocol versions and schemas must be pinned, documented, and tested. Capability discovery must accurately advertise only the functions currently supported by the live merchant/environment.

---

## 10. Implementation Plan and Acceptance Criteria

### Milestone A — Restore access and routing

- Supabase Auth is enabled and configured for the intended providers.
- Sign-in and sign-up pages are available again.
- Password recovery/verification/callback handling works where applicable.
- Open Console routes by session state; it never bypasses auth for the production dashboard.
- Demo Mode is available without an account.

**Acceptance test:** A signed-out visitor cannot access another merchant's production dashboard or mutate production data; they can still enter Demo Mode.

### Milestone B — Shared onboarding

- Both modes use the same multi-step onboarding UI and step sequence.
- Production data is saved to the authenticated user's authorized workspace/merchant.
- Demo data is kept in a separate demo store/session.
- Onboarding can resume after navigation or refresh.
- Production readiness is based on actual completed checks, not simply finishing the wizard.

**Acceptance test:** A user can sign up, complete onboarding, sign out, sign back in, and return to their own configured dashboard. A visitor can complete demo onboarding without creating a Supabase Auth account.

### Milestone C — Realistic Demo Mode

- All primary dashboard sections are populated by a curated, coherent fixture set.
- Dashboard interactions behave predictably in demo mode.
- Demo mode is visibly marked.
- Reset/re-entry behavior is predictable.
- No demo action can create a production order, charge a payment method, alter live policies, send a live notification, or write to another tenant.

**Acceptance test:** Automated tests confirm demo operations cannot mutate production data or use production credentials.

### Milestone D — Backend reliability and Settings

- The policy/settings failure has a confirmed root cause or a well-instrumented remaining diagnostic state.
- Health/readiness, API configuration, authentication, CORS, and policy retrieval are verified.
- Initial-policy absence is distinct from backend unavailability.
- Real-mode writes fail safely when required backend state or authorization is unavailable.

**Acceptance test:** Network failure, 401, 403, missing initial policy, and successful policy loading produce distinct and appropriate UI states.

### Milestone E — External-agent sandbox transaction

- A test merchant has an isolated catalog and transaction environment.
- REST and the selected UCP/MCP interface reach the canonical commerce services.
- A compatible real external agent can search, create a cart, and initiate checkout.
- Payment sandbox callbacks/webhooks are verified and reconciled.
- Order state is correct and idempotent under retries.
- No internal Buyer Agent is implemented or required.

**Acceptance test:** An external agent completes the documented sandbox purchase flow, and all state transitions can be traced through correlated logs/audit records.

### Milestone F — Live merchant readiness

- At least one real merchant or genuine sellable product/service is configured.
- Merchant identity, catalog, payment, fulfillment/delivery, returns/support, and applicable compliance checks are complete.
- Production and sandbox environments and credentials are isolated.
- The platform accepts live transactions only when all required checks pass.

**Acceptance test:** A valid authorized live purchase can be reconciled into the correct production merchant's order records without creating duplicate orders or confusing test and production data.

---

## 11. Security and Reliability Invariants

These rules are mandatory in both design and tests:

- Supabase Auth user identity is not interchangeable with merchant, customer, or external agent identity.
- Every real-mode read/write is authorized for the current user and their tenant/workspace/merchant.
- RLS and server-side authorization prevent cross-tenant data access.
- Demo mode cannot be promoted into production by editing client state.
- No demo record is represented as a real customer, live payment, or production order.
- No invented product/SKU, stale price, unsupported availability claim, or ineligible promotion can reach authoritative checkout.
- No payment is executed without applicable customer authority, merchant policy checks, risk controls, and transaction-bound validation.
- Payment amount, currency, merchant/payee, and authorized checkout state must match.
- Provider webhooks are verified before changing payment/order state.
- Idempotency keys are required for consequential retryable operations.
- Unknown payment states remain pending/failed safely; agents cannot declare a payment successful.
- Real checkout remains deterministic if an LLM provider is unavailable.
- Secrets and service-role credentials never reach browser code, agent context, demo data, or client logs.
- All consequential production actions have traceable audit evidence without storing hidden model reasoning.

---

## 12. Technology and Architecture Guidance

Retain the existing stack unless the implementation reveals a concrete need to change it:

- **Frontend:** Next.js + TypeScript.
- **Authentication and transactional database:** Supabase Auth + PostgreSQL, with RLS and migrations.
- **Backend:** FastAPI/Python for canonical commerce APIs and domain services.
- **Agent runtime:** existing agent runtime, including LangGraph if already selected, used for bounded Seller/Service workflows rather than as a system of record.
- **Catalog search:** PostgreSQL full-text search and pgvector initially, if already aligned with the implementation.
- **Payments:** provider adapter and sandbox integration first; validate multi-merchant settlement support before live marketplace payouts.
- **Observability:** structured logs, request/correlation IDs, transaction identifiers, and audit records first; expand to OpenTelemetry and deeper analytics as implementation needs mature.

Start with a modular monolith and explicit domain boundaries. Do not require a separate deployment for every logical component before the first external-agent transaction works.

---

## 13. Definition of Done

The update is complete when all of the following are true:

- Supabase Auth is restored and working.
- The sign-in/sign-up experience is back.
- Open Console respects the authentication state.
- A visitor can choose Demo Mode without an account.
- Both real and demo visitors can complete the same multi-page onboarding experience.
- Real users reach their own customizable, backend-connected dashboard.
- Demo users experience the full dashboard navigation using curated, realistic, internally consistent data.
- Demo operations are isolated from production data and real side effects.
- The Settings policy/backend error is diagnosed and handled accurately.
- SELLABLE still has no internal Buyer Agent.
- A compatible, independently operated external agent can use the supported commerce interface to complete an isolated sandbox checkout and receive the correct order result.
- Production live checkout is enabled only for a real merchant/product with appropriate payment, authorization, and fulfillment readiness.

---

## Official References

- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase Next.js quickstart: https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Universal Commerce Protocol overview: https://ucp.dev/2026-01-11/specification/overview/
- Anthropic remote MCP connectors: https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp
- OpenAI Agentic Commerce Protocol: https://developers.openai.com/commerce
- OpenAI Agentic Checkout Specification: https://developers.openai.com/commerce/specs/checkout

These references inform the proposed integration direction. The implementation must follow the protocol specification versions and provider requirements selected at build time.
