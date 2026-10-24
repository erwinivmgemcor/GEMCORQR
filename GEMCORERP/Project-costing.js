// ============================================================
// GEMCOR ERP — Project Costing v1.0
// Reads: v_project_costing, v_project_cost_items, v_project_cost_moves
// Read-only. Para sa warehouse at production.
// ============================================================

var _pc = { rows: [], timer: null, loading: false };

document.addEventListener('DOMContentLoaded', function () {
  var role = '';
  try { role = localStorage.getItem('ivm_userRole') || ''; } catch (e) {}
  var back = document.getElementById('pcBackLink');
  if (back && role === 'production') back.setAttribute('href', 'my-requests.html');
  pcHealth();
  pcLoad();
  _pc.timer = setInterval(function () { if (!document.hidden) pcLoad(true); }, 60000);
});

async function pcHealth() {
  var badge = document.getElementById('erpHealthBadge');
  if (!badge) return;
  var text = document.getElementById('erpHealthText');
  var dot = badge.querySelector('.dot');
  try {
    var r = await erpHealthCheck();
    dot.className = 'dot ' + (r.success ? 'dot-ok' : 'dot-error');
    text.textContent = r.success ? 'Connected (' + r.latency + 'ms)' : 'Offline';
  } catch (e) { dot.className = 'dot dot-error'; text.textContent = 'Error'; }
}

function pcNum(n) { return Number(n || 0); }
function pcDate(s) {
  if (!s) return '—';
  var d = new Date(s);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' });
}
function pcQty(n) {
  return Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });
}

async function pcLoad(silent) {
  if (_pc.loading) return;
  _pc.loading = true;
  try {
    _pc.rows = await erpFetchAll('v_project_costing', 'select=*');
    pcRender();
    var up = document.getElementById('pcUpdated');
    if (up) up.textContent = 'Updated ' + new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' }) + ' • auto-refresh 60s';
  } catch (err) {
    console.error('[ProjectCosting]', err);
    var msg = String(err && err.message || err);
    var hint = /v_project_costing|404|PGRST205|relation/i.test(msg)
      ? 'Hindi pa na-run ang PROJECT_COSTING.sql sa Supabase.' : msg;
    document.getElementById('pcBody').innerHTML =
      '<tr><td colspan="9" class="erp-empty text-danger">' + erpEsc(hint) + '</td></tr>';
    if (!silent && typeof erpShowToast === 'function') erpShowToast('Failed to load: ' + hint, 'danger');
  } finally { _pc.loading = false; }
}

function pcFiltered() {
  var q = (document.getElementById('pcSearch').value || '').trim().toLowerCase();
  var rows = _pc.rows.filter(function (r) {
    if (!q) return true;
    return [r.jo_no, r.sof_no, r.project_name, r.client_name].join(' ').toLowerCase().indexOf(q) !== -1;
  });
  var sort = document.getElementById('pcSort').value;
  rows.sort(function (a, b) {
    if (sort === 'cost') return pcNum(b.net_cost) - pcNum(a.net_cost);
    if (sort === 'jo') return String(a.jo_no || a.sof_no || '').localeCompare(String(b.jo_no || b.sof_no || ''), undefined, { numeric: true });
    return new Date(b.last_activity || 0) - new Date(a.last_activity || 0);
  });
  return rows;
}

function pcRender() {
  var rows = pcFiltered();
  var all = _pc.rows;
  var sum = function (k) { return all.reduce(function (s, r) { return s + pcNum(r[k]); }, 0); };
  document.getElementById('pcKpiProjects').textContent = erpNum(all.length);
  document.getElementById('pcKpiNet').textContent = erpPeso(sum('net_cost'));
  document.getElementById('pcKpiIssued').textContent = erpPeso(sum('issued_cost'));
  document.getElementById('pcKpiReturned').textContent = erpPeso(sum('returned_cost'));
  document.getElementById('pcCount').textContent = rows.length + ' project' + (rows.length === 1 ? '' : 's');

  var body = document.getElementById('pcBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" class="erp-empty">' +
      (all.length ? 'Walang tugma sa search.' : 'Wala pang MRIF na may JO# o SOF#.') + '</td></tr>';
    return;
  }
  body.innerHTML = rows.map(function (r) {
    return '<tr style="cursor:pointer" onclick="pcOpen(\'' + encodeURIComponent(r.project_key) + '\')">' +
      '<td><strong>' + erpEsc(r.jo_no || '—') + '</strong></td>' +
      '<td>' + erpEsc(r.sof_no || '—') + '</td>' +
      '<td>' + erpEsc(r.project_name || '—') + '</td>' +
      '<td>' + erpEsc(r.client_name || '—') + '</td>' +
      '<td class="text-center">' + erpNum(r.item_count) + '</td>' +
      '<td class="text-end">' + erpPeso(r.issued_cost) + '</td>' +
      '<td class="text-end">' + erpPeso(r.returned_cost) + '</td>' +
      '<td class="text-end"><strong>' + erpPeso(r.net_cost) + '</strong></td>' +
      '<td>' + pcDate(r.last_activity) + '</td></tr>';
  }).join('');
}

