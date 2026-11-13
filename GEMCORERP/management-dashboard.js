// ═══════════════════════════════════════════════════════════
// HELPER: COUNT-UP ANIMATION
// ═══════════════════════════════════════════════════════════
function animateValue(el, start, end, duration, isPeso) {
  if (!el) return;
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    // Use easeOutQuart for smooth deceleration
    const easeOut = 1 - Math.pow(1 - progress, 4); 
    const current = Math.floor(easeOut * (end - start) + start);
    
    el.textContent = isPeso ? '₱' + current.toLocaleString() : current.toLocaleString();
    
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      // Ensure final value is exactly the target
      el.textContent = isPeso ? '₱' + end.toLocaleString() : end.toLocaleString();
    }
  };
  window.requestAnimationFrame(step);
}

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
  page: 1,
  pageSize: 200,        // 0 = lahat
  refreshTimer: null,
  searchTimer: null,
  REFRESH_INTERVAL: 5 * 60 * 1000  // 5 minutes
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Management Dashboard] Initializing...');

  mdashInjectStyles();
  mdashRenderActiveFilters();
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
      fromDate: _getDefaultFromDate(_mdash.filters.month),
      toDate: _getDefaultToDate(_mdash.filters.month),
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
    var query = 'select=item_code,description,category,location,base_unit,unit_cost,on_hand,on_hand_cost,abc_classification,inventory_movement,stock_classification,buffer_stock,ave_monthly_consumption,is_active' +
                '&is_active=eq.true&is_deleted=eq.false&order=on_hand_cost.desc,item_code.asc';

    if (_mdash.filters.category) {
      query += '&category=eq.' + encodeURIComponent(_mdash.filters.category);
    }
    if (_mdash.filters.stockClass) {
      query += '&stock_classification=eq.' + encodeURIComponent(_mdash.filters.stockClass);
    }
    if (_mdash.filters.location) {
      query += '&location=eq.' + encodeURIComponent(_mdash.filters.location);
    }

    var rows = await erpFetchAll('erp_items', query);
    _mdash.allItems = rows || [];
    mdashApplySearchFilter();
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
  var elTotalItems = document.getElementById('mdashKpiTotalItems');
  animateValue(elTotalItems, 0, s.total_items || 0, 1000, false);
  document.getElementById('mdashKpiTotalItemsSub').textContent = 'Active SKUs · as of now';

  // 2. Inventory Value
  var elValue = document.getElementById('mdashKpiValue');
  animateValue(elValue, 0, s.total_value || 0, 1500, true);
  mdashSetSibSub(elValue, 'Total on-hand value · as of now');

  // 3. Accuracy
  var accEl = document.getElementById('mdashKpiAccuracy');
  var accSubEl = document.getElementById('mdashKpiAccuracySub');
  if (a.has_data) {
    // Custom animation for percentage
    let start = 0;
    let end = Number(a.accuracy_pct || 0);
    let duration = 1500;
    let startTime = null;
    const step = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      accEl.textContent = (progress * end).toFixed(2) + '%';
      if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);

    accEl.className = 'mdash-kpi-value kpi-value-sm';
    accSubEl.textContent = 'Count: ' + (a.count_no || '—');
  } else {
    accEl.textContent = 'N/A';
    accEl.className = 'mdash-kpi-value kpi-value-sm kpi-value-na';
    accSubEl.textContent = 'No count session yet';
  }

  // 4. Turnover
  mdashRenderTurnoverCard(data);

  // 5. MRR
  var elMrr = document.getElementById('mdashKpiMrr');
  animateValue(elMrr, 0, act.mrr_value || 0, 1200, true);
  document.getElementById('mdashKpiMrrSub').textContent = (act.mrr_count || 0) + ' docs received · ' + mdashPeriodLabel();

  // 6. MRIF
  var elMrif = document.getElementById('mdashKpiMrif');
  animateValue(elMrif, 0, act.mrif_value || 0, 1200, true);
  document.getElementById('mdashKpiMrifSub').textContent = (act.mrif_count || 0) + ' docs issued · ' + mdashPeriodLabel();

  // 7. Replenishment
  var elRep = document.getElementById('mdashKpiReplenish');
  animateValue(elRep, 0, s.replenishment_value || 0, 1200, true);
  document.getElementById('mdashKpiReplenishSub').textContent = (s.replenishment_count || 0) + ' items below buffer · as of now';

  // 8. Out of Stock
  var elOos = document.getElementById('mdashKpiOutOfStock');
  animateValue(elOos, 0, s.out_of_stock_count || 0, 1000, false);
  mdashSetSibSub(elOos, 'Zero on-hand items · as of now');
  
  // Add pulse to out of stock if > 0
  if ((s.out_of_stock_count || 0) > 0) {
    elOos.parentElement.classList.add('alert-pulse');
  }
}
// ═══════════════════════════════════════════════════════════
// RENDER CHARTS
// ═══════════════════════════════════════════════════════════
function mdashRenderCharts(data) {
  mdashRenderCategoryChart(data.categories || []);
  mdashRenderABCChart(data.abc || []);
  mdashRenderMovementChart(data.movement || []);
  mdashRenderTopValueChart();
  if (window.mdashExecRender) mdashExecRender();
}

// ─── Chart 1: Category Value (Doughnut) ───
function mdashRenderCategoryChart(categories) {
  var canvas = document.getElementById('mdashChartCategory');
  if (!canvas) return;

  if (_mdash.charts.category) _mdash.charts.category.destroy();

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
      animation: { duration: 1500, easing: 'easeOutQuart', delay: function(ctx) { return ctx.dataIndex * 100; } }, // ✅ ANIMATION
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
      datasets: [{ data: values, backgroundColor: colors, borderRadius: 6 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 1500, easing: 'easeOutQuart', delay: function(ctx) { return ctx.dataIndex * 100; } }, // ✅ ANIMATION
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(ctx) { return erpPeso(ctx.parsed.y); } } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: function(v) { return erpPeso(v); }, font: { size: 10 } } },
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
    'FAST MOVING': '#10b981', 'MODERATE MOVING': '#06b6d4',
    'SLOW MOVING': '#f59e0b', 'NO MOVEMENT': '#6b7280', 'UNCLASSIFIED': '#9ca3af'
  };
  var colors = labels.map(function(l) { return colorMap[l] || '#6b7280'; });

  _mdash.charts.movement = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 6 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 1500, easing: 'easeOutQuart', delay: function(ctx) { return ctx.dataIndex * 100; } }, // ✅ ANIMATION
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(ctx) { return erpPeso(ctx.parsed.x); } } }
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: function(v) { return erpPeso(v); }, font: { size: 10 } } },
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

  var top = _mdash.allItems.slice().sort(function(a, b) {
    return Number(b.on_hand_cost || 0) - Number(a.on_hand_cost || 0);
  }).slice(0, 10);

  var labels = top.map(function(it) { return it.item_code; });
  var values = top.map(function(it) { return Number(it.on_hand_cost || 0); });
  var descriptions = top.map(function(it) { return String(it.description || '').substring(0, 40); });

  _mdash.charts.topValue = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: labels, datasets: [{ data: values, backgroundColor: '#1e3a5f', borderRadius: 6 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 1500, easing: 'easeOutQuart', delay: function(ctx) { return ctx.dataIndex * 100; } }, // ✅ ANIMATION
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
        x: { beginAtZero: true, ticks: { callback: function(v) { return erpPeso(v); }, font: { size: 10 } } },
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

  var total = _mdash.filteredItems.length;
  var size = _mdash.pageSize > 0 ? _mdash.pageSize : (total || 1);
  var pages = Math.max(1, Math.ceil(total / size));
  if (_mdash.page > pages) _mdash.page = pages;
  if (_mdash.page < 1) _mdash.page = 1;
  var startIdx = (_mdash.page - 1) * size;
  var endIdx = Math.min(startIdx + size, total);

  var countEl = document.getElementById('mdashTableCount');
  if (countEl) {
    countEl.textContent = total === 0 ? 'No items' :
      'Showing ' + erpNum(startIdx + 1) + '–' + erpNum(endIdx) + ' of ' + erpNum(total) + ' items';
  }
  mdashRenderPager(total, pages, startIdx, endIdx);

  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="mdash-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>No items match your filters.</td></tr>';
    return;
  }

  var itemsToShow = _mdash.filteredItems.slice(startIdx, endIdx);
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
      '<td>' + (startIdx + idx + 1) + '</td>' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td title="' + erpEsc(it.description || '') + '">' + erpEsc(String(it.description || '—').substring(0, 60)) + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="qty-cell ' + qtyClass + '">' + erpNum(onHand) + '</td>' +
      '<td>' + erpEsc(it.base_unit || '—') + '</td>' +
      '<td class="qty-cell">' + erpPeso(unitCost) + '</td>' +
      '<td class="value-cell">' + erpPeso(onHandCost) + '</td>' +
      '<td style="text-align:center;">' + erpTurnoverBadge(onHand, it.ave_monthly_consumption) + '</td>' +
      '<td style="text-align:center;">' + erpInventoryRatioBadge(onHand, it.ave_monthly_consumption) + '</td>' +
      '<td style="text-align:center;">' + abcBadge + '</td>' +
      '<td style="text-align:center;">' + movBadge + '</td>' +
      '<td style="text-align:center;">' + statusBadge + '</td>' +
      '</tr>';
  });

  tbody.innerHTML = html;
}

// ─── Pager (Inventory Master) ───
function mdashRenderPager(total, pages, startIdx, endIdx) {
  var host = document.getElementById('mdashPager');
  if (!host) {
    var wrap = document.querySelector('.mdash-table-wrap');
    if (!wrap) return;
    host = document.createElement('div');
    host.id = 'mdashPager';
    host.className = 'mdash-pager';
    wrap.insertAdjacentElement('afterend', host);
  }
  var sizes = [100, 200, 500, 1000, 0];
  var sel = '<label class="mdash-pager-size">Rows per page ' +
    '<select onchange="mdashSetPageSize(this.value)">' +
    sizes.map(function(n) { return '<option value="' + n + '"' + (n === _mdash.pageSize ? ' selected' : '') + '>' + (n === 0 ? 'All' : n) + '</option>'; }).join('') +
    '</select></label>';
  var p = _mdash.page;
  var btn = function(label, target, disabled) {
    return '<button type="button" ' + (disabled ? 'disabled' : 'onclick="mdashGoPage(' + target + ')"') + '>' + label + '</button>';
  };
  host.innerHTML = sel +
    '<span class="mdash-pager-info">' + (total ? 'Page ' + p + ' of ' + pages : '') + '</span>' +
    '<span class="mdash-pager-btns">' +
      btn('« First', 1, p <= 1) + btn('‹ Prev', p - 1, p <= 1) +
      btn('Next ›', p + 1, p >= pages) + btn('Last »', pages, p >= pages) +
    '</span>';
}

window.mdashGoPage = function(n) {
  _mdash.page = Math.max(1, n);
  mdashRenderTable();
  var wrap = document.querySelector('.mdash-table-wrap');
  if (wrap) wrap.scrollTop = 0;
};

window.mdashSetPageSize = function(v) {
  _mdash.pageSize = parseInt(v, 10) || 0;
  _mdash.page = 1;
  mdashRenderTable();
};

// ═══════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════
function mdashApplySearchFilter() {
  var inp = document.getElementById('mdashTableSearch');
  var term = ((inp && inp.value) || '').toLowerCase().trim();
  if (!term) {
    _mdash.filteredItems = _mdash.allItems.slice();
  } else {
    _mdash.filteredItems = _mdash.allItems.filter(function(it) {
      var code = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
    });
  }
}

function mdashOnSearchInput() {
  clearTimeout(_mdash.searchTimer);
  _mdash.searchTimer = setTimeout(function() {
    mdashApplySearchFilter();
    _mdash.page = 1;
    mdashRenderTable();
  }, 300);
}

// ═══════════════════════════════════════════════════════════
// PERIOD LABEL + ACTIVE FILTER BAR (may "back" / clear)
// ═══════════════════════════════════════════════════════════
function mdashPeriodLabel() {
  var m = _mdash.filters.month;
  if (!m || m === 'all') return 'Last 30 days';
  var p = m.split('-');
  var names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return (names[parseInt(p[1], 10) - 1] || p[1]) + ' ' + p[0];
}

function mdashSetSibSub(el, text) {
  if (!el) return;
  var sub = el.nextElementSibling;
  if (sub && sub.classList && sub.classList.contains('mdash-kpi-sub')) sub.textContent = text;
}

function mdashRenderActiveFilters() {
  var host = document.getElementById('mdashActiveFilters');
  if (!host) {
    var bar = document.querySelector('.mdash-filters');
    if (!bar) return;
    host = document.createElement('div');
    host.id = 'mdashActiveFilters';
    host.className = 'mdash-af';
    bar.insertAdjacentElement('afterend', host);
  }
  var f = _mdash.filters;
  var chips = [];
  function chip(label, value, key) {
    return '<span class="mdash-af-chip">' + erpEsc(label) + ': <b>' + erpEsc(value) + '</b>' +
      '<button type="button" title="Alisin ang filter na ito" onclick="mdashClearFilter(\'' + key + '\')">&times;</button></span>';
  }
  if (f.category)   chips.push(chip('Category', f.category, 'category'));
  if (f.stockClass) chips.push(chip('Stock class', f.stockClass, 'stockClass'));
  if (f.location)   chips.push(chip('Location', f.location, 'location'));
  var monthOn = f.month && f.month !== 'all';
  if (monthOn)      chips.push(chip('Period', mdashPeriodLabel(), 'month'));

  if (!chips.length) { host.innerHTML = ''; host.style.display = 'none'; return; }

  host.style.display = 'flex';
  host.innerHTML =
    '<span class="mdash-af-label"><i class="bi bi-funnel-fill"></i> Active filters</span>' + chips.join('') +
    '<button type="button" class="mdash-af-clear" onclick="mdashClearFilter(\'all\')"><i class="bi bi-arrow-counterclockwise me-1"></i>Clear all</button>' +
    (monthOn ? '<div class="mdash-af-note">MRR, MRIF at turnover ay para sa <b>' + erpEsc(mdashPeriodLabel()) + '</b>. ' +
      'Ang stock value, replenishment at out-of-stock ay <b>live balances ngayon</b>, hindi month-end.</div>' : '');
}

window.mdashClearFilter = function(key) {
  var map = { category: ['mdashFilterCategory', ''], stockClass: ['mdashFilterStockClass', ''],
              location: ['mdashFilterLocation', ''], month: ['mdashFilterMonth', 'all'] };
  var keys = key === 'all' ? Object.keys(map) : [key];
  keys.forEach(function(k) {
    var el = document.getElementById(map[k][0]);
    if (el) el.value = map[k][1];
  });
  mdashOnFilterChange();
};

function mdashInjectStyles() {
  if (document.getElementById('mdashExtraCss')) return;
  var st = document.createElement('style');
  st.id = 'mdashExtraCss';
  st.textContent =
    '.mdash-af{display:none;flex-wrap:wrap;align-items:center;gap:8px;margin:-4px 0 16px;padding:10px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px}' +
    '.mdash-af-label{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9a3412}' +
    '.mdash-af-chip{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #fdba74;border-radius:999px;padding:3px 5px 3px 12px;font-size:.8rem;color:#431407}' +
    '.mdash-af-chip button{border:0;background:#fed7aa;color:#9a3412;width:20px;height:20px;border-radius:50%;line-height:1;cursor:pointer;font-size:14px;padding:0}' +
    '.mdash-af-chip button:hover{background:#fb923c;color:#fff}' +
    '.mdash-af-clear{margin-left:auto;border:1px solid #fb923c;background:#fff;color:#c2410c;border-radius:8px;padding:4px 12px;font-size:.8rem;font-weight:600;cursor:pointer}' +
    '.mdash-af-clear:hover{background:#fb923c;color:#fff}' +
    '.mdash-af-note{flex-basis:100%;font-size:.78rem;color:#7c2d12}' +
    '.mdash-pager{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid #e2e8f0;font-size:.82rem;color:#475569}' +
    '.mdash-pager select{margin-left:6px;border:1px solid #cbd5e1;border-radius:8px;padding:3px 8px;font-size:.82rem}' +
    '.mdash-pager-btns{display:inline-flex;gap:6px}' +
    '.mdash-pager button{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:4px 12px;font-size:.8rem;font-weight:600;color:#1e3a5f;cursor:pointer}' +
    '.mdash-pager button:hover:not(:disabled){background:#1e3a5f;color:#fff;border-color:#1e3a5f}' +
    '.mdash-pager button:disabled{opacity:.4;cursor:not-allowed}';
  document.head.appendChild(st);
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
  _mdash.page = 1;
  mdashRenderActiveFilters();
  mdashLoad();
}

