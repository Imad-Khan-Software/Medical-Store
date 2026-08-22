// Phase 8 Group 4 — Purchasing & Supplier Management Controller
(function(){
  const supabase = window.supabaseClient || window.supabase;
  const UI = window.UI;
  const RxUtils = window.RxUtils;

  const Purchasing = {
    // ------------------------------------------------------------------------
    // SUPPLIER MANAGEMENT
    // ------------------------------------------------------------------------
    async fetchSuppliers(includeInactive = false) {
      try {
        let query = supabase.from('suppliers').select('*').order('name', { ascending: true });
        if (!includeInactive) query = query.eq('is_active', true);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      } catch (err) {
        console.error('Failed to load suppliers:', err);
        if (UI && UI.showToast) UI.showToast('Could not fetch suppliers', 'error');
        return [];
      }
    },

    async saveSupplier(supplierData) {
      try {
        const payload = {
          name: supplierData.name,
          contact_person: supplierData.contact_person || null,
          phone: supplierData.phone || null,
          email: supplierData.email || null,
          address: supplierData.address || null,
          city: supplierData.city || null,
          tax_id: supplierData.tax_id || null,
          is_active: supplierData.is_active !== undefined ? supplierData.is_active : true
        };

        let result;
        if (supplierData.id) {
          result = await supabase.from('suppliers').update(payload).eq('id', supplierData.id).select();
        } else {
          result = await supabase.from('suppliers').insert([payload]).select();
        }

        if (result.error) throw result.error;
        if (UI && UI.showToast) UI.showToast('Supplier saved successfully', 'success');
        return result.data[0];
      } catch (err) {
        console.error('Error saving supplier:', err);
        if (UI && UI.showToast) UI.showToast(err.message || 'Failed to save supplier', 'error');
        return null;
      }
    },

    async toggleSupplierStatus(supplierId, currentStatus) {
      try {
        const { data, error } = await supabase
          .from('suppliers')
          .update({ is_active: !currentStatus })
          .eq('id', supplierId)
          .select();
        if (error) throw error;
        if (UI && UI.showToast) UI.showToast(`Supplier ${!currentStatus ? 'activated' : 'deactivated'}`, 'success');
        return data[0];
      } catch (err) {
        console.error('Error toggling supplier status:', err);
        if (UI && UI.showToast) UI.showToast('Could not update supplier status', 'error');
        return null;
      }
    },

    // ------------------------------------------------------------------------
    // PURCHASE ORDERS & RECEIVING
    // ------------------------------------------------------------------------
    async createPurchaseOrder(purchaseHeader, items) {
      try {
        if (!items || items.length === 0) {
          if (UI && UI.showToast) UI.showToast('Purchase order must contain at least one item', 'warn');
          return null;
        }

        // 1. Insert Purchase Header
        const { data: poData, error: poError } = await supabase
          .from('purchases')
          .insert([{
            supplier_id: purchaseHeader.supplier_id,
            reference_number: purchaseHeader.reference_number || `PO-${Date.now()}`,
            total_amount: purchaseHeader.total_amount,
            paid_amount: purchaseHeader.paid_amount || 0,
            status: 'Draft',
            payment_method: purchaseHeader.payment_method || 'Bank Transfer',
            notes: purchaseHeader.notes || null,
            created_by: purchaseHeader.user_id
          }])
          .select();

        if (poError) throw poError;
        const purchase = poData[0];

        // 2. Insert Purchase Items
        const itemPayloads = items.map(item => ({
          purchase_id: purchase.id,
          product_id: item.product_id,
          batch_number: item.batch_number,
          quantity: parseInt(item.quantity, 10),
          unit_cost: parseFloat(item.unit_cost),
          subtotal: parseInt(item.quantity, 10) * parseFloat(item.unit_cost),
          expiry_date: item.expiry_date || null
        }));

        const { error: itemsError } = await supabase.from('purchase_items').insert(itemPayloads);
        if (itemsError) throw itemsError;

        if (UI && UI.showToast) UI.showToast('Purchase order created (Draft)', 'success');
        return purchase;
      } catch (err) {
        console.error('Error creating purchase order:', err);
        if (UI && UI.showToast) UI.showToast('Failed to create purchase order', 'error');
        return null;
      }
    },

    async receivePurchaseOrder(purchaseId, userId) {
      try {
        const { data, error } = await supabase.rpc('receive_purchase', {
          p_purchase_id: purchaseId,
          p_user_id: userId
        });
        if (error) throw error;
        if (UI && UI.showToast) UI.showToast('Purchase order received & inventory updated!', 'success');
        return data && data[0] ? data[0] : true;
      } catch (err) {
        console.error('Error receiving purchase:', err);
        if (UI && UI.showToast) UI.showToast(err.message || 'Could not receive purchase order', 'error');
        return null;
      }
    },

    // ------------------------------------------------------------------------
    // SUPPLIER RETURNS
    // ------------------------------------------------------------------------
    async processReturn(supplierId, productId, batchId, quantity, reason, userId) {
      try {
        const { data, error } = await supabase.rpc('process_supplier_return', {
          p_supplier_id: supplierId,
          p_product_id: productId,
          p_batch_id: batchId,
          p_quantity: parseInt(quantity, 10),
          p_reason: reason,
          p_user_id: userId
        });
        if (error) throw error;
        if (UI && UI.showToast) UI.showToast('Supplier return processed successfully', 'success');
        return data && data[0] ? data[0] : true;
      } catch (err) {
        console.error('Error processing supplier return:', err);
        if (UI && UI.showToast) UI.showToast(err.message || 'Supplier return failed', 'error');
        return null;
      }
    },

    // ------------------------------------------------------------------------
    // PURCHASING ANALYTICS
    // ------------------------------------------------------------------------
    async fetchPurchasingMetrics() {
      try {
        const { data, error } = await supabase.rpc('get_purchasing_summary_metrics');
        if (error) throw error;
        return data && data[0] ? data[0] : null;
      } catch (err) {
        console.error('Failed to load purchasing metrics:', err);
        return null;
      }
    }
  };

  window.RxPurchasing = {
    init: async function() {
      const metrics = await Purchasing.fetchPurchasingMetrics();
      if (metrics) {
        const setEl = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.textContent = val;
        };
        const formatCurr = (RxUtils && RxUtils.formatCurrency) ? RxUtils.formatCurrency : (v => `$${v}`);
        setEl('pur-metric-total-suppliers', metrics.total_suppliers || 0);
        setEl('pur-metric-active-suppliers', metrics.active_suppliers || 0);
        setEl('pur-metric-total-purchases', metrics.total_purchases_count || 0);
        setEl('pur-metric-total-spent', formatCurr(metrics.total_spent));
        setEl('pur-metric-outstanding', formatCurr(metrics.outstanding_balance));
        setEl('pur-metric-returns', metrics.total_returns_count || 0);
      }
    },
    fetchSuppliers: Purchasing.fetchSuppliers,
    saveSupplier: Purchasing.saveSupplier,
    toggleSupplierStatus: Purchasing.toggleSupplierStatus,
    createPurchaseOrder: Purchasing.createPurchaseOrder,
    receivePurchaseOrder: Purchasing.receivePurchaseOrder,
    processReturn: Purchasing.processReturn,
    fetchPurchasingMetrics: Purchasing.fetchPurchasingMetrics
  };
})();