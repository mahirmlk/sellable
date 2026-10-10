-- Phase 5 protocol interoperability (SELLABLE_ARCHITECTURE.md §12, §15,
-- §38 agent_sessions/customer_identities family).
--
-- New tables (created by SQLAlchemy Base.metadata.create_all; this file
-- sets the Supabase posture to match all earlier migrations):
--   protocol_sessions, identity_links.
--
-- Posture: REVOKE ALL from anon/authenticated + RLS with no policies
-- (deny-by-default). Backend uses a direct Postgres connection and the
-- service-role key, both of which bypass RLS. Sessions carry negotiated
-- capability sets; identity links carry customer references plus a
-- link-code hash (never the code). No payment secrets, no credentials.

REVOKE ALL PRIVILEGES ON TABLE
    public.protocol_sessions,
    public.identity_links
FROM anon, authenticated;

ALTER TABLE public.protocol_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_links    ENABLE ROW LEVEL SECURITY;

-- Verify after applying:
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public'
--        AND tablename IN ('protocol_sessions','identity_links');
--    -- rowsecurity must be true for both.
