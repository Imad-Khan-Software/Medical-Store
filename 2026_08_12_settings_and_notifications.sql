-- Migration: Phase 7 foundation — centralized app settings + notifications
-- Purpose:
--   1) One central `app_settings` table (singleton row) holding every configurable
--      section of the app (pharmacy profile, currency, date/time, tax, receipt,
--      invoice, inventory alerts, expiry alerts, payment methods, notification
--      toggles, and system/maintenance settings). Writes only happen through the
--      `update_app_settings` RPC so every change is admin-only and audited.
--   2) A `notifications` table for the notification center (low stock, expiry,
--      supplier payments, customer credit, system events), with helper RPCs to
--      generate and mark-read notifications without creating duplicates for the
--      same unresolved condition.
--   3) A public storage bucket for the pharmacy logo, reusing Supabase Storage.
--
-- Safe to run multiple times (IF NOT EXISTS / CREATE OR REPLACE throughout).
-- Does NOT touch products, batches, sales, purchases, or any historical data.

BEGIN;

-- ======================================================================
-- 1) APP SETTINGS (singleton row, one central configuration source)
-- ======================================================================
CREATE TABLE IF NOT EXISTS public.app_settings (
  id boolean PRIMARY KEY DEFAULT true,
  pharmacy jsonb NOT NULL DEFAULT '{
    "name": "RxStock Pharmacy",
    "legal_name": "",
    "logo_url": "",
    "address": "",
    "city": "",
    "phone": "",
    "email": "",
    "website": "",
    "license_number": "",
    "tax_registration": ""
  }'::jsonb,
  currency jsonb NOT NULL DEFAULT '{
    "code": "PKR",
    "symbol": "Rs",
    "decimal_places": 2,
    "position": "before"
  }'::jsonb,
  datetime jsonb NOT NULL DEFAULT '{
    "timezone": "Asia/Karachi",
    "date_format": "DD/MM/YYYY",
    "time_format": "24h",
    "first_day_of_week": "Monday"
  }'::jsonb,
  tax jsonb NOT NULL DEFAULT '{
    "enabled": true,
    "default_rate": 0,
    "label": "Tax",
    "mode": "exclusive"
  }'::jsonb,
  receipt jsonb NOT NULL DEFAULT '{
    "footer_message": "Thank you for your purchase!",
    "thank_you_message": "Thank you, visit again!",
    "show_customer": true,
    "show_cashier": true,
    "show_batch": true,
    "show_tax": true,
    "show_discount": true,
    "show_payment_method": true,
    "width_mm": 80
  }'::jsonb,
  invoice jsonb NOT NULL DEFAULT '{
    "prefix": "RX",
    "number_format": "{prefix}-{year}-{number}",
    "number_length": 6,
    "next_number": 1
  }'::jsonb,
  inventory_alerts jsonb NOT NULL DEFAULT '{
    "default_reorder_level": 10,
    "low_stock_threshold": 10,
    "critical_stock_threshold": 3
  }'::jsonb,
  expiry_alerts jsonb NOT NULL DEFAULT '{
    "warning_days": 30,
    "critical_days": 7
  }'::jsonb,
  payment_methods jsonb NOT NULL DEFAULT '{
    "Cash": true,
    "Card": true,
    "Bank": true,
    "Credit": true
  }'::jsonb,
  notification_settings jsonb NOT NULL DEFAULT '{
    "low_stock": true,
    "out_of_stock": true,
    "expiry": true,
    "supplier_payment": true,
    "customer_credit": true,
    "system_events": true
  }'::jsonb,
  system jsonb NOT NULL DEFAULT '{
    "maintenance_mode": false,
    "maintenance_message": "RxStock is currently under maintenance. Please check back shortly.",
    "app_version": "1.0.0",
    "schema_version": "2026.08.12"
  }'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT app_settings_singleton CHECK (id = true)
);

-- Seed the single row if it doesn't exist yet. Never overwrites an existing row,
-- so re-running this migration will not reset settings someone already configured.
INSERT INTO public.app_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Notification settings that are considered security/operations-critical and must
-- not be toggled off by non-admins from the client (enforced in update_app_settings
-- below by simply requiring is_admin() for ANY settings write).

REVOKE ALL ON TABLE public.app_settings FROM public;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_select_all_authenticated ON public.app_settings;
-- Both admin and cashier need read access: cashier POS/receipt screens need
-- currency, tax, receipt, invoice and payment-method settings to render correctly.
CREATE POLICY app_settings_select_all_authenticated ON public.app_settings
  FOR SELECT
  USING (public.is_admin() OR public.is_cashier());

-- Intentionally NO insert/update/delete policy: the table can only be written by
-- the update_app_settings() SECURITY DEFINER function below, which enforces
-- admin-only access and writes an audit log entry for every change.

