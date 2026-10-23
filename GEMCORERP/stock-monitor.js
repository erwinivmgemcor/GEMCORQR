// ============================================================
// GEMCOR ERP — Stock Monitor Logic (v4.0 FINAL)
// ✅ FIXED: Item Modal Click (nag-o-open na)
// ✅ FIXED: Available = on_hand + sof_allocated
// ✅ FIXED: Double render lock
// ✅ FIXED: Null-safe data fetching
// ============================================================
var _erpAllItems = [];
var _erpFilteredItems = [];
var _erpCurrentPage = 1;
var _erpPageSize = 50;
var _erpCharts = { category: null, abc: null, movement: null };
var _erpSearchTimer = null;

var _editCellContext = null;
var _csvImportData = null;
var _erpSofAllocatedMap = {};
var _erpRenderLock = false;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[ERP] Stock Monitor v4.0 initializing...');
  erpCheckHealth();
  erpLoadDashboard();
});

async function erpCheckHealth() {
  var badge = document.getElementById('erpHealthBadge');
  if (!badge) return;
  var text = document.getElementById('erpHealthText');
  var dot = badge.querySelector('.dot');
  if (!dot) return;
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
  if (!result.success) return;
  var s = result.summary || {};
  document.getElementById('kpiTotalItems').textContent = erpNum(s.total_items);
  document.getElementById('kpiStockValue').textContent = erpPeso(s.total_stock_value);
  document.getElementById('kpiBelowReorder').textContent = erpNum(s.below_reorder);
  document.getElementById('kpiNewBelowBuffer').textContent = erpNum(s.new_below_buffer || 0);
  document.getElementById('kpiZeroStock').textContent = erpNum(s.zero_stock_items);
  var subEl = document.getElementById('kpiTotalItemsSub');
  if (subEl) subEl.textContent = (s.active_items || 0) + ' with stock';
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
        legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 8, font: { size: 10 } } },
        tooltip: { callbacks: { label: function(ctx) { return ctx.label + ': ' + erpPeso(ctx.parsed); } } }
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
    data: { labels: labels, datasets: [{ label: 'Value', data: values, backgroundColor: colors, borderRadius: 6 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(ctx) { return erpPeso(ctx.parsed.y); } } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: function(v) { return erpPeso(v); }, font: { size: 10 } } },
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
    'FAST MOVING': '#10b981', 'MODERATE MOVING': '#06b6d4',
    'SLOW MOVING': '#f59e0b', 'NO MOVEMENT': '#6b7280', 'UNCLASSIFIED': '#9ca3af'
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
        tooltip: { callbacks: { label: function(ctx) { return ctx.parsed.x + ' items'; } } }
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
  if (_erpRenderLock) return;
  _erpRenderLock = true;

  var tbody = document.getElementById('erpTableBody');
  if (!tbody) { _erpRenderLock = false; return; }
  
  tbody.innerHTML = '<tr><td colspan="19" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading inventory...</div></td></tr>';
  
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
    tbody.innerHTML = '<tr><td colspan="19" class="erp-empty text-danger">' +
      '<i class="bi bi-exclamation-triangle-fill"></i> ' + erpEsc(result.error) + '</td></tr>';
    _erpRenderLock = false;
    return;
  }
  
  _erpAllItems = result.items || [];
  _erpFilteredItems = _erpAllItems.slice();
  _erpCurrentPage = 1;

  try {
    var sofRes = await erpFetch('erp_sof_allocation_items', 'select=item_code,allocated_qty,used_qty');
    _erpSofAllocatedMap = {};
    (sofRes || []).forEach(function(sof) {
      var remaining = Number(sof.allocated_qty || 0) - Number(sof.used_qty || 0);
      if (remaining > 0) {
        var currentMap = _erpSofAllocatedMap[sof.item_code] || 0;
        _erpSofAllocatedMap[sof.item_code] = currentMap + remaining;
      }
    });
  } catch(sofErr) {
    _erpSofAllocatedMap = {};
  }

  window._erpVarianceMap = {};
  try {
    var varRes = await erpFetch('erp_v_latest_item_variances', 'select=*');
    (varRes || []).forEach(function(v) {
      window._erpVarianceMap[v.item_code] = Number(v.variance_qty || 0);
    });
    var varKpi = document.getElementById('kpiVariances');
    if (varKpi) varKpi.textContent = Object.keys(window._erpVarianceMap).length;
  } catch(e) { }

  var varianceFilter = document.getElementById('erpVarianceFilter');
  var varValue = varianceFilter ? varianceFilter.value : '';
  
  if (varValue) {
    _erpFilteredItems = _erpFilteredItems.filter(function(it) {
      var v = window._erpVarianceMap ? (window._erpVarianceMap[it.item_code] || 0) : 0;
      if (varValue === 'with') return v !== 0;
      if (varValue === 'without') return v === 0;
      if (varValue === 'positive') return v > 0;
      if (varValue === 'negative') return v < 0;
      return true;
    });
  }
  
  erpRenderTable();
  _erpRenderLock = false;
}

