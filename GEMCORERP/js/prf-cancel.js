// ============================================================
// GEMCOR ERP — Cancel PRF  (v1.0)
// Para sa PRF na nagawa nang mali / na-duplicate / hindi na kailangan.
// Hindi binubura ang record — lahat ng item nagiging CANCELED at
// naka-save ang reason, user at oras. Ang database (erp_cancel_prf)
// ang nagva-validate (bawal kung may SERVED/STAGGERED na item).
// Requires: sql/erp-cancel-prf.sql
// ============================================================
(function () {
  if (window.prfCancel) return;
  var busy = false;

  function toast(msg, type) {
    if (typeof erpShowToast === 'function') erpShowToast(msg, type || 'info'); else alert(msg);
  }

  // Warehouse staff at admin lang (read-only roles: procurement/finance — hindi puwede)
  window.prfCanCancel = function () {
    try {
      var role = String(localStorage.getItem('ivm_userRole') || '').toLowerCase();
      return role.indexOf('warehouse') !== -1 || localStorage.getItem('ivm_isAdmin') === 'true';
    } catch (e) { return false; }
  };

  window.prfCancel = async function (prfId) {
    if (!window.prfCanCancel()) { toast('Warehouse staff o admin lang ang puwedeng mag-cancel ng PRF', 'warning'); return; }
    if (busy) return;

    var prf = (_prfMonitor.allPrfs || []).find(function (p) { return p.id === prfId; });
    if (!prf) { toast('PRF not found — refresh the page', 'warning'); return; }

    if (prf._status === 'CANCELED') { toast(prf.prf_no + ' is already cancelled', 'info'); return; }
    var c = prf._statusCounts || {};
    if ((c.SERVED || 0) + (c.STAGGERED || 0) > 0) {
      toast(prf.prf_no + ' has SERVED/STAGGERED items — cancel the remaining items individually instead', 'warning');
      return;
    }

    var withPo = (_prfMonitor.allItems || []).filter(function (it) {
      return it.prf_id === prfId && it.po_no && String(it.status || '').toUpperCase() !== 'CANCELED';
    }).length;

    var reason = prompt(
      'CANCEL ' + prf.prf_no + '\n\n' +
      'Hindi buburahin ang record — magiging CANCELED ang lahat ng items nito.\n' +
      (withPo ? '⚠️ ' + withPo + ' item(s) ay may PO na naka-link. Siguraduhing na-cancel na rin sa procurement.\n' : '') +
      '\nReason (required):');
    if (reason === null) return;
    reason = reason.trim();
    if (!reason) { toast('Reason is required', 'warning'); return; }
    if (!confirm('Sigurado ka bang i-cancel ang ' + prf.prf_no + '?\n\nReason: ' + reason)) return;

    busy = true;
    try {
      var res = await fetch(erpUrl('rpc/erp_cancel_prf'), {
        method: 'POST',
        headers: erpHeaders(),
        body: JSON.stringify({
          p_prf_id: prfId,
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
          throw new Error('Wala pa sa Supabase ang erp_cancel_prf. Walang na-cancel. (Run sql/erp-cancel-prf.sql muna.)');
        }
        throw new Error(m);
      }
      if (!data || !data.success) throw new Error((data && data.error) || 'Cancel failed');

      toast('✅ ' + prf.prf_no + ' cancelled (' + (data.items_cancelled || 0) + ' item/s)', 'success');
      try { if (window.parent !== window && window.parent._rp) window.parent._rp.prfsChanged = true; } catch (e) {}
      if (typeof prfMonitorLoad === 'function') prfMonitorLoad();
    } catch (err) {
      toast(err.message, 'danger');
      alert(err.message);
    } finally {
      busy = false;
    }
  };

  console.log('✅ prf-cancel.js v1.0 loaded');
})();
