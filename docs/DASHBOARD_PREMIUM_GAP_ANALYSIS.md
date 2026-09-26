# Merchant Console — Premium Dashboard Gap Analysis

**Status:** REPORT ONLY — no implementation until approved.
**Scope:** `apps/merchant-console` (all 20 dashboard routes + shared components).
**Method:** 4-track research — (1) premium SaaS feature taxonomy, (2) glassmorphism engineering,
(3) data-table/analytics UX, (4) full read-only codebase audit — cross-referenced below.

**Two hard constraints driving every recommendation:**
1. **Design pivot:** replace the "golden hour" warm/gold theme with **translucent blur / glass (glassmorphism)**.
2. **No fake data.** Every new element must bind to a real API field, a real route, or be a working
   frontend-only feature. No fabricated metrics, avatars, notifications, testimonials, or mock rows.

---

## 0. Executive summary

The console is **functionally honest but structurally thin**. It does the hard parts well (real data
everywhere, exceptional partial-failure handling on Home via `Promise.allSettled`, real ledger
provenance), but it ships almost none of the interaction layer that separates a premium product from a
generic CRUD admin: no sorting, no pagination, no date filtering, no toasts, no confirmations on
irreversible money actions, no charts, no user menu, and **12 real backend capabilities the UI never
surfaces** (including "mark order fulfilled", which exists in the API and appears in every status
badge — yet no button produces it).

Worse, four dead components in `components/dashboard/` ship **hardcoded mock data** (`order-feed.tsx`,
`ledger-view.tsx`, `catalog-table.tsx`, `auth-form.tsx`) — direct violations of the no-fake-data rule
waiting to be resurrected. They get deleted in Phase 0.

Priority split: **7 P0 items** (premium blockers), **13 P1** (premium depth), **10 P2** (polish).

---

## 1. New design direction — "Aurora Glass" (replaces Golden Hour)

Glass is a **chrome material, not a reading-surface material** — the single rule that separates
premium glassmorphism from the cheap kind (NN/g; Apple "puts glass on chrome, not content"; Fluent 2
restricts acrylic to popovers/menus). Current golden-hour tokens (`--warm-*`, gold `#8f6522`,
sand `#ede6d9`) are replaced wholesale.

### 1.1 Material system

| Surface class | Material | Recipe |
|---|---|---|
| **Chrome glass** — sidebar, topbar, command palette, popovers, modals, toasts, floating pills | Translucent glass | fill `rgba(255,255,255,0.55)` (light) / `rgba(17,25,40,0.55)` (dark) + `backdrop-filter: blur(16px) saturate(160%)` + hairline `rgba(30,33,45,0.12)` + top specular `inset 0 1px 0 rgba(255,255,255,.85)` + bottom bounce `inset 0 -1px 0 rgba(255,255,255,.06)` + lift `0 8px 32px rgba(30,33,45,.10)` |
| **Content surfaces** — table bodies, form fields, long text | **Opaque / ≥55% alpha** (never blurred rows) | `rgba(255,255,255,0.85–1)`; blur halos destroy 12–13px glyph legibility |
| **Cards / KPI tiles** | Glass frame, opaque body | glass container + ≥55% fill content area (guarantees WCAG 4.5:1) |
| **Hero / page backdrop** | Controlled aurora mesh (never flat) | radial gradient mesh (indigo→violet→teal or amber dusk) — glass over flat color "reads as a gray smudge" |

### 1.2 Non-negotiable engineering rules (from research)
- **Blur 8–16px**, `saturate(140–180%)` — saturate is what keeps blur from looking muddy; never animate blur radius (transform/opacity only).
- **One glass layer per z-level** — never glass-on-glass (Chromium renders nested backdrop-filters wrong; compounding cost).
- **Contrast certified at worst-case backdrop**: body text only on ≥55% fill; short labels may ride lighter glass with `text-shadow: 0 1px 3px rgba(0,0,0,.5)`.
- **Fallback ladder** (mandatory): solid base → `@supports (backdrop-filter)` → `@media (prefers-reduced-transparency: reduce)` → solid 0.95 fill, `backdrop-filter: none`. Ship `-webkit-backdrop-filter` alongside (Safari <18).
- **Stacking-context traps**: no `will-change: transform` ancestors above glass; modals mount outside the glass tree (backdrop-filter traps `position: fixed` descendants).
- Safari border-radius bleed (WebKit 205019): extend blur via `mask-image`, not `overflow: hidden`.
- Sticky topbar uses the "extended blur + flicker scrim" recipe (Comeau): 200%-height backdrop layer,
  `mask-image` fade, opaque→transparent top gradient, `pointer-events: none`.
