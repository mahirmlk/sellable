-- Per-merchant stores: real merchant + catalog records (applied 2026-09-02).
--
-- merchants / catalog_products are created by the backend's create_all on
-- startup; this migration records the security posture that must hold:
-- the public anon/authenticated roles get NO access to application tables.
-- It also seeds the demo merchant as a real DB row (allowed by policy §11:
-- seed data is fine when it is genuinely stored and served through the
-- normal application flow).

-- Lock down the new tables (Supabase grants ALL to anon/authenticated by default).
REVOKE ALL PRIVILEGES ON TABLE public.merchants        FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.catalog_products FROM anon, authenticated;

ALTER TABLE public.merchants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;

-- Demo merchant as a real record (idempotent).
INSERT INTO public.merchants (merchant_id, name, created_at)
VALUES ('mrc_demo_store', 'SELLABLE Demo Store', now())
ON CONFLICT (merchant_id) DO NOTHING;

-- Remove the auto-linked membership created by the removed auto-provisioning
-- behavior; the real user onboards through the explicit onboarding flow.
DELETE FROM public.merchant_users
WHERE auth_user_id = '4f7a9093-57df-439d-893a-008415c1dc4b';
