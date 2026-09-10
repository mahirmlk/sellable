-- Secure remaining public tables flagged by Supabase Security Advisor.
--
-- Advisor findings (CRITICAL): RLS disabled on public tables
--   webhook_deliveries, refunds, agent_nonces, checkout_sessions,
--   agent_api_keys, buyer_missions.
--
-- Posture (matches 20260902_lock_down_internal_tables + per_merchant_stores):
--   * REVOKE ALL from the public-facing PostgREST roles (anon, authenticated).
--     The anon key ships in the browser bundle and is effectively public.
--   * ENABLE ROW LEVEL SECURITY with NO permissive policies (deny-by-default).
--     No `USING (true)` blanket policies anywhere.
--   * Backend/service-role access is unaffected: the backend uses a direct
--     Postgres connection (SQLAlchemy) plus PostgREST with the service-role
--     key, both of which bypass RLS. Frontend never queries these tables
--     directly — Supabase is used only for Auth (session/JWKS); all data
--     flows through backend REST endpoints scoped by the merchant JWT ->
--     merchant_users -> per-merchant core isolation (see merchant_auth.py).
--
-- Sensitive-column review (all covered by the table-level deny; backend
-- endpoints expose only the minimum required by the frontend):
--   * checkout_sessions: transcript (messages_json), quote snapshot
--     (cart_json/decision_json), budget, order link. No payment secrets are
--     stored in this row. Backend list endpoint projects metadata only
--     (no blobs); full rows require merchant ownership checks.
--   * agent_api_keys: key_hash (SHA-256, brute-forceable if harvested) +
--     key_prefix. Backend views deliberately exclude key_hash; plaintext is
--     returned exactly once at create/rotate.
--   * agent_nonces: (agent_id, nonce, seen_at) replay-protection state.
--   * webhook_deliveries: delivery_key dedupe state.
--   * refunds: provider_payment_id / provider_refund_id money records.
--     Backend presents these only to the owning merchant (owner role).
--   * buyer_missions: mission pointer (order/consent links, budget). State is
--     re-derived from the authoritative order on every read.
-- No API keys, webhook secrets, payment secrets, JWT secrets, or service
-- keys are stored in any of these tables (secrets live only in env).
--
-- Leaked Password Protection is NOT a SQL setting: enable it in the
-- dashboard under Authentication -> Sign In/Up -> Password Protection ->
-- "Leaked Password Protection" (HaveIBeenPwned). Re-run Security Advisor
-- afterwards to confirm the auth finding clears.

-- 1. Revoke every privilege from the public-facing roles.
REVOKE ALL PRIVILEGES ON TABLE
    public.webhook_deliveries,
    public.refunds,
    public.agent_nonces,
    public.checkout_sessions,
    public.agent_api_keys,
    public.buyer_missions
FROM anon, authenticated;

-- 2. Defence in depth: enable RLS with no policies. Even if a grant is
-- accidentally re-added, row-level security blocks every access by default
-- for anon/authenticated, while service_role / direct connections bypass.
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_nonces       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_api_keys     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyer_missions     ENABLE ROW LEVEL SECURITY;

-- 3. Verify after applying (Advisor equivalent):
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public'
--        AND tablename IN ('webhook_deliveries','refunds','agent_nonces',
--                          'checkout_sessions','agent_api_keys','buyer_missions');
--    -- rowsecurity must be true for all six.
--    SELECT grantee, table_name, privilege_type FROM role_table_grants
--      WHERE table_schema = 'public'
--        AND table_name IN ('webhook_deliveries','refunds','agent_nonces',
--                           'checkout_sessions','agent_api_keys','buyer_missions')
--        AND grantee IN ('anon','authenticated');
--    -- must return zero rows.
--    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
--      FROM pg_policies WHERE schemaname = 'public'
--        AND tablename IN ('webhook_deliveries','refunds','agent_nonces',
--                          'checkout_sessions','agent_api_keys','buyer_missions');
--    -- must return zero rows (no blanket USING (true) policies).
