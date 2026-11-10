// ============================================================
// GEMCOR ERP — Cancel MRIF  (v1.1)
// Para sa MRIF na nagawa nang mali / na-duplicate.
// Puwede lang kung WALA pang naibigay. Hindi binubura ang record —
// nagiging CANCELLED (may oras at audit). Ang database (erp_cancel_mrif)
// ang nagva-validate ng lahat ng rule.
// Requires: erp-cancel-mrif.sql
// ============================================================
(function () {
  if (window.mrifCancel) return;

  // Style ng CANCELLED badge (kapareho ng ibang status badge)
  var st = document.createElement('style');
  st.textContent =
    'body .status-cancelled{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;' +
    'font-size:.75rem;font-weight:700;background:#fef2f2;color:#b91c1c;}' +
    'body .status-cancelled::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;}';
  document.head.appendChild(st);

  var busy = false;

  function toast(msg, type) { if (typeof erpShowToast === 'function') erpShowToast(msg, type || 'info'); else alert(msg); }

  // Warehouse staff at admin lang
  window.mrifCanCancel = function () {
    try {
      var role = String(localStorage.getItem('ivm_userRole') || '').toLowerCase();
      return role.indexOf('warehouse') !== -1 || localStorage.getItem('ivm_isAdmin') === 'true';
    } catch (e) { return false; }
  };

  // Admin lang ang puwedeng mag-cancel ng MRIF na may naibigay na (PARTIAL / COMPLETED)
  window.mrifCanCancelIssued = function () {
    try { return localStorage.getItem('ivm_isAdmin') === 'true'; } catch (e) { return false; }
  };

  // status (optional): kapag PARTIAL / COMPLETED → admin flow na may pagbabalik ng stock
  window.mrifCancel = async function (docNo, status) {
    var issued = /^(PARTIAL|COMPLETED)$/i.test(String(status || ''));
    if (issued) return cancelIssued(docNo, String(status).toUpperCase());
    if (!window.mrifCanCancel()) { toast('Warehouse staff o admin lang ang puwedeng mag-cancel ng MRIF', 'warning'); return; }
    if (busy) return;

    var reason = prompt(
      'CANCEL ' + docNo + '\n\n' +
      'Hindi buburahin ang record — magiging CANCELLED ito at hindi na maipoproseso.\n' +
      'Puwede lang kung wala pang naibigay.\n\nReason (required):');
    if (reason === null) return;
    reason = reason.trim();
    if (!reason) { toast('Reason is required', 'warning'); return; }
    if (!confirm('Sigurado ka bang i-cancel ang ' + docNo + '?\n\nReason: ' + reason)) return;

    busy = true;
    try {
      var res = await fetch(erpUrl('rpc/erp_cancel_mrif'), {
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
          throw new Error('Wala pa sa Supabase ang erp_cancel_mrif. Walang na-cancel. (Run erp-cancel-mrif.sql muna.)');
        }
        throw new Error(m);
      }
      if (!data || !data.success) throw new Error((data && data.error) || 'Cancel failed');

      toast('✅ ' + docNo + ' cancelled', 'success');
      if (typeof mrifListRefresh === 'function') setTimeout(mrifListRefresh, 400);
      else if (typeof allRequestsLoad === 'function') setTimeout(allRequestsLoad, 400);
    } catch (err) {
      toast(err.message, 'danger');
      alert(err.message);
    } finally {
      busy = false;
    }
  };

  async function cancelIssued(docNo, status) {
    if (!window.mrifCanCancelIssued()) { toast('Admin lang ang puwedeng mag-cancel ng MRIF na may naibigay na', 'warning'); return; }
    if (busy) return;
    var reason = prompt(
      'CANCEL ' + docNo + ' (' + status + ')\n\n' +
      'IBABALIK sa on-hand ang lahat ng naibigay na stock at ang nagamit na SOF allocation.\n' +
      'Hindi buburahin ang record — magiging CANCELLED, at may audit.\n' +
      'Kung may MRS (Returns) na para sa MRIF na ito, huwag nang i-cancel.\n\nReason (required):');
    if (reason === null) return;
    reason = reason.trim();
    if (!reason) { toast('Reason is required', 'warning'); return; }
    var typed = prompt('Para makumpirma, i-type ang MRIF No. na ika-cancel:\n\n' + docNo);
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== String(docNo).toUpperCase()) { toast('Hindi tugma ang MRIF No. Walang na-cancel.', 'warning'); return; }

    busy = true;
    try {
      var res = await fetch(erpUrl('rpc/erp_cancel_mrif_issued'), {
        method: 'POST',
        headers: erpHeaders(),
        body: JSON.stringify({
          p_doc_no: docNo,
          p_reason: reason,
          p_user: localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'ADMIN',
          p_login: localStorage.getItem('ivm_username') || null
        })
      });
      var text = await res.text(), data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) {}
      if (!res.ok) {
        var m = (data && (data.message || data.error)) || text || ('HTTP ' + res.status);
        if (res.status === 404 || /could not find the function|PGRST202/i.test(m)) {
          throw new Error('Wala pa sa Supabase ang erp_cancel_mrif_issued. Walang na-cancel. (Run erp-cancel-mrif-issued.sql muna.)');
        }
        throw new Error(m);
      }
      if (!data || !data.success) throw new Error((data && data.error) || 'Cancel failed');

      toast('✅ ' + docNo + ' cancelled — ' + data.total_qty_returned + ' unit(s) ibinalik sa ' + data.lines_returned + ' line(s)', 'success');
      if (typeof mrifListRefresh === 'function') setTimeout(mrifListRefresh, 400);
      else if (typeof allRequestsLoad === 'function') setTimeout(allRequestsLoad, 400);
    } catch (err) {
      toast(err.message, 'danger');
      alert(err.message);
    } finally {
      busy = false;
    }
  }

  console.log('✅ mrif-cancel.js v1.1 loaded');
})();
