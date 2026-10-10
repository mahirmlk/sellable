-- Phase 8 connectors (SELLABLE_ARCHITECTURE.md §3, §38 merchant_connectors).
--
-- New table (created by SQLAlchemy Base.metadata.create_all; this file
-- sets the Supabase posture to match all earlier migrations):
--   merchant_connectors.
--
-- Posture: REVOKE ALL from anon/authenticated + RLS with no policies
-- (deny-by-default). Backend uses a direct Postgres connection and the
-- service-role key, both of which bypass RLS. Rows hold non-secret
-- mapping configuration only — secrets live in env/secret manager and
-- secret-looking headers are stripped on write.

REVOKE ALL PRIVILEGES ON TABLE
    public.merchant_connectors
FROM anon, authenticated;

ALTER TABLE public.merchant_connectors ENABLE ROW LEVEL SECURITY;

-- Verify after applying:
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public' AND tablename = 'merchant_connectors';
--    -- rowsecurity must be true.
