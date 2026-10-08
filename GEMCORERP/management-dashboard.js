// ============================================================
// GEMCOR ERP — Management Dashboard
// Real-time inventory analytics with 8 KPIs + 4 charts
// ============================================================

var _mdash = {
  data: null,
  allItems: [],
  filteredItems: [],
  charts: {
    category: null,
    abc: null,
    movement: null,
    topValue: null
  },
  filters: {
    month: 'all',
    category: '',
    stockClass: '',
    location: ''
  },
  refreshTimer: null,
  searchTimer: null,
  REFRESH_INTERVAL: 5 * 60 * 1000  // 5 minutes
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Management Dashboard] Initializing...');

  mdashCheckHealth();
  mdashSetAsOfDate();
  mdashPopulateFilterOptions().then(function() {
    mdashLoad();
  });

  // Attach filter listeners
  document.getElementById('mdashFilterMonth').addEventListener('change', mdashOnFilterChange);
  document.getElementById('mdashFilterCategory').addEventListener('change', mdashOnFilterChange);
  document.getElementById('mdashFilterStockClass').addEventListener('change', mdashOnFilterChange);
  document.getElementById('mdashFilterLocation').addEventListener('change', mdashOnFilterChange);
  document.getElementById('mdashTableSearch').addEventListener('input', mdashOnSearchInput);

  // Auto-refresh
  mdashStartAutoRefresh();
});

