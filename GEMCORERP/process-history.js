// ============================================================
// GEMCOR ERP — Process History (v2 — FIXED)
// Tracks warehouse staff activities (MRIF/MRR/MRS/PRF)
// Computed from existing tables — no new schema
// ============================================================

var _ph = {
  allEvents: [],
  filteredEvents: [],
  currentPage: 1,
  pageSize: 50,
  searchTimer: null,
  isLoading: false,
  loadPromise: null
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Process History] Initializing v2...');

  phCheckHealth();
  phPopulateStaffFilter().then(function() {
    processHistoryLoad();
  });
});

async function phCheckHealth() {
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
// LOAD EVENTS (Aggregate from multiple tables)
// ═══════════════════════════════════════════════════════════
async function processHistoryLoad() {
  if (_ph.isLoading && _ph.loadPromise) return _ph.loadPromise;
  _ph.isLoading = true;

  var tbody = document.getElementById('phTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading history...</div></td></tr>';
  }

  _ph.loadPromise = (async function() {
    try {
      var events = [];

      // Date range filter
      var fromDate = document.getElementById('phDateFrom') ? document.getElementById('phDateFrom').value : '';
      var toDate = document.getElementById('phDateTo') ? document.getElementById('phDateTo').value : '';
      var fromISO = fromDate ? fromDate + 'T00:00:00' : '';
      var toISO = toDate ? toDate + 'T23:59:59' : '';

      // Default: last 30 days kung walang filter
      if (!fromISO && !toISO) {
        var thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        fromISO = thirtyDaysAgo.toISOString();
      }

      // ═══════════════════════════════════════════════════════════
      // 1. Documents processed (MRIF/MRR/MRS)
      // ═══════════════════════════════════════════════════════════
      try {
        var docQuery = 'select=doc_no,doc_type,status,requestor,processed_by,processed_at,updated_at' +
                       '&processed_by=not.is.null';
        if (fromISO) docQuery += '&processed_at=gte.' + encodeURIComponent(fromISO);
        if (toISO) docQuery += '&processed_at=lte.' + encodeURIComponent(toISO);
        docQuery += '&order=processed_at.desc&limit=500';

        var docs = await erpFetch('documents', docQuery);

        if (docs && docs.length > 0) {
          // ✅ OPTIMIZED: Bulk fetch lahat ng items sa isang query
          var docNos = docs.map(function(d) { return d.doc_no; });
          var allItems = [];
          
          // Split into chunks of 100 (para safe sa URL length)
          var chunkSize = 100;
          for (var c = 0; c < docNos.length; c += chunkSize) {
            var chunk = docNos.slice(c, c + chunkSize);
            try {
              var itemsQuery = 'select=doc_no,item_code,description,issued_qty,remarks' +
                               '&doc_no=in.(' + chunk.map(encodeURIComponent).join(',') + ')' +
                               '&order=doc_no.asc,line_no.asc&limit=5000';
              var itemsChunk = await erpFetch('doc_items', itemsQuery);
              if (itemsChunk) allItems = allItems.concat(itemsChunk);
            } catch(e) {
              console.warn('[PH] Items chunk failed:', e.message);
            }
          }

          // Group items by doc_no
          var itemsByDoc = {};
          allItems.forEach(function(it) {
            if (!itemsByDoc[it.doc_no]) itemsByDoc[it.doc_no] = [];
            itemsByDoc[it.doc_no].push(it);
          });

          // Build events
          docs.forEach(function(doc) {
            var docItems = itemsByDoc[doc.doc_no] || [];
            if (docItems.length > 0) {
              docItems.forEach(function(it) {
                events.push({
                  timestamp: doc.processed_at || doc.updated_at,
                  staff: doc.processed_by,
                  docNo: doc.doc_no,
                  docType: String(doc.doc_type || '').toUpperCase(),
                  itemCode: it.item_code || '',
                  description: it.description || '',
                  action: determineDocAction(doc.status, it.remarks),
                  qty: Number(it.issued_qty || 0)
                });
              });
            } else {
              // Doc-level event (no items)
              events.push({
                timestamp: doc.processed_at || doc.updated_at,
                staff: doc.processed_by,
                docNo: doc.doc_no,
                docType: String(doc.doc_type || '').toUpperCase(),
                itemCode: '—',
                description: '(doc-level)',
                action: String(doc.status || '').toUpperCase(),
                qty: 0
              });
            }
          });
        }
      } catch(err) {
        console.warn('[PH] Documents fetch failed:', err.message);
      }

      // ═══════════════════════════════════════════════════════════
      // 2. PRF items updated
      // ═══════════════════════════════════════════════════════════
      try {
        var prfQuery = 'select=prf_no,item_code,description,qty_for_order,status,updated_by,updated_at' +
                       '&updated_by=not.is.null';
        if (fromISO) prfQuery += '&updated_at=gte.' + encodeURIComponent(fromISO);
        if (toISO) prfQuery += '&updated_at=lte.' + encodeURIComponent(toISO);
        prfQuery += '&order=updated_at.desc&limit=500';

        var prfItems = await erpFetch('prf_items', prfQuery);

        (prfItems || []).forEach(function(it) {
          events.push({
            timestamp: it.updated_at,
            staff: it.updated_by,
            docNo: it.prf_no,
            docType: 'PRF',
            itemCode: it.item_code || '',
            description: it.description || '',
            action: String(it.status || 'UPDATED').toUpperCase(),
            qty: Number(it.qty_for_order || 0)
          });
        });
      } catch(err) {
        console.warn('[PH] PRF items fetch failed:', err.message);
      }

      // ═══════════════════════════════════════════════════════════
      // 3. PRF documents created
      // ═══════════════════════════════════════════════════════════
      try {
        var prfDocQuery = 'select=prf_no,category,prepared_by,total_items,total_qty,created_at';
        if (fromISO) prfDocQuery += '&created_at=gte.' + encodeURIComponent(fromISO);
        if (toISO) prfDocQuery += '&created_at=lte.' + encodeURIComponent(toISO);
        prfDocQuery += '&order=created_at.desc&limit=200';

        var prfDocs = await erpFetch('prf_documents', prfDocQuery);

        (prfDocs || []).forEach(function(p) {
          events.push({
            timestamp: p.created_at,
            staff: p.prepared_by || '',
            docNo: p.prf_no,
            docType: 'PRF',
            itemCode: '—',
            description: 'PRF Created (' + (p.category || '') + ') · ' + (p.total_items || 0) + ' items',
            action: 'CREATED',
            qty: Number(p.total_qty || 0)
          });
        });
      } catch(err) {
        console.warn('[PH] PRF docs fetch failed:', err.message);
      }

      // Sort by timestamp desc
      events.sort(function(a, b) {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      _ph.allEvents = events;
      console.log('[PH] Total events:', events.length);

      processHistoryComputeKPIs();
      processHistoryRender();

    } catch(err) {
      console.error('[processHistoryLoad]', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="erp-empty text-danger">' +
          'Failed: ' + erpEsc(err.message) + '</td></tr>';
      }
    } finally {
      _ph.isLoading = false;
      _ph.loadPromise = null;
    }
  })();

  return _ph.loadPromise;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function determineDocAction(docStatus, itemRemarks) {
  var doc = String(docStatus || '').toUpperCase();
  var rem = String(itemRemarks || '').toUpperCase();

  if (doc === 'COMPLETED') return 'SERVED';
  if (doc === 'PARTIAL') return 'PARTIAL';
  if (rem.indexOf('SERVED') !== -1) return 'SERVED';
  if (rem.indexOf('PARTIAL') !== -1) return 'PARTIAL';
  if (rem.indexOf('BALANCED') !== -1) return 'BALANCED';
  return doc || 'PROCESSED';
}

function processHistoryComputeKPIs() {
  var todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  var todayTs = todayStart.getTime();

  var weekStart = todayTs - 7 * 24 * 60 * 60 * 1000;

  var todayCount = 0;
  var weekCount = 0;
  var staffSet = {};
  var itemsMoved = 0;

  _ph.allEvents.forEach(function(e) {
    var ts = new Date(e.timestamp).getTime();
    if (isNaN(ts)) return;

    if (ts >= todayTs) {
      todayCount++;
      itemsMoved += Number(e.qty || 0);
    }
    if (ts >= weekStart) weekCount++;
    if (e.staff) staffSet[e.staff] = true;
  });

  var elToday = document.getElementById('phKpiToday');
  var elWeek = document.getElementById('phKpiWeek');
  var elStaff = document.getElementById('phKpiStaff');
  var elItems = document.getElementById('phKpiItems');

  if (elToday) elToday.textContent = todayCount;
  if (elWeek) elWeek.textContent = weekCount;
  if (elStaff) elStaff.textContent = Object.keys(staffSet).length;
  if (elItems) elItems.textContent = itemsMoved.toLocaleString();
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function processHistoryRender() {
  var tbody = document.getElementById('phTableBody');
  if (!tbody) return;

  var searchInput = document.getElementById('phSearchInput');
  var staffFilterEl = document.getElementById('phStaffFilter');
  var typeFilterEl = document.getElementById('phTypeFilter');
  var actionFilterEl = document.getElementById('phActionFilter');

  var search = (searchInput ? searchInput.value : '').toLowerCase().trim();
  var staffFilter = staffFilterEl ? staffFilterEl.value : '';
  var typeFilter = typeFilterEl ? typeFilterEl.value : '';
  var actionFilter = actionFilterEl ? actionFilterEl.value : '';

  _ph.filteredEvents = _ph.allEvents.filter(function(e) {
    // Staff filter
    if (staffFilter && String(e.staff || '').toLowerCase() !== staffFilter.toLowerCase()) {
      return false;
    }
    // Type filter
    if (typeFilter && String(e.docType || '').toUpperCase() !== typeFilter) {
      return false;
    }
    // Action filter
    if (actionFilter && String(e.action || '').toUpperCase() !== actionFilter) {
      return false;
    }

    // Search — matches doc_no, item_code, description, OR staff
    if (search) {
      var docNo = String(e.docNo || '').toLowerCase();
      var itemCode = String(e.itemCode || '').toLowerCase();
      var desc = String(e.description || '').toLowerCase();
      var staff = String(e.staff || '').toLowerCase();

      var matched = (
        docNo.indexOf(search) !== -1 ||
        itemCode.indexOf(search) !== -1 ||
        desc.indexOf(search) !== -1 ||
        staff.indexOf(search) !== -1
      );

      if (!matched) return false;
    }

    return true;
  });

  var total = _ph.filteredEvents.length;
  var start = (_ph.currentPage - 1) * _ph.pageSize;
  var end = Math.min(start + _ph.pageSize, total);
  var pageItems = _ph.filteredEvents.slice(start, end);

  // Update UI elements
  var elCount = document.getElementById('phTableCount');
  var elPageTotal = document.getElementById('phPageTotal');
  var elPageStart = document.getElementById('phPageStart');
  var elPageEnd = document.getElementById('phPageEnd');
  var elPageLabel = document.getElementById('phPageLabel');
  var elBtnPrev = document.getElementById('phBtnPrev');
  var elBtnNext = document.getElementById('phBtnNext');

  if (elCount) elCount.textContent = total + ' events';
  if (elPageTotal) elPageTotal.textContent = total;
  if (elPageStart) elPageStart.textContent = total > 0 ? start + 1 : 0;
  if (elPageEnd) elPageEnd.textContent = end;
  if (elPageLabel) elPageLabel.textContent = 'Page ' + _ph.currentPage;
  if (elBtnPrev) elBtnPrev.disabled = (_ph.currentPage <= 1);
  if (elBtnNext) elBtnNext.disabled = (end >= total);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No events found.</td></tr>';
    return;
  }

  var html = '';
  pageItems.forEach(function(e) {
    var ts = e.timestamp ? new Date(e.timestamp) : null;
    var tsStr = ts ? ts.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '—';

    var typeBadge = 'bg-secondary';
    var typeUpper = String(e.docType || '').toUpperCase();
    if (typeUpper === 'MRIF') typeBadge = 'bg-warning text-dark';
    else if (typeUpper === 'MRR') typeBadge = 'bg-success';
    else if (typeUpper === 'MRS') typeBadge = 'bg-danger';
    else if (typeUpper === 'PRF') typeBadge = 'bg-primary';

    var actionBadge = 'bg-secondary';
    var actionUpper = String(e.action || '').toUpperCase();
    if (actionUpper === 'SERVED' || actionUpper === 'COMPLETED') actionBadge = 'bg-success';
    else if (actionUpper === 'PARTIAL' || actionUpper === 'STAGGERED') actionBadge = 'bg-info text-dark';
    else if (actionUpper === 'CANCELED') actionBadge = 'bg-danger';
    else if (actionUpper === 'CREATED') actionBadge = 'bg-primary';
    else if (actionUpper === 'BALANCED') actionBadge = 'bg-warning text-dark';

    html += '<tr>' +
      '<td style="font-size:0.78rem;">' + erpEsc(tsStr) + '</td>' +
      '<td>' + erpEsc(e.staff || '—') + '</td>' +
      '<td><code>' + erpEsc(e.docNo || '—') + '</code></td>' +
      '<td class="text-center"><span class="badge ' + typeBadge + '">' + erpEsc(typeUpper) + '</span></td>' +
      '<td><code style="font-size:0.78rem;">' + erpEsc(e.itemCode || '—') + '</code></td>' +
      '<td>' + erpEsc(String(e.description || '').substring(0, 80)) + '</td>' +
      '<td class="text-center"><span class="badge ' + actionBadge + '">' + erpEsc(actionUpper) + '</span></td>' +
      '<td class="text-center"><strong>' + erpNum(e.qty || 0) + '</strong></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
async function phPopulateStaffFilter() {
  try {
    var rows = await erpFetch('documents',
      'select=processed_by&processed_by=not.is.null&limit=1000');

    var seen = {};
    var staff = [];
    (rows || []).forEach(function(r) {
      var v = String(r.processed_by || '').trim();
      if (v && !seen[v]) { seen[v] = true; staff.push(v); }
    });

    // Also add PRF staff
    try {
      var prfRows = await erpFetch('prf_documents',
        'select=prepared_by&prepared_by=not.is.null&limit=500');
      (prfRows || []).forEach(function(r) {
        var v = String(r.prepared_by || '').trim();
        if (v && !seen[v]) { seen[v] = true; staff.push(v); }
      });
    } catch(e) {}

    var sel = document.getElementById('phStaffFilter');
    if (!sel) return;
    staff.sort().forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  } catch(e) { console.warn('[PH] Staff filter failed:', e.message); }
}

function processHistoryOnSearch() {
  clearTimeout(_ph.searchTimer);
  _ph.searchTimer = setTimeout(function() {
    _ph.currentPage = 1;

    // ✅ FIX: Force reload if events array is empty
    if (!_ph.allEvents || _ph.allEvents.length === 0) {
      processHistoryLoad();
    } else {
      processHistoryRender();
    }
  }, 300);
}

function processHistoryClearFilters() {
  var ids = ['phSearchInput', 'phStaffFilter', 'phTypeFilter', 'phActionFilter', 'phDateFrom', 'phDateTo'];
  ids.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  _ph.currentPage = 1;
  _ph.allEvents = []; // Force reload
  processHistoryLoad();
}

function processHistoryPagePrev() {
  if (_ph.currentPage > 1) {
    _ph.currentPage--;
    processHistoryRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function processHistoryPageNext() {
  var total = _ph.filteredEvents.length;
  var maxPage = Math.ceil(total / _ph.pageSize);
  if (_ph.currentPage < maxPage) {
    _ph.currentPage++;
    processHistoryRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function processHistoryRefresh() {
  erpShowToast('Refreshing...', 'info');
  _ph.allEvents = [];
  processHistoryLoad();
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function processHistoryExport() {
  if (_ph.filteredEvents.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }
  var headers = ['Timestamp', 'Staff', 'Doc No.', 'Type', 'Item Code', 'Description', 'Action', 'Qty'];
  var rows = _ph.filteredEvents.map(function(e) {
    return [
      e.timestamp ? new Date(e.timestamp).toLocaleString() : '',
      e.staff || '',
      e.docNo || '',
      e.docType || '',
      e.itemCode || '',
      e.description || '',
      e.action || '',
      e.qty || 0
    ];
  });
  var csv = headers.map(_csvEsc).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEsc).join(',') + '\n'; });
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Process_History_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  erpShowToast('✅ Exported ' + rows.length + ' rows', 'success');
}

function _csvEsc(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

console.log('✅ process-history.js v2 loaded (search fix + bulk items + ledger support)');
