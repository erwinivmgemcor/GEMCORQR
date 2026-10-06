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
      // Compute Ave/day from ave/monthly / 30
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
        '<td class="prf-print-td-center qty-blank"></td>' +
        '<td class="prf-print-td-center">' + printEsc(it.unit || 'PIECE') + '</td>' +
        '<td class="prf-print-td-remarks">' + printEsc(it.remarks || '') + '</td>' +
      '</tr>';
    } else {
      itemsHtml += '<tr>' +
        '<td class="prf-print-td-center">' + (i + 1) + '</td>' +
        '<td class="prf-print-td-item-code"></td>' +
        '<td class="prf-print-td-desc"></td>' +
        '<td class="prf-print-td-center"></td>' +
        '<td class="prf-print-td-center"></td>' +
        '<td class="prf-print-td-center"></td>' +
        '<td class="prf-print-td-center qty-blank"></td>' +
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
          '<th style="width:8%;" class="qty-header">QTY (For Order)</th>' +
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

    '<div class="prf-print-footer">' +
      'Printed: ' + new Date().toLocaleString('en-US') +
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
    '@page { size: letter portrait; margin: 0.25in 0.3in; }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #000; }',
    '.prf-print-sheet { width: 100%; max-width: 8in; margin: 0 auto; background: #fff; padding: 0.1in; }',
    '.prf-print-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; padding-bottom: 6px; }',
    '.prf-print-logo img { height: 55px; width: auto; }',
    '.prf-print-title-block { flex: 1; text-align: center; }',
    '.prf-print-title { font-size: 13pt; font-weight: bold; letter-spacing: 1.5px; margin: 0; }',
    '.prf-print-meta { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 9pt; }',
    '.prf-print-meta td { padding: 2px 4px; vertical-align: middle; }',
    '.prf-print-label { font-weight: bold; white-space: nowrap; width: 15%; }',
    '.prf-print-value { border-bottom: 1px solid #000; min-width: 15%; }',
    '.prf-print-items { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 8pt; }',
    '.prf-print-items th, .prf-print-items td { border: 1px solid #000; padding: 3px 4px; vertical-align: middle; }',
    '.prf-print-items th { background: #f0f0f0; font-weight: bold; text-align: center; font-size: 7.5pt; letter-spacing: 0.3px; line-height: 1.2; }',
    '.prf-print-td-center { text-align: center; }',
    '.prf-print-td-item-code { font-family: "Courier New", monospace; font-weight: 600; }',
    '.prf-print-td-desc { text-align: left; }',
    '.prf-print-td-remarks { text-align: left; font-size: 7.5pt; }',
    '.qty-blank { background: #fafafa; min-height: 16px; }',
    '.qty-header { background: #f0f0f0 !important; }',
    '.prf-print-signatures { display: flex; justify-content: space-between; margin-top: 30px; padding: 0 5%; }',
    '.prf-print-sig-block { width: 30%; text-align: center; }',
    '.prf-print-sig-label { font-weight: bold; font-size: 8pt; text-align: left; margin-bottom: 6px; }',
    '.prf-print-sig-line { border-bottom: 1px solid #000; min-height: 22px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 2px; }',
    '.prf-print-sig-name { font-weight: bold; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.3px; }',
    '.prf-print-sig-caption { font-size: 7.5pt; margin-top: 3px; }',
    '.prf-print-footer { text-align: center; font-size: 6.5pt; color: #666; margin-top: 12px; padding-top: 6px; border-top: 1px solid #ddd; }'
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
