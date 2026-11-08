// ============================================================
// GEMCOR — Standalone form view (opened by scanning a form's QR code)
// Shows ONLY the form: no login, no menu, no system links.
// Reuses the print builders in prints-erp.js; reads Supabase directly.
// ============================================================

// Minimal read-only fetch (prints-erp.js calls erpFetch; the full system file is not loaded here)
function erpFetch(table, query) {
  return fetch(erpUrl(table) + '?' + query, { headers: erpHeaders(), cache: 'no-store' }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function fvDocType(docNo) {
  var u = String(docNo).toUpperCase();
  if (u.indexOf('MRR') !== -1) return 'MRR';
  if (u.indexOf('MRS') !== -1) return 'MRS';
  return 'MRIF';
}

function fvFit() {
  var sheet = document.getElementById('fvSheet');
  if (!sheet) return;
  var w = Math.min(window.innerWidth - 16, 816);
  sheet.style.zoom = w < 816 ? (w / 816) : 1;
}

async function fvLoad() {
  var sheet = document.getElementById('fvSheet');
  var docNo = (new URLSearchParams(window.location.search).get('doc') || '').trim();
  if (!docNo) { sheet.innerHTML = '<div class="fv-msg">No form specified.</div>'; document.getElementById('fvTitle').textContent = ''; return; }

  var type = fvDocType(docNo);
  document.getElementById('fvTitle').textContent = _displayDocNoErp(docNo) || docNo;
  document.title = _displayDocNoErp(docNo) || docNo;

  try {
    var res = await erpFetchDocWithItems(docNo, type);
    if (!res.success) throw new Error(res.error || 'Not found');
    var html = type === 'MRR' ? buildErpMrrHtml(docNo, res.info, res.items)
             : type === 'MRS' ? buildErpMrsHtml(docNo, res.info, res.items)
             : buildErpMrifHtml(docNo, res.info, res.items);
    html = await _printEmbedQrInHtml(html);
    sheet.innerHTML = html;
    document.getElementById('fvPrint').disabled = false;
    fvFit();
  } catch (e) {
    console.warn('[form]', e);
    sheet.innerHTML = '<div class="fv-msg">This form could not be loaded.<br>Check your connection and scan the QR code again.</div>';
  }
}

window.addEventListener('resize', fvFit);
document.addEventListener('DOMContentLoaded', fvLoad);
