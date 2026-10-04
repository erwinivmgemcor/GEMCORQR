// ============================================================
// GEMCOR ERP — Usage Trend & Analytics
// ============================================================

var _trendCharts = {
  monthly: null,
  topItems: null,
  category: null
};

var _trendData = {
  monthly: [],
  topItems: [],
  category: []
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Usage Trend] Initializing...');
  usageTrendCheckHealth();
  usageTrendLoad();
});

async function usageTrendCheckHealth() {
  var badge = document.getElementById('erpHealthBadge');
  if (!badge) return;
  var text = document.getElementById('erpHealthText');
  var dot = badge.querySelector('.dot');
  try {
    var result = await erpHealthCheck();
    if (result.success) {
      dot.className = 'dot dot-ok';
      text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      dot.className = 'dot dot-error';
      text.textContent = 'Offline';
    }
  } catch(err) {
    dot.className = 'dot dot-error';
    text.textContent = 'Error';
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN LOAD
// ═══════════════════════════════════════════════════════════
async function usageTrendLoad() {
  var yearEl = document.getElementById('trendYearFilter');
  var categoryEl = document.getElementById('trendCategoryFilter');
  var year = yearEl ? yearEl.value : '2026';
  var category = categoryEl ? categoryEl.value : '';

  try {
    // Load all three views in parallel
    var [monthlyRes, topItemsRes, categoryRes] = await Promise.all([
      erpFetch('erp_v_monthly_usage', 'select=*&year=eq.' + year + '&order=month.asc'),
      erpFetch('erp_v_top_items', 'select=*&year=eq.' + year + '&order=total_quantity.desc&limit=10'),
      erpFetch('erp_v_category_usage', 'select=*&year=eq.' + year + '&order=total_quantity.desc')
    ]);

    _trendData.monthly = monthlyRes || [];
    _trendData.topItems = topItemsRes || [];
    _trendData.category = categoryRes || [];

    // Populate category filter
    usageTrendPopulateCategoryFilter();

    // Compute KPIs
    usageTrendComputeKPIs();

    // Render charts
    usageTrendRenderMonthlyChart();
    usageTrendRenderTopItemsChart();
    usageTrendRenderCategoryChart();

    // Render table
    usageTrendRenderTable();

    console.log('[Usage Trend] Data loaded:', {
      monthly: _trendData.monthly.length,
      topItems: _trendData.topItems.length,
      category: _trendData.category.length
    });

  } catch(err) {
    console.error('[usageTrendLoad]', err);
    erpUsageToast('Failed to load: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// CATEGORY FILTER
// ═══════════════════════════════════════════════════════════
function usageTrendPopulateCategoryFilter() {
  var sel = document.getElementById('trendCategoryFilter');
  if (!sel) return;

  // Preserve current selection
  var current = sel.value;
  sel.innerHTML = '<option value="">All Categories</option>';

  (_trendData.category || []).forEach(function(c) {
    var opt = document.createElement('option');
    opt.value = c.category;
    opt.textContent = c.category + ' (' + erpNum(c.total_quantity) + ')';
    sel.appendChild(opt);
  });

  sel.value = current;
}

// ═══════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════
function usageTrendComputeKPIs() {
  // Total usage for year
  var totalUsage = 0;
  var totalItems = 0;
  var peakMonth = null;
  var peakQty = 0;

  _trendData.monthly.forEach(function(m) {
    totalUsage += Number(m.total_quantity || 0);
    if (Number(m.total_quantity) > peakQty) {
      peakQty = Number(m.total_quantity);
      peakMonth = m;
    }
  });

  // Unique items (from category sum — approximation)
  _trendData.category.forEach(function(c) {
    totalItems += Number(c.unique_items || 0);
  });

  // Avg per month
  var monthCount = _trendData.monthly.length || 1;
  var avgPerMonth = totalUsage / monthCount;

  // Update DOM
  document.getElementById('trendKpiTotal').textContent = erpNum(totalUsage);
  document.getElementById('trendKpiItems').textContent = erpNum(totalItems);
  document.getElementById('trendKpiAvg').textContent = erpNum(Math.round(avgPerMonth));

  if (peakMonth) {
    document.getElementById('trendKpiPeak').textContent = peakMonth.month_short || ('M' + peakMonth.month);
    document.getElementById('trendKpiPeakSub').textContent = erpNum(peakQty) + ' units';
  } else {
    document.getElementById('trendKpiPeak').textContent = '—';
    document.getElementById('trendKpiPeakSub').textContent = 'No data';
  }
}

// ═══════════════════════════════════════════════════════════
// CHART 1: MONTHLY TREND (Bar Chart)
// ═══════════════════════════════════════════════════════════
function usageTrendRenderMonthlyChart() {
  var canvas = document.getElementById('chartMonthlyTrend');
  if (!canvas) return;
  if (_trendCharts.monthly) _trendCharts.monthly.destroy();

  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var qtyByMonth = {};
  var itemsByMonth = {};

  _trendData.monthly.forEach(function(m) {
    qtyByMonth[m.month] = Number(m.total_quantity || 0);
    itemsByMonth[m.month] = Number(m.unique_items || 0);
  });

  var qtyData = [];
  var itemsData = [];
  for (var i = 1; i <= 12; i++) {
    qtyData.push(qtyByMonth[i] || 0);
    itemsData.push(itemsByMonth[i] || 0);
  }

  _trendCharts.monthly = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Total Quantity',
          data: qtyData,
          backgroundColor: '#1e3a5f',
          borderRadius: 6,
          yAxisID: 'y'
        },
        {
          label: 'Unique Items',
          data: itemsData,
          type: 'line',
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.15)',
          tension: 0.3,
          pointBackgroundColor: '#f59e0b',
          pointRadius: 5,
          borderWidth: 3,
          yAxisID: 'y1',
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 12, boxHeight: 12, padding: 12, font: { size: 11, weight: '600' } }
        },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              if (ctx.dataset.yAxisID === 'y') return 'Qty: ' + erpNum(ctx.parsed.y);
              return 'Items: ' + erpNum(ctx.parsed.y);
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          position: 'left',
          title: { display: true, text: 'Total Quantity', font: { size: 11, weight: '600' } },
          ticks: { callback: function(v) { return erpNum(v); } }
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          title: { display: true, text: 'Unique Items', font: { size: 11, weight: '600' } },
          grid: { drawOnChartArea: false },
          ticks: { callback: function(v) { return erpNum(v); } }
        }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════
// CHART 2: TOP ITEMS (Horizontal Bar)
// ═══════════════════════════════════════════════════════════
function usageTrendRenderTopItemsChart() {
  var canvas = document.getElementById('chartTopItems');
  if (!canvas) return;
  if (_trendCharts.topItems) _trendCharts.topItems.destroy();

  var items = (_trendData.topItems || []).slice(0, 10);
  if (items.length === 0) return;

  var labels = items.map(function(it) { return it.item_code; });
  var data = items.map(function(it) { return Number(it.total_quantity || 0); });
  var descriptions = items.map(function(it) {
    return String(it.description || '').substring(0, 40);
  });

  _trendCharts.topItems = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Total Quantity',
        data: data,
        backgroundColor: '#2e8b57',
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function(ctx) { return ctx[0].label; },
            label: function(ctx) {
              var desc = descriptions[ctx.dataIndex] || '';
              return [desc, 'Qty: ' + erpNum(ctx.parsed.x)];
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { callback: function(v) { return erpNum(v); }, font: { size: 10 } }
        },
        y: { ticks: { font: { size: 10, weight: '600' } } }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════
// CHART 3: CATEGORY USAGE (Doughnut)
// ═══════════════════════════════════════════════════════════
function usageTrendRenderCategoryChart() {
  var canvas = document.getElementById('chartCategoryUsage');
  if (!canvas) return;
  if (_trendCharts.category) _trendCharts.category.destroy();

  var cats = _trendData.category || [];
  if (cats.length === 0) return;

  var labels = cats.map(function(c) { return c.category; });
  var data = cats.map(function(c) { return Number(c.total_quantity || 0); });
  var palette = ['#1e3a5f', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#6b7280'];

  _trendCharts.category = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: palette.slice(0, labels.length),
        borderColor: '#fff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 10, boxHeight: 10, padding: 8, font: { size: 10 } }
        },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0);
              var pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
              return ctx.label + ': ' + erpNum(ctx.parsed) + ' (' + pct + '%)';
            }
          }
        }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════
