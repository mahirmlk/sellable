-- Phase 2b pricing/promotions/quotes/checkout (SELLABLE_ARCHITECTURE.md
-- §18.3, §18.4, §20, §38).
--
-- New tables (created by SQLAlchemy Base.metadata.create_all; this file
-- sets the Supabase posture to match all earlier migrations):
--   promotion_campaigns, promotion_redemptions, quotes, quote_items,
--   checkouts, checkout_lines, checkout_events.
--
-- Posture: REVOKE ALL from anon/authenticated + RLS with no policies
-- (deny-by-default). Backend uses a direct Postgres connection and the
-- service-role key, both of which bypass RLS. These rows carry offer and
-- price-snapshot state only — no payment secrets, no credentials.

REVOKE ALL PRIVILEGES ON TABLE
    public.promotion_campaigns,
    public.promotion_redemptions,
    public.quotes,
    public.quote_items,
    public.checkouts,
    public.checkout_lines,
    public.checkout_events
FROM anon, authenticated;

ALTER TABLE public.promotion_campaigns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkouts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_lines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_events      ENABLE ROW LEVEL SECURITY;

-- Verify after applying:
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public'
--        AND tablename IN ('promotion_campaigns','promotion_redemptions',
--          'quotes','quote_items','checkouts','checkout_lines',
--          'checkout_events');
--    -- rowsecurity must be true for all seven.
