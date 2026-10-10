-- Phase 2a persistent carts (SELLABLE_ARCHITECTURE.md §18.2, §38).
--
-- New tables (created by SQLAlchemy Base.metadata.create_all; this file
-- sets the Supabase posture to match all earlier migrations):
--   carts, cart_items.
--
-- Posture: REVOKE ALL from anon/authenticated + RLS with no policies
-- (deny-by-default). Backend uses a direct Postgres connection and the
-- service-role key, both of which bypass RLS. Cart rows carry no payment
-- secrets — SKU snapshots, quantities, server-derived totals only.
-- Prices are snapshotted from the catalog at mutation time; callers can
-- never submit prices.

REVOKE ALL PRIVILEGES ON TABLE
    public.carts,
    public.cart_items
FROM anon, authenticated;

ALTER TABLE public.carts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

-- Verify after applying:
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public'
--        AND tablename IN ('carts','cart_items');
--    -- rowsecurity must be true for both.
