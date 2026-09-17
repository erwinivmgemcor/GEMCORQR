// ============================================================
// PROCESS HISTORY — Audit trail for warehouse tracking
// ============================================================

var _historyModal = null;
var _historyItems = [];

window.openProcessHistory = function() {
  var modalEl = document.getElementById('processHistoryModal');
  if (!modalEl) { showToast('History modal not found', 'danger'); return; }
  if (!_historyModal) {
    _historyModal = new bootstrap.Modal(modalEl);
  }

  // Reset filters
  var typeEl = document.getElementById('historyFilterType');
  var staffEl = document.getElementById('historyFilterStaff');
  var fromEl = document.getElementById('historyFilterFrom');
  var toEl = document.getElementById('historyFilterTo');
  if (typeEl) typeEl.value = '';
  if (staffEl) staffEl.value = '';
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';

  _historyModal.show();
  loadProcessHistory();
};

window.loadProcessHistory = async function() {
  var container = document.getElementById('processHistoryContent');
  var countEl = document.getElementById('historyCount');
  if (!container) return;

  container.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div><div class="text-muted mt-2">Loading history...</div></div>';
  if (countEl) countEl.textContent = 'Loading...';

  var docType = document.getElementById('historyFilterType') ? document.getElementById('historyFilterType').value : '';
  var staff = document.getElementById('historyFilterStaff') ? document.getElementById('historyFilterStaff').value.trim() : '';
  var dateFrom = document.getElementById('historyFilterFrom') ? document.getElementById('historyFilterFrom').value : '';
  var dateTo = document.getElementById('historyFilterTo') ? document.getElementById('historyFilterTo').value : '';

  try {
    var url = API_URL + '?action=getProcessHistory' +
      '&docType=' + encodeURIComponent(docType) +
      '&staff=' + encodeURIComponent(staff) +
      '&dateFrom=' + encodeURIComponent(dateFrom) +
      '&dateTo=' + encodeURIComponent(dateTo) +
      '&limit=500' +
      '&_t=' + Date.now();

    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var trimmed = String(text || '').trim();
    if (!trimmed || trimmed.charAt(0) === '<') throw new Error('Server unavailable');
    var data = JSON.parse(trimmed);

    if (!data.success) throw new Error(data.error || 'Unknown error');

    _historyItems = data.items || [];

    if (countEl) {
      countEl.textContent = _historyItems.length + ' record(s)' +
        (_historyItems.length >= 500 ? ' (showing first 500)' : '');
    }

    renderProcessHistory(_historyItems);
  } catch(err) {
    console.error('[loadProcessHistory] Error:', err);
    container.innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-exclamation-triangle-fill me-2"></i>Failed to load history: ' + err.message + '</div>';
    if (countEl) countEl.textContent = 'Error';
  }
};

window.resetHistoryFilters = function() {
  var typeEl = document.getElementById('historyFilterType');
  var staffEl = document.getElementById('historyFilterStaff');
  var fromEl = document.getElementById('historyFilterFrom');
  var toEl = document.getElementById('historyFilterTo');
  if (typeEl) typeEl.value = '';
  if (staffEl) staffEl.value = '';
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  loadProcessHistory();
};

window.renderProcessHistory = function(items) {
  var container = document.getElementById('processHistoryContent');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = '<div class="text-center text-muted py-5">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      '<div>No processed documents match your filters.</div>' +
      '<div class="small mt-1">Try clearing the filters or adjusting the date range.</div>' +
      '</div>';
    return;
  }

  var html = '<div class="table-responsive" style="max-height:60vh;overflow-y:auto;">';
  html += '<table class="table table-sm table-hover align-middle">';
  html += '<thead class="table-light sticky-top"><tr>';
  html += '<th style="width:15%">Doc No.</th>';
  html += '<th style="width:8%">Type</th>';
  html += '<th style="width:15%">Requestor</th>';
  html += '<th style="width:30%">Items</th>';
  html += '<th style="width:10%">Status</th>';
  html += '<th style="width:15%">Processed By</th>';
  html += '<th style="width:12%">Processed At</th>';
  html += '<th style="width:5%"></th>';
  html += '</tr></thead><tbody>';

  items.forEach(function(it, idx) {
    var createdDate = it.processedAt ? formatHistoryDate(it.processedAt) : '-';
    var statusUpper = (it.status || '').toUpperCase();
    var badgeClass = statusUpper === 'COMPLETED' ? 'bg-success' : (statusUpper === 'PARTIAL' ? 'bg-info text-dark' : 'bg-secondary');
    var typeUpper = (it.type || '').toUpperCase();
    var typeBadge = typeUpper === 'MRIF' ? 'bg-warning text-dark' :
                    typeUpper === 'MRR' ? 'bg-success' :
                    typeUpper === 'MRS' ? 'bg-danger' : 'bg-secondary';

    // Truncate item summary
    var summary = String(it.itemSummary || '');
    if (summary.length > 90) summary = summary.substring(0, 90) + '…';

    html += '<tr>' +
      '<td><code>' + escapeHtml(it.docNo) + '</code></td>' +
      '<td><span class="badge ' + typeBadge + '">' + escapeHtml(typeUpper) + '</span></td>' +
      '<td><small>' + escapeHtml(it.requestor || '—') + '</small></td>' +
      '<td><small class="text-muted">' + escapeHtml(summary || '—') + '</small></td>' +
      '<td><span class="badge ' + badgeClass + '">' + escapeHtml(statusUpper) + '</span></td>' +
      '<td><small><i class="bi bi-person-circle me-1"></i>' + escapeHtml(it.processedBy || '—') + '</small></td>' +
      '<td><small>' + escapeHtml(createdDate) + '</small></td>' +
      '<td><button class="btn btn-sm btn-outline-primary" onclick="viewHistoryDoc(\'' + escapeJs(it.docNo) + '\', \'' + escapeJs(typeUpper) + '\')" title="View / Print"><i class="bi bi-eye"></i></button></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
};

// ─── Open the print preview for a history row ───
window.viewHistoryDoc = function(docNo, docType) {
  if (!docNo) return;
  if (_historyModal) _historyModal.hide();
  setTimeout(function() {
    if (docType === 'MRIF') openMrifPrint(docNo);
    else if (docType === 'MRR') openMrrPrint(docNo);
    else if (docType === 'MRS') openMrsPrint(docNo);
  }, 300);
};

// ─── Helpers ───
function formatHistoryDate(val) {
  if (!val) return '-';
  try {
    var d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' ' + hh + ':' + mm;
  } catch(e) { return String(val); }
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJs(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
