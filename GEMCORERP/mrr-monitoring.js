// ============================================================
// GEMCOR ERP — MRR Monitoring (v1.0)
// Real-time monitoring of all MRR items with creator info
// ============================================================

var _mrrMon = {
  allItems: [],
  filteredItems: [],
  currentPage: 1,
  pageSize: 50,
  searchTimer: null,
  autoRefreshTimer: null,
  autoRefreshEnabled: true,
  REFRESH_INTERVAL: 30000,  // 30 seconds
  activeStatusFilter: ''
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[MRR Monitoring v1.0] Initializing...');

  mrrMonCheckHealth();
  mrrMonLoad();
  mrrMonPopulateFilters();

  // Start auto-refresh
  mrrMonStartAutoRefresh();

  // Pause auto-refresh when tab hidden
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      mrrMonStopAutoRefresh();
    } else {
      mrrMonStartAutoRefresh();
    }
  });
});

async function mrrMonCheckHealth() {
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
// LOAD DATA FROM SUPABASE VIEW
// ═══════════════════════════════════════════════════════════
async function mrrMonLoad() {
  var tbody = document.getElementById('mrrMonTableBody');
  if (tbody && _mrrMon.allItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading MRR items...</div></td></tr>';
  }

  try {
    var t0 = Date.now();

    // ═══ Query the view v_mrr_monitoring ═══
    // Supabase caps one request at 1,000 rows, so limit=10000 silently dropped the rest. erpFetchAll pages through all rows.
    var rows = await erpFetchAll('v_mrr_monitoring',
      'select=*&order=mrr_date.desc,mrr_no.asc,line_no.asc');

    _mrrMon.allItems = rows || [];
    await mrrMonAttachSof(_mrrMon.allItems);     // SOF# para sa Ref No. kapag walang PRF#
    _mrrMon.allItems = await mrrMonMergeCancelled(_mrrMon.allItems);   // kasama ang CANCELLED para sa series tracking
    mrrMonNormalizeStatuses(_mrrMon.allItems);   // staggered delivery: pinagsama-samang dating na ang basehan

    var elapsed = Date.now() - t0;
    console.log('[MRR Monitoring] Loaded ' + _mrrMon.allItems.length + ' items in ' + elapsed + 'ms');

    mrrMonComputeKPIs();
    mrrMonApplyFilters();

  } catch(err) {
    console.error('[mrrMonLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="15" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

// ═══════════════════════════════════════════════════════════
// REF NO. — PRF# muna; kapag walang PRF#, SOF# ang ipapakita
// Kung wala pang sof_no ang view (v_mrr_monitoring), kukunin sa documents table (by MRR no.)
// ═══════════════════════════════════════════════════════════
async function mrrMonAttachSof(rows) {
  if (!rows || !rows.length) return;
  if (rows.some(function(it) { return it.sof_no !== undefined; })) return;   // galing na sa view
  try {
    var docs = await erpFetchAll('documents', 'select=doc_no,sof_no&doc_no=like.MRR*&sof_no=not.is.null&order=doc_no.asc');
    var map = {};
    (docs || []).forEach(function(d) { if (d.sof_no && String(d.sof_no).trim()) map[d.doc_no] = d.sof_no; });
    rows.forEach(function(it) { if (!it.sof_no && map[it.mrr_no]) it.sof_no = map[it.mrr_no]; });
  } catch (e) {
    console.warn('[MRR Monitoring] SOF# lookup failed — Ref No. will show PRF# only', e);
  }
}

function mrrMonRefNo(it) {
  var ref = String(it.ref_no || it.prf_no || '').trim();
  if (ref) return ref;
  var sof = String(it.sof_no || '').trim();
  if (!sof) return '';
  return /^SOF/i.test(sof) ? sof : 'SOF#' + sof;
}

// ═══════════════════════════════════════════════════════════
// CANCELLED MRR — kasama sa monitoring para tuloy-tuloy ang series number
// Hindi nawawala ang numero ng na-cancel / void na MRR (hal. MRR0005354): lalabas ito
// na may CANCELLED status at ang reason ng pag-cancel (hover sa Remarks).
// Source: documents (doc_type=MRR, status=CANCELLED) + doc_items.
// ═══════════════════════════════════════════════════════════
function mrrMonCancelInfo(doc) {
  doc = doc || {};
  var out = { reason: '', by: '', at: '' };
  Object.keys(doc).forEach(function(k) {
    var v = doc[k];
    if (v === null || v === undefined || String(v).trim() === '') return;
    if (!/cancel|void/i.test(k)) return;
    if (/reason|remark|note/i.test(k)) { if (!out.reason) out.reason = String(v).trim(); }
    else if (/by$|user|login/i.test(k)) { if (!out.by) out.by = String(v).trim(); }
    else if (/_at$|date|time/i.test(k)) { if (!out.at) out.at = String(v).trim(); }
  });
  if (!out.reason && /cancel|void/i.test(String(doc.remarks || ''))) out.reason = String(doc.remarks).trim();
  return out;
}

// Hindi dapat masira ang buong page kung pumalya ang cancelled lookup — babalik lang sa dating listahan
async function mrrMonMergeCancelled(rows) {
  try {
    return await mrrMonMergeCancelledInner(rows);
  } catch (err) {
    console.warn('[MRR Monitoring] cancelled merge failed — ipinapakita ang listahan nang walang CANCELLED', err);
    return rows;
  }
}

async function mrrMonMergeCancelledInner(rows) {
  var docs = await erpFetchAll('documents',
    'select=*&doc_type=eq.MRR&status=in.(CANCELLED,VOID,VOIDED)&order=doc_no.asc') || [];
  if (!docs.length) return rows;

  var docMap = {};
  docs.forEach(function(d) { docMap[d.doc_no] = d; });

  // 1) kung kasama na pala sa view ang cancelled, i-mark lang
  var present = {};
  rows.forEach(function(it) {
    var d = docMap[it.mrr_no];
    if (!d) return;
    present[it.mrr_no] = true;
    it.item_status = 'CANCELLED';
    it.doc_status = 'CANCELLED';
    it.cancel_info = mrrMonCancelInfo(d);
  });

  // 2) idagdag ang wala pa sa view (kunin ang items sa doc_items)
  var missing = docs.filter(function(d) { return !present[d.doc_no]; });
  if (!missing.length) return rows;

  var itemsByDoc = {};
  try {
    var chunks = [];
    for (var i = 0; i < missing.length; i += 60) chunks.push(missing.slice(i, i + 60));
    var res = await Promise.all(chunks.map(function(ch) {
      var list = ch.map(function(d) { return encodeURIComponent(d.doc_no); }).join(',');
      return erpFetchAll('doc_items', 'select=*&doc_no=in.(' + list + ')&order=doc_no.asc,line_no.asc');
    }));
    res.forEach(function(arr) { (arr || []).forEach(function(r) { (itemsByDoc[r.doc_no] = itemsByDoc[r.doc_no] || []).push(r); }); });
  } catch (err) {
    console.warn('[MRR Monitoring] cancelled doc_items lookup failed', err);
  }

  var ts = function(v) { var t = v ? Date.parse(v) : NaN; return isNaN(t) ? 0 : t; };

  // 3) isingit sa tamang pwesto (pareho ng view: pinakabago muna) — hindi ginagalaw ang order ng dati nang rows
  var out = rows.slice();
  missing.sort(function(a, b) { return ts(b.created_at || b.date_prepared) - ts(a.created_at || a.date_prepared); });
  missing.forEach(function(d) {
    var when = d.created_at || d.date_prepared || null;
    var base = {
      mrr_no: d.doc_no,
      mrr_date: when,
      po_no: d.po_no || '',
      vendor: d.vendor || d.client_name || '',
      ref_no: d.prf_no || '',
      sof_no: d.sof_no || '',
      dr_no: d.dr_no || '',
      prepared_by: d.prepared_by || d.requestor || '',
      processed_by: d.processed_by || '',
      received_qty: 0,
      item_status: 'CANCELLED', doc_status: 'CANCELLED',
      cancel_info: mrrMonCancelInfo(d)
    };
    var its = itemsByDoc[d.doc_no] || [];
    var newRows;
    if (!its.length) {
      newRows = [Object.assign({}, base, { line_no: null, item_code: '—', description: '(walang item)', requested_qty: 0, unit: '', remarks: d.remarks || '' })];
    } else {
      newRows = its.map(function(r) {
        return Object.assign({}, base, {
          line_no: r.line_no, item_code: r.item_code, description: r.description || '',
          requested_qty: Number(r.requested_qty || 0), unit: r.unit || '', remarks: r.remarks || ''
        });
      });
    }
    var t = ts(when), pos = out.length;
    for (var j = 0; j < out.length; j++) {
      if (ts(out[j].mrr_date) < t) { pos = j; break; }
    }
    Array.prototype.splice.apply(out, [pos, 0].concat(newRows));
  });
  return out;
}

// ═══════════════════════════════════════════════════════════
// STAGGERED DELIVERY — status batay sa KABUUANG dumating, hindi sa isang MRR lang
// Ang bawat susunod na delivery ng parehong PO + item ay bagong MRR na dala pa rin ang buong PO qty
// (hal. QTY 200, RECV 100). Kapag per-MRR lang ang tingin, laging PARTIAL ang dalawa.
// Dito: pinagsasama ang received ng lahat ng (hindi-cancelled) MRR na may parehong PO + Item Code + PO Qty.
//   Kabuuan >= PO Qty  → COMPLETE ang LAHAT ng line na iyon (pati ang naunang MRR)
//   0 < kabuuan < Qty  → PARTIAL (may Balance na ipapakita)
// Kapag COMPLETE na ang lahat ng line ng isang MRR, COMPLETED na rin ang doc status niya.
// Display lang ito — walang binabago sa database. Walang PO No.? Gagamitin ang status mula sa view.
// ═══════════════════════════════════════════════════════════
function mrrMonNormalizeStatuses(rows) {
  var groups = {};
  rows.forEach(function(it) {
    it._viewStatus = it.item_status;
    it._viewDocStatus = it.doc_status;
    var ds = String(it.doc_status || '').toUpperCase();
    if (ds === 'CANCELLED' || ds === 'VOID' || ds === 'VOIDED') return;
    var po = String(it.po_no || '').trim().toUpperCase();
    var code = String(it.item_code || '').trim().toUpperCase();
    var qty = Number(it.requested_qty || 0);
    if (!po || !code || !(qty > 0)) return;
    var key = po + '|' + code + '|' + qty;
    it._grpKey = key;
    var g = groups[key] || (groups[key] = { recv: 0, qty: qty, mrrs: {} });
    g.recv += Number(it.received_qty || 0);
    g.mrrs[it.mrr_no] = true;
  });

  rows.forEach(function(it) {
    var g = it._grpKey && groups[it._grpKey];
    if (!g) return;
    it._cumRecv = g.recv;
    it._cumQty = g.qty;
    it._cumDocs = Object.keys(g.mrrs).length;
    var eff = g.recv >= g.qty ? 'COMPLETE' : (g.recv > 0 ? 'PARTIAL' : 'PENDING');
    // huwag ibababa ang COMPLETE na galing na sa view
    if (String(it.item_status || '').toUpperCase() === 'COMPLETE') eff = 'COMPLETE';
    it.item_status = eff;
  });

  var byDoc = {};
  rows.forEach(function(it) { (byDoc[it.mrr_no] = byDoc[it.mrr_no] || []).push(it); });
  Object.keys(byDoc).forEach(function(no) {
    var ls = byDoc[no];
    var ds = String(ls[0].doc_status || '').toUpperCase();
    if (ds !== 'PARTIAL' && ds !== 'PENDING') return;
    var allDone = ls.every(function(l) { return String(l.item_status || '').toUpperCase() === 'COMPLETE'; });
    if (allDone) ls.forEach(function(l) { l.doc_status = 'COMPLETED'; });
  });
}

function mrrMonComputeKPIs() {
  var items = _mrrMon.allItems;
  var totalDocs = {};
  var pending = 0, partial = 0, complete = 0;

  var cancelledDocs = {}, cancelledRows = 0;

  items.forEach(function(it) {
    var status = String(it.item_status || '').toUpperCase();
    if (status === 'CANCELLED') {            // hindi bilang sa Total / Items KPI
      cancelledRows++;
      if (it.mrr_no) cancelledDocs[it.mrr_no] = true;
      return;
    }
    if (it.mrr_no) totalDocs[it.mrr_no] = true;

    if (status === 'PENDING') pending++;
    else if (status === 'PARTIAL') partial++;
    else if (status === 'COMPLETE') complete++;
  });

  var totalDocsCount = Object.keys(totalDocs).length;

  // Update KPIs
  var el;
  el = document.getElementById('mrrMonKpiTotal');
  if (el) el.textContent = erpNum(totalDocsCount);
  
  el = document.getElementById('mrrMonKpiPending');
  if (el) el.textContent = erpNum(pending);
  
  el = document.getElementById('mrrMonKpiPartial');
  if (el) el.textContent = erpNum(partial);
  
  el = document.getElementById('mrrMonKpiComplete');
  if (el) el.textContent = erpNum(complete);
  
  el = document.getElementById('mrrMonKpiItems');
  if (el) el.textContent = erpNum(items.length - cancelledRows);

  var nCancelled = Object.keys(cancelledDocs).length;
  el = document.getElementById('mrrMonKpiTotalSub');
  if (el) el.textContent = nCancelled ? 'excl. ' + nCancelled + ' cancelled' : 'All receipts';

  // Update chip counts
  el = document.getElementById('mrrChipCountAll');
  if (el) el.textContent = items.length;
  
  el = document.getElementById('mrrChipCountPending');
  if (el) el.textContent = pending;
  
  el = document.getElementById('mrrChipCountPartial');
  if (el) el.textContent = partial;
  
  el = document.getElementById('mrrChipCountComplete');
  if (el) el.textContent = complete;

  el = document.getElementById('mrrChipCountCancelled');
  if (el) el.textContent = cancelledRows;
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function mrrMonApplyFilters() {
  var search = (document.getElementById('mrrMonSearchInput') ? document.getElementById('mrrMonSearchInput').value : '').toLowerCase().trim();
  var docStatus = (document.getElementById('mrrMonDocStatusFilter') ? document.getElementById('mrrMonDocStatusFilter').value : '');
  var vendor = (document.getElementById('mrrMonVendorFilter') ? document.getElementById('mrrMonVendorFilter').value : '');
  var creator = (document.getElementById('mrrMonCreatorFilter') ? document.getElementById('mrrMonCreatorFilter').value : '');
  var dateFrom = (document.getElementById('mrrMonDateFrom') ? document.getElementById('mrrMonDateFrom').value : '');
  var dateTo = (document.getElementById('mrrMonDateTo') ? document.getElementById('mrrMonDateTo').value : '');

  _mrrMon.filteredItems = _mrrMon.allItems.filter(function(it) {
    // Status filter (from chips)
    if (_mrrMon.activeStatusFilter) {
      var status = String(it.item_status || '').toUpperCase();
      if (status !== _mrrMon.activeStatusFilter) return false;
    }

    // Doc status filter
    if (docStatus && String(it.doc_status || '').toUpperCase() !== docStatus) return false;

    // Vendor filter
    if (vendor && String(it.vendor || '') !== vendor) return false;

    // Creator filter
    if (creator && String(it.prepared_by || '') !== creator) return false;

    // Date range filter
    if (dateFrom || dateTo) {
      var mrrDate = it.mrr_date ? new Date(it.mrr_date) : null;
      if (mrrDate) {
        if (dateFrom) {
          var fromD = new Date(dateFrom + 'T00:00:00');
          if (mrrDate < fromD) return false;
        }
        if (dateTo) {
          var toD = new Date(dateTo + 'T23:59:59');
          if (mrrDate > toD) return false;
        }
      }
    }

    // Search filter
    if (search) {
      var mrrNo = String(it.mrr_no || '').toLowerCase();
      var itemCode = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      var poNo = String(it.po_no || '').toLowerCase();
      var vend = String(it.vendor || '').toLowerCase();
      var prepBy = String(it.prepared_by || '').toLowerCase();
      var drNo = String(it.dr_no || '').toLowerCase();
      var refNo = String(mrrMonRefNo(it) || '').toLowerCase();
      
      if (mrrNo.indexOf(search) === -1 &&
          itemCode.indexOf(search) === -1 &&
          desc.indexOf(search) === -1 &&
          poNo.indexOf(search) === -1 &&
          vend.indexOf(search) === -1 &&
          prepBy.indexOf(search) === -1 &&
          drNo.indexOf(search) === -1 &&
          refNo.indexOf(search) === -1) return false;
    }

    return true;
  });

  _mrrMon.currentPage = 1;
  mrrMonRender();
}

function mrrMonFilterStatus(status) {
  _mrrMon.activeStatusFilter = status;
  
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.toggle('active', chip.getAttribute('data-status') === status);
  });

  mrrMonApplyFilters();
}

function mrrMonFilterStatusChip(btn, status) {
  _mrrMon.activeStatusFilter = status;
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  mrrMonApplyFilters();
}

function mrrMonOnSearch() {
  clearTimeout(_mrrMon.searchTimer);
  _mrrMon.searchTimer = setTimeout(function() {
    mrrMonApplyFilters();
  }, 300);
}

function mrrMonClearFilters() {
  var s = document.getElementById('mrrMonSearchInput');
  var ds = document.getElementById('mrrMonDocStatusFilter');
  var v = document.getElementById('mrrMonVendorFilter');
  var c = document.getElementById('mrrMonCreatorFilter');
  var df = document.getElementById('mrrMonDateFrom');
  var dt = document.getElementById('mrrMonDateTo');
  
  if (s) s.value = '';
  if (ds) ds.value = '';
  if (v) v.value = '';
  if (c) c.value = '';
  if (df) df.value = '';
  if (dt) dt.value = '';
  
  _mrrMon.activeStatusFilter = '';
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.toggle('active', chip.getAttribute('data-status') === '');
  });
  
  mrrMonApplyFilters();
}

async function mrrMonPopulateFilters() {
  // Populate vendors
  try {
    var rows = await erpFetchAll('v_mrr_monitoring', 'select=vendor&vendor=not.is.null&order=vendor.asc,mrr_no.asc,line_no.asc');
    var seen = {};
    var vendors = [];
    (rows || []).forEach(function(r) {
      var v = String(r.vendor || '').trim();
      if (v && !seen[v]) { seen[v] = true; vendors.push(v); }
    });
    var sel = document.getElementById('mrrMonVendorFilter');
    vendors.sort().forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  } catch(e) { console.warn('Vendor filter:', e.message); }

  // Populate creators
  try {
    var rows2 = await erpFetchAll('v_mrr_monitoring', 'select=prepared_by&prepared_by=not.is.null&order=prepared_by.asc,mrr_no.asc,line_no.asc');
    var seen2 = {};
    var creators = [];
    (rows2 || []).forEach(function(r) {
      var v = String(r.prepared_by || '').trim();
      if (v && !seen2[v]) { seen2[v] = true; creators.push(v); }
    });
    var sel2 = document.getElementById('mrrMonCreatorFilter');
    creators.sort().forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel2.appendChild(opt);
    });
  } catch(e) { console.warn('Creator filter:', e.message); }
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function mrrMonRender() {
  var tbody = document.getElementById('mrrMonTableBody');
  if (!tbody) return;

  var total = _mrrMon.filteredItems.length;
  var start = (_mrrMon.currentPage - 1) * _mrrMon.pageSize;
  var end = Math.min(start + _mrrMon.pageSize, total);
  var pageItems = _mrrMon.filteredItems.slice(start, end);

  // Update pagination
  var el;
  el = document.getElementById('mrrMonTableCount'); if (el) el.textContent = total + ' items';
  el = document.getElementById('mrrMonPageTotal'); if (el) el.textContent = total;
  el = document.getElementById('mrrMonPageStart'); if (el) el.textContent = total > 0 ? start + 1 : 0;
  el = document.getElementById('mrrMonPageEnd'); if (el) el.textContent = end;
  el = document.getElementById('mrrMonPageLabel'); if (el) el.textContent = 'Page ' + _mrrMon.currentPage;
  el = document.getElementById('mrrMonBtnPrev'); if (el) el.disabled = (_mrrMon.currentPage <= 1);
  el = document.getElementById('mrrMonBtnNext'); if (el) el.disabled = (end >= total);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No items match your filters.</td></tr>';
    return;
  }

  var html = '';
  pageItems.forEach(function(it) {
    var itemStatus = String(it.item_status || 'PENDING').toUpperCase();
    var rowClass = '';
    var statusBadge = '';
    
    var isCancelled = (itemStatus === 'CANCELLED');
    if (isCancelled) {
      rowClass = 'cancelled-row';
      statusBadge = '<span class="badge bg-secondary"><i class="bi bi-x-octagon-fill me-1"></i>CANCELLED</span>';
    } else if (itemStatus === 'PENDING') {
      rowClass = 'pending-attention';
      statusBadge = '<span class="badge bg-warning text-dark"><i class="bi bi-clock-history me-1"></i>PENDING</span>';
    } else if (itemStatus === 'PARTIAL') {
      rowClass = 'partial-attention';
      statusBadge = '<span class="badge bg-primary"><i class="bi bi-hourglass-split me-1"></i>PARTIAL</span>' +
        (it._cumQty ? '<div class="text-muted" style="font-size:0.68rem;">Balance: <b>' + erpNum(Math.max(it._cumQty - it._cumRecv, 0)) + '</b></div>' : '');
    } else {
      rowClass = 'completed-row';
      statusBadge = '<span class="badge bg-success"><i class="bi bi-check-circle-fill me-1"></i>COMPLETE</span>';
    }

    var dateStr = it.mrr_date ? new Date(it.mrr_date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: '2-digit'
    }) : '—';

    var qty = Number(it.requested_qty || 0);
    var recv = Number(it.received_qty || 0);

    var creatorName = it.prepared_by || it.created_by || '—';
    var processedName = it.processed_by || '—';

    // Remarks — para sa CANCELLED, ang reason ng pag-cancel ang ipapakita
    var remarksCell;
    if (isCancelled) {
      var ci = it.cancel_info || {};
      var cWhen = ci.at ? (isNaN(new Date(ci.at).getTime()) ? ci.at : new Date(ci.at).toLocaleString()) : '';
      var cTip = 'CANCELLED' + (ci.by ? ' by ' + ci.by : '') + (cWhen ? ' · ' + cWhen : '') + '\nReason: ' + (ci.reason || '—');
      remarksCell = '<td title="' + erpEsc(cTip) + '" style="color:#b91c1c;"><i class="bi bi-x-octagon-fill me-1"></i>' +
        erpEsc(truncate(ci.reason || 'walang naka-save na reason', 24)) + '</td>';
    } else {
      remarksCell = '<td title="' + erpEsc(it.remarks || '') + '">' + erpEsc(truncate(it.remarks || '', 20)) + '</td>';
    }

    html += '<tr class="' + rowClass + '">' +
      '<td><code>' + erpEsc(it.mrr_no) + '</code></td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td><code style="font-size:0.72rem;">' + erpEsc(it.po_no || '—') + '</code></td>' +
      '<td>' + erpEsc(truncate(it.vendor || '—', 25)) + '</td>' +
      '<td><code style="font-size:0.72rem;">' + erpEsc(mrrMonRefNo(it) || '—') + '</code></td>' +
      '<td class="text-center">' + (it.line_no || '—') + '</td>' +
      '<td><code style="font-size:0.72rem;">' + erpEsc(it.item_code) + '</code></td>' +
      '<td title="' + erpEsc(it.description || '') + '">' + erpEsc(truncate(it.description || '—', 45)) + '</td>' +
      '<td class="text-center">' + erpNum(qty) + '</td>' +
      '<td class="text-center">' + (!isCancelled && recv > 0 ? '<strong>' + erpNum(recv) + '</strong>' : '—') +
        (it._cumDocs > 1 ? '<div class="text-muted" style="font-size:0.68rem;" title="Kabuuang dumating sa ' + it._cumDocs + ' MRR ng PO na ito">Σ ' + erpNum(it._cumRecv) + ' / ' + erpNum(it._cumQty) + '</div>' : '') +
      '</td>' +
      '<td class="text-center">' + erpEsc(it.unit || '—') + '</td>' +
      '<td class="text-center">' + statusBadge + '</td>' +
      '<td><span class="creator-badge"><i class="bi bi-person"></i> ' + erpEsc(truncate(creatorName, 18)) + '</span></td>' +
      '<td>' + erpEsc(truncate(processedName, 18)) + '</td>' +
      remarksCell +
    '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// AUTO-REFRESH
// ═══════════════════════════════════════════════════════════
function mrrMonStartAutoRefresh() {
  if (!_mrrMon.autoRefreshEnabled) return;
  mrrMonStopAutoRefresh();
  _mrrMon.autoRefreshTimer = setInterval(function() {
    if (!document.hidden && _mrrMon.autoRefreshEnabled) {
      console.log('[MRR Monitoring] Auto-refreshing...');
      mrrMonLoad();
    }
  }, _mrrMon.REFRESH_INTERVAL);
  console.log('[MRR Monitoring] Auto-refresh started (every ' + (_mrrMon.REFRESH_INTERVAL/1000) + 's)');
}

function mrrMonStopAutoRefresh() {
  if (_mrrMon.autoRefreshTimer) {
    clearInterval(_mrrMon.autoRefreshTimer);
    _mrrMon.autoRefreshTimer = null;
  }
}

function mrrMonToggleAuto() {
  _mrrMon.autoRefreshEnabled = !_mrrMon.autoRefreshEnabled;
  var icon = document.getElementById('autoToggleIcon');
  var textEl = document.getElementById('liveUpdateText');
  
  if (_mrrMon.autoRefreshEnabled) {
    if (icon) icon.className = 'bi bi-pause-fill';
    if (textEl) textEl.textContent = 'Live';
    mrrMonStartAutoRefresh();
    erpShowToast('✅ Auto-refresh ON', 'success');
  } else {
    if (icon) icon.className = 'bi bi-play-fill';
    if (textEl) textEl.textContent = 'Paused';
    mrrMonStopAutoRefresh();
    erpShowToast('⏸️ Auto-refresh OFF', 'info');
  }
}

// ═══════════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════════
function mrrMonPagePrev() {
  if (_mrrMon.currentPage > 1) {
    _mrrMon.currentPage--;
    mrrMonRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function mrrMonPageNext() {
  var maxPage = Math.ceil(_mrrMon.filteredItems.length / _mrrMon.pageSize);
  if (_mrrMon.currentPage < maxPage) {
    _mrrMon.currentPage++;
    mrrMonRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ═══════════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════════
function mrrMonRefresh() {
  erpShowToast('Refreshing...', 'info');
  mrrMonLoad();
  mrrMonCheckHealth();
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function mrrMonExport() {
  if (_mrrMon.filteredItems.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }

  var headers = [
    'MRR No.', 'Date', 'PO No.', 'Vendor', 'Ref No.', 'Item#', 'Item Code',
    'Description', 'Qty', 'Received', 'Unit', 'Status',
    'Created By', 'Processed By', 'DR No.', 'Remarks'
  ];

  var rows = _mrrMon.filteredItems.map(function(it) {
    return [
      it.mrr_no || '',
      it.mrr_date ? new Date(it.mrr_date).toLocaleDateString() : '',
      it.po_no || '',
      it.vendor || '',
      mrrMonRefNo(it),
      it.line_no || '',
      it.item_code || '',
      it.description || '',
      it.requested_qty || 0,
      it.received_qty || 0,
      it.unit || '',
      it.item_status || '',
      it.prepared_by || '',
      it.processed_by || '',
      it.dr_no || '',
      (String(it.item_status || '').toUpperCase() === 'CANCELLED' ? 'CANCELLED: ' + ((it.cancel_info && it.cancel_info.reason) || '') : (it.remarks || ''))
    ];
  });

  var csv = headers.map(_csvEscMrrMon).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEscMrrMon).join(',') + '\n'; });

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'MRR_Monitoring_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  erpShowToast('✅ Exported ' + rows.length + ' rows', 'success');
}

function _csvEscMrrMon(val) {
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
function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.substring(0, max) + '…';
}

function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

console.log('✅ mrr-monitoring.js v1.0 loaded');

// ═══════════════════════════════════════════════════════════
// TRANSMITTAL LOGIC (v2 with Selection & DB Tracking)
// ═══════════════════════════════════════════════════════════
var _transmitMRRList = []; // Temporary storage para sa checklist

window.openTransmittalModal = async function() {
  if (!_mrrMon.filteredItems || _mrrMon.filteredItems.length === 0) {
    erpShowToast('Walang items na nakikita para i-transmit.', 'warning');
    return;
  }
  
  resetTransmittalModal();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('transmittalModal')).show();
  
  var tbody = document.getElementById('transmittalSelectionBody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3"><div class="erp-spinner" style="margin:0 auto;"></div></td></tr>';
  
  try {
    // 1. Kunin ang unique MRRs mula sa currently filtered items (+ item signature para sa duplicate check)
    var uniqueMRRs = {};
    _mrrMon.filteredItems.forEach(function(it) {
      var mrrNo = it.mrr_no;
      if (!mrrNo) return;
      var m = uniqueMRRs[mrrNo];
      if (!m) {
        m = uniqueMRRs[mrrNo] = {
          mrrNo: mrrNo,
          date: it.mrr_date || it.processed_at || it.created_at,
          supplier: it.vendor || '—',
          poNo: it.po_no || it.ref_no || '—',
          cancelled: String(it.item_status || '').toUpperCase() === 'CANCELLED',
          sig: []
        };
      }
      m.sig.push(String(it.item_code || '') + ':' + Number(it.received_qty || 0));
    });
    
    var mrrList = Object.values(uniqueMRRs);
    mrrList.sort(function(a, b) { return String(b.mrrNo).localeCompare(String(a.mrrNo)); });
    
    // 2. Kunin ang transmitted / cancelled status sa DB para maiwasan ang doble
    if (mrrList.length > 0) {
      var mrrNosStr = mrrList.map(function(m) { return m.mrrNo; }).join(',');
      var docsRes = await erpFetch('documents', 'select=doc_no,is_transmitted,transmittal_no,status&doc_no=in.(' + encodeURIComponent(mrrNosStr) + ')&limit=5000');
      
      var dmap = {};
      (docsRes || []).forEach(function(d) { dmap[d.doc_no] = d; });
      
      // 3. I-merge ang status + hanapin ang posibleng duplicate (parehong vendor + PO + petsa + items)
      var dupKey = {};
      mrrList.forEach(function(m) {
        var d = dmap[m.mrrNo] || {};
        m.isTransmitted = d.is_transmitted === true;
        m.trn = d.transmittal_no || '';
        if (String(d.status || '').toUpperCase() === 'CANCELLED') m.cancelled = true;
        m.key = [m.supplier, m.poNo, String(m.date || '').slice(0, 10), m.sig.slice().sort().join('|')].join('~');
        if (!m.cancelled) (dupKey[m.key] = dupKey[m.key] || []).push(m.mrrNo);
      });
      mrrList.forEach(function(m) {
        var same = m.cancelled ? [] : (dupKey[m.key] || []).filter(function(n) { return n !== m.mrrNo; });
        m.dupOf = same;
      });
      _transmitMRRList = mrrList;
    } else {
      _transmitMRRList = [];
    }
    
    renderTransmittalSelection();
    
  } catch(err) {
    console.error('[openTransmittalModal]', err);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-3">Failed to load statuses.</td></tr>';
  }
};

function renderTransmittalSelection() {
  var tbody = document.getElementById('transmittalSelectionBody');
  var html = '';
  
  if (_transmitMRRList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted">No MRRs found.</td></tr>';
    return;
  }
  
  _transmitMRRList.forEach(function(m, idx) {
    // Auto-check kung HINDI PA naka-transmit, hindi cancelled, at hindi posibleng duplicate
    var isDup = m.dupOf && m.dupOf.length > 0;
    var isChecked = !m.isTransmitted && !m.cancelled;
    var rowStyle = m.cancelled ? ' style="background:#fef2f2;opacity:0.65;"' : (m.isTransmitted ? ' style="background:#f8fafc;opacity:0.8;"' : (isDup ? ' style="background:#fffbeb;"' : ''));
    
    var statusBadge = m.cancelled
      ? '<span class="badge bg-danger">CANCELLED</span>'
      : m.isTransmitted
        ? '<span class="badge bg-secondary" title="Kapag pinili ulit, ililipat sa bagong transmittal">' + erpEsc(m.trn || 'TRANSMITTED') + '</span>'
        : '<span class="badge bg-success">READY</span>';
    if (isDup) statusBadge += '<div><span class="badge bg-warning text-dark mt-1" title="Parehong vendor, PO, petsa at items: ' + erpEsc(m.dupOf.join(', ')) + '"><i class="bi bi-exclamation-triangle-fill me-1"></i>POSSIBLE DUPLICATE of ' + erpEsc(m.dupOf.join(', ')) + '</span></div>';
      
    var dateStr = '—';
    if (m.date) {
      try {
        dateStr = new Date(m.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
      } catch(e) {}
    }
    
    html += '<tr' + rowStyle + '>' +
      '<td class="text-center align-middle">' +
        '<input type="checkbox" class="transmit-mrr-chk" data-idx="' + idx + '" ' +
        (isChecked ? 'checked' : '') + (m.cancelled ? ' disabled' : '') + '>' +
      '</td>' +
      '<td class="align-middle"><strong>' + erpEsc(m.mrrNo) + '</strong></td>' +
      '<td class="align-middle">' + erpEsc(dateStr) + '</td>' +
      '<td class="align-middle">' + erpEsc(m.supplier) + '</td>' +
      '<td class="text-center align-middle">' + statusBadge + '</td>' +
    '</tr>';
  });
  
  tbody.innerHTML = html;
}

function toggleAllTransmittalMRRs(checked) {
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(chk) {
    if (!chk.disabled) chk.checked = checked; 
  });
}

function backToTransmittalSelection() {
  document.getElementById('transmittalSelectionView').style.display = 'block';
  document.getElementById('transmittalPreviewView').style.display = 'none';
  document.getElementById('btnProceedToPreview').style.display = 'inline-block';
  document.getElementById('btnPrintTransmittal').style.display = 'none';
}

function buildTransmittalPreview() {
  var selectedMRRs = [];
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(chk) {
    if (chk.checked) {
      var idx = parseInt(chk.getAttribute('data-idx'), 10);
      selectedMRRs.push(_transmitMRRList[idx]);
    }
  });
  
  if (selectedMRRs.length === 0) {
    erpShowToast('Pumili ng kahit isang MRR para i-transmit.', 'warning');
    return;
  }
  
  // Setup Date
  document.getElementById('transmittalDate').textContent = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });
  
  // Setup Prepared By
  document.getElementById('transmittalPreparedBy').textContent = localStorage.getItem('ivm_userFullname') || 'ADMIN';
  
  // Render Table Rows
  var tbody = document.getElementById('transmittalBody');
  var html = '';
  selectedMRRs.forEach(function(m) {
    var dateStr = '—';
    if (m.date) {
      try { dateStr = new Date(m.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }); } catch(e) {}
    }
    html += '<tr style="border-bottom: 1px solid #e2e8f0;">' +
      '<td style="padding: 10px 8px; text-align: center; font-weight: 600;">' + erpEsc(m.mrrNo) + '</td>' +
      '<td style="padding: 10px 8px; text-align: center;">' + erpEsc(dateStr) + '</td>' +
      '<td style="padding: 10px 8px;">' + erpEsc(m.supplier) + '</td>' +
      '<td style="padding: 10px 8px; text-align: center;">' + erpEsc(m.poNo) + '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
  
  // Switch Views
  document.getElementById('transmittalSelectionView').style.display = 'none';
  document.getElementById('transmittalPreviewView').style.display = 'block';
  document.getElementById('btnProceedToPreview').style.display = 'none';
  document.getElementById('btnPrintTransmittal').style.display = 'inline-block';
}

window.printTransmittal = async function() {
  var printContents = document.getElementById('transmittalSheet').innerHTML;
  
  // 1. Kunin ang mga naka-check para i-save sa DB
  var selectedMRRs = [];
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(chk) {
    if (chk.checked) {
      var idx = parseInt(chk.getAttribute('data-idx'), 10);
      selectedMRRs.push(_transmitMRRList[idx].mrrNo);
    }
  });
  
  // 2. I-flag as TRANSMITTED sa database
  if (selectedMRRs.length > 0) {
    try {
      var mrrNosStr = selectedMRRs.join(',');
      await fetch(erpUrl('documents?doc_no=in.(' + encodeURIComponent(mrrNosStr) + ')'), {
        method: 'PATCH',
        headers: erpHeaders(),
        body: JSON.stringify({
          is_transmitted: true,
          transmitted_at: new Date().toISOString()
        })
      });
      console.log('Marked as transmitted:', selectedMRRs);
      erpShowToast('✅ ' + selectedMRRs.length + ' MRR(s) marked as transmitted.', 'success');
    } catch(err) {
      console.warn('Failed to mark as transmitted:', err);
    }
  }
  
  // 3. Print Logic
  var printWindow = window.open('', '_blank');
  printWindow.document.write(
    '<html><head><title>MRR Transmittal</title>' +
    '<style>' +
    '  body { font-family: "Inter", Arial, sans-serif; padding: 20px; }' +
    '  table { width: 100%; border-collapse: collapse; font-size: 12px; }' +
    '  th, td { padding: 8px; text-align: left; }' +
    '  th { border-top: 2px solid #000; border-bottom: 2px solid #000; text-align: center; font-weight: bold; }' +
    '  tr { border-bottom: 1px solid #ccc; }' +
    '  h3 { margin-bottom: 20px; }' +
    '  @media print { @page { size: portrait; margin: 0.5in; } body { padding: 0; } }' +
    '</style></head><body>' + printContents + '</body></html>'
  );
  
  printWindow.document.close();
  printWindow.focus();
  
  setTimeout(function() {
    printWindow.print();
    printWindow.close();
    
    // I-refresh ang MRR Monitor para maging "TRANSMITTED" na sila sa susunod
    if (typeof mrrMonLoad === 'function') mrrMonLoad(); 
    
    // Isara ang modal
    bootstrap.Modal.getInstance(document.getElementById('transmittalModal')).hide();
  }, 250);
};

