// ============================================================
// GEMCOR ERP — Replenishment & PRFs (v2.0)
// Tab 1 "Needs": items below buffer, minus what is already on order
// Tab 2 "PRFs" : PRF Monitor (embedded)
//
// Source of truth lives in the database:
//   erp_v_reorder_net  -> qty_needed, on_order_qty, net_needed, open_prf_nos
//   erp_create_prf()   -> all-or-nothing PRF creation (numbering + category/batch split)
// Setup: run sql/01_replenishment_prf.sql in Supabase once.
// ============================================================

var RP_MAX_ITEMS_PER_PRF = 30;                 // same as New PRF
var RP_DEFAULT_NOTED_BY = 'CYNTHIA A. CEREZO'; // used only when nothing was saved before
var RP_DEFAULT_APPROVED_BY = 'REMIGIO BALAOING';
var RP_STALE_DAYS = 7;                         // PRFs are raised every Monday → still open after a week = needs a decision
var RP_MIN_ACTIVE_MONTHS = 3;                  // below this, a PRF request gets a warning

var _rp = {
  allItems: [],
  filteredItems: [],
  selectedItems: {},
  currentPage: 1,
  pageSize: 50,
  prfAge: {},           // item_code -> { days, oldest, prfs:[{prf_no,status,open_qty,days}] }  (open PRF lines only)
  hsort: null,          // {key, dir} when a column header was clicked (overrides the Sort dropdown)
  hasActivity: false,   // true when active-months data could be loaded
  searchTimer: null,
  prfModal: null,
  successModal: null,
  isSubmitting: false,
  activeTab: 'needs',
  prfFrameLoaded: false,
  prfsChanged: false,
  extraItems: [],       // items added by hand in the modal (not on the reorder list)
  modalVals: {},        // typed qty/remarks, kept across re-renders
  catalog: null,        // erp_items search list (loaded on first use)
  openMap: null         // {item_code: {qty, prfs:[{prf_no,status,open_qty}]}} — fresh each time the modal opens
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  rpRestorePrefs();
  rpBindHeaderSort();
  rpCheckHealth();
  rpLoad();
  if (location.hash === '#prfs') rpSwitchTab('prfs');
});

async function rpCheckHealth() {
  var badge = document.getElementById('erpHealthBadge');
  if (!badge) return;
  var text = document.getElementById('erpHealthText');
  var dot = badge.querySelector('.dot');
  try {
    var result = await erpHealthCheck();
    if (result.success) {
      dot.className = 'dot dot-ok';
      text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      dot.className = 'dot dot-error';
      text.textContent = 'Offline';
    }
  } catch(err) {
    dot.className = 'dot dot-error';
    text.textContent = 'Error';
  }
}

// ═══════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════
function rpSwitchTab(tab) {
  _rp.activeTab = tab;
  var needs = document.getElementById('rpTabNeeds');
  var prfs = document.getElementById('rpTabPrfs');
  var bNeeds = document.getElementById('rpTabBtnNeeds');
  var bPrfs = document.getElementById('rpTabBtnPrfs');
  var exp = document.getElementById('rpBtnExport');
  if (needs) needs.style.display = (tab === 'needs') ? '' : 'none';
  if (prfs) prfs.style.display = (tab === 'prfs') ? '' : 'none';
  if (bNeeds) bNeeds.classList.toggle('active', tab === 'needs');
  if (bPrfs) bPrfs.classList.toggle('active', tab === 'prfs');
  if (exp) exp.style.display = (tab === 'needs') ? '' : 'none';

  if (tab === 'prfs') {
    var frame = document.getElementById('rpPrfFrame');
    if (frame && (!_rp.prfFrameLoaded || _rp.prfsChanged)) {
      frame.src = 'prf-monitor.html?embed=1&_t=' + Date.now();
      _rp.prfFrameLoaded = true;
      _rp.prfsChanged = false;
    }
    try { history.replaceState(null, '', '#prfs'); } catch(e) {}
  } else {
    try { history.replaceState(null, '', location.pathname + location.search); } catch(e) {}
    // PRF statuses / PO links may have changed in the other tab → numbers must be fresh
    if (_rp.prfFrameLoaded) rpLoad();
  }
}

// Call a function that lives in the embedded PRF Monitor (same origin)
function rpPrfFrameCall(fnName) {
  var frame = document.getElementById('rpPrfFrame');
  try {
    var w = frame && frame.contentWindow;
    if (w && typeof w[fnName] === 'function') { w[fnName](); return; }
  } catch(e) { console.warn('[rpPrfFrameCall]', e); }
  erpShowToast('PRF Monitor is still loading — try again in a moment', 'warning');
}

// ═══════════════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════════════
async function rpLoad() {
  var tbody = document.getElementById('rpTableBody');
  var alertEl = document.getElementById('rpSetupAlert');
  if (alertEl) alertEl.style.display = 'none';
  if (tbody && _rp.allItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading replenishment needs...</div></td></tr>';
  }

  try {
    var res = await Promise.all([
      erpFetchAll('erp_v_reorder_net', 'select=*&order=item_code.asc'),
      // usage history lives on the item master — the Needs view does not carry it
      erpFetchAll('erp_items', 'select=item_code,active_consumption_months,inventory_movement,abc_classification&order=item_code.asc')
        .catch(function(e) { console.warn('[rpLoad] active-months data unavailable:', e.message); return null; })
    ]);
    var rows = res[0], meta = res[1];
    _rp.hasActivity = !!meta;
    var metaMap = {};
    (meta || []).forEach(function(m) { metaMap[m.item_code] = m; });
    (rows || []).forEach(function(r) {
      var m = metaMap[r.item_code];
      if (!m) return;
      if (r.active_consumption_months === undefined) r.active_consumption_months = m.active_consumption_months;
      if (r.inventory_movement === undefined) r.inventory_movement = m.inventory_movement;
      if (r.abc_classification === undefined) r.abc_classification = m.abc_classification;
    });
    _rp.allItems = rows || [];

    // drop selections that are no longer selectable (e.g. someone else just raised a PRF)
    Object.keys(_rp.selectedItems).forEach(function(code) {
      var it = _rp.allItems.find(function(x) { return x.item_code === code; });
      if (!it) delete _rp.selectedItems[code];
    });

    rpPopulateFilters();
    rpComputeKPIs();
    _rp.currentPage = 1;
    rpRender();

    // how old are the PRFs the items are waiting on? (non-blocking — table is already on screen)
    rpLoadAges().then(function() { if (_rp.activeTab === 'needs') rpRender(); });

  } catch(err) {
    console.error('[rpLoad]', err);
    var msg = String(err.message || err);
    if (alertEl && /erp_v_reorder_net|relation|does not exist|404/i.test(msg)) {
      alertEl.innerHTML = '<strong>Setup needed:</strong> the database view <code>erp_v_reorder_net</code> was not found. ' +
        'Run <code>sql/01_replenishment_prf.sql</code> in the Supabase SQL Editor, then refresh.';
      alertEl.style.display = 'block';
    }
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="15" class="erp-empty text-danger">' +
        'Failed: ' + rpEsc(msg) + '</td></tr>';
    }
  }
}

