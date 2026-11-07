// ============================================================
// GEMCOR ERP — Cancel MRS  (v1.0)
// Para sa MRS na nagawa nang mali (hal. MRIF pala dapat) o na-duplicate.
// Puwede lang kung PENDING pa at wala pang na-verify ang warehouse.
// Hindi binubura ang record — nagiging CANCELLED (may reason, user, oras).
// Ang database (erp_cancel_mrs) ang nagva-validate ng lahat ng rule.
// Requires: sql/erp-cancel-mrs.sql
// ============================================================
(function () {
  if (window.mrsCancel) return;

  if (!document.getElementById('erpCancelledStyle')) {
    var st = document.createElement('style');
    st.id = 'erpCancelledStyle';
    st.textContent =
      'body .status-cancelled{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;' +
      'font-size:.75rem;font-weight:700;background:#fef2f2;color:#b91c1c;}' +
      'body .status-cancelled::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;}';
    document.head.appendChild(st);
  }

  var busy = false;
  function toast(msg, type) { if (typeof erpShowToast === 'function') erpShowToast(msg, type || 'info'); else alert(msg); }

  // Warehouse staff at admin lang
  window.mrsCanCancel = function () {
    try {
      var role = String(localStorage.getItem('ivm_userRole') || '').toLowerCase();
      return role.indexOf('warehouse') !== -1 || localStorage.getItem('ivm_isAdmin') === 'true';
    } catch (e) { return false; }
  };

  window.mrsCancel = async function (docNo) {
    if (!window.mrsCanCancel()) { toast('Warehouse staff o admin lang ang puwedeng mag-cancel ng MRS', 'warning'); return; }
    if (busy) return;

    var reason = prompt(
      'CANCEL ' + docNo + '\n\n' +
      'Hindi buburahin ang record — magiging CANCELLED ito at hindi na maipoproseso.\n' +
      'Puwede lang kung PENDING pa at wala pang na-verify.\n\nReason (required):', 'Maling form — MRIF pala dapat');
    if (reason === null) return;
    reason = reason.trim();
    if (!reason) { toast('Reason is required', 'warning'); return; }
    if (!confirm('Sigurado ka bang i-cancel ang ' + docNo + '?\n\nReason: ' + reason)) return;

    busy = true;
    try {
      var res = await fetch(erpUrl('rpc/erp_cancel_mrs'), {
        method: 'POST',
        headers: erpHeaders(),
        body: JSON.stringify({
          p_doc_no: docNo,
          p_reason: reason,
          p_user: localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE',
          p_login: localStorage.getItem('ivm_username') || null
        })
      });
      var text = await res.text(), data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) {}
      if (!res.ok) {
        var m = (data && (data.message || data.error)) || text || ('HTTP ' + res.status);
        if (res.status === 404 || /could not find the function|PGRST202/i.test(m)) {
          throw new Error('Wala pa sa Supabase ang erp_cancel_mrs. Walang na-cancel. (Run sql/erp-cancel-mrs.sql muna.)');
        }
        throw new Error(m);
      }
      if (!data || !data.success) throw new Error((data && data.error) || 'Cancel failed');

      toast('✅ ' + docNo + ' cancelled', 'success');
      if (typeof mrsListLoad === 'function') setTimeout(mrsListLoad, 400);
      else if (typeof allRequestsLoad === 'function') setTimeout(allRequestsLoad, 400);
      else if (typeof myRequestsLoad === 'function') setTimeout(myRequestsLoad, 400);
    } catch (err) {
      toast(err.message, 'danger');
      alert(err.message);
    } finally {
      busy = false;
    }
  };

  console.log('✅ mrs-cancel.js v1.0 loaded');
})();