// ═══════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════
async function mdashCheckHealth() {
  try {
    var result = await erpHealthCheck();
    var badge = document.getElementById('erpHealthBadge');
    if (!badge) return;
    var text = document.getElementById('erpHealthText');
    var dot = badge.querySelector('.dot');
    if (result.success) {
      dot.className = 'dot dot-ok';
      text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      dot.className = 'dot dot-error';
      text.textContent = 'Offline';
    }
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// AS OF DATE
// ═══════════════════════════════════════════════════════════
function mdashSetAsOfDate() {
  var el = document.getElementById('mdashAsOfDate');
  if (!el) return;
  var now = new Date();
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  el.textContent = months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
}

// ═══════════════════════════════════════════════════════════
// POPULATE FILTERS
// ═══════════════════════════════════════════════════════════
async function mdashPopulateFilterOptions() {
  try {
    var result = await erpGetDashboardFilterOptions();
    if (!result.success) return;

    // Categories
    var catSel = document.getElementById('mdashFilterCategory');
    result.categories.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      catSel.appendChild(opt);
    });

    // Stock Classes
    var classSel = document.getElementById('mdashFilterStockClass');
    result.stockClasses.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      classSel.appendChild(opt);
    });

    // Locations
    var locSel = document.getElementById('mdashFilterLocation');
    result.locations.forEach(function(l) {
      var opt = document.createElement('option');
      opt.value = l;
      opt.textContent = l;
      locSel.appendChild(opt);
    });

    console.log('[Dashboard] Filters populated:', {
      categories: result.categories.length,
      stockClasses: result.stockClasses.length,
      locations: result.locations.length
    });
  } catch(err) {
    console.warn('[Dashboard] Filter populate failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN LOAD
// ═══════════════════════════════════════════════════════════
async function mdashLoad() {
  mdashShowLoading();

  try {
    // Fetch dashboard data
    var data = await erpGetManagementDashboard({
      monthFilter: _mdash.filters.month,
      category: _mdash.filters.category || null,
      stockClass: _mdash.filters.stockClass || null,
      location: _mdash.filters.location || null
    });

    if (!data || !data.success) {
      throw new Error((data && data.error) || 'Dashboard load failed');
    }

    _mdash.data = data;

    // Load detailed items
    await mdashLoadItems();

    // Render everything
    mdashRenderKPIs(data);
    mdashRenderCharts(data);

    console.log('[Dashboard] Loaded successfully');
  } catch(err) {
    console.error('[Dashboard] Load error:', err);
    mdashShowError(err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// LOAD ITEMS (Detailed Table)
// ═══════════════════════════════════════════════════════════
async function mdashLoadItems() {
  try {
    var query = 'select=item_code,description,category,location,base_unit,unit_cost,on_hand,on_hand_cost,abc_classification,inventory_movement,stock_classification,is_active' +
                '&is_active=eq.true&is_deleted=eq.false&order=on_hand_cost.desc&limit=3000';

    if (_mdash.filters.category) {
      query += '&category=eq.' + encodeURIComponent(_mdash.filters.category);
    }
    if (_mdash.filters.stockClass) {
      query += '&stock_classification=eq.' + encodeURIComponent(_mdash.filters.stockClass);
    }
    if (_mdash.filters.location) {
      query += '&location=eq.' + encodeURIComponent(_mdash.filters.location);
    }

    var rows = await erpFetch('erp_items', query);
    _mdash.allItems = rows || [];
    _mdash.filteredItems = _mdash.allItems.slice();
    mdashRenderTable();
  } catch(err) {
    console.error('[Dashboard] Items load error:', err);
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER KPIs
// ═══════════════════════════════════════════════════════════
function mdashRenderKPIs(data) {
  var s = data.summary || {};
  var t = data.turnover || {};
  var a = data.accuracy || {};
  var act = data.activity || {};

  // 1. Total Items
  document.getElementById('mdashKpiTotalItems').textContent = erpNum(s.total_items || 0);
  document.getElementById('mdashKpiTotalItemsSub').textContent = 'Active SKUs';

  // 2. Inventory Value
  document.getElementById('mdashKpiValue').textContent = erpPeso(s.total_value || 0);

  // 3. Accuracy
  var accEl = document.getElementById('mdashKpiAccuracy');
  var accSubEl = document.getElementById('mdashKpiAccuracySub');
  if (a.has_data) {
    accEl.textContent = Number(a.accuracy_pct || 0).toFixed(2) + '%';
    accEl.className = 'mdash-kpi-value kpi-value-sm';
    accSubEl.textContent = 'Count: ' + (a.count_no || '—');
  } else {
    accEl.textContent = 'N/A';
    accEl.className = 'mdash-kpi-value kpi-value-sm kpi-value-na';
    accSubEl.textContent = 'No count session yet';
  }

  // 4. Turnover
  var toEl = document.getElementById('mdashKpiTurnover');
  var toSubEl = document.getElementById('mdashKpiTurnoverSub');
  var turnoverVal = Number(t.turnover_annualized || 0);
  toEl.textContent = turnoverVal > 0 ? turnoverVal.toFixed(2) : '0.00';
  toSubEl.textContent = 'Annualized · ' + (t.days_in_period || 30) + 'd basis';

  // 5. MRR
  document.getElementById('mdashKpiMrr').textContent = erpPeso(act.mrr_value || 0);
  document.getElementById('mdashKpiMrrSub').textContent = (act.mrr_count || 0) + ' docs received';

  // 6. MRIF
  document.getElementById('mdashKpiMrif').textContent = erpPeso(act.mrif_value || 0);
  document.getElementById('mdashKpiMrifSub').textContent = (act.mrif_count || 0) + ' docs issued';

  // 7. Replenishment
  document.getElementById('mdashKpiReplenish').textContent = erpPeso(s.replenishment_value || 0);
  document.getElementById('mdashKpiReplenishSub').textContent = (s.replenishment_count || 0) + ' items below buffer';

  // 8. Out of Stock
  document.getElementById('mdashKpiOutOfStock').textContent = erpNum(s.out_of_stock_count || 0);
}

// ═══════════════════════════════════════════════════════════
// RENDER CHARTS
// ═══════════════════════════════════════════════════════════
function mdashRenderCharts(data) {
  mdashRenderCategoryChart(data.categories || []);
  mdashRenderABCChart(data.abc || []);
  mdashRenderMovementChart(data.movement || []);
  mdashRenderTopValueChart();
}

// ─── Chart 1: Category Value (Doughnut) ───
function mdashRenderCategoryChart(categories) {
  var canvas = document.getElementById('mdashChartCategory');
  if (!canvas) return;

  if (_mdash.charts.category) _mdash.charts.category.destroy();

  // Top 8 + Others
  var sorted = categories.slice().sort(function(a, b) {
    return Number(b.total_value || 0) - Number(a.total_value || 0);
  });
  var top = sorted.slice(0, 8);
  var rest = sorted.slice(8);

  var labels = top.map(function(c) { return c.category; });
  var values = top.map(function(c) { return Number(c.total_value || 0); });

  if (rest.length > 0) {
    var otherVal = rest.reduce(function(s, c) { return s + Number(c.total_value || 0); }, 0);
    labels.push('Others (' + rest.length + ')');
    values.push(otherVal);
  }

  var palette = ['#1e3a5f','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#6b7280'];

  _mdash.charts.category = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
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
          position: 'right',
          labels: { boxWidth: 10, boxHeight: 10, padding: 8, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0);
              var pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
              return ctx.label + ': ' + erpPeso(ctx.parsed) + ' (' + pct + '%)';
            }
          }
        }
      }
    }
  });
}

