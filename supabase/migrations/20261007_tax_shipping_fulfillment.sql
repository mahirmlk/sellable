-- Phase 2c tax/shipping/fulfillment/returns (SELLABLE_ARCHITECTURE.md
-- §22, §23, §26, §38).
--
-- New tables (created by SQLAlchemy Base.metadata.create_all; this file
-- sets the Supabase posture to match all earlier migrations):
--   tax_rates, shipping_methods, fulfillments, tracking_events,
--   returns, exchanges, refund_requests.
--
-- Posture: REVOKE ALL from anon/authenticated + RLS with no policies
-- (deny-by-default). Backend uses a direct Postgres connection and the
-- service-role key, both of which bypass RLS. These rows carry rate cards,
-- shipment state, and post-purchase case state only — no payment secrets,
-- no credentials.

REVOKE ALL PRIVILEGES ON TABLE
    public.tax_rates,
    public.shipping_methods,
    public.fulfillments,
    public.tracking_events,
    public.returns,
    public.exchanges,
    public.refund_requests
FROM anon, authenticated;

ALTER TABLE public.tax_rates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfillments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.returns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchanges        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

-- Verify after applying:
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public'
--        AND tablename IN ('tax_rates','shipping_methods','fulfillments',
--          'tracking_events','returns','exchanges','refund_requests');
--    -- rowsecurity must be true for all seven.