function resetTransmittalModal() {
  backToTransmittalSelection();
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(cb) { cb.checked = true; });
  var selectAllCb = document.getElementById('transmitSelectAll');
  if (selectAllCb) selectAllCb.checked = false;
}
// ═══════════════════════════════════════════════════════════
// GLOBAL VAR FOR CURRENT TRN
// ═══════════════════════════════════════════════════════════
var _currentTransmittalNo = '';

// ═══════════════════════════════════════════════════════════
// UPDATE PREVIEW PARA MAKAKUHA NG TRN
// ═══════════════════════════════════════════════════════════
// Hanapin ang existing buildTransmittalPreview at i-replace ng ganito:
window.buildTransmittalPreview = async function() {
  var selectedMRRs = [];
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(chk) {
    if (chk.checked) {
      var idx = parseInt(chk.getAttribute('data-idx'), 10);
      selectedMRRs.push(_transmitMRRList[idx]);
    }
  });
  
  if (selectedMRRs.length === 0) {
    erpShowToast('Pumili ng kahit isang MRR para i-transmit.', 'warning');
    return;
  }
  
  // Kunin ang susunod na TRN Number
  try {
    var res = await fetch(erpUrl('rpc/get_next_transmittal_no'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({})
    });
    if (res.ok) {
      _currentTransmittalNo = await res.json();
    } else {
      _currentTransmittalNo = 'TRN-' + new Date().toISOString().slice(0, 7) + '-XXX';
    }
  } catch(e) {
    _currentTransmittalNo = 'TRN-ERROR';
  }

  // Setup Date & TRN
  document.getElementById('transmittalDate').textContent = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });
  document.getElementById('transmittalNo').textContent = _currentTransmittalNo;
  
  // Setup Prepared By
  document.getElementById('transmittalPreparedBy').textContent = localStorage.getItem('ivm_userFullname') || 'ADMIN';
  
  // Render Table Rows
  var tbody = document.getElementById('transmittalBody');
  var html = '';
  selectedMRRs.forEach(function(m) {
    var dateStr = '—';
    if (m.date) {
      try { dateStr = new Date(m.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }); } catch(e) {}
    }
    html += '<tr style="border-bottom: 1px solid #e2e8f0;">' +
      '<td style="padding: 10px 8px; text-align: center; font-weight: 600;">' + erpEsc(m.mrrNo) + '</td>' +
      '<td style="padding: 10px 8px; text-align: center;">' + erpEsc(dateStr) + '</td>' +
      '<td style="padding: 10px 8px;">' + erpEsc(m.supplier) + '</td>' +
      '<td style="padding: 10px 8px; text-align: center;">' + erpEsc(m.poNo) + '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
  
  // Switch Views
  document.getElementById('transmittalSelectionView').style.display = 'none';
  document.getElementById('transmittalPreviewView').style.display = 'block';
  document.getElementById('btnProceedToPreview').style.display = 'none';
  document.getElementById('btnPrintTransmittal').style.display = 'inline-block';
};

