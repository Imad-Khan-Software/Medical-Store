-- Migration: Supplier and Purchase Foundation for RxStock Phase 2
-- This migration adds supplier management, purchase workflow, stock movement,
-- audit logging, supplier payments, and supplier returns support.

BEGIN;

-- Suppliers
CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company_name text,
  phone text,
  email text,
  address text,
  tax_id text,
  payment_terms text,
  opening_balance numeric NOT NULL DEFAULT 0,
  current_balance numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppliers_name_idx ON public.suppliers(lower(name));
CREATE INDEX IF NOT EXISTS suppliers_company_idx ON public.suppliers(lower(company_name));

-- Purchase invoices
CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  invoice_number text NOT NULL,
  purchase_date date NOT NULL DEFAULT current_date,
  due_date date,
  payment_status text NOT NULL DEFAULT 'UNPAID',
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  amount_paid numeric NOT NULL DEFAULT 0,
  balance_due numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS purchases_supplier_idx ON public.purchases(supplier_id);
CREATE INDEX IF NOT EXISTS purchases_invoice_idx ON public.purchases(invoice_number);

-- Purchase items
CREATE TABLE IF NOT EXISTS public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  batch_number text NOT NULL,
  manufacturing_date date,
  expiry_date date,
  quantity int NOT NULL CHECK (quantity >= 0),
  free_quantity int NOT NULL DEFAULT 0 CHECK (free_quantity >= 0),
  purchase_price numeric NOT NULL CHECK (purchase_price >= 0),
  selling_price numeric NOT NULL CHECK (selling_price >= 0),
  discount numeric NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax numeric NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_items_purchase_idx ON public.purchase_items(purchase_id);

-- Supplier payments
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  purchase_id uuid REFERENCES public.purchases(id),
  payment_date date NOT NULL DEFAULT current_date,
  amount numeric NOT NULL CHECK (amount >= 0),
  method text NOT NULL DEFAULT 'Cash',
  reference text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_payments_supplier_idx ON public.supplier_payments(supplier_id);

-- Stock movements
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id),
  batch_id uuid REFERENCES public.batches(id),
  quantity int NOT NULL,
  previous_quantity int,
  new_quantity int,
  movement_type text NOT NULL,
  reference_type text,
  reference_id uuid,
  reason text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS stock_movements_batch_idx ON public.stock_movements(batch_id);

-- Audit logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON public.audit_logs(entity, entity_id);

-- Supplier returns (extended)
CREATE TABLE IF NOT EXISTS public.supplier_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.suppliers(id),
  purchase_id uuid REFERENCES public.purchases(id),
  product_id uuid REFERENCES public.products(id),
  batch_id uuid REFERENCES public.batches(id),
  quantity int NOT NULL CHECK (quantity >= 0),
  reason text NOT NULL,
  return_date date NOT NULL DEFAULT current_date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
CREATE INDEX IF NOT EXISTS supplier_returns_supplier_idx ON public.supplier_returns(supplier_id);