// ═══════════════════════════════════════════════════════════
// HELPERS ON ROW DATA
// ═══════════════════════════════════════════════════════════
function rpNetNeeded(it) { return Number(it.net_needed || 0); }
function rpOnOrder(it)   { return Number(it.on_order_qty || 0); }
function rpNetValue(it)  { return Number(it.net_value_needed || 0); }
function rpIsCovered(it) { return rpNetNeeded(it) <= 0; }

// Months the item actually had usage. null = unknown (data could not be loaded).
function rpActive(it) {
  if (!_rp.hasActivity && (it.active_consumption_months === undefined)) return null;
  return Number(it.active_consumption_months || 0);
}

// Does the item pass the Active-Months filter value?  ''|ge:N|r12|zero
function rpActiveMatch(it, f) {
  if (!f) return true;
  var am = rpActive(it);
  if (am === null) return false;
  if (f === 'zero') return am === 0;
  if (f === 'r12') return am >= 1 && am <= 2;
  if (f.indexOf('ge:') === 0) return am >= Number(f.slice(3));
  return true;
}

function rpActiveLabel(f) {
  if (!f) return 'any';
  if (f === 'zero') return 'no usage';
  if (f === 'r12') return 'only 1–2 months';
  return '≥ ' + f.slice(3) + ' month' + (f === 'ge:1' ? '' : 's');
}

// ── PRF age (weekly Monday cycle) ───────────────────────────
function rpDaysSince(iso) {
  if (!iso) return null;
  var d = new Date(iso); if (isNaN(d.getTime())) return null;
  var t = new Date(); t.setHours(0, 0, 0, 0);
  var c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(0, Math.round((t - c) / 86400000));
}

async function rpLoadAges() {
  try {
    var lines = await erpFetchAll('erp_v_prf_open_lines', 'select=item_code,prf_no,status,open_qty&order=item_code.asc');
    lines = (lines || []).filter(function(l) { return Number(l.open_qty || 0) > 0; });
    var nos = {};
    lines.forEach(function(l) { if (l.prf_no) nos[l.prf_no] = true; });
    var list = Object.keys(nos), dates = {};
    for (var i = 0; i < list.length; i += 80) {
      var chunk = list.slice(i, i + 80).map(encodeURIComponent).join(',');
      var docs = await erpFetch('prf_documents', 'select=prf_no,created_at&prf_no=in.(' + chunk + ')&limit=1000');
      (docs || []).forEach(function(d) { dates[d.prf_no] = d.created_at; });
    }
    var map = {};
    lines.forEach(function(l) {
      var days = rpDaysSince(dates[l.prf_no]);
      var e = map[l.item_code] || (map[l.item_code] = { days: null, prfs: [] });
      e.prfs.push({ prf_no: l.prf_no, status: l.status, open_qty: Number(l.open_qty || 0), days: days });
      if (days !== null && (e.days === null || days > e.days)) e.days = days;   // oldest open PRF
    });
    _rp.prfAge = map;
  } catch (e) {
    console.warn('[rpLoadAges] PRF age unavailable:', e.message);
    _rp.prfAge = {};
  }
}

function rpAge(it) { var a = _rp.prfAge[it.item_code]; return a && a.days !== null ? a.days : null; }
function rpIsStale(it) { var d = rpAge(it); return rpOnOrder(it) > 0 && d !== null && d >= RP_STALE_DAYS; }
function rpAgeText(d) { return d === 0 ? 'today' : d + (d === 1 ? ' day' : ' days'); }
function rpAgeTip(it) {
  var a = _rp.prfAge[it.item_code]; if (!a) return '';
  return a.prfs.map(function(p) { return p.prf_no + ' · ' + (p.status || 'OPEN') + ' · ' + rpNum(p.open_qty) + ' left' + (p.days !== null ? ' · ' + rpAgeText(p.days) + ' old' : ''); }).join('\n');
}
function rpStaleCount() { return _rp.allItems.filter(rpIsStale).length; }

function rpShowStale() {
  document.getElementById('rpOrderFilter').value = 'stale';
  document.getElementById('rpActiveFilter').value = '';
  rpLsSet('rp_active_filter', '');
  _rp.currentPage = 1;
  rpRender();
}

function rpMovClass(m) {
  var t = String(m || '').toUpperCase();
  if (!t) return '';
  if (t.indexOf('NO') === 0 || t.indexOf('DEAD') !== -1 || t.indexOf('NON') === 0) return 'mov-none';
  if (t.indexOf('SLOW') !== -1) return 'mov-slow';
  if (t.indexOf('FAST') !== -1) return 'mov-fast';
  return '';
}

// ═══════════════════════════════════════════════════════════
// KPIs — only items that still need a PRF
// ═══════════════════════════════════════════════════════════
function rpComputeKPIs() {
  var critical = 0, urgent = 0, warning = 0, totalCost = 0, needsCount = 0;

  // KPIs follow the Active-Months filter, so the cards match what the table can actually order
  var actSel = document.getElementById('rpActiveFilter');
  var actF = actSel ? actSel.value : '';
  _rp.allItems.forEach(function(it) {
    if (rpIsCovered(it)) return;
    if (actF && _rp.hasActivity && !rpActiveMatch(it, actF)) return;
    needsCount++;
    var u = String(it.urgency || '').toUpperCase();
    if (u === 'CRITICAL') critical++;
    else if (u === 'URGENT') urgent++;
    else warning++;
    totalCost += rpNetValue(it);
  });

  document.getElementById('rpKpiCritical').textContent = rpNum(critical);
  document.getElementById('rpKpiUrgent').textContent = rpNum(urgent);
  document.getElementById('rpKpiNeeded').textContent = rpNum(warning);
  document.getElementById('rpKpiCost').textContent = '₱' + rpNum(totalCost);
  document.getElementById('rpTabCountNeeds').textContent = needsCount;
}

