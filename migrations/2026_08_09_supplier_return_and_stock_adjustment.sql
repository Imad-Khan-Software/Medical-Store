-- Migration: Supplier returns and stock adjustment RPCs
-- Purpose: Add atomic server-side procedures for expired supplier returns, damaged stock, and inventory corrections.

BEGIN;

CREATE OR REPLACE FUNCTION public.execute_supplier_return(
  p_supplier_id uuid DEFAULT NULL,
  p_purchase_id uuid DEFAULT NULL,
  p_product_id uuid,
  p_batch_id uuid,
  p_quantity int,
  p_reason text,
  p_created_by uuid,
  p_return_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch record;
  v_return_id uuid;
  v_new_qty int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'batch_required';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_required';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  SELECT * INTO v_batch
  FROM public.batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch_not_found';
  END IF;

  IF v_batch.quantity < p_quantity THEN
    RAISE EXCEPTION 'insufficient_stock: batch % has % available but % requested', v_batch.id, v_batch.quantity, p_quantity;
  END IF;

  v_new_qty := v_batch.quantity - p_quantity;

  UPDATE public.batches
  SET quantity = v_new_qty
  WHERE id = v_batch.id;

  INSERT INTO public.supplier_returns (
    supplier_id, purchase_id, product_id, batch_id,
    quantity, reason, return_date, created_by
  ) VALUES (
    p_supplier_id, p_purchase_id, p_product_id, p_batch_id,
    p_quantity, p_reason, p_return_date, p_created_by
  ) RETURNING id INTO v_return_id;

  INSERT INTO public.stock_movements (
    product_id, batch_id, quantity, previous_quantity,
    new_quantity, movement_type, reference_type, reference_id,
    reason, user_id
  ) VALUES (
    p_product_id, p_batch_id, -p_quantity, v_batch.quantity,
    v_new_qty, 'supplier_return', 'supplier_return', v_return_id,
    coalesce(p_reason, 'Supplier return processed'), auth.uid()
  );

  INSERT INTO public.audit_logs (
    user_id, action, entity, entity_id, old_value, new_value, notes
  ) VALUES (
    auth.uid(), 'supplier_return_created', 'batches', p_batch_id,
    jsonb_build_object('quantity', v_batch.quantity),
    jsonb_build_object('quantity', v_new_qty, 'returned', p_quantity, 'reason', p_reason),
    'Supplier return processed'
  );

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'batch_id', p_batch_id,
    'product_id', p_product_id,
    'returned_quantity', p_quantity,
    'remaining_quantity', v_new_qty,
    'status', 'ok'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_stock_adjustment(
  p_batch_id uuid,
  p_quantity int,
  p_adjustment_type text DEFAULT 'inventory_correction',
  p_reason text DEFAULT 'Inventory adjustment',
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch record;
  v_new_qty int;
  v_movement_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'batch_required';
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  SELECT * INTO v_batch
  FROM public.batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch_not_found';
  END IF;

  v_new_qty := v_batch.quantity + p_quantity;
  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'insufficient_stock: batch % cannot go below zero', v_batch.id;
  END IF;

  UPDATE public.batches
  SET quantity = v_new_qty
  WHERE id = v_batch.id;

  INSERT INTO public.stock_movements (
    product_id, batch_id, quantity, previous_quantity,
    new_quantity, movement_type, reference_type, reference_id,
    reason, user_id
  ) VALUES (
    v_batch.product_id, p_batch_id, p_quantity, v_batch.quantity,
    v_new_qty, p_adjustment_type, 'stock_adjustment', NULL,
    p_reason, auth.uid()
  ) RETURNING id INTO v_movement_id;

  INSERT INTO public.audit_logs (
    user_id, action, entity, entity_id, old_value, new_value, notes
  ) VALUES (
    auth.uid(), 'stock_adjustment', 'batches', p_batch_id,
    jsonb_build_object('quantity', v_batch.quantity),
    jsonb_build_object('quantity', v_new_qty, 'adjustment', p_quantity, 'type', p_adjustment_type, 'reason', p_reason),
    'Stock adjustment processed'
  );

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'adjusted_quantity', p_quantity,
    'new_quantity', v_new_qty,
    'movement_id', v_movement_id,
    'status', 'ok'
  );
END;
$$;

COMMIT;
