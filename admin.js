(function(){
  const supabase = window.supabase;
  const supabaseClient = window.supabaseClient;
  const UI = window.UI;
  const RxUtils = window.RxUtils;
  let currentProfile = null;
  let suppliers = [];
  let purchaseProducts = [];
  let financeChart = null;

  async function init(){
    currentProfile = await window.guardPage?.('admin');
    if(!currentProfile) return;
    document.getElementById('who-label').textContent = `${currentProfile.full_name} · admin`;
    const now = new Date(); const cd = document.getElementById('current-date'); if(cd) cd.textContent = now.toLocaleDateString();
    loadDashboard(); loadInventory();

    document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });

    document.getElementById('product-form').addEventListener('submit', async (e)=>{ e.preventDefault(); await addProduct(e); });
    document.getElementById('batch-form').addEventListener('submit', async (e)=>{ e.preventDefault(); await addBatch(e); });
    document.getElementById('run-report').addEventListener('click', loadReport);
    const financeButton = document.getElementById('run-finance');
    if(financeButton) financeButton.addEventListener('click', loadFinance);
    const expenseForm = document.getElementById('expense-form');
    if(expenseForm) expenseForm.addEventListener('submit', saveExpense);
    const historyButton = document.getElementById('run-history');
    if(historyButton) historyButton.addEventListener('click', loadPurchaseHistory);
    ['history-supplier','history-status','history-range'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.addEventListener('change', loadPurchaseHistory);
    });
    const adjustButton = document.getElementById('apply-adjustment');
    if(adjustButton) adjustButton.addEventListener('click', applyAdjustment);
    const expenseDate = document.getElementById('expense-date');
    if(expenseDate) expenseDate.value = new Date().toISOString().slice(0,10);
    initCharts();
  }

  // Central tab-switch logic, reused by the sidebar nav clicks and by
  // window.switchTab (called from notifications.js when a low-stock/expiry
  // notification is clicked, so it can jump straight to the Inventory tab).
  function activateTab(tab){
    if(!tab) return;
    document.querySelectorAll('.nav-item[data-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    ['dashboard','inventory','suppliers','purchases','purchase_history','reports','finance','returns','settings'].forEach(t=>{
      const el = document.getElementById('tab-'+t); if(el) el.style.display = t===tab ? 'block' : 'none';
    });
    const activeBtn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
    const titleEl = document.getElementById('page-title');
    if(titleEl && activeBtn) titleEl.textContent = activeBtn.textContent.trim().replace(/^\S+\s/, '');
    if(tab==='returns') loadReturns();
    if(tab==='reports') loadReport();
    if(tab==='finance') loadFinance();
    if(tab==='suppliers') loadSuppliers();
    if(tab==='purchases') loadPurchaseForm();
    if(tab==='purchase_history') loadPurchaseHistory();
    if(tab==='inventory') loadInventory();
    if(tab==='settings' && window.RxSettingsPage) window.RxSettingsPage.init();
  }
  window.switchTab = activateTab;

  // Helpers
  function expiryBadge(dateStr, windowDays){ const d = RxUtils.daysUntil(dateStr); if(d<=0) return `<span class="badge badge-red">Expired</span>`; if(d<=30) return `<span class="badge badge-red">${d}d left</span>`; if(d<=windowDays) return `<span class="badge badge-amber">${d}d left</span>`; return `<span class="badge badge-green">${d}d left</span>`; }

  async function loadDashboard() {
  try {
    const { data: products, error: prodErr } = await supabaseClient
      .from('products')
      .select('*, batches(*)');
      
    if (prodErr) throw prodErr;
    if (!products) return;

    // Helper function to safely update text content
    const setSafeText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    let lowStockRows = [], expiringRows = [];
    products.forEach(p => {
      const batches = p.batches || [];
      const totalQty = batches.reduce((s, b) => s + (b.quantity || 0), 0);
      
      if (totalQty <= (p.min_qty_threshold || 0)) {
        lowStockRows.push({ ...p, totalQty });
      }
      
      batches.forEach(b => {
        const d = RxUtils.daysUntil(b.expiry_date);
        if (d <= (p.near_expiry_days || 0)) {
          expiringRows.push({ product: p, batch: b, days: d });
        }
      });
    });

    // Safely update stat badges
    setSafeText('stat-total-products', products.length);
    setSafeText('stat-lowstock', lowStockRows.length);
    setSafeText('stat-expiring', expiringRows.length);

    // Safely update lists
    const lowStockList = document.getElementById('low-stock-list');
    if (lowStockList) {
      lowStockList.innerHTML = lowStockRows.length 
        ? lowStockRows.map(p => `<div class="cart-row"><span>${RxUtils.escapeHtml(p.name)}</span><span class="badge badge-red">${p.totalQty} left (min ${p.min_qty_threshold})</span></div>`).join('') 
        : `<div class="empty-state">Nothing below threshold.</div>`;
    }

    expiringRows.sort((a, b) => a.days - b.days);
    const expiringList = document.getElementById('expiring-list');
    if (expiringList) {
      expiringList.innerHTML = expiringRows.length 
        ? expiringRows.map(r => `<div class="cart-row"><span>${RxUtils.escapeHtml(r.product.name)} <span class="hint mono">${RxUtils.escapeHtml(r.batch.batch_number)}</span></span>${expiryBadge(r.batch.expiry_date, r.product.near_expiry_days)}</div>`).join('') 
        : `<div class="empty-state">Nothing expiring soon.</div>`;
    }

    // Today's sales and profit calculation
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { data: sales, error: salesErr } = await supabaseClient
      .from('sales')
      .select('*, sale_items(*)')
      .gte('created_at', startOfDay.toISOString());

    if (salesErr) throw salesErr;

    const totalSales = (sales || []).reduce((s, x) => s + Number(x.total_amount || 0), 0);
    const totalProfit = (sales || []).reduce((s, x) => {
      const itemsProfit = (x.sale_items || []).reduce((si, i) => {
        const unitPrice = Number(i?.unit_price || 0);
        const costPrice = Number(i?.cost_price || 0);
        const qty = Number(i?.quantity || 0);
        return si + (unitPrice - costPrice) * qty;
      }, 0);
      return s + itemsProfit;
    }, 0);

    setSafeText('stat-today-sales', RxUtils.formatCurrency(totalSales));
    setSafeText('stat-today-profit', RxUtils.formatCurrency(totalProfit));

  } catch (err) {
    console.error('loadDashboard error:', err);
    UI.showToast('Failed to load dashboard: ' + (err.message || err), 'error');
  }
}
  function getRangeDates(range){
    const now = new Date();
    let start = null;
    let end = null;
    if(range === 'today'){
      start = new Date(now); start.setHours(0,0,0,0);
      end = new Date(now); end.setHours(23,59,59,999);
    } else if(range === 'week'){
      start = new Date(now); start.setDate(now.getDate() - 6); start.setHours(0,0,0,0);
      end = new Date(now); end.setHours(23,59,59,999);
    } else if(range === 'month'){
      start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now); end.setHours(23,59,59,999);
    } else if(range === 'year'){
      start = new Date(now.getFullYear(), 0, 1); end = new Date(now); end.setHours(23,59,59,999);
    }
    return { start, end };
  }

  function initCharts(){
    window.charts = {};
    const ctxDaily = document.getElementById('chart-daily');
    if(ctxDaily){
      window.charts.dailySales = new Chart(ctxDaily, {
        type:'line',
        data:{ labels:[], datasets:[{label:'Daily Sales', data:[], borderColor:'#34d399', backgroundColor:'rgba(16,185,129,0.08)', tension:0.3, pointRadius:3}]},
        options:{responsive:true, plugins:{legend:{display:true}}}
      });
    }
    const ctxFinancials = document.getElementById('chart-financials');
    if(ctxFinancials){
      window.charts.financials = new Chart(ctxFinancials, {
        type:'bar',
        data:{ labels:['Sales','Purchases','Expenses','Payables'], datasets:[{ label:'Amount', data:[0,0,0,0], backgroundColor:['#34d399','#60a5fa','#f97316','#a855f7']}]},
        options:{responsive:true, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true, ticks:{callback:(value)=> 'Rs '+value}}}}
      });
    }
  }

  async function loadInventory() {
  try {
    const { data: products, error } = await supabaseClient
      .from('products')
      .select('*, batches(*)')
      .order('name');

    if (error) throw error;

    // Keep the "Add Batch to Existing Product" dropdown in sync with the
    // current product list (it was previously never populated).
    const productSelect = document.getElementById('b-product');
    if (productSelect) {
      const previousValue = productSelect.value;
      productSelect.innerHTML = '<option value="">Select product</option>' +
        (products || []).map(p => `<option value="${p.id}">${RxUtils.escapeHtml(p.name)}</option>`).join('');
      if (previousValue) productSelect.value = previousValue;
    }

    // The inventory table lives at #inventory-table in admin.html.
    const container = document.getElementById('inventory-table');
    if (!container) {
      // Not on the inventory tab right now — exit quietly.
      return;
    }

    if (!products || !products.length) {
      container.innerHTML = `<div class="empty-state">No products yet. Add one using the form above.</div>`;
      return;
    }

    container.innerHTML = `<table><thead><tr>
        <th>Product</th><th>Generic / Formula</th><th>Barcode</th><th>Shelf</th>
        <th>Stock</th><th>Batches</th><th>Status</th>
      </tr></thead><tbody>${products.map(p => {
        const batches = p.batches || [];
        const totalQty = batches.reduce((s, b) => s + (b.quantity || 0), 0);
        const threshold = p.min_qty_threshold || 0;

        let statusBadge;
        if (totalQty <= 0) statusBadge = `<span class="badge badge-red">Out of stock</span>`;
        else if (totalQty <= threshold) statusBadge = `<span class="badge badge-amber">Low stock</span>`;
        else statusBadge = `<span class="badge badge-green">In stock</span>`;

        const batchList = batches.length
          ? batches.map(b => `<div class="hint mono">${RxUtils.escapeHtml(b.batch_number)} · ${b.quantity}u · exp ${RxUtils.escapeHtml(b.expiry_date || '—')}</div>`).join('')
          : `<div class="hint">No batches yet</div>`;

        return `<tr>
            <td>${RxUtils.escapeHtml(p.name)}</td>
            <td>${RxUtils.escapeHtml(p.generic_name || '—')}</td>
            <td class="mono">${RxUtils.escapeHtml(p.barcode || '—')}</td>
            <td>${RxUtils.escapeHtml(p.shelf_location || '—')}</td>
            <td class="mono">${totalQty} <span class="hint">(min ${threshold})</span></td>
            <td>${batchList}</td>
            <td>${statusBadge}</td>
          </tr>`;
      }).join('')}</tbody></table>`;

  } catch (err) {
    console.error('loadInventory error:', err);
    UI.showToast('Failed to load inventory: ' + (err.message || err), 'error');
  }
}

  async function runNotificationScanners() {
  try {
    await supabaseClient.rpc('scan_low_stock_notifications');

    await supabaseClient.rpc('scan_expiry_notifications');
  } catch (err) {
    console.error('notification scanner', err);
  }
}
  
  async function addProduct(e){
    try{
      const { error } = await supabaseClient.from('products').insert({ name: document.getElementById('p-name').value.trim(), generic_name: document.getElementById('p-generic').value.trim() || null, barcode: document.getElementById('p-barcode').value.trim() || null, shelf_location: document.getElementById('p-shelf').value.trim() || null, min_qty_threshold: Number(document.getElementById('p-minqty').value), near_expiry_days: Number(document.getElementById('p-expirywindow').value) });
      if(error) { UI.showToast('Error adding product: '+error.message,'error'); return; }
      e.target.reset(); document.getElementById('p-minqty').value = 10; document.getElementById('p-expirywindow').value = 60; UI.showToast('Product added successfully','success'); loadInventory(); loadDashboard();
    }catch(err){ console.error(err); UI.showToast('Add product failed: '+(err.message||err),'error'); }
  }

  async function addBatch(e){
    try{
      const { error } = await supabaseClient.from('batches').insert({ product_id: document.getElementById('b-product').value, batch_number: document.getElementById('b-batchnum').value.trim(), quantity: Number(document.getElementById('b-qty').value), expiry_date: document.getElementById('b-expiry').value, cost_price: Number(document.getElementById('b-cost').value), selling_price: Number(document.getElementById('b-sell').value) });
      if(error){ UI.showToast('Error adding batch: '+error.message,'error'); return; }
      e.target.reset(); UI.showToast('Batch added successfully','success'); loadInventory(); loadDashboard();
    }catch(err){ console.error(err); UI.showToast('Add batch failed: '+(err.message||err),'error'); }
  }

  async function loadReport(){
    try{
      const range = document.getElementById('report-range').value;
      const { start, end } = getRangeDates(range);
      let salesQuery = supabaseClient.from('sales').select('*, sale_items(cost_price,quantity), profiles(full_name)').order('created_at',{ascending:false});
      let expensesQuery = supabaseClient.from('expenses').select('*').order('expense_date',{ascending:false});
      let purchasesQuery = supabaseClient.from('purchases').select('*').order('purchase_date',{ascending:false});
      if(start && end){
        salesQuery = salesQuery.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
        expensesQuery = expensesQuery.gte('expense_date', start.toISOString().slice(0,10)).lte('expense_date', end.toISOString().slice(0,10));
        purchasesQuery = purchasesQuery.gte('purchase_date', start.toISOString().slice(0,10)).lte('purchase_date', end.toISOString().slice(0,10));
      }
      const [salesRes, expensesRes, purchasesRes] = await Promise.all([
        salesQuery,
        expensesQuery,
        purchasesQuery
      ]);
      const sales = salesRes.data || [];
      if(salesRes.error) throw salesRes.error;
      const expenses = expensesRes.data || [];
      if(expensesRes.error) throw expensesRes.error;
      const purchases = purchasesRes.data || [];
      if(purchasesRes.error) throw purchasesRes.error;

      const totalSales = sales.reduce((sum, sale) => sum + Number(sale.total_amount), 0);
      const cogs = sales.reduce((sum, sale) => sum + (sale.sale_items||[]).reduce((itemSum, item) => itemSum + Number(item.cost_price || 0) * Number(item.quantity || 0), 0), 0);
      const grossProfit = totalSales - cogs;
      const totalExpenses = expenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
      const netProfit = grossProfit - totalExpenses;
      const purchaseTotal = purchases.reduce((sum, purchase) => sum + Number(purchase.total_amount || 0), 0);
      const payables = purchases.reduce((sum, purchase) => sum + Number(purchase.balance_due || 0), 0);

      document.getElementById('rep-total').textContent = RxUtils.formatCurrency(totalSales);
      document.getElementById('rep-cogs').textContent = RxUtils.formatCurrency(cogs);
      document.getElementById('rep-gross').textContent = RxUtils.formatCurrency(grossProfit);
      document.getElementById('rep-net').textContent = RxUtils.formatCurrency(netProfit);
      document.getElementById('rep-expenses').textContent = RxUtils.formatCurrency(totalExpenses);
      document.getElementById('rep-purchases').textContent = RxUtils.formatCurrency(purchaseTotal);
      document.getElementById('rep-payables').textContent = RxUtils.formatCurrency(payables);
      document.getElementById('rep-count').textContent = sales.length;

      if(window.charts && window.charts.financials){
        window.charts.financials.data.datasets[0].data = [totalSales, purchaseTotal, totalExpenses, payables];
        window.charts.financials.update();
      }

      document.getElementById('report-table').innerHTML = `<table><thead><tr><th>Date</th><th>Cashier</th><th>Items</th><th>Total</th><th>Profit</th></tr></thead><tbody>${(sales||[]).map(s=>{ const profit = (s.sale_items||[]).reduce((si,i)=>si + (Number(i.unit_price) - Number(i.cost_price || 0)) * Number(i.quantity || 0),0); return `<tr><td>${new Date(s.created_at).toLocaleString()}</td><td>${RxUtils.escapeHtml(s.profiles ? s.profiles.full_name : '—')}</td><td>${(s.sale_items||[]).length}</td><td class="mono">Rs ${Number(s.total_amount).toFixed(2)}</td><td class="mono">Rs ${profit.toFixed(2)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty-state">No sales in this period.</td></tr>'}</tbody></table>`;

      document.getElementById('report-expense-table').innerHTML = `<table><thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Notes</th></tr></thead><tbody>${(expenses||[]).map(e=>`<tr><td>${RxUtils.escapeHtml(e.expense_date)}</td><td>${RxUtils.escapeHtml(e.category)}</td><td class="mono">Rs ${Number(e.amount).toFixed(2)}</td><td>${RxUtils.escapeHtml(e.notes||'—')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">No expenses recorded.</td></tr>'}</tbody></table>`;
    }catch(err){ console.error(err); UI.showToast('Load report failed: '+(err.message||err),'error'); }
  }

  async function loadFinance(){
    try{
      const range = document.getElementById('finance-range').value;
      const { start, end } = getRangeDates(range);
      let salesQuery = supabaseClient.from('sales').select('*, sale_items(cost_price,quantity)').order('created_at',{ascending:false});
      let purchaseQuery = supabaseClient.from('purchases').select('*').order('purchase_date',{ascending:false});
      let paymentQuery = supabaseClient.from('supplier_payments').select('*').order('payment_date',{ascending:false});
      let expenseQuery = supabaseClient.from('expenses').select('*').order('expense_date',{ascending:false});
      if(start && end){
        salesQuery = salesQuery.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
        purchaseQuery = purchaseQuery.gte('purchase_date', start.toISOString().slice(0,10)).lte('purchase_date', end.toISOString().slice(0,10));
        paymentQuery = paymentQuery.gte('payment_date', start.toISOString().slice(0,10)).lte('payment_date', end.toISOString().slice(0,10));
        expenseQuery = expenseQuery.gte('expense_date', start.toISOString().slice(0,10)).lte('expense_date', end.toISOString().slice(0,10));
      }
      const [salesRes, purchaseRes, paymentRes, expenseRes] = await Promise.all([salesQuery, purchaseQuery, paymentQuery, expenseQuery]);
      if(salesRes.error) throw salesRes.error;
      if(purchaseRes.error) throw purchaseRes.error;
      if(paymentRes.error) throw paymentRes.error;
      if(expenseRes.error) throw expenseRes.error;

      const sales = salesRes.data || [];
      const purchases = purchaseRes.data || [];
      const payments = paymentRes.data || [];
      const expenses = expenseRes.data || [];
      const totalSales = sales.reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0);
      const cogs = sales.reduce((sum, sale) => sum + (sale.sale_items||[]).reduce((itemSum, item) => itemSum + Number(item.cost_price || 0) * Number(item.quantity || 0), 0), 0);
      const grossProfit = totalSales - cogs;
      const totalExpenses = expenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
      const netProfit = grossProfit - totalExpenses;
      const purchaseTotal = purchases.reduce((sum, purchase) => sum + Number(purchase.total_amount || 0), 0);
      const payables = purchases.reduce((sum, purchase) => sum + Number(purchase.balance_due || 0), 0);
      const paymentTotal = payments.reduce((sum, pay) => sum + Number(pay.amount || 0), 0);

      document.getElementById('fin-expense-total').textContent = RxUtils.formatCurrency(totalExpenses);
      document.getElementById('fin-purchase-total').textContent = RxUtils.formatCurrency(purchaseTotal);
      document.getElementById('fin-payable-total').textContent = RxUtils.formatCurrency(payables);
      document.getElementById('fin-supplier-payments').textContent = RxUtils.formatCurrency(paymentTotal);

      if(window.charts && window.charts.financials){
        window.charts.financials.data.datasets[0].data = [totalSales, purchaseTotal, totalExpenses, payables];
        window.charts.financials.update();
      }

      document.getElementById('expenses-table').innerHTML = `<table><thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Notes</th></tr></thead><tbody>${(expenses||[]).map(e=>`<tr><td>${RxUtils.escapeHtml(e.expense_date)}</td><td>${RxUtils.escapeHtml(e.category)}</td><td class="mono">Rs ${Number(e.amount).toFixed(2)}</td><td>${RxUtils.escapeHtml(e.notes||'—')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">No expenses recorded.</td></tr>'}</tbody></table>`;
    }catch(err){ console.error(err); UI.showToast('Load finance failed: '+(err.message||err),'error'); }
  }

  async function saveExpense(e){
    e.preventDefault();
    try{
      const category = document.getElementById('expense-category').value.trim();
      const amount = Number(document.getElementById('expense-amount').value||0);
      const expenseDate = document.getElementById('expense-date').value || new Date().toISOString().slice(0,10);
      const notes = document.getElementById('expense-notes').value.trim() || null;
      if(!category){ UI.showToast('Expense category is required','error'); return; }
      if(amount <= 0){ UI.showToast('Amount must be greater than zero','error'); return; }
      const { error } = await supabaseClient.from('expenses').insert([{ category, amount, expense_date: expenseDate, notes, created_by: currentProfile.id }]);
      if(error){ throw error; }
      UI.showToast('Expense recorded successfully','success');
      document.getElementById('expense-form').reset();
      document.getElementById('expense-date').value = new Date().toISOString().slice(0,10);
      await loadFinance();
    }catch(err){ console.error(err); UI.showToast('Save expense failed: '+(err.message||err),'error'); }
  }

  async function loadReturns(){
    try{
      const { data: batches } = await supabaseClient.from('batches').select('*, products(name)').lte('expiry_date', new Date().toISOString().slice(0,10)).gt('quantity', 0);
      document.getElementById('returns-table').innerHTML = `<table><thead><tr><th>Product</th><th>Batch</th><th>Qty</th><th>Expired On</th><th></th></tr></thead><tbody>${(batches||[]).map(b=>`<tr><td>${RxUtils.escapeHtml(b.products ? b.products.name : '—')}</td><td class="mono">${RxUtils.escapeHtml(b.batch_number)}</td><td>${b.quantity}</td><td>${b.expiry_date}</td><td><button class="btn btn-danger btn-sm" data-return="${b.id}" data-product="${b.product_id}" data-qty="${b.quantity}">Mark Returned</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">No expired stock right now.</td></tr>'}</tbody></table>`;
      document.querySelectorAll('[data-return]').forEach(btn=>btn.addEventListener('click', ()=>{ markReturned(btn.getAttribute('data-return'), btn.getAttribute('data-product'), Number(btn.getAttribute('data-qty'))); }));
      await loadAdjustmentBatches();
    }catch(err){ console.error(err); UI.showToast('Load returns failed: '+(err.message||err),'error'); }
  }

  async function markReturned(batchId, productId, quantity){
    if(!batchId || !productId || !quantity) return;
    const confirmed = await UI.confirm({
      title: 'Confirm return',
      message: `Return ${quantity} unit(s) from the expired batch? This will reduce on-hand stock.`,
      confirmText: 'Return stock'
    });
    if(!confirmed) return;

    try{
      const { data: batch, error: batchError } = await supabaseClient.from('batches').select('supplier_id').eq('id', batchId).single();
      if(batchError){ throw batchError; }
      const rpcParams = {
        p_supplier_id: batch?.supplier_id || null,
        p_purchase_id: null,
        p_product_id: productId,
        p_batch_id: batchId,
        p_quantity: quantity,
        p_reason: 'Expired stock return',
        p_created_by: currentProfile.id
      };
      const { data, error } = await supabaseClient.rpc('execute_supplier_return', rpcParams);
      if(error){ throw error; }
      UI.showToast('Expired batch marked returned successfully','success');
      await loadReturns();
      await loadInventory();
      await loadDashboard();
    }catch(err){ console.error(err); UI.showToast('Return failed: '+(err.message||err.code||'RPC error'),'error'); }
  }

  async function loadAdjustmentBatches(){
    try{
      const { data: batches, error } = await supabaseClient.from('batches').select('id,batch_number,quantity,products(name)').order('expiry_date',{ascending:true});
      if(error) throw error;
      const select = document.getElementById('adjust-batch');
      if(!select) return;
      select.innerHTML = `<option value="">Select batch</option>` + (batches||[]).map(b=>{
        const productName = b.products ? b.products.name : 'Unknown';
        return `<option value="${b.id}">${RxUtils.escapeHtml(productName)} — ${RxUtils.escapeHtml(b.batch_number)} (${b.quantity}u)</option>`;
      }).join('');
    }catch(err){ console.error(err); UI.showToast('Load adjustment batches failed: '+(err.message||err),'error'); }
  }

  async function applyAdjustment(){
    const batchId = document.getElementById('adjust-batch').value;
    let qty = Number(document.getElementById('adjust-qty').value||0);
    const type = document.getElementById('adjust-type').value;
    const reason = document.getElementById('adjust-reason').value.trim() || `Adjustment: ${type}`;
    const feedback = document.getElementById('adjustment-feedback');
    if(!batchId){ UI.showToast('Select a batch to adjust','error'); return; }
    if(!qty || qty === 0){ UI.showToast('Adjustment quantity must be non-zero','error'); return; }
    if(type === 'damaged_stock' || type === 'lost_stock'){
      qty = -Math.abs(qty);
    }
    const confirmed = await UI.confirm({
      title: 'Apply stock adjustment',
      message: `Change quantity by ${qty > 0 ? '+' : ''}${qty} for the selected batch?`,
      confirmText: 'Apply adjustment'
    });
    if(!confirmed) return;

    try{
      const { data: batch, error: batchError } = await supabaseClient.from('batches').select('product_id').eq('id', batchId).single();
      if(batchError){ throw batchError; }
      const rpcParams = {
        p_batch_id: batchId,
        p_quantity: qty,
        p_adjustment_type: type,
        p_reason: reason,
        p_created_by: currentProfile.id
      };
      const { data, error } = await supabaseClient.rpc('execute_stock_adjustment', rpcParams);
      if(error){ throw error; }
      if(feedback){ feedback.textContent = `Adjustment applied: ${qty > 0 ? '+' : ''}${qty} units.`; }
      UI.showToast('Stock adjustment applied','success');
      await loadAdjustmentBatches();
      await loadInventory();
      await loadDashboard();
    }catch(err){ console.error(err); UI.showToast('Adjustment failed: '+(err.message||err.code||'RPC error'),'error'); if(feedback){ feedback.textContent = 'Adjustment failed. See console.'; } }
  }

  async function fetchSuppliers(){
    const { data, error } = await supabaseClient.from('suppliers').select('*').order('name');
    if(error) throw error;
    suppliers = data || [];
    return suppliers;
  }

  function renderSupplierTable(rows){
    const table = document.getElementById('supplier-table');
    if(!table) return;
    table.innerHTML = `<table><thead><tr><th>Name</th><th>Company</th><th>Phone</th><th>Email</th><th>Status</th><th>Balance</th><th></th></tr></thead><tbody>${(rows||[]).map(s=>`<tr><td>${RxUtils.escapeHtml(s.name)}</td><td>${RxUtils.escapeHtml(s.company_name||'—')}</td><td>${RxUtils.escapeHtml(s.phone||'—')}</td><td>${RxUtils.escapeHtml(s.email||'—')}</td><td>${RxUtils.escapeHtml(s.status)}</td><td class="mono">Rs ${Number(s.current_balance||0).toFixed(2)}</td><td><button class="btn btn-outline btn-sm" data-edit="${s.id}">Edit</button><button class="btn btn-ghost btn-sm" data-view="${s.id}">View</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty-state">No suppliers found.</td></tr>'}</tbody></table>`;
    table.querySelectorAll('[data-edit]').forEach(btn=>btn.addEventListener('click', ()=> editSupplier(btn.getAttribute('data-edit'))));
    table.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click', ()=> showSupplierDetail(btn.getAttribute('data-view'))));
  }

  async function loadSuppliers(){
    try{
      await fetchSuppliers();
      renderSupplierTable(suppliers);
      const filter = document.getElementById('supplier-filter');
      if(filter) filter.value = 'ALL';
      const select = document.getElementById('purchase-supplier');
      if(select){
        select.innerHTML = '<option value="">Select supplier</option>' + suppliers.map(s=>`<option value="${s.id}">${RxUtils.escapeHtml(s.name)}</option>`).join('');
      }
      const historySupplier = document.getElementById('history-supplier');
      if(historySupplier){
        historySupplier.innerHTML = '<option value="ALL">All Suppliers</option>' + suppliers.map(s=>`<option value="${s.id}">${RxUtils.escapeHtml(s.name)}</option>`).join('');
      }
      const search = document.getElementById('supplier-search');
      if(search && !search.__initialized){
        search.addEventListener('input', ()=>{ const filtered = suppliers.filter(s => s.name.toLowerCase().includes(search.value.toLowerCase()) || (s.company_name||'').toLowerCase().includes(search.value.toLowerCase())); renderSupplierTable(filtered); });
        search.__initialized = true;
      }
      const filterEl = document.getElementById('supplier-filter');
      if(filterEl && !filterEl.__initialized){
        filterEl.addEventListener('change', ()=>{ const value = filterEl.value; renderSupplierTable(value==='ALL'? suppliers : suppliers.filter(s => s.status===value)); });
        filterEl.__initialized = true;
      }
      const form = document.getElementById('supplier-form');
      if(form && !form.__initialized){ form.addEventListener('submit', saveSupplier); form.__initialized = true; }
    }catch(err){ console.error(err); UI.showToast('Load suppliers failed: '+(err.message||err),'error'); }
  }

  function resetSupplierForm(){
    const form = document.getElementById('supplier-form');
    if(!form) return;
    form.reset();
    document.getElementById('s-id').value = '';
    document.getElementById('s-opening').value = 0;
    document.getElementById('s-status').value = 'ACTIVE';
  }

  async function saveSupplier(e){
    e.preventDefault();
    try{
      const id = document.getElementById('s-id').value;
      const payload = {
        name: document.getElementById('s-name').value.trim(),
        company_name: document.getElementById('s-company').value.trim() || null,
        phone: document.getElementById('s-phone').value.trim() || null,
        email: document.getElementById('s-email').value.trim() || null,
        address: document.getElementById('s-address').value.trim() || null,
        tax_id: document.getElementById('s-tax').value.trim() || null,
        payment_terms: document.getElementById('s-terms').value.trim() || null,
        opening_balance: Number(document.getElementById('s-opening').value||0),
        status: document.getElementById('s-status').value,
        notes: document.getElementById('s-notes').value.trim() || null,
        updated_at: new Date().toISOString()
      };
      if(!payload.name){ UI.showToast('Supplier name is required','error'); return; }
      let result;
      if(id){
        result = await supabaseClient.from('suppliers').update(payload).eq('id', id);
      } else {
        payload.current_balance = payload.opening_balance;
        payload.created_at = new Date().toISOString();
        result = await supabaseClient.from('suppliers').insert(payload);
      }
      if(result.error){ UI.showToast('Supplier save failed: '+result.error.message,'error'); return; }
      UI.showToast('Supplier saved successfully','success');
      resetSupplierForm();
      await loadSuppliers();
    }catch(err){ console.error(err); UI.showToast('Supplier save failed: '+(err.message||err),'error'); }
  }

  function editSupplier(id){
    const supplier = suppliers.find(s=>s.id===id);
    if(!supplier) return;
    document.getElementById('s-id').value = supplier.id;
    document.getElementById('s-name').value = supplier.name || '';
    document.getElementById('s-company').value = supplier.company_name || '';
    document.getElementById('s-phone').value = supplier.phone || '';
    document.getElementById('s-email').value = supplier.email || '';
    document.getElementById('s-address').value = supplier.address || '';
    document.getElementById('s-tax').value = supplier.tax_id || '';
    document.getElementById('s-terms').value = supplier.payment_terms || '';
    document.getElementById('s-opening').value = supplier.opening_balance || 0;
    document.getElementById('s-status').value = supplier.status || 'ACTIVE';
    document.getElementById('s-notes').value = supplier.notes || '';
  }

  function showSupplierDetail(id){
    const supplier = suppliers.find(s=>s.id===id);
    if(!supplier) return;
    const detail = document.getElementById('supplier-detail');
    if(!detail) return;
    detail.innerHTML = `<div class="panel"><strong>Supplier details</strong><div style="margin-top:12px;display:grid;grid-template-columns:repeat(2,1fr);gap:12px;"><div><strong>Name</strong><div>${RxUtils.escapeHtml(supplier.name)}</div></div><div><strong>Company</strong><div>${RxUtils.escapeHtml(supplier.company_name||'—')}</div></div><div><strong>Phone</strong><div>${RxUtils.escapeHtml(supplier.phone||'—')}</div></div><div><strong>Email</strong><div>${RxUtils.escapeHtml(supplier.email||'—')}</div></div><div><strong>Status</strong><div>${RxUtils.escapeHtml(supplier.status)}</div></div><div><strong>Balance</strong><div class="mono">Rs ${Number(supplier.current_balance||0).toFixed(2)}</div></div></div></div>`;
  }

  async function loadPurchaseForm(){
    try{
      await loadSuppliers();
      if(!purchaseProducts.length){
        const { data: products, error } = await supabaseClient.from('products').select('id,name').order('name');
        if(error) throw error;
        purchaseProducts = products || [];
      }
      const dateInput = document.getElementById('purchase-date');
      if(dateInput) dateInput.value = new Date().toISOString().slice(0,10);
      const form = document.getElementById('purchase-form');
      if(form && !form.__initialized){
        form.addEventListener('submit', savePurchase);
        document.getElementById('add-purchase-item').addEventListener('click', addPurchaseItemRow);
        document.getElementById('purchase-paid').addEventListener('input', calculatePurchaseSummary);
        form.__initialized = true;
      }
      const itemsContainer = document.getElementById('purchase-items');
      if(itemsContainer) itemsContainer.innerHTML = '';
      addPurchaseItemRow();
      calculatePurchaseSummary();
    }catch(err){ console.error(err); UI.showToast('Load purchase form failed: '+(err.message||err),'error'); }
  }

  function createProductOptions(){
    return '<option value="">Select product</option>' + purchaseProducts.map(p => `<option value="${p.id}">${RxUtils.escapeHtml(p.name)}</option>`).join('');
  }

  function addPurchaseItemRow(item={}){
    const container = document.getElementById('purchase-items');
    if(!container) return;
    const row = document.createElement('div');
    row.className = 'panel';
    row.style.padding = '12px';
    row.style.marginBottom = '10px';
    row.innerHTML = `
      <div class="grid grid-2" style="gap:10px;">
        <div class="field"><label>Product</label><select class="purchase-product" required>${createProductOptions()}</select></div>
        <div class="field"><label>Batch Number</label><input class="purchase-batch" required /></div>
      </div>
      <div class="grid grid-3" style="gap:10px;">
        <div class="field"><label>Mfg Date</label><input type="date" class="purchase-mfg" /></div>
        <div class="field"><label>Expiry Date</label><input type="date" class="purchase-expiry" /></div>
        <div class="field"><label>Quantity</label><input type="number" min="0" value="0" class="purchase-qty" required /></div>
      </div>
      <div class="grid grid-3" style="gap:10px;">
        <div class="field"><label>Free Qty</label><input type="number" min="0" value="0" class="purchase-free" /></div>
        <div class="field"><label>Purchase Price</label><input type="number" min="0" step="0.01" value="0" class="purchase-cost" required /></div>
        <div class="field"><label>Selling Price</label><input type="number" min="0" step="0.01" value="0" class="purchase-sell" required /></div>
      </div>
      <div class="grid grid-3" style="gap:10px;">
        <div class="field"><label>Discount</label><input type="number" min="0" step="0.01" value="0" class="purchase-discount" /></div>
        <div class="field"><label>Tax</label><input type="number" min="0" step="0.01" value="0" class="purchase-tax" /></div>
        <div class="field" style="align-self:end;"><button type="button" class="btn btn-danger btn-sm remove-purchase-item">Remove</button></div>
      </div>
    `;
    container.appendChild(row);
    const inputs = row.querySelectorAll('input, select');
    inputs.forEach(input=> input.addEventListener('input', calculatePurchaseSummary));
    const removeBtn = row.querySelector('.remove-purchase-item');
    if(removeBtn){ removeBtn.addEventListener('click', ()=>{ row.remove(); calculatePurchaseSummary(); }); }
    if(item.product_id) row.querySelector('.purchase-product').value = item.product_id;
    if(item.batch_number) row.querySelector('.purchase-batch').value = item.batch_number;
    if(item.manufacturing_date) row.querySelector('.purchase-mfg').value = item.manufacturing_date;
    if(item.expiry_date) row.querySelector('.purchase-expiry').value = item.expiry_date;
    if(item.quantity) row.querySelector('.purchase-qty').value = item.quantity;
    if(item.free_quantity) row.querySelector('.purchase-free').value = item.free_quantity;
    if(item.purchase_price) row.querySelector('.purchase-cost').value = item.purchase_price;
    if(item.selling_price) row.querySelector('.purchase-sell').value = item.selling_price;
    if(item.discount) row.querySelector('.purchase-discount').value = item.discount;
    if(item.tax) row.querySelector('.purchase-tax').value = item.tax;
  }

  function calculatePurchaseSummary(){
    const rows = Array.from(document.querySelectorAll('#purchase-items .panel'));
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let totalAmount = 0;
    rows.forEach(row => {
      const qty = Number(row.querySelector('.purchase-qty').value||0);
      const freeQty = Number(row.querySelector('.purchase-free').value||0);
      const price = Number(row.querySelector('.purchase-cost').value||0);
      const discount = Number(row.querySelector('.purchase-discount').value||0);
      const tax = Number(row.querySelector('.purchase-tax').value||0);
      const lineSubtotal = price * qty;
      subtotal += lineSubtotal;
      totalDiscount += discount;
      totalTax += tax;
      totalAmount += lineSubtotal - discount + tax;
    });
    const paid = Number(document.getElementById('purchase-paid').value||0);
    const balance = Math.max(0, totalAmount - paid);
    document.getElementById('purchase-subtotal').textContent = RxUtils.formatCurrency(subtotal);
    document.getElementById('purchase-total-discount').textContent = RxUtils.formatCurrency(totalDiscount);
    document.getElementById('purchase-total-tax').textContent = RxUtils.formatCurrency(totalTax);
    document.getElementById('purchase-total-amount').textContent = RxUtils.formatCurrency(totalAmount);
    document.getElementById('purchase-balance').textContent = RxUtils.formatCurrency(balance);
    document.getElementById('purchase-item-count').textContent = String(rows.length);
  }

  async function savePurchase(e){
    e.preventDefault();
    try{
      const supplierId = document.getElementById('purchase-supplier').value;
      const invoice = document.getElementById('purchase-invoice').value.trim();
      const purchaseDate = document.getElementById('purchase-date').value;
      const dueDate = document.getElementById('purchase-due').value || null;
      const notes = document.getElementById('purchase-notes').value.trim() || null;
      const paid = Number(document.getElementById('purchase-paid').value||0);
      if(!supplierId){ UI.showToast('Supplier is required','error'); return; }
      if(!invoice){ UI.showToast('Invoice number is required','error'); return; }
      const itemRows = Array.from(document.querySelectorAll('#purchase-items .panel'));
      if(!itemRows.length){ UI.showToast('Add at least one purchase item','error'); return; }
      const items = [];
      for(const row of itemRows){
        const productId = row.querySelector('.purchase-product').value;
        const batchNumber = row.querySelector('.purchase-batch').value.trim();
        const manufacturingDate = row.querySelector('.purchase-mfg').value || null;
        const expiryDate = row.querySelector('.purchase-expiry').value || null;
        const qty = Number(row.querySelector('.purchase-qty').value||0);
        const freeQty = Number(row.querySelector('.purchase-free').value||0);
        const cost = Number(row.querySelector('.purchase-cost').value||0);
        const sell = Number(row.querySelector('.purchase-sell').value||0);
        const discount = Number(row.querySelector('.purchase-discount').value||0);
        const tax = Number(row.querySelector('.purchase-tax').value||0);
        if(!productId){ UI.showToast('Select a product for every item','error'); return; }
        if(!batchNumber){ UI.showToast('Batch number is required for every item','error'); return; }
        if(qty <= 0){ UI.showToast('Quantity must be greater than zero','error'); return; }
        if(cost < 0 || sell < 0){ UI.showToast('Prices cannot be negative','error'); return; }
        if(manufacturingDate && expiryDate && manufacturingDate > expiryDate){ UI.showToast('Expiry must be after manufacturing','error'); return; }
        items.push({
          product_id: productId,
          batch_number: batchNumber,
          manufacturing_date: manufacturingDate,
          expiry_date: expiryDate,
          quantity: qty,
          free_quantity: freeQty,
          purchase_price: cost,
          selling_price: sell,
          discount,
          tax
        });
      }
      const rpcParams = {
        p_supplier_id: supplierId,
        p_invoice_number: invoice,
        p_purchase_date: purchaseDate || new Date().toISOString().slice(0,10),
        p_due_date: dueDate,
        p_amount_paid: paid,
        p_items: items,
        p_notes: notes,
        p_created_by: currentProfile.id
      };
      const { data, error } = await supabaseClient.rpc('execute_purchase', rpcParams);
      if(error){ console.error(error); UI.showToast('Purchase failed: '+(error.message||error.code||'RPC error'),'error'); return; }
      UI.showToast('Purchase completed successfully','success');
      await loadPurchaseForm();
      await loadPurchaseHistory();
    }catch(err){ console.error(err); UI.showToast('Purchase save failed: '+(err.message||err),'error'); }
  }

  async function loadPurchaseHistory(){
    try{
      const supplierFilter = document.getElementById('history-supplier').value;
      const statusFilter = document.getElementById('history-status').value;
      const range = document.getElementById('history-range').value;
      let query = supabase.from('purchases').select('*, suppliers(name)').order('purchase_date',{ascending:false});
      if(supplierFilter && supplierFilter !== 'ALL') query = query.eq('supplier_id', supplierFilter);
      if(statusFilter && statusFilter !== 'ALL') query = query.eq('payment_status', statusFilter);
      const today = new Date();
      if(range === 'TODAY'){
        const start = new Date(today); start.setHours(0,0,0,0);
        query = query.gte('purchase_date', start.toISOString().slice(0,10));
      } else if(range === 'WEEK'){
        const start = new Date(today); start.setDate(today.getDate()-7);
        query = query.gte('purchase_date', start.toISOString().slice(0,10));
      } else if(range === 'MONTH'){
        const start = new Date(today.getFullYear(), today.getMonth(),1);
        query = query.gte('purchase_date', start.toISOString().slice(0,10));
      }
      const { data, error } = await query;
      if(error) throw error;
      const table = document.getElementById('purchase-history-table');
      if(!table) return;
      table.innerHTML = `<table><thead><tr><th>Invoice</th><th>Supplier</th><th>Date</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${(data||[]).map(p=>`<tr><td>${RxUtils.escapeHtml(p.invoice_number)}</td><td>${RxUtils.escapeHtml(p.suppliers?.name||'—')}</td><td>${p.purchase_date}</td><td class="mono">Rs ${Number(p.total_amount||0).toFixed(2)}</td><td class="mono">Rs ${Number(p.amount_paid||0).toFixed(2)}</td><td class="mono">Rs ${Number(p.balance_due||0).toFixed(2)}</td><td>${RxUtils.escapeHtml(p.payment_status)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty-state">No purchases found.</td></tr>'}</tbody></table>`;
    }catch(err){ console.error(err); UI.showToast('Load purchase history failed: '+(err.message||err),'error'); }
  }

  document.addEventListener('DOMContentLoaded', init);
  window.admin = { loadDashboard, loadInventory, loadReport, loadFinance };
})();