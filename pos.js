(function(){
  const supabase = window.supabase;
  const supabaseClient = window.supabaseClient;
  const UI = window.UI;
  const RxUtils = window.RxUtils;

  let currentProfile = null;
  let cart = [];

  async function init(){
    currentProfile = await window.guardPage?.(null);
    if(!currentProfile) return;
    document.getElementById('who-label').textContent = `${currentProfile.full_name} · ${currentProfile.role}`;
    const now = new Date(); const cd = document.getElementById('current-date'); if(cd) cd.textContent = now.toLocaleDateString();
    const av = document.getElementById('who-avatar'); if(av) av.textContent = (currentProfile.full_name||'U').slice(0,1).toUpperCase();
    if(currentProfile.role === 'admin'){
      const navAdmin = document.getElementById('nav-admin');
      if(navAdmin){
        navAdmin.style.display = 'flex';
        navAdmin.addEventListener('click', ()=>{ window.location.href = 'admin.html'; });
      }
    }

    RxUtils.installPosHotkeys();

    const scanInput = document.getElementById('scan-input');
    scanInput.addEventListener('keydown', async (e)=>{
      if(e.key !== 'Enter') return;
      const query = scanInput.value.trim(); if(!query) return; await runSearch(query); scanInput.value='';
    });

    document.getElementById('cart-tax').addEventListener('input', renderCart);
    document.getElementById('cart-discount').addEventListener('input', renderCart);
    document.getElementById('checkout-btn').addEventListener('click', checkout);

    // Accessibility: mark cart region as live for screen readers
    const cartRegion = document.getElementById('cart-items'); if(cartRegion){ cartRegion.setAttribute('role','status'); cartRegion.setAttribute('aria-live','polite'); }
    const resultsPanel = document.getElementById('results-panel'); if(resultsPanel){ resultsPanel.setAttribute('aria-live','polite'); }

    // initial render
    renderCart();
  }

  async function runSearch(query){
    try{
      const { data: exact } = await supabase.from('pos_catalog').select('*').eq('barcode', query).order('expiry_date', {ascending:true});
      if(exact && exact.length){ renderResults(exact, query); addToCart(exact[0]); return; }
      const { data: matches } = await supabase.from('pos_catalog').select('*').or(`name.ilike.%${query}%,generic_name.ilike.%${query}%`).order('expiry_date', {ascending:true});
      renderResults(matches||[], query);
    }catch(err){ UI.showToast('Search failed: '+err.message,'error'); }
  }

  function renderResults(rows, query){
    const resultsPanel = document.getElementById('results-panel');
    resultsPanel.innerHTML = '';
    if(!rows || !rows.length){
      const empty = document.createElement('div'); empty.className = 'empty-state';
      empty.textContent = `No matches for "${query}". Try the generic name instead.`;
      resultsPanel.appendChild(empty);
      window.__lastResults = [];
      return;
    }

    const grid = document.createElement('div'); grid.className = 'product-grid';
    rows.forEach(r => {
      const card = document.createElement('div'); card.className = 'product-card';

      const imgWrap = document.createElement('div'); imgWrap.className = 'product-image';
      const img = document.createElement('img');
      const src = r.image_url || 'https://via.placeholder.com/120x90?text=No+Image';
      // Simple scheme check to avoid javascript: URLs
      if(String(src).trim().toLowerCase().startsWith('javascript:')) img.src = 'https://via.placeholder.com/120x90?text=No+Image'; else img.src = src;
      img.alt = r.name || '';
      imgWrap.appendChild(img);

      const meta = document.createElement('div'); meta.className = 'product-meta';
      const left = document.createElement('div');
      const title = document.createElement('div'); title.className = 'product-title'; title.textContent = r.name || '';
      const sub = document.createElement('div'); sub.className = 'product-sub'; sub.textContent = `${r.generic_name||''} · ${r.category||''}`;
      left.appendChild(title); left.appendChild(sub);

      const right = document.createElement('div'); right.style.textAlign = 'right';
      const price = document.createElement('div'); price.className = 'mono'; price.textContent = RxUtils.formatCurrency(r.selling_price);
      const stockWrap = document.createElement('div'); stockWrap.style.marginTop = '6px';
      const badge = document.createElement('span');
      if(r.quantity > 5) { badge.className = 'stock-badge in'; badge.textContent = 'In stock'; }
      else if(r.quantity > 0) { badge.className = 'stock-badge low'; badge.textContent = 'Low'; }
      else { badge.className = 'stock-badge out'; badge.textContent = 'Out'; }
      stockWrap.appendChild(badge);
      right.appendChild(price); right.appendChild(stockWrap);

      meta.appendChild(left); meta.appendChild(right);

      const footer = document.createElement('div'); footer.style.display = 'flex'; footer.style.justifyContent = 'space-between'; footer.style.alignItems = 'center'; footer.style.marginTop = '8px';
      const batchInfo = document.createElement('div'); batchInfo.className = 'muted mono'; batchInfo.textContent = `Batch: ${r.batch_number || ''}`;
      const btnWrap = document.createElement('div');
      const btn = document.createElement('button'); btn.className = 'btn btn-outline btn-sm'; btn.type = 'button'; btn.textContent = 'Add'; btn.dataset.batch = r.batch_id;
      btn.setAttribute('aria-label', `Add ${r.name || ''} batch ${r.batch_number || ''}`);
      btn.addEventListener('click', ()=> addToCartById(btn.dataset.batch));
      btn.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); btn.click(); } });
      btnWrap.appendChild(btn);

      footer.appendChild(batchInfo); footer.appendChild(btnWrap);

      card.appendChild(imgWrap); card.appendChild(meta); card.appendChild(footer);
      grid.appendChild(card);
    });

    resultsPanel.appendChild(grid);
    window.__lastResults = rows;
  }

  function addToCartById(batchId){ const row = (window.__lastResults||[]).find(r=>r.batch_id===batchId); if(row) addToCart(row); }

  function addToCart(row){ const existing = cart.find(c=>c.batch_id===row.batch_id); if(existing){ if(existing.quantity < row.quantity) existing.quantity +=1; } else { cart.push({ product_id: row.product_id, batch_id: row.batch_id, name: row.name, batch_number: row.batch_number, unit_price: row.selling_price, quantity:1, available: row.quantity, image: row.image_url||null }); } renderCart(); }

  function renderCart(){
    const cartEl = document.getElementById('cart-items'); cartEl.innerHTML = '';
    if(!cart.length){ const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'Cart is empty'; cartEl.appendChild(empty); }
    else {
      cart.forEach((c,i)=>{
        const row = document.createElement('div'); row.className = 'cart-row'; row.style.display = 'flex'; row.style.justifyContent = 'space-between'; row.style.alignItems = 'center'; row.style.padding = '8px 0';

        const left = document.createElement('div'); left.style.display='flex'; left.style.alignItems='center';
        const thumb = document.createElement('div'); thumb.className = 'product-thumb'; const img = document.createElement('img'); img.src = c.image || 'https://via.placeholder.com/80'; img.alt = c.name || ''; thumb.appendChild(img);
        const info = document.createElement('div'); const nameEl = document.createElement('div'); nameEl.textContent = c.name || ''; const hint = document.createElement('div'); hint.className='hint mono'; hint.textContent = c.batch_number || '';
        info.appendChild(nameEl); info.appendChild(hint);
        left.appendChild(thumb); left.appendChild(info);

        const right = document.createElement('div'); right.style.display='flex'; right.style.alignItems='center'; right.style.gap='8px';
        const price = document.createElement('div'); price.className='mono'; price.textContent = RxUtils.formatCurrency(c.unit_price);
        const actions = document.createElement('div'); actions.className='cart-actions';
        const minus = document.createElement('button'); minus.className='btn btn-outline btn-sm'; minus.type='button'; minus.textContent = '−'; minus.setAttribute('aria-label', `Decrease quantity of ${c.name}`); minus.addEventListener('click', ()=> changeQty(i, -1)); minus.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); minus.click(); } });
        const qty = document.createElement('span'); qty.className='mono'; qty.textContent = String(c.quantity);
        const plus = document.createElement('button'); plus.className='btn btn-outline btn-sm'; plus.type='button'; plus.textContent = '+'; plus.setAttribute('aria-label', `Increase quantity of ${c.name}`); plus.addEventListener('click', ()=> changeQty(i, 1)); plus.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); plus.click(); } });
        const del = document.createElement('button'); del.className='btn btn-outline btn-sm'; del.type='button'; del.textContent = '✕'; del.setAttribute('aria-label', `Remove ${c.name} from cart`); del.addEventListener('click', ()=> removeItem(i)); del.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); del.click(); } });
        actions.appendChild(minus); actions.appendChild(qty); actions.appendChild(plus); actions.appendChild(del);

        right.appendChild(price); right.appendChild(actions);

        row.appendChild(left); row.appendChild(right);
        cartEl.appendChild(row);
      });
    }

    const subtotal = cart.reduce((s,c)=>s + c.unit_price * c.quantity, 0);
    const subtotalEl = document.getElementById('cart-subtotal'); if(subtotalEl) subtotalEl.textContent = RxUtils.formatCurrency(subtotal);
    const taxEl = document.getElementById('cart-tax'); const discEl = document.getElementById('cart-discount'); const tax = taxEl?Number(taxEl.value||0):0; const discount = discEl?Number(discEl.value||0):0; const taxAmount = subtotal*(tax/100); const grand = Math.max(0, subtotal + taxAmount - discount);
    const grandEl = document.getElementById('cart-grand'); if(grandEl) grandEl.textContent = RxUtils.formatCurrency(grand);
    const countEl = document.getElementById('cart-count'); if(countEl) countEl.textContent = String(cart.reduce((s,c)=>s+c.quantity,0));
  }

  function changeQty(i, delta){ const item = cart[i]; if(!item) return; const next = item.quantity + delta; if(next<1) return; if(next>item.available) return; item.quantity = next; renderCart(); }
  function removeItem(i){ cart.splice(i,1); renderCart(); }

  async function checkout(){
    if(!cart.length) return UI.showToast('Cart is empty','warn');
    const checkoutBtn = document.getElementById('checkout-btn'); UI.setBtnLoading(checkoutBtn, true);
    try{
      const tax = Number(document.getElementById('cart-tax').value||0);
      const discount = Number(document.getElementById('cart-discount').value||0);

      // Build RPC payload — server will validate stock, compute totals and perform atomically.
      const items = cart.map(c => ({
        batch_id: c.batch_id,
        product_id: c.product_id,
        quantity: c.quantity,
        unit_price: c.unit_price
      }));

      const rpcParams = {
        p_cashier_id: currentProfile.id,
        p_items: items,
        p_discount: discount,
        p_tax_rate: tax
      };

      const { data: result, error } = await supabaseClient.rpc('execute_checkout', rpcParams);
      if(error) { console.error('RPC execute_checkout error', error); UI.showToast('Checkout failed: '+(error.message||error.code||'RPC error'),'error'); return; }

      // result is expected to be JSON with sale_id, subtotal, tax, grand_total, status
      const summary = result;
      const customerName = document.getElementById('customer-name').value || '';
      const customerPhone = document.getElementById('customer-phone').value || '';

      printReceipt(cart, summary.subtotal, summary.tax, discount, summary.grand_total, customerName, customerPhone, summary.sale_id, currentProfile.full_name);
      cart = []; renderCart(); UI.showToast('Sale recorded successfully','success');
      const rp = document.getElementById('results-panel'); rp.innerHTML = ''; const saleMsg = document.createElement('div'); saleMsg.className = 'empty-state'; saleMsg.textContent = 'Sale recorded. Scan the next item to begin a new sale.'; rp.appendChild(saleMsg);
    }catch(err){ console.error(err); UI.showToast('Checkout failed: '+(err.message||err),'error'); }
    finally{ UI.setBtnLoading(document.getElementById('checkout-btn'), false); }
  }

  function printReceipt(items, subtotal, taxAmount, discount, grandTotal, customerName, customerPhone, saleId, cashierName){
    const now = new Date(); document.getElementById('r-datetime').textContent = now.toLocaleString();
    const invoice = `INV-${saleId || Date.now()}`;
    let meta = document.querySelector('#receipt .r-meta'); if(!meta){ const el = document.createElement('div'); el.className='r-meta'; document.querySelector('#receipt').insertBefore(el, document.getElementById('r-items')); meta = el; }
    // Build meta safely
    meta.textContent = '';
    const invEl = document.createElement('div'); invEl.textContent = `Invoice: ${invoice}`;
    const cashierEl = document.createElement('div'); cashierEl.textContent = `Cashier: ${cashierName || ''}`;
    meta.appendChild(invEl); meta.appendChild(cashierEl);
    if(customerName){ const cEl = document.createElement('div'); cEl.textContent = `Customer: ${customerName}`; meta.appendChild(cEl); }
    if(customerPhone){ const pEl = document.createElement('div'); pEl.textContent = `Phone: ${customerPhone}`; meta.appendChild(pEl); }

    // Build items table body
    const rItems = document.getElementById('r-items'); rItems.innerHTML = '';
    items.forEach(c => {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td'); td1.textContent = `${c.name} x${c.quantity}`;
      const td2 = document.createElement('td'); td2.style.textAlign = 'right'; td2.textContent = RxUtils.formatCurrency(c.unit_price * c.quantity);
      tr.appendChild(td1); tr.appendChild(td2); rItems.appendChild(tr);
    });

    const table = document.querySelector('#receipt table:last-of-type');
    if(table){
      table.innerHTML = '';
      const makeRow = (k,v) => { const tr = document.createElement('tr'); const tdk = document.createElement('td'); tdk.textContent = k; const tdv = document.createElement('td'); tdv.style.textAlign = 'right'; tdv.textContent = v; tr.appendChild(tdk); tr.appendChild(tdv); return tr; };
      table.appendChild(makeRow('Subtotal', RxUtils.formatCurrency(subtotal)));
      table.appendChild(makeRow('Tax', RxUtils.formatCurrency(taxAmount)));
      table.appendChild(makeRow('Discount', RxUtils.formatCurrency(discount)));
      const grandTr = document.createElement('tr'); const gk = document.createElement('td'); gk.style.fontWeight = '700'; gk.textContent = 'Grand Total'; const gv = document.createElement('td'); gv.style.textAlign = 'right'; gv.style.fontWeight = '700'; gv.textContent = RxUtils.formatCurrency(grandTotal); grandTr.appendChild(gk); grandTr.appendChild(gv); table.appendChild(grandTr);
      table.appendChild(makeRow('Payment', 'Cash'));
    }
    window.print();
  }

  // expose for testing/debug
  window.pos = { init, addToCart, renderCart };
  document.addEventListener('DOMContentLoaded', init);
})();
