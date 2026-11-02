// ============================================================
// GEMCOR ERP — Stock Monitor: per-column header filters
// Adds a small filter control under each table header label.
// Works on the already-loaded items (no extra Supabase calls).
// ============================================================
(function () {
  // key, header index, type: text | num | pick
  var COLS = [
    { k: 'code',       i: 0,  t: 'text', get: function (it) { return String(it.item_code || '').toLowerCase(); } },
    { k: 'desc',       i: 1,  t: 'text', get: function (it) { return String(it.description || '').toLowerCase(); } },
    { k: 'category',   i: 2,  t: 'pick', get: function (it) { return String(it.category || ''); } },
    { k: 'location',   i: 3,  t: 'pick', get: function (it) { return String(it.location || ''); } },
    { k: 'onhand',     i: 4,  t: 'num',  get: function (it) { return Number(it.on_hand || 0); } },
    { k: 'variance',   i: 5,  t: 'num',  get: function (it) { return window._erpVarianceMap ? (window._erpVarianceMap[it.item_code] || 0) : 0; } },
    { k: 'sof',        i: 6,  t: 'num',  get: function (it) { return Number((window._erpSofAllocatedMap || _erpSofAllocatedMap || {})[it.item_code] || 0); } },
    { k: 'available',  i: 7,  t: 'num',  get: function (it) { return Number(it.on_hand || 0) - Number((_erpSofAllocatedMap || {})[it.item_code] || 0); } },
    { k: 'buffer',     i: 8,  t: 'num',  get: function (it) { return Number(it.buffer_stock || 0); } },
    { k: 'unit',       i: 9,  t: 'pick', get: function (it) { return String(it.base_unit || ''); } },
    { k: 'unitcost',   i: 10, t: 'num',  get: function (it) { return Number(it.unit_cost || 0); } },
    { k: 'onhandcost', i: 11, t: 'num',  get: function (it) { return Number(it.on_hand || 0) * Number(it.unit_cost || 0); } },
    { k: 'activemo',   i: 12, t: 'num',  get: function (it) { return Number(it.active_consumption_months || 0); } },
    { k: 'avemo',      i: 13, t: 'num',  get: function (it) { return Number(it.ave_monthly_consumption || 0); } },
    { k: 'aveday',     i: 14, t: 'num',  get: function (it) { return Number(it.ave_daily_consumption || 0); } },
    { k: 'status',     i: 15, t: 'pick', get: reorderStatus },
    { k: 'abc',        i: 16, t: 'pick', get: function (it) { return String(it.abc_classification || ''); } },
    { k: 'movement',   i: 17, t: 'pick', get: function (it) { return String(it.inventory_movement || '').toUpperCase(); } }
  ];

  var NUM_OPTS = [
    ['', 'All'], ['eq0', '= 0'], ['ne0', '≠ 0'], ['gt0', '> 0'], ['lt0', '< 0']
  ];

  var state = {};        // column key → current filter value
  var lastOptionsFor = null;

  // Same rules as the "Reorder Status" badge in the table
  function reorderStatus(it) {
    var onHand = Number(it.on_hand || 0), buffer = Number(it.buffer_stock || 0), activeMo = Number(it.active_consumption_months || 0);
    if (buffer > 0 && onHand <= buffer) return 'FOR REPLENISHMENT';
    if (buffer > 0 && onHand <= buffer * 1.25) return 'LOW STOCK';
    if (buffer > 0) return 'OK';
    if (activeMo >= 1) return 'NEW';
    return 'NO USAGE';
  }

  function numMatch(op, v) {
    var zero = Math.abs(v) < 1e-9;
    if (op === 'eq0') return zero;
    if (op === 'ne0') return !zero;
    if (op === 'gt0') return v > 1e-9;
    if (op === 'lt0') return v < -1e-9;
    return true;
  }

  function matches(it) {
    for (var n = 0; n < COLS.length; n++) {
      var c = COLS[n], f = state[c.k];
      if (!f) continue;
      var v = c.get(it);
      if (c.t === 'text') { if (v.indexOf(f.toLowerCase()) === -1) return false; }
      else if (c.t === 'num') { if (!numMatch(f, v)) return false; }
      else { if (f === '__blank__' ? v !== '' : v !== f) return false; }
    }
    return true;
  }

  function ctl(k) { return document.getElementById('erpCF_' + k); }

  function markActive() {
    COLS.forEach(function (c) {
      var el = ctl(c.k);
      if (el) el.classList.toggle('erp-cf-on', !!state[c.k]);
    });
    var btn = document.getElementById('erpCF_clear');
    if (btn) btn.style.display = Object.keys(state).some(function (k) { return state[k]; }) ? 'inline-block' : 'none';
  }

  function buildPickOptions(items) {
    COLS.forEach(function (c) {
      if (c.t !== 'pick') return;
      var el = ctl(c.k); if (!el) return;
      var seen = {}, hasBlank = false;
      items.forEach(function (it) { var v = c.get(it); if (v === '') hasBlank = true; else seen[v] = 1; });
      var vals = Object.keys(seen).sort();
      var cur = state[c.k] || '';
      var html = '<option value="">All</option>';
      vals.forEach(function (v) { html += '<option value="' + v.replace(/"/g, '&quot;') + '">' + v.replace(/</g, '&lt;') + '</option>'; });
      if (hasBlank) html += '<option value="__blank__">(blank)</option>';
      el.innerHTML = html;
      el.value = cur;
      if (el.value !== cur) { delete state[c.k]; }
    });
  }

  // Called from erpLoadItems(): applies column filters to the loaded items
  window.erpApplyColFilters = function (items, allForOptions) {
    var src = allForOptions || items;
    if (lastOptionsFor !== src) { buildPickOptions(src); lastOptionsFor = src; }
    markActive();
    var active = Object.keys(state).some(function (k) { return state[k]; });
    return active ? items.filter(matches) : items;
  };

  // Called when a header filter changes: re-filter from the full list and redraw
  function refilter() {
    var items = _erpAllItems.slice();
    var vf = document.getElementById('erpVarianceFilter');
    var varValue = vf ? vf.value : '';
    if (varValue) {
      items = items.filter(function (it) {
        var v = window._erpVarianceMap ? (window._erpVarianceMap[it.item_code] || 0) : 0;
        if (varValue === 'with') return v !== 0;
        if (varValue === 'without') return v === 0;
        if (varValue === 'positive') return v > 0;
        if (varValue === 'negative') return v < 0;
        return true;
      });
    }
    _erpFilteredItems = window.erpApplyColFilters(items, _erpAllItems);
    _erpCurrentPage = 1;
    erpRenderTable();
  }

  window.erpClearColFilters = function (render) {
    state = {};
    COLS.forEach(function (c) { var el = ctl(c.k); if (el) el.value = ''; });
    markActive();
    if (render) refilter();
  };

  function injectStyles() {
    if (document.getElementById('erpCFStyle')) return;
    var st = document.createElement('style');
    st.id = 'erpCFStyle';
    st.textContent =
      '.erp-cf{display:block;width:100%;min-width:62px;margin-top:4px;padding:2px 4px;font-size:.7rem;font-weight:500;' +
      'border:1px solid #cbd5e1;border-radius:4px;background:#fff;color:#334155;box-sizing:border-box;}' +
      '.erp-cf.erp-cf-on{border-color:#2563eb;background:#eff6ff;color:#1e3a8a;box-shadow:0 0 0 1px #2563eb;}' +
      '#erpCF_clear{display:none;margin-top:4px;padding:2px 6px;font-size:.7rem;border:1px solid #ef4444;color:#ef4444;background:#fff;border-radius:4px;cursor:pointer;}' +
      '#erpCF_clear:hover{background:#ef4444;color:#fff;}' +
      '[data-theme="dark"] .erp-cf{background:#1e293b;color:#e2e8f0;border-color:#475569;}' +
      '[data-theme="dark"] .erp-cf.erp-cf-on{background:#1e3a8a;color:#fff;}';
    document.head.appendChild(st);
  }

  function init() {
    var ths = document.querySelectorAll('.erp-table-card .erp-table thead th');
    if (!ths.length || ths.length < 18 || document.getElementById('erpCF_code')) return;
    injectStyles();

    COLS.forEach(function (c) {
      var th = ths[c.i]; if (!th) return;
      var el;
      if (c.t === 'text') {
        el = document.createElement('input');
        el.type = 'text'; el.placeholder = 'Filter…';
        var timer = null;
        el.addEventListener('input', function () {
          clearTimeout(timer);
          timer = setTimeout(function () { state[c.k] = el.value.trim(); if (!state[c.k]) delete state[c.k]; refilter(); }, 250);
        });
      } else {
        el = document.createElement('select');
        if (c.t === 'num') {
          el.innerHTML = NUM_OPTS.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
        } else {
          el.innerHTML = '<option value="">All</option>';
        }
        el.addEventListener('change', function () { state[c.k] = el.value; if (!el.value) delete state[c.k]; refilter(); });
      }
      el.id = 'erpCF_' + c.k;
      el.className = 'erp-cf';
      el.title = 'Filter ' + th.textContent.trim();
      ['click', 'mousedown', 'keydown'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.stopPropagation(); }); });
      th.appendChild(el);
    });

    var last = ths[18];
    if (last) {
      var b = document.createElement('button');
      b.id = 'erpCF_clear'; b.type = 'button'; b.textContent = '✕ Clear';
      b.title = 'Clear column filters';
      b.addEventListener('click', function (e) { e.stopPropagation(); window.erpClearColFilters(true); });
      last.appendChild(b);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