// ═══════════════════════════════════════════════════════════
// UPDATE PRINT FUNCTION PARA MA-SAVE SA DB
// ═══════════════════════════════════════════════════════════
// Hanapin ang existing printTransmittal at palitan:
window.printTransmittal = async function() {
  if (_trnBusy) return;                      // iwas double-click → double TRN
  var printContents = document.getElementById('transmittalSheet').innerHTML;
  
  var selected = [];
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(chk) {
    if (chk.checked) {
      var idx = parseInt(chk.getAttribute('data-idx'), 10);
      selected.push(_transmitMRRList[idx]);
    }
  });
  if (!selected.length) { erpShowToast('Pumili ng kahit isang MRR.', 'warning'); return; }

  var moved = selected.filter(function(m) { return m.isTransmitted && m.trn; });
  if (moved.length && !confirm(moved.length + ' MRR ang nasa ibang transmittal na (' +
      moved.map(function(m) { return m.mrrNo + ' → ' + m.trn; }).join(', ') +
      ').\n\nIlilipat sila sa ' + _currentTransmittalNo + '. Tuloy?')) return;
  var dups = selected.filter(function(m) { return m.dupOf && m.dupOf.length; });
  if (dups.length && !confirm('Possible duplicate ang: ' + dups.map(function(m) { return m.mrrNo + ' (kapareho ng ' + m.dupOf.join(', ') + ')'; }).join('; ') +
      '\n\nSigurado ka bang isasama sa transmittal?\n(Kung duplicate, i-Cancel muna ang sobra sa MRR List.)')) return;

  _trnBusy = true;
  var btn = document.getElementById('btnPrintTransmittal'), btnHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...'; }
  try {
    var currentUser = localStorage.getItem('ivm_userFullname') || 'ADMIN';
    
    // 1. Insert sa mrr_transmittals table
    var r1 = await fetch(erpUrl('mrr_transmittals'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify({
        transmittal_no: _currentTransmittalNo,
        transmittal_date: new Date().toISOString().split('T')[0],
        prepared_by: currentUser
      })
    });
    if (!r1.ok) throw new Error('Hindi na-save ang transmittal (HTTP ' + r1.status + ')');

    // 2. I-link ang mga MRR sa TRN (may check na talagang na-update)
    var nos = selected.map(function(m) { return m.mrrNo; });
    await erpTrn.attach(nos, _currentTransmittalNo, 'Created');
    erpShowToast('✅ Transmittal ' + _currentTransmittalNo + ' saved (' + nos.length + ' MRR)!', 'success');
  } catch(err) {
    console.warn('Failed to save transmittal:', err);
    erpShowToast('❌ ' + err.message + '. Hindi pa naka-print — subukan ulit.', 'danger');
    _trnBusy = false;
    if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }
    return;
  }
  _trnBusy = false;
  if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }

  _trnOpenPrint(printContents);
  setTimeout(function() {
    if (typeof mrrMonLoad === 'function') mrrMonLoad(); 
    var m = bootstrap.Modal.getInstance(document.getElementById('transmittalModal')); if (m) m.hide();
  }, 300);
};