-- Extend existing batches for purchase metadata
ALTER TABLE IF EXISTS public.batches ADD COLUMN IF NOT EXISTS supplier_id uuid;
ALTER TABLE IF EXISTS public.batches ADD COLUMN IF NOT EXISTS manufacturing_date date;
ALTER TABLE IF EXISTS public.batches ADD COLUMN IF NOT EXISTS purchase_price numeric DEFAULT 0;
ALTER TABLE IF EXISTS public.batches ADD COLUMN IF NOT EXISTS free_quantity int DEFAULT 0;
ALTER TABLE IF EXISTS public.batches ADD COLUMN IF NOT EXISTS batch_discount numeric DEFAULT 0;
ALTER TABLE IF EXISTS public.batches ADD COLUMN IF NOT EXISTS batch_tax numeric DEFAULT 0;
ALTER TABLE IF EXISTS public.batches ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Purchase execution RPC
CREATE OR REPLACE FUNCTION public.execute_purchase(
  p_supplier_id uuid,
  p_invoice_number text,
  p_purchase_date date,
  p_due_date date,
  p_amount_paid numeric DEFAULT 0,
  p_items jsonb,
  p_notes text DEFAULT '',
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_batch_number text;
  v_qty int;
  v_free_qty int;
  v_purchase_price numeric;
  v_selling_price numeric;
  v_discount numeric;
  v_tax numeric;
  v_total numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_total_discount numeric := 0;
  v_total_tax numeric := 0;
  v_grand_total numeric := 0;
  v_balance numeric := 0;
  v_status text;
  v_existing_batch record;
  v_prev_qty int;
  v_new_qty int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_required';
  END IF;
  IF p_invoice_number IS NULL OR trim(p_invoice_number) = '' THEN
    RAISE EXCEPTION 'invoice_required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items: items must be a jsonb array';
  END IF;
  IF EXISTS (SELECT 1 FROM public.purchases WHERE supplier_id = p_supplier_id AND invoice_number = trim(p_invoice_number)) THEN
    RAISE EXCEPTION 'duplicate_invoice_number for supplier';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_batch_number := trim(coalesce(v_item->>'batch_number',''));
    v_qty := coalesce((v_item->>'quantity')::int,0);
    v_free_qty := coalesce((v_item->>'free_quantity')::int,0);
    v_purchase_price := coalesce((v_item->>'purchase_price')::numeric,0);
    v_selling_price := coalesce((v_item->>'selling_price')::numeric,0);
    v_discount := coalesce((v_item->>'discount')::numeric,0);
    v_tax := coalesce((v_item->>'tax')::numeric,0);

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'invalid_quantity for item %', v_item;
    END IF;
    IF v_purchase_price < 0 OR v_selling_price < 0 THEN
      RAISE EXCEPTION 'invalid_price for item %', v_item;
    END IF;
    IF v_batch_number = '' THEN
      RAISE EXCEPTION 'batch_number_required for product %', v_product_id;
    END IF;

    v_line_total := round((v_purchase_price * v_qty) - v_discount + v_tax, 2);
    v_subtotal := coalesce(v_subtotal,0) + (v_purchase_price * v_qty);
    v_total_discount := coalesce(v_total_discount,0) + v_discount;
    v_total_tax := coalesce(v_total_tax,0) + v_tax;
    v_grand_total := coalesce(v_grand_total,0) + v_line_total;
  END LOOP;

  v_balance := greatest(0, round(coalesce(v_grand_total,0) - coalesce(p_amount_paid,0),2));
  IF p_amount_paid >= v_grand_total THEN
    v_status := 'PAID';
  ELSIF p_amount_paid > 0 THEN
    v_status := 'PARTIAL';
  ELSE
    v_status := 'UNPAID';
  END IF;

  INSERT INTO public.purchases (
    supplier_id, invoice_number, purchase_date, due_date,
    payment_status, subtotal, discount, tax, total_amount,
    amount_paid, balance_due, notes, created_by
  ) VALUES (
    p_supplier_id, trim(p_invoice_number), coalesce(p_purchase_date, current_date), p_due_date,
    v_status, round(v_subtotal,2), round(v_total_discount,2), round(v_total_tax,2), round(v_grand_total,2),
    round(coalesce(p_amount_paid,0),2), v_balance, p_notes, p_created_by
  ) RETURNING id INTO v_purchase_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_batch_number := trim(coalesce(v_item->>'batch_number',''));
    v_qty := coalesce((v_item->>'quantity')::int,0);
    v_free_qty := coalesce((v_item->>'free_quantity')::int,0);
    v_purchase_price := coalesce((v_item->>'purchase_price')::numeric,0);
    v_selling_price := coalesce((v_item->>'selling_price')::numeric,0);
    v_discount := coalesce((v_item->>'discount')::numeric,0);
    v_tax := coalesce((v_item->>'tax')::numeric,0);

    SELECT * INTO v_existing_batch FROM public.batches
     WHERE product_id = v_product_id AND batch_number = v_batch_number
     LIMIT 1;

    IF FOUND THEN
      v_prev_qty := coalesce(v_existing_batch.quantity, 0);
      v_new_qty := v_prev_qty + v_qty + v_free_qty;
      UPDATE public.batches
      SET
        quantity = v_new_qty,
        supplier_id = p_supplier_id,
        purchase_price = v_purchase_price,
        selling_price = v_selling_price,
        manufacturing_date = (v_item->>'manufacturing_date')::date,
        expiry_date = (v_item->>'expiry_date')::date,
        free_quantity = coalesce(v_existing_batch.free_quantity, 0) + v_free_qty,
        batch_discount = v_discount,
        batch_tax = v_tax,
        updated_at = now()
      WHERE id = v_existing_batch.id;
      v_batch_id := v_existing_batch.id;
    ELSE
      INSERT INTO public.batches (
        product_id, batch_number, quantity, expiry_date,
        cost_price, selling_price, supplier_id, manufacturing_date,
        purchase_price, free_quantity, batch_discount, batch_tax, updated_at
      ) VALUES (
        v_product_id, v_batch_number, v_qty + v_free_qty, (v_item->>'expiry_date')::date,
        v_purchase_price, v_selling_price, p_supplier_id, (v_item->>'manufacturing_date')::date,
        v_purchase_price, v_free_qty, v_discount, v_tax, now()
      ) RETURNING id INTO v_batch_id;
      v_prev_qty := 0;
      v_new_qty := v_qty + v_free_qty;
    END IF;

    INSERT INTO public.purchase_items (
      purchase_id, product_id, batch_number, manufacturing_date,
      expiry_date, quantity, free_quantity, purchase_price,
      selling_price, discount, tax, total
    ) VALUES (
      v_purchase_id, v_product_id, v_batch_number,
      (v_item->>'manufacturing_date')::date,
      (v_item->>'expiry_date')::date,
      v_qty, v_free_qty, v_purchase_price,
      v_selling_price, v_discount, v_tax, round((v_purchase_price * v_qty) - v_discount + v_tax, 2)
    );

    INSERT INTO public.stock_movements (
      product_id, batch_id, quantity, previous_quantity,
      new_quantity, movement_type, reference_type, reference_id,
      reason, user_id
    ) VALUES (
      v_product_id, v_batch_id, v_qty + v_free_qty,
      v_prev_qty, v_new_qty, 'purchase', 'purchase', v_purchase_id,
      'Stock received from purchase', auth.uid()
    );
  END LOOP;

  IF v_balance > 0 THEN
    UPDATE public.suppliers
    SET current_balance = current_balance + v_balance,
        updated_at = now()
    WHERE id = p_supplier_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, new_value)
  VALUES (auth.uid(), 'purchase_created', 'purchase', v_purchase_id,
    jsonb_build_object('supplier_id', p_supplier_id, 'invoice_number', trim(p_invoice_number), 'total_amount', round(v_grand_total,2)));

  RETURN jsonb_build_object(
    'purchase_id', v_purchase_id,
    'status', v_status,
    'balance_due', v_balance,
    'total_amount', round(v_grand_total,2)
  );
END;
$$;

COMMIT;
