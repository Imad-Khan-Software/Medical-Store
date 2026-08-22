// Phase 8 Group 2 — Advanced Analytics Controller
(function(){
  const supabase = window.supabaseClient || window.supabase;
  const UI = window.UI;
  const RxUtils = window.RxUtils;

  const Analytics = {
    async fetchSummary(startDate, endDate) {
      try {
        const { data, error } = await supabase.rpc('get_analytics_sales_summary', {
          start_date: startDate,
          end_date: endDate
        });
        if (error) throw error;
        return data && data[0] ? data[0] : null;
      } catch (err) {
        console.error('Failed to load analytics summary:', err);
        if (UI && UI.showToast) {
          UI.showToast('Could not load sales analytics summary', 'error');
        }
        return null;
      }
    },

    async fetchTopProducts(limit = 10) {
      try {
        const { data, error } = await supabase.rpc('get_inventory_performance', { limit_count: limit });
        if (error) throw error;
        return data || [];
      } catch (err) {
        console.error('Failed to load inventory performance:', err);
        return [];
      }
    },

    exportToCSV(filename, rows) {
      if (!rows || !rows.length) {
        if (UI && UI.showToast) UI.showToast('No data available to export', 'warn');
        return;
      }
      const separator = ',';
      const keys = Object.keys(rows[0]);
      // Cells starting with =, +, -, or @ are treated as formulas by Excel/
      // Google Sheets when the CSV is opened — prefix with a leading single
      // quote (a standard CSV/spreadsheet convention) to force text-only
      // interpretation without changing how the value looks in a normal
      // CSV/text viewer.
      const neutralizeFormula = (str) => /^[=+\-@]/.test(str) ? `'${str}` : str;
      const csvContent =
        keys.join(separator) +
        '\n' +
        rows.map(row => {
          return keys.map(k => {
            let cell = row[k] === null || row[k] === undefined ? '' : row[k];
            cell = cell instanceof Date ? cell.toLocaleString() : cell.toString().replace(/"/g, '""');
            cell = neutralizeFormula(cell);
            if (cell.search(/("|,|\n)/g) >= 0) cell = `"${cell}"`;
            return cell;
          }).join(separator);
        }).join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (UI && UI.showToast) UI.showToast('Report exported successfully', 'success');
    },

    renderDashboard(summary, products) {
      if (!summary) return;
      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      const formatCurr = (RxUtils && RxUtils.formatCurrency) ? RxUtils.formatCurrency : (v => `$${v}`);
      const escapeStr = (RxUtils && RxUtils.escapeHtml) ? RxUtils.escapeHtml : (s => s);

      setEl('rpt-revenue', formatCurr(summary.total_revenue));
      setEl('rpt-cost', formatCurr(summary.total_cost));
      setEl('rpt-profit', formatCurr(summary.gross_profit));
      setEl('rpt-margin', `${summary.profit_margin_pct}%`);
      setEl('rpt-orders', summary.total_orders);
      setEl('rpt-aov', formatCurr(summary.avg_order_value));

      const tbody = document.getElementById('rpt-top-products-body');
      if (tbody) {
        tbody.innerHTML = '';
        products.forEach(p => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${escapeStr(p.product_name)}</td>
            <td>${p.total_qty_sold}</td>
            <td>${formatCurr(p.total_revenue)}</td>
            <td>${p.current_stock}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    }
  };

  window.RxReportsPage = {
    init: async function() {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      const summary = await Analytics.fetchSummary(thirtyDaysAgo.toISOString(), now.toISOString());
      const topProducts = await Analytics.fetchTopProducts(10);
      Analytics.renderDashboard(summary, topProducts);

      const exportBtn = document.getElementById('export-rpt-csv-btn');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => Analytics.exportToCSV(`rxstock_sales_report_${Date.now()}.csv`, topProducts));
      }
    }
  };
})();