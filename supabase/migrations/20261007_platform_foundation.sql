-- Phase 1b platform-foundation tables (SELLABLE_ARCHITECTURE.md §38).
--
-- New tables (created by SQLAlchemy Base.metadata.create_all; this file
-- sets the Supabase posture to match all earlier migrations):
--   delegations, agents, agent_reputations, merchant_onboarding, outbox_events.
--
-- Posture (matches 20260902_lock_down_internal_tables + per_merchant_stores
-- + 20260910_secure_public_tables):
--   * REVOKE ALL from the public-facing PostgREST roles (anon, authenticated).
--   * ENABLE ROW LEVEL SECURITY with NO permissive policies (deny-by-default).
--   * Backend/service-role access is unaffected: the backend uses a direct
--     Postgres connection (SQLAlchemy) plus PostgREST with the service-role
--     key, both of which bypass RLS. All data flows through backend REST
--     endpoints scoped by merchant (see merchant_auth.py).
--
-- Sensitive-column review (all covered by the table-level deny):
--   * delegations: customer/agent linkage + amount limits. Backend exposes
--     only owning-merchant rows; revocation is merchant-scoped.
--   * agents / agent_reputations: registry + behavioral counters (risk
--     signals, never sole authorization). No credential secrets stored —
--     only status/expiry metadata.
--   * merchant_onboarding: lifecycle stage pointer, no commerce state.
--   * outbox_events: bus delivery queue (actor ids, aggregate refs). Never
--     queried as audit truth — the ledger remains the evidence layer.

-- 1. Revoke every privilege from the public-facing roles.
REVOKE ALL PRIVILEGES ON TABLE
    public.delegations,
    public.agents,
    public.agent_reputations,
    public.merchant_onboarding,
    public.outbox_events
FROM anon, authenticated;

-- 2. Defence in depth: enable RLS with no policies.
ALTER TABLE public.delegations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_reputations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events       ENABLE ROW LEVEL SECURITY;

-- 3. Verify after applying (Advisor equivalent):
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public'
--        AND tablename IN ('delegations','agents','agent_reputations',
--                          'merchant_onboarding','outbox_events');
--    -- rowsecurity must be true for all five.
--    SELECT grantee, table_name, privilege_type FROM role_table_grants
--      WHERE table_schema = 'public'
--        AND tablename IN ('delegations','agents','agent_reputations',
--                          'merchant_onboarding','outbox_events')
--        AND grantee IN ('anon','authenticated');
--    -- must return zero rows.
