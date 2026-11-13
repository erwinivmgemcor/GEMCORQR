// ============================================================
// GEMCOR ERP — Stock Monitor: Import Allocated (CSV galing sa lumang Google Sheet)
// Template: SOF No., Item Code, Allocated Qty, Client, Project / JO No.
// RULES:
//  • Kapag may parehong SOF No. + Item Code na sa system → SKIP (hindi dinadagdagan).
//  • Kapag paulit-ulit sa file ang SOF + Item → unang row lang ang gagamitin.
//  • Mode (pili ka muna): idagdag din sa on-hand, o i-allocate lang (kasama na sa on-hand).
// Gumagamit ng existing na erp_sof_manual_allocate / erp_sof_allocate_stock.
// ============================================================
var _sai = { rows: [], file: '' };

var _SAI_ALIASES = {
  sof: ['sof no', 'sof no.', 'sof', 'sof_no', 'sof number', 'sof#'],
  code: ['item code', 'item_code', 'itemcode', 'code'],
  qty: ['allocated qty', 'allocated', 'qty', 'quantity', 'sof allocated', 'allocated_qty'],
  client: ['client', 'client name', 'client_name'],
  project: ['project / jo no.', 'project/jo no.', 'project / jo no', 'project', 'project name', 'jo no', 'jo no.', 'jo']
};

function saiEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function saiKeyCode(c) { return String(c || '').replace(/\s+/g, '').toUpperCase(); }
function saiKeySof(s) { return String(s || '').trim().toUpperCase(); }

window.saiDownloadTemplate = function() {
  var csv = '\uFEFF' + ['SOF No.', 'Item Code', 'Allocated Qty', 'Client', 'Project / JO No.'].join(',') + '\n' +
    '13571,GEM-XXX,20,Sample Client,PEA GUARDHOUSE\n';
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = 'sof_allocated_import_template.csv';
  document.body.appendChild(a); a.click(); a.remove();
};

// Pure-ish: basahin ang CSV text at i-classify ang bawat row laban sa items at existing allocations
async function saiAnalyze(text) {
  var table = _csvParse(text);
  if (table.length < 2) throw new Error('Walang laman ang file.');
  var hdr = table[0].map(_csvNormHeader), idx = {};
  Object.keys(_SAI_ALIASES).forEach(function(k) {
    idx[k] = hdr.findIndex(function(h) { return _SAI_ALIASES[k].indexOf(h) !== -1; });
  });
  ['sof', 'code', 'qty'].forEach(function(k) { if (idx[k] < 0) throw new Error('Kulang ang column: ' + { sof: 'SOF No.', code: 'Item Code', qty: 'Allocated Qty' }[k]); });

  var items = {}, sys = {};
  (await erpFetchAll('erp_items', 'select=item_code,description,on_hand,is_active,is_deleted&order=item_code.asc') || []).forEach(function(i) { items[saiKeyCode(i.item_code)] = i; });
  (await erpFetchAll('erp_sof_allocation_items', 'select=sof_no,item_code,allocated_qty,used_qty&order=sof_no.asc') || []).forEach(function(a) {
    sys[saiKeySof(a.sof_no) + '|' + saiKeyCode(a.item_code)] = a;
  });

  var seen = {}, rows = [];
  for (var r = 1; r < table.length; r++) {
    var c = table[r], row = { line: r + 1, sof: (c[idx.sof] || '').trim(), code: (c[idx.code] || '').trim(), qtyRaw: c[idx.qty],
      client: idx.client >= 0 ? (c[idx.client] || '').trim() : '', project: idx.project >= 0 ? (c[idx.project] || '').trim() : '' };
    row.qty = _csvNum(row.qtyRaw);
    var item = items[saiKeyCode(row.code)], key = saiKeySof(row.sof) + '|' + saiKeyCode(row.code);
    if (!row.sof || !row.code) { row.status = 'err'; row.msg = 'Kulang ang SOF No. o Item Code'; }
    else if (row.qty === null || isNaN(row.qty) || row.qty <= 0) { row.status = 'err'; row.msg = 'Invalid ang qty (' + (row.qtyRaw || 'blangko') + ')'; }
    else if (!item || item.is_deleted === true || item.is_active === false) { row.status = 'err'; row.msg = 'Item code wala sa system / inactive'; }
    else if (sys[key]) { row.status = 'dup_sys'; row.msg = 'Nasa system na (' + Number(sys[key].allocated_qty || 0) + ' allocated) — hindi dinagdagan'; }
    else if (seen[key]) { row.status = 'dup_file'; row.msg = 'Paulit-ulit sa file (row ' + seen[key] + ') — hindi dinagdagan'; }
    else { row.status = 'ok'; row.msg = 'Idadagdag'; row.item = item; seen[key] = row.line; }
    rows.push(row);
  }
  return rows;
}

