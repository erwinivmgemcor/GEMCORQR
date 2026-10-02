// ============================================================
// GEMCOR ERP — Weekly Monitoring Logic
// ============================================================

var _wkAllItems = [];
var _wkFilteredItems = [];
var _wkCurrentPage = 1;
var _wkPageSize = 50;
var _wkCurrentWeekStart = null;   // Monday of current week
var _wkCurrentWeekEnd = null;     // Sunday of current week
var _wkCharts = { topIn: null, topOut: null };
var _wkSearchTimer = null;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Weekly] Initializing...');
  erpCheckHealth();
  erpWeekToday();  // Set to current week
});

async function erpCheckHealth() {
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
// WEEK MANAGEMENT
// ═══════════════════════════════════════════════════════════
function _getMondayOfWeek(date) {
  var d = new Date(date);
  d.setHours(0, 0, 0, 0);
  var day = d.getDay();  // 0 = Sunday, 1 = Monday, ...
  var diff = (day === 0 ? -6 : 1 - day);  // if Sunday, go back 6 days; else go to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

function _formatISO(date) {
  var d = new Date(date);
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function _formatDisplay(date) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
}

function _updateWeekDisplay() {
  var el = document.getElementById('erpWeekDates');
  var sub = document.getElementById('wkTableSubtitle');
  if (!el) return;
  
  var startStr = _formatDisplay(_wkCurrentWeekStart);
  var endStr = _formatDisplay(_wkCurrentWeekEnd);
  el.textContent = startStr + ' — ' + endStr;
  
  if (sub) {
    var isCurrentWeek = _formatISO(_wkCurrentWeekStart) === _formatISO(_getMondayOfWeek(new Date()));
    sub.textContent = isCurrentWeek ? 'Current week' : 'Week of ' + startStr;
  }
}

function erpWeekToday() {
  _wkCurrentWeekStart = _getMondayOfWeek(new Date());
  _wkCurrentWeekEnd = new Date(_wkCurrentWeekStart);
  _wkCurrentWeekEnd.setDate(_wkCurrentWeekEnd.getDate() + 6);
  _updateWeekDisplay();
  erpWeeklyLoad();
}

function erpWeekPrev() {
  if (!_wkCurrentWeekStart) return;
  _wkCurrentWeekStart.setDate(_wkCurrentWeekStart.getDate() - 7);
  _wkCurrentWeekEnd.setDate(_wkCurrentWeekEnd.getDate() - 7);
  _updateWeekDisplay();
  erpWeeklyLoad();
}

function erpWeekNext() {
  if (!_wkCurrentWeekStart) return;
  _wkCurrentWeekStart.setDate(_wkCurrentWeekStart.getDate() + 7);
  _wkCurrentWeekEnd.setDate(_wkCurrentWeekEnd.getDate() + 7);
  _updateWeekDisplay();
  erpWeeklyLoad();
}

// ═══════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════
async function erpWeeklyLoad() {
  var tbody = document.getElementById('wkTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="9" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading weekly data...</div></td></tr>';
  }
  
  // Determine ISO range (inclusive start, exclusive end)
  var startISO = _formatISO(_wkCurrentWeekStart) + 'T00:00:00';
  var endDate = new Date(_wkCurrentWeekEnd);
  endDate.setDate(endDate.getDate() + 1);  // +1 day for exclusive end
  var endISO = _formatISO(endDate) + 'T00:00:00';
  
  try {
    var result = await erpGetWeeklyData(startISO, endISO);
    if (!result.success) {
      tbody.innerHTML = '<tr><td colspan="9" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill"></i> ' + erpEsc(result.error) + '</td></tr>';
      return;
    }
    
    _wkAllItems = result.items || [];
    _wkFilteredItems = _wkAllItems.slice();
    _wkCurrentPage = 1;
    
    erpWeeklyPopulateFilterOptions();
    erpWeeklyComputeKPIs();
    erpWeeklyRenderCharts();
    erpWeeklyRender();
  } catch(err) {
    console.error('[erpWeeklyLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="9" class="erp-empty text-danger">' +
        'Failed to load: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

// ═══════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════
function erpWeeklyComputeKPIs() {
  var totalIn = 0;
  var totalOut = 0;
  var activeCount = 0;
  
  _wkAllItems.forEach(function(it) {
    totalIn += Number(it.qty_in || 0);
    totalOut += Number(it.qty_out || 0);
    if (it.tx_count > 0 || it.qty_in > 0 || it.qty_out > 0) activeCount++;
  });
  
  var net = totalIn - totalOut;
  
  var elIn = document.getElementById('wkKpiIn');
  var elOut = document.getElementById('wkKpiOut');
  var elNet = document.getElementById('wkKpiNet');
  var elActive = document.getElementById('wkKpiActive');
  
  if (elIn) elIn.textContent = erpNum(totalIn);
  if (elOut) elOut.textContent = erpNum(totalOut);
  if (elNet) {
    elNet.textContent = (net >= 0 ? '+' : '') + erpNum(net);
    elNet.style.color = net >= 0 ? '#2e8b57' : '#dc3545';
  }
  if (elActive) elActive.textContent = erpNum(activeCount);
}

// ═══════════════════════════════════════════════════════════
// CHARTS — Top 10 IN / OUT
// ═══════════════════════════════════════════════════════════
function erpWeeklyRenderCharts() {
  // Top 10 IN
  var topIn = _wkAllItems
    .filter(function(it) { return Number(it.qty_in || 0) > 0; })
    .sort(function(a, b) { return Number(b.qty_in) - Number(a.qty_in); })
    .slice(0, 10);
  
  var canvasIn = document.getElementById('chartTopIn');
  if (canvasIn) {
    if (_wkCharts.topIn) { _wkCharts.topIn.destroy(); }
    
    if (topIn.length === 0) {
      _wkCharts.topIn = _renderEmptyChart(canvasIn, 'No receipts this week');
    } else {
      _wkCharts.topIn = new Chart(canvasIn.getContext('2d'), {
        type: 'bar',
        data: {
          labels: topIn.map(function(it) { return it.item_code; }),
          datasets: [{
            label: 'Qty In',
            data: topIn.map(function(it) { return Number(it.qty_in); }),
            backgroundColor: '#2e8b57',
            borderRadius: 4
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
                title: function(ctx) {
                  var code = ctx[0].label;
                  var item = topIn.find(function(x) { return x.item_code === code; });
                  return item ? item.item_code : code;
                },
                label: function(ctx) {
                  var code = ctx.label;
                  var item = topIn.find(function(x) { return x.item_code === code; });
                  var desc = item ? String(item.description || '').substring(0, 50) : '';
                  return [desc, 'In: ' + erpNum(ctx.parsed.x) + ' ' + (item ? item.base_unit : '')];
                }
              }
            }
          },
          scales: {
            x: { beginAtZero: true, ticks: { font: { size: 10 } } },
            y: { ticks: { font: { size: 10 } } }
          }
        }
      });
    }
  }
  
  // Top 10 OUT
  var topOut = _wkAllItems
    .filter(function(it) { return Number(it.qty_out || 0) > 0; })
    .sort(function(a, b) { return Number(b.qty_out) - Number(a.qty_out); })
    .slice(0, 10);
  
  var canvasOut = document.getElementById('chartTopOut');
  if (canvasOut) {
    if (_wkCharts.topOut) { _wkCharts.topOut.destroy(); }
    
    if (topOut.length === 0) {
      _wkCharts.topOut = _renderEmptyChart(canvasOut, 'No issuance this week');
    } else {
      _wkCharts.topOut = new Chart(canvasOut.getContext('2d'), {
        type: 'bar',
        data: {
          labels: topOut.map(function(it) { return it.item_code; }),
          datasets: [{
            label: 'Qty Out',
            data: topOut.map(function(it) { return Number(it.qty_out); }),
            backgroundColor: '#dc3545',
            borderRadius: 4
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
                title: function(ctx) {
                  var code = ctx[0].label;
                  var item = topOut.find(function(x) { return x.item_code === code; });
                  return item ? item.item_code : code;
                },
                label: function(ctx) {
                  var code = ctx.label;
                  var item = topOut.find(function(x) { return x.item_code === code; });
                  var desc = item ? String(item.description || '').substring(0, 50) : '';
                  return [desc, 'Out: ' + erpNum(ctx.parsed.x) + ' ' + (item ? item.base_unit : '')];
                }
              }
            }
          },
          scales: {
            x: { beginAtZero: true, ticks: { font: { size: 10 } } },
            y: { ticks: { font: { size: 10 } } }
          }
        }
      });
    }
  }
}

function _renderEmptyChart(canvas, message) {
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#9ca3af';
  ctx.font = '14px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);
  return null;
}

// ═══════════════════════════════════════════════════════════
// TABLE RENDERING
// ═══════════════════════════════════════════════════════════
function erpWeeklyRender() {
  var tbody = document.getElementById('wkTableBody');
  if (!tbody) return;
  
  // Apply filters
  var search = (document.getElementById('wkSearchInput') ? document.getElementById('wkSearchInput').value : '').toLowerCase().trim();
  var catF = document.getElementById('wkCategoryFilter') ? document.getElementById('wkCategoryFilter').value : '';
  var locF = document.getElementById('wkLocationFilter') ? document.getElementById('wkLocationFilter').value : '';
  var movF = document.getElementById('wkMovementFilter') ? document.getElementById('wkMovementFilter').value : '';
  
  _wkFilteredItems = _wkAllItems.filter(function(it) {
    // Search filter
    if (search) {
      var code = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      if (code.indexOf(search) === -1 && desc.indexOf(search) === -1) return false;
    }
    
    // Category filter
    if (catF && it.category !== catF) return false;
    
    // Location filter
    if (locF && it.location !== locF) return false;
    
    // Movement filter (based on weekly activity)
    if (movF) {
      var hasIn = Number(it.qty_in || 0) > 0;
      var hasOut = Number(it.qty_out || 0) > 0;
      if (movF === 'IN_ONLY' && !hasIn) return false;
      if (movF === 'OUT_ONLY' && !hasOut) return false;
      if (movF === 'BOTH' && !(hasIn && hasOut)) return false;
      if (movF === 'NO_MOVEMENT' && (hasIn || hasOut)) return false;
    }
    
    return true;
  });
  
  // Pagination
  var total = _wkFilteredItems.length;
  var start = (_wkCurrentPage - 1) * _wkPageSize;
  var end = Math.min(start + _wkPageSize, total);
  var pageItems = _wkFilteredItems.slice(start, end);
  
  document.getElementById('wkTableCount').textContent = total + ' items';
  document.getElementById('wkPageTotal').textContent = total;
  document.getElementById('wkPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('wkPageEnd').textContent = end;
  document.getElementById('wkPageLabel').textContent = 'Page ' + _wkCurrentPage;
  
  document.getElementById('wkBtnPrev').disabled = (_wkCurrentPage <= 1);
  document.getElementById('wkBtnNext').disabled = (end >= total);
  
  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No items match your filters this week.</td></tr>';
    return;
  }
  
  // Render rows
  var html = '';
  pageItems.forEach(function(it) {
    html += '<tr>' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td class="desc-cell">' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-end">' + erpNum(it.opening) + '</td>' +
      '<td class="text-end text-success fw-bold">' + (Number(it.qty_in) > 0 ? '+' + erpNum(it.qty_in) : '—') + '</td>' +
      '<td class="text-end text-danger fw-bold">' + (Number(it.qty_out) > 0 ? '−' + erpNum(it.qty_out) : '—') + '</td>' +
      '<td class="text-end fw-bold">' + erpNum(it.closing) + '</td>' +
      '<td class="text-center">' + erpEsc(it.base_unit || '') + '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function erpWeeklyPopulateFilterOptions() {
  var catSel = document.getElementById('wkCategoryFilter');
  var locSel = document.getElementById('wkLocationFilter');
  if (!catSel || !locSel) return;
  
  // Preserve current selection
  var currentCat = catSel.value;
  var currentLoc = locSel.value;
  
  var cats = {};
  var locs = {};
  _wkAllItems.forEach(function(it) {
    if (it.category) cats[it.category] = true;
    if (it.location) locs[it.location] = true;
  });
  
  // Rebuild options
  catSel.innerHTML = '<option value="">All Categories</option>';
  Object.keys(cats).sort().forEach(function(c) {
    catSel.innerHTML += '<option value="' + erpEsc(c) + '"' + (c === currentCat ? ' selected' : '') + '>' + erpEsc(c) + '</option>';
  });
  
  locSel.innerHTML = '<option value="">All Locations</option>';
  Object.keys(locs).sort().forEach(function(l) {
    locSel.innerHTML += '<option value="' + erpEsc(l) + '"' + (l === currentLoc ? ' selected' : '') + '>' + erpEsc(l) + '</option>';
  });
}

function erpWeeklyOnSearch() {
  clearTimeout(_wkSearchTimer);
  _wkSearchTimer = setTimeout(function() {
    _wkCurrentPage = 1;
    erpWeeklyRender();
  }, 350);
}

function erpWeeklyClearFilters() {
  var s = document.getElementById('wkSearchInput');
  var c = document.getElementById('wkCategoryFilter');
  var l = document.getElementById('wkLocationFilter');
  var m = document.getElementById('wkMovementFilter');
  if (s) s.value = '';
  if (c) c.value = '';
  if (l) l.value = '';
  if (m) m.value = '';
  _wkCurrentPage = 1;
  erpWeeklyRender();
}

// ═══════════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════════
function erpWeeklyPagePrev() {
  if (_wkCurrentPage > 1) {
    _wkCurrentPage--;
    erpWeeklyRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function erpWeeklyPageNext() {
  var total = _wkFilteredItems.length;
  var maxPage = Math.ceil(total / _wkPageSize);
  if (_wkCurrentPage < maxPage) {
    _wkCurrentPage++;
    erpWeeklyRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORT — BASIC
// ═══════════════════════════════════════════════════════════
function erpExportWeeklyBasic() {
  var items = _wkFilteredItems.filter(function(it) {
    return Number(it.qty_in || 0) > 0 || Number(it.qty_out || 0) > 0;
  });
  
  if (items.length === 0) {
    erpWeeklyShowToast('No movement data to export');
    return;
  }
  
  var headers = ['Item Code', 'Description', 'Opening', 'In', 'Out', 'Closing', 'Unit'];
  var rows = items.map(function(it) {
    return [
      it.item_code,
      it.description,
      Number(it.opening || 0),
      Number(it.qty_in || 0),
      Number(it.qty_out || 0),
      Number(it.closing || 0),
      it.base_unit || ''
    ];
  });
  
  _downloadCSV(headers, rows, 'Weekly_Basic_' + _formatISO(_wkCurrentWeekStart) + '.csv');
}

// ═══════════════════════════════════════════════════════════
// EXPORT — DETAILED
// ═══════════════════════════════════════════════════════════
function erpExportWeeklyDetailed() {
  var items = _wkFilteredItems.filter(function(it) {
    return Number(it.qty_in || 0) > 0 || Number(it.qty_out || 0) > 0;
  });
  
  if (items.length === 0) {
    erpWeeklyShowToast('No movement data to export');
    return;
  }
  
  var headers = ['Item Code', 'Description', 'Category', 'Location', 'Opening', 'In', 'Out', 'Closing', 'Unit', 'Unit Cost', 'Total Value', 'ABC', 'Movement'];
  var rows = items.map(function(it) {
    var closing = Number(it.closing || 0);
    var cost = Number(it.unit_cost || 0);
    return [
      it.item_code,
      it.description,
      it.category || '',
      it.location || '',
      Number(it.opening || 0),
      Number(it.qty_in || 0),
      Number(it.qty_out || 0),
      closing,
      it.base_unit || '',
      cost,
      closing * cost,
      it.abc_classification || '',
      it.inventory_movement || ''
    ];
  });
  
  _downloadCSV(headers, rows, 'Weekly_Detailed_' + _formatISO(_wkCurrentWeekStart) + '.csv');
}

function _downloadCSV(headers, rows, filename) {
  var csv = '';
  
  // Header
  csv += headers.map(function(h) { return _csvEscape(h); }).join(',') + '\n';
  
  // Rows
  rows.forEach(function(row) {
    csv += row.map(function(v) { return _csvEscape(v); }).join(',') + '\n';
  });
  
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  erpWeeklyShowToast('✅ Exported ' + rows.length + ' rows');
}

function _csvEscape(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// REFRESH + TOAST
// ═══════════════════════════════════════════════════════════
function erpWeeklyRefresh() {
  erpClearCache('weekly_movement');
  erpWeeklyShowToast('Refreshing weekly data...');
  erpWeeklyLoad();
  erpCheckHealth();
}

function erpWeeklyShowToast(msg) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) return;
  document.getElementById('erpToastBody').textContent = msg;
  var toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 2500 });
  toast.show();
}

console.log('✅ weekly-monitor.js loaded');
