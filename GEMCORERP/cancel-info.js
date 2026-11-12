// ============================================================
// GEMCOR ERP — Cancel info helper (v1.0)
// Kinukuha ang reason, user at oras ng pag-cancel / void ng document.
// Binabasa kahit ano ang pangalan ng column (cancel_reason, cancelled_by,
// cancelled_at, void_reason, voided_by, ...) para gumana sa MRIF / MRS / MRR.
// ============================================================
(function () {
  if (window.erpDocCancelInfo) return;
  window.erpDocCancelInfo = function (doc) {
    doc = doc || {};
    var out = { reason: '', by: '', at: '' };
    Object.keys(doc).forEach(function (k) {
      var v = doc[k];
      if (v === null || v === undefined || String(v).trim() === '') return;
      if (!/cancel|void/i.test(k)) return;
      if (/reason|remark|note/i.test(k)) { if (!out.reason) out.reason = String(v).trim(); }
      else if (/by$|user|login/i.test(k)) { if (!out.by) out.by = String(v).trim(); }
      else if (/_at$|date|time/i.test(k)) { if (!out.at) out.at = String(v).trim(); }
    });
    // fallback: column na "reason" lang (walang cancel/void sa pangalan)
    if (!out.reason) {
      Object.keys(doc).forEach(function (k) {
        var v = doc[k];
        if (!out.reason && /reason/i.test(k) && v !== null && v !== undefined && String(v).trim() !== '') out.reason = String(v).trim();
      });
    }
    // fallback: kung sa remarks lang isinulat ang reason (hal. "CANCELLED: nagawa nang mali")
    if (!out.reason && /cancel|void/i.test(String(doc.remarks || ''))) out.reason = String(doc.remarks).trim();
    // diagnostic: CANCELLED pero walang nakitang reason — ilista ang columns para malaman kung saan naka-save
    if (!out.reason && String(doc.status || '').toUpperCase() === 'CANCELLED' && window.console) {
      console.warn('[cancel-info] Walang reason na nakita para sa ' + (doc.doc_no || '?') + '. Columns ng documents:', Object.keys(doc).join(', '), doc);
    }
    return out;
  };
})();
