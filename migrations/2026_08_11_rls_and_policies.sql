-- Migration: Enable RLS and add policies for products, batches, sales, sale_items
-- Date: 2026-08-11
-- NOTES:
-- 1) This script is intended for Supabase/Postgres. Review and run in the SQL editor.
-- 2) It creates helper functions that read the JWT claim `role` and helper predicates.
-- 3) It ENABLEs and FORCES Row Level Security on the four tables and creates explicit
--    policies for `admin` and `cashier` roles. Public/anonymous access is revoked.

BEGIN;

-- Helper: safe read of JWT role claim (returns NULL when unauthenticated)
CREATE OR REPLACE FUNCTION public._jwt_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  AS $$
    SELECT (
      CASE
        WHEN current_setting('request.jwt.claims', true) IS NULL THEN NULL
        ELSE (current_setting('request.jwt.claims', true)::json ->> 'role')
      END
    );
  $$;

-- Predicates
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public._jwt_role() = 'admin'; $$;
CREATE OR REPLACE FUNCTION public.is_cashier() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public._jwt_role() = 'cashier'; $$;
CREATE OR REPLACE FUNCTION public.is_authenticated() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IS NOT NULL; $$;

-- Utility: revoke default public privileges to ensure no accidental access
REVOKE ALL ON TABLE IF EXISTS public.products FROM public;
REVOKE ALL ON TABLE IF EXISTS public.batches FROM public;
REVOKE ALL ON TABLE IF EXISTS public.sales FROM public;
REVOKE ALL ON TABLE IF EXISTS public.sale_items FROM public;
REVOKE ALL ON TABLE IF EXISTS public.suppliers FROM public;
REVOKE ALL ON TABLE IF EXISTS public.purchases FROM public;
REVOKE ALL ON TABLE IF EXISTS public.purchase_items FROM public;
REVOKE ALL ON TABLE IF EXISTS public.supplier_payments FROM public;
REVOKE ALL ON TABLE IF EXISTS public.stock_movements FROM public;
REVOKE ALL ON TABLE IF EXISTS public.supplier_returns FROM public;
REVOKE ALL ON TABLE IF EXISTS public.expenses FROM public;
REVOKE ALL ON TABLE IF EXISTS public.audit_logs FROM public;

-- ====== PRODUCTS ======
-- Enable and force RLS
ALTER TABLE IF EXISTS public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.products FORCE ROW LEVEL SECURITY;

-- Remove any previous policies to ensure idempotency
DROP POLICY IF EXISTS products_admin_all ON public.products;
DROP POLICY IF EXISTS products_select_cashier ON public.products;

-- Admin: full CRUD
CREATE POLICY products_admin_all ON public.products
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Cashier: SELECT only (no INSERT/UPDATE/DELETE)
CREATE POLICY products_select_cashier ON public.products
  FOR SELECT
  USING (public.is_admin() OR public.is_cashier());

-- ====== BATCHES ======
ALTER TABLE IF EXISTS public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.batches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS batches_admin_all ON public.batches;
DROP POLICY IF EXISTS batches_select_cashier ON public.batches;

CREATE POLICY batches_admin_all ON public.batches
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY batches_select_cashier ON public.batches
  FOR SELECT
  USING (public.is_admin() OR public.is_cashier());

-- ====== SALES ======
ALTER TABLE IF EXISTS public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sales FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_admin_all ON public.sales;
DROP POLICY IF EXISTS sales_insert_cashier ON public.sales;

-- Admin: full CRUD
CREATE POLICY sales_admin_all ON public.sales
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Cashier: allow INSERT of new sales (must be authenticated cashier and cashier_id must match auth.uid())
-- Note: this assumes `sales.cashier_id` is a UUID/text matching auth.uid(). Adjust casting if needed.
CREATE POLICY sales_insert_cashier ON public.sales
  FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_cashier()
      AND auth.uid() IS NOT NULL
      AND auth.uid() = cashier_id::text
    )
  );

-- Optional: allow cashier to SELECT their own sales (uncomment if desired)
-- CREATE POLICY sales_select_cashier_own ON public.sales
--   FOR SELECT
--   USING ( public.is_admin() OR ( public.is_cashier() AND auth.uid() = cashier_id::text ) );

-- ====== SALE_ITEMS ======
ALTER TABLE IF EXISTS public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sale_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_items_admin_all ON public.sale_items;
DROP POLICY IF EXISTS sale_items_insert_cashier ON public.sale_items;

CREATE POLICY sale_items_admin_all ON public.sale_items
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Cashier: allow INSERT of sale_items only when the referenced sale belongs to the same cashier
-- This prevents a cashier from adding items to other cashiers' sales. It requires that the sale already exists
-- and is owned by the inserting cashier. If your client inserts sale + sale_items in the same transaction
-- consider using a DB function (RPC) which performs the whole operation server-side (recommended).
CREATE POLICY sale_items_insert_cashier ON public.sale_items
  FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_cashier()
      AND auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.id = sale_id
          AND s.cashier_id::text = auth.uid()
      )
    )
  );

-- ====== SUPPLIERS ======
ALTER TABLE IF EXISTS public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.suppliers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_admin_all ON public.suppliers;
CREATE POLICY suppliers_admin_all ON public.suppliers
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ====== PURCHASES ======
ALTER TABLE IF EXISTS public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.purchases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchases_admin_all ON public.purchases;
CREATE POLICY purchases_admin_all ON public.purchases
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ====== PURCHASE_ITEMS ======
ALTER TABLE IF EXISTS public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.purchase_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_items_admin_all ON public.purchase_items;
CREATE POLICY purchase_items_admin_all ON public.purchase_items
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ====== EXPENSES ======
ALTER TABLE IF EXISTS public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.expenses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expenses_admin_all ON public.expenses;
CREATE POLICY expenses_admin_all ON public.expenses
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ====== SUPPLIER_PAYMENTS ======
ALTER TABLE IF EXISTS public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.supplier_payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_payments_admin_all ON public.supplier_payments;
CREATE POLICY supplier_payments_admin_all ON public.supplier_payments
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ====== STOCK_MOVEMENTS ======
ALTER TABLE IF EXISTS public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stock_movements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_movements_admin_all ON public.stock_movements;
CREATE POLICY stock_movements_admin_all ON public.stock_movements
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ====== SUPPLIER_RETURNS ======
ALTER TABLE IF EXISTS public.supplier_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.supplier_returns FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_returns_admin_all ON public.supplier_returns;
CREATE POLICY supplier_returns_admin_all ON public.supplier_returns
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ====== AUDIT_LOGS ======
ALTER TABLE IF EXISTS public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_admin_all ON public.audit_logs;
CREATE POLICY audit_logs_admin_all ON public.audit_logs
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ====== Final notes ======
-- Force RLS on ensures table owner cannot bypass policies. Policies above grant the following:
-- - `admin` role: full CRUD on all four tables
-- - `cashier` role: SELECT on `products` and `batches`; INSERT on `sales` and `sale_items` (with checks)
-- - Unauthenticated / public access: no policies grant access, and default privileges revoked.

COMMIT;

-- Deployment instructions:
-- 1. Open Supabase SQL Editor and paste this script. Review helper role extraction logic (`_jwt_role`) if you use a different JWT claim name.
-- 2. Run the migration in a safe environment (staging) first. Validate app flows (product listing, cashier checkout via RPC if used).
-- 3. If your JWTs include role in a different claim path, update `_jwt_role()` accordingly.
-- 4. For complex checkout flows, implement an RPC (e.g. `process_sale`) that performs inserts/updates in a single transaction using `security definer`.