window.saiOpen = function() {
  _sai.rows = [];
  var old = document.getElementById('saiModal'); if (old) old.remove();
  var w = document.createElement('div');
  w.innerHTML =
  '<div class="modal fade" id="saiModal" tabindex="-1" data-bs-backdrop="static"><div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">' +
    '<div class="modal-header" style="background:#1e3a5f;color:#fff;"><h5 class="modal-title"><i class="bi bi-file-earmark-arrow-up me-2"></i>Import Allocated (galing lumang sheet)</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>' +
    '<div class="modal-body">' +
      '<div class="alert alert-info py-2 small">Mag-upload ng CSV na may <b>SOF No., Item Code, Allocated Qty</b> (optional: Client, Project / JO No.). Ang may <b>parehong SOF + Item na sa system</b> ay <b>lalaktawan</b> — hindi madadagdagan ang allocated mo ngayon. <a href="javascript:void(0)" onclick="saiDownloadTemplate()">I-download ang template</a></div>' +
      '<input type="file" id="saiFile" accept=".csv,text/csv" class="form-control mb-3" onchange="saiOnFile(this)">' +
      '<div id="saiPreview"></div>' +
    '</div>' +
    '<div class="modal-footer"><span class="me-auto small text-muted" id="saiProgress"></span><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button><button class="btn btn-primary" id="saiRun" disabled onclick="saiRun()"><i class="bi bi-check2-circle me-1"></i>Import</button></div>' +
  '</div></div></div>';
  document.body.appendChild(w.firstChild);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('saiModal')).show();
};

window.saiOnFile = async function(inp) {
  var f = inp.files && inp.files[0]; if (!f) return;
  var box = document.getElementById('saiPreview');
  box.innerHTML = '<div class="text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Sinusuri ang file…</div>';
  document.getElementById('saiRun').disabled = true;
  try {
    _sai.rows = await saiAnalyze(await f.text());
    saiRenderPreview();
  } catch (e) { box.innerHTML = '<div class="alert alert-danger">' + saiEsc(e.message) + '</div>'; }
};

function saiCount(st) { return _sai.rows.filter(function(r) { return r.status === st; }).length; }