- `prefers-reduced-motion` and `forced-colors` honored (1px hairline survives forced-colors — it is an a11y feature, not decoration).

### 1.3 What changes where
- **Delete:** `--warm-*` tokens, `.warm-hero` gold gradient, `warm-thumb` gold/ink tiles, `#8f6522`/`#c08f3a` accent map, `#ede6d9` sand canvas.
- **Add:** `--glass-*` token set (§1.1), aurora mesh backdrop on `.dashboard-shell`, specular-edge
  utilities, popover/modal glass, glass search pill, KPI "glass card" with opaque data zones.
- **Keep:** the serif display font (Instrument Serif) — hierarchy is font-driven in premium products
  (Stripe precedent: "hierarchy from size/weight/tracking, not exotic fonts"); tabular-nums on all
  numeric surfaces (currently partial); semantic status colors (sage/bronze/terracotta) retuned to the
  new neutral base.

**Open decision (see question):** light aurora glass (Apple/Linear airy) vs dark aurora glass
(Raycast/Reflect/Revolut cinematic) vs both with a theme switcher (adds QA cost).

---

## 2. Current state — what exists (audited)

**Chrome:** sidebar (grouped nav, collapse w/ localStorage, mobile drawer) + topbar (store name,
search pill → ⌘K CommandMenu, 3 live status pills) + DashboardGuard. Command palette is
**navigation-only**.

**Pages:** Home (9 real sections, best-in-class partial failure), Products (create-only CRUD, table/grid,
search+sort+filters+CSV), Product detail (read-only), Inventory (read-only + CSV), Orders (7 status tabs,
search/sort/saved views/CSV), Order detail (6 tabs incl. negotiation & ledger), Replay (stage-bucketed
ledger audit trail), Buyers (client-derived from orders), Buyer detail, Approvals (approve/reject +
auto-resume buyer missions, 12s poll), Live Activity (SSE stream, buyer-mission runner, CSV), Analytics
(4 tabs of aggregates, **no charts**), Payments (read-only), Selling Rules (policy editor + simulator),
Settings (6 sections, duplicate policy editor), AI Storefront (manifest + API keys), Developers (duplicate
API keys), AI Sales chat (3-pane checkout state machine — deepest surface in the app), Onboarding.

**Strengths to preserve:** real-data discipline; Home's `Promise.allSettled` + "—" instead of zeros;
Replay provenance (inputs/output JSON, policy refs, trace IDs); chat's session sync state machine.

---

## 3. Gap analysis — premium vs current

Cost legend: **FE** = frontend-only · **BE** = needs backend/API · Severity: **P0** blocker · **P1** depth · **P2** polish

### 3.1 Real backend capabilities the UI never surfaces (the no-fake-data feature goldmine)

These need zero new endpoints — the data/actions already exist. Research says this "state
transparency" layer is exactly what separates Stripe-grade products ("show what competitors hide").

