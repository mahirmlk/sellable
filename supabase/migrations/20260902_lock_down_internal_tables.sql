-- Lock down internal application tables from the exposed PostgREST roles.
--
-- The `anon` key ships inside the frontend JavaScript bundle and is, for all
-- practical purposes, public. These tables previously had RLS disabled and
-- full privileges (including DELETE/TRUNCATE) granted to `anon` and
-- `authenticated`, allowing anyone to read or wipe the merchant user mapping,
-- orders, consents, the audit ledger, and policy state.
--
-- All access to these tables is server-side only (backend uses the
-- `postgres`/`service_role` roles), so the public roles get no access at all.

-- 1. Revoke every privilege from the public-facing roles.
REVOKE ALL PRIVILEGES ON TABLE
    public.merchant_users,
    public.orders,
    public.consents,
    public.ledger_events,
    public.policy
FROM anon, authenticated;

-- 2. Defence in depth: enable RLS with no policies. Even if a grant is
-- accidentally re-added, row-level security blocks every access by default.
ALTER TABLE public.merchant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy        ENABLE ROW LEVEL SECURITY;

-- 3. Remove the placeholder row inserted from a manual setup script.
DELETE FROM public.merchant_users WHERE auth_user_id = '<YOUR_AUTH_USER_ID_FROM_STEP_1>';
