-- Recommended server-side SQL: atomic sale processing
-- Create an RPC function `process_sale(payload json)` that
-- inserts into `sales`, inserts related `sale_items` with server-side
-- retrieval of `cost_price`, and updates `batches.quantity` atomically.

create or replace function public.process_sale(payload json)
returns table(id bigint, total_amount numeric, created_at timestamptz) as $$
declare
  sale_row record;
  item json;
  items json := payload->'items';
  cashier uuid := (payload->>'cashier_id')::uuid;
  total_amt numeric := (payload->>'total')::numeric;
begin
  perform pg_advisory_xact_lock(1); -- avoid concurrent race on stock
  insert into public.sales (cashier_id, total_amount)
    values (cashier, total_amt)
    returning id, total_amount, created_at into sale_row;

  for item in select * from json_array_elements(items) loop
    insert into public.sale_items(sale_id, product_id, batch_id, quantity, unit_price, cost_price, subtotal)
    select sale_row.id,
      (item->>'product_id')::uuid,
      (item->>'batch_id')::uuid,
      (item->>'quantity')::int,
      (item->>'unit_price')::numeric,
      b.cost_price,
      ((item->>'unit_price')::numeric * (item->>'quantity')::int)
    from public.batches b
    where b.id = (item->>'batch_id')::uuid;

    update public.batches set quantity = greatest(batches.quantity - (item->>'quantity')::int, 0)
    where id = (item->>'batch_id')::uuid;
  end loop;

  return query select sale_row.id, sale_row.total_amount, sale_row.created_at;
end;
$$ language plpgsql security definer;

-- Notes:
-- - Deploy this function using a secure role/extension on the DB. Mark as
--   `security definer` so it runs with the function owner privileges and
--   avoids exposing cost_price to anon users.
-- - On Supabase, create this function in SQL editor and then call via
--   `supabase.rpc('process_sale', { payload: JSON.stringify({ items, total, cashier_id }) })`.
-- - Ensure RLS policies allow the function to perform inserts/updates.