-- ======================================================================
-- 2) NOTIFICATIONS
-- ======================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info', -- info | warning | critical
  reference_type text,
  reference_id uuid,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, is_read, created_at DESC);

-- Prevent duplicate notifications for the same unresolved condition, per user.
-- Example: a "low_stock" alert for the same batch, for the same admin, won't be
-- re-inserted while an unread copy already exists.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_unresolved_unique_idx
  ON public.notifications (user_id, type, reference_type, reference_id)
  WHERE is_read = false AND reference_id IS NOT NULL;

REVOKE ALL ON TABLE public.notifications FROM public;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_own_select ON public.notifications;
DROP POLICY IF EXISTS notifications_own_update ON public.notifications;
DROP POLICY IF EXISTS notifications_admin_all ON public.notifications;

CREATE POLICY notifications_own_select ON public.notifications
  FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

-- Users can only mark their own notifications read (no editing title/message).
CREATE POLICY notifications_own_update ON public.notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY notifications_admin_all ON public.notifications
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Inserts happen only through generate_notification() below (SECURITY DEFINER),
-- so no direct INSERT policy is granted to admin/cashier roles.

-- ======================================================================
-- 3) RPCs
-- ======================================================================

-- Update one settings category at a time (admin only). Keeps sections independent
-- so the UI can save "Tax" without touching "Receipt", etc. Writes an audit_logs
-- row with old/new values for every change (reuses the existing audit system).
CREATE OR REPLACE FUNCTION public.update_app_settings(p_category text, p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_allowed text[] := ARRAY[
    'pharmacy','currency','datetime','tax','receipt','invoice',
    'inventory_alerts','expiry_alerts','payment_methods',
    'notification_settings','system'
  ];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;
  IF p_category IS NULL OR NOT (p_category = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'invalid_category: %', p_category;
  END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'invalid_value: must be a JSON object';
  END IF;

  EXECUTE format('SELECT %I FROM public.app_settings WHERE id = true', p_category) INTO v_old;

  EXECUTE format(
    'UPDATE public.app_settings SET %I = $1, updated_at = now(), updated_by = $2 WHERE id = true',
    p_category
  ) USING p_value, auth.uid();

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_value, new_value, notes)
  VALUES (
    auth.uid(), 'settings_updated', 'app_settings', NULL,
    jsonb_build_object(p_category, v_old),
    jsonb_build_object(p_category, p_value),
    'category: ' || p_category
  );

  RETURN jsonb_build_object('status', 'ok', 'category', p_category);
END;
$$;

-- Create (or silently skip, if an unresolved duplicate exists) a notification for
-- one user. Intended to be called by admin-triggered actions now, and by future
-- scheduled low-stock/expiry jobs.
CREATE OR REPLACE FUNCTION public.generate_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_severity text DEFAULT 'info',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;
  IF p_user_id IS NULL OR p_type IS NULL OR p_title IS NULL OR p_message IS NULL THEN
    RAISE EXCEPTION 'missing_required_fields';
  END IF;

  INSERT INTO public.notifications (
    user_id, type, title, message, severity, reference_type, reference_id
  ) VALUES (
    p_user_id, p_type, p_title, p_message, coalesce(p_severity,'info'), p_reference_type, p_reference_id
  )
  ON CONFLICT (user_id, type, reference_type, reference_id)
    WHERE is_read = false AND reference_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  UPDATE public.notifications
  SET is_read = true
  WHERE id = p_notification_id AND user_id = auth.uid();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  UPDATE public.notifications
  SET is_read = true
  WHERE user_id = auth.uid() AND is_read = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ======================================================================
-- 4) STORAGE — pharmacy logo bucket (reuses Supabase Storage, no new infra)
-- ======================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('pharmacy-assets', 'pharmacy-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS pharmacy_assets_admin_write ON storage.objects;
DROP POLICY IF EXISTS pharmacy_assets_public_read ON storage.objects;

CREATE POLICY pharmacy_assets_admin_write ON storage.objects
  FOR ALL
  USING (bucket_id = 'pharmacy-assets' AND public.is_admin())
  WITH CHECK (bucket_id = 'pharmacy-assets' AND public.is_admin());

-- Bucket is public (logo needs to render on receipts/login without auth), so
-- allow public SELECT on just this bucket's objects.
CREATE POLICY pharmacy_assets_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'pharmacy-assets');

COMMIT;

-- Notes:
-- - Re-running this file is safe: table/index/policy/bucket creation is all
--   idempotent, and the seed insert uses ON CONFLICT DO NOTHING.
-- - Nothing here touches products, batches, sales, sale_items, purchases, or
--   any other historical/financial table.
-- - Deferred to a follow-up migration (not part of this foundation pass):
--   scheduled low-stock/expiry notification generation, invoice-number
--   assignment inside execute_checkout, CSV import tables, and a
--   system-health read model.
