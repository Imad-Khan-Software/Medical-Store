// ============================================================
// Shared auth/session helpers
// ============================================================

// Returns the logged-in user's profile (id, full_name, role) or null.
async function getSessionProfile() {
  const client = window.supabaseClient || window.supabase;
  if(!client) throw new Error('Supabase client not initialized');
  const { data: { session } } = await client.auth.getSession();
  if (!session) return null;

  const { data: profile, error } = await client.from('profiles').select('id, full_name, role').eq('id', session.user.id).single();
  if (error || !profile) return null;
  return profile;
}

// Redirects unauthenticated users, and enforces page-level role access.
// requiredRole: 'admin' | 'cashier' | null (null = any logged-in user)
// Guards a page by role. requiredRole: 'admin'|'cashier'|null
async function guardPage(requiredRole) {
  const profile = await getSessionProfile();
  if (!profile) {
    window.location.href = 'login.html';
    return null;
  }
  // allow admins to access everything; cashiers cannot access admin routes
  if (requiredRole === 'admin' && profile.role !== 'admin') {
    window.location.href = 'index.html';
    return null;
  }
  // Maintenance mode: non-admins are blocked with a clear message; admins
  // are never locked out of their own dashboard.
  if (profile.role !== 'admin') {
    const blocked = await isMaintenanceModeBlocking();
    if (blocked) {
      renderMaintenanceNotice(blocked);
      return null;
    }
  }
  return profile;
}

// Returns the maintenance message (string) if maintenance mode is on, else null.
async function isMaintenanceModeBlocking() {
  try {
    const client = window.supabaseClient || window.supabase;
    if (!client) return null;
    const { data, error } = await client.from('app_settings').select('system').eq('id', true).single();
    if (error || !data) return null;
    const sys = data.system || {};
    if (sys.maintenance_mode) {
      return sys.maintenance_message || 'RxStock is currently under maintenance. Please check back shortly.';
    }
    return null;
  } catch (e) {
    return null; // fail open: never block access due to a settings read error
  }
}

function renderMaintenanceNotice(message) {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f8fb;font-family:Inter,system-ui,sans-serif;padding:24px;">
      <div style="max-width:420px;text-align:center;background:#fff;border-radius:14px;box-shadow:0 12px 30px rgba(10,20,40,0.08);padding:32px;">
        <div style="font-size:36px;margin-bottom:12px;">🛠️</div>
        <h2 style="margin:0 0 10px;">Under Maintenance</h2>
        <p style="color:#64748b;margin:0 0 18px;">${(window.RxUtils ? RxUtils.escapeHtml(message) : message)}</p>
        <button onclick="window.location.href='login.html'" style="padding:10px 18px;border-radius:10px;border:none;background:#3b82f6;color:#fff;font-weight:700;cursor:pointer;">Back to sign in</button>
      </div>
    </div>`;
}

async function logout() {
  const client = window.supabaseClient || window.supabase;
  await client.auth.signOut();
  window.location.href = 'login.html';
}