var _trnBusy = false;
function _trnOpenPrint(printContents) {
  var printWindow = window.open('', '_blank');
  if (!printWindow) { erpShowToast('Na-block ng browser ang print window. Payagan ang pop-up, tapos gamitin ang Reprint sa Transmittal History.', 'warning'); return; }
  printWindow.document.write(
    '<html><head><title>MRR Transmittal</title>' +
    '<style>' +
    '  body { font-family: "Inter", Arial, sans-serif; padding: 20px; }' +
    '  table { width: 100%; border-collapse: collapse; font-size: 12px; }' +
    '  th, td { padding: 8px; text-align: left; }' +
    '  th { border-top: 2px solid #000; border-bottom: 2px solid #000; text-align: center; font-weight: bold; }' +
    '  tr { border-bottom: 1px solid #ccc; }' +
    '  h3 { margin-bottom: 20px; }' +
    '  @media print { @page { size: portrait; margin: 0.5in; } body { padding: 0; } }' +
    '</style></head><body>' + printContents + '</body></html>'
  );
  printWindow.document.close();
  printWindow.focus();
  setTimeout(function() { printWindow.print(); printWindow.close(); }, 250);
}

// ═══════════════════════════════════════════════════════════
// TRANSMITTAL HISTORY LOGIC  (view • reprint • release • add MRR • cancel TRN)
// ═══════════════════════════════════════════════════════════
function _trnCanWrite() {
  var r = localStorage.getItem('ivm_userRole') || '';
  return r !== 'procurement' && r !== 'finance';
}
function _trnJs(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function _trnDate(d) { try { return d ? new Date(d).toLocaleDateString() : '—'; } catch (e) { return '—'; } }

window.openTransmittalHistoryModal = async function() {
  var modalEl = document.getElementById('transmittalHistoryModal');
  var tbody = document.getElementById('transmittalHistoryBody');
  
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-3"><div class="erp-spinner" style="margin:0 auto;"></div></td></tr>';
  
  try {
    var rows = await erpFetch('mrr_transmittals', 'select=*&order=created_at.desc&limit=100');
    
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-3 text-muted">No transmittals generated yet.</td></tr>';
      return;
    }

    // bilang ng MRR bawat TRN
    var counts = {};
    try {
      var docs = await erpFetch('documents', 'select=doc_no,transmittal_no&transmittal_no=in.(' +
        encodeURIComponent(rows.map(function(r) { return r.transmittal_no; }).join(',')) + ')&limit=5000');
      (docs || []).forEach(function(d) { counts[d.transmittal_no] = (counts[d.transmittal_no] || 0) + 1; });
    } catch (e) { counts = null; }
    
    var canW = _trnCanWrite(), html = '';
    rows.forEach(function(r) {
      var safeTrn = _trnJs(r.transmittal_no);
      var n = counts ? (counts[r.transmittal_no] || 0) : null;
      var badge = n === null ? '—' : (n === 0 ? '<span class="badge bg-secondary" title="Lahat ng MRR ay na-release">EMPTY</span>' : '<span class="badge bg-primary">' + n + '</span>');
      
      html += '<tr>' +
        '<td><strong style="color:#dc2626;">' + erpEsc(r.transmittal_no) + '</strong></td>' +
        '<td>' + erpEsc(_trnDate(r.transmittal_date)) + '</td>' +
        '<td>' + erpEsc(r.prepared_by) + '</td>' +
        '<td class="text-center">' + badge + '</td>' +
        '<td class="text-center" style="white-space:nowrap;">' +
          '<button class="btn btn-sm btn-outline-primary me-1" onclick="viewTransmittalMRRs(\'' + safeTrn + '\')" title="View / manage MRRs">' +
            '<i class="bi bi-eye"></i>' +
          '</button>' +
          '<button class="btn btn-sm btn-outline-dark me-1" onclick="trnReprint(\'' + safeTrn + '\')" title="Reprint"' + (n === 0 ? ' disabled' : '') + '>' +
            '<i class="bi bi-printer"></i>' +
          '</button>' +
          (canW ? '<button class="btn btn-sm btn-outline-danger" onclick="trnReleaseAll(\'' + safeTrn + '\')" title="Cancel transmittal — release all MRRs"' + (n === 0 ? ' disabled' : '') + '>' +
            '<i class="bi bi-x-octagon"></i>' +
          '</button>' : '') +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  } catch(err) {
    console.error('[openTransmittalHistoryModal]', err);
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-3">Failed to load history.</td></tr>';
  }
};

var _trnViewing = '';
window.viewTransmittalMRRs = async function(trnNo) {
  var modalEl = document.getElementById('viewTrnMRRsModal');
  var tbody = document.getElementById('viewTrnMRRsBody');
  var titleEl = document.getElementById('viewTrnTitle');
  
  _trnViewing = trnNo;
  titleEl.textContent = trnNo;
  var add = document.getElementById('trnAddBox'); if (add) add.style.display = _trnCanWrite() ? '' : 'none';
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3"><div class="erp-spinner" style="margin:0 auto;"></div></td></tr>';
  
  try {
    var rows = await erpFetch('documents', 'select=doc_no,vendor,po_no,receiving_date,status&transmittal_no=eq.' + encodeURIComponent(trnNo) + '&order=doc_no.asc');
    
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted">No MRRs in this transmittal (all released).</td></tr>';
      return;
    }
    
    var canW = _trnCanWrite(), html = '';
    rows.forEach(function(r) {
      var st = String(r.status || '').toUpperCase();
      html += '<tr>' +
        '<td><strong>' + erpEsc(r.doc_no) + '</strong>' + (st === 'CANCELLED' ? ' <span class="badge bg-danger">CANCELLED</span>' : '') + '</td>' +
        '<td>' + erpEsc(r.vendor || '—') + '</td>' +
        '<td>' + erpEsc(r.po_no || '—') + '</td>' +
        '<td>' + erpEsc(_trnDate(r.receiving_date)) + '</td>' +
        '<td class="text-center">' + (canW ? '<button class="btn btn-sm btn-outline-danger py-0" onclick="trnReleaseMrr(\'' + _trnJs(trnNo) + '\',\'' + _trnJs(r.doc_no) + '\')" title="Alisin sa transmittal para ma-edit / ma-void">' +
          '<i class="bi bi-box-arrow-left me-1"></i>Release</button>' : '') + '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  } catch(err) {
    console.error('[viewTransmittalMRRs]', err);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-3">Failed to load MRRs.</td></tr>';
  }
};

function _trnAfterChange() {
  if (_trnViewing) window.viewTransmittalMRRs(_trnViewing);
  if (document.getElementById('transmittalHistoryModal').classList.contains('show')) window.openTransmittalHistoryModal();
  if (typeof mrrMonLoad === 'function') mrrMonLoad();
}

// Alisin ang isang MRR sa transmittal (para ma-edit / ma-cancel)
window.trnReleaseMrr = async function(trnNo, docNo) {
  var reason = prompt('Release ' + docNo + ' mula sa ' + trnNo + '?\n\nMagiging puwede na itong i-edit o i-cancel sa MRR List. Ang naka-print na ' + trnNo + ' ay hindi na tugma.\n\nReason (required):');
  if (reason === null) return;
  reason = reason.trim();
  if (!reason) { erpShowToast('Reason is required', 'warning'); return; }
  try {
    await erpTrn.release([docNo], reason, trnNo);
    erpShowToast('✅ ' + docNo + ' released from ' + trnNo + '. Puwede na itong i-edit / i-cancel.', 'success');
    _trnAfterChange();
  } catch (e) { erpShowToast('❌ ' + e.message, 'danger'); }
};

// I-cancel ang buong transmittal — ilalabas lahat ng MRR
window.trnReleaseAll = async function(trnNo) {
  var reason = prompt('Cancel ang ' + trnNo + '?\n\nLahat ng MRR sa loob nito ay ire-release at puwede nang i-transmit ulit sa bagong transmittal o i-edit.\n\nReason (required):');
  if (reason === null) return;
  reason = reason.trim();
  if (!reason) { erpShowToast('Reason is required', 'warning'); return; }
  try {
    var rows = await erpFetch('documents', 'select=doc_no&transmittal_no=eq.' + encodeURIComponent(trnNo) + '&limit=5000');
    var nos = (rows || []).map(function(r) { return r.doc_no; });
    if (!nos.length) { erpShowToast('Walang MRR sa transmittal na ito.', 'info'); return; }
    if (!confirm('I-release ang ' + nos.length + ' MRR mula sa ' + trnNo + '?')) return;
    await erpTrn.release(nos, 'TRN cancelled: ' + reason, trnNo);
    erpTrn.log('CANCEL_TRN', trnNo, null, reason);
    erpShowToast('✅ ' + trnNo + ' cancelled — ' + nos.length + ' MRR released.', 'success');
    _trnAfterChange();
  } catch (e) { erpShowToast('❌ ' + e.message, 'danger'); }
};

// Magdagdag ng MRR sa existing transmittal (hal. nakalimutang isama)
window.trnAddMrr = async function() {
  var inp = document.getElementById('trnAddInput'), trnNo = _trnViewing;
  var no = String((inp && inp.value) || '').trim().toUpperCase();
  if (!no) { erpShowToast('I-type ang MRR No. (hal. MRR0005400)', 'warning'); return; }
  try {
    var rows = await erpFetch('documents', 'select=doc_no,status,is_transmitted,transmittal_no&doc_type=eq.MRR&doc_no=eq.' + encodeURIComponent(no) + '&limit=1');
    var d = rows && rows[0];
    if (!d) throw new Error(no + ' ay hindi nakita.');
    if (String(d.status || '').toUpperCase() === 'CANCELLED') throw new Error(no + ' ay CANCELLED — hindi puwedeng i-transmit.');
    if (d.is_transmitted && d.transmittal_no === trnNo) throw new Error(no + ' ay nasa ' + trnNo + ' na.');
    if (d.is_transmitted && !confirm(no + ' ay nasa ' + d.transmittal_no + ' na.\nIlipat sa ' + trnNo + '?')) return;
    await erpTrn.attach([no], trnNo, 'Added to existing TRN' + (d.transmittal_no ? ' (from ' + d.transmittal_no + ')' : ''));
    if (inp) inp.value = '';
    erpShowToast('✅ ' + no + ' added to ' + trnNo + '. (Mag-Reprint para updated ang kopya.)', 'success');
    _trnAfterChange();
  } catch (e) { erpShowToast('❌ ' + e.message, 'danger'); }
};

// I-print ulit ang naka-save na transmittal (kasalukuyang laman nito)
window.trnReprint = async function(trnNo) {
  trnNo = trnNo || _trnViewing;
  try {
    var t = await erpFetch('mrr_transmittals', 'select=*&transmittal_no=eq.' + encodeURIComponent(trnNo) + '&limit=1');
    var rows = await erpFetch('documents', 'select=doc_no,vendor,po_no,receiving_date,status&transmittal_no=eq.' + encodeURIComponent(trnNo) + '&order=doc_no.asc');
    rows = (rows || []).filter(function(r) { return String(r.status || '').toUpperCase() !== 'CANCELLED'; });
    if (!rows.length) { erpShowToast('Walang MRR sa ' + trnNo + ' na ipi-print.', 'warning'); return; }
    var h = (t && t[0]) || {};
    document.getElementById('transmittalNo').textContent = trnNo;
    document.getElementById('transmittalDate').textContent = new Date(h.transmittal_date || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('transmittalPreparedBy').textContent = h.prepared_by || '—';
    document.getElementById('transmittalBody').innerHTML = rows.map(function(m) {
      return '<tr style="border-bottom: 1px solid #e2e8f0;">' +
        '<td style="padding: 10px 8px; text-align: center; font-weight: 600;">' + erpEsc(m.doc_no) + '</td>' +
        '<td style="padding: 10px 8px; text-align: center;">' + erpEsc(_trnDate(m.receiving_date)) + '</td>' +
        '<td style="padding: 10px 8px;">' + erpEsc(m.vendor || '—') + '</td>' +
        '<td style="padding: 10px 8px; text-align: center;">' + erpEsc(m.po_no || '—') + '</td>' +
      '</tr>';
    }).join('');
    _trnOpenPrint(document.getElementById('transmittalSheet').innerHTML);
  } catch (e) { erpShowToast('❌ Reprint failed: ' + e.message, 'danger'); }
};
