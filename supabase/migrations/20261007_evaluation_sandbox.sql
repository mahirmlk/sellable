-- Phase 7 evaluation + sandbox (SELLABLE_ARCHITECTURE.md §30, §31).
--
-- New tables (created by SQLAlchemy Base.metadata.create_all; this file
-- sets the Supabase posture to match all earlier migrations):
--   evaluation_suites, evaluation_cases, evaluation_runs,
--   evaluation_results, sandbox_runs.
--
-- Posture: REVOKE ALL from anon/authenticated + RLS with no policies
-- (deny-by-default). Backend uses a direct Postgres connection and the
-- service-role key, both of which bypass RLS. Datasets are deterministic
-- fixtures; runs record outcomes and evidence — no customer PII, no
-- credentials, no payment secrets.

REVOKE ALL PRIVILEGES ON TABLE
    public.evaluation_suites,
    public.evaluation_cases,
    public.evaluation_runs,
    public.evaluation_results,
    public.sandbox_runs
FROM anon, authenticated;

ALTER TABLE public.evaluation_suites  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_cases  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandbox_runs      ENABLE ROW LEVEL SECURITY;

-- Verify after applying:
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public'
--        AND tablename IN ('evaluation_suites','evaluation_cases',
--          'evaluation_runs','evaluation_results','sandbox_runs');
--    -- rowsecurity must be true for all five.
