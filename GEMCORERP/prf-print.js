// ============================================================
// GEMCOR ERP — PRF Print Format
// Matches: PURCHASE REQUISITION FORM template
// QTY (For Order) column BLANK for manual fill
// Auto-fill Noted By / Approved By
// ============================================================

var PRF_PRINT_CONFIG = {
  company: 'Greenmetal Electric Manufacturing Corporation',
  notedBy: 'CYNTHIA A. CEREZO',
  approvedBy: 'REMIGIO BALAOING'
};

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

    console.log('[Print] PRF:', prf.prf_no, 'Items:', items.length);

    var html = buildPrfPrintHtml(prf, items);
    showPrfPrintModal(html, prf.prf_no);

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
  var dateNeeded = prf.date_needed ? formatPrintDate(prf.date_needed) : '';

  var prfNoDisplay = String(prf.prf_no || '').replace(/^PRF#/, '');

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
        '<td class="prf-print-td-center prf-print-qty">' + printNum(it.qty_for_order || 0) + '</td>' +   /* ← QTY NOW FILLED */
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
        '<div class="prf-print-title">PURCHASE REQUISITION FORM</div>' +
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
        '<td class="prf-print-value">' + printEsc(dateNeeded) + '</td>' +
      '</tr>' +
    '</table>' +

    '<table class="prf-print-items">' +
      '<thead>' +
        '<tr>' +
          '<th style="width:5%;">ITEM NO.</th>' +
          '<th style="width:11%;">ITEM CODE</th>' +
          '<th style="width:29%;">ITEM DESCRIPTION</th>' +
          '<th style="width:8%;">AVERAGE CONSUMPTION PER DAY</th>' +
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
function showPrfPrintModal(html, prfNo) {
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
            '<div id="prfPrintContent" style="padding:20px;">' + html + '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>' +
            '<button type="button" class="btn btn-primary" onclick="executePrintPrf()">' +
              '<i class="bi bi-printer me-1"></i>Print' +
            '</button>' +
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

// ═══════════════════════════════════════════════════════════
// EXECUTE PRINT
// ═══════════════════════════════════════════════════════════
function executePrintPrf() {
  var content = document.getElementById('prfPrintContent');
  if (!content) return;

  var html = content.innerHTML;
  var printStyles = getPrintStyles();
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
function getPrintStyles() {
  return [
    '@page { size: letter portrait; margin: 0.2in 0.25in; }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 7pt; color: #000; }',
    '.prf-print-sheet { width: 100%; max-width: 8.1in; margin: 0 auto; background: #fff; padding: 0; }',
    
    /* Header — compact */
    '.prf-print-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; padding-bottom: 2px; }',
    '.prf-print-logo img { height: 42px; width: auto; }',
    '.prf-print-title-block { flex: 1; text-align: center; }',
    '.prf-print-title { font-size: 11pt; font-weight: bold; letter-spacing: 1px; margin: 0; }',
    
    /* Meta — compact */
    '.prf-print-meta { width: 100%; border-collapse: collapse; margin-bottom: 4px; font-size: 8pt; }',
    '.prf-print-meta td { padding: 1px 3px; vertical-align: middle; line-height: 1.2; }',
    '.prf-print-label { font-weight: bold; white-space: nowrap; }',
    '.prf-print-value { border-bottom: 1px solid #000; }',
    
    /* Items table — VERY compact para 30 rows fit */
    '.prf-print-items { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 6.5pt; table-layout: fixed; }',
    '.prf-print-items th, .prf-print-items td { border: 1px solid #000; padding: 1px 2px; vertical-align: middle; line-height: 1.05; overflow: hidden; }',
    '.prf-print-items th { background: #f0f0f0; font-weight: bold; text-align: center; font-size: 5.5pt; letter-spacing: 0; line-height: 1.1; padding: 2px 1px; }',
    '.prf-print-td-center { text-align: center; }',
    '.prf-print-td-item-code { font-family: "Courier New", monospace; font-weight: 600; font-size: 6pt; }',
    '.prf-print-td-desc { text-align: left; font-size: 6pt; word-wrap: break-word; }',
    '.prf-print-td-remarks { text-align: left; font-size: 5.5pt; }',
    '.prf-print-qty { font-weight: bold; }',
    '.prf-print-blank-row td { min-height: 12px; }',
    
    /* Signatures — compact */
    '.prf-print-signatures { display: flex; justify-content: space-between; margin-top: 12px; padding: 0 3%; }',
    '.prf-print-sig-block { width: 30%; text-align: center; }',
    '.prf-print-sig-label { font-weight: bold; font-size: 7pt; text-align: left; margin-bottom: 4px; }',
    '.prf-print-sig-line { border-bottom: 1px solid #000; min-height: 18px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 1px; }',
    '.prf-print-sig-name { font-weight: bold; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.2px; }',
    '.prf-print-sig-caption { font-size: 6pt; margin-top: 1px; }'
  ].join('');
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
  return num.toString();
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

console.log('✅ prf-print.js loaded');
