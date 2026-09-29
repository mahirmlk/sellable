# Merchant Console

Next.js 16 dashboard for SELLABLE merchants: monitor agent-driven sales,
approve held orders, manage catalog/policy, and run conversational checkout.

## Routes (`app/dashboard/`)

| Route | Page |
|---|---|
| `/dashboard` | Overview (status, recent activity) |
| `/dashboard/chat` | AI Sales — conversational checkout |
| `/dashboard/activity` | Live ledger event feed |
| `/dashboard/approvals` | Human-approval queue |
| `/dashboard/transactions` | Order list (truncated window, see below) |
| `/dashboard/transactions/[id]` | Order detail + ledger trace |
| `/dashboard/transactions/[id]/replay` | Full event replay timeline |
| `/dashboard/buyers` (+ `[id]`) | Buyer missions + mission detail |
| `/dashboard/catalog` (+ `[sku]`) | Product list + product detail |
| `/dashboard/inventory` | Stock levels |
| `/dashboard/growth` | Revenue / negotiation insights |
| `/dashboard/payments` | Payment attempts (CAPTURED / FAILED / PENDING) |
| `/dashboard/selling-rules` | Policy editor (thresholds, limits) |
| `/dashboard/settings` | Merchant settings |
| `/dashboard/developers` | Agent API keys (issue / rotate / revoke) |
| `/dashboard/storefront` | Storefront + agent-key management |
| `/dashboard/onboarding` | Create your store (403 `onboarding_required` lands here) |

## API client (`lib/api.ts`)

Typed `fetch` wrapper around the FastAPI backend. Auth is automatic:

- **Demo mode** (no `NEXT_PUBLIC_SUPABASE_URL`): sends `X-Agent-Key`
  (`NEXT_PUBLIC_AGENT_KEY`, default `sellable_demo_key_001`). Dev backend only —
  a production backend 401s it with `auth_not_configured`.
- **Supabase mode**: sends `Authorization: Bearer <merchant JWT>` (with
  proactive session refresh). Backend resolves `sub` → merchant; every route is
  merchant-scoped and foreign ids are 404s.

Errors throw `ApiError` with a machine-readable `errorCode`:
`onboarding_required` (403 → go to `/dashboard/onboarding`),
`auth_not_configured` (401 → console/backend auth modes disagree; see
`authConfigGuidance`), plus `isNotFound` / `isServerError` helpers.

## Key behaviors

- **Status cache (15s):** `/agents/status` responses are shared across
  components and reused for 15s (`getAgentsStatus(force)` bypasses).
- **Live events (SSE + polling fallback):** `streamConsoleEvents` opens
  `GET /activity/stream` with bounded reconnects (default 3, exponential
  backoff, 401/403 short-circuit); callers run a ~5s polling fallback once the
  budget is spent. Never an unbounded reconnect storm.
- **Checkout history probe:** `listCheckoutSessions` returns `null` when the
  history routes are undeployed (panel hides); `isHistorySupported()` is a
  tri-state probe — a genuine 404 never flips it. DELETE soft-archives; commerce
  rows are never destroyed.
- **Truncation notice:** the transactions list is a 500-row window — the UI
  says "Showing the 500 most recent orders" instead of implying completeness.
- **Chat checkout:** refresh-before-pay (re-issue dead single-use consents) with
  one 409 re-issue retry; restored quotes are marked provisional until the
  seller reconfirms; MARK FULFILLED and dev-only simulate-capture/failure live
  in chat. Settlement is webhook-only — a 200 from simulate means the attempt
  was recorded, settled only when `attempt.status` is `CAPTURED`.

## Env vars

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base URL (prod `https://api.sellable.shop`, dev `http://localhost:8000`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Unset = demo mode |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase key (Supabase mode) |
| `NEXT_PUBLIC_AGENT_KEY` | Demo `X-Agent-Key` (demo mode only, never sent in Supabase mode) |
| `NEXT_PUBLIC_SITE_URL` | Console public URL (links, redirects) |

Backend/auth matrix: demo console ↔ development backend, or Supabase on **both**
sides. Any mismatched pairing always 401s (`auth_not_configured`).

## Dev commands

```bash
npm install      # required first — repo ships without node_modules
npm run dev      # console at http://localhost:3000
npm run build    # production build (Vercel)
npm run lint     # eslint
```

`npx tsc --noEmit` also works only after `npm install`.
