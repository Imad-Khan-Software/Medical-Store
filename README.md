# RxStock — Pharmacy Inventory & POS 💊🛒

A high-performance, frontend-only pharmacy management and Point of Sale (POS) web application powered by Supabase. Designed with zero backend maintenance required, combining secure role-based access control with real-time inventory tracking.

🔗 **Live Demo:** https://rxpharmacystore.netlify.app

---

## 📂 Project Architecture

* **`schema.sql`** — Core database configuration script. Creates all relational tables, the `pos_catalog` view, and strict Row Level Security (RLS) policies.
* **`supabase-config.js`** — Client connection wrapper holding the Supabase Project URL and public anon key.
* **`auth.js`** — Centralized session manager and role verification guard (`guardPage`) enforcing security across routes.
* **`login.html`** — Secure authentication portal supporting both administrative and cashier credential validation.
* **`index.html`** — Streamlined POS and billing screen supporting barcode scanning, multi-parameter product lookups, cart management, and thermal receipt printing.
* **`admin.html`** — Comprehensive management control center housing low-stock/expiry alerts, inventory CRUD tools, financial sales reports, supplier return logs, and system settings.
* **`style.css`** — Shared, responsive design system engineered for speed and clarity.

---

## 🚀 Setup & Installation

1. Create a new project on [Supabase](https://supabase.com).
2. Open the **SQL Editor** in your Supabase dashboard and execute the contents of `schema.sql`.
3. Open `supabase-config.js` and paste your project URL and anon public key from your Supabase API settings.
4. Create your initial administrative user under **Authentication** > **Add user** (email and password).
5. Run the following snippet in your SQL Editor to assign administrative privileges:
   ```sql
   insert into profiles (id, full_name, role)
   values ('<paste-new-user-uuid-here>', 'Admin Name', 'admin');
