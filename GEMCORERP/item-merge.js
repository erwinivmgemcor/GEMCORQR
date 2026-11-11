// ============================================================
// GEMCOR ERP — Duplicate Item Finder + Merge (Stock Monitor)
// Hinahanap ang mga code na halos magkapareho (hal. GEM-EZC630H3500 at GEM-EZC630H3500N),
// pinapapili kung alin ang IIWAN, nagpapakita ng PREVIEW, saka lang ime-merge.
// Backend: rpc/erp_merge_items (run erp-item-merge.sql once).
// ============================================================
var _im = { items: [], groups: [], shown: 40, modal: null, busy: false, query: '' };

function imEsc(s) { return (typeof erpEsc === 'function') ? erpEsc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function imNum(n) { return Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 }); }
function imCanMerge() {
  var r = (localStorage.getItem('ivm_userRole') || '').toLowerCase();
  return r === 'warehouse' || r === 'admin';
}

// ─── DETECTION ───────────────────────────────────────────────
// normalized: uppercase, walang dash/space, walang "GEM" sa unahan
function imNorm(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^GEM/, ''); }
function imWords(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9. ]+/g, ' ').split(/\s+/).filter(function(w) { return w.length > 0; });
}
function imSimilarity(a, b) {
  var A = imWords(a), B = imWords(b);
  if (!A.length || !B.length) return 0;
  var sa = {}, sb = {}, inter = 0, uni = 0;
  A.forEach(function(w) { sa[w] = 1; }); B.forEach(function(w) { sb[w] = 1; });
  Object.keys(sa).forEach(function(w) { if (sb[w]) inter++; });
  uni = Object.keys(sa).length + Object.keys(sb).length - inter;
  return uni ? inter / uni : 0;
}

function imDetect(items) {
  var n = items.length, parent = [], i, j;
  for (i = 0; i < n; i++) parent[i] = i;
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }

  var byNorm = {};
  items.forEach(function(it, idx) { it._n = imNorm(it.item_code); (byNorm[it._n] = byNorm[it._n] || []).push(idx); });

  // 1) parehong code kapag tinanggal ang dash / space / laki-liit ng letra
  Object.keys(byNorm).forEach(function(k) {
    var g = byNorm[k];
    for (var x = 1; x < g.length; x++) union(g[0], g[x]);
  });

  // 2) ang isa ay prefix ng isa + 1–2 LETRA lang sa dulo, at ang base ay nagtatapos sa numero
  //    (hal. ...3500 at ...3500N). Hindi isinasama ang dagdag na numero (…35 vs …350 ay magkaibang item)
  var keys = Object.keys(byNorm).sort();
  for (i = 0; i < keys.length; i++) {
    var base = keys[i];
    if (base.length < 5 || !/[0-9]$/.test(base)) continue;
    for (j = i + 1; j < keys.length; j++) {
      var other = keys[j];
      if (other.indexOf(base) !== 0) break;            // sorted: wala nang magsisimula sa base pagkatapos nito
      var suffix = other.slice(base.length);
      if (/^[A-Z]{1,2}$/.test(suffix)) union(byNorm[base][0], byNorm[other][0]);
    }
  }

  var clusters = {};
  items.forEach(function(it, idx) { var r = find(idx); (clusters[r] = clusters[r] || []).push(it); });

  var groups = [];
  Object.keys(clusters).forEach(function(k) {
    var g = clusters[k];
    if (g.length < 2) return;
    // suggested keeper: yung may "GEM-" sa unahan (standard ng system), saka ang pinakamaikling code
    function gemFirst(x) { return /^GEM-/i.test(String(x.item_code)) ? 0 : 1; }
    g.sort(function(a, b) { return gemFirst(a) - gemFirst(b) || String(a.item_code).length - String(b.item_code).length || String(a.item_code).localeCompare(b.item_code); });
    var minSim = 1;
    for (var a = 0; a < g.length; a++) for (var b = a + 1; b < g.length; b++) minSim = Math.min(minSim, imSimilarity(g[a].description, g[b].description));
    var withStock = g.filter(function(x) { return Number(x.on_hand || 0) !== 0; }).length;
    groups.push({
      id: 'g' + groups.length,
      items: g,
      keep: g[0].item_code,                 // suggested: pinakamaikling code (karaniwang orihinal)
      picked: {},                           // code -> true kung isasama sa merge (default: lahat ng hindi keeper)
      sim: minSim,
      conf: minSim >= 0.85 ? 'high' : (minSim >= 0.45 ? 'mid' : 'low'),
      withStock: withStock,
      manual: false
    });
  });
  groups.sort(function(a, b) { return b.sim - a.sim || String(a.items[0].item_code).localeCompare(b.items[0].item_code); });
  groups.forEach(function(g) { g.items.forEach(function(it) { g.picked[it.item_code] = (it.item_code !== g.keep); }); });
  return groups;
}

