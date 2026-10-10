-- Phase 4 agent observability (SELLABLE_ARCHITECTURE.md §8.2, §8.3,
-- §29.1, §38 agent_runs/model_calls/tool_calls).
--
-- New tables (created by SQLAlchemy Base.metadata.create_all; this file
-- sets the Supabase posture to match all earlier migrations):
--   agent_runs, model_calls, tool_calls.
--
-- Posture: REVOKE ALL from anon/authenticated + RLS with no policies
-- (deny-by-default). Backend uses a direct Postgres connection and the
-- service-role key, both of which bypass RLS. These rows carry run
-- attribution, model cost/latency telemetry, and tool-call records — no
-- prompts with customer PII (agents receive minimum context already), no
-- credentials, no payment secrets.

REVOKE ALL PRIVILEGES ON TABLE
    public.agent_runs,
    public.model_calls,
    public.tool_calls
FROM anon, authenticated;

ALTER TABLE public.agent_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_calls  ENABLE ROW LEVEL SECURITY;

-- Verify after applying:
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public'
--        AND tablename IN ('agent_runs','model_calls','tool_calls');
--    -- rowsecurity must be true for all three.