// ─── Chart 2: ABC Classification (Bar) ───
function mdashRenderABCChart(abc) {
  var canvas = document.getElementById('mdashChartABC');
  if (!canvas) return;

  if (_mdash.charts.abc) _mdash.charts.abc.destroy();

  var order = { A: 0, B: 1, C: 2 };
  var sorted = abc.slice().sort(function(a, b) {
    return (order[a.abc_class] || 99) - (order[b.abc_class] || 99);
  });

  var labels = sorted.map(function(a) { return 'Class ' + a.abc_class; });
  var values = sorted.map(function(a) { return Number(a.total_value || 0); });
  var colors = sorted.map(function(a) {
    if (a.abc_class === 'A') return '#ef4444';
    if (a.abc_class === 'B') return '#f59e0b';
    return '#6b7280';
  });

  _mdash.charts.abc = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) { return erpPeso(ctx.parsed.y); }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(v) { return erpPeso(v); },
            font: { size: 10 }
          }
        },
        x: { ticks: { font: { size: 11, weight: '600' } } }
      }
    }
  });
}

// ─── Chart 3: Movement Classification (Horizontal Bar) ───
function mdashRenderMovementChart(movement) {
  var canvas = document.getElementById('mdashChartMovement');
  if (!canvas) return;

  if (_mdash.charts.movement) _mdash.charts.movement.destroy();

  var labels = movement.map(function(m) { return m.movement; });
  var values = movement.map(function(m) { return Number(m.total_value || 0); });

  var colorMap = {
    'FAST MOVING': '#10b981',
    'MODERATE MOVING': '#06b6d4',
    'SLOW MOVING': '#f59e0b',
    'NO MOVEMENT': '#6b7280',
    'UNCLASSIFIED': '#9ca3af'
  };
  var colors = labels.map(function(l) { return colorMap[l] || '#6b7280'; });

  _mdash.charts.movement = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
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
            label: function(ctx) { return erpPeso(ctx.parsed.x); }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            callback: function(v) { return erpPeso(v); },
            font: { size: 10 }
          }
        },
        y: { ticks: { font: { size: 10, weight: '600' } } }
      }
    }
  });
}

