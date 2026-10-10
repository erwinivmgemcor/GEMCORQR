// ============================================================
// GEMCOR ERP — Stock Monitor Logic (v3)
// Phase 4: Inline Edit + Lock Toggle + CSV Import
// ============================================================

var _erpAllItems = [];
var _erpFilteredItems = [];
var _erpCurrentPage = 1;
var _erpPageSize = 50;
var _erpCharts = { category: null, abc: null, movement: null };
var _erpSearchTimer = null;

// Phase 4 state
var _editCellContext = null;
var _csvImportData = null;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[ERP] Stock Monitor v3 initializing...');
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
  if (subEl) {
    subEl.textContent = (s.active_items || 0) + ' with stock';
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
  var tbody = document.getElementById('erpTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="14" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading inventory...</div></td></tr>';
  
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
    tbody.innerHTML = '<tr><td colspan="14" class="erp-empty text-danger">' +
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
    tbody.innerHTML = '<tr><td colspan="14" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No items match your filters.</td></tr>';
    return;
  }
  
  var html = '';
  pageItems.forEach(function(it) {
    var onHand = Number(it.on_hand || 0);
    var buffer = Number(it.buffer_stock || 0);
    var isLocked = it.buffer_is_locked === true;
    var unitCost = Number(it.unit_cost || 0);
    var aveMo = Number(it.ave_monthly_consumption || 0);
    var aveDay = Number(it.ave_daily_consumption || 0);
    var activeMo = Number(it.active_consumption_months || 0);
    
    var qtyClass = 'qty-ok';
    if (onHand === 0) qtyClass = 'qty-zero';
    else if (onHand <= buffer) qtyClass = 'qty-low';
    
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
    
    // ═══ PHASE 4: Lock icon ═══
    var lockIcon = isLocked ? 'bi-lock-fill' : 'bi-unlock';
    var lockClass = isLocked ? 'locked' : 'unlocked';
    
    // ═══ PHASE 4: Editable cells with onclick ═══
    var safeCode = erpEsc(it.item_code).replace(/'/g, "\\'");
    
    html += '<tr data-item-code="' + erpEsc(it.item_code) + '">' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td class="desc-cell">' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-end ' + qtyClass + ' editable-cell on-hand-cell" ' +
        'onclick="erpOpenEditModal(\'' + safeCode + '\', \'on_hand\')" ' +
        'title="Click to edit">' +
        erpNum(onHand) +
      '</td>' +
      '<td class="text-end buffer-cell editable-cell" ' +
        'onclick="erpOpenEditModal(\'' + safeCode + '\', \'buffer_stock\')" ' +
        'title="Click to edit">' +
        (isLocked ? '<i class="bi bi-lock-fill" style="color:#dc2626;font-size:0.7rem;margin-right:4px;" title="Locked (manual value)"></i>' : '') +
        erpNum(buffer) +
      '</td>' +
      '<td class="text-center">' + erpEsc(it.base_unit || '') + '</td>' +
      '<td class="text-center usage-cell">' + activeMo + '</td>' +
      '<td class="text-end usage-cell">' + erpNum(aveMo) + '</td>' +
      '<td class="text-end usage-cell">' + erpNum(aveDay) + '</td>' +
      '<td class="text-center">' + reorderStatus + '</td>' +
      '<td class="text-center">' + abcBadge + '</td>' +
      '<td class="text-center">' + movBadge + '</td>' +
      '<td class="text-center">' +
        '<button class="lock-toggle-btn ' + lockClass + '" ' +
          'onclick="event.stopPropagation();erpToggleLock(\'' + safeCode + '\', ' + isLocked + ')" ' +
          'title="' + (isLocked ? 'Unlock buffer (auto-recompute enabled)' : 'Lock buffer (manual value)') + '">' +
          '<i class="bi ' + lockIcon + '"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// PHASE 4: INLINE EDIT MODAL
// ═══════════════════════════════════════════════════════════

window.erpOpenEditModal = function(itemCode, fieldName) {
  // Find item in current data
  var item = _erpAllItems.find(function(it) { return it.item_code === itemCode; });
  if (!item) {
    erpShowToast('Item not found', 'warning');
    return;
  }
  
  var fieldLabels = {
    'on_hand': 'On-Hand Quantity',
    'unit_cost': 'Unit Cost (₱)',
    'buffer_stock': 'Buffer Stock'
  };
  
  var currentValues = {
    'on_hand': Number(item.on_hand || 0),
    'unit_cost': Number(item.unit_cost || 0),
    'buffer_stock': Number(item.buffer_stock || 0)
  };
  
  var currentValue = currentValues[fieldName];
  
  // Populate modal
  document.getElementById('editCellItemCode').textContent = item.item_code;
  document.getElementById('editCellFieldName').textContent = fieldLabels[fieldName] || fieldName;
  document.getElementById('editCellCurrentValue').value = currentValue;
  document.getElementById('editCellNewValue').value = currentValue;
  document.getElementById('editCellReason').value = '';
  document.getElementById('editCellWarning').style.display = 'none';
  
  // Store context
  _editCellContext = {
    item: item,
    itemCode: itemCode,
    fieldName: fieldName,
    currentValue: currentValue
  };
  
  // Show modal
  var modalEl = document.getElementById('editCellModal');
  if (!modalEl) {
    erpShowToast('Edit modal not found', 'danger');
    return;
  }
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  
  // Focus on new value
  setTimeout(function() {
    var input = document.getElementById('editCellNewValue');
    if (input) { input.focus(); input.select(); }
  }, 300);
};

window.erpSaveEditedCell = async function() {
  var context = _editCellContext;
  if (!context) return;
  
  var newValue = parseFloat(document.getElementById('editCellNewValue').value);
  var reason = document.getElementById('editCellReason').value.trim();
  
  // Validation
  if (isNaN(newValue) || newValue < 0) {
    erpShowToast('Invalid value (must be ≥ 0)', 'warning');
    return;
  }
  
  if (!reason) {
    erpShowToast('Reason is required', 'warning');
    document.getElementById('editCellReason').focus();
    return;
  }
  
  // Check for large changes (>50% variance)
  var currentValue = context.currentValue;
  var variance = Math.abs(newValue - currentValue);
  var variancePct = currentValue > 0 ? (variance / currentValue) * 100 : (newValue > 0 ? 100 : 0);
  
  if (variancePct > 50 && currentValue !== newValue) {
    var confirmMsg = '⚠️ Large change detected:\n\n' +
      'Item: ' + context.itemCode + '\n' +
      'Field: ' + context.fieldName + '\n' +
      'Current: ' + currentValue + '\n' +
      'New: ' + newValue + '\n' +
      'Variance: ' + variancePct.toFixed(1) + '%\n\n' +
      'Continue?';
    
    if (!confirm(confirmMsg)) return;
  }
  
  // Get editor
  var editedBy = localStorage.getItem('ivm_userFullname') || 
                 localStorage.getItem('ivm_username') || 
                 'WAREHOUSE';
  
  // Call RPC
  try {
    var btn = document.getElementById('btnSaveEditCell');
    var originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';
    
    var res = await fetch(erpUrl('rpc/erp_manual_edit_item'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_item_code: context.itemCode,
        p_field_name: context.fieldName,
        p_new_value: String(newValue),
        p_reason: reason,
        p_edited_by: editedBy
      })
    });
    
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    
    if (data && data.success) {
      // Hide modal
      bootstrap.Modal.getInstance(document.getElementById('editCellModal')).hide();
      
      // Show success
      erpShowToast('✅ ' + context.fieldName + ' updated: ' + data.old_value + ' → ' + newValue, 'success');
      
      // Refresh table
      await erpLoadItems();
      await erpLoadSummary();
      await erpLoadCharts();
      
      // Highlight row
      setTimeout(function() {
        var row = document.querySelector('[data-item-code="' + context.itemCode + '"]');
        if (row) {
          row.classList.add('recently-edited');
          setTimeout(function() { row.classList.remove('recently-edited'); }, 3000);
        }
      }, 500);
      
    } else {
      erpShowToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
    }
    
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    
  } catch(err) {
    console.error('[erpSaveEditedCell]', err);
    erpShowToast('Error: ' + err.message, 'danger');
    
    var btn = document.getElementById('btnSaveEditCell');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Save Changes';
    }
  }
};

// ═══════════════════════════════════════════════════════════
// PHASE 4: LOCK TOGGLE
// ═══════════════════════════════════════════════════════════

window.erpToggleLock = async function(itemCode, currentLockState) {
  var newLockState = !currentLockState;
  var actionText = newLockState ? 'LOCK' : 'UNLOCK';
  
  if (!confirm(actionText + ' buffer stock for ' + itemCode + '?\n\n' +
    (newLockState 
      ? 'Locked: Manual value, walang auto-recompute' 
      : 'Unlocked: Auto-compute from usage'))) {
    return;
  }
  
  var editedBy = localStorage.getItem('ivm_userFullname') || 
                 localStorage.getItem('ivm_username') || 
                 'WAREHOUSE';
  
  try {
    var res = await fetch(erpUrl('rpc/erp_toggle_buffer_lock'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_item_code: itemCode,
        p_new_lock_state: newLockState,
        p_reason: (newLockState ? 'Manual lock' : 'Unlock for auto-recompute'),
        p_edited_by: editedBy
      })
    });
    
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    
    if (data && data.success) {
      erpShowToast('✅ Buffer ' + (newLockState ? 'LOCKED' : 'UNLOCKED') + ': ' + itemCode, 'success');
      await erpLoadItems();
    } else {
      erpShowToast('Failed: ' + (data.error || 'Unknown'), 'danger');
    }
  } catch(err) {
    console.error('[erpToggleLock]', err);
    erpShowToast('Error: ' + err.message, 'danger');
  }
};

