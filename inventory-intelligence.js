// Phase 8 Group 3 — Inventory Intelligence Controller
(function(){
  const supabase = window.supabaseClient || window.supabase;
  const UI = window.UI;
  const RxUtils = window.RxUtils;

  const InventoryIntelligence = {
    async loadDashboardMetrics() {
      try {
        const { data, error } = await supabase.rpc('get_inventory_dashboard_metrics');
        if (error) throw error;
        if (data && data[0]) {
          this.renderMetrics(data[0]);
        }
      } catch (err) {
        console.error('Failed to load inventory dashboard metrics:', err);
        if (UI && UI.showToast) {
          UI.showToast('Could not refresh inventory intelligence metrics', 'error');
        }
      }
    },

    renderMetrics(m) {
      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      setEl('inv-metric-total-products', m.total_products || 0);
      setEl('inv-metric-total-stock', m.total_stock_units || 0);
      setEl('inv-metric-low-stock', m.low_stock_count || 0);
      setEl('inv-metric-critical-stock', m.critical_stock_count || 0);
      setEl('inv-metric-out-of-stock', m.out_of_stock_count || 0);
      setEl('inv-metric-expiring-soon', m.expiring_soon_count || 0);
      setEl('inv-metric-expired', m.expired_count || 0);
    },

    async getFEFOBatches(productId) {
      try {
        const { data, error } = await supabase.rpc('get_fefo_batches_for_product', {
          target_product_id: productId
        });
        if (error) throw error;
        return data || [];
      } catch (err) {
        console.error('Failed to fetch FEFO batch order:', err);
        return [];
      }
    },

    determineStockStatus(currentQty, minThreshold) {
      const threshold = minThreshold || 10;
      if (currentQty <= 0) return { label: 'Out of Stock', class: 'badge-danger' };
      if (currentQty <= Math.ceil(threshold / 2)) return { label: 'Critical Stock', class: 'badge-critical' };
      if (currentQty <= threshold) return { label: 'Low Stock', class: 'badge-warning' };
      return { label: 'In Stock', class: 'badge-success' };
    }
  };

  window.RxInventoryIntelligence = {
    init: function() {
      InventoryIntelligence.loadDashboardMetrics();
    },
    getFEFOBatches: InventoryIntelligence.getFEFOBatches,
    determineStockStatus: InventoryIntelligence.determineStockStatus
  };
})();