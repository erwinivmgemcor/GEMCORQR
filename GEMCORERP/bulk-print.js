// ============================================================
// GEMCOR ERP — Bulk Print (MRR / MRIF lists)
// Checkbox selection + "Print Selected": one preview with every selected
// document, one document per page, one Print / Save PDF click.
//
// Usage (in the list page's js):
//   erpBulkInit({ docType:'MRR', tbodyId:'mrrTableBody',
//                 getFiltered:function(){return _mrrFilteredDocs;},
//                 getPage:function(){return pageItems;} });
//   row cell : erpBulkCellHtml(d)         (first <td> of every row)
//   after render: erpBulkSync()
// ============================================================
(function () {
  var MAX_BATCH = 100;      // max documents per print job
  var CONCURRENCY = 5;      // parallel document fetches
  var cfg = null;
  var sel = {};             // doc_no -> true

  function esc(s) { return (typeof erpEsc === 'function') ? erpEsc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function toast(m) { if (typeof erpPrintShowToast === 'function') erpPrintShowToast(m); else console.log('[BulkPrint]', m); }
  function isCancelled(d) { return String(d.status || '').toUpperCase() === 'CANCELLED'; }
  function selectable(d) { return d && d.doc_no && !isCancelled(d); }
  function count() { return Object.keys(sel).length; }

  function injectStyles() {
    if (document.getElementById('erpBulkStyles')) return;
    var st = document.createElement('style');
    st.id = 'erpBulkStyles';
    st.textContent =
      '.erp-bulk-cb{width:16px;height:16px;cursor:pointer;accent-color:#4f46e5;vertical-align:middle;}' +
      '.erp-bulk-cb:disabled{cursor:not-allowed;opacity:.35;}' +
      '.erp-table th.col-check,.erp-table td.col-check{width:1%;min-width:38px;max-width:44px;white-space:nowrap;text-align:center;padding-left:8px;padding-right:4px;}' +
      'tr.erp-bulk-selected{background:#eef2ff !important;}' +
      '.erp-bulk-bar{display:none;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 16px;background:#eef2ff;border-bottom:1px solid #c7d2fe;font-size:.85rem;color:#312e81;}' +
      '.erp-bulk-bar .erp-bulk-count{font-weight:700;}' +
      '.erp-bulk-bar button{border:1.5px solid #c7d2fe;background:#fff;color:#3730a3;border-radius:6px;padding:4px 10px;font-size:.8rem;font-weight:600;cursor:pointer;}' +
      '.erp-bulk-bar button:hover{background:#e0e7ff;}' +
      '.erp-bulk-bar button.erp-bulk-go{background:#4f46e5;border-color:#4f46e5;color:#fff;margin-left:auto;}' +
      '.erp-bulk-bar button.erp-bulk-go:hover{background:#4338ca;}' +
      '#erpBulkProgress{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2000;background:#111827;color:#fff;padding:10px 18px;border-radius:10px;font-size:.85rem;box-shadow:0 8px 24px rgba(0,0,0,.25);}';
    document.head.appendChild(st);
  }

  function ensureBar() {
    var bar = document.getElementById('erpBulkBar');
    if (bar) return bar;
    var tbody = document.getElementById(cfg.tbodyId);
    var wrap = tbody && tbody.closest('.erp-table-wrap');
    if (!wrap) return null;
    bar = document.createElement('div');
    bar.id = 'erpBulkBar';
    bar.className = 'erp-bulk-bar';
    wrap.parentNode.insertBefore(bar, wrap);
    return bar;
  }

  function ensureHeaderCheckbox() {
    var tbody = document.getElementById(cfg.tbodyId);
    var table = tbody && tbody.closest('table');
    var tr = table && table.querySelector('thead tr');
    if (!tr || document.getElementById('erpBulkAll')) return;
    var th = document.createElement('th');
    th.className = 'col-check';
    th.innerHTML = '<input type="checkbox" id="erpBulkAll" class="erp-bulk-cb" title="Select all on this page" onchange="erpBulkTogglePage(this.checked)">';
    tr.insertBefore(th, tr.firstChild);
  }

  // ── public: first <td> of each row ──
  window.erpBulkCellHtml = function (d) {
    var ok = selectable(d);
    var safe = esc(d.doc_no || '');
    return '<td class="col-check"><input type="checkbox" class="erp-bulk-cb" data-doc="' + safe + '"' +
      (ok ? '' : ' disabled title="Cancelled documents cannot be bulk printed"') +
      (ok && sel[d.doc_no] ? ' checked' : '') +
      ' onchange="erpBulkToggle(this)"></td>';
  };
  window.erpBulkRowClass = function (d) { return selectable(d) && sel[d.doc_no] ? ' class="erp-bulk-selected"' : ''; };

  window.erpBulkInit = function (c) {
    cfg = c;
    injectStyles();
    ensureHeaderCheckbox();
    ensureBar();
  };

  window.erpBulkToggle = function (cb) {
    var no = cb.getAttribute('data-doc');
    if (cb.checked) sel[no] = true; else delete sel[no];
    var tr = cb.closest('tr'); if (tr) tr.classList.toggle('erp-bulk-selected', cb.checked);
    refreshBar();
  };

  window.erpBulkTogglePage = function (on) {
    (cfg.getPage() || []).forEach(function (d) {
      if (!selectable(d)) return;
      if (on) sel[d.doc_no] = true; else delete sel[d.doc_no];
    });
    paintRows();
    refreshBar();
  };

  window.erpBulkSelectAllFiltered = function () {
    (cfg.getFiltered() || []).forEach(function (d) { if (selectable(d)) sel[d.doc_no] = true; });
    paintRows();
    refreshBar();
  };

  window.erpBulkClear = function () { sel = {}; paintRows(); refreshBar(); };

  function paintRows() {
    var tbody = document.getElementById(cfg.tbodyId);
    if (!tbody) return;
    tbody.querySelectorAll('input.erp-bulk-cb[data-doc]').forEach(function (cb) {
      var on = !!sel[cb.getAttribute('data-doc')];
      cb.checked = on;
      var tr = cb.closest('tr'); if (tr) tr.classList.toggle('erp-bulk-selected', on);
    });
  }

  function refreshBar() {
    var bar = ensureBar();
    var n = count();
    var all = document.getElementById('erpBulkAll');
    if (all) {
      var page = (cfg.getPage() || []).filter(selectable);
      var picked = page.filter(function (d) { return sel[d.doc_no]; }).length;
      all.checked = page.length > 0 && picked === page.length;
      all.indeterminate = picked > 0 && picked < page.length;
    }
    if (!bar) return;
    if (!n) { bar.style.display = 'none'; return; }
    var totalSel = (cfg.getFiltered() || []).filter(selectable).length;
    bar.style.display = 'flex';
    bar.innerHTML =
      '<span class="erp-bulk-count"><i class="bi bi-check2-square me-1"></i>' + n + ' selected</span>' +
      (n < totalSel ? '<button type="button" onclick="erpBulkSelectAllFiltered()">Select all ' + totalSel + ' in list</button>' : '') +
      '<button type="button" onclick="erpBulkClear()">Clear selection</button>' +
      '<button type="button" class="erp-bulk-go" onclick="erpBulkPrintSelected()"><i class="bi bi-printer me-1"></i>Print Selected (' + n + ')</button>';
  }

  // ── public: call at the end of every list render ──
  window.erpBulkSync = function () {
    if (!cfg) return;
    ensureHeaderCheckbox();
    // only keep selections that are still in the filtered list (what you see is what prints)
    var visible = {};
    (cfg.getFiltered() || []).forEach(function (d) { if (selectable(d)) visible[d.doc_no] = true; });
    Object.keys(sel).forEach(function (k) { if (!visible[k]) delete sel[k]; });
    refreshBar();
  };

  // ── progress chip ──
  function progress(msg) {
    var el = document.getElementById('erpBulkProgress');
    if (!msg) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'erpBulkProgress'; document.body.appendChild(el); }
    el.textContent = msg;
  }

  // ── print selected ──
  var _busy = false;
  window.erpBulkPrintSelected = async function () {
    if (_busy || !cfg) return;
    var nos = Object.keys(sel);
    if (!nos.length) { toast('Select at least one document first'); return; }
    if (nos.length > MAX_BATCH) { toast('Max ' + MAX_BATCH + ' documents per print. You selected ' + nos.length + '.'); return; }
    // oldest → newest (by doc number) so the stack comes out in order
    nos.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });

    _busy = true;
    var docType = cfg.docType;
    var pages = new Array(nos.length), failed = [], done = 0, next = 0;
    try {
      var worker = async function () {
        while (next < nos.length) {
          var i = next++;
          var no = nos[i];
          try {
            var r = await erpFetchDocWithItems(no, docType);
            if (!r.success) throw new Error(r.error || 'load failed');
            var html = docType === 'MRIF' ? buildErpMrifHtml(no, r.info || {}, r.items || [])
                                          : buildErpMrrHtml(no, r.info || {}, r.items || []);
            html = await _printEmbedQrInHtml(html);
            pages[i] = '<div class="bulk-print-page" data-doc="' + esc(no) + '">' + html + '</div>';
          } catch (e) {
            console.warn('[BulkPrint] failed', no, e);
            failed.push(no);
          }
          done++;
          progress('Preparing ' + docType + ' ' + done + ' / ' + nos.length + '…');
        }
      };
      progress('Preparing ' + docType + ' 0 / ' + nos.length + '…');
      var workers = [];
      for (var w = 0; w < Math.min(CONCURRENCY, nos.length); w++) workers.push(worker());
      await Promise.all(workers);

      var okNos = [], okPages = [];
      pages.forEach(function (p, i) { if (p) { okPages.push(p); okNos.push(nos[i]); } });
      if (!okPages.length) { toast('Failed to load the selected documents'); return; }

      erpShowPrintModal(okPages.join(''));
      customizeModal(okNos, failed, docType);
    } catch (err) {
      console.error('[erpBulkPrintSelected]', err);
      toast('Error: ' + err.message);
    } finally {
      progress(null);
      _busy = false;
    }
  };

  function customizeModal(okNos, failed, docType) {
    var modal = document.getElementById('erpPrintModal');
    if (!modal) return;
    var title = modal.querySelector('.modal-title');
    if (title) title.innerHTML = '<i class="bi bi-printer me-2"></i>Bulk Print Preview — ' + okNos.length + ' ' + docType + ' document' + (okNos.length > 1 ? 's' : '');
    var body = modal.querySelector('#erpPrintContent');
    if (body) body.querySelectorAll('.bulk-print-page').forEach(function (p) { p.style.marginBottom = '16px'; });
    var btn = modal.querySelector('.modal-footer .btn-primary');
    if (btn) {
      btn.setAttribute('onclick', 'erpBulkPrintNow()');
      btn.innerHTML = '<i class="bi bi-printer me-2"></i>Print All (' + okNos.length + ')';
    }
    window._erpBulkLast = { nos: okNos, type: docType };
    // Layout option: 1 document per page (default) or several per page to save paper
    var closeBtn = modal.querySelector('.modal-footer [data-bs-dismiss="modal"]');
    var opt = document.createElement('label');
    opt.className = 'small d-flex align-items-center gap-1 mb-0 ms-2';
    opt.style.cursor = 'pointer';
    opt.innerHTML = '<input type="checkbox" id="erpBulkCompact" style="accent-color:#4f46e5"> Save paper (fit several per page)';
    if (closeBtn) closeBtn.parentNode.insertBefore(opt, closeBtn);

    var foot = modal.querySelector('.modal-footer');
    function note(html, color) {
      var old = document.getElementById('erpPrintLogNote'); if (old) old.remove();
      var d = document.createElement('div');
      d.id = 'erpPrintLogNote'; d.className = 'me-auto fw-bold small'; d.style.color = color; d.innerHTML = html;
      foot.insertBefore(d, foot.firstChild);
    }
    if (failed.length) {
      note('⚠ ' + failed.length + ' could not be loaded and are NOT included: ' + esc(failed.join(', ')), '#b91c1c');
    }
    if (window.erpPrintLog && typeof window.erpPrintLog.list === 'function' && !failed.length) {
      window.erpPrintLog.list().then(function (map) {
        if (!map) return;
        var already = okNos.filter(function (n) { return map[n]; }).length;
        if (already) note('⚠ ' + already + ' of ' + okNos.length + ' were already printed before', '#b45309');
        else note('None of these were printed yet', '#15803d');
      });
    }
  }

  window.erpBulkPrintNow = function () {
    var content = document.getElementById('erpPrintContent');
    var last = window._erpBulkLast;
    if (!content || !last) return;
    var cmp = document.getElementById('erpBulkCompact');
    erpPrintHtml(content.innerHTML, { compact: !!(cmp && cmp.checked) });
    if (window.erpPrintLog && typeof window.erpPrintLog.logMany === 'function') {
      window.erpPrintLog.logMany(last.nos, last.type).then(function (ok) {
        if (!ok) return;
        var foot = document.querySelector('#erpPrintModal .modal-footer');
        if (!foot) return;
        var old = document.getElementById('erpPrintLogNote'); if (old) old.remove();
        var d = document.createElement('div');
        d.id = 'erpPrintLogNote'; d.className = 'me-auto fw-bold small'; d.style.color = '#15803d';
        d.textContent = '✅ ' + last.nos.length + ' printed (logged) · just now';
        foot.insertBefore(d, foot.firstChild);
      });
    }
  };
})();
