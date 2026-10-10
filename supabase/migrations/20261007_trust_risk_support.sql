-- Phase 3 trust + risk + support cases (SELLABLE_ARCHITECTURE.md
-- §24, §26, §32, §38).
--
-- New tables (created by SQLAlchemy Base.metadata.create_all; this file
-- sets the Supabase posture to match all earlier migrations):
--   risk_decisions, fraud_events, agent_trust_events, support_cases.
--
-- Posture: REVOKE ALL from anon/authenticated + RLS with no policies
-- (deny-by-default). Backend uses a direct Postgres connection and the
-- service-role key, both of which bypass RLS. These rows carry risk
-- decisions, abuse signals, trust history, and support handoffs — no
-- payment secrets, no credentials, no raw PII beyond merchant-scoped
-- customer references already held in orders/delegations.

REVOKE ALL PRIVILEGES ON TABLE
    public.risk_decisions,
    public.fraud_events,
    public.agent_trust_events,
    public.support_cases
FROM anon, authenticated;

ALTER TABLE public.risk_decisions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_trust_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_cases    ENABLE ROW LEVEL SECURITY;

-- Verify after applying:
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public'
--        AND tablename IN ('risk_decisions','fraud_events',
--          'agent_trust_events','support_cases');
--    -- rowsecurity must be true for all four.
