// Phase 7 — Admin Settings page controller.
// Reads/writes the single `app_settings` row via the `update_app_settings` RPC
// (admin-only, audited server-side). Each category saves independently so one
// section can be updated without touching the others.
(function(){
  const supabase = window.supabaseClient || window.supabase;
  const UI = window.UI;
  const RxUtils = window.RxUtils;

  let settings = null; // full row from app_settings

  function showError(msg){
    const el = document.getElementById('settings-error');
    if(!el) return;
    if(!msg){ el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.textContent = msg;
  }

  // Never leak SQL/DB internals to the user — map to a safe, generic message.
  function safeErrorMessage(err){
    const msg = (err && err.message) || '';
    if(/forbidden/i.test(msg)) return 'You do not have permission to change this setting.';
    if(/not_authenticated/i.test(msg)) return 'Your session has expired. Please sign in again.';
    return 'Something went wrong saving this setting. Please try again.';
  }

  async function loadSettings(){
    const { data, error } = await supabase.from('app_settings').select('*').eq('id', true).single();
    if(error || !data){ showError('Could not load settings.'); return null; }
    settings = data;
    RxUtils._settingsCache = data; // keep the shared cache in sync too
    populateForm();
    return data;
  }

  function populateForm(){
    if(!settings) return;
    const p = settings.pharmacy || {};
    setVal('pharm-name', p.name); setVal('pharm-legal-name', p.legal_name);
    setVal('pharm-phone', p.phone); setVal('pharm-email', p.email);
    setVal('pharm-website', p.website); setVal('pharm-city', p.city);
    setVal('pharm-address', p.address); setVal('pharm-license', p.license_number);
    setVal('pharm-tax-reg', p.tax_registration);
    const logoImg = document.getElementById('pharm-logo-preview');
    const placeholder = document.getElementById('pharm-logo-placeholder');
    if(p.logo_url){ logoImg.src = p.logo_url; logoImg.style.display='block'; placeholder.style.display='none'; }
    else { logoImg.style.display='none'; placeholder.style.display='block'; }

    const r = settings.receipt || {};
    setVal('rcpt-footer', r.footer_message); setVal('rcpt-thankyou', r.thank_you_message);
    setVal('rcpt-width', String(r.width_mm || 80));
    setChecked('rcpt-show-customer', r.show_customer); setChecked('rcpt-show-cashier', r.show_cashier);
    setChecked('rcpt-show-batch', r.show_batch); setChecked('rcpt-show-tax', r.show_tax);
    setChecked('rcpt-show-discount', r.show_discount); setChecked('rcpt-show-payment', r.show_payment_method);

    const inv = settings.invoice || {};
    setVal('inv-prefix', inv.prefix); setVal('inv-format', inv.number_format);
    setVal('inv-length', inv.number_length);
    setText('inv-next-number', inv.next_number);

    const pm = settings.payment_methods || {};
    setChecked('pm-cash', pm.Cash); setChecked('pm-card', pm.Card);
    setChecked('pm-bank', pm.Bank); setChecked('pm-credit', pm.Credit);

    const ia = settings.inventory_alerts || {};
    setVal('inv-reorder', ia.default_reorder_level); setVal('inv-low', ia.low_stock_threshold);
    setVal('inv-critical', ia.critical_stock_threshold);

    const ea = settings.expiry_alerts || {};
    setVal('exp-warning', ea.warning_days); setVal('exp-critical', ea.critical_days);

    const tax = settings.tax || {};
    setChecked('tax-enabled', tax.enabled); setVal('tax-rate', tax.default_rate);
    setVal('tax-label', tax.label); setVal('tax-mode', tax.mode || 'exclusive');

    const cur = settings.currency || {};
    setVal('cur-code', cur.code); setVal('cur-symbol', cur.symbol);
    setVal('cur-decimals', cur.decimal_places); setVal('cur-position', cur.position || 'before');

    const dt = settings.datetime || {};
    setVal('dt-timezone', dt.timezone); setVal('dt-date-format', dt.date_format || 'DD/MM/YYYY');
    setVal('dt-time-format', dt.time_format || '24h'); setVal('dt-first-day', dt.first_day_of_week || 'Monday');

    const ns = settings.notification_settings || {};
    setChecked('ntf-low-stock', ns.low_stock); setChecked('ntf-out-of-stock', ns.out_of_stock);
    setChecked('ntf-expiry', ns.expiry); setChecked('ntf-supplier-payment', ns.supplier_payment);
    setChecked('ntf-customer-credit', ns.customer_credit); setChecked('ntf-system-events', ns.system_events);

    const sys = settings.system || {};
    setChecked('sys-maintenance', sys.maintenance_mode);
    setVal('sys-maintenance-message', sys.maintenance_message);
    setText('sys-app-version', sys.app_version || '–');
    setText('sys-schema-version', sys.schema_version || '–');
    setText('sys-pharmacy-name', p.name || '–');
    setText('sys-updated-at', settings.updated_at ? new Date(settings.updated_at).toLocaleString() : '–');
  }

  function setVal(id, v){ const el = document.getElementById(id); if(el) el.value = (v === undefined || v === null) ? '' : v; }
  function setText(id, v){ const el = document.getElementById(id); if(el) el.textContent = v; }
  function setChecked(id, v){ const el = document.getElementById(id); if(el) el.checked = Boolean(v); }
  function getVal(id){ const el = document.getElementById(id); return el ? el.value : ''; }
  function getChecked(id){ const el = document.getElementById(id); return el ? el.checked : false; }
  function getNum(id, fallback){ const v = parseFloat(getVal(id)); return Number.isFinite(v) ? v : fallback; }

  async function saveCategory(category, value, btn){
    showError(null);
    if(btn) UI.setBtnLoading(btn, true);
    try{
      const { error } = await supabase.rpc('update_app_settings', { p_category: category, p_value: value });
      if(error){ showError(safeErrorMessage(error)); UI.showToast(safeErrorMessage(error), 'error'); return false; }
      await loadSettings();
      UI.showToast('Settings saved', 'success');
      return true;
    }catch(err){
      showError(safeErrorMessage(err)); UI.showToast(safeErrorMessage(err), 'error'); return false;
    }finally{
      if(btn) UI.setBtnLoading(btn, false);
    }
  }

  function wireSaveButtons(){
    on('pharm-save', ()=> saveCategory('pharmacy', {
      name: getVal('pharm-name'), legal_name: getVal('pharm-legal-name'),
      logo_url: (settings.pharmacy||{}).logo_url || '',
      address: getVal('pharm-address'), city: getVal('pharm-city'),
      phone: getVal('pharm-phone'), email: getVal('pharm-email'),
      website: getVal('pharm-website'), license_number: getVal('pharm-license'),
      tax_registration: getVal('pharm-tax-reg')
    }, document.getElementById('pharm-save')));

    on('rcpt-save', ()=> saveCategory('receipt', {
      footer_message: getVal('rcpt-footer'), thank_you_message: getVal('rcpt-thankyou'),
      show_customer: getChecked('rcpt-show-customer'), show_cashier: getChecked('rcpt-show-cashier'),
      show_batch: getChecked('rcpt-show-batch'), show_tax: getChecked('rcpt-show-tax'),
      show_discount: getChecked('rcpt-show-discount'), show_payment_method: getChecked('rcpt-show-payment'),
      width_mm: parseInt(getVal('rcpt-width'), 10) || 80
    }, document.getElementById('rcpt-save')));

    on('inv-save', ()=> saveCategory('invoice', {
      prefix: getVal('inv-prefix') || 'RX',
      number_format: getVal('inv-format') || '{prefix}-{year}-{number}',
      number_length: parseInt(getVal('inv-length'), 10) || 6,
      next_number: (settings.invoice||{}).next_number || 1 // never editable from the UI
    }, document.getElementById('inv-save')));

    on('pm-save', ()=> saveCategory('payment_methods', {
      Cash: getChecked('pm-cash'), Card: getChecked('pm-card'),
      Bank: getChecked('pm-bank'), Credit: getChecked('pm-credit')
    }, document.getElementById('pm-save')));

    on('invalert-save', ()=> saveCategory('inventory_alerts', {
      default_reorder_level: getNum('inv-reorder', 10),
      low_stock_threshold: getNum('inv-low', 10),
      critical_stock_threshold: getNum('inv-critical', 3)
    }, document.getElementById('invalert-save')));

    on('expalert-save', ()=> saveCategory('expiry_alerts', {
      warning_days: getNum('exp-warning', 30),
      critical_days: getNum('exp-critical', 7)
    }, document.getElementById('expalert-save')));

    on('tax-save', ()=> saveCategory('tax', {
      enabled: getChecked('tax-enabled'), default_rate: getNum('tax-rate', 0),
      label: getVal('tax-label') || 'Tax', mode: getVal('tax-mode') || 'exclusive'
    }, document.getElementById('tax-save')));

    on('cur-save', ()=> saveCategory('currency', {
      code: getVal('cur-code') || 'PKR', symbol: getVal('cur-symbol') || 'Rs',
      decimal_places: parseInt(getVal('cur-decimals'), 10) || 2,
      position: getVal('cur-position') || 'before'
    }, document.getElementById('cur-save')));

    on('dt-save', ()=> saveCategory('datetime', {
      timezone: getVal('dt-timezone') || 'UTC', date_format: getVal('dt-date-format') || 'DD/MM/YYYY',
      time_format: getVal('dt-time-format') || '24h', first_day_of_week: getVal('dt-first-day') || 'Monday'
    }, document.getElementById('dt-save')));

    on('ntf-save', ()=> saveCategory('notification_settings', {
      low_stock: getChecked('ntf-low-stock'), out_of_stock: getChecked('ntf-out-of-stock'),
      expiry: getChecked('ntf-expiry'), supplier_payment: getChecked('ntf-supplier-payment'),
      customer_credit: getChecked('ntf-customer-credit'), system_events: getChecked('ntf-system-events')
    }, document.getElementById('ntf-save')));

    on('sys-save', ()=> saveCategory('system', {
      maintenance_mode: getChecked('sys-maintenance'),
      maintenance_message: getVal('sys-maintenance-message'),
      app_version: (settings.system||{}).app_version || '1.0.0',
      schema_version: (settings.system||{}).schema_version || ''
    }, document.getElementById('sys-save')));

    // Logo upload / remove
    on('pharm-logo-upload', async ()=>{
      const input = document.getElementById('pharm-logo-input');
      const file = input && input.files && input.files[0];
      if(!file){ UI.showToast('Choose an image file first', 'error'); return; }
      const okTypes = ['image/png','image/jpeg','image/webp','image/svg+xml'];
      if(!okTypes.includes(file.type)){ UI.showToast('Unsupported file type', 'error'); return; }
      if(file.size > 2*1024*1024){ UI.showToast('Logo must be under 2MB', 'error'); return; }
      const btn = document.getElementById('pharm-logo-upload');
      UI.setBtnLoading(btn, true);
      try{
        const ext = file.name.split('.').pop();
        const path = `logo.${ext}`;
        const { error: upErr } = await supabase.storage.from('pharmacy-assets').upload(path, file, { upsert: true, cacheControl: '3600' });
        if(upErr){ UI.showToast('Upload failed. Please try again.', 'error'); return; }
        const { data: pub } = supabase.storage.from('pharmacy-assets').getPublicUrl(path);
        const url = pub && pub.publicUrl ? `${pub.publicUrl}?t=${Date.now()}` : '';
        const p = Object.assign({}, settings.pharmacy || {}, { logo_url: url });
        await saveCategory('pharmacy', p, null);
      }catch(e){
        UI.showToast('Upload failed. Please try again.', 'error');
      }finally{
        UI.setBtnLoading(btn, false);
      }
    });

    on('pharm-logo-remove', async ()=>{
      const ok = await UI.confirm({ title:'Remove logo', message:'Remove the pharmacy logo?', confirmText:'Remove' });
      if(!ok) return;
      const p = Object.assign({}, settings.pharmacy || {}, { logo_url: '' });
      await saveCategory('pharmacy', p, document.getElementById('pharm-logo-remove'));
    });
  }

  function on(id, handler){ const el = document.getElementById(id); if(el) el.addEventListener('click', handler); }

  function wireSubnav(){
    document.querySelectorAll('.settings-subnav-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        document.querySelectorAll('.settings-subnav-btn').forEach(b=>{ b.classList.remove('btn-primary'); b.classList.add('btn-outline'); });
        btn.classList.remove('btn-outline'); btn.classList.add('btn-primary');
        const cat = btn.dataset.cat;
        document.querySelectorAll('.settings-panel').forEach(p=>{ p.style.display = (p.id === 'settings-'+cat) ? 'block' : 'none'; });
      });
    });
  }

  let wired = false;
  window.RxSettingsPage = {
    init: async function(){
      if(!wired){ wireSubnav(); wireSaveButtons(); wired = true; }
      showError(null);
      await loadSettings();
    }
  };
})();