| # | Gap | Evidence | Cost | Sev |
|---|---|---|---|---|
| 1 | **Mark order FULFILLED** — `POST /console/orders/{id}/fulfill` documented (API.md L382); `FULFILLED` appears in every badge/tab but no UI can produce it | audit §2.2 | FE (wrap + button on paid orders) | **P0** |
| 2 | **Payment failure reason** — `PaymentAttemptPayload.failure_reason` is "classified by the backend" (chat copy says so) yet never rendered | audit §6.3 | FE | **P0** |
| 3 | **Policy explanation** — `policy_explanation` already mapped into `Transaction.policy.explanation` (commerce-view.ts L52), rendered nowhere | audit §6.3 | FE | **P0** |
| 4 | **Partial refund + idempotency key** — refund params documented (`amount_paise`, `idempotency_key`); wrapper only exposes `reason`, so all refunds are forced-full | audit §2.2 | FE wrapper + form | P1 |
| 5 | **Buyer-mission state machine** — `getBuyerMission` returns authoritative `state`, `required_action`, `mission_message`, `negotiated_amount_paise`, `payment_url`; Activity reconstructs it from "event archaeology" instead | audit §2.3 | FE | P1 |
| 6 | **Ledger pagination** — `GET /console/events` supports `offset` (clamp 500); UI fetches 100 once, caps client buffer at 500, older history unreachable | audit §5.1 | FE | P1 |
| 7 | **Session rename** — `PATCH /console/checkout/session {title}` exists (`patchCheckoutSession`); history rows aren't renameable | audit §2.1 #7 | FE | P1 |
| 8 | **Sidebar approvals badge** — `badgeKey: "approvals"` + `badges` prop both exist; `DashboardShell` never passes counts, so the badge never renders | audit §5.12 | FE | **P0** |
| 9 | **Order support fields** — `quote_id`, `idempotency_key`, `payment_id`, `consent_expires_at` exist on `ConsoleTransaction`, absent from order detail | audit §6.3 | FE | P1 |
| 10 | **Session list richness** — `message_count`, `approval_pending` on `CheckoutSessionListItem` never shown | audit §6.3 | FE | P2 |
| 11 | **Health summary** — `AgentsStatusResponse.summary.{total_orders, paid_orders}` + `getHealth` (db/razorpay state) unused | audit §6.3 | FE | P2 |
| 12 | **StoreInfo.role** — owner-vs-staff never displayed (and should gate policy editing later) | audit §6.3 | FE | P2 |

### 3.2 Data tables — the densest premium/generic divider

| # | Gap | Research benchmark | Cost | Sev |
|---|---|---|---|---|
| 13 | **No sortable column headers anywhere** (Orders/Products use `<select>`; Inventory/Buyers/Payments fixed order). "A sorted column with no visible arrow is a silent lie" | Stripe DataTable, Carbon, TanStack | FE | **P0** |
| 14 | **No pagination anywhere** + hardcoded slices (`slice(0,6/5/8/3)`) + `getConsoleTransactions()` unbounded re-fetched whole on 7 pages. "Never paginate without a total count" | Shopify >50 rule; setproduct | FE (+BE params already exist for events) | **P0** |
| 15 | **No column visibility / resize / density** — "a power-user feature that resets on every reload is a tease, not a tool" | Stripe `column settings`, MUI X, Carbon density | FE (persist localStorage) | P1 |
| 16 | **No bulk selection / row action menus** — every row is a bare `<Link>`; approvals has no bulk approve/reject. Hover-only actions banned (a11y) | Carbon batch mode, NN/g bulk-action trio | FE (+BE for bulk) | P1 |
| 17 | **Cell typing gaps** — IDs not monospace-copiable, amounts right-aligned inconsistently, no `tabular-nums` discipline outside some cards | Stripe `IdTableCell/CurrencyTableCell` | FE | P1 |
| 18 | Mobile fallbacks inconsistent (cards on 4 pages only); `thead` semantics stripped by card stacking | Smashing responsive tables | FE | P2 |

### 3.3 Analytics & reporting

| # | Gap | Research benchmark | Cost | Sev |
|---|---|---|---|---|
| 19 | **Analytics page has zero charts** — 4 tabs of scalar aggregates. Premium = bar/line with declutter rules, insight-titled charts | Mixpanel/Amplitude vocabulary; SWD declutter | FE (derive time series from `getConsoleTransactions().created_at` — real data) | **P0** |
| 20 | **KPI cards lack deltas/sparklines/targets** — "a bare number is trivia, not insight"; need "+x% vs last period" with named baseline + ▲▼ (never color alone) | KPI anatomy (label→value→delta→trend) | FE (previous-period deltas computable from real order timestamps) | **P0** |
| 21 | **No date-range picker anywhere** — everything is all-time; timestamps render time-only. "The date range is the most important control on a reporting screen" | GA/Mixpanel comparison periods | FE filtering + BE for true aggregates | P1 |
| 22 | **No drill-down** — clicking a KPI/chart segment must reach the underlying rows without losing your place; keep drill state in URL | Stripe "drill-downs that never lose your place" | FE | P1 |
| 23 | **No export on Buyers/Payments/Approvals/Growth/Order items/Replay trail** (4 of 10 surfaces have CSV). Export must state scope ("12 filtered rows · Jun 1–30") | Carbon export pattern | FE | P1 |
| 24 | No metric definition tooltips, no "Updated x min ago" freshness | FanRuan lineage; fintech trust rules | FE | P2 |

