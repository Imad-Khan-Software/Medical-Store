-- Migration: Expenses table and finance reporting support
-- Purpose: Add expense tracking for cash, utilities, payroll, and other business expenses.

BEGIN;

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  expense_date date NOT NULL DEFAULT current_date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expenses_date_idx ON public.expenses(expense_date);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON public.expenses(lower(category));

ALTER TABLE IF EXISTS public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.expenses FORCE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS expenses_admin_all ON public.expenses
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMIT;