function saiRenderPreview() {
  var ok = _sai.rows.filter(function(r) { return r.status === 'ok'; });
  var units = ok.reduce(function(s, r) { return s + r.qty; }, 0);
  var badge = { ok: 'success', dup_sys: 'secondary', dup_file: 'secondary', err: 'danger' };
  var lbl = { ok: 'IDADAGDAG', dup_sys: 'SKIP — nasa system', dup_file: 'SKIP — dobleng row', err: 'ERROR' };
  document.getElementById('saiPreview').innerHTML =
    '<div class="row g-2 mb-3 text-center">' +
      '<div class="col"><div class="border rounded p-2"><div class="h4 mb-0 text-success">' + ok.length + '</div><div class="small text-muted">Idadagdag (' + units.toLocaleString() + ' units)</div></div></div>' +
      '<div class="col"><div class="border rounded p-2"><div class="h4 mb-0 text-secondary">' + saiCount('dup_sys') + '</div><div class="small text-muted">Nasa system na (skip)</div></div></div>' +
      '<div class="col"><div class="border rounded p-2"><div class="h4 mb-0 text-secondary">' + saiCount('dup_file') + '</div><div class="small text-muted">Dobleng row (skip)</div></div></div>' +
      '<div class="col"><div class="border rounded p-2"><div class="h4 mb-0 text-danger">' + saiCount('err') + '</div><div class="small text-muted">May error</div></div></div>' +
    '</div>' +
    '<div class="border rounded p-3 mb-3"><div class="fw-bold mb-2">Ang On-Hand ng mga item sa system ngayon ay:</div>' +
      '<div class="form-check"><input class="form-check-input" type="radio" name="saiMode" id="saiModeAdd" value="add" onchange="saiModeChanged()"><label class="form-check-label" for="saiModeAdd"><b>HINDI kasama</b> ang allocated (naka-bukod sa lumang sheet) → <b>idadagdag sa on-hand</b> at ia-allocate</label></div>' +
      '<div class="form-check"><input class="form-check-input" type="radio" name="saiMode" id="saiModeOnly" value="only" onchange="saiModeChanged()"><label class="form-check-label" for="saiModeOnly"><b>KASAMA na</b> ang allocated → <b>ia-allocate lang</b>, hindi gagalawin ang on-hand</label></div>' +
      '<div class="small mt-2 text-muted" id="saiModeNote">Pumili muna bago mag-import.</div>' +
      '<label class="form-label small fw-bold mt-2 mb-1">Reason *</label><input id="saiReason" class="form-control form-control-sm" value="Migration — allocated galing sa lumang Google Sheet">' +
    '</div>' +
    '<div class="table-responsive" style="max-height:340px;overflow:auto;"><table class="table table-sm align-middle" style="font-size:.82rem"><thead class="table-light" style="position:sticky;top:0"><tr><th>Row</th><th>SOF No.</th><th>Item Code</th><th class="text-end">Qty</th><th>Resulta</th></tr></thead><tbody>' +
    _sai.rows.map(function(r) { return '<tr><td>' + r.line + '</td><td>' + saiEsc(r.sof) + '</td><td><code>' + saiEsc(r.code) + '</code></td><td class="text-end">' + (isNaN(r.qty) || r.qty === null ? saiEsc(r.qtyRaw) : r.qty) + '</td>' +
      '<td><span class="badge bg-' + badge[r.status] + '">' + lbl[r.status] + '</span> <span class="small text-muted">' + saiEsc(r.status === 'ok' ? '' : r.msg) + '</span></td></tr>'; }).join('') +
    '</tbody></table></div>';
  saiModeChanged();
}

window.saiModeChanged = function() {
  var m = document.querySelector('input[name="saiMode"]:checked');
  var ok = _sai.rows.filter(function(r) { return r.status === 'ok'; });
  var units = ok.reduce(function(s, r) { return s + r.qty; }, 0);
  var note = document.getElementById('saiModeNote');
  if (note) note.innerHTML = !m ? 'Pumili muna bago mag-import.' :
    (m.value === 'add' ? '<b class="text-danger">Tataas ang On-Hand ng ' + ok.length + ' item(s) ng kabuuang ' + units.toLocaleString() + ' units</b> (ADJUSTMENT sa ledger, may audit trail). Hindi magbabago ang Available.'
                       : 'Hindi magbabago ang On-Hand. Bababa ang <b>Available</b> ng ' + units.toLocaleString() + ' units. Mabibigo ang row kung kulang ang free stock.');
  document.getElementById('saiRun').disabled = !(m && ok.length);
};

async function saiCall(mode, sof, rows, reason, header) {
  var fn = mode === 'add' ? 'erp_sof_allocate_stock' : 'erp_sof_manual_allocate';
  var items = rows.map(function(r) { var o = { item_code: r.item.item_code, qty: r.qty }; if (mode === 'add') o.add_qty = r.qty; return o; });
  var r = await saRpc(fn, { p_sof_no: sof, p_items: items, p_user: saUser(), p_reason: reason, p_header: header });
  if (!r || !r.success) throw new Error(((r && r.error) || 'Failed') + ((r && r.details || []).length ? ' — ' + r.details.map(function(x) { return x.item_code + ': ' + x.error; }).join('; ') : ''));
}

