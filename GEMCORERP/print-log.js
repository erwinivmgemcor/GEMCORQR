// ============================================================
// GEMCOR ERP — "Already printed?" tracking shared by all users
// Logs every Print / Save PDF click to doc_print_log, and shows
// a notice inside the print preview if the document was printed before.
// If the table is not installed yet, everything silently stays off.
// ============================================================
(function () {
  var WINDOW_DAYS = 45;
  var last = null;

  function me() {
    return localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'UNKNOWN';
  }
  function fmt(iso) {
    try { return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return iso; }
  }

  async function log(docNo, docType) {
    try {
      var res = await fetch(erpUrl('doc_print_log'), {
        method: 'POST', headers: erpHeaders(),
        body: JSON.stringify([{ doc_no: docNo, doc_type: docType || null, printed_by: me() }])
      });
      return res.ok;
    } catch (e) { return false; }
  }

  // doc_no -> { count, by, at } for recent prints (null if the table is not installed)
  async function list() {
    try {
      var since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
      var rows = await erpFetch('doc_print_log',
        'select=doc_no,printed_by,printed_at&printed_at=gte.' + encodeURIComponent(since) + '&order=printed_at.desc&limit=5000') || [];
      var map = {};
      rows.forEach(function (r) {
        if (!map[r.doc_no]) map[r.doc_no] = { count: 0, by: r.printed_by, at: r.printed_at };
        map[r.doc_no].count++;
      });
      return map;
    } catch (e) { return null; }
  }

  async function one(docNo) {
    try {
      var rows = await erpFetch('doc_print_log',
        'select=printed_by,printed_at&doc_no=eq.' + encodeURIComponent(docNo) + '&order=printed_at.desc&limit=50') || [];
      return rows.length ? { count: rows.length, by: rows[0].printed_by, at: rows[0].printed_at } : { count: 0 };
    } catch (e) { return null; }
  }

  function showNote(html, color) {
    var foot = document.querySelector('#erpPrintModal .modal-footer');
    if (!foot) return;
    var old = document.getElementById('erpPrintLogNote');
    if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'erpPrintLogNote';
    d.className = 'me-auto fw-bold small';
    d.style.color = color;
    d.innerHTML = html;
    foot.insertBefore(d, foot.firstChild);
  }

  async function showStatus(docNo) {
    var p = await one(docNo);
    if (p === null) return;                       // table not installed → feature off
    if (p.count > 0) showNote('⚠ Already printed ' + (p.count > 1 ? p.count + '× — last ' : '') + 'by ' + p.by + ' · ' + fmt(p.at), '#b45309');
    else showNote('Not printed yet', '#15803d');
  }

  function wrap() {
    if (typeof window.erpOpenPrintPreview !== 'function' || typeof window.erpPrintNow !== 'function') return;
    var _open = window.erpOpenPrintPreview, _now = window.erpPrintNow;

    window.erpOpenPrintPreview = async function (docNo, docType) {
      last = { docNo: docNo, docType: String(docType || '').toUpperCase() };
      await _open(docNo, docType);
      showStatus(docNo);
    };

    window.erpPrintNow = function () {
      _now();
      if (!last) return;
      var cur = last;
      log(cur.docNo, cur.docType).then(function (ok) {
        if (ok) showNote('✅ Printed by ' + me() + ' · just now', '#15803d');
      });
    };
  }

  window.erpPrintLog = { log: log, list: list, one: one };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrap); else wrap();
})();