// ─── UI ──────────────────────────────────────────────────────
function imEnsureModal() {
  if (document.getElementById('imModal')) return;
  var m = document.createElement('div');
  m.className = 'modal fade'; m.id = 'imModal'; m.tabIndex = -1;
  m.setAttribute('data-bs-backdrop', 'static');
  m.innerHTML =
    '<div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header"><h5 class="modal-title"><i class="bi bi-intersect me-2"></i>Duplicate Items — Find &amp; Merge' +
        ' <span class="badge bg-secondary ms-2" id="imCount">0</span></h5>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
      '<div class="modal-body">' +
        '<div class="alert alert-light border small mb-3"><i class="bi bi-info-circle me-1"></i>' +
          'Pumili ng <b>code na IIWAN</b> (radio), at lagyan ng ✔ ang mga code na <b>ime-merge</b> dito. Ililipat ang kanilang <b>stock</b> at lahat ng ' +
          '<b>dokumento/PRF/SOF</b> na gumagamit sa kanila, tapos made-deactivate ang mga ito. Bago mag-merge, may <b>Preview</b> muna — walang magagalaw hangga\'t hindi mo kinukumpirma.</div>' +
        '<div class="row g-2 mb-3">' +
          '<div class="col-md-5"><input type="text" class="form-control" id="imSearch" placeholder="Hanapin sa mga duplicate (code o description)..."></div>' +
          '<div class="col-md-7 d-flex gap-2 align-items-center flex-wrap">' +
            '<span class="small text-muted">Manual:</span>' +
            '<input type="text" class="form-control form-control-sm" style="max-width:190px" id="imManKeep" placeholder="Code na IIWAN" list="imCodes">' +
            '<span class="small">←</span>' +
            '<input type="text" class="form-control form-control-sm" style="max-width:190px" id="imManDup" placeholder="Code na ime-merge" list="imCodes">' +
            '<button class="btn btn-sm btn-outline-primary" id="imManBtn">Add</button>' +
            '<datalist id="imCodes"></datalist>' +
          '</div>' +
        '</div>' +
        '<div id="imBody"></div>' +
      '</div>' +
      '<div class="modal-footer"><small class="text-muted me-auto">Sinusuri ang code na magkapareho kapag inalis ang dash/laki-liit, o may dagdag na 1–2 letra sa dulo (hal. …3500 / …3500N).</small>' +
        '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button></div>' +
    '</div></div>';
  document.body.appendChild(m);
  document.getElementById('imSearch').addEventListener('input', function() { _im.query = this.value.trim().toLowerCase(); _im.shown = 40; imRender(); });
  document.getElementById('imManBtn').addEventListener('click', imAddManual);
}

async function imOpen() {
  if (!imCanMerge()) { erpShowToast('Warehouse o Admin lang ang puwedeng mag-merge ng items', 'warning'); return; }
  imEnsureModal();
  _im.modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('imModal'));
  _im.modal.show();
  await imLoad();
}

async function imLoad() {
  var body = document.getElementById('imBody');
  body.innerHTML = '<div class="text-center py-5 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Hinahanap ang mga duplicate...</div>';
  try {
    var rows = await erpFetchAll('erp_items',
      'select=item_code,description,category,location,base_unit,on_hand,unit_cost&is_deleted=not.is.true&order=item_code.asc');
    _im.items = rows || [];
    _im.groups = imDetect(_im.items);
    _im.shown = 40;
    var dl = document.getElementById('imCodes');
    if (dl) dl.innerHTML = _im.items.map(function(it) { return '<option value="' + imEsc(it.item_code) + '">'; }).join('');
    imRender();
  } catch (e) {
    console.error('[imLoad]', e);
    body.innerHTML = '<div class="alert alert-danger">Hindi ma-load ang items: ' + imEsc(e.message) + '</div>';
  }
}