### 3.4 Search & command surfaces

| # | Gap | Research benchmark | Cost | Sev |
|---|---|---|---|---|
| 25 | **Command palette is nav-only; topbar promises "Search sales, reports, or products…"** — an overpromise. Premium palettes carry **actions + record search** (Superhuman 5 rules: omnipotent, central, forgiving aliases) | Superhuman, Linear, Notion | FE actions; FE record search over real `getConsoleCatalog/getConsoleTransactions` queries | **P0** |
| 26 | No recent-items list in palette (recency ranking) | Notion recents | FE | P2 |
| 27 | Filters: no applied-filter chips, no per-filter clear, no result-count convention on 6 of 10 lists, no URL persistence of filter state (unbookmarkable) | Carbon filtering pattern; setproduct | FE | P1 |
| 28 | Saved views exist on 3 surfaces under **2 incompatible conventions** (`mc-views:*` vs `sellable.saved-views.*`, 2 UIs) | setproduct/Fibery demand | FE unify | P1 |

### 3.5 Feedback states, safety & recovery

| # | Gap | Research benchmark | Cost | Sev |
|---|---|---|---|---|
| 29 | **No confirmation on irreversible money/security actions: Refund, Revoke API key, Reject approval** (only chat-history delete confirms — via `window.confirm`). NN/g: confirmations name the object ("Refund ₹4,200 to buyer_agent_01?") | NN/g 8 guidelines; type-to-confirm for worst ops | FE | **P0** |
| 30 | **No toast system** (only 3–4s inline banners) and **no undo** anywhere | Material snackbar+Undo; "undo is what lets you remove confirmations" | FE | **P0** |
| 31 | Empty states: "no results" vs "no data" handled well in 4 pages, missing distinction in others; empty states don't always carry exactly one next action | Carbon empty-state taxonomy | FE | P1 |
| 32 | Partial failure per widget is excellent on Home, absent elsewhere (all-or-nothing pages) | SaaSUI "honest partial-data indicators" | FE | P1 |
| 33 | Skeletons missing on API-keys ("Loading keys…" text) and chat conversation; skeletons not `aria-hidden`/`aria-busy` | NN/g skeleton 101 | FE | P2 |
| 34 | No global offline/backend-down banner outside per-page banners | — | FE | P2 |

### 3.6 Navigation, IA & personalization

| # | Gap | Research benchmark | Cost | Sev |
|---|---|---|---|---|
| 35 | **No breadcrumbs** on any detail page (single "Back to X" links) — deep links are majority traffic | NN/g 11 guidelines; Shopify | FE | P1 |
| 36 | **No user/account menu** — `IconSignOut` exists unused; demo cookie can't be cleared via UI; `StoreInfo.role` invisible | every premium admin | FE | P1 |
| 37 | No theme switch (light/system/dark) — "table stakes in 2026" | Vercel Geist switcher | FE | P2 (optional — doubles QA with glass) |
| 38 | No onboarding checklist — real steps derivable from real state (store created ✓ / policy configured / products > 0 / payments configured) | Carbon checklists | FE | P2 |
| 39 | Duplicate UIs: policy editor in Settings **and** Selling Rules; API-keys block verbatim in Storefront **and** Developers; pill class constants redefined per page | audit §5.13 | FE refactor | P1 |
| 40 | Chat gaps: no session rename, no message timestamps, **ChatHistory unreachable on mobile** (`hidden lg:flex`) | audit §5.16 | FE | P1 |

### 3.7 Keyboard & accessibility