// ═══════════════════════════════════════════════════════════
// POPULATE FILTERS
// ═══════════════════════════════════════════════════════════
function rpPopulateFilters() {
  var catSel = document.getElementById('rpCategoryFilter');
  var locSel = document.getElementById('rpLocationFilter');
  if (!catSel || !locSel) return;

  var currentCat = catSel.value;
  var currentLoc = locSel.value;

  var cats = {}, locs = {};
  _rp.allItems.forEach(function(it) {
    if (it.category) cats[it.category] = true;
    if (it.location) locs[it.location] = true;
  });

  catSel.innerHTML = '<option value="">All Categories</option>';
  Object.keys(cats).sort().forEach(function(c) {
    catSel.innerHTML += '<option value="' + rpEsc(c) + '"' + (c === currentCat ? ' selected' : '') + '>' + rpEsc(c) + '</option>';
  });

  locSel.innerHTML = '<option value="">All Locations</option>';
  Object.keys(locs).sort().forEach(function(l) {
    locSel.innerHTML += '<option value="' + rpEsc(l) + '"' + (l === currentLoc ? ' selected' : '') + '>' + rpEsc(l) + '</option>';
  });
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function rpOnFilterChange() {
  _rp.currentPage = 1;
  rpRender();
}

function rpLsGet(k) { try { return localStorage.getItem(k); } catch(e) { return null; } }
function rpLsSet(k, v) { try { localStorage.setItem(k, v); } catch(e) {} }

function rpRestorePrefs() {
  var ps = rpLsGet('rp_page_size');
  var psSel = document.getElementById('rpPageSize');
  if (ps && psSel && psSel.querySelector('option[value="' + ps + '"]')) { psSel.value = ps; _rp.pageSize = Number(ps); }
  var af = rpLsGet('rp_active_filter');
  var afSel = document.getElementById('rpActiveFilter');
  if (af && afSel && afSel.querySelector('option[value="' + af + '"]')) afSel.value = af;
}

function rpOnActiveChange() {
  var v = document.getElementById('rpActiveFilter').value;
  rpLsSet('rp_active_filter', v);
  _rp.currentPage = 1;
  rpRender();
}

function rpSetActiveFilter(v) {
  var sel = document.getElementById('rpActiveFilter');
  if (!sel) return;
  sel.value = v;
  rpOnActiveChange();
}

function rpOnSortChange() {
  _rp.hsort = null;
  _rp.currentPage = 1;
  rpRender();
}

function rpOnPageSize() {
  var v = Number(document.getElementById('rpPageSize').value) || 50;
  _rp.pageSize = v;
  rpLsSet('rp_page_size', String(v));
  _rp.currentPage = 1;
  rpRender();
}

// ── header click sorting ───────────────────────────────────
var RP_SORT_GET = {
  code:    function(it) { return String(it.item_code || ''); },
  desc:    function(it) { return String(it.description || '').toLowerCase(); },
  cat:     function(it) { return String(it.category || '').toLowerCase(); },
  loc:     function(it) { return String(it.location || '').toLowerCase(); },
  onhand:  function(it) { return Number(it.on_hand || 0); },
  buffer:  function(it) { return Number(it.buffer_stock || 0); },
  ave:     function(it) { return Number(it.ave_monthly_consumption || 0); },
  active:  function(it) { var a = rpActive(it); return a === null ? -1 : a; },
  mov:     function(it) { return String(it.inventory_movement || '').toLowerCase(); },
  qneeded: function(it) { return Number(it.qty_needed || 0); },
  net:     function(it) { return rpNetNeeded(it); },
  cost:    function(it) { return rpNetValue(it); },
  urg:     function(it) { var r = { CRITICAL: 0, URGENT: 1, WARNING: 2, OK: 3 }[String(it.urgency || '').toUpperCase()]; return r === undefined ? 99 : r; }
};

function rpBindHeaderSort() {
  var head = document.querySelector('#rpTabNeeds thead');
  if (!head) return;
  head.addEventListener('click', function(e) {
    var th = e.target.closest('th[data-sort]');
    if (!th) return;
    var key = th.getAttribute('data-sort');
    var textual = ['code', 'desc', 'cat', 'loc', 'mov'].indexOf(key) !== -1;
    if (_rp.hsort && _rp.hsort.key === key) _rp.hsort.dir = _rp.hsort.dir === 'asc' ? 'desc' : 'asc';
    else _rp.hsort = { key: key, dir: textual ? 'asc' : 'desc' };
    _rp.currentPage = 1;
    rpRender();
  });
}

function rpMarkSortedHeader() {
  document.querySelectorAll('#rpTabNeeds thead th[data-sort]').forEach(function(th) {
    th.classList.remove('s-asc', 's-desc');
    if (_rp.hsort && th.getAttribute('data-sort') === _rp.hsort.key) th.classList.add('s-' + _rp.hsort.dir);
  });
}

function rpSortItems(list, sortBy) {
  if (_rp.hsort && RP_SORT_GET[_rp.hsort.key]) {
    var g = RP_SORT_GET[_rp.hsort.key], dir = _rp.hsort.dir === 'asc' ? 1 : -1;
    list.sort(function(a, b) {
      var x = g(a), y = g(b);
      var c = (typeof x === 'string') ? x.localeCompare(y, undefined, { numeric: true }) : (x - y);
      return c * dir || String(a.item_code || '').localeCompare(String(b.item_code || ''));
    });
    return;
  }
  var urg = RP_SORT_GET.urg;
  list.sort(function(a, b) {
    switch (sortBy) {
      case 'value_desc':  return rpNetValue(b) - rpNetValue(a);
      case 'value_asc':   return rpNetValue(a) - rpNetValue(b);
      case 'qty_desc':    return rpNetNeeded(b) - rpNetNeeded(a);
      case 'urgency':     return urg(a) - urg(b);
      case 'code_asc':    return String(a.item_code || '').localeCompare(String(b.item_code || ''));
      case 'active_desc': return RP_SORT_GET.active(b) - RP_SORT_GET.active(a);
      case 'active_asc':  return RP_SORT_GET.active(a) - RP_SORT_GET.active(b);
      default: return 0;
    }
  });
}

// ── summary chips: how many items fall in each Active-Months band ──
function rpRenderChips(base, activeVal) {
  var box = document.getElementById('rpChips');
  if (!box) return;
  if (!_rp.hasActivity) {
    box.innerHTML = '<span class="small text-muted"><i class="bi bi-info-circle me-1"></i>Active-months data could not be loaded, so the filter is unavailable. Try Refresh.</span>';
    return;
  }
  var c = { all: base.length, ge3: 0, r12: 0, zero: 0 };
  base.forEach(function(it) {
    var a = rpActive(it);
    if (a === 0) c.zero++;
    else if (a >= 1 && a <= 2) c.r12++;
    if (a >= RP_MIN_ACTIVE_MONTHS) c.ge3++;
  });
  function chip(val, label, n, cls) {
    return '<button type="button" class="rp-chip ' + cls + (activeVal === val ? ' active' : '') + '" onclick="rpSetActiveFilter(\'' + val + '\')">' +
      label + ' <b>' + rpNum(n) + '</b></button>';
  }
  box.innerHTML = '<span class="rp-chips-label">Usage history</span>' +
    chip('', 'All', c.all, '') +
    chip('ge:3', '≥ 3 months', c.ge3, 'good') +
    chip('r12', '1–2 months only', c.r12, 'warn') +
    chip('zero', 'No usage', c.zero, 'bad');
  var st = rpStaleCount();
  if (st > 0) {
    box.innerHTML += '<span class="rp-chips-label" style="margin-left:14px;">On order</span>' +
      '<button type="button" class="rp-chip bad' + (document.getElementById('rpOrderFilter').value === 'stale' ? ' active' : '') + '" onclick="rpShowStale()">Stale PRFs <b>' + rpNum(st) + '</b></button>';
  }
}

// banner: weekly Monday cycle — what is still waiting on last week's (or older) PRF
function rpRenderStaleBanner() {
  var el = document.getElementById('rpStaleBanner');
  if (!el) return;
  var st = rpStaleCount();
  var isMonday = new Date().getDay() === 1;
  if (!st) {
    el.style.display = isMonday ? 'block' : 'none';
    el.className = 'rp-stale-banner ok';
    el.innerHTML = isMonday ? '<i class="bi bi-calendar-check me-2"></i><strong>Monday — PRF day.</strong> No item is waiting on an old PRF.' : '';
    return;
  }
  el.className = 'rp-stale-banner' + (isMonday ? ' monday' : '');
  el.innerHTML = '<i class="bi bi-calendar-event me-2"></i>' +
    (isMonday ? '<strong>Monday — PRF day.</strong> ' : '') +
    '<strong>' + rpNum(st) + '</strong> item' + (st === 1 ? ' is' : 's are') + ' still waiting on a PRF that is ' + RP_STALE_DAYS + '+ days old (not served yet). ' +
    'Cancel the old line in PRF Monitor if it is no longer coming, or tick the item to request it again. ' +
    '<a onclick="rpShowStale()">Show them</a>';
  el.style.display = 'block';
}

function rpRender() {
  var tbody = document.getElementById('rpTableBody');
  if (!tbody) return;

  var search = (document.getElementById('rpSearchInput').value || '').toLowerCase().trim();
  var catFilter = document.getElementById('rpCategoryFilter').value;
  var urgFilter = document.getElementById('rpUrgencyFilter').value;
  var locFilter = document.getElementById('rpLocationFilter').value;
  var orderFilter = document.getElementById('rpOrderFilter').value;
  var activeFilter = document.getElementById('rpActiveFilter').value;
  var sortBy = document.getElementById('rpSortFilter').value;

  // everything except the Active-Months filter (the chips count from this set)
  var base = _rp.allItems.filter(function(it) {
    if (orderFilter === 'needs' && rpIsCovered(it)) return false;
    if (orderFilter === 'covered' && !(rpIsCovered(it) && rpOnOrder(it) > 0)) return false;
    if (orderFilter === 'stale' && !rpIsStale(it)) return false;
    if (catFilter && it.category !== catFilter) return false;
    if (locFilter && it.location !== locFilter) return false;
    if (urgFilter && String(it.urgency || '').toUpperCase() !== urgFilter) return false;

    if (search) {
      var code = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      if (code.indexOf(search) === -1 && desc.indexOf(search) === -1) return false;
    }
    return true;
  });

  _rp.filteredItems = _rp.hasActivity || !activeFilter ? base.filter(function(it) { return rpActiveMatch(it, activeFilter); }) : base;
  rpComputeKPIs();
  rpSortItems(_rp.filteredItems, sortBy);
  rpRenderChips(base, activeFilter);
  rpRenderStaleBanner();
  rpMarkSortedHeader();

  var hidden = base.length - _rp.filteredItems.length;
  var note = document.getElementById('rpHiddenNote');
  if (note) {
    if (activeFilter && _rp.hasActivity && hidden > 0) {
      note.innerHTML = '<i class="bi bi-funnel-fill me-1"></i><strong>' + rpNum(hidden) + '</strong> item' + (hidden === 1 ? ' is' : 's are') +
        ' hidden by the Active-months filter (' + rpEsc(rpActiveLabel(activeFilter)) + '). <a onclick="rpSetActiveFilter(\'\')">Show all</a>';
      note.style.display = 'block';
    } else note.style.display = 'none';
  }

  var total = _rp.filteredItems.length;
  var maxPage = Math.max(1, Math.ceil(total / _rp.pageSize));
  if (_rp.currentPage > maxPage) _rp.currentPage = maxPage;
  var start = (_rp.currentPage - 1) * _rp.pageSize;
  var end = Math.min(start + _rp.pageSize, total);
  var pageItems = _rp.filteredItems.slice(start, end);

  document.getElementById('rpTableCount').textContent = total + ' items';
  document.getElementById('rpPageTotal').textContent = total;
  document.getElementById('rpPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('rpPageEnd').textContent = end;
  rpRenderPager(maxPage);

  var subtitle = document.getElementById('rpTableSubtitle');
  if (subtitle) {
    subtitle.textContent = orderFilter === 'needs' ? 'Items that still need a PRF'
      : orderFilter === 'covered' ? 'Items already covered by an open PRF'
      : orderFilter === 'stale' ? 'Items on a PRF that has been open ' + RP_STALE_DAYS + '+ days'
      : 'All items below buffer stock';
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="erp-empty">' +
      '<i class="bi bi-check-circle fs-2 d-block mb-2 text-success"></i>' +
      (orderFilter === 'needs' && !activeFilter && !search && !catFilter && !locFilter && !urgFilter
        ? 'Nothing left to order — everything below buffer is already on a PRF or stock is healthy.'
        : 'No items match the filters.') + '</td></tr>';
    updateRpBulkBar();
    updateRpSelectAllChk();
    return;
  }

  var html = '';
  pageItems.forEach(function(it) {
    var urgency = String(it.urgency || 'WARNING').toUpperCase();
    var covered = rpIsCovered(it);
    var stale = rpIsStale(it);
    var rowClass = covered ? ('row-covered' + (stale ? ' row-stale' : ''))
      : urgency === 'CRITICAL' ? 'row-critical'
      : urgency === 'URGENT' ? 'row-urgent' : 'row-warning';

    var isSelected = _rp.selectedItems[it.item_code] === true;
    var onOrder = rpOnOrder(it);
    var ageD = rpAge(it);

    var onOrderCell = '<span class="text-muted">—</span>';
    if (onOrder > 0) {
      onOrderCell = '<span class="oo-badge' + (covered ? ' full' : '') + '">' + rpNum(onOrder) + '</span>' +
        '<span class="oo-prf" title="' + rpEsc(rpAgeTip(it) || it.open_prf_nos || '') + '">' + rpEsc(it.open_prf_nos || '') + '</span>' +
        (ageD !== null ? '<span class="oo-age' + (stale ? ' stale' : '') + '" title="' + rpEsc(rpAgeTip(it)) + '">' + (stale ? 'STALE · ' : '') + rpAgeText(ageD) + '</span>' : '');
    }

    var am = rpActive(it), amCell;
    if (am === null) amCell = '<span class="am-badge am-unk">—</span>';
    else if (am === 0) amCell = '<span class="am-badge am-zero" title="No recorded usage">0</span>';
    else if (am < RP_MIN_ACTIVE_MONTHS) amCell = '<span class="am-badge am-low" title="Less than ' + RP_MIN_ACTIVE_MONTHS + ' months of usage">' + am + '</span>';
    else amCell = '<span class="am-badge am-ok">' + am + '</span>';

    var mov = String(it.inventory_movement || '');
    var movCell = mov ? '<span class="mov-badge ' + rpMovClass(mov) + '" title="' + rpEsc(mov) + '">' + rpEsc(rpTruncate(mov.toUpperCase(), 12)) + '</span>' : '<span class="text-muted">—</span>';

    html += '<tr class="' + rowClass + '">' +
      '<td class="text-center">' +
        '<input type="checkbox" class="rp-item-chk" data-code="' + rpEsc(it.item_code) + '"' +
          (isSelected ? ' checked' : '') + (covered ? ' data-covered="1" title="Already on an open PRF — tick only if you want to request it again"' : '') + '>' +
      '</td>' +
      '<td><code>' + rpEsc(it.item_code) + '</code></td>' +
      '<td title="' + rpEsc(it.description || '') + '">' + rpEsc(rpTruncate(it.description || '—', 60)) + '</td>' +
      '<td class="text-center"><span class="cat-badge">' + rpEsc(it.category || '—') + '</span></td>' +
      '<td>' + rpEsc(rpTruncate(it.location || '—', 18)) + '</td>' +
      '<td class="text-end fw-bold">' + rpNum(it.on_hand) + '</td>' +
      '<td class="text-end">' + rpNum(it.buffer_stock) + '</td>' +
      '<td class="text-end">' + rpNum(it.ave_monthly_consumption) + '</td>' +
      '<td class="text-center">' + amCell + '<div style="margin-top:3px;">' + movCell + '</div></td>' +
      '<td class="text-end">' + rpNum(it.qty_needed) + '</td>' +
      '<td class="text-center">' + onOrderCell + '</td>' +
      '<td class="text-end fw-bold ' + (covered ? '' : 'text-danger') + '">' + rpNum(rpNetNeeded(it)) + '</td>' +
      '<td class="text-center">' + rpEsc(it.base_unit || '—') + '</td>' +
      '<td class="text-end fw-bold">₱' + rpNum(rpNetValue(it)) + '</td>' +
      '<td class="text-center"><span class="urg-' + urgency + '">' + urgency + '</span></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;

  // one delegated handler instead of inline onchange with escaped item codes
  tbody.querySelectorAll('.rp-item-chk').forEach(function(cb) {
    cb.addEventListener('change', function() { rpToggleSelect(cb.getAttribute('data-code'), cb.checked); });
  });

  updateRpBulkBar();
  updateRpSelectAllChk();
}

// ── pager: « ‹ 1 … 4 5 [6] 7 8 … 20 › »  + go to page ──
function rpRenderPager(maxPage) {
  var el = document.getElementById('rpPager');
  if (!el) return;
  var cur = _rp.currentPage;
  var show = {};
  [1, 2, maxPage - 1, maxPage, cur - 2, cur - 1, cur, cur + 1, cur + 2].forEach(function(n) { if (n >= 1 && n <= maxPage) show[n] = true; });
  var nums = Object.keys(show).map(Number).sort(function(a, b) { return a - b; });

  var h = '<button type="button" onclick="rpGoPage(1)" title="First page"' + (cur <= 1 ? ' disabled' : '') + '><i class="bi bi-chevron-bar-left"></i></button>' +
          '<button type="button" onclick="rpGoPage(' + (cur - 1) + ')"' + (cur <= 1 ? ' disabled' : '') + '><i class="bi bi-chevron-left"></i> Prev</button>';
  var prev = 0;
  nums.forEach(function(n) {
    if (prev && n - prev > 1) h += '<span class="rp-gap">…</span>';
    h += '<button type="button" class="' + (n === cur ? 'cur' : '') + '" onclick="rpGoPage(' + n + ')">' + n + '</button>';
    prev = n;
  });
  h += '<button type="button" onclick="rpGoPage(' + (cur + 1) + ')"' + (cur >= maxPage ? ' disabled' : '') + '>Next <i class="bi bi-chevron-right"></i></button>' +
       '<button type="button" onclick="rpGoPage(' + maxPage + ')" title="Last page"' + (cur >= maxPage ? ' disabled' : '') + '><i class="bi bi-chevron-bar-right"></i></button>';
  if (maxPage > 5) {
    h += '<span class="rp-goto">Go to <input type="number" id="rpGoInput" min="1" max="' + maxPage + '" placeholder="#" ' +
         'onkeydown="if(event.key===\'Enter\')rpGoPage(this.value)"> <button type="button" onclick="rpGoPage(document.getElementById(\'rpGoInput\').value)">Go</button></span>';
  }
  el.innerHTML = h;
}

function rpGoPage(n) {
  n = parseInt(n, 10);
  var maxPage = Math.max(1, Math.ceil(_rp.filteredItems.length / _rp.pageSize));
  if (isNaN(n)) return;
  n = Math.min(maxPage, Math.max(1, n));
  if (n === _rp.currentPage) return;
  _rp.currentPage = n;
  rpRender();
  var wrap = document.querySelector('#rpTabNeeds .erp-table-wrap');
  if (wrap) wrap.scrollTop = 0;
  var card = document.querySelector('#rpTabNeeds .erp-table-card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ═══════════════════════════════════════════════════════════
// SELECTION
// ═══════════════════════════════════════════════════════════
function rpPageItems() {
  return _rp.filteredItems.slice((_rp.currentPage - 1) * _rp.pageSize, _rp.currentPage * _rp.pageSize);
}

function rpToggleSelect(itemCode, checked) {
  if (checked) _rp.selectedItems[itemCode] = true;
  else delete _rp.selectedItems[itemCode];
  updateRpBulkBar();
  updateRpSelectAllChk();
}

function rpToggleSelectAll(checked) {
  rpPageItems().forEach(function(it) {
    if (rpIsCovered(it)) return;
    if (checked) _rp.selectedItems[it.item_code] = true;
    else delete _rp.selectedItems[it.item_code];
  });
  document.querySelectorAll('.rp-item-chk:not([data-covered])').forEach(function(cb) { cb.checked = checked; });
  updateRpBulkBar();
  updateRpSelectAllChk();
}

function updateRpSelectAllChk() {
  var chk = document.getElementById('rpSelectAllChk');
  if (!chk) return;
  var selectable = rpPageItems().filter(function(it) { return !rpIsCovered(it); });
  if (selectable.length === 0) { chk.checked = false; chk.indeterminate = false; return; }
  var allSel = selectable.every(function(it) { return _rp.selectedItems[it.item_code]; });
  var someSel = selectable.some(function(it) { return _rp.selectedItems[it.item_code]; });
  chk.checked = allSel;
  chk.indeterminate = someSel && !allSel;
}

function rpSelectedRows() {
  return _rp.allItems.filter(function(it) { return _rp.selectedItems[it.item_code]; });
}

function updateRpBulkBar() {
  var rows = rpSelectedRows();
  var bar = document.getElementById('rpBulkBar');
  if (!bar) return;

  if (rows.length > 0) {
    bar.classList.add('active');
    var totalQty = 0, totalCost = 0;
    rows.forEach(function(it) { totalQty += rpNetNeeded(it); totalCost += rpNetValue(it); });
    var cov = rows.filter(rpIsCovered).length;
    document.getElementById('rpBulkCount').textContent = rows.length + ' item' + (rows.length === 1 ? '' : 's') + ' selected' +
      (cov ? ' (' + cov + ' already on a PRF)' : '');
    document.getElementById('rpBulkQty').textContent = rpNum(totalQty);
    document.getElementById('rpBulkCost').textContent = '₱' + rpNum(totalCost);
  } else {
    bar.classList.remove('active');
  }
}

function rpClearSelection() {
  _rp.selectedItems = {};
  document.querySelectorAll('.rp-item-chk').forEach(function(cb) { cb.checked = false; });
  updateRpSelectAllChk();
  updateRpBulkBar();
}

// ═══════════════════════════════════════════════════════════
// CREATE PRF FROM SELECTION
// ═══════════════════════════════════════════════════════════
function rpSavedSignatory(key, fallback) {
  try { var v = localStorage.getItem(key); if (v !== null) return v; } catch(e) {}
  return fallback;
}

// How many PRFs will the server create? (mirror of the RPC's rule, for the preview only)
function rpPlanFor(rows) {
  var byCat = {};
  rows.forEach(function(it) {
    var c = it.category || 'UNCATEGORIZED';
    byCat[c] = (byCat[c] || 0) + 1;
  });
  var plan = [];
  Object.keys(byCat).sort().forEach(function(c) {
    var n = Math.ceil(byCat[c] / RP_MAX_ITEMS_PER_PRF);
    plan.push({ category: c, items: byCat[c], prfs: n });
  });
  return plan;
}

function rpModalRows() {
  var rows = rpSelectedRows();
  var have = {};
  rows.forEach(function(it) { have[it.item_code] = true; });
  _rp.extraItems.forEach(function(x) { if (!have[x.item_code]) rows.push(x); });
  return rows;
}

// Open PRF lines per item (UNSERVED / STAGGERED, remaining qty > 0) — loaded fresh when the modal opens
async function rpLoadOpenMap() {
  try {
    var rows = await erpFetchAll('erp_v_prf_open_lines', 'select=item_code,prf_no,status,open_qty&order=item_code.asc');
    var m = {};
    (rows || []).forEach(function(r) {
      var c = r.item_code;
      if (!m[c]) m[c] = { qty: 0, prfs: [] };
      m[c].qty += Number(r.open_qty || 0);
      m[c].prfs.push({ prf_no: r.prf_no, status: r.status, open_qty: Number(r.open_qty || 0) });
    });
    _rp.openMap = m;
  } catch(e) {
    console.warn('[rpLoadOpenMap]', e);
    _rp.openMap = null; // fall back to the numbers already on the page
  }
}

function rpOpenInfo(it) {
  if (_rp.openMap) return _rp.openMap[it.item_code] || { qty: 0, prfs: [] };
  var q = Number(it.on_order_qty || 0);
  return { qty: q, prfs: q > 0 ? [{ prf_no: it.open_prf_nos || '', status: 'OPEN', open_qty: q }] : [] };
}

// Suggested qty = (buffer − on-hand) − already on order, never below 0
function rpSuggested(it) {
  var need = Math.max(Number(it.buffer_stock || 0) - Number(it.on_hand || 0), 0);
  return Math.ceil(Math.max(need - rpOpenInfo(it).qty, 0));
}

function rpCreatePrfFromSelection() {
  var short = rpSelectedRows().filter(function(it) { var a = rpActive(it); return a !== null && a < RP_MIN_ACTIVE_MONTHS; });
  if (short.length) {
    var list = short.slice(0, 8).map(function(it) { return '  • ' + it.item_code + '  (' + rpActive(it) + ' mo)'; }).join('\n');
    var more = short.length > 8 ? '\n  …and ' + (short.length - 8) + ' more' : '';
    var msg = short.length + ' of the selected item' + (short.length === 1 ? ' has' : 's have') + ' less than ' + RP_MIN_ACTIVE_MONTHS +
      ' months of usage history, so the buffer/quantity may not be reliable:\n\n' + list + more + '\n\nCreate the PRF anyway?';
    if (!confirm(msg)) return;
  }
  _rp.extraItems = [];
  _rp.modalVals = {};
  _rp.openMap = null;

  document.getElementById('rpPrfNotedBy').value = rpSavedSignatory('rp_noted_by', RP_DEFAULT_NOTED_BY);
  document.getElementById('rpPrfApprovedBy').value = rpSavedSignatory('rp_approved_by', RP_DEFAULT_APPROVED_BY);
  document.getElementById('rpPrfNotes').value = '';
  document.getElementById('rpAddItemInput').value = '';
  document.getElementById('rpAddItemResults').style.display = 'none';

  rpRefreshModal();

  if (!_rp.prfModal) {
    _rp.prfModal = new bootstrap.Modal(document.getElementById('rpConfirmPrfModal'), { backdrop: 'static' });
  }
  _rp.prfModal.show();
  rpLoadCatalog(); // warm up the "add other item" search
  rpLoadOpenMap().then(function() { rpStashModalVals(); rpRefreshModal(); }); // fresh open-PRF info → re-draw
}

function rpRefreshModal() {
  var rows = rpModalRows();
  rpRenderPrfPlan(rows);
  renderRpPrfItems(rows);
}

// remember what the user typed before the table is re-drawn
function rpStashModalVals() {
  document.querySelectorAll('.rp-prf-qty').forEach(function(el) {
    var c = el.getAttribute('data-code');
    _rp.modalVals[c] = _rp.modalVals[c] || {};
    _rp.modalVals[c].qty = el.value;
  });
  document.querySelectorAll('.rp-prf-remarks').forEach(function(el) {
    var c = el.getAttribute('data-code');
    _rp.modalVals[c] = _rp.modalVals[c] || {};
    _rp.modalVals[c].remarks = el.value;
  });
}

function rpRemoveModalItem(code) {
  rpStashModalVals();
  if (_rp.selectedItems[code]) {
    delete _rp.selectedItems[code];
    rpRender();
  }
  _rp.extraItems = _rp.extraItems.filter(function(x) { return x.item_code !== code; });
  rpRefreshModal();
}

// ── "Add other item" search ──
async function rpLoadCatalog() {
  if (_rp.catalog) return _rp.catalog;
  try {
    var rows = await erpFetchAll('erp_items',
      'select=item_code,description,base_unit,category,location,on_hand,buffer_stock,ave_monthly_consumption&is_active=eq.true&is_deleted=eq.false&order=item_code.asc');
    _rp.catalog = rows || [];
  } catch(e) {
    console.warn('[rpLoadCatalog]', e);
    erpShowToast('Could not load the item list: ' + e.message, 'warning');
    return null;
  }
  return _rp.catalog;
}

async function rpAddItemSearch() {
  var box = document.getElementById('rpAddItemResults');
  var q = (document.getElementById('rpAddItemInput').value || '').toLowerCase().trim();
  if (q.length < 2) { box.style.display = 'none'; return; }
  var cat = await rpLoadCatalog();
  if (!cat) return;

  var inModal = {};
  rpModalRows().forEach(function(it) { inModal[it.item_code] = true; });

  var hits = [];
  for (var i = 0; i < cat.length && hits.length < 15; i++) {
    var it = cat[i];
    if (inModal[it.item_code]) continue;
    if (String(it.item_code || '').toLowerCase().indexOf(q) !== -1 ||
        String(it.description || '').toLowerCase().indexOf(q) !== -1) hits.push(it);
  }

  if (hits.length === 0) {
    box.innerHTML = '<div class="list-group-item small text-muted">No matching item</div>';
  } else {
    box.innerHTML = hits.map(function(it) {
      var oi = rpOpenInfo(it);
      var tag = oi.qty > 0
        ? ' <span class="oo-badge ms-1" title="' + rpEsc(oi.prfs.map(function(p) { return p.prf_no + ' ' + p.status; }).join(', ')) + '">⚠ on order ' + rpNum(oi.qty) + '</span>'
        : '';
      return '<button type="button" class="list-group-item list-group-item-action small" data-code="' + rpEsc(it.item_code) + '">' +
        '<code>' + rpEsc(it.item_code) + '</code> — ' + rpEsc(rpTruncate(it.description || '', 55)) +
        ' <span class="cat-badge ms-1">' + rpEsc(it.category || '—') + '</span>' +
        '<span class="text-muted ms-2">On-hand ' + rpNum(it.on_hand) + ' / Buffer ' + rpNum(it.buffer_stock) + '</span>' + tag + '</button>';
    }).join('');
    box.querySelectorAll('button[data-code]').forEach(function(btn) {
      btn.addEventListener('click', function() { rpAddExtraItem(btn.getAttribute('data-code')); });
    });
  }
  box.style.display = 'block';
}

function rpAddExtraItem(code) {
  var it = (_rp.catalog || []).find(function(x) { return x.item_code === code; });
  if (!it) return;
  rpStashModalVals();
  _rp.extraItems.push({
    item_code: it.item_code,
    description: it.description || '',
    category: it.category || 'UNCATEGORIZED',
    base_unit: it.base_unit || 'PIECE',
    on_hand: Number(it.on_hand || 0),
    buffer_stock: Number(it.buffer_stock || 0),
    _extra: true
  });
  document.getElementById('rpAddItemInput').value = '';
  document.getElementById('rpAddItemResults').style.display = 'none';
  rpRefreshModal();
}

function rpRenderPrfPlan(rows) {
  var el = document.getElementById('rpPrfPlan');
  if (rows.length === 0) {
    el.innerHTML = '<i class="bi bi-info-circle me-1"></i>No items yet — tick items in the list, or search below to add one.';
    return;
  }
  var plan = rpPlanFor(rows);
  var totalPrfs = plan.reduce(function(s, p) { return s + p.prfs; }, 0);
  el.innerHTML = '<i class="bi bi-info-circle me-1"></i>' +
    (totalPrfs === 1 ? 'This will create <strong>1 PRF</strong>' : 'This will create <strong>' + totalPrfs + ' PRFs</strong>') +
    ' — one per category' + (rows.length > RP_MAX_ITEMS_PER_PRF ? ', max ' + RP_MAX_ITEMS_PER_PRF + ' items each' : '') +
    '. PRF numbers are assigned automatically.<br><span class="text-muted">' +
    plan.map(function(p) {
      return rpEsc(p.category) + ': ' + p.items + ' item' + (p.items === 1 ? '' : 's') + (p.prfs > 1 ? ' (' + p.prfs + ' PRFs)' : '');
    }).join(' · ') + '</span>';
}

function renderRpPrfItems(items) {
  var tbody = document.getElementById('rpPrfItemsBody');
  if (!tbody) return;

  document.getElementById('rpPrfItemsCount').textContent = items.length;
  document.getElementById('rpBtnCreatePrf').disabled = (items.length === 0);

  var warnCount = 0;
  var html = '';
  items.forEach(function(it, idx) {
    var v = _rp.modalVals[it.item_code] || {};
    var oi = rpOpenInfo(it);
    var sug = rpSuggested(it);
    var defQty = Math.max(1, sug);
    if (oi.qty > 0) warnCount++;

    var warn = '';
    if (oi.qty > 0) {
      warn = '<div class="small text-danger mt-1" style="line-height:1.3;">⚠ Already on order: ' +
        oi.prfs.map(function(p) {
          var pd = (_rp.prfAge[it.item_code] && _rp.prfAge[it.item_code].prfs.filter(function(x) { return x.prf_no === p.prf_no; })[0]) || null;
          var ageTxt = pd && pd.days !== null ? ' · ' + rpAgeText(pd.days) + ' old' + (pd.days >= RP_STALE_DAYS ? ' <strong>(STALE)</strong>' : '') : '';
          return rpEsc(p.prf_no) + (p.status && p.status !== 'OPEN' ? ' <strong>' + rpEsc(p.status) + '</strong>' : '') + ' · ' + rpNum(p.open_qty) + ageTxt;
        }).join('; ') + '</div>';
    }
    var hint = sug > 0 ? 'Suggested ' + rpNum(sug)
      : (Number(it.on_hand || 0) >= Number(it.buffer_stock || 0) ? 'Above buffer' : 'Covered by open PRF');

    html += '<tr' + (oi.qty > 0 ? ' class="table-danger"' : (it._extra ? ' class="table-warning"' : '')) + '>' +
      '<td class="text-center">' + (idx + 1) + '</td>' +
      '<td><code style="font-size:0.75rem;">' + rpEsc(it.item_code) + '</code>' + (it._extra ? ' <span class="badge bg-warning text-dark">added</span>' : '') + warn + '</td>' +
      '<td><span class="cat-badge">' + rpEsc(it.category || '—') + '</span></td>' +
      '<td>' + rpEsc(rpTruncate(it.description || '', 60)) + '</td>' +
      '<td class="text-end">' + rpNum(it.on_hand) + '</td>' +
      '<td class="text-end">' + rpNum(it.buffer_stock) + '</td>' +
      '<td class="text-end ' + (oi.qty > 0 ? 'fw-bold text-danger' : '') + '">' + (oi.qty > 0 ? rpNum(oi.qty) : '—') + '</td>' +
      '<td class="text-center">' +
        '<input type="number" class="form-control form-control-sm text-center rp-prf-qty" ' +
          'data-code="' + rpEsc(it.item_code) + '" ' +
          'value="' + rpEsc(v.qty !== undefined ? v.qty : defQty) + '" ' +
          'min="1" step="1" style="width:80px;margin:0 auto;">' +
        '<div class="small text-muted">' + hint + '</div>' +
      '</td>' +
      '<td class="text-center">' + rpEsc(it.base_unit || '—') + '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm rp-prf-remarks" ' +
          'data-code="' + rpEsc(it.item_code) + '" value="' + rpEsc(v.remarks || '') + '" ' +
          'placeholder="Optional" maxlength="200">' +
      '</td>' +
      '<td class="text-center"><button type="button" class="btn btn-sm btn-link text-danger p-0 rp-rm" data-code="' + rpEsc(it.item_code) + '" title="Remove"><i class="bi bi-x-lg"></i></button></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
  tbody.querySelectorAll('.rp-rm').forEach(function(btn) {
    btn.addEventListener('click', function() { rpRemoveModalItem(btn.getAttribute('data-code')); });
  });

  var warnEl = document.getElementById('rpPrfWarn');
  if (warnEl) {
    if (warnCount > 0) {
      warnEl.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-1"></i><strong>' + warnCount + ' item' + (warnCount === 1 ? '' : 's') +
        '</strong> already on an open PRF (red rows). Creating another PRF for them will double-order — remove them or lower the qty.';
      warnEl.style.display = 'block';
    } else {
      warnEl.style.display = 'none';
    }
  }
}

function rpClosePrfModal() {
  if (_rp.prfModal) _rp.prfModal.hide();
}

// ═══════════════════════════════════════════════════════════
// SUBMIT — one RPC call, all-or-nothing
// ═══════════════════════════════════════════════════════════
async function rpSubmitPrf() {
  if (_rp.isSubmitting) return;

  var notedBy = document.getElementById('rpPrfNotedBy').value.trim();
  var approvedBy = document.getElementById('rpPrfApprovedBy').value.trim();
  var notes = document.getElementById('rpPrfNotes').value.trim();

  var rows = rpModalRows();
  var items = [];
  var bad = [];
  rows.forEach(function(it) {
    var qtyEl = document.querySelector('.rp-prf-qty[data-code="' + cssEscape(it.item_code) + '"]');
    var remEl = document.querySelector('.rp-prf-remarks[data-code="' + cssEscape(it.item_code) + '"]');
    var qty = qtyEl ? parseFloat(qtyEl.value) : rpNetNeeded(it);
    if (!(qty > 0)) { bad.push(it.item_code); return; }
    items.push({
      item_code: it.item_code,
      qty: qty,
      unit: it.base_unit || null,
      remarks: remEl ? remEl.value.trim() : ''
    });
  });

  if (bad.length) { erpShowToast('Qty must be greater than 0: ' + bad.join(', '), 'warning'); return; }
  if (items.length === 0) { erpShowToast('No valid items to submit', 'warning'); return; }

  var plan = rpPlanFor(rows);
  var totalPrfs = plan.reduce(function(s, p) { return s + p.prfs; }, 0);
  if (!confirm('Create ' + totalPrfs + ' PRF' + (totalPrfs === 1 ? '' : 's') + ' with ' + items.length + ' item(s)?')) return;

  _rp.isSubmitting = true;
  var btn = document.getElementById('rpBtnCreatePrf');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating...';

  try {
    var preparedBy = '';
    var department = '';
    try {
      preparedBy = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || '';
      department = localStorage.getItem('ivm_userDepartment') || '';
    } catch(e) {}

    function payload(force) {
      return {
        items: items,
        header: {
          prepared_by: preparedBy || 'WAREHOUSE',
          department: department,
          noted_by: notedBy,
          approved_by: approvedBy,
          notes: notes,
          purpose: 'STOCK'
        },
        splitByCategory: true,
        maxItems: RP_MAX_ITEMS_PER_PRF,
        force: force === true
      };
    }
    var res = await erpCreatePrf(payload(false));

    if (!res || res.success !== true) {
      if (res && res.code === 'OPEN_PRF_CONFLICT') {
        var list = (res.conflicts || []).map(function(c) {
          var a = _rp.prfAge[c.item_code];
          var ageNote = a && a.days !== null ? ' (oldest PRF ' + rpAgeText(a.days) + ' old' + (a.days >= RP_STALE_DAYS ? ' — STALE' : '') + ')' : '';
          return '• ' + c.item_code + ' — ' + rpNum(c.open_qty) + ' already on ' + c.prf_nos + ageNote;
        }).join('\n');
        if (!confirm('These items are already on an open PRF:\n\n' + list + '\n\nStale lines you no longer expect can be cancelled in PRF Monitor instead.\n\nCreate the PRF anyway?')) {
          await rpLoad(); // refresh so the rows show the latest On Order
          return;
        }
        res = await erpCreatePrf(payload(true));
        if (!res || res.success !== true) throw new Error((res && res.message) || 'PRF was not created');
      } else {
        throw new Error((res && res.message) || 'PRF was not created');
      }
    }

    try {
      localStorage.setItem('rp_noted_by', notedBy);
      localStorage.setItem('rp_approved_by', approvedBy);
    } catch(e) {}

    _rp.prfsChanged = true;
    rpClosePrfModal();
    rpShowSuccessModal(res.prfs || []);
    _rp.selectedItems = {};
    _rp.extraItems = [];
    _rp.modalVals = {};
    await rpLoad();

  } catch(err) {
    console.error('[rpSubmitPrf]', err);
    erpShowToast('Failed — nothing was created. ' + err.message, 'danger');
  } finally {
    _rp.isSubmitting = false;
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

function rpShowSuccessModal(prfs) {
  var totalItems = 0, totalQty = 0;
  prfs.forEach(function(p) { totalItems += Number(p.items || 0); totalQty += Number(p.total_qty || 0); });

  document.getElementById('rpSuccessLabel').textContent =
    prfs.length === 1 ? 'Successfully created:' : 'Successfully created ' + prfs.length + ' PRFs:';
  document.getElementById('rpSuccessPrfNo').innerHTML = prfs.map(function(p) {
    return rpEsc(p.prf_no) + ' <span class="text-muted small">(' + rpEsc(p.category) + ')</span>';
  }).join('<br>');
  document.getElementById('rpSuccessSummary').innerHTML =
    '<i class="bi bi-box-seam me-1"></i>' + totalItems + ' items · Total Qty: <strong>' + rpNum(totalQty) + '</strong>';

  if (!_rp.successModal) {
    _rp.successModal = new bootstrap.Modal(document.getElementById('rpSuccessModal'), { backdrop: 'static' });
  }
  _rp.successModal.show();
}

function rpCloseSuccessModal() {
  if (_rp.successModal) _rp.successModal.hide();
}

function rpViewCreatedPrfs() {
  if (_rp.successModal) _rp.successModal.hide();
  rpSwitchTab('prfs');
}

// ═══════════════════════════════════════════════════════════
// FILTERS / PAGING
// ═══════════════════════════════════════════════════════════
function rpOnSearch() {
  clearTimeout(_rp.searchTimer);
  _rp.searchTimer = setTimeout(function() {
    _rp.currentPage = 1;
    rpRender();
  }, 300);
}

function rpClearFilters() {
  document.getElementById('rpSearchInput').value = '';
  document.getElementById('rpOrderFilter').value = 'needs';
  document.getElementById('rpCategoryFilter').value = '';
  document.getElementById('rpUrgencyFilter').value = '';
  document.getElementById('rpLocationFilter').value = '';
  document.getElementById('rpActiveFilter').value = '';
  rpLsSet('rp_active_filter', '');
  document.getElementById('rpSortFilter').value = 'value_desc';
  _rp.hsort = null;
  _rp.currentPage = 1;
  rpRender();
}

function rpPagePrev() { rpGoPage(_rp.currentPage - 1); }
function rpPageNext() { rpGoPage(_rp.currentPage + 1); }

function rpRefresh() {
  erpShowToast('Refreshing...', 'info');
  rpLoad();
  rpCheckHealth();
  if (_rp.activeTab === 'prfs') rpPrfFrameCall('prfMonitorRefresh');
}

// ═══════════════════════════════════════════════════════════
// EXPORT CSV (current filtered list)
// ═══════════════════════════════════════════════════════════
function rpExport() {
  if (_rp.filteredItems.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }

  var headers = ['Item Code', 'Description', 'Category', 'Location', 'Unit',
                 'On-Hand', 'Buffer Stock', 'Ave Monthly', 'Qty Needed', 'On Order',
                 'Open PRF(s)', 'Net Needed', 'Unit Cost', 'Net Est. Cost', 'Urgency', 'Active Months', 'Movement', 'Oldest Open PRF (days)', 'Stale'];
  var rows = _rp.filteredItems.map(function(it) {
    return [
      it.item_code || '',
      it.description || '',
      it.category || '',
      it.location || '',
      it.base_unit || '',
      Number(it.on_hand || 0),
      Number(it.buffer_stock || 0),
      Number(it.ave_monthly_consumption || 0),
      Number(it.qty_needed || 0),
      rpOnOrder(it),
      it.open_prf_nos || '',
      rpNetNeeded(it),
      Number(it.unit_cost || 0),
      rpNetValue(it),
      it.urgency || '',
      rpActive(it) === null ? '' : rpActive(it),
      it.inventory_movement || '',
      rpAge(it) === null ? '' : rpAge(it),
      rpIsStale(it) ? 'YES' : ''
    ];
  });

  var csv = headers.map(_csvEscRp).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEscRp).join(',') + '\n'; });

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Replenishment_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();

  erpShowToast('Exported ' + rows.length + ' items', 'success');
}

function _csvEscRp(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function rpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function rpTruncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.substring(0, max) + '…';
}

function rpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cssEscape(str) {
  return String(str || '').replace(/([^\w-])/g, '\\$1');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
}

window.rpSwitchTab = rpSwitchTab;
window.rpPrfFrameCall = rpPrfFrameCall;
console.log('✅ replenishment.js v2.0 loaded');