function imVisibleGroups() {
  var q = _im.query;
  if (!q) return _im.groups;
  return _im.groups.filter(function(g) {
    return g.items.some(function(it) { return String(it.item_code).toLowerCase().indexOf(q) !== -1 || String(it.description || '').toLowerCase().indexOf(q) !== -1; });
  });
}

function imRender() {
  var cnt = document.getElementById('imCount');
  if (cnt) cnt.textContent = _im.groups.length;
  var body = document.getElementById('imBody');
  var vis = imVisibleGroups();
  if (!_im.groups.length) {
    body.innerHTML = '<div class="text-center text-muted py-5"><i class="bi bi-check2-circle fs-1 d-block mb-2 text-success"></i>Walang nakitang duplicate. Puwede mong gamitin ang <b>Manual</b> sa itaas para i-merge ang dalawang code.</div>';
    return;
  }
  if (!vis.length) { body.innerHTML = '<div class="text-center text-muted py-4">Walang tumugma sa hinahanap.</div>'; return; }

  var confLabel = { high: '<span class="badge bg-success">Same description</span>', mid: '<span class="badge bg-warning text-dark">Similar description</span>', low: '<span class="badge bg-danger">Different description — suriin</span>' };
  var html = vis.slice(0, _im.shown).map(function(g) {
    var rowsHtml = g.items.map(function(it) {
      var isKeep = it.item_code === g.keep;
      return '<tr class="' + (isKeep ? 'table-success' : '') + '">' +
        '<td class="text-center"><input type="radio" name="imkeep_' + g.id + '" ' + (isKeep ? 'checked' : '') + ' onchange="imSetKeep(\'' + g.id + '\', ' + JSON.stringify(it.item_code).replace(/"/g, '&quot;') + ')"></td>' +
        '<td class="text-center">' + (isKeep ? '<span class="badge bg-success">IIWAN</span>' :
          '<input type="checkbox" ' + (g.picked[it.item_code] ? 'checked' : '') + ' onchange="imTogglePick(\'' + g.id + '\', ' + JSON.stringify(it.item_code).replace(/"/g, '&quot;') + ', this.checked)"> <small class="text-muted">i-merge</small>') + '</td>' +
        '<td><code>' + imEsc(it.item_code) + '</code></td>' +
        '<td style="min-width:260px">' + imEsc(it.description || '') + '</td>' +
        '<td>' + imEsc(it.category || '') + '</td>' +
        '<td>' + imEsc(it.location || '') + '</td>' +
        '<td class="text-end fw-bold">' + imNum(it.on_hand) + ' <small class="text-muted fw-normal">' + imEsc(it.base_unit || '') + '</small></td>' +
        '<td class="text-end">₱' + imNum(it.unit_cost) + '</td></tr>';
    }).join('');
    var nPick = g.items.filter(function(it) { return g.picked[it.item_code] && it.item_code !== g.keep; }).length;
    return '<div class="border rounded mb-3" id="im_' + g.id + '">' +
      '<div class="d-flex justify-content-between align-items-center px-3 py-2 bg-light border-bottom">' +
        '<div>' + (g.manual ? '<span class="badge bg-info text-dark">Manual</span>' : confLabel[g.conf]) + ' <small class="text-muted ms-2">' + g.items.length + ' codes' + (g.withStock > 1 ? ' · may stock ang ' + g.withStock + ' sa kanila' : '') + '</small></div>' +
        '<div class="d-flex gap-2">' +
          (g.manual ? '<button class="btn btn-sm btn-outline-secondary" onclick="imRemoveGroup(\'' + g.id + '\')">Remove</button>' : '') +
          '<button class="btn btn-sm btn-primary" ' + (nPick ? '' : 'disabled') + ' onclick="imPreview(\'' + g.id + '\')"><i class="bi bi-eye me-1"></i>Preview Merge (' + nPick + ')</button>' +
        '</div></div>' +
      '<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr class="small text-muted">' +
        '<th class="text-center" style="width:60px">Iwan</th><th class="text-center" style="width:110px">Merge</th><th>Item Code</th><th>Description</th><th>Category</th><th>Location</th><th class="text-end">On-Hand</th><th class="text-end">Unit Cost</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody></table></div>' +
      '<div class="px-3 py-2 d-none" id="imPrev_' + g.id + '"></div></div>';
  }).join('');
  if (vis.length > _im.shown) html += '<div class="text-center"><button class="btn btn-outline-secondary" onclick="_im.shown+=40;imRender()">Ipakita pa (' + (vis.length - _im.shown) + ' pa)</button></div>';
  body.innerHTML = html;
}

function imGroup(id) { return _im.groups.filter(function(g) { return g.id === id; })[0]; }
function imSetKeep(id, code) {
  var g = imGroup(id); if (!g) return;
  g.keep = code;
  g.items.forEach(function(it) { if (it.item_code === code) g.picked[it.item_code] = false; else if (g.picked[it.item_code] === undefined) g.picked[it.item_code] = true; });
  // kapag ang dating keeper ay ngayon ay hindi na keeper, isama sa merge bilang default
  g.items.forEach(function(it) { if (it.item_code !== code && !g._touched) g.picked[it.item_code] = true; });
  imRender();
}
function imTogglePick(id, code, on) { var g = imGroup(id); if (!g) return; g.picked[code] = !!on; g._touched = true; imRender(); }
function imRemoveGroup(id) { _im.groups = _im.groups.filter(function(g) { return g.id !== id; }); imRender(); }

function imAddManual() {
  var kc = (document.getElementById('imManKeep').value || '').trim().toLowerCase();
  var dc = (document.getElementById('imManDup').value || '').trim().toLowerCase();
  if (!kc || !dc) { erpShowToast('Ilagay ang dalawang code', 'warning'); return; }
  if (kc === dc) { erpShowToast('Magkaiba dapat ang dalawang code', 'warning'); return; }
  var k = _im.items.filter(function(it) { return String(it.item_code).toLowerCase() === kc; })[0];
  var d = _im.items.filter(function(it) { return String(it.item_code).toLowerCase() === dc; })[0];
  if (!k) { erpShowToast('Wala sa inventory (o deactivated): ' + kc, 'warning'); return; }
  if (!d) { erpShowToast('Wala sa inventory (o deactivated): ' + dc, 'warning'); return; }
  var g = { id: 'm' + Date.now(), items: [k, d], keep: k.item_code, picked: {}, sim: imSimilarity(k.description, d.description), withStock: 0, manual: true };
  g.conf = g.sim >= 0.85 ? 'high' : (g.sim >= 0.45 ? 'mid' : 'low');
  g.picked[k.item_code] = false; g.picked[d.item_code] = true;
  g.withStock = [k, d].filter(function(x) { return Number(x.on_hand || 0) !== 0; }).length;
  _im.groups.unshift(g);
  document.getElementById('imManKeep').value = ''; document.getElementById('imManDup').value = '';
  imRender();
}

// ─── RPC ─────────────────────────────────────────────────────
async function imCall(keep, dups, dryRun, reason) {
  var user = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE';
  var res = await fetch(erpUrl('rpc/erp_merge_items'), {
    method: 'POST', headers: erpHeaders(),
    body: JSON.stringify({ p_keep: keep, p_dups: dups, p_edited_by: user, p_reason: reason || '', p_dry_run: dryRun })
  });
  if (res.status === 404) throw new Error('Wala pa ang database function. I-run muna ang erp-item-merge.sql sa Supabase.');
  if (!res.ok) { var t = await res.text(); var m = ''; try { m = JSON.parse(t).message; } catch (e) {} throw new Error(m || ('HTTP ' + res.status)); }
  return res.json();
}

async function imPreview(id) {
  var g = imGroup(id); if (!g || _im.busy) return;
  var dups = g.items.filter(function(it) { return g.picked[it.item_code] && it.item_code !== g.keep; }).map(function(it) { return it.item_code; });
  if (!dups.length) return;
  var box = document.getElementById('imPrev_' + id);
  box.classList.remove('d-none');
  box.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sinusuri (walang magagalaw)...';
  _im.busy = true;
  try {
    var r = await imCall(g.keep, dups, true, '');
    if (!r || !r.success) { box.innerHTML = '<div class="alert alert-danger mb-0">' + imEsc((r && r.error) || 'Hindi ma-preview') + '</div>'; return; }

    var moved = (r.moved || []).map(function(m) {
      return '<li><code>' + imEsc(m.item) + '</code> → <code>' + imEsc(g.keep) + '</code>: ililipat ang stock na <b>' + imNum(m.on_hand_moved) + '</b></li>';
    }).join('');
    var tables = Object.keys(r.tables || {}).map(function(t) { return '<li><code>' + imEsc(t) + '</code>: ' + imNum(r.tables[t]) + ' row(s) ililipat sa <code>' + imEsc(g.keep) + '</code></li>'; }).join('');
    var conflicts = (r.conflicts || []).map(function(c) { return '<li><code>' + imEsc(c.table) + '</code> (' + imEsc(c.item) + '): ' + imEsc(c.why) + '</li>'; }).join('');
    var okBtn = r.can_merge
      ? '<div class="d-flex gap-2 align-items-center flex-wrap mt-2">' +
          '<input type="text" class="form-control form-control-sm" style="max-width:320px" id="imReason_' + id + '" value="Duplicate item code" maxlength="200">' +
          '<button class="btn btn-sm btn-danger" onclick="imConfirm(\'' + id + '\')"><i class="bi bi-intersect me-1"></i>Confirm Merge</button>' +
          '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'imPrev_' + id + '\').classList.add(\'d-none\')">Cancel</button>' +
        '</div>'
      : '<div class="alert alert-danger mt-2 mb-0">Hindi puwedeng ituloy dahil sa conflict sa itaas. Ayusin muna (halimbawa, alisin sa iisang SOF allocation ang isa sa dalawang code) o huwag isama ang code na iyon.</div>';

    box.innerHTML =
      '<div class="border rounded p-2 bg-white small"><div class="fw-bold mb-1">Preview — ito ang mangyayari:</div>' +
      '<div>Iiwan: <code>' + imEsc(g.keep) + '</code> · Ide-deactivate: ' + dups.map(function(d) { return '<code>' + imEsc(d) + '</code>'; }).join(', ') + '</div>' +
      '<ul class="mb-1 mt-1">' + (moved || '') + '</ul>' +
      (tables ? '<div class="text-muted">Mga record na ililipat sa code na iiwan:</div><ul class="mb-1">' + tables + '</ul>' : '<div class="text-muted">Walang dokumento / PRF / SOF na gumagamit ng mga code na ito.</div>') +
      (conflicts ? '<div class="text-danger fw-bold">Conflicts:</div><ul class="text-danger mb-1">' + conflicts + '</ul>' : '') +
      '<div class="text-muted">Mananatili ang lumang stock history ng deactivated na code (para tama ang mga dating ledger).</div>' +
      okBtn + '</div>';
  } catch (e) {
    box.innerHTML = '<div class="alert alert-danger mb-0">' + imEsc(e.message) + '</div>';
  } finally { _im.busy = false; }
}

async function imConfirm(id) {
  var g = imGroup(id); if (!g || _im.busy) return;
  var dups = g.items.filter(function(it) { return g.picked[it.item_code] && it.item_code !== g.keep; }).map(function(it) { return it.item_code; });
  var reason = (document.getElementById('imReason_' + id).value || '').trim();
  if (!reason) { erpShowToast('Kailangan ang reason', 'warning'); return; }
  if (!confirm('I-merge ang ' + dups.join(', ') + ' papunta sa ' + g.keep + '?\n\nIto ay hindi madaling i-undo (ililipat ang stock at mga dokumento, at made-deactivate ang mga code).')) return;
  _im.busy = true;
  var box = document.getElementById('imPrev_' + id);
  box.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Nagme-merge...';
  try {
    var r = await imCall(g.keep, dups, false, reason);
    if (!r || !r.success) { box.innerHTML = '<div class="alert alert-danger mb-0">' + imEsc((r && r.error) || 'Failed') + ' — walang nabago.</div>'; return; }
    erpShowToast('✅ Na-merge ang ' + dups.join(', ') + ' → ' + g.keep, 'success');
    _im.groups = _im.groups.filter(function(x) { return x.id !== id; });
    _im.items = _im.items.filter(function(it) { return dups.indexOf(it.item_code) === -1; });
    imRender();
    if (typeof erpLoadItems === 'function') erpLoadItems();
  } catch (e) {
    box.innerHTML = '<div class="alert alert-danger mb-0">' + imEsc(e.message) + '</div>';
  } finally { _im.busy = false; }
}

window.imOpen = imOpen; window.imSetKeep = imSetKeep; window.imTogglePick = imTogglePick; window.imPreview = imPreview;
window.imConfirm = imConfirm; window.imRemoveGroup = imRemoveGroup; window._im = _im; window.imRender = imRender;