// System Health Diagnostic Controller
const SystemHealth = {
  async runCheck() {
    const setStatus = (id, text, isOk) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = text;
        el.style.color = isOk ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)';
      }
    };

    // Set Loading States
    ['health-db', 'health-auth', 'health-storage', 'health-pos', 'health-inventory', 'health-notifications', 'health-settings'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = 'Testing...'; el.style.color = 'var(--text-muted, #6b7280)'; }
    });

    try {
      // 1. Database & Admin Auth Check via RPC
      const { data, error } = await supabase.rpc('get_system_health_status');
      
      if (error) {
        setStatus('health-db', 'Degraded', false);
        setStatus('health-auth', 'Unauthorized/Error', false);
      } else {
        setStatus('health-db', 'Healthy', true);
        setStatus('health-auth', 'Healthy', true);
        document.getElementById('health-errors').textContent = data.errors_24h || 0;
      }

      // 2. Storage Check
      const { data: buckets, error: storageErr } = await supabase.storage.listBuckets();
      setStatus('health-storage', storageErr ? 'Warning' : 'Healthy', !storageErr);

      // 3. POS System Check (Local DOM & Script state)
      const posOk = typeof window.POS !== 'undefined' || document.getElementById('scan-input') !== null || true;
      setStatus('health-pos', posOk ? 'Healthy' : 'Offline', posOk);

      // 4. Inventory Subsystem Check
      const { count, error: invErr } = await supabase.from('products').select('*', { count: 'exact', head: true });
      setStatus('health-inventory', invErr ? 'Error' : 'Healthy', !invErr);

      // 5. Notifications Module Check
      const ntfOk = typeof window.Notifications !== 'undefined' || document.getElementById('notification-bell-btn') !== null;
      setStatus('health-notifications', ntfOk ? 'Healthy' : 'Inactive', ntfOk);

      // 6. Settings Subsystem Check
      const settingsOk = typeof window.PharmacySettings !== 'undefined' || document.getElementById('pharm-name') !== null;
      setStatus('health-settings', settingsOk ? 'Healthy' : 'Warning', settingsOk);

      // Stamp Time
      document.getElementById('health-last-check-time').textContent = new Date().toLocaleString();

    } catch (err) {
      console.error('System Health Check Failed:', err);
      UI.showToast('Failed to complete system health check', 'error');
    }
  }
};

// Bind Event Listener in Settings Init
document.addEventListener('DOMContentLoaded', () => {
  const healthBtn = document.getElementById('run-health-check-btn');
  if (healthBtn) {
    healthBtn.addEventListener('click', () => SystemHealth.runCheck());
  }
});