// ═══════════════════════════════════════════════════════════
// PHASE 4: CSV BULK IMPORT
// ═══════════════════════════════════════════════════════════

window.erpOpenCsvImport = function() {
  var modalEl = document.getElementById('csvImportModal');
  if (!modalEl) {
    erpShowToast('CSV Import modal not found', 'danger');
    return;
  }
  
  // Reset
  document.getElementById('csvFileInput').value = '';
  document.getElementById('csvImportReason').value = '';
  document.getElementById('csvStepUpload').style.display = 'block';
  document.getElementById('csvStepPreview').style.display = 'none';
  document.getElementById('csvStepResult').style.display = 'none';
  document.getElementById('btnCsvImport').style.display = 'none';
  _csvImportData = null;
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
};

window.erpDownloadCsvTemplate = function() {
  // Get current items
  var csv = 'item_code,on_hand,unit_cost,buffer_stock\n';
  _erpAllItems.slice(0, 50).forEach(function(it) {
    csv += it.item_code + ',' + (it.on_hand || 0) + ',' + (it.unit_cost || 0) + ',' + (it.buffer_stock || 0) + '\n';
  });
  
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'inventory_import_template.csv';
  link.click();
  
  erpShowToast('✅ Template downloaded (50 items sample)');
};

window.erpHandleCsvUpload = function(event) {
  var file = event.target.files[0];
  if (!file) return;
  
  var reader = new FileReader();
  reader.onload = function(e) {
    var csv = e.target.result;
    var lines = csv.split('\n').filter(function(l) { return l.trim(); });
    
    if (lines.length < 2) {
      erpShowToast('CSV is empty', 'warning');
      return;
    }
    
    // Parse header
    var header = lines[0].split(',').map(function(h) { return h.trim().toLowerCase(); });
    var itemCodeIdx = header.indexOf('item_code');
    var onHandIdx = header.indexOf('on_hand');
    var unitCostIdx = header.indexOf('unit_cost');
    var bufferIdx = header.indexOf('buffer_stock');
    
    if (itemCodeIdx === -1) {
      erpShowToast('CSV must have "item_code" column', 'danger');
      return;
    }
    
    // Parse rows
    var data = [];
    var errors = [];
    
    for (var i = 1; i < lines.length; i++) {
      var parts = lines[i].split(',');
      var itemCode = parts[itemCodeIdx] ? parts[itemCodeIdx].trim() : '';
      
      if (!itemCode) continue;
      
      var row = { item_code: itemCode };
      if (onHandIdx !== -1 && parts[onHandIdx]) row.on_hand = parseFloat(parts[onHandIdx]) || 0;
      if (unitCostIdx !== -1 && parts[unitCostIdx]) row.unit_cost = parseFloat(parts[unitCostIdx]) || 0;
      if (bufferIdx !== -1 && parts[bufferIdx]) row.buffer_stock = parseFloat(parts[bufferIdx]) || 0;
      
      // Validate item exists
      var existing = _erpAllItems.find(function(it) { return it.item_code === itemCode; });
      row._valid = !!existing;
      row._exists = !!existing;
      
      if (!existing) {
        errors.push({ item_code: itemCode, error: 'Item not found' });
      }
      
      data.push(row);
    }
    
    _csvImportData = {
      valid: data.filter(function(r) { return r._valid; }),
      errors: errors,
      total: data.length
    };
    
    // Render preview
    var tbody = document.getElementById('csvPreviewBody');
    var html = '';
    
    data.slice(0, 50).forEach(function(row, idx) {
      var statusBadge = row._valid 
        ? '<span class="badge bg-success">VALID</span>' 
        : '<span class="badge bg-danger">NOT FOUND</span>';
      
      html += '<tr class="' + (row._valid ? 'valid' : 'invalid') + '">' +
        '<td>' + (idx + 1) + '</td>' +
        '<td><code>' + erpEsc(row.item_code) + '</code></td>' +
        '<td class="text-end">' + (row.on_hand != null ? erpNum(row.on_hand) : '—') + '</td>' +
        '<td class="text-end">' + (row.unit_cost != null ? erpPeso(row.unit_cost) : '—') + '</td>' +
        '<td class="text-end">' + (row.buffer_stock != null ? erpNum(row.buffer_stock) : '—') + '</td>' +
        '<td class="text-center">' + statusBadge + '</td>' +
        '</tr>';
    });
    
    tbody.innerHTML = html;
    
    document.getElementById('csvPreviewCount').textContent = data.length;
    document.getElementById('csvStepUpload').style.display = 'none';
    document.getElementById('csvStepPreview').style.display = 'block';
    document.getElementById('btnCsvImport').style.display = 'block';
  };
  
  reader.readAsText(file);
};

