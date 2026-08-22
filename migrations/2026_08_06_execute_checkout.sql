-- Migration: execute_checkout RPC
-- Purpose: Atomically process a sale (validate auth, lock batches, deduct stock,
-- insert sale and sale_items, compute totals, and return summary JSON).
-- IMPORTANT: Deploy this on the database as a SECURITY DEFINER function owned by
-- a trusted DB role. Test thoroughly in staging.

create or replace function public.execute_checkout(
  p_cashier_id uuid,
  p_items jsonb,
  p_discount numeric default 0,
  p_tax_rate numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id bigint;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_grand numeric := 0;
  v_item jsonb;
  v_batch record;
  v_qty int;
  v_unit_price numeric;
  v_item_sub numeric;
begin
  -- Authentication & role checks
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not (public.is_admin() or public.is_cashier()) then
    raise exception 'forbidden: role not allowed';
  end if;
  -- Cashier may only act as themselves unless admin
  if public.is_cashier() and auth.uid()::uuid <> p_cashier_id then
    raise exception 'forbidden: cashier id mismatch';
  end if;

  -- Validate items is an array
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items: items must be a jsonb array';
  end if;

  -- First pass: lock all referenced batches FOR UPDATE and validate stock
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity for item %', v_item;
    end if;
    select * into v_batch
      from public.batches
      where id = (v_item ->> 'batch_id')::uuid
      for update;
    if not found then
      raise exception 'batch_not_found: %', (v_item->>'batch_id');
    end if;
    if v_batch.quantity < v_qty then
      raise exception 'insufficient_stock: batch % has % available but % requested', v_batch.id, v_batch.quantity, v_qty;
    end if;
    v_unit_price := (v_item ->> 'unit_price')::numeric;
    v_item_sub := v_unit_price * v_qty;
    v_subtotal := coalesce(v_subtotal,0) + v_item_sub;
  end loop;

  -- Apply discount (server-side). Discount is absolute amount.
  v_subtotal := v_subtotal - coalesce(p_discount,0);
  if v_subtotal < 0 then v_subtotal := 0; end if;

  -- Tax calculation (percentage). Round to 2 decimals.
  v_tax := round(coalesce(p_tax_rate,0) * v_subtotal / 100.0, 2);
  v_grand := round(v_subtotal + v_tax, 2);

  -- Insert sale
  insert into public.sales (cashier_id, total_amount)
    values (p_cashier_id, v_grand)
    returning id into v_sale_id;

  -- Second pass: deduct stock and insert sale_items (we still hold FOR UPDATE locks above)
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::int;
    v_unit_price := (v_item ->> 'unit_price')::numeric;

    select * into v_batch
      from public.batches
      where id = (v_item ->> 'batch_id')::uuid
      for update;

    -- safety re-check
    if v_batch.quantity < v_qty then
      raise exception 'insufficient_stock_during_commit: batch %', v_batch.id;
    end if;

    update public.batches set quantity = quantity - v_qty where id = v_batch.id;

    insert into public.sale_items (sale_id, product_id, batch_id, quantity, unit_price, cost_price, subtotal)
    values (
      v_sale_id,
      (v_item ->> 'product_id')::uuid,
      v_batch.id,
      v_qty,
      v_unit_price,
      v_batch.cost_price,
      v_unit_price * v_qty
    );
  end loop;

  -- Return JSON summary
  return jsonb_build_object(
    'sale_id', v_sale_id,
    'subtotal', round(v_subtotal::numeric,2),
    'tax', round(v_tax::numeric,2),
    'grand_total', round(v_grand::numeric,2),
    'status', 'ok'
  );

exception when others then
  -- Bubble up error with message (transaction will be rolled back)
  raise;
end;
$$;

-- Notes:
-- - Mark this function OWNER as a role that has insert/update privileges on tables. Keep function as
--   SECURITY DEFINER and ensure function owner is trusted.
-- - This function locks batches rows FOR UPDATE to prevent race conditions.
-- - For complex stock allocation (multiple batches per product), adapt logic to select/break across batches.
-- - Call from client: `supabase.rpc('execute_checkout', { p_cashier_id: 'uuid', p_items: JSON.stringify(items), p_discount: 0, p_tax_rate: 12 })`
