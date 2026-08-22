// UI utilities: toasts, modals, loading, dark mode
(function(){
  window.UI = {};

  // Toasts
  const toastsRoot = document.createElement('div');
  toastsRoot.className = 'toasts';
  // Accessibility: announce toast messages politely
  toastsRoot.setAttribute('role','status');
  toastsRoot.setAttribute('aria-live','polite');
  toastsRoot.setAttribute('aria-atomic','true');
  document.body.appendChild(toastsRoot);

  UI.showToast = function(message, type='info', timeout=3500){
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('tabindex','0');
    el.setAttribute('aria-label', String(message));

    const icon = document.createElement('div'); icon.className = 'icon';
    const iconEl = document.createElement('i');
    iconEl.className = type==='success' ? 'fa-solid fa-check' : type==='error' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-info';
    icon.appendChild(iconEl);

    const body = document.createElement('div'); body.style.flex = '1'; body.textContent = String(message);

    el.appendChild(icon); el.appendChild(body);
    toastsRoot.appendChild(el);

    const id = setTimeout(()=>{ el.style.opacity='0'; el.addEventListener('transitionend', ()=>el.remove()); }, timeout);

    function removeToast(){ clearTimeout(id); if(el.parentNode) el.remove(); }
    el.addEventListener('click', removeToast);
    el.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' ' || e.key === 'Escape'){ e.preventDefault(); removeToast(); } });
  };

  // Modal: returns Promise<boolean>
  UI.confirm = function(opts){
    return new Promise(resolve=>{
      const backdrop = document.createElement('div'); backdrop.className='modal-backdrop';
      backdrop.tabIndex = -1;

      const modal = document.createElement('div'); modal.className='modal';
      modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true');
      const titleId = 'modal-title-' + Date.now(); const descId = 'modal-desc-' + Date.now();

      const container = document.createElement('div'); container.style.display='flex'; container.style.gap='12px'; container.style.alignItems='center';
      const warning = document.createElement('div'); warning.style.fontSize='28px'; warning.style.color='#f59e0b'; const ico = document.createElement('i'); ico.className='fa-solid fa-triangle-exclamation'; warning.appendChild(ico);
      const textWrap = document.createElement('div');
      const h3 = document.createElement('h3'); h3.id = titleId; h3.textContent = opts.title||'Confirm';
      const msg = document.createElement('div'); msg.className='muted'; msg.id = descId; msg.textContent = opts.message||'';
      textWrap.appendChild(h3); textWrap.appendChild(msg);
      container.appendChild(warning); container.appendChild(textWrap);

      const actions = document.createElement('div'); actions.className='actions';
      const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-outline cancel'; cancelBtn.type='button'; cancelBtn.setAttribute('aria-label','Cancel'); cancelBtn.textContent = 'Cancel';
      const confirmBtn = document.createElement('button'); confirmBtn.className='btn btn-danger confirm'; confirmBtn.type='button'; confirmBtn.setAttribute('aria-label', opts.confirmText || 'Confirm'); confirmBtn.textContent = opts.confirmText||'Confirm';
      actions.appendChild(cancelBtn); actions.appendChild(confirmBtn);

      modal.setAttribute('aria-labelledby', titleId); modal.setAttribute('aria-describedby', descId);
      modal.appendChild(container); modal.appendChild(actions);

      backdrop.appendChild(modal); document.body.appendChild(backdrop);

      function closeAndResolve(val){ document.removeEventListener('keydown', keyHandler); if(backdrop.parentNode) backdrop.remove(); resolve(Boolean(val)); }

      backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop){ closeAndResolve(false); }});

      cancelBtn.addEventListener('click', ()=> closeAndResolve(false));
      confirmBtn.addEventListener('click', ()=> closeAndResolve(true));

      // Keyboard: Escape closes modal; Enter/Space activate focused buttons
      function keyHandler(e){ if(e.key === 'Escape'){ e.preventDefault(); closeAndResolve(false); } }
      document.addEventListener('keydown', keyHandler);

      // Ensure buttons respond to Enter/Space when focused
      [cancelBtn, confirmBtn].forEach(b=>{
        b.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); b.click(); } });
      });

      // focus confirm by default
      confirmBtn.focus();
    });
  };

  // Button loading state
  UI.setBtnLoading = function(btn, loading){
    if(!btn) return;
    if(loading){
      if(!btn.dataset.origText) btn.dataset.origText = btn.textContent || '';
      btn.classList.add('btn-loading');
      btn.setAttribute('aria-busy','true');
      btn.disabled = true;
      // Clear and add spinner + text safely
      btn.textContent = '';
      const spin = document.createElement('span'); spin.className = 'spinner'; spin.setAttribute('aria-hidden','true');
      const txt = document.createTextNode(' ' + btn.dataset.origText);
      btn.appendChild(spin); btn.appendChild(txt);
    } else {
      if(btn.dataset.origText) btn.textContent = btn.dataset.origText;
      btn.classList.remove('btn-loading'); btn.removeAttribute('aria-busy');
      btn.disabled = false;
    }
  };

  // Dark mode
  UI.initDarkMode = function(){
    const key = 'rx-dark';
    const isDark = localStorage.getItem(key) === '1' || window.matchMedia('(prefers-color-scheme:dark)').matches;
    document.body.classList.toggle('dark', isDark);
    window.toggleDark = function(v){ document.body.classList.toggle('dark', v); localStorage.setItem(key, v? '1':'0'); };
  };
  document.addEventListener('DOMContentLoaded', UI.initDarkMode);

  // Confirm logout
  UI.confirmLogout = async function(){
    const ok = await UI.confirm({title:'Sign out', message:'Are you sure you want to sign out?', confirmText:'Sign out'});
    if(ok && window.logout){ await window.logout(); UI.showToast('Signed out', 'info'); }
  };

})();
