# RxStock — Pharmacy Inventory & POS

Frontend-only app (HTML/CSS/vanilla JS) backed by Supabase. No server to host or maintain.

## Files
- `schema.sql` — run once in Supabase SQL Editor. Creates all tables, the `pos_catalog` view, and RLS policies.
- `supabase-config.js` — put your Project URL and anon public key here.
- `auth.js` — shared session/role guard used by every page.
- `login.html` — sign-in for both admin and cashier accounts.
- `index.html` — POS/billing screen (barcode scan, search by name or formula, cart, checkout, thermal receipt print).
- `admin.html` — Dashboard (low stock + expiry alerts), Inventory (products/batches CRUD), Reports (sales & profit, daily/monthly), Supplier Returns (expired batch list).
- `style.css` — shared design system.

## Setup
1. Create a Supabase project.
2. Open the SQL Editor and run `schema.sql`.
3. Open `supabase-config.js` and paste in your Project URL and anon key (Project Settings → API).
4. Create your first user: Supabase Dashboard → Authentication → Add user (email + password).
5. Back in the SQL Editor, run:
   ```sql
   insert into profiles (id, full_name, role)
   values ('<paste the new user's UUID>', 'Admin Name', 'admin');
   ```
6. Open `login.html` in a browser (or deploy the folder to Netlify/Vercel) and sign in.
7. As admin, add products and batches from the Inventory tab. To add a cashier, repeat step 4–5 with `role = 'cashier'`.

## Notes on the Admin/Cashier split
- Postgres Row Level Security is enforced at the row level. Cost price and profit figures are never requested or rendered by the cashier-facing POS screen (`index.html`) — all profit/report logic lives only in `admin.html`, which is itself gated by `guardPage('admin')`.
- If you need the cost price to be unreachable even via direct API calls from a cashier's browser dev tools (true column-level masking), the next step is a small Supabase Edge Function that proxies the catalog read and strips `cost_price` server-side. Not included here since it adds a moving part beyond a frontend-only stack — happy to add it if that level of lockdown matters for your setup.
- Barcode scanning works with any USB/Bluetooth scanner set to keyboard-emulation (the default for nearly all retail scanners) — no special driver needed, it just types into the scan box and hits Enter.
- Receipt printing uses the browser print dialog styled for an 80mm thermal width. Most thermal printers register as a normal print destination once installed.

## Phase 7 — Settings & Notifications foundation (2026-08-12)
Run `2026_08_12_settings_and_notifications.sql` in the SQL Editor after the other
migrations. It adds:
- `app_settings` — a single-row table holding every configurable section
  (pharmacy profile, currency, date/time, tax, receipt, invoice, inventory/expiry
  alert thresholds, payment methods, notification toggles, maintenance mode).
  Readable by admin + cashier (POS/receipt screens need it); writable only through
  the `update_app_settings(category, value)` RPC, which is admin-only and logs an
  audit entry for every change.
- `notifications` — per-user notification rows with RLS (each user sees their own;
  admins see all), plus `generate_notification`, `mark_notification_read`, and
  `mark_all_notifications_read` RPCs. A partial unique index prevents duplicate
  notifications for the same unresolved condition (e.g. the same low-stock batch).
- A public `pharmacy-assets` storage bucket for the logo (admin-only upload,
  public read), reusing Supabase Storage — no new infrastructure.

New/updated app files: `admin.html` (Settings tab), `settings.js` (Settings page
logic), `auth.js` (maintenance-mode check in `guardPage`), `utils.js`
(`RxUtils.formatCurrency` now reads the `currency` settings instead of a hardcoded
"Rs", with the old hardcoded behavior as a safe fallback if settings haven't
loaded). Changing these settings never rewrites historical sales, invoice numbers,
purchase costs, or timestamps — they only affect how future data is generated or
displayed.

**Not wired up yet** (next Phase 7 groups, deliberately left out of this pass to
keep it reviewable):
- Automatic low-stock/expiry notification generation (the RPCs and table exist;
  a scheduled job or trigger to call them doesn't yet).
- Notification bell/unread-count UI in the top nav.
- Assigning the configured invoice number format inside `execute_checkout`
  (sales still use the raw `id`; `app_settings.invoice` holds the format/prefix
  ready for that).
- CSV import (products/customers/suppliers) with validation preview.
- Data export + export audit logging.
- System Health page.
- Applying `payment_methods`/`receipt`/`tax` settings inside the POS screen itself
  (`index.html`/`pos.js` still use their original hardcoded options).

## Not yet built (flag if you need these)
- Supplier/purchase-order intake screen (currently batches are added manually from Inventory).
- CSV/Excel export of reports.
- Multi-store support.