// ─── Chart 4: Top 10 Items by Value (Horizontal Bar) ───
function mdashRenderTopValueChart() {
  var canvas = document.getElementById('mdashChartTopValue');
  if (!canvas) return;

  if (_mdash.charts.topValue) _mdash.charts.topValue.destroy();

  // Get top 10 by on_hand_cost
  var top = _mdash.allItems.slice().sort(function(a, b) {
    return Number(b.on_hand_cost || 0) - Number(a.on_hand_cost || 0);
  }).slice(0, 10);

  var labels = top.map(function(it) { return it.item_code; });
  var values = top.map(function(it) { return Number(it.on_hand_cost || 0); });
  var descriptions = top.map(function(it) {
    return String(it.description || '').substring(0, 40);
  });

  _mdash.charts.topValue = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: '#1e3a5f',
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
              return [desc, 'Value: ' + erpPeso(ctx.parsed.x)];
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            callback: function(v) { return erpPeso(v); },
            font: { size: 10 }
          }
        },
        y: { ticks: { font: { size: 9, weight: '600' } } }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════
// RENDER TABLE
// ═══════════════════════════════════════════════════════════
function mdashRenderTable() {
  var tbody = document.getElementById('mdashTableBody');
  if (!tbody) return;

  var countEl = document.getElementById('mdashTableCount');
  if (countEl) countEl.textContent = 'Showing ' + _mdash.filteredItems.length + ' items';

  if (_mdash.filteredItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="mdash-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>No items match your filters.</td></tr>';
    return;
  }

  // Limit to first 500 for performance
  var itemsToShow = _mdash.filteredItems.slice(0, 500);
  var html = '';

  itemsToShow.forEach(function(it, idx) {
    var onHand = Number(it.on_hand || 0);
    var onHandCost = Number(it.on_hand_cost || 0);
    var unitCost = Number(it.unit_cost || 0);

    var qtyClass = 'qty-ok';
    if (onHand === 0) qtyClass = 'qty-zero';

    var abcBadge = '';
    if (it.abc_classification) {
      abcBadge = '<span class="mdash-badge abc-' + erpEsc(it.abc_classification) + '">' + erpEsc(it.abc_classification) + '</span>';
    }

    var movBadge = '';
    if (it.inventory_movement) {
      var m = String(it.inventory_movement).toUpperCase();
      var mClass = 'mov-none';
      if (m.indexOf('FAST') !== -1) mClass = 'mov-fast';
      else if (m.indexOf('MODERATE') !== -1) mClass = 'mov-mod';
      else if (m.indexOf('SLOW') !== -1) mClass = 'mov-slow';
      var shortLabel = m.replace(' MOVING', '').replace('MOVEMENT', '').trim() || 'N/A';
      movBadge = '<span class="mdash-badge ' + mClass + '">' + erpEsc(shortLabel) + '</span>';
    }

    var statusBadge = '';
    if (onHand === 0) {
      statusBadge = '<span class="mdash-badge abc-A">OUT</span>';
    } else {
      statusBadge = '<span class="mdash-badge mov-fast">OK</span>';
    }

    html += '<tr>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td title="' + erpEsc(it.description || '') + '">' + erpEsc(String(it.description || '—').substring(0, 60)) + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="qty-cell ' + qtyClass + '">' + erpNum(onHand) + '</td>' +
      '<td>' + erpEsc(it.base_unit || '—') + '</td>' +
      '<td class="qty-cell">' + erpPeso(unitCost) + '</td>' +
      '<td class="value-cell">' + erpPeso(onHandCost) + '</td>' +
      '<td style="text-align:center;">' + abcBadge + '</td>' +
      '<td style="text-align:center;">' + movBadge + '</td>' +
      '<td style="text-align:center;">' + statusBadge + '</td>' +
      '</tr>';
  });

  if (_mdash.filteredItems.length > 500) {
    html += '<tr><td colspan="12" style="text-align:center;padding:16px;color:#64748b;">' +
      'Showing first 500 of ' + _mdash.filteredItems.length + ' items. Refine filters for more specific results.' +
      '</td></tr>';
  }

  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════
function mdashOnSearchInput() {
  clearTimeout(_mdash.searchTimer);
  _mdash.searchTimer = setTimeout(function() {
    var term = (document.getElementById('mdashTableSearch').value || '').toLowerCase().trim();
    if (!term) {
      _mdash.filteredItems = _mdash.allItems.slice();
    } else {
      _mdash.filteredItems = _mdash.allItems.filter(function(it) {
        var code = String(it.item_code || '').toLowerCase();
        var desc = String(it.description || '').toLowerCase();
        return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
      });
    }
    mdashRenderTable();
  }, 300);
}

// ═══════════════════════════════════════════════════════════
// FILTER CHANGE
// ═══════════════════════════════════════════════════════════
function mdashOnFilterChange() {
  _mdash.filters.month = document.getElementById('mdashFilterMonth').value;
  _mdash.filters.category = document.getElementById('mdashFilterCategory').value;
  _mdash.filters.stockClass = document.getElementById('mdashFilterStockClass').value;
  _mdash.filters.location = document.getElementById('mdashFilterLocation').value;

  console.log('[Dashboard] Filters changed:', _mdash.filters);
  mdashLoad();
}

// ═══════════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════════
function mdashRefresh() {
  erpShowToast('Refreshing dashboard...', 'info');

  // Clear cache
  _dashboardCache = { data: null, timestamp: 0, ttl: 0 };

  mdashLoad().then(function() {
    mdashCheckHealth();
    erpShowToast('✅ Dashboard refreshed', 'success');
  });
}

// ═══════════════════════════════════════════════════════════
// AUTO REFRESH
// ═══════════════════════════════════════════════════════════
function mdashStartAutoRefresh() {
  if (_mdash.refreshTimer) clearInterval(_mdash.refreshTimer);
  _mdash.refreshTimer = setInterval(function() {
    if (!document.hidden) {
      console.log('[Dashboard] Auto-refresh triggered');
      mdashLoad();
    }
  }, _mdash.REFRESH_INTERVAL);
}

// ═══════════════════════════════════════════════════════════
// EXPORT CSV
// ═══════════════════════════════════════════════════════════
function mdashExportCSV() {
  if (_mdash.filteredItems.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }

  var headers = [
    'Item Code', 'Description', 'Category', 'Location', 'Unit',
    'On-Hand', 'Unit Cost', 'On-Hand Cost', 'ABC', 'Movement', 'Stock Class'
  ];

  var rows = _mdash.filteredItems.map(function(it) {
    return [
      it.item_code || '',
      it.description || '',
      it.category || '',
      it.location || '',
      it.base_unit || '',
      Number(it.on_hand || 0),
      Number(it.unit_cost || 0),
      Number(it.on_hand_cost || 0),
      it.abc_classification || '',
      it.inventory_movement || '',
      it.stock_classification || ''
    ];
  });

  var csv = headers.map(_mdashCsvEsc).join(',') + '\n';
  rows.forEach(function(row) {
    csv += row.map(_mdashCsvEsc).join(',') + '\n';
  });

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Management_Dashboard_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();

  erpShowToast('✅ Exported ' + rows.length + ' items', 'success');
}

function _mdashCsvEsc(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// LOADING / ERROR STATE
// ═══════════════════════════════════════════════════════════
function mdashShowLoading() {
  var ids = ['mdashKpiTotalItems', 'mdashKpiValue', 'mdashKpiAccuracy', 'mdashKpiTurnover',
             'mdashKpiMrr', 'mdashKpiMrif', 'mdashKpiReplenish', 'mdashKpiOutOfStock'];
  ids.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.textContent = '...';
  });
}

function mdashShowError(msg) {
  erpShowToast('Dashboard error: ' + msg, 'danger');
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function erpPeso(n) {
  if (n === null || n === undefined || isNaN(n)) return '₱0';
  return '₱' + Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

// Pause auto-refresh when tab hidden
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    if (_mdash.refreshTimer) {
      clearInterval(_mdash.refreshTimer);
      _mdash.refreshTimer = null;
    }
  } else {
    mdashStartAutoRefresh();
  }
});

console.log('✅ management-dashboard.js loaded');
