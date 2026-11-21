// ============================================================
// GEMCOR ERP — MRR Transmittal helpers (v1.0)
// Shared by MRR Monitoring (transmittals) and MRR List (edit / void).
//
// Gawa nito: puwedeng i-RELEASE ang MRR sa transmittal (para maedit / ma-void ulit),
// i-ATTACH ulit, at magtala ng audit log.
//   release  → documents.is_transmitted=false, transmittal_no=null, transmitted_at=null
//   attach   → documents.is_transmitted=true,  transmittal_no=<TRN>, transmitted_at=now
// Audit log ay best-effort sa table `mrr_transmittal_log` (optional — tingnan ang
// mrr-transmittal-log.sql). Kapag wala ang table, tuloy pa rin ang lahat.
// ============================================================
(function () {
  if (window.erpTrn) return;

  function user() {
    return localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'USER';
  }
  function inList(nos) { return nos.map(function (n) { return String(n).replace(/[,()]/g, ''); }).join(','); }

  // PATCH documents; ibinabalik ang mga row na na-update. Mag-throw kung walang na-update.
  async function patchDocs(docNos, body) {
    if (!docNos || !docNos.length) return [];
    var res = await fetch(erpUrl('documents?doc_no=in.(' + encodeURIComponent(inList(docNos)) + ')'), {
      method: 'PATCH',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(body)
    });
    var text = await res.text(), data = null;
    try { data = JSON.parse(text); } catch (e) {}
    if (!res.ok) throw new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
    if (!Array.isArray(data) || data.length === 0) throw new Error('Walang na-update na MRR (walang permiso o hindi nakita).');
    return data;
  }

  async function log(action, trnNo, docNo, reason) {
    try {
      await fetch(erpUrl('mrr_transmittal_log'), {
        method: 'POST',
        headers: erpHeaders({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify({ action: action, transmittal_no: trnNo || null, doc_no: docNo || null, reason: reason || null, done_by: user() })
      });
    } catch (e) { /* optional */ }
  }

  async function release(docNos, reason, trnNo) {
    var rows = await patchDocs(docNos, { is_transmitted: false, transmittal_no: null, transmitted_at: null });
    rows.forEach(function (r) { log('RELEASE', trnNo || '', r.doc_no, reason); });
    return rows.length;
  }

  async function attach(docNos, trnNo, reason) {
    var rows = await patchDocs(docNos, { is_transmitted: true, transmittal_no: trnNo, transmitted_at: new Date().toISOString() });
    rows.forEach(function (r) { log('ATTACH', trnNo, r.doc_no, reason || ''); });
    return rows.length;
  }

  // Para sa Edit / Void ng MRR na na-transmit na: humingi ng reason, i-release, ibalik kung hindi natuloy.
  async function releaseFlow(docNo, trnNo, why) {
    var reason = prompt(
      docNo + ' ay nasa transmittal na' + (trnNo ? ' (' + trnNo + ')' : '') + '.\n\n' +
      'Para ma-' + why + ' ito, aalisin muna sa transmittal. Ang naka-print na kopya ng ' + (trnNo || 'TRN') + ' ay hindi na tugma, ' +
      'kaya i-transmit ulit ito pagkatapos.\n\nReason (required):');
    if (reason === null) return null;
    reason = reason.trim();
    if (!reason) { alert('Reason is required.'); return null; }
    try { await release([docNo], 'Released to ' + why + ': ' + reason, trnNo); }
    catch (e) { alert('Hindi na-release ang ' + docNo + ' sa transmittal: ' + e.message); return null; }
    return reason;
  }

  window.erpTrn = { user: user, patch: patchDocs, log: log, release: release, attach: attach, releaseFlow: releaseFlow };
  console.log('✅ mrr-trn.js v1.0 loaded');
})();