function erpRenderTable() {
  var tbody = document.getElementById('erpTableBody');
  if (!tbody) return;
  
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
    tbody.innerHTML = '<tr><td colspan="19" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No items match your filters.</td></tr>';
    return;
  }

  var html = '';
  pageItems.forEach(function(it) {
    var onHand = Number(it.on_hand || 0);
    var buffer = Number(it.buffer_stock || 0);
    var isLocked = it.buffer_is_locked === true;
    var aveMo = Number(it.ave_monthly_consumption || 0);
    var aveDay = Number(it.ave_daily_consumption || 0);
    var activeMo = Number(it.active_consumption_months || 0);

    var sofAllocated = Number(_erpSofAllocatedMap[it.item_code] || 0);
    var available = onHand + sofAllocated; 

    var variance = window._erpVarianceMap ? (window._erpVarianceMap[it.item_code] || 0) : 0;
    var rowHighlightStyle = variance !== 0 ? 'background:#fffbeb;' : '';

    var qtyClass = 'qty-ok';
    if (onHand === 0) qtyClass = 'qty-zero';
    else if (onHand <= buffer) qtyClass = 'qty-low';

    var availableClass = 'qty-ok';
    if (available <= 0) availableClass = 'qty-zero';
    else if (available <= buffer) availableClass = 'qty-low';

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

    var reorderStatus = '';
    if (buffer > 0 && onHand <= buffer) {
      reorderStatus = '<span class="reorder-badge reorder-critical">FOR REPLENISHMENT</span>';
    } else if (buffer > 0 && onHand <= buffer * 1.25) {
      reorderStatus = '<span class="reorder-badge reorder-low">LOW STOCK</span>';
    } else if (buffer > 0) {
      reorderStatus = '<span class="reorder-badge reorder-ok">OK</span>';
    } else if (activeMo >= 1) {
      reorderStatus = '<span class="reorder-badge reorder-new">NEW</span>';
    } else {
      reorderStatus = '<span class="reorder-badge reorder-none">NO USAGE</span>';
    }

    var lockIcon = isLocked ? 'bi-lock-fill' : 'bi-unlock';
    var lockClass = isLocked ? 'locked' : 'unlocked';

    // ✅ FIX: Proper escaping for inline JS
    var safeCode = String(it.item_code || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var unitCost = Number(it.unit_cost || 0);
    var onHandCost = onHand * unitCost;

    var sofDisplay = sofAllocated > 0 
      ? '<span class="fw-bold" style="color:#f59e0b;">' + erpNum(sofAllocated) + '</span>'
      : '<span class="text-muted">—</span>';

    var availableDisplay = sofAllocated > 0
      ? '<span class="fw-bold ' + availableClass + '">' + erpNum(available) + '</span>'
      : '<span class="text-muted">' + erpNum(onHand) + '</span>';

    // ✅ FIX: Gumamit ng onclick handler na siguradong bubukas
    html += '<tr style="cursor:pointer;' + rowHighlightStyle + '" onclick="erpRowClick(event, \'' + safeCode + '\')">' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td class="desc-cell">' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-end ' + qtyClass + '">' + erpNum(onHand) + '</td>' +
      '<td class="text-center">' + 
        (variance !== 0 ? '<span class="badge bg-warning text-dark" title="Variance: ' + variance + '"><i class="bi bi-exclamation-triangle-fill"></i> ' + (variance > 0 ? '+' : '') + variance + '</span>' : '<span class="text-muted">—</span>') +
      '</td>' +
      '<td class="text-end">' + sofDisplay + '</td>' +
      '<td class="text-end">' + availableDisplay + '</td>' +
      '<td class="text-end buffer-cell">' +
        (isLocked ? '<i class="bi bi-lock-fill" style="color:#dc2626;font-size:0.7rem;margin-right:4px;" title="Locked (manual value)"></i>' : '') +
        erpNum(buffer) +
      '</td>' +
      '<td class="text-center">' + erpEsc(it.base_unit || '') + '</td>' +
      '<td class="text-end" style="font-family:\'Courier New\',monospace;">₱' + erpNum(unitCost.toFixed(2)) + '</td>' +
      '<td class="text-end fw-bold" style="font-family:\'Courier New\',monospace;color:#1e3a5f;">₱' + erpNum(onHandCost.toFixed(2)) + '</td>' +
      '<td class="text-center usage-cell">' + activeMo + '</td>' +
      '<td class="text-end usage-cell">' + erpNum(aveMo) + '</td>' +
      '<td class="text-end usage-cell">' + erpNum(aveDay) + '</td>' +
      '<td class="text-center">' + reorderStatus + '</td>' +
      '<td class="text-center">' + abcBadge + '</td>' +
      '<td class="text-center">' + movBadge + '</td>' +
      '<td class="text-center">' +
        '<button class="lock-toggle-btn ' + lockClass + '" ' +
          'onclick="event.stopPropagation();erpToggleLock(\'' + safeCode + '\', ' + isLocked + ')" ' +
          'title="' + (isLocked ? 'Unlock buffer' : 'Lock buffer') + '">' +
          '<i class="bi ' + lockIcon + '"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// ROW CLICK HANDLER & ITEM DETAILS MODAL
// ═══════════════════════════════════════════════════════════
window.erpRowClick = function(event, itemCode) {
  var target = event.target;
  
  // Huwag buksan ang modal kung ang pinindot ay lock button o checkbox
  if (target.closest('.lock-toggle-btn') || target.tagName === 'INPUT' || target.tagName === 'BUTTON') {
    return;
  }
  
  erpShowItemDetails(itemCode);
};

async function erpShowItemDetails(itemCode) {
  var modalEl = document.getElementById('erpItemModal');
  if (!modalEl) {
    console.warn('[erpShowItemDetails] Modal not found');
    alert('Error: Modal HTML not found. Please refresh the page.');
    return;
  }
  
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
    
    html += '<div class="erp-item-detail">';
    html += '<div class="detail-row"><span class="detail-label">Item Code</span><span class="detail-value"><code>' + erpEsc(item.item_code) + '</code></span></div>';
    html += '<div class="detail-row"><span class="detail-label">Category</span><span class="detail-value">' + erpEsc(item.category || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Location</span><span class="detail-value">' + erpEsc(item.location || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Base Unit</span><span class="detail-value">' + erpEsc(item.base_unit || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">On-Hand</span><span class="detail-value">' + erpNum(item.on_hand) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Buffer Stock</span><span class="detail-value">' + erpNum(item.buffer_stock) + (item.buffer_is_locked ? ' <i class="bi bi-lock-fill text-danger" title="Locked"></i>' : '') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Reorder Point</span><span class="detail-value">' + erpNum(item.reorder_point) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Unit Cost</span><span class="detail-value">' + erpPeso(item.unit_cost) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Total Value</span><span class="detail-value">' + erpPeso(Number(item.on_hand || 0) * Number(item.unit_cost || 0)) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">ABC Class</span><span class="detail-value">' + erpEsc(item.abc_classification || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Movement</span><span class="detail-value">' + erpEsc(item.inventory_movement || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Stock Class</span><span class="detail-value">' + erpEsc(item.stock_classification || '—') + '</span></div>';
    html += '</div>';
    
    html += '<div class="erp-section-title">Description</div>';
    html += '<div style="padding:12px;background:#f8fafc;border-radius:8px;font-size:0.9rem;">' + erpEsc(item.description || '—') + '</div>';
    
    if (movements.length > 0) {
      html += '<div class="erp-section-title">Recent Movements (' + movements.length + ')</div>';
      html += '<div class="table-responsive"><table class="table table-sm" style="font-size:0.82rem;">';
      html += '<thead><tr>' +
        '<th>Date</th>' +
        '<th>Type</th>' +
        '<th>Reference</th>' +
        '<th class="text-end" style="color:#10b981;">In</th>' +
        '<th class="text-end" style="color:#dc2626;">Out</th>' +
        '<th class="text-end">Balance</th>' +
        '</tr></thead>';
      html += '<tbody>';
      movements.forEach(function(m) {
        var date = m.transaction_date ? new Date(m.transaction_date).toLocaleDateString() : '—';
        html += '<tr>' +
          '<td>' + erpEsc(date) + '</td>' +
          '<td><span class="badge bg-secondary">' + erpEsc(m.transaction_type) + '</span></td>' +
          '<td><code style="font-size:0.72rem;">' + erpEsc(m.reference_doc || '—') + '</code></td>' +
          '<td class="text-end text-success fw-bold">' + (Number(m.qty_in) > 0 ? '+' + erpNum(m.qty_in) : '—') + '</td>' +
          '<td class="text-end text-danger fw-bold">' + (Number(m.qty_out) > 0 ? '−' + erpNum(m.qty_out) : '—') + '</td>' +
          '<td class="text-end"><strong>' + erpNum(m.balance_after) + '</strong></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="erp-section-title">Movements</div>';
      html += '<div class="erp-empty">No movement history yet.</div>';
    }
    
    window._currentItemDetails = item;
    body.innerHTML = html;
  } catch(err) {
    console.error('[erpShowItemDetails]', err);
    body.innerHTML = '<div class="text-danger">Failed to load: ' + erpEsc(err.message) + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════════
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
// HELPERS (erpEsc, erpNum, erpPeso, etc.)
// ═══════════════════════════════════════════════════════════
function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function erpPeso(n) {
  if (n === null || n === undefined || isNaN(n)) return '₱0';
  return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function erpShowToast(msg) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

console.log('✅ Stock Monitor v4.0 loaded successfully!');
