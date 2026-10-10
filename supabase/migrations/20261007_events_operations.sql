-- Phase 6 events + operations (SELLABLE_ARCHITECTURE.md §27, §34-§36).
--
-- New tables (created by SQLAlchemy Base.metadata.create_all; this file
-- sets the Supabase posture to match all earlier migrations):
--   analytics_events, notifications, webhook_subscriptions,
--   webhook_dispatches.
--
-- Posture: REVOKE ALL from anon/authenticated + RLS with no policies
-- (deny-by-default). Backend uses a direct Postgres connection and the
-- service-role key, both of which bypass RLS. Analytics rows are derived
-- facts; notifications carry merchant-facing text; subscription rows hold
-- signing secrets (server-side use only, never serialized to clients).

REVOKE ALL PRIVILEGES ON TABLE
    public.analytics_events,
    public.notifications,
    public.webhook_subscriptions,
    public.webhook_dispatches
FROM anon, authenticated;

ALTER TABLE public.analytics_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_dispatches   ENABLE ROW LEVEL SECURITY;

-- Verify after applying:
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public'
--        AND tablename IN ('analytics_events','notifications',
--          'webhook_subscriptions','webhook_dispatches');
--    -- rowsecurity must be true for all four.
