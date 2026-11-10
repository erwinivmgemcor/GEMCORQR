// ============================================================
// GEMCOR ERP — Item Catalog (read-only, for Procurement)
// Shows: item code, description, category, unit.
// Unit Cost is shown (and requested) ONLY for Finance / Warehouse. Procurement and
// Production never receive the cost column. No stock, location or movement fields.
// ============================================================
var _icat = { showCost: false, all: [], view: [], shown: 0, page: 100, sortKey: 'item_code', sortDir: 1, timer: null };

function icatEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

document.addEventListener('DOMContentLoaded', function() { icatLoad(); });

function icatCols() { return _icat.showCost ? 5 : 4; }

async function icatLoad() {
  try {
    var role = (localStorage.getItem('ivm_userRole') || '').toLowerCase();
    _icat.showCost = (role === 'finance' || role === 'warehouse');
    if (_icat.showCost) { var th = document.getElementById('icatCostTh'); if (th) th.style.display = ''; }
    // Only these columns are requested on purpose (unit_cost only for Finance / Warehouse).
    var rows = await erpFetchAll('erp_items',
      'select=item_code,description,category,unit:base_unit' + (_icat.showCost ? ',unit_cost' : '') + '&is_deleted=not.is.true&is_active=eq.true&order=item_code.asc');
    _icat.all = (rows || []).map(function(r) {
      var o = { item_code: r.item_code || '', description: r.description || '', category: r.category || 'Uncategorized', unit: r.unit || '' };
      if (_icat.showCost) o.unit_cost = Number(r.unit_cost || 0);
      return o;
    });
    var cats = {}; _icat.all.forEach(function(r) { cats[r.category] = 1; });
    var sel = document.getElementById('icatCategory');
    Object.keys(cats).sort().forEach(function(c) { var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
    icatApply();
  } catch (e) {
    console.error('[ItemCatalog]', e);
    document.getElementById('icatBody').innerHTML = '<tr><td colspan="' + icatCols() + '" class="text-center py-5 text-danger">Could not load items. Please refresh.</td></tr>';
  }
}

function icatOnSearch() { clearTimeout(_icat.timer); _icat.timer = setTimeout(icatApply, 150); }
function icatClear() { document.getElementById('icatSearch').value = ''; document.getElementById('icatCategory').value = ''; icatApply(); }

function icatSort(key) {
  if (_icat.sortKey === key) _icat.sortDir *= -1; else { _icat.sortKey = key; _icat.sortDir = 1; }
  icatApply();
}

function icatApply() {
  var terms = document.getElementById('icatSearch').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  var cat = document.getElementById('icatCategory').value;
  var k = _icat.sortKey, d = _icat.sortDir;
  _icat.view = _icat.all.filter(function(r) {
    if (cat && r.category !== cat) return false;
    if (!terms.length) return true;
    var hay = (r.item_code + ' ' + r.description).toLowerCase();
    return terms.every(function(t) { return hay.indexOf(t) !== -1; });
  }).sort(function(a, b) { return String(a[k]).localeCompare(String(b[k]), undefined, { numeric: true, sensitivity: 'base' }) * d; });
  _icat.shown = 0;
  document.getElementById('icatBody').innerHTML = '';
  icatMore();
  document.getElementById('icatCount').textContent = _icat.view.length.toLocaleString() + ' of ' + _icat.all.length.toLocaleString() + ' items';
}

function icatHi(text, terms) {
  var s = icatEsc(text);
  terms.forEach(function(t) { if (t.length > 1) s = s.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>'); });
  return s;
}

function icatMore() {
  var terms = document.getElementById('icatSearch').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  var slice = _icat.view.slice(_icat.shown, _icat.shown + _icat.page);
  if (!_icat.view.length) {
    document.getElementById('icatBody').innerHTML = '<tr><td colspan="' + icatCols() + '" class="text-center py-5 text-muted">No matching items</td></tr>';
  } else {
    var html = slice.map(function(r) {
      return '<tr><td><span class="ic2-code">' + icatHi(r.item_code, terms) + '</span>' +
        '<button class="ic2-copy" title="Copy code" onclick="icatCopy(this,\'' + icatEsc(r.item_code).replace(/'/g, '') + '\')"><i class="bi bi-clipboard"></i></button></td>' +
        '<td>' + icatHi(r.description, terms) + '</td>' +
        '<td><span class="ic2-chip">' + icatEsc(r.category) + '</span></td>' +
        '<td class="ic2-unit">' + icatEsc(r.unit) + '</td>' +
        (_icat.showCost ? '<td class="text-end" style="font-family:\'Courier New\',monospace;">₱' + Number(r.unit_cost || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>' : '') +
        '</tr>';
    }).join('');
    document.getElementById('icatBody').insertAdjacentHTML('beforeend', html);
  }
  _icat.shown += slice.length;
  document.getElementById('icatMoreWrap').classList.toggle('d-none', _icat.shown >= _icat.view.length);
}

function icatCopy(btn, code) {
  var done = function() { var i = btn.firstElementChild; i.className = 'bi bi-check2'; setTimeout(function() { i.className = 'bi bi-clipboard'; }, 1200); };
  if (navigator.clipboard) navigator.clipboard.writeText(code).then(done); else done();
}

function icatExport() {
  var q = function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
  var head = ['Item Code', 'Description', 'Category', 'Unit']; if (_icat.showCost) head.push('Unit Cost');
  var lines = [head.map(q).join(',')];
  _icat.view.forEach(function(r) {
    var row = [r.item_code, r.description, r.category, r.unit]; if (_icat.showCost) row.push(Number(r.unit_cost || 0).toFixed(2));
    lines.push(row.map(q).join(','));
  });
  var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'GEMCOR-item-catalog-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

window.icatApply = icatApply; window.icatClear = icatClear; window.icatSort = icatSort; window.icatMore = icatMore;
window.icatOnSearch = icatOnSearch; window.icatCopy = icatCopy; window.icatExport = icatExport;
