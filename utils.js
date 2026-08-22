// Utility helpers used across the app
(function(){
  window.RxUtils = {};

  RxUtils.escapeHtml = function(str){
    return String(str||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  };

  RxUtils.daysUntil = function(dateStr){
    if(!dateStr) return Infinity;
    const d = new Date(dateStr);
    return Math.ceil((d - new Date())/86400000);
  };

  // ------------------------------------------------------------------
  // Centralized app settings cache (Phase 7). Loaded once per page from
  // `app_settings` (readable by admin + cashier). Everything below falls
  // back to the original hardcoded defaults if settings haven't loaded yet
  // (e.g. offline, or the migration hasn't been run), so existing behavior
  // never breaks.
  // ------------------------------------------------------------------
  RxUtils._settingsCache = null;

  RxUtils.loadAppSettings = async function(){
    try{
      const client = window.supabaseClient || window.supabase;
      if(!client) return null;
      const { data, error } = await client.from('app_settings').select('*').eq('id', true).single();
      if(error || !data) return null;
      RxUtils._settingsCache = data;
      document.dispatchEvent(new CustomEvent('rx-settings-loaded', { detail: data }));
      return data;
    }catch(e){ return null; }
  };

  RxUtils.getSettings = function(){ return RxUtils._settingsCache; };

  // Do NOT change historical amounts: this only affects how a number is
  // *displayed*. Stored transaction values are never rewritten by settings.
  RxUtils.formatCurrency = function(v){
    const s = (RxUtils._settingsCache && RxUtils._settingsCache.currency) || {};
    const symbol = s.symbol || 'Rs';
    const decimals = Number.isFinite(s.decimal_places) ? s.decimal_places : 2;
    const position = s.position || 'before';
    const amount = Number(v || 0).toFixed(decimals);
    return position === 'after' ? `${amount} ${symbol}` : `${symbol} ${amount}`;
  };

  // Best-effort background load so formatCurrency/getSettings are populated
  // shortly after any page loads. Pages don't need to await this.
  document.addEventListener('DOMContentLoaded', ()=>{ RxUtils.loadAppSettings(); });

  // Hotkeys for POS: F2 focus search, Enter to checkout when focused on checkout button, Esc to clear
  RxUtils.installPosHotkeys = function(){
    document.addEventListener('keydown', (e)=>{
      if(e.key === 'F2'){
        const el = document.getElementById('scan-input'); if(el){ e.preventDefault(); el.focus(); el.select(); }
      }
      if(e.key === 'Escape'){
        const el = document.getElementById('scan-input'); if(el){ el.value=''; el.blur(); }
      }
      // Enter to checkout when focus is not inside an input
      if(e.key === 'Enter'){
        const active = document.activeElement;
        if(active && (active.tagName==='BODY' || active === document.getElementById('results-panel') )){
          const btn = document.getElementById('checkout-btn'); if(btn){ btn.click(); }
        }
      }
    });
  };

  // ------------------------------------------------------------------
  // Phase 8 Group 5 Production Hardening Helpers
  // ------------------------------------------------------------------

  /**
   * Executes an async action while locking the trigger button to prevent accidental duplicate submissions.
   * @param {HTMLElement} button - The button element triggered.
   * @param {Function} asyncFn - The async function to perform.
   */
  RxUtils.withSubmitLock = async function(button, asyncFn) {
    if (!button || button.disabled || button.getAttribute('data-processing') === 'true') {
      return;
    }

    const originalText = button.innerHTML;
    try {
      button.disabled = true;
      button.setAttribute('data-processing', 'true');
      button.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Processing...';
      
      return await asyncFn();
    } catch (err) {
      console.error('Action execution failed:', err);
      if (window.UI && window.UI.showToast) {
        window.UI.showToast(RxUtils.sanitizeErrorMessage(err), 'error');
      }
      throw err;
    } finally {
      button.disabled = false;
      button.removeAttribute('data-processing');
      button.innerHTML = originalText;
    }
  };

  /**
   * Sanitizes system errors to avoid exposing raw schema details or internal database errors to end users.
   * @param {Error|Object|string} error - Error object or string message.
   * @returns {string} User-safe error message string.
   */
  RxUtils.sanitizeErrorMessage = function(error) {
    if (!error) return 'An unknown error occurred.';
    const msg = typeof error === 'string' ? error : (error.message || '');
    
    if (msg.includes('foreign key constraint')) return 'Cannot perform this action: referenced item does not exist or is in use.';
    if (msg.includes('unique constraint')) return 'A record with this identifier already exists.';
    if (msg.includes('row-level security')) return 'Permission denied: You are not authorized to perform this action.';
    if (msg.includes('insufficient stock') || msg.includes('Return quantity must be greater')) return msg; // Preserve explicit business rules
    
    return 'Database operation failed. Please check your inputs or contact system administrator.';
  };

})();