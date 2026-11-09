// ============================================================
// GEMCOR ERP — Stock Monitor: Allocate Stock (scan / count style)
// Para sa stock na naka-allocate na sa physical pero hindi pa naka-reserve sa system
// (walang MRR). Gumagamit ng existing na erp_sof_manual_allocate (pareho sa SOF Tracker).
// On-hand: HINDI ginagalaw. Available lang ang bumababa.
// ============================================================
var _sa = { rows: [], timer: null };

function saEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function saNum(n) { return (Number(n) || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 }); }
function saUser() { try { return localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE'; } catch (e) { return 'WAREHOUSE'; } }

async function saRpc(name, body) {
  var res = await fetch(erpUrl('rpc/' + name), { method: 'POST', headers: erpHeaders(), body: JSON.stringify(body) });
  var text = await res.text(), data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) throw new Error((data && (data.message || data.error)) || text || ('HTTP ' + res.status));
  return data;
}

window.saOpen = async function() {
  _sa.rows = [];
  var old = document.getElementById('saModal'); if (old) old.remove();
  var w = document.createElement('div');
  w.innerHTML =
  '<div class="modal fade" id="saModal" tabindex="-1" data-bs-backdrop="static"><div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">' +
    '<div class="modal-header" style="background:#1e3a5f;color:#fff;"><h5 class="modal-title"><i class="bi bi-bookmark-check me-2"></i>Allocate Stock</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>' +
    '<div class="modal-body">' +
      '<div class="alert alert-info py-2 small">Para sa mga item na <b>naka-allocate na sa physical</b>. Ilagay ang <b>Qty to allocate</b>. Kung ang item ay <b>nasa on-hand na</b>, iwanang 0 ang <b>Not yet in on-hand</b> (reserve lang, bababa ang Available). Kung <b>wala pa sa on-hand</b>, ilagay ang bilang doon — <b>idadagdag muna sa on-hand</b> (may adjustment sa ledger) saka ia-allocate. Ang allocation galing MRR ay hindi apektado.</div>' +
      '<div class="row g-2 mb-3">' +
        '<div class="col-md-4"><label class="form-label small fw-bold">SOF No. *</label><input id="saSof" class="form-control" list="saSofList" placeholder="e.g. SOF-2610-001" autocomplete="off"><datalist id="saSofList"></datalist></div>' +
        '<div class="col-md-4"><label class="form-label small fw-bold">Client</label><input id="saClient" class="form-control" placeholder="optional"></div>' +
        '<div class="col-md-4"><label class="form-label small fw-bold">Project / JO No.</label><input id="saProject" class="form-control" placeholder="optional"></div>' +
      '</div>' +
      '<label class="form-label small fw-bold">Scan or search item</label>' +
      '<div class="input-group"><span class="input-group-text"><i class="bi bi-upc-scan"></i></span><input id="saScan" class="form-control" placeholder="Scan barcode/QR, or type item code or description, then Enter" autocomplete="off" oninput="saSearch()" onkeydown="saKey(event)"></div>' +
      '<div id="saResults" class="list-group mb-2" style="max-height:220px;overflow:auto;"></div>' +
      '<div class="small text-muted mb-2" id="saHint">Tip: ang pag-scan ulit ng parehong item ay dagdag +1 sa bilang.</div>' +
      '<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Item</th><th class="text-end">On-hand</th><th class="text-end">Already allocated</th><th class="text-end">Free</th><th style="width:120px">Qty to allocate</th><th style="width:150px">Not yet in on-hand</th><th></th></tr></thead><tbody id="saRows"></tbody></table></div>' +
      '<label class="form-label small fw-bold">Reason *</label><input id="saReason" class="form-control" value="Physical allocation — hindi pa hiwalay sa on-hand">' +
    '</div>' +
    '<div class="modal-footer"><span class="me-auto small text-muted" id="saTotals"></span><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button><button class="btn btn-primary" id="saSubmit" onclick="saSubmit()"><i class="bi bi-check2-circle me-1"></i>Allocate</button></div>' +
  '</div></div></div>';
  document.body.appendChild(w.firstChild);
  saRender();
  var el = document.getElementById('saModal');
  el.addEventListener('shown.bs.modal', function() { document.getElementById('saSof').focus(); });
  bootstrap.Modal.getOrCreateInstance(el).show();
  try {
    var al = await erpFetch('erp_sof_allocations', 'select=sof_no&order=sof_no.desc&limit=300') || [];
    document.getElementById('saSofList').innerHTML = al.map(function(a) { return '<option value="' + saEsc(a.sof_no) + '">'; }).join('');
  } catch (e) {}
};

async function saReserved(codes) {
  var resv = {};
  if (!codes.length) return resv;
  var al = await erpFetch('erp_sof_allocation_items', 'select=item_code,allocated_qty,used_qty&item_code=in.(' + encodeURIComponent(codes.map(function(c) { return '"' + c + '"'; }).join(',')) + ')') || [];
  al.forEach(function(a) { var r = Number(a.allocated_qty || 0) - Number(a.used_qty || 0); if (r > 0) resv[a.item_code] = (resv[a.item_code] || 0) + r; });
  return resv;
}

window.saSearch = function() {
  clearTimeout(_sa.timer);
  _sa.timer = setTimeout(async function() {
    var term = document.getElementById('saScan').value.trim().replace(/[*,()"]/g, ' ').trim();
    var box = document.getElementById('saResults');
    if (term.length < 2) { box.innerHTML = ''; return; }
    try {
      var t = encodeURIComponent(term);
      var rows = await erpFetch('erp_items', 'select=item_code,description,base_unit,on_hand&is_deleted=not.is.true&is_active=eq.true&or=(item_code.ilike.*' + t + '*,description.ilike.*' + t + '*)&order=item_code.asc&limit=15') || [];
      if (document.getElementById('saScan').value.trim().replace(/[*,()"]/g, ' ').trim() !== term) return;
      if (!rows.length) { box.innerHTML = '<div class="list-group-item text-muted small">No match</div>'; return; }
      var resv = await saReserved(rows.map(function(r) { return r.item_code; }));
      window._saFound = rows.map(function(r) { r.reserved = resv[r.item_code] || 0; return r; });
      box.innerHTML = rows.map(function(r, i) {
        return '<button type="button" class="list-group-item list-group-item-action py-1" onclick="saPick(' + i + ')"><code>' + saEsc(r.item_code) + '</code> <span class="small">' + saEsc((r.description || '').substring(0, 70)) + '</span>' +
          '<span class="float-end small">on-hand <b>' + saNum(r.on_hand) + '</b> · free <b>' + saNum(Number(r.on_hand || 0) - r.reserved) + '</b></span></button>';
      }).join('');
    } catch (e) { box.innerHTML = '<div class="list-group-item text-danger small">' + saEsc(e.message) + '</div>'; }
  }, 200);
};

window.saKey = async function(ev) {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  var raw = ev.target.value.trim();
  if (!raw) return;
  clearTimeout(_sa.timer);
  var code = raw.toUpperCase().replace(/\s+/g, '');
  var hit = _sa.rows.find(function(x) { return x.item_code.toUpperCase().replace(/\s+/g, '') === code; });
  if (hit) { hit.qty = (Number(hit.qty) || 0) + 1; saFinishScan(); return; }
  try {
    var rows = await erpFetch('erp_items', 'select=item_code,description,base_unit,on_hand&is_deleted=not.is.true&is_active=eq.true&item_code=ilike.' + encodeURIComponent(raw.replace(/\s+/g, '')) + '&limit=2') || [];
    if (!rows.length) rows = await erpFetch('erp_items', 'select=item_code,description,base_unit,on_hand&is_deleted=not.is.true&is_active=eq.true&item_code=ilike.' + encodeURIComponent(raw) + '&limit=2') || [];
    if (rows.length === 1) { var resv = await saReserved([rows[0].item_code]); rows[0].reserved = resv[rows[0].item_code] || 0; saAdd(rows[0]); saFinishScan(); }
    else document.getElementById('saHint').innerHTML = '<span class="text-danger">Walang eksaktong match para sa “' + saEsc(raw) + '”. Pumili sa listahan sa itaas.</span>';
  } catch (e) { document.getElementById('saHint').innerHTML = '<span class="text-danger">' + saEsc(e.message) + '</span>'; }
};

function saAdd(r) {
  if (_sa.rows.some(function(x) { return x.item_code === r.item_code; })) return;
  _sa.rows.unshift({ item_code: r.item_code, description: r.description, unit: r.base_unit, on_hand: Number(r.on_hand || 0), reserved: Number(r.reserved || 0), qty: 1, add: 0 });
}
function saFinishScan() {
  var s = document.getElementById('saScan'); s.value = ''; document.getElementById('saResults').innerHTML = '';
  document.getElementById('saHint').textContent = 'Tip: ang pag-scan ulit ng parehong item ay dagdag +1 sa bilang.';
  saRender(); s.focus();
}
window.saPick = function(i) { saAdd(window._saFound[i]); saFinishScan(); };

function saRender() {
  var tb = document.getElementById('saRows'); if (!tb) return;
  tb.innerHTML = _sa.rows.length ? _sa.rows.map(function(x, i) {
    var free = x.on_hand - x.reserved, addq = Number(x.add) || 0, over = Number(x.qty) > free + addq || addq > Number(x.qty) || addq < 0;
    return '<tr><td><code>' + saEsc(x.item_code) + '</code><div class="small text-muted">' + saEsc((x.description || '').substring(0, 60)) + ' · ' + saEsc(x.unit || '') + '</div></td>' +
      '<td class="text-end">' + saNum(x.on_hand) + '</td><td class="text-end">' + saNum(x.reserved) + '</td>' +
      '<td class="text-end ' + (free > 0 ? 'text-success' : 'text-danger') + ' fw-bold">' + saNum(free) + '</td>' +
      '<td><input type="number" min="0" step="any" class="form-control form-control-sm' + (over ? ' is-invalid' : '') + '" value="' + saEsc(x.qty) + '" onchange="_sa.rows[' + i + '].qty=this.value;saRender()">' + (over ? '<div class="invalid-feedback d-block">Higit sa free</div>' : '') + '</td>' +
      '<td><div class="input-group input-group-sm"><input type="number" min="0" step="any" class="form-control' + (addq > Number(x.qty) ? ' is-invalid' : '') + '" value="' + saEsc(x.add) + '" onchange="_sa.rows[' + i + '].add=this.value;saRender()"><button class="btn btn-outline-secondary" type="button" title="Lahat ng qty ay wala pa sa on-hand" onclick="_sa.rows[' + i + '].add=_sa.rows[' + i + '].qty;saRender()">All</button></div></td>' +
      '<td><button class="btn btn-sm btn-link text-danger" onclick="_sa.rows.splice(' + i + ',1);saRender()"><i class="bi bi-x-lg"></i></button></td></tr>';
  }).join('') : '<tr><td colspan="7" class="text-muted text-center py-3">Wala pang item. I-scan o hanapin sa itaas.</td></tr>';
  var n = _sa.rows.filter(function(x) { return Number(x.qty) > 0; }).length, na = _sa.rows.filter(function(x) { return Number(x.qty) > 0 && Number(x.add) > 0; }).length;
  var t = document.getElementById('saTotals'); if (t) t.textContent = n + ' item(s) ready' + (na ? ' · ' + na + ' ang idadagdag sa on-hand' : '');
}

window.saSubmit = async function() {
  var sof = document.getElementById('saSof').value.trim(), reason = document.getElementById('saReason').value.trim();
  var good = _sa.rows.filter(function(x) { return Number(x.qty) > 0; });
  var items = good.map(function(x) { return { item_code: x.item_code, qty: Number(x.qty), add_qty: Number(x.add) || 0 }; });
  var addN = items.filter(function(x) { return x.add_qty > 0; }).length;
  if (items.some(function(x) { return x.add_qty < 0 || x.add_qty > x.qty; })) return erpShowToast('Ang "Not yet in on-hand" ay hindi puwedeng higit sa Qty to allocate', 'warning');
  if (!sof) return erpShowToast('SOF No. is required', 'warning');
  if (!items.length) return erpShowToast('Maglagay ng qty sa kahit isang item', 'warning');
  if (!reason) return erpShowToast('Reason is required', 'warning');
  if (!confirm('Allocate ' + items.length + ' item(s) to ' + sof + '?\n' + (addN ? addN + ' item(s) ang IDADAGDAG sa on-hand (ADJUSTMENT) bago i-allocate.' : 'Hindi magbabago ang on-hand.'))) return;
  var btn = document.getElementById('saSubmit'); btn.disabled = true;
  try {
    var r = await saRpc(addN ? 'erp_sof_allocate_stock' : 'erp_sof_manual_allocate', {
      p_sof_no: sof, p_items: addN ? items : items.map(function(x) { return { item_code: x.item_code, qty: x.qty }; }), p_user: saUser(), p_reason: reason,
      p_header: { client_name: document.getElementById('saClient').value.trim(), project_name: document.getElementById('saProject').value.trim() }
    });
    if (!r || !r.success) {
      var d = (r && r.details || []).map(function(x) { return x.item_code + ': ' + x.error; }).join('\n');
      alert((r && r.error || 'Failed') + (d ? '\n\n' + d : ''));
      return;
    }
    erpShowToast('✅ Allocated ' + r.items + ' item(s) to ' + r.sof_no + (r.added_to_onhand ? ' · ' + r.added_to_onhand + ' idinagdag sa on-hand' : ''), 'success');
    bootstrap.Modal.getInstance(document.getElementById('saModal')).hide();
    if (typeof erpRefreshAll === 'function') erpRefreshAll();
  } catch (e) {
    erpShowToast('Failed: ' + e.message + (addN ? ' (na-run mo na ba ang sof-allocate-stock.sql?)' : ' (na-run mo na ba ang sof-manual.sql?)'), 'danger');
  } finally { btn.disabled = false; }
};
