-- Phase 2 wizard-progress table (UPDATE.md §5, SELLABLE_ARCHITECTURE.md §10).
--
-- New table (created by SQLAlchemy Base.metadata.create_all; this file sets
-- the Supabase posture to match all earlier migrations):
--   onboarding_wizard_progress.
--
-- Posture (matches 20261007_platform_foundation + earlier lockdowns):
--   * REVOKE ALL from the public-facing PostgREST roles (anon, authenticated).
--   * ENABLE ROW LEVEL SECURITY with NO permissive policies (deny-by-default).
--   * Backend/service-role access is unaffected: the backend uses a direct
--     Postgres connection (SQLAlchemy) plus PostgREST with the service-role
--     key, both of which bypass RLS. All data flows through backend REST
--     endpoints scoped by merchant (see merchant_auth.py).
--
-- Sensitive-column review (covered by the table-level deny):
--   * onboarding_wizard_progress: UI pointer only (current/completed steps
--     plus per-step payloads such as store profile extras and catalog
--     choice). No credentials, no commerce state — catalog/policy/order
--     writes still go through their own tenant-scoped endpoints.

-- 1. Revoke every privilege from the public-facing roles.
REVOKE ALL PRIVILEGES ON TABLE
    public.onboarding_wizard_progress
FROM anon, authenticated;

-- 2. Defence in depth: enable RLS with no policies.
ALTER TABLE public.onboarding_wizard_progress ENABLE ROW LEVEL SECURITY;

-- 3. Verify after applying (Advisor equivalent):
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public'
--        AND tablename = 'onboarding_wizard_progress';
--    -- rowsecurity must be true.
--    SELECT grantee, table_name, privilege_type FROM role_table_grants
--      WHERE table_schema = 'public'
--        AND table_name = 'onboarding_wizard_progress'
--        AND grantee IN ('anon','authenticated');
--    -- must return zero rows.
