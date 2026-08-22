# RxStock — Frontend Production-Readiness Audit Report

Scope: frontend only (HTML/CSS/JS). No SQL/RPC/RLS definitions were changed.
Role-based login (admin + cashier) had already been manually tested by the
project owner and confirmed working before this audit — this report does not
re-verify backend authorization, only frontend behavior.

---

## SECTION 1 — AUDIT SUMMARY

**Critical:** 0 found (frontend-only; the previously-flagged JWT/RLS concern is
a backend item and was confirmed working by the developer's own admin/cashier
login testing, so it's not re-listed here).

**High:** 3 found, 3 fixed
1. `admin.js` (and `reports.js`, `purchasing.js`, `inventory-intelligence.js`)
   were loaded on `index.html` (the POS page) where they don't belong —
   `admin.js` throws an uncaught error there for admin users.
2. `reports.js`, `purchasing.js`, `inventory-intelligence.js` are fully
   orphaned modules — none of their target element IDs exist in `admin.html`,
   and their `.init()` functions are never called anywhere.
3. `UI.setBtnLoading()` never actually disabled the button — every save/
   checkout/login button in the app was vulnerable to duplicate-click
   double-submission.

**Medium:** 3 found, 3 fixed
4. `settings.js` called `UI.showNotification` which doesn't exist on `UI` —
   silent no-op on health-check failure.
5. Notification scanner RPCs (`scan_low_stock_notifications`,
   `scan_expiry_notifications`) fired on every page load and always failed
   (backend not implemented yet, per README).
6. **Found during the above fix:** `fetchNotifications()` was only ever
   called as a side-effect inside the admin-only scanner success branch —
   meaning **cashiers never saw their notification bell populate at all**,
   and admins would have lost it too once the scanner call was disabled.

**Low:** 1 found, 1 fixed
7. `reports.js` CSV export didn't neutralize leading `=`, `+`, `-`, `@`
   (spreadsheet formula-injection risk if opened in Excel/Sheets).

**Reviewed, no change needed:**
- POS image fallback (`via.placeholder.com`) — acceptable as-is; changing it
  would mean introducing a new asset file for a low-risk fallback path.
- Login UX — Supabase already returns a clear "Invalid login credentials"
  message that's shown via `UI.showToast`; no raw DB/schema details are ever
  exposed. Double-submission is now covered by the `UI.setBtnLoading` fix
  (#3), since login already uses it.
- `admin.js`'s `runNotificationScanners()` — defined but never called from
  anywhere; genuinely dead code, but harmless sitting unused. Left in place
  per "don't remove working features" — flagged for your awareness only.

---

## SECTION 2 — EVENT-WIRING AUDIT

| Page | Element | Expected Action | Handler | Status | Fix |
|---|---|---|---|---|---|
| admin.html | `#inventory-table` | Render product/batch list | `loadInventory()` | Was broken (wrong container ID + stub row markup) | **Fixed in prior session** |
| admin.html | `#b-product` | Populate product dropdown | `loadInventory()` | Was never populated | **Fixed in prior session** |
| index.html | `#nav-admin` | Navigate to admin.html | (visibility toggle only, no click handler) | Was broken | **Fixed in prior session** |
| index.html | `<script src="admin.js">` | N/A — shouldn't run here | `init()` fires anyway for admins | Threw uncaught error on `#product-form` (doesn't exist on this page) | **Fixed — script removed from index.html** |
| index.html | `<script src="reports.js">` | N/A — orphaned module | `RxReportsPage.init()` never called | Dead weight, loaded for nothing | **Fixed — script removed from index.html** |
| index.html | `<script src="purchasing.js">` | N/A — orphaned module | `RxPurchasing.init()` never called | Dead weight, loaded for nothing | **Fixed — script removed from index.html** |
| index.html | `<script src="inventory-intelligence.js">` | N/A — orphaned module | `RxInventoryIntelligence.init()` never called | Dead weight, loaded for nothing | **Fixed — script removed from index.html** |
| admin.html / index.html | Every button using `UI.setBtnLoading` (login, checkout, save-*, add-*, apply-adjustment, etc.) | Prevent double submission while processing | `UI.setBtnLoading(btn, true)` | Spinner shown but button not actually disabled | **Fixed — `btn.disabled` now toggled** |
| admin.html | `#run-health-check-btn` | Run system health check | `SystemHealth.runCheck()` | Working, but silently swallowed its own failure message | **Fixed — `UI.showNotification` → `UI.showToast`** |
| admin.html / index.html | Notification bell (`#notification-bell-btn`) | Show current notifications | `fetchNotifications()` | Only ran for admins as a side-effect of a scanner call that always failed; never ran for cashiers at all | **Fixed — now loads directly for every logged-in user** |
| admin.html | All 9 tab nav buttons (`data-tab`) | Switch visible section | `admin.js` tab-click listener | Works correctly | No change |
| admin.html | Product/Batch forms, Supplier form, Purchase form, Expense form, Adjustment button, Returns "Mark Returned" buttons, Settings save buttons (all 8 categories), Logo upload/remove | Various CRUD actions | Each wired individually in `admin.js`/`settings.js` | All traced HTML→listener→Supabase call→UI update; all intact | No change |
| index.html | Search input, Add-to-cart, qty +/-, remove, checkout, hold/clear, dark mode, sign out | POS core flow | `pos.js` | All traced end-to-end; intact | No change |

---

## SECTION 3 — PURCHASING AUDIT

- **Canonical implementation:** `admin.js` (`savePurchase()` → RPC
  `execute_purchase`; returns/adjustments → RPC `execute_supplier_return` /
  `execute_stock_adjustment`). This is the only implementation actually wired
  to visible UI elements in `admin.html` (`#purchase-form`,
  `#purchase-items`, `#history-*`, `#returns-table`, `#adjust-*`).
- **Dead implementation:** `purchasing.js` (`RxPurchasing.createPurchaseOrder`,
  `receivePurchaseOrder`, `processReturn`, `fetchPurchasingMetrics`). Confirmed
  via grep that none of its target element IDs (`pur-metric-*`) exist in
  `admin.html`, and its RPCs (`receive_purchase`, `process_supplier_return`,
  `get_purchasing_summary_metrics`) are never referenced by the working
  `admin.js` flow. It also uses field names (`reference_number`, `unit_cost`,
  `subtotal`) that don't match the real `purchases`/`purchase_items` schema
  used by `execute_purchase`.
- **What was changed:** `purchasing.js` was **not deleted or rewritten** — per
  your instruction not to blindly delete it, and since it's not currently
  wired to any button, deleting/rewriting it carries schema-guessing risk
  without being able to test against your live Supabase project. Instead, its
  `<script>` tag was removed from `index.html` (the only page that was loading
  it), which stops it from running at all. It remains on disk, untouched, in
  case you want to either repurpose it later or confirm with your backend
  which RPCs actually exist before deciding to delete it outright.
- **Why this is the safer call:** it fully resolves the "two competing
  purchasing flows" risk (only one now executes, anywhere), without touching
  a single line of working purchase/return/adjustment logic in `admin.js`.

Same reasoning and same fix applied to `reports.js` and
`inventory-intelligence.js` — both untouched on disk except for the CSV
formula-injection patch in `reports.js`, both no longer loaded anywhere.

---

## SECTION 4 — FILES CHANGED

| File | What changed |
|---|---|
| `index.html` | Removed `<script>` tags for `admin.js`, `reports.js`, `purchasing.js`, `inventory-intelligence.js`. Kept `supabase-config.js`, `utils.js`, `ui.js`, `auth.js`, `pos.js`, `notifications.js`. |
| `ui.js` | `UI.setBtnLoading()` now sets `btn.disabled = true/false` alongside the existing spinner/text swap. |
| `settings.js` | `SystemHealth.runCheck()`'s catch block now calls `UI.showToast(...)` instead of the nonexistent `UI.showNotification(...)`. |
| `notifications.js` | Added `SCANNERS_ENABLED = false` flag with a comment explaining why; `triggerScannersIfAdmin()` now exits immediately when disabled. Separately, `init()` now calls `fetchNotifications()` directly (previously it only loaded as a side-effect of the admin scanner call, so cashiers never saw notifications at all). |
| `reports.js` | `Analytics.exportToCSV()` now neutralizes cell values starting with `=`, `+`, `-`, `@` by prefixing a leading `'`, preventing spreadsheet formula injection. (Module itself is currently unloaded anywhere — see Section 3 — but fixed in place per your explicit request.) |
| `admin.js` *(from prior session, included for completeness)* | `loadInventory()` now targets the real `#inventory-table` container and renders actual rows instead of a stub; also populates the previously-empty `#b-product` dropdown. |
| `pos.js` *(from prior session, included for completeness)* | `#nav-admin` button now has a click handler that navigates to `admin.html`. |

---

## SECTION 5 — FILES NOT CHANGED

- `admin.html`, `index.html` (structure/markup) — inspected fully, all
  interactive elements have matching IDs and working handlers; no HTML
  changes needed.
- `login.html`, `login.js` — reviewed against Task 7; already shows Supabase's
  own error messages via `UI.showToast` without leaking internals, already
  uses `UI.setBtnLoading` (which is now fixed at the source), password-toggle
  preserved. No change needed.
- `auth.js` — role guard and maintenance-mode check both function as
  documented; fail-open behavior on settings-read error is intentional and
  already commented in the file.
- `supabase-config.js` — anon key exposure is expected/by-design for this
  architecture; no change.
- `style.css` — not in scope for this audit (no CSS bugs were identified or
  reported).
- `purchasing.js`, `inventory-intelligence.js` — left on disk untouched (see
  Section 3). No longer loaded by any page.
- `utils.js` — reviewed; `RxUtils.withSubmitLock` already correctly disables
  its button, `escapeHtml`/`formatCurrency`/settings cache all function as
  expected. No change.

---

## SECTION 6 — REMAINING RISKS (require backend/SQL work, not fixable frontend-only)

- **`execute_purchase` SQL bug** (`v_batch_id` used without being declared) —
  flagged in an earlier review; this is a SQL/migration fix, out of scope
  here since you're managing SQL separately.
- **Notification scanners** — `scan_low_stock_notifications` and
  `scan_expiry_notifications` still don't exist server-side. The frontend
  call is now disabled (see Section 4), but low-stock/expiry notifications
  will not appear until those RPCs are implemented and `SCANNERS_ENABLED` is
  flipped back to `true` in `notifications.js`.
- **`purchasing.js`'s RPCs** (`receive_purchase`, `process_supplier_return`,
  `get_purchasing_summary_metrics`) — unknown whether these exist in your
  database. Irrelevant right now since the file isn't loaded, but relevant if
  you ever decide to revive it.
