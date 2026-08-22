// Phase 7 — Notifications Controller
(function(){
  const supabase = window.supabaseClient || window.supabase;
  const UI = window.UI;
  const RxUtils = window.RxUtils;

  let currentNotifications = [];

  async function fetchNotifications(){
    const { data: { user } } = await supabase.auth.getUser();
    if(!user) return;

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if(error){ console.error('Error fetching notifications:', error); return; }
    currentNotifications = data || [];
    renderNotificationUI();
  }

  function renderNotificationUI(){
    const countEl = document.getElementById('notification-count');
    const listEl = document.getElementById('notification-list');
    
    const unreadCount = currentNotifications.filter(n => !n.is_read).length;

    if(countEl){
      countEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
      countEl.style.display = unreadCount > 0 ? 'flex' : 'none';
    }

    if(!listEl) return;
    listEl.innerHTML = '';

    if(currentNotifications.length === 0){
      listEl.innerHTML = '<div class="empty-state" style="padding:20px; text-align:center;">No notifications</div>';
      return;
    }

    currentNotifications.forEach(n => {
      const item = document.createElement('div');
      item.className = `notification-item ${n.is_read ? 'read' : 'unread'} ${n.severity || 'info'}`;
      
      // XSS Protection: Escaping all user-controlled database text
      const safeTitle = RxUtils.escapeHtml(n.title);
      const safeMessage = RxUtils.escapeHtml(n.message);
      const safeTime = new Date(n.created_at).toLocaleString();

      item.innerHTML = `
        <div class="notification-title">${safeTitle}</div>
        <div class="notification-message">${safeMessage}</div>
        <div class="notification-meta">${safeTime}</div>
      `;

      item.addEventListener('click', async () => {
        if(!n.is_read){
          await supabase.rpc('mark_notification_read', { p_notification_id: n.id });
          fetchNotifications();
        }
        if(n.reference_type === 'product' && window.location.pathname.includes('admin.html')){
          if(window.switchTab) window.switchTab('inventory');
        }
      });

      listEl.appendChild(item);
    });
  }

  // The low-stock/expiry scanner RPCs (scan_low_stock_notifications,
  // scan_expiry_notifications) are not implemented on the backend yet
  // (see README — "Not wired up yet"). Calling them here would just fail
  // silently on every admin page load / notification-panel open, so the
  // call is disabled for now. Flip SCANNERS_ENABLED to true once those
  // RPCs exist server-side — no other change needed.
  const SCANNERS_ENABLED = false;

  async function triggerScannersIfAdmin(){
    if(!SCANNERS_ENABLED) return;

    const { data: { user } } = await supabase.auth.getUser();
    if(!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if(profile && profile.role === 'admin'){
      await Promise.allSettled([
        supabase.rpc('scan_low_stock_notifications'),
        supabase.rpc('scan_expiry_notifications')
      ]);
      fetchNotifications();
    }
  }

  function init(){
    const bellBtn = document.getElementById('notification-bell-btn');
    const panel = document.getElementById('notification-panel');
    const markAllBtn = document.getElementById('mark-all-read-btn');

    if(bellBtn && panel){
      bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
      });

      document.addEventListener('click', (e) => {
        if(!panel.contains(e.target) && e.target !== bellBtn){
          panel.style.display = 'none';
        }
      });
    }

    if(markAllBtn){
      markAllBtn.addEventListener('click', async () => {
        await supabase.rpc('mark_all_notifications_read');
        fetchNotifications();
      });
    }

    // Load the current user's notifications on every page load, independent
    // of the admin-only scanner call above (previously this only happened
    // as a side-effect inside the scanner's admin branch, so cashiers never
    // saw their bell populate at all).
    fetchNotifications();
    triggerScannersIfAdmin();
  }

  document.addEventListener('DOMContentLoaded', init);
  window.RxNotifications = { refresh: fetchNotifications };
})();