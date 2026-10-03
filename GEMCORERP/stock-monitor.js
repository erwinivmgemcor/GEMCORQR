// ============================================================
// GEMCOR ERP — Stock Monitor Logic
// ============================================================

var _erpAllItems = [];
var _erpFilteredItems = [];
var _erpCurrentPage = 1;
var _erpPageSize = 50;
var _erpCharts = { category: null, abc: null, movement: null };
var _erpSearchTimer = null;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[ERP] Stock Monitor initializing...');
  erpCheckHealth();
  erpLoadDashboard();
});

async function erpCheckHealth() {
  var badge = document.getElementById('erpHealthBadge');
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

async function erpLoadDashboard() {
  // Load all sections in parallel
  await Promise.all([
    erpLoadSummary(),
    erpLoadCharts(),
    erpLoadItems(),
    erpLoadFilterOptions()
  ]);
}

// ═══════════════════════════════════════════════════════════
// KPI SUMMARY
// ═══════════════════════════════════════════════════════════
async function erpLoadSummary() {
  var result = await erpGetStockSummary();
  if (!result.success) {
    console.warn('[ERP] Summary failed:', result.error);
    return;
  }
  
  var s = result.summary || {};
  document.getElementById('kpiTotalItems').textContent = erpNum(s.total_items);
  document.getElementById('kpiStockValue').textContent = erpPeso(s.total_stock_value);
  document.getElementById('kpiBelowReorder').textContent = erpNum(s.below_reorder);
  document.getElementById('kpiZeroStock').textContent = erpNum(s.zero_stock_items);
  
  var subEl = document.getElementById('kpiTotalItemsSub');
  if (subEl) {
    var withStock = s.active_items || 0;
    subEl.textContent = withStock + ' with stock';
  }
}

// ═══════════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════════
async function erpLoadCharts() {
  var result = await erpGetCategoryStats();
  if (!result.success) return;
  
  erpRenderCategoryChart(result.byCategory || {});
  erpRenderAbcChart(result.byABC || {});
  erpRenderMovementChart(result.byMovement || {});
}

function erpRenderCategoryChart(byCategory) {
  var canvas = document.getElementById('chartCategory');
  if (!canvas) return;
  if (_erpCharts.category) { _erpCharts.category.destroy(); }
  
  // Sort by value, take top 8
  var entries = Object.keys(byCategory)
    .map(function(k) { return { label: k, value: byCategory[k].value, count: byCategory[k].count }; })
    .sort(function(a, b) { return b.value - a.value; });
  
  if (entries.length === 0) return;
  
  var top = entries.slice(0, 8);
  var others = entries.slice(8);
  if (others.length > 0) {
    var otherVal = others.reduce(function(s, e) { return s + e.value; }, 0);
    var otherCount = others.reduce(function(s, e) { return s + e.count; }, 0);
    top.push({ label: 'Others (' + others.length + ')', value: otherVal, count: otherCount });
  }
  
  var palette = ['#1e3a5f','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#6b7280'];
  
  _erpCharts.category = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: top.map(function(e) { return e.label; }),
      datasets: [{
        data: top.map(function(e) { return e.value; }),
        backgroundColor: palette.slice(0, top.length),
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
              return ctx.label + ': ' + erpPeso(ctx.parsed);
            }
          }
        }
      }
    }
  });
}

function erpRenderAbcChart(byABC) {
  var canvas = document.getElementById('chartABC');
  if (!canvas) return;
  if (_erpCharts.abc) { _erpCharts.abc.destroy(); }
  
  var labels = ['Class A', 'Class B', 'Class C'];
  var values = [byABC.A || 0, byABC.B || 0, byABC.C || 0];
  var colors = ['#dc3545', '#f59e0b', '#6c757d'];
  
  _erpCharts.abc = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Value',
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
        x: { ticks: { font: { size: 11 } } }
      }
    }
  });
}