// TABLE: MONTHLY DETAILS
// ═══════════════════════════════════════════════════════════
function usageTrendRenderTable() {
  var tbody = document.getElementById('trendTableBody');
  if (!tbody) return;

  var months = _trendData.monthly || [];
  if (months.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>No trend data available</td></tr>';
    return;
  }

  document.getElementById('trendTableCount').textContent = months.length + ' months';

  var html = '';
  // Sort by month descending
  months.slice().reverse().forEach(function(m) {
    html += '<tr>' +
      '<td><strong>' + erpEsc(m.month_name || m.month_short) + '</strong> ' +
        '<span class="text-muted small">' + m.year + '</span></td>' +
      '<td class="text-center">' + erpNum(m.unique_items) + '</td>' +
      '<td class="text-end value-cell">' + erpNum(m.total_quantity) + '</td>' +
      '<td class="text-end">' + erpNum(m.avg_per_item) + '</td>' +
      '<td class="text-end">' + erpNum(m.max_single_usage) + '</td>' +
      '<td class="text-end">' + erpNum(m.min_single_usage) + '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function usageTrendClearFilters() {
  document.getElementById('trendYearFilter').value = '2026';
  document.getElementById('trendCategoryFilter').value = '';
  usageTrendLoad();
}

function usageTrendRefresh() {
  erpUsageToast('Refreshing...');
  usageTrendLoad();
  usageTrendCheckHealth();
}

function erpUsageToast(msg) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 2500 }).show();
}

console.log('✅ usage-trend.js loaded');