window.saiRun = async function() {
  var m = document.querySelector('input[name="saiMode"]:checked'); if (!m) return;
  var reason = document.getElementById('saiReason').value.trim(); if (!reason) return erpShowToast('Reason is required', 'warning');
  var ok = _sai.rows.filter(function(r) { return r.status === 'ok'; });
  var bySof = {}; ok.forEach(function(r) { var k = saiKeySof(r.sof); (bySof[k] = bySof[k] || { sof: r.sof, rows: [], client: '', project: '' }); var g = bySof[k]; g.rows.push(r); g.client = g.client || r.client; g.project = g.project || r.project; });
  var groups = Object.keys(bySof).map(function(k) { return bySof[k]; });
  if (!confirm('I-import ang ' + ok.length + ' row(s) sa ' + groups.length + ' SOF?\n' + (m.value === 'add' ? 'IDADAGDAG din sa on-hand ang mga qty.' : 'Hindi magbabago ang on-hand.') + '\n\nAng nasa system na ay lalaktawan.')) return;
  document.getElementById('saiRun').disabled = true;
  document.getElementById('saiFile').disabled = true;
  var done = 0, partiesFail = 0;
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g], header = { client_name: grp.client, project_name: grp.project };
    document.getElementById('saiProgress').textContent = 'SOF ' + grp.sof + ' (' + (g + 1) + '/' + groups.length + ')…';
    try {
      await saiCall(m.value, grp.sof, grp.rows, reason, header);
      grp.rows.forEach(function(r) { r.status = 'done'; r.msg = 'Na-import'; });
    } catch (e) {
      // Subukan isa-isa para hindi madamay ang tamang rows
      for (var i = 0; i < grp.rows.length; i++) {
        var row = grp.rows[i];
        try { await saiCall(m.value, grp.sof, [row], reason, header); row.status = 'done'; row.msg = 'Na-import'; }
        catch (e2) { row.status = 'err'; row.msg = e2.message; }
      }
    }
    // Ilagay ang Client mula sa CSV sa SOF (hindi ino-overwrite ang na-edit nang client)
    if (grp.client && grp.rows.some(function(r) { return r.status === 'done'; })) {
      try {
        var pr = await saRpc('erp_sof_update_parties', { p_sof_no: grp.sof, p_client: grp.client, p_vendor: null, p_user: saUser(), p_only_if_blank: true });
        if (!pr || !pr.success) partiesFail++;
      } catch (e3) { partiesFail++; }
    }
  }
  done = _sai.rows.filter(function(r) { return r.status === 'done'; }).length;
  var failed = _sai.rows.filter(function(r) { return r.status === 'err' && r.item; }).length;
  document.getElementById('saiProgress').textContent = '';
  document.getElementById('saiPreview').innerHTML =
    '<div class="alert alert-' + (failed ? 'warning' : 'success') + '">✅ Na-import: <b>' + done + '</b> · Hindi na-import: <b>' + failed + '</b> · Nilaktawan (parehas na): <b>' + (saiCount('dup_sys') + saiCount('dup_file')) + '</b></div>' +
    (partiesFail ? '<div class="alert alert-warning py-2 small">Hindi na-save ang <b>Client</b> sa ' + partiesFail + ' SOF. I-run ang <code>sof-edit.sql</code> sa Supabase, tapos i-edit ang Client sa SOF Tracker (pencil button).</div>' : '') +
    (failed ? '<div class="table-responsive"><table class="table table-sm" style="font-size:.82rem"><thead><tr><th>Row</th><th>SOF</th><th>Item</th><th>Dahilan</th></tr></thead><tbody>' +
      _sai.rows.filter(function(r) { return r.status === 'err' && r.item; }).map(function(r) { return '<tr><td>' + r.line + '</td><td>' + saiEsc(r.sof) + '</td><td><code>' + saiEsc(r.code) + '</code></td><td class="text-danger">' + saiEsc(r.msg) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '');
  erpShowToast('Import done: ' + done + ' allocated', failed ? 'warning' : 'success');
  if (typeof erpRefreshAll === 'function') erpRefreshAll();
};