| # | Gap | Research benchmark | Cost | Sev |
|---|---|---|---|---|
| 41 | Shortcuts beyond ⌘K absent: `/` focus search, single-key actions, published cheatsheet ("do the action and learn the shortcut") | Linear/Superhuman | FE | P2 |
| 42 | Focus management on modals/popovers unverified (no modal system exists yet — #29/#30 add one; must ship ARIA dialog pattern + focus return) | W3C APG dialog | FE | P1 (with #29) |
| 43 | Live-region announcements for sort/filter/pagination changes; `FilterTabs` lacks arrow-key nav (only `Tabs` has it) | W3C APG grid/tabs | FE | P2 |
| 44 | Touch targets & color-only states audit after redesign (WCAG 2.2 AA: 24px min, ▲▼ + color, focus visible) | WCAG 2.2 | FE | P2 |

### 3.8 Cleanup required by the no-fake-data rule (do first)

| # | Item | Why | Sev |
|---|---|---|---|
| 45 | **DELETE `order-feed.tsx`** (5 hardcoded orders), **`ledger-view.tsx`** (6 hardcoded events, "trace trc_abc123"), **`catalog-table.tsx`** (hardcoded `upsellCandidates` SKUs) | Ship fabricated data in the codebase | **P0** |
| 46 | Delete dead `auth-form.tsx` (374 lines, sets demo cookie nothing invokes) + unused `ConsentBadge`→ or wire it into chat `ConsentCard` | Dead code | P1 |
| 47 | Theme leftovers: catalog "New product" form is **dark-themed inside the warm/glass page**; `app/error.tsx` + `not-found.tsx` use dark `--bb-*` + `btn-light`; root `viewport` says `colorScheme:"dark"` (also causes the Next.js `themeColor` warning on every page) | Visual inconsistency | **P0** |
| 48 | Three heading systems (PageHeader serif / hand-rolled activity+chat / local SectionLabel) and four metric renderers (`MetricCard`, local `Metric`, local `Stat`, raw divs) | "Generic" feel comes from inconsistency | P1 |

---

## 4. Implementation plan (proposed sequence)

**Phase 0 — Hygiene & safety (P0 #29, #30, #45, #47, #8, #1–3)**
Glass token system + aurora backdrop; delete mock-data components; confirm dialogs + toast system
(ARIA dialog, focus return); Fulfill button, failure_reason, policy_explanation wired; sidebar badge;
fix dark leftovers + viewport warning.

**Phase 1 — Make data feel premium (P0 #13, #14, #19, #20, #25)**
Sortable columns + pagination/totals (client-side where datasets are bounded); command palette with
**actions + real record search**; Analytics charts + KPI deltas/sparklines derived from real order
history.

**Phase 2 — Depth (P1 batch)**
Date-range + comparison periods; drill-downs w/ URL state; column settings + density (persisted);
bulk actions + row menus; breadcrumbs + account menu; export everywhere; unify saved views / editors /
metrics; buyer-mission state panel; ledger pagination; partial refunds; chat rename/timestamps/mobile.

**Phase 3 — Polish (P2 batch)**
Keyboard model + cheatsheet; empty-state taxonomy pass; skeletons + aria; freshness stamps; onboarding
checklist; optional theme switch.

Each phase ships green: `tsc`, `eslint`, `next build`, HTTP smoke of all routes. No phase may introduce
UI that displays anything not backed by an API field or a working feature.

---

## 5. Source basis (condensed)

- **Premium feature taxonomy:** Superhuman (command palette rules), Stripe DataTable (cell types, pinned
  columns, batch actions), NN/g (breadcrumbs, confirmations, empty states, errors), Carbon (density,
  batch mode, export, empty-state taxonomy), Shopify Polaris, Vercel (audit log, theme switcher), TanStack
  Table, MUI X, Notion/Superhuman (recents, saved views).
- **Glassmorphism engineering:** Josh Comeau (extended blur + mask), web.dev/MDN (backdrop-filter,
  fallbacks), Chrome DevRel (`prefers-reduced-transparency`), Apple WWDC25 Liquid Glass, Microsoft Fluent
  Acrylic (layer model + FallbackColor), WebKit 205019 / Bugzilla 1803813 (quirks), superdesign
  production audits (blur 12–16 + saturate 160 sweet spot; body text ≥55% fill).
- **Data/analytics UX:** setproduct 2026 table guide, Pencil & Paper enterprise tables, SWD declutter,
  Tufte sparklines, GA/Mixpanel/Adobe comparison periods, A List Apart zebra studies, Smashing responsive
  tables.
- **Codebase:** full route/API/component/data-model audit of `apps/merchant-console` (45-file inventory,
  45 `lib/api.ts` exports mapped to consumers, 33 wire-type fields listed).

*(Full source URLs are preserved in the research notes accompanying this session.)*