// ═══════════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════════
function mdashRefresh() {
  erpShowToast('Refreshing dashboard...', 'info');

  // Clear cache
  _dashboardCache = { data: null, timestamp: 0, ttl: 0 };
  if (window._xd) { _xd.ledger = null; }

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
    'On-Hand', 'Unit Cost', 'On-Hand Cost', 'Ave Monthly Consumption', 'Turnover (x/year)', 'Inventory Ratio (days)', 'ABC', 'Movement', 'Stock Class'
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
      Number(it.ave_monthly_consumption || 0),
      (function() { var t = erpItemTurnover(it.on_hand, it.ave_monthly_consumption); return t.ratio === null ? '' : Number(t.ratio.toFixed(2)); })(),
      (function() { var t = erpItemTurnover(it.on_hand, it.ave_monthly_consumption); return t.days === null ? '' : Math.round(t.days); })(),
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
  var ids = ['mdashKpiTotalItems', 'mdashKpiValue', 'mdashKpiAccuracy', 'mdashKpiTurnover', 'mdashKpiInvRatio',
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

// ═══════════════════════════════════════════════════════════
// ✅ REPLENISHMENT WIDGET
// ═══════════════════════════════════════════════════════════
async function loadReplenishmentWidget() {
  try {
    var rows = await erpFetch('erp_v_reorder_list', 'select=item_code,urgency&limit=5000');
    if (!rows || rows.length === 0) {
      document.getElementById('replenishmentWidget').style.display = 'none';
      return;
    }

    var critical = 0, urgent = 0;
    rows.forEach(function(r) {
      var u = String(r.urgency || '').toUpperCase();
      if (u === 'CRITICAL') critical++;
      else if (u === 'URGENT') urgent++;
    });

    document.getElementById('replenishmentTotal').textContent = rows.length;
    document.getElementById('replenishmentCritical').textContent = critical + ' critical';
    document.getElementById('replenishmentUrgent').textContent = urgent + ' urgent';
    document.getElementById('replenishmentWidget').style.display = 'block';

  } catch(e) {
    console.warn('[Replenishment Widget]', e.message);
  }
}

// Call after dashboard loads
setTimeout(loadReplenishmentWidget, 1500);

console.log('✅ management-dashboard.js loaded');


// ═══════════════════════════════════════════════════════════
// TURNOVER RATIO — card + plain-English explainer
// Bands are rules of thumb. Adjust with management to match company targets.
// ═══════════════════════════════════════════════════════════
var MDASH_TURNOVER_BANDS = window.ERP_TURNOVER_BANDS || [
  { max: 2,        label: 'Very slow', cls: 'danger', meaning: 'Stock sits in the warehouse for most of the year. A lot of cash is tied up.' },
  { max: 4,        label: 'Slow',      cls: 'warn',   meaning: 'Stock moves, but slowly. There is room to reduce over-stocking.' },
  { max: 8,        label: 'Healthy',   cls: 'ok',     meaning: 'Stock moves at a good pace for a manufacturing operation.' },
  { max: Infinity, label: 'Fast',      cls: 'fast',   meaning: 'Stock moves very quickly. Check that buffers are enough to avoid stock-outs.' }
];

function mdashTurnoverBand(v) {
  for (var i = 0; i < MDASH_TURNOVER_BANDS.length; i++) if (v < MDASH_TURNOVER_BANDS[i].max) return { i: i, b: MDASH_TURNOVER_BANDS[i] };
  return { i: 3, b: MDASH_TURNOVER_BANDS[3] };
}

function mdashTurnoverFacts(data) {
  var s = data.summary || {}, t = data.turnover || {}, act = data.activity || {};
  var ratio = Number(t.turnover_annualized || 0);
  var days = Number(t.days_in_period || 30);
  var f = { ratio: ratio, days: days, issued: Number(act.mrif_value || 0), inv: Number(s.total_value || 0), mrifCount: Number(act.mrif_count || 0) };
  f.daysOfStock = ratio > 0 ? 365 / ratio : null;
  var mv = data.movement || [], tot = 0, nm = 0, sl = 0;
  mv.forEach(function(m) {
    var v = Number(m.total_value || 0), k = String(m.movement || '').toUpperCase();
    tot += v; if (k === 'NO MOVEMENT') nm += v; else if (k === 'SLOW MOVING') sl += v;
  });
  f.mvTotal = tot; f.noMove = nm; f.slow = sl;
  var calc = (f.inv > 0 && f.issued > 0) ? (f.issued / f.inv) * (365 / days) : 0;
  f.check = (ratio > 0 && calc > 0 && Math.abs(calc - ratio) / ratio <= 0.15) ? calc : null;
  return f;
}

function mdashRenderTurnoverCard(data) {
  var toEl = document.getElementById('mdashKpiTurnover');
  var subEl = document.getElementById('mdashKpiTurnoverSub');
  var pill = document.getElementById('mdashTurnoverPill');
  if (!toEl) return;
  var f = mdashTurnoverFacts(data);
  _mdash.turnoverFacts = f;
  animateValue(toEl, 0, f.ratio, 1200, false);
  toEl.classList.toggle('has-x', f.ratio > 0);
  subEl.textContent = 'times per year · based on ' + f.days + ' days (' + mdashPeriodLabel() + ')';
  if (f.ratio > 0) {
    var band = mdashTurnoverBand(f.ratio).b;
    pill.innerHTML = '<span class="tp tp-' + band.cls + '">' + band.label + '</span>' +
      '<span class="tp-days">≈ ' + Math.round(f.daysOfStock) + ' days of stock on hand</span>';
  } else {
    pill.innerHTML = '<span class="tp-days">Not enough issuance data in this period</span>';
  }
  mdashRenderInvRatioCard(f);
}

// ═══════════════════════════════════════════════════════════
// INVENTORY RATIO (days of stock on hand) — card + explainer
// Days of stock = 365 ÷ Turnover Ratio = Inventory ÷ average daily usage
// ═══════════════════════════════════════════════════════════
function mdashRenderInvRatioCard(f) {
  var vEl = document.getElementById('mdashKpiInvRatio');
  var sEl = document.getElementById('mdashKpiInvRatioSub');
  var pill = document.getElementById('mdashInvRatioPill');
  if (!vEl) return;
  if (f.daysOfStock) {
    animateValue(vEl, 0, Math.round(f.daysOfStock), 1200, false);
    vEl.classList.add('has-days');
    var band = mdashTurnoverBand(f.ratio).b;
    sEl.textContent = '≈ ' + (f.daysOfStock / 30.4).toFixed(1) + ' months of stock on hand';
    pill.innerHTML = '<span class="tp tp-' + band.cls + '">' + band.label + '</span>' +
      '<span class="tp-days">= 365 ÷ ' + f.ratio.toFixed(1) + '× turnover</span>';
  } else {
    vEl.textContent = '—'; vEl.classList.remove('has-days');
    sEl.textContent = 'days of stock on hand';
    pill.innerHTML = '<span class="tp-days">Not enough issuance data in this period</span>';
  }
}

function mdashShowInventoryRatioInfo() {
  var f = _mdash.turnoverFacts;
  if (!f) return;
  var has = f.ratio > 0 && f.daysOfStock;
  var bi = has ? mdashTurnoverBand(f.ratio) : { i: -1, b: null };
  var d = has ? f.daysOfStock : 0;
  var period = erpEsc(mdashPeriodLabel());
  var pos = 0;
  if (has) pos = d < 46 ? d / 46 * 25 : d < 91 ? 25 + (d - 46) / 45 * 25 : d < 183 ? 50 + (d - 91) / 92 * 25 : Math.min(100, 75 + (d - 183) / 182 * 25);
  var B = MDASH_TURNOVER_BANDS;
  var scale = [ { b: B[3], rng: '< 46 days', idx: 3 }, { b: B[2], rng: '46 – 91 days', idx: 2 }, { b: B[1], rng: '91 – 183 days', idx: 1 }, { b: B[0], rng: '> 183 days', idx: 0 } ];
  var html = '';

  html += '<div class="to-hero blue"><div class="to-hero-n">' + (has ? Math.round(d) + '<small> days</small>' : '—') + '</div>' +
    '<div class="to-hero-t">' + (has
      ? 'In plain words: if we kept using stock at the usual pace and nothing new came in, what we have now would last about <b>' + Math.round(d) + ' days</b> (' + (d / 30.4).toFixed(1) + ' months). ' +
        'Status: <b>' + bi.b.label + '</b>. ' + bi.b.meaning
      : 'Not enough issuance data in this period to compute the Inventory Ratio.') + '</div></div>';

  html += '<div class="to-sec"><h6>The idea in 20 seconds</h6><div class="to-analogy">' +
    'Think of the <b>fuel gauge</b> in a car. If the tank has <b>100 liters</b> and the car uses <b>2 liters a day</b>, the fuel lasts <b>50 days</b>.' +
    '<ul><li>Our warehouse is the <b>tank</b></li><li>Our daily usage is the <b>fuel burned per day</b></li><li>Inventory Ratio is the <b>number of days before the tank is empty</b></li></ul>' +
    '<b>Fewer days = stock moves fast. More days = stock sits in the warehouse and ties up cash.</b></div></div>';

  html += '<div class="to-sec"><h6>How the number is worked out</h6><div class="to-steps">' +
    '<div class="to-step"><div class="num">1</div><div><div class="tt">Start with the Turnover Ratio</div><div class="vv">' + (has ? f.ratio.toFixed(1) + '× per year' : '—') + '</div>' +
    '<div class="dd">How many times a year our stock is used up and refilled (' + period + ', ' + f.days + '-day basis)</div></div></div>' +
    '<div class="to-step"><div class="num">2</div><div><div class="tt">Divide the days in a year by it</div><div class="vv">' + (has ? '365 ÷ ' + f.ratio.toFixed(1) + ' = ' + Math.round(d) + ' days' : '—') + '</div>' +
    '<div class="dd">If stock is refilled ' + (has ? f.ratio.toFixed(1) : 'N') + ' times in 365 days, each "tankful" lasts 365 ÷ ' + (has ? f.ratio.toFixed(1) : 'N') + ' days</div></div></div>' +
    '<div class="to-step result"><div class="num"><i class="bi bi-check-lg"></i></div><div><div class="tt">Result on the dashboard</div><div class="vv">' + (has ? Math.round(d) + ' days (≈ ' + (d / 30.4).toFixed(1) + ' months)' : '—') + '</div></div></div>' +
    '</div><div class="to-note">Same thing, written another way: Inventory ÷ average daily usage.</div></div>';

  html += '<div class="to-sec"><h6>Where are we on the scale?</h6>' +
    '<div class="to-scale">' + (has ? '<div class="to-marker" style="left:' + pos + '%">' + Math.round(d) + ' d</div>' : '') +
    '<span class="s4"></span><span class="s3"></span><span class="s2"></span><span class="s1"></span></div>' +
    '<div class="to-scale-lbl">' + scale.map(function(s) { return '<span class="' + (s.idx === bi.i ? 'cur' : '') + '">' + s.b.label + '<br>' + s.rng + '</span>'; }).join('') + '</div></div>';

  html += '<div class="to-sec"><h6>Turnover and Inventory Ratio side by side</h6>' + mdashRefTable(bi.i, 'Turnover Ratio') +
    '<div class="to-note">These ranges are general rules of thumb. Management can adjust them to match company targets.</div></div>';

  html += '<div class="to-sec"><h6>Is fewer days always better?</h6><div class="to-callout">' +
    'Not always. If stock lasts <b>fewer days than our supplier lead time</b>, we risk running out before the next delivery arrives. ' +
    'Example: if a supplier takes 45 days to deliver but we only have 30 days of stock, production may stop. ' +
    'The goal is a healthy middle: not too many days (cash stuck), not too few (risk of stock-out).</div></div>';

  html += '<div class="to-sec"><h6>See it per item</h6>Stock Monitor and the Inventory Master table below have an <b>Inventory Ratio (days)</b> column for every item. ' +
    'Per item it is: <b>On-Hand ÷ average daily usage</b>. Hover over a value to see the details.</div>';

  html += '<div class="to-sec to-faq"><h6>Common questions</h6>' +
    '<details><summary>What does "No usage" mean in the item table?</summary><div>The item has stock, but no consumption has been recorded, so there is no usage rate to count days from. These are the first items to review.</div></details>' +
    '<details><summary>Why do the item days not add up to this total?</summary><div>This card is based on the system\'s overall turnover. Item columns use each item\'s own average monthly usage and current on-hand. They measure the same idea but are calculated separately, so use the item column to compare items with each other.</div></details>' +
    '<details><summary>Which period is used?</summary><div>The period in the filter at the top (' + period + '), scaled to a full year.</div></details></div>';

  mdashOpenInfoModal('invRatioInfoModal', 'Inventory Ratio: how many days of stock do we have?', 'bi-calendar3', html);
}
window.mdashShowInventoryRatioInfo = mdashShowInventoryRatioInfo;


// ───────── Shared pieces for the two KPI explainers ─────────
function mdashOpenInfoModal(id, title, icon, html) {
  var el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'modal fade to-modal';
    el.tabIndex = -1;
    el.innerHTML = '<div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header"><h5 class="modal-title"><i class="bi ' + icon + ' me-2"></i>' + title + '</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
      '<div class="modal-body"></div>' +
      '<div class="modal-footer"><button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Close</button></div>' +
      '</div></div>';
    document.body.appendChild(el);
  }
  el.querySelector('.modal-body').innerHTML = html;
  bootstrap.Modal.getOrCreateInstance(el).show();
}
function mdashPesoFmt(v) { return (typeof erpPeso === 'function') ? erpPeso(v) : '₱' + Math.round(v).toLocaleString(); }
var MDASH_BAND_COLORS = { danger: '#ef4444', warn: '#f59e0b', ok: '#22c55e', fast: '#3b82f6' };

// Reference table: turnover ↔ days of stock ↔ status. Highlights the current row.
function mdashRefTable(curIdx, firstCol) {
  var B = MDASH_TURNOVER_BANDS;
  var rows = [
    { i: 3, t: '8× or more', d: 'less than 46 days' },
    { i: 2, t: '4× to 8×',   d: '46 to 91 days (1.5 to 3 months)' },
    { i: 1, t: '2× to 4×',   d: '91 to 183 days (3 to 6 months)' },
    { i: 0, t: 'below 2×',   d: 'more than 183 days (over 6 months)' }
  ];
  return '<table class="to-tbl"><thead><tr><th>' + (firstCol || 'Turnover Ratio') + '</th><th>Stock lasts about</th><th>Status</th></tr></thead><tbody>' +
    rows.map(function(r) {
      var b = B[r.i];
      return '<tr class="' + (r.i === curIdx ? 'cur' : '') + '"><td>' + r.t + '</td><td>' + r.d + '</td>' +
        '<td><span class="dot" style="background:' + MDASH_BAND_COLORS[b.cls] + '"></span>' + b.label + (r.i === curIdx ? ' ← we are here' : '') + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function mdashShowTurnoverInfo() {
  var f = _mdash.turnoverFacts;
  if (!f) return;
  var peso = mdashPesoFmt;
  var pct = function(x, y) { return y > 0 ? Math.round(x / y * 100) : 0; };
  var has = f.ratio > 0;
  var bi = has ? mdashTurnoverBand(f.ratio) : { i: -1, b: null };
  var period = erpEsc(mdashPeriodLabel());
  var html = '';

  // ── Hero: the answer first
  html += '<div class="to-hero"><div class="to-hero-n">' + (has ? f.ratio.toFixed(1) + '<small>×</small>' : '—') + '</div>' +
    '<div class="to-hero-t">' + (has
      ? 'In plain words: in a year, we use up and refill our inventory about <b>' + f.ratio.toFixed(1) + ' times</b>. ' +
        'That means our stock lasts around <b>' + Math.round(f.daysOfStock) + ' days</b> (' + (f.daysOfStock / 30.4).toFixed(1) + ' months). ' +
        'Status: <b>' + bi.b.label + '</b>. ' + bi.b.meaning
      : 'Not enough issuance data in this period to compute a turnover ratio.') + '</div></div>';

  // ── The idea
  html += '<div class="to-sec"><h6>The idea in 20 seconds</h6><div class="to-analogy">' +
    'Imagine a shelf that holds <b>100 boxes</b> of an item.' +
    '<ul><li>If we use <b>400 boxes</b> in a year, we refill the shelf <b>4 times</b> → Turnover = <b>4×</b></li>' +
    '<li>If we use only <b>100 boxes</b> in a year, we refill it <b>once</b> → Turnover = <b>1×</b></li>' +
    '<li>If we use <b>nothing</b>, the shelf never gets refilled → Turnover = <b>0×</b></li></ul>' +
    '<b>More refills = stock is moving and our money is working. Few refills = stock is sitting and our money is stuck.</b></div></div>';

  // ── Steps
  html += '<div class="to-sec"><h6>How the number is worked out</h6><div class="to-steps">';
  if (f.check) {
    var raw = f.issued / f.inv;
    html += '<div class="to-step"><div class="num">1</div><div><div class="tt">What went out</div><div class="vv">' + peso(f.issued) + '</div>' +
      '<div class="dd">Value of stock issued to production (MRIF) in ' + period + ' (' + f.days + ' days)' + (f.mrifCount ? ' · ' + f.mrifCount + ' documents' : '') + '</div></div></div>' +
      '<div class="to-step"><div class="num">2</div><div><div class="tt">What we keep in the warehouse</div><div class="vv">' + peso(f.inv) + '</div>' +
      '<div class="dd">Total value of inventory on hand</div></div></div>' +
      '<div class="to-step"><div class="num">3</div><div><div class="tt">How many refills in ' + f.days + ' days?</div><div class="vv">' + peso(f.issued) + ' ÷ ' + peso(f.inv) + ' = ' + raw.toFixed(2) + '</div>' +
      '<div class="dd">Step 1 divided by Step 2</div></div></div>' +
      '<div class="to-step"><div class="num">4</div><div><div class="tt">Scale it to a full year</div><div class="vv">' + raw.toFixed(2) + ' × (365 ÷ ' + f.days + ') ≈ ' + f.check.toFixed(1) + '×</div>' +
      '<div class="dd">So periods of different lengths can be compared fairly</div></div></div>' +
      '<div class="to-step result"><div class="num"><i class="bi bi-check-lg"></i></div><div><div class="tt">Result on the dashboard</div><div class="vv">' + f.ratio.toFixed(1) + '× per year</div></div></div>';
  } else {
    html += '<div class="to-step"><div class="num">1</div><div><div class="tt">What went out</div><div class="dd">Value of stock issued to production (MRIF) in ' + period + ' (' + f.days + ' days)</div></div></div>' +
      '<div class="to-step"><div class="num">2</div><div><div class="tt">What we keep in the warehouse</div><div class="dd">Total value of inventory on hand</div></div></div>' +
      '<div class="to-step"><div class="num">3</div><div><div class="tt">Divide Step 1 by Step 2</div><div class="dd">This gives the number of refills in ' + f.days + ' days</div></div></div>' +
      '<div class="to-step"><div class="num">4</div><div><div class="tt">Scale it to a full year</div><div class="dd">Multiply by 365 ÷ ' + f.days + '</div></div></div>' +
      '<div class="to-step result"><div class="num"><i class="bi bi-check-lg"></i></div><div><div class="tt">Result on the dashboard</div><div class="vv">' + (has ? f.ratio.toFixed(1) + '× per year' : '—') + '</div>' +
      '<div class="dd">Exact figure is calculated by the system.</div></div></div>';
  }
  html += '</div></div>';

  // ── Meaning table
  html += '<div class="to-sec"><h6>What does the number mean?</h6>' + mdashRefTable(bi.i, 'Turnover Ratio') +
    '<div class="to-note">These ranges are general rules of thumb. The right target depends on our products and supplier lead times, and management can adjust them.</div></div>';

  // ── What is pulling it down
  if (f.mvTotal > 0) {
    html += '<div class="to-sec"><h6>What is affecting our number?</h6><div class="to-callout">' +
      '<b>' + pct(f.noMove, f.mvTotal) + '%</b> of our stock value (' + peso(f.noMove) + ') is in items with <b>no movement</b>, and ' +
      '<b>' + pct(f.slow, f.mvTotal) + '%</b> (' + peso(f.slow) + ') is in <b>slow-moving</b> items. ' +
      'Money sitting in items that are not being used is the main reason turnover stays low.</div></div>';
  }

  html += '<div class="to-sec"><h6>What can we do to improve it?</h6><ul class="mb-0">' +
    '<li>Stop or reduce re-ordering of <b>no-movement</b> and <b>slow-moving</b> items.</li>' +
    '<li>Use up, return to supplier, or dispose of stock that is no longer needed.</li>' +
    '<li>Order closer to actual consumption. Review buffer stock and PRF quantities.</li>' +
    '<li>Start with <b>Class A</b> items, since they hold the most value.</li></ul></div>';

  html += '<div class="to-sec to-faq"><h6>Common questions</h6>' +
    '<details><summary>Is a low number always bad?</summary><div>Not always. Some items must stay in stock even if they are rarely used, such as spare parts or safety stock. But a low number is a good reason to review whether we really need that much.</div></details>' +
    '<details><summary>Why is the Turnover column in the item tables different from this card?</summary><div>This card uses the <b>total value issued</b> versus the <b>total inventory value</b>. The item columns use each item\'s <b>average monthly usage × 12 ÷ its current on-hand</b>. Both measure the same idea, but they will not add up exactly. The item column is best for comparing one item against another.</div></details>' +
    '<details><summary>Which period is used?</summary><div>The period in the filter at the top (' + period + '). The result is always scaled to a full year so different periods can be compared.</div></details>' +
    '<details><summary>What is the difference with Inventory Ratio?</summary><div>Same information in a different form. Turnover says <b>how many times a year</b> stock is refilled. Inventory Ratio says <b>how many days</b> the stock will last.</div></details></div>';

  mdashOpenInfoModal('turnoverInfoModal', 'Turnover Ratio: how fast does our inventory move?', 'bi-arrow-repeat', html);
}
window.mdashShowTurnoverInfo = mdashShowTurnoverInfo;