function pcClear() {
  document.getElementById('pcSearch').value = '';
  document.getElementById('pcSort').value = 'activity';
  pcRender();
}

async function pcOpen(encKey) {
  var key = decodeURIComponent(encKey);
  var proj = _pc.rows.filter(function (r) { return r.project_key === key; })[0] || {};
  document.getElementById('pcModalTitle').textContent =
    (proj.jo_no ? 'JO ' + proj.jo_no : '') + (proj.jo_no && proj.sof_no ? ' • ' : '') + (proj.sof_no ? 'SOF ' + proj.sof_no : '');
  document.getElementById('pcModalSub').textContent =
    [proj.project_name, proj.client_name].filter(Boolean).join(' — ');
  document.getElementById('pcModalTotals').innerHTML = [
    ['Project Cost', erpPeso(proj.net_cost)],
    ['Issued', erpPeso(proj.issued_cost)],
    ['Returned', erpPeso(proj.returned_cost)],
    ['MRIF / MRS', erpNum(proj.mrif_count) + ' / ' + erpNum(proj.mrs_count)]
  ].map(function (t) {
    return '<div class="col-6 col-md-3"><div class="border rounded p-2"><div class="small text-muted">' + t[0] +
      '</div><div class="fw-bold fs-5">' + t[1] + '</div></div></div>';
  }).join('');
  document.getElementById('pcItemsBody').innerHTML = '<tr><td colspan="8" class="erp-empty">Loading...</td></tr>';
  document.getElementById('pcDocsBody').innerHTML = '';
  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('pcModal'));
  modal.show();

  try {
    var k = encodeURIComponent(key);
    var res = await Promise.all([
      erpFetchAll('v_project_cost_items', 'select=*&project_key=eq.' + k + '&order=net_cost.desc'),
      erpFetchAll('v_project_cost_moves', 'select=doc_no,doc_type,transaction_date,net_cost&project_key=eq.' + k)
    ]);
    var items = res[0] || [], moves = res[1] || [];
    document.getElementById('pcItemsBody').innerHTML = items.length ? items.map(function (i) {
      return '<tr><td><strong>' + erpEsc(i.item_code) + '</strong></td><td>' + erpEsc(i.description || '') +
        '</td><td>' + erpEsc(i.unit || '') + '</td>' +
        '<td class="text-end">' + pcQty(i.issued_qty) + '</td>' +
        '<td class="text-end">' + pcQty(i.returned_qty) + '</td>' +
        '<td class="text-end">' + pcQty(i.net_qty) + '</td>' +
        '<td class="text-end">' + erpPeso(i.avg_unit_cost) + '</td>' +
        '<td class="text-end"><strong>' + erpPeso(i.net_cost) + '</strong></td></tr>';
    }).join('') : '<tr><td colspan="8" class="erp-empty">Walang items.</td></tr>';

    var docs = {};
    moves.forEach(function (m) {
      var d = docs[m.doc_no] || (docs[m.doc_no] = { doc_no: m.doc_no, type: m.doc_type, date: m.transaction_date, cost: 0 });
      d.cost += pcNum(m.net_cost);
      if (new Date(m.transaction_date) > new Date(d.date)) d.date = m.transaction_date;
    });
    var list = Object.keys(docs).map(function (k2) { return docs[k2]; })
      .sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    document.getElementById('pcDocsBody').innerHTML = list.map(function (d) {
      return '<tr><td>' + erpEsc(d.doc_no) + '</td><td>' + erpEsc(d.type) + '</td><td>' + pcDate(d.date) +
        '</td><td class="text-end">' + erpPeso(d.cost) + '</td></tr>';
    }).join('');
  } catch (err) {
    console.error('[ProjectCosting detail]', err);
    document.getElementById('pcItemsBody').innerHTML =
      '<tr><td colspan="8" class="erp-empty text-danger">' + erpEsc(String(err.message || err)) + '</td></tr>';
  }
}