function erpRenderMovementChart(byMovement) {
  var canvas = document.getElementById('chartMovement');
  if (!canvas) return;
  if (_erpCharts.movement) { _erpCharts.movement.destroy(); }
  
  var entries = Object.keys(byMovement)
    .map(function(k) { return { label: k, value: byMovement[k] }; })
    .sort(function(a, b) { return b.value - a.value; });
  
  if (entries.length === 0) return;
  
  var colorMap = {
    'FAST MOVING': '#10b981',
    'MODERATE MOVING': '#06b6d4',
    'SLOW MOVING': '#f59e0b',
    'NO MOVEMENT': '#6b7280',
    'UNCLASSIFIED': '#9ca3af'
  };
  
  _erpCharts.movement = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: entries.map(function(e) { return e.label; }),
      datasets: [{
        data: entries.map(function(e) { return e.value; }),
        backgroundColor: entries.map(function(e) { return colorMap[e.label] || '#6b7280'; }),
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
            label: function(ctx) { return ctx.parsed.x + ' items'; }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 100, font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════
// ITEMS TABLE
// ═══════════════════════════════════════════════════════════
async function erpLoadItems() {
  var tbody = document.getElementById('erpTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="10" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading inventory...</div></td></tr>';
  
  var filters = {
    category: document.getElementById('erpCategoryFilter').value,
    location: document.getElementById('erpLocationFilter').value,
    movement: document.getElementById('erpMovementFilter').value,
    abc: document.getElementById('erpAbcFilter').value,
    search: document.getElementById('erpSearchInput').value.trim(),
    limit: 5000
  };
  
  var result = await erpGetAllItems(filters);
  
  if (!result.success) {
    tbody.innerHTML = '<tr><td colspan="10" class="erp-empty text-danger">' +
      '<i class="bi bi-exclamation-triangle-fill"></i> ' + erpEsc(result.error) + '</td></tr>';
    return;
  }
  
  _erpAllItems = result.items || [];
  _erpFilteredItems = _erpAllItems.slice();
  _erpCurrentPage = 1;
  erpRenderTable();
}

function erpRenderTable() {
  var tbody = document.getElementById('erpTableBody');
  var total = _erpFilteredItems.length;
  var start = (_erpCurrentPage - 1) * _erpPageSize;
  var end = Math.min(start + _erpPageSize, total);
  var pageItems = _erpFilteredItems.slice(start, end);
  
  document.getElementById('erpTableCount').textContent = total + ' items';
  document.getElementById('erpPageTotal').textContent = total;
  document.getElementById('erpPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('erpPageEnd').textContent = end;
  document.getElementById('erpPageLabel').textContent = 'Page ' + _erpCurrentPage;
  
  document.getElementById('erpBtnPrev').disabled = (_erpCurrentPage <= 1);
  document.getElementById('erpBtnNext').disabled = (end >= total);
  
  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No items match your filters.</td></tr>';
    return;
  }
  
    var html = '';
  pageItems.forEach(function(it) {
    var onHand = Number(it.on_hand || 0);
    var reorder = Number(it.reorder_point || 0);
    var buffer = Number(it.buffer_stock || 0);
    
    var qtyClass = 'qty-ok';
    if (onHand === 0) qtyClass = 'qty-zero';
    else if (onHand <= buffer) qtyClass = 'qty-zero';
    else if (onHand <= reorder) qtyClass = 'qty-low';
    
    var value = onHand * Number(it.unit_cost || 0);
    
    var abcBadge = '';
    if (it.abc_classification) {
      abcBadge = '<span class="abc-badge abc-' + erpEsc(it.abc_classification) + '">' + erpEsc(it.abc_classification) + '</span>';
    }
    
    var movBadge = '';
    if (it.inventory_movement) {
      var m = it.inventory_movement.toUpperCase();
      var mClass = 'mov-none';
      if (m.indexOf('FAST') !== -1) mClass = 'mov-fast';
      else if (m.indexOf('MODERATE') !== -1) mClass = 'mov-mod';
      else if (m.indexOf('SLOW') !== -1) mClass = 'mov-slow';
      var shortLabel = m.replace(' MOVING', '').replace('MOVEMENT', '').trim() || 'N/A';
      movBadge = '<span class="mov-badge ' + mClass + '">' + erpEsc(shortLabel) + '</span>';
    }
    
    // ★ BAGONG DAGDAG: Usage columns
    var activeMo = Number(it.active_consumption_months || 0);
    var aveMo = Number(it.ave_monthly_consumption || 0);
    var aveDay = Number(it.ave_daily_consumption || 0);
    
    // Standard stock badge (4+ months = standard)
    var statusBadge = '';
    if (activeMo >= 4 && aveMo > 0) {
      statusBadge = '<span class="usage-badge usage-standard">STANDARD</span>';
    } else if (activeMo >= 2) {
      statusBadge = '<span class="usage-badge usage-monitor">MONITOR</span>';
    } else if (activeMo >= 1) {
      statusBadge = '<span class="usage-badge usage-new">NEW</span>';
    } else {
      statusBadge = '<span class="usage-badge usage-none">NO USAGE</span>';
    }
    
    html += '<tr onclick="erpShowItemDetails(\'' + erpEsc(it.item_code).replace(/'/g, "\\'") + '\')">' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td class="desc-cell">' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-end ' + qtyClass + '">' + erpNum(onHand) + '</td>' +
      '<td class="text-center">' + erpEsc(it.base_unit || '') + '</td>' +
      '<td class="text-end">' + erpPeso(it.unit_cost) + '</td>' +
      '<td class="text-end value-cell">' + erpPeso(value) + '</td>' +
      '<td class="text-center usage-cell">' + activeMo + '</td>' +     // ★ BAGO
      '<td class="text-end usage-cell">' + erpNum(aveMo) + '</td>' +    // ★ BAGO
      '<td class="text-end usage-cell">' + erpNum(aveDay) + '</td>' +   // ★ BAGO
      '<td class="text-center">' + statusBadge + '</td>' +              // ★ BAGO
      '<td class="text-center">' + abcBadge + '</td>' +
      '<td class="text-center">' + movBadge + '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

function erpPagePrev() {
  if (_erpCurrentPage > 1) {
    _erpCurrentPage--;
    erpRenderTable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function erpPageNext() {
  var total = _erpFilteredItems.length;
  var maxPage = Math.ceil(total / _erpPageSize);
  if (_erpCurrentPage < maxPage) {
    _erpCurrentPage++;
    erpRenderTable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ═══════════════════════════════════════════════════════════
// SEARCH (debounced)
// ═══════════════════════════════════════════════════════════
function erpOnSearchInput() {
  clearTimeout(_erpSearchTimer);
  _erpSearchTimer = setTimeout(function() {
    erpLoadItems();
  }, 400);
}

function erpClearFilters() {
  document.getElementById('erpSearchInput').value = '';
  document.getElementById('erpCategoryFilter').value = '';
  document.getElementById('erpLocationFilter').value = '';
  document.getElementById('erpMovementFilter').value = '';
  document.getElementById('erpAbcFilter').value = '';
  erpLoadItems();
}

// ═══════════════════════════════════════════════════════════
// FILTER OPTIONS (populate dropdowns)
// ═══════════════════════════════════════════════════════════
async function erpLoadFilterOptions() {
  try {
    var results = await Promise.all([
      erpGetDistinctValues('category'),
      erpGetDistinctValues('location')
    ]);
    
    if (results[0].success) {
      var sel = document.getElementById('erpCategoryFilter');
      results[0].values.forEach(function(v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      });
    }
    
    if (results[1].success) {
      var sel2 = document.getElementById('erpLocationFilter');
      results[1].values.forEach(function(v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel2.appendChild(opt);
      });
    }
  } catch(err) {
    console.warn('[ERP] Filter options load failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════
// ITEM DETAILS MODAL
// ═══════════════════════════════════════════════════════════
async function erpShowItemDetails(itemCode) {
  var modalEl = document.getElementById('erpItemModal');
  if (!modalEl) return;
  
  document.getElementById('erpModalTitle').textContent = itemCode;
  var body = document.getElementById('erpModalBody');
  body.innerHTML = '<div class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading...</div></div>';
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  
  try {
    var detailResult = await erpGetItemDetails(itemCode);
    var movResult = await erpGetItemMovements(itemCode, 20);
    
    if (!detailResult.success) {
      body.innerHTML = '<div class="text-danger">' + erpEsc(detailResult.error) + '</div>';
      return;
    }
    
    var item = detailResult.item;
    var movements = movResult.success ? movResult.movements : [];
    
    var html = '';
    
    // Basic info grid
    html += '<div class="erp-item-detail">';
    html += '<div class="detail-row"><span class="detail-label">Item Code</span><span class="detail-value"><code>' + erpEsc(item.item_code) + '</code></span></div>';
    html += '<div class="detail-row"><span class="detail-label">Category</span><span class="detail-value">' + erpEsc(item.category || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Location</span><span class="detail-value">' + erpEsc(item.location || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Base Unit</span><span class="detail-value">' + erpEsc(item.base_unit || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">On-Hand</span><span class="detail-value">' + erpNum(item.on_hand) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Buffer Stock</span><span class="detail-value">' + erpNum(item.buffer_stock) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Reorder Point</span><span class="detail-value">' + erpNum(item.reorder_point) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Unit Cost</span><span class="detail-value">' + erpPeso(item.unit_cost) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Total Value</span><span class="detail-value">' + erpPeso(Number(item.on_hand || 0) * Number(item.unit_cost || 0)) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">ABC Class</span><span class="detail-value">' + erpEsc(item.abc_classification || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Movement</span><span class="detail-value">' + erpEsc(item.inventory_movement || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Stock Class</span><span class="detail-value">' + erpEsc(item.stock_classification || '—') + '</span></div>';
    html += '</div>';
    
    // Description
    html += '<div class="erp-section-title">Description</div>';
    html += '<div style="padding:12px;background:#f8fafc;border-radius:8px;font-size:0.9rem;">' + erpEsc(item.description || '—') + '</div>';
    
    // Movement history
    if (movements.length > 0) {
      html += '<div class="erp-section-title">Recent Movements (' + movements.length + ')</div>';
      html += '<div class="table-responsive"><table class="table table-sm" style="font-size:0.82rem;">';
      html += '<thead><tr><th>Date</th><th>Type</th><th>Reference</th><th class="text-end">In</th><th class="text-end">Out</th><th class="text-end">Balance</th></tr></thead>';
      html += '<tbody>';
      movements.forEach(function(m) {
        var date = m.transaction_date ? new Date(m.transaction_date).toLocaleDateString() : '—';
        html += '<tr>' +
          '<td>' + erpEsc(date) + '</td>' +
          '<td><span class="badge bg-secondary">' + erpEsc(m.transaction_type) + '</span></td>' +
          '<td><code style="font-size:0.72rem;">' + erpEsc(m.reference_doc || '—') + '</code></td>' +
          '<td class="text-end text-success">' + (Number(m.qty_in) > 0 ? '+' + erpNum(m.qty_in) : '—') + '</td>' +
          '<td class="text-end text-danger">' + (Number(m.qty_out) > 0 ? '−' + erpNum(m.qty_out) : '—') + '</td>' +
          '<td class="text-end"><strong>' + erpNum(m.balance_after) + '</strong></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="erp-section-title">Movements</div>';
      html += '<div class="erp-empty">No movement history yet.</div>';
    }
    
    body.innerHTML = html;
  } catch(err) {
    console.error('[erpShowItemDetails]', err);
    body.innerHTML = '<div class="text-danger">Failed to load: ' + erpEsc(err.message) + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════
// REORDER MODAL
// ═══════════════════════════════════════════════════════════
async function erpShowReorderModal() {
  var modalEl = document.getElementById('erpReorderModal');
  if (!modalEl) return;
  
  var body = document.getElementById('erpReorderBody');
  body.innerHTML = '<div class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading reorder list...</div></div>';
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  
  var result = await erpGetReorderList();
  if (!result.success) {
    body.innerHTML = '<div class="text-danger">' + erpEsc(result.error) + '</div>';
    return;
  }
  
  var items = result.items || [];
  if (items.length === 0) {
    body.innerHTML = '<div class="erp-empty"><i class="bi bi-check-circle fs-1 text-success d-block mb-2"></i>No items need reordering. All stock levels are healthy!</div>';
    return;
  }
  
  var html = '<div class="alert alert-warning small"><i class="bi bi-info-circle me-1"></i>' +
    '<strong>' + items.length + ' items</strong> need replenishment. This is your Purchase Request (PR) list.</div>';
  
  html += '<div class="table-responsive"><table class="erp-reorder-table">';
  html += '<thead><tr>' +
    '<th>Item Code</th><th>Description</th><th>Location</th>' +
    '<th class="text-end">On-Hand</th>' +
    '<th class="text-end">Buffer</th>' +
    '<th class="text-end">Reorder Pt</th>' +
    '<th class="text-center">Suggest Qty</th>' +
    '<th class="text-center">Urgency</th>' +
    '</tr></thead><tbody>';
  
  items.forEach(function(it) {
    html += '<tr>' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td>' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-end text-danger"><strong>' + erpNum(it.on_hand) + '</strong></td>' +
      '<td class="text-end">' + erpNum(it.buffer_stock) + '</td>' +
      '<td class="text-end">' + erpNum(it.reorder_point) + '</td>' +
      '<td class="text-center"><strong>' + erpNum(it.suggested_order_qty) + '</strong></td>' +
      '<td class="text-center"><span class="urgency-' + erpEsc(it.urgency) + '">' + erpEsc(it.urgency) + '</span></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  
  body.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// REFRESH ALL
// ═══════════════════════════════════════════════════════════
async function erpRefreshAll() {
  erpClearCache();
  erpShowToast('Refreshing all data...');
  await erpLoadDashboard();
  erpCheckHealth();
  erpShowToast('✅ Data refreshed');
}

function erpShowToast(msg) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) return;
  document.getElementById('erpToastBody').textContent = msg;
  var toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 2500 });
  toast.show();
}

console.log('✅ stock-monitor.js loaded');
