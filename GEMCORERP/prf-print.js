// ============================================================
// GEMCOR ERP — PRF Print Format (v1.1)
// Matches: PURCHASE REQUISITION FORM template
// ✅ v1.1 NEW: Version indicator sa header (REVISION vN)
// ============================================================

// Ilang araw ang hinihintay ng warehouse bago dapat matanggap ang PRF (default ng "Date needed")
var PRF_LEAD_DAYS = 7;

var PRF_PRINT_CONFIG = {
  company: 'Greenmetal Electric Manufacturing Corporation',
  notedBy: 'CYNTHIA A. CEREZO',
  approvedBy: 'REMIGIO BALAOING'
};

// ═══════════════════════════════════════════════════════════
// DATE NEEDED — default: PRF date + PRF_LEAD_DAYS (kung walang inilagay)
// ═══════════════════════════════════════════════════════════
function prfParseDate(v) {
  if (!v) return null;
  var str = String(v);
  var d = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(str + 'T00:00:00') : new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
function prfIsoDate(d) {
  var p = function(n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function prfDefaultDateNeeded(createdAt) {
  var base = prfParseDate(createdAt) || new Date();
  var d = new Date(base.getFullYear(), base.getMonth(), base.getDate());   // petsa lang, walang oras
  d.setDate(d.getDate() + PRF_LEAD_DAYS);
  return d;
}
// Ang inilagay ng user kung meron; kung wala, PRF date + 1 linggo
function prfEffectiveDateNeeded(prf) {
  return prfParseDate(prf && prf.date_needed) || prfDefaultDateNeeded(prf && prf.created_at);
}

// ═══════════════════════════════════════════════════════════
// MAIN PRINT FUNCTION
// ═══════════════════════════════════════════════════════════
async function openPrfPrintPreview(prfId) {
  try {
    var prfRes = await erpFetch('prf_documents', 'id=eq.' + prfId + '&limit=1');
    if (!prfRes || prfRes.length === 0) {
      erpShowToast('PRF not found', 'danger');
      return;
    }
    var prf = prfRes[0];

    var itemsRes = await erpFetch('prf_items', 
      'prf_id=eq.' + prfId + '&order=line_no.asc');

    var items = itemsRes || [];

    console.log('[Print] PRF:', prf.prf_no, '| v' + (prf.version_number || 1), '| Items:', items.length);

    var html = buildPrfPrintHtml(prf, items);
    window._prfPrintCurrent = { id: prf.id, created_at: prf.created_at, date_needed: prf.date_needed };
    showPrfPrintModal(html, prf.prf_no, prf);

  } catch(err) {
    console.error('[openPrfPrintPreview]', err);
    erpShowToast('Failed to load PRF: ' + err.message, 'danger');
  }
}

// ═══════════════════════════════════════════════════════════
// BUILD PRINT HTML
// ═══════════════════════════════════════════════════════════
function buildPrfPrintHtml(prf, items) {
  var dateRequested = prf.created_at ? formatPrintDate(prf.created_at) : formatPrintDate(new Date());
  var dateNeeded = formatPrintDate(prfEffectiveDateNeeded(prf));

  var prfNoDisplay = String(prf.prf_no || '').replace(/^PRF#/, '');
  
  // ✅ Version indicator
  var versionNum = parseInt(prf.version_number, 10) || 1;
  var versionLabel = '';
  if (versionNum > 1) {
    versionLabel = ' <span style="background:#f59e0b;color:#fff;padding:1px 8px;border-radius:10px;font-size:8pt;font-weight:bold;margin-left:4px;">REVISION v' + versionNum + '</span>';
  }

  var itemsHtml = '';
  var totalItems = items.length;
  var MIN_ROWS = 30;

  for (var i = 0; i < Math.max(totalItems, MIN_ROWS); i++) {
    var it = items[i];
    if (it) {
      var aveMonthly = Number(it.average_consumption || 0);
      var avePerDay = aveMonthly / 30;
      var avePerDayDisplay = avePerDay > 0 ? avePerDay.toFixed(3) : '0.000';

      itemsHtml += '<tr>' +
        '<td class="prf-print-td-center">' + (i + 1) + '</td>' +
        '<td class="prf-print-td-item-code">' + printEsc(it.item_code) + '</td>' +
        '<td class="prf-print-td-desc">' + printEsc(it.description || '') + '</td>' +
        '<td class="prf-print-td-center">' + avePerDayDisplay + '</td>' +
        '<td class="prf-print-td-center">' + printNum(it.buffer_stock || 0) + '</td>' +
        '<td class="prf-print-td-center">' + printNum(it.stock_on_hand || 0) + '</td>' +
        '<td class="prf-print-td-center prf-print-qty">' + printNum(it.qty_for_order || 0) + '</td>' +
        '<td class="prf-print-td-center">' + printEsc(it.unit || 'PIECE') + '</td>' +
        '<td class="prf-print-td-remarks">' + printEsc(it.remarks || '') + '</td>' +
      '</tr>';
    } else {
      itemsHtml += '<tr class="prf-print-blank-row">' +
        '<td class="prf-print-td-center">' + (i + 1) + '</td>' +
        '<td class="prf-print-td-item-code"></td>' +
        '<td class="prf-print-td-desc"></td>' +
        '<td class="prf-print-td-center"></td>' +
        '<td class="prf-print-td-center"></td>' +
        '<td class="prf-print-td-center"></td>' +
        '<td class="prf-print-td-center prf-print-qty"></td>' +
        '<td class="prf-print-td-center"></td>' +
        '<td class="prf-print-td-remarks"></td>' +
      '</tr>';
    }
  }

  var preparedByName = String(prf.prepared_by || '').toUpperCase() || '—';
  var notedByName = PRF_PRINT_CONFIG.notedBy;
  var approvedByName = PRF_PRINT_CONFIG.approvedBy;

  return '<div class="prf-print-sheet">' +

    '<div class="prf-print-header">' +
      '<div class="prf-print-logo">' +
        '<img src="../gemcor-logo.png" alt="GEMCOR" onerror="this.style.display=\'none\'">' +
      '</div>' +
      '<div class="prf-print-title-block">' +
        '<div class="prf-print-title">PURCHASE REQUISITION FORM' + versionLabel + '</div>' +
      '</div>' +
    '</div>' +

    '<table class="prf-print-meta">' +
      '<tr>' +
        '<td class="prf-print-label">Department:</td>' +
        '<td class="prf-print-value">' + printEsc(prf.department || 'GEMCOR IVM') + '</td>' +
        '<td class="prf-print-label" style="width:15%;">PRF NO.:</td>' +
        '<td class="prf-print-value" style="width:15%;">' + printEsc(prfNoDisplay) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="prf-print-label">Purpose:</td>' +
        '<td class="prf-print-value">' + printEsc(prf.purpose || 'STOCK') + '</td>' +
        '<td class="prf-print-label">Date requested:</td>' +
        '<td class="prf-print-value">' + printEsc(dateRequested) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="prf-print-label"></td>' +
        '<td class="prf-print-value"></td>' +
        '<td class="prf-print-label">Date needed:</td>' +
        '<td class="prf-print-value prf-date-needed">' + printEsc(dateNeeded) + '</td>' +
      '</tr>' +
    '</table>' +

    '<table class="prf-print-items">' +
      '<thead>' +
        '<tr>' +
          '<th style="width:5%;">ITEM NO.</th>' +
          '<th style="width:11%;">ITEM CODE</th>' +
          '<th style="width:27%;">ITEM DESCRIPTION</th>' +
          '<th style="width:10%;">AVERAGE CONSUMPTION PER DAY</th>' +
          '<th style="width:7%;">BUFFER STOCK</th>' +
          '<th style="width:7%;">STOCK ON HAND</th>' +
          '<th style="width:8%;">QTY (For Order)</th>' +
          '<th style="width:6%;">UNIT</th>' +
          '<th style="width:19%;">REMARKS</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + itemsHtml + '</tbody>' +
    '</table>' +

    '<div class="prf-print-signatures">' +
      '<div class="prf-print-sig-block">' +
        '<div class="prf-print-sig-label">Prepared By:</div>' +
        '<div class="prf-print-sig-line">' +
          '<div class="prf-print-sig-name">' + printEsc(preparedByName) + '</div>' +
        '</div>' +
        '<div class="prf-print-sig-caption">Signature Over Printed Name</div>' +
      '</div>' +
      '<div class="prf-print-sig-block">' +
        '<div class="prf-print-sig-label">Noted By:</div>' +
        '<div class="prf-print-sig-line">' +
          '<div class="prf-print-sig-name">' + printEsc(notedByName) + '</div>' +
        '</div>' +
        '<div class="prf-print-sig-caption">IVM-Head</div>' +
      '</div>' +
      '<div class="prf-print-sig-block">' +
        '<div class="prf-print-sig-label">Approved By:</div>' +
        '<div class="prf-print-sig-line">' +
          '<div class="prf-print-sig-name">' + printEsc(approvedByName) + '</div>' +
        '</div>' +
        '<div class="prf-print-sig-caption">&nbsp;</div>' +
      '</div>' +
    '</div>' +

  '</div>';
}

// ═══════════════════════════════════════════════════════════
// PRINT MODAL
// ═══════════════════════════════════════════════════════════
function showPrfPrintModal(html, prfNo, prf) {
  var dnIso = prfIsoDate(prfEffectiveDateNeeded(prf || {}));
  var existing = document.getElementById('prfPrintModal');
  if (existing) existing.remove();

  var modalHtml =
    '<div class="modal fade" id="prfPrintModal" tabindex="-1" data-bs-backdrop="static">' +
      '<div class="modal-dialog modal-xl modal-dialog-scrollable" style="max-width:1100px;">' +
        '<div class="modal-content">' +
          '<div class="modal-header erp-modal-header">' +
            '<h5 class="modal-title">' +
              '<i class="bi bi-printer me-2"></i>Print Preview — ' + printEsc(prfNo) +
            '</h5>' +
            '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>' +
          '</div>' +
          '<div class="modal-body p-0" style="background:#e5e5e5;">' +
            '<div id="prfPrintContent" style="padding:20px;"><style>' + getPrintStyles(false) + '</style>' + html + '</div>' +
          '</div>' +
          '<div class="modal-footer justify-content-between">' +
            '<div class="d-flex align-items-center gap-2 flex-wrap">' +
              '<label class="small fw-bold mb-0" for="prfPrintDateNeeded">Date needed</label>' +
              '<input type="date" id="prfPrintDateNeeded" class="form-control form-control-sm" style="width:auto" value="' + dnIso + '" onchange="prfPrintSetDateNeeded(this.value)">' +
              '<span class="small text-muted">Kung blangko: ' + PRF_LEAD_DAYS + ' araw pagkatapos ng PRF date</span>' +
            '</div>' +
            '<div>' +
            '<button type="button" class="btn btn-outline-secondary me-2" data-bs-dismiss="modal">Close</button>' +
            '<button type="button" class="btn btn-primary" onclick="executePrintPrf()">' +
              '<i class="bi bi-printer me-1"></i>Print' +
            '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  var wrapper = document.createElement('div');
  wrapper.innerHTML = modalHtml;
  document.body.appendChild(wrapper.firstChild);

  var modalEl = document.getElementById('prfPrintModal');
  var modal = new bootstrap.Modal(modalEl);
  modal.show();

  modalEl.addEventListener('hidden.bs.modal', function() {
    modalEl.remove();
  });
}

// Binago ang Date needed sa preview: i-update agad ang form at i-save sa PRF
async function prfPrintSetDateNeeded(value) {
  var cur = window._prfPrintCurrent;
  if (!cur) return;
  var input = document.getElementById('prfPrintDateNeeded');
  var chosen = value ? prfParseDate(value) : null;
  var shown = chosen || prfDefaultDateNeeded(cur.created_at);   // blangko → balik sa default
  if (!chosen && input) input.value = prfIsoDate(shown);
  document.querySelectorAll('#prfPrintContent .prf-date-needed').forEach(function(c) { c.textContent = formatPrintDate(shown); });

  try {
    var res = await fetch(erpUrl('prf_documents?id=eq.' + cur.id), {
      method: 'PATCH',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({ date_needed: chosen ? prfIsoDate(chosen) : null, updated_at: new Date().toISOString() })
    });
    var out = res.ok ? await res.json() : null;
    if (!res.ok || !out || !out.length) throw new Error(res.ok ? 'not permitted' : 'HTTP ' + res.status);
    cur.date_needed = chosen ? prfIsoDate(chosen) : null;
    if (typeof erpShowToast === 'function') erpShowToast('Date needed saved: ' + formatPrintDate(shown), 'success');
  } catch (e) {
    console.error('[PRF] save date_needed failed', e);
    if (typeof erpShowToast === 'function') erpShowToast('Napalitan sa print pero hindi na-save (' + e.message + '). Run erp-prf-date-needed.sql sa Supabase.', 'warning');
  }
}
window.prfPrintSetDateNeeded = prfPrintSetDateNeeded;

// ═══════════════════════════════════════════════════════════
// EXECUTE PRINT
// ═══════════════════════════════════════════════════════════
function executePrintPrf() {
  var content = document.getElementById('prfPrintContent');
  if (!content) return;

  var html = content.innerHTML;
  var printStyles = getPrintStyles(true);
  var fullHtml = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<title>Print PRF</title><style>' + printStyles + '</style></head>' +
    '<body>' + html + '</body></html>';

  var iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  document.body.appendChild(iframe);

  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write(fullHtml);
  doc.close();

  setTimeout(function() {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {
      console.error('Print error:', e);
      erpShowToast('Print failed: ' + e.message, 'danger');
    }
    setTimeout(function() {
      if (iframe.parentNode) document.body.removeChild(iframe);
    }, 3000);
  }, 400);
}

// ═══════════════════════════════════════════════════════════
// PRINT STYLES
// ═══════════════════════════════════════════════════════════
// Letter size (8.5 x 11in), margin 0.2in/0.25in → 8.0in x 10.6in na magagamit.
// Ang sheet ay 10.5in ang taas at ang 30 rows ay may FIXED na taas (ROW_H) para
// mapuno ang buong pahina; ang pirma ay nakadikit sa baba.
var PRF_PRINT_ROW_H = '0.255in';
function getPrintStyles(forPrint) {
  var S = '.prf-print-sheet ';
  var css = [];
  if (forPrint) {
    css.push('@page { size: letter portrait; margin: 0.2in 0.25in; }');
    css.push('html, body { margin: 0; padding: 0; }');
    css.push('body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }');
  }
  css.push(
    S + ', .prf-print-sheet { box-sizing: border-box; }',
    '.prf-print-sheet * { box-sizing: border-box; }',
    '.prf-print-sheet { width: 8in; height: 10.5in; margin: 0 auto; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; display: flex; flex-direction: column; overflow: hidden; }',

    S + '.prf-print-header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; height: 0.62in; }',
    S + '.prf-print-logo img { height: 0.56in; width: auto; }',
    S + '.prf-print-title-block { flex: 1; text-align: center; }',
    S + '.prf-print-title { font-size: 13pt; font-weight: bold; letter-spacing: 1.5px; margin: 0; }',

    S + '.prf-print-meta { flex: 0 0 auto; width: 100%; border-collapse: collapse; margin-bottom: 0.08in; font-size: 9pt; }',
    S + '.prf-print-meta td { padding: 0 4px; height: 0.21in; vertical-align: middle; line-height: 1.2; }',
    S + '.prf-print-label { font-weight: bold; white-space: nowrap; }',
    S + '.prf-print-value { border-bottom: 1px solid #000; }',

    S + '.prf-print-items { flex: 0 0 auto; width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7.5pt; }',
    S + '.prf-print-items th, ' + S + '.prf-print-items td { border: 1px solid #000; padding: 0 3px; vertical-align: middle; line-height: 1.1; overflow: hidden; }',
    S + '.prf-print-items th { background: #f0f0f0; font-weight: bold; text-align: center; font-size: 6pt; line-height: 1.15; height: 0.44in; padding: 2px 2px; word-break: normal; }',
    S + '.prf-print-items tbody tr { height: ' + PRF_PRINT_ROW_H + '; }',
    S + '.prf-print-td-center { text-align: center; }',
    S + '.prf-print-td-item-code { font-family: "Courier New", monospace; font-weight: 700; font-size: 7pt; }',
    S + '.prf-print-td-desc { text-align: left; font-size: 7pt; word-wrap: break-word; }',
    S + '.prf-print-td-remarks { text-align: left; font-size: 6.5pt; }',
    S + '.prf-print-qty { font-weight: bold; }',

    S + '.prf-print-signatures { flex: 0 0 auto; margin-top: auto; padding: 0.1in 3% 0; display: flex; justify-content: space-between; }',
    S + '.prf-print-sig-block { width: 30%; text-align: center; }',
    S + '.prf-print-sig-label { font-weight: bold; font-size: 8pt; text-align: left; margin-bottom: 0.14in; }',
    S + '.prf-print-sig-line { border-bottom: 1px solid #000; min-height: 0.2in; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 1px; }',
    S + '.prf-print-sig-name { font-weight: bold; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.2px; }',
    S + '.prf-print-sig-caption { font-size: 6.5pt; margin-top: 2px; }'
  );
  return css.join('\n');
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function formatPrintDate(dateVal) {
  if (!dateVal) return '';
  try {
    var d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    var month = d.getMonth() + 1;
    var day = d.getDate();
    var year = d.getFullYear();
    return month + '/' + day + '/' + year;
  } catch(e) { return ''; }
}

function printNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '';
  var num = Number(n);
  if (num === 0) return '0';
  if (num >= 1000) {
    return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return String(Math.round(num * 10000) / 10000);   // max 4 decimals — iwas 4.04749999
}

function printEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

console.log('✅ prf-print.js v1.2 loaded (full-page layout + date needed)');