- I did **not** independently re-verify RLS/JWT role-claim behavior — you
  reported testing admin + cashier login yourself and it working, so I've
  treated that as confirmed rather than re-auditing it blind.

---

## SECTION 7 — MANUAL TEST CHECKLIST

**As Admin:**
- [ ] Log in → lands on `index.html`, "Admin dashboard" button visible
- [ ] Click "Admin dashboard" → navigates to `admin.html`
- [ ] Dashboard tab loads stats without console errors
- [ ] Inventory tab shows a real product table (not `...`); Add Product and Add Batch both work; `#b-product` dropdown is populated
- [ ] Suppliers tab: add/edit/search/filter a supplier
- [ ] Purchases tab: create a purchase with 1–2 line items, confirm it saves
- [ ] Purchase History tab: filters (supplier/status/date range) return results
- [ ] Reports tab: date range refresh updates numbers and tables
- [ ] Finance tab: add an expense, confirm totals update
- [ ] Returns tab: mark an expired batch returned; apply a stock adjustment
- [ ] Settings: save each of the 7 category panels individually; upload/remove a logo
- [ ] Settings → System Health: run health check, confirm status text renders (not silently blank on failure)
- [ ] Notification bell: opens/closes, shows existing notifications, "mark all read" works
- [ ] Sign out → returns to `login.html`
- [ ] Open browser dev tools console while navigating `index.html` as admin — confirm no more `TypeError` on page load

**As Cashier:**
- [ ] Log in → lands on `index.html`, "Admin dashboard" button is hidden
- [ ] Typing `admin.html` directly in the URL bar redirects back to `index.html`
- [ ] Notification bell now shows notifications on page load (previously showed nothing for cashiers)
- [ ] Search/scan a product, add to cart, adjust quantity, complete checkout, receipt prints
- [ ] Try double-clicking "Complete Sale" quickly — confirm it only submits once (button should visibly disable during processing)
- [ ] Sign out works

**General:**
- [ ] Try double-clicking any Save/Add/Login button rapidly — should now be genuinely blocked, not just visually spinning
- [ ] Export a sales report CSV (if you re-enable `reports.js` later) and open in Excel — confirm no formula executes even if a product name starts with `=`, `+`, `-`, or `@`