window.erpConfirmCsvImport = async function() {
  if (!_csvImportData) {
    erpShowToast('No data to import', 'warning');
    return;
  }
  
  var reason = document.getElementById('csvImportReason').value.trim();
  if (!reason) {
    erpShowToast('Reason is required for CSV import', 'warning');
    document.getElementById('csvImportReason').focus();
    return;
  }
  
  if (_csvImportData.valid.length === 0) {
    erpShowToast('No valid items to import', 'warning');
    return;
  }
  
  if (!confirm('Import ' + _csvImportData.valid.length + ' item(s)?')) return;
  
  var editedBy = localStorage.getItem('ivm_userFullname') || 
                 localStorage.getItem('ivm_username') || 
                 'WAREHOUSE';
  
  var btn = document.getElementById('btnCsvImport');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Importing...';
  
  try {
    var res = await fetch(erpUrl('rpc/erp_bulk_update_items'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_items: _csvImportData.valid,
        p_edited_by: editedBy,
        p_reason: reason
      })
    });
    
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    
    if (data && data.success) {
      document.getElementById('csvStepPreview').style.display = 'none';
      document.getElementById('csvStepResult').style.display = 'block';
      document.getElementById('csvResultSummary').innerHTML =
        'Success: <strong>' + data.success_count + '</strong> | ' +
        'Errors: <strong>' + data.error_count + '</strong> | ' +
        'Total: <strong>' + data.total_processed + '</strong>';
      
      document.getElementById('btnCsvImport').style.display = 'none';
      
      // Refresh
      await erpLoadItems();
      await erpLoadSummary();
    } else {
      erpShowToast('Import failed: ' + (data.error || 'Unknown'), 'danger');
    }
    
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  } catch(err) {
    console.error('[erpConfirmCsvImport]', err);
    erpShowToast('Error: ' + err.message, 'danger');
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

// ═══════════════════════════════════════════════════════════
// SEARCH + FILTERS
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

// [Iba pang functions — same as before]

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

// [Rest of the file — same as previous version]
// ...

console.log('✅ stock-monitor.js v3 loaded — Phase 4 (Inline Edit)');
