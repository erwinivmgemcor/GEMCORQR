// ============================================================
// GEMCOR ERP — Stock & Conflict Alerts (warehouse only)  v1.0
// Polls rpc/erp_stock_alerts every minute and
//   • shows a banner at the top of every page (click = full list)
//   • toast + sound when an item NEWLY goes out of stock / below buffer / in conflict
//   • feeds the top alerts into the notification bell
// Needs: stock-alerts.sql (erp_stock_alerts). Loaded by notifications.js.
// ============================================================
(function () {
  'use strict';
  if (window.erpStockAlerts) return;

  var POLL_MS = 60000;
  var KIND = {
    OUT:           { type: 'stock_out',      icon: 'bi-box-seam',                  color: '#dc2626', label: 'Out of stock',        group: 'stock' },
    NEGATIVE:      { type: 'stock_out',      icon: 'bi-exclamation-octagon-fill',  color: '#dc2626', label: 'Negative on-hand',    group: 'conflict' },
    CRITICAL:      { type: 'stock_low',      icon: 'bi-arrow-down-circle-fill',    color: '#ea580c', label: 'Below reorder point', group: 'stock' },
    LOW:           { type: 'stock_low',      icon: 'bi-arrow-down-circle',         color: '#d97706', label: 'Below buffer',        group: 'stock' },
    OVER_RESERVED: { type: 'stock_conflict', icon: 'bi-lock-fill',                 color: '#7c3aed', label: 'SOF over-reserved',   group: 'conflict' },
    CANT_SERVE:    { type: 'stock_conflict', icon: 'bi-hourglass-split',           color: '#7c3aed', label: "Can't serve pending MRIF", group: 'conflict' }
  };

  var _data = null, _timer = null, _busy = false;

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function user() { return ls('ivm_username') || ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { n = Number(n || 0); return (Math.round(n * 100) / 100).toLocaleString(); }
  function idOf(it) { return it.kind + '|' + it.item_code; }
  function readMap(k) { try { return JSON.parse(ls(k) || 'null'); } catch (e) { return null; } }

  // ── fetch ────────────────────────────────────────────────
  async function load() {
    if (_busy || typeof erpUrl !== 'function') return;
    _busy = true;
    try {
      var res = await fetch(erpUrl('rpc/erp_stock_alerts'), { method: 'POST', headers: erpHeaders(), body: '{}', cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var d = await res.json();
      if (!d || !d.items) throw new Error('bad payload');
      _data = d;
      detectNew(d.items);
      renderBanner();
      if (window._notifState && typeof fetchNotifications === 'function') {
        // refresh the bell with the new alert items (cheap; it has its own guard)
        try { fetchNotifications(); } catch (e) {}
      }
    } catch (e) {
      console.warn('[StockAlerts]', e.message, '(run stock-alerts.sql?)');
    } finally { _busy = false; }
  }

  // ── detect new alerts (per user, survives refresh) ───────
  function detectNew(items) {
    var u = user(); if (!u) return;
    var sk = 'ivm_stk_seen_' + u, fk = 'ivm_stk_first_' + u;
    var prev = readMap(sk), first = readMap(fk) || {}, now = Date.now();
    var cur = {}, fresh = [];
    items.forEach(function (it) {
      var id = idOf(it); cur[id] = 1;
      if (!first[id]) first[id] = now;
      if (prev && !prev[id]) fresh.push(it);
    });
    Object.keys(first).forEach(function (id) { if (!cur[id]) delete first[id]; });   // recovered → can alert again
    lsSet(sk, JSON.stringify(cur));
    lsSet(fk, JSON.stringify(first));
    if (!prev || !fresh.length) return;                                              // very first run = silent baseline
    if (window.erpAlerts && erpAlerts.announce) erpAlerts.announce(fresh.map(toNotif));
  }

  function toNotif(it) {
    var k = KIND[it.kind] || KIND.LOW;
    var meta = it.kind === 'CANT_SERVE'
      ? 'Pending MRIF needs ' + num(it.demand) + ', free stock ' + num(Math.max(it.free, 0)) + ' (' + it.docs + ' doc' + (it.docs > 1 ? 's' : '') + ')'
      : it.kind === 'OVER_RESERVED'
        ? 'Reserved ' + num(it.reserved) + ' > on-hand ' + num(it.on_hand)
        : 'On-hand ' + num(it.on_hand) + (it.buffer > 0 ? ' · buffer ' + num(it.buffer) : '');
    return { id: 'stk_' + idOf(it), type: k.type, icon: k.icon, iconColor: k.color,
             title: k.label, subtitle: it.item_code, meta: meta,
             timestamp: (readMap('ivm_stk_first_' + user()) || {})[idOf(it)] || Date.now(),
             link: it.kind === 'CANT_SERVE' ? 'all-requests.html' : 'stock-monitor.html', docNo: '' };
  }

  // top alerts for the notification bell
  function bellItems() {
    if (!_data) return [];
    return _data.items.filter(function (i) { return i.sev <= 2; }).slice(0, 8).map(toNotif);
  }

  // ── banner ───────────────────────────────────────────────
  function counts() {
    var c = (_data && _data.counts) || {};
    return {
      out: (c.OUT || 0) + (c.NEGATIVE || 0),
      low: (c.CRITICAL || 0) + (c.LOW || 0),
      conf: (c.OVER_RESERVED || 0) + (c.CANT_SERVE || 0),
      stale: (_data && _data.stale_docs) || 0
    };
  }

  function injectStyle() {
    if (document.getElementById('erpStkStyle')) return;
    var st = document.createElement('style'); st.id = 'erpStkStyle';
    st.textContent =
      '#erpStkBanner{display:none;align-items:center;gap:12px;margin:0 0 14px;padding:10px 14px;border-radius:10px;font-size:.88rem;cursor:pointer;border:1px solid #fecaca;background:#fef2f2;color:#7f1d1d}' +
      '#erpStkBanner.warn{border-color:#fde68a;background:#fffbeb;color:#78350f}' +
      '#erpStkBanner .stk-pill{display:inline-block;padding:2px 9px;border-radius:20px;font-weight:700;font-size:.78rem;margin-right:6px;background:#fff;border:1px solid currentColor}' +
      '#erpStkBanner .stk-x{margin-left:auto;background:none;border:0;font-size:1.2rem;line-height:1;color:inherit;opacity:.6}' +
      '#erpStkModal{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.55);display:none;align-items:flex-start;justify-content:center;padding:4vh 12px;overflow:auto}' +
      '#erpStkModal .stk-box{background:#fff;color:#0f172a;border-radius:14px;width:100%;max-width:980px;box-shadow:0 24px 60px rgba(0,0,0,.35)}' +
      '#erpStkModal .stk-h{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #e2e8f0;font-weight:700}' +
      '#erpStkModal .stk-tabs{display:flex;gap:6px;padding:10px 18px 0;flex-wrap:wrap}' +
      '#erpStkModal .stk-tab{border:1px solid #e2e8f0;background:#f8fafc;border-radius:20px;padding:4px 12px;font-size:.82rem;cursor:pointer}' +
      '#erpStkModal .stk-tab.on{background:#1e3a5f;color:#fff;border-color:#1e3a5f}' +
      '#erpStkModal .stk-body{padding:10px 18px 18px;max-height:68vh;overflow:auto}' +
      '#erpStkModal table{width:100%;border-collapse:collapse;font-size:.83rem}' +
      '#erpStkModal th{position:sticky;top:0;background:#f1f5f9;text-align:left;padding:6px 8px;font-size:.72rem;text-transform:uppercase;letter-spacing:.4px;color:#64748b}' +
      '#erpStkModal td{padding:6px 8px;border-top:1px solid #eef2f7;vertical-align:top}' +
      '#erpStkModal .stk-tag{display:inline-block;padding:1px 8px;border-radius:12px;font-size:.72rem;font-weight:700;color:#fff;white-space:nowrap}' +
      '#erpStkModal .stk-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:4px 10px;font-size:.82rem;cursor:pointer}';
    document.head.appendChild(st);
  }

  function signature() { var c = counts(); return [c.out, c.low, c.conf, c.stale].join('-'); }

  function renderBanner() {
    injectStyle();
    var host = document.querySelector('main.erp-container') || document.querySelector('.erp-container');
    if (!host) return;
    var b = document.getElementById('erpStkBanner');
    if (!b) {
      b = document.createElement('div'); b.id = 'erpStkBanner';
      b.addEventListener('click', openModal);
      host.insertBefore(b, host.firstChild);
    }
    var c = counts();
    var total = c.out + c.low + c.conf + c.stale;
    var dismissed = false;
    try { dismissed = sessionStorage.getItem('erp_stk_dismiss') === signature(); } catch (e) {}
    if (!total || dismissed) { b.style.display = 'none'; return; }
    var parts = [];
    if (c.out)   parts.push('<span class="stk-pill">' + c.out + ' out of stock / negative</span>');
    if (c.low)   parts.push('<span class="stk-pill">' + c.low + ' below buffer</span>');
    if (c.conf)  parts.push('<span class="stk-pill">' + c.conf + ' conflict' + (c.conf > 1 ? 's' : '') + '</span>');
    if (c.stale) parts.push('<span class="stk-pill">' + c.stale + ' MRIF pending &gt; 48h</span>');
    b.className = c.out || c.conf ? '' : 'warn';
    b.innerHTML = '<i class="bi bi-exclamation-triangle-fill" style="font-size:1.2rem"></i><div><b>Warehouse Alert</b> ' + parts.join('') +
      '<span style="opacity:.7;font-size:.8rem">click to view</span></div><button class="stk-x" title="Hide until something new comes up" type="button">×</button>';
    b.style.display = 'flex';
    b.querySelector('.stk-x').addEventListener('click', function (e) {
      e.stopPropagation();
      try { sessionStorage.setItem('erp_stk_dismiss', signature()); } catch (er) {}
      b.style.display = 'none';
    });
  }

  // ── detail modal ─────────────────────────────────────────
  var _tab = 'out';
  function tabItems(tab) {
    return (_data ? _data.items : []).filter(function (i) {
      if (tab === 'out')  return i.kind === 'OUT' || i.kind === 'NEGATIVE';
      if (tab === 'low')  return i.kind === 'CRITICAL' || i.kind === 'LOW';
      return i.kind === 'OVER_RESERVED' || i.kind === 'CANT_SERVE';
    });
  }

  function renderModal() {
    var m = document.getElementById('erpStkModal'); if (!m) return;
    var c = counts();
    var tabs = [['out', 'Out of stock / negative', c.out], ['low', 'Below buffer', c.low], ['conf', 'Conflicts', c.conf]];
    var rows = tabItems(_tab).map(function (i) {
      var k = KIND[i.kind];
      var detail = i.kind === 'CANT_SERVE'
        ? 'Pending MRIF needs <b>' + num(i.demand) + '</b> · free <b>' + num(Math.max(i.free, 0)) + '</b> · ' + i.docs + ' doc(s), e.g. ' + esc(i.sample_doc || '')
        : i.kind === 'OVER_RESERVED'
          ? 'SOF reserved <b>' + num(i.reserved) + '</b> but on-hand only <b>' + num(i.on_hand) + '</b>'
          : '';
      return '<tr><td><code>' + esc(i.item_code) + '</code></td><td>' + esc(i.description || '') + '</td>' +
        '<td><span class="stk-tag" style="background:' + k.color + '">' + esc(k.label) + '</span></td>' +
        '<td style="text-align:right">' + num(i.on_hand) + '</td><td style="text-align:right">' + num(i.buffer) + '</td>' +
        '<td style="text-align:right">' + num(i.reserved) + '</td><td>' + detail + '</td></tr>';
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">Walang alert dito 👍</td></tr>';
    m.querySelector('.stk-tabs').innerHTML = tabs.map(function (t) {
      return '<button type="button" class="stk-tab' + (t[0] === _tab ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + ' (' + t[2] + ')</button>';
    }).join('');
    m.querySelector('.stk-body').innerHTML = '<table><thead><tr><th>Item</th><th>Description</th><th>Alert</th><th style="text-align:right">On-hand</th>' +
      '<th style="text-align:right">Buffer</th><th style="text-align:right">Reserved</th><th>Details</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (c.stale ? '<div style="margin-top:10px;font-size:.82rem;color:#92400e">⏱ ' + c.stale + ' MRIF pending for more than 48 hours — check All Requests.</div>' : '');
    Array.prototype.forEach.call(m.querySelectorAll('.stk-tab'), function (b) {
      b.addEventListener('click', function () { _tab = b.getAttribute('data-tab'); renderModal(); });
    });
  }

  function openModal() {
    injectStyle();
    var m = document.getElementById('erpStkModal');
    if (!m) {
      m = document.createElement('div'); m.id = 'erpStkModal';
      m.innerHTML = '<div class="stk-box"><div class="stk-h"><i class="bi bi-exclamation-triangle-fill text-danger"></i><span style="flex:1">Warehouse Alerts</span>' +
        '<a class="stk-btn" href="stock-monitor.html" style="text-decoration:none;color:inherit">Stock Monitor</a>' +
        '<a class="stk-btn" href="all-requests.html" style="text-decoration:none;color:inherit">All Requests</a>' +
        '<button class="stk-btn" type="button" id="stkRefresh">Refresh</button><button class="stk-btn" type="button" id="stkClose">Close</button></div>' +
        '<div class="stk-tabs"></div><div class="stk-body"></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', function (e) { if (e.target === m) m.style.display = 'none'; });
      m.querySelector('#stkClose').addEventListener('click', function () { m.style.display = 'none'; });
      m.querySelector('#stkRefresh').addEventListener('click', function () { load().then(renderModal); });
    }
    var c = counts();
    _tab = c.out ? 'out' : (c.conf ? 'conf' : 'low');
    renderModal();
    m.style.display = 'flex';
  }

  // ═════════ PRODUCTION: flags for MRIF form + banner ═════════
  var _flags = {}, _flagList = [], _flagsLoaded = false;
  var FLAG_TXT = { OUT: 'Out of stock', CRITICAL: 'Very low', LOW: 'Low stock' };
  var FLAG_CLR = { OUT: '#dc2626', CRITICAL: '#ea580c', LOW: '#d97706' };

  function setFlags(list) {
    _flagList = list || []; _flags = {};
    _flagList.forEach(function (f) { _flags[String(f.c).toUpperCase()] = f; });
    _flagsLoaded = true;
  }
  function flagFor(code) { return _flags[String(code || '').trim().toUpperCase()] || null; }

  async function loadFlags() {
    if (typeof erpUrl !== 'function') return;
    try {
      var res = await fetch(erpUrl('rpc/erp_stock_flags'), { method: 'POST', headers: erpHeaders(), body: '{}', cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var d = await res.json();
      if (!Array.isArray(d)) throw new Error('bad payload');
      setFlags(d);
      lsSet('ivm_stk_flags', JSON.stringify(d));        // offline fallback
    } catch (e) {
      console.warn('[StockFlags]', e.message, '(run stock-alerts.sql?)');
      if (!_flagsLoaded) { try { setFlags(JSON.parse(ls('ivm_stk_flags') || '[]')); } catch (er) {} }
    }
    renderProdBanner();
    Array.prototype.forEach.call(document.querySelectorAll('.erp-item-row'), noteRow);
  }

  // inline note under an MRIF item row
  function noteRow(row) {
    var codeEl = row.querySelector('.item-code-input'), qtyEl = row.querySelector('.item-qty-input');
    if (!codeEl) return;
    if (!row.getAttribute('data-stk-bound')) {
      row.setAttribute('data-stk-bound', '1');
      ['change', 'blur'].forEach(function (ev) { codeEl.addEventListener(ev, function () { noteRow(row); }); });
      if (qtyEl) qtyEl.addEventListener('input', function () { noteRow(row); });
    }
    var note = row.querySelector('.erp-item-stock-note');
    var f = flagFor(codeEl.value);
    codeEl.style.borderColor = f ? FLAG_CLR[f.k] : '';
    if (!f) { if (note) note.remove(); return; }
    if (!note) {
      note = document.createElement('div'); note.className = 'erp-item-stock-note';
      note.style.cssText = 'font-size:.76rem;font-weight:600;margin:2px 0 2px 36px;';
      row.appendChild(note);
    }
    var qty = parseFloat(qtyEl && qtyEl.value) || 0;
    var txt;
    if (f.k === 'OUT') txt = '⚠ Out of stock — mananatiling PENDING ang item na ito hanggang may restock.';
    else if (qty > f.free) txt = '⚠ ' + FLAG_TXT[f.k] + ': ' + num(f.free) + ' lang ang available, hinihingi ' + num(qty) + ' — malamang PARTIAL.';
    else txt = '⚠ ' + FLAG_TXT[f.k] + ': ' + num(f.free) + ' na lang ang available.';
    note.style.color = FLAG_CLR[f.k];
    note.textContent = txt;
  }

  function badgeFor(code) {      // html for the item dropdown
    var f = flagFor(code);
    return f ? ' <span style="background:' + FLAG_CLR[f.k] + ';color:#fff;border-radius:10px;padding:0 7px;font-size:.68rem;font-weight:700;margin-left:6px;">' +
      FLAG_TXT[f.k].toUpperCase() + ' · ' + num(f.free) + '</span>' : '';
  }

  function renderProdBanner() {
    injectStyle();
    var host = document.querySelector('.erp-container');
    if (!host) return;
    var b = document.getElementById('erpStkBanner');
    if (!b) { b = document.createElement('div'); b.id = 'erpStkBanner'; b.addEventListener('click', openProdModal); host.insertBefore(b, host.firstChild); }
    var out = _flagList.filter(function (f) { return f.k === 'OUT'; }).length;
    var low = _flagList.length - out;
    var sig = out + '-' + low, dismissed = false;
    try { dismissed = sessionStorage.getItem('erp_stk_dismiss') === sig; } catch (e) {}
    if (!_flagList.length || dismissed) { b.style.display = 'none'; return; }
    b.className = 'warn';
    b.innerHTML = '<i class="bi bi-info-circle-fill" style="font-size:1.2rem"></i><div><b>Stock notice</b> ' +
      (out ? '<span class="stk-pill">' + out + ' out of stock</span>' : '') + (low ? '<span class="stk-pill">' + low + ' low</span>' : '') +
      '<span style="opacity:.7;font-size:.8rem">check bago mag-request — click to view</span></div><button class="stk-x" type="button" title="Hide">×</button>';
    b.style.display = 'flex';
    b.querySelector('.stk-x').addEventListener('click', function (e) {
      e.stopPropagation(); try { sessionStorage.setItem('erp_stk_dismiss', sig); } catch (er) {} b.style.display = 'none';
    });
  }

  function openProdModal() {
    injectStyle();
    var m = document.getElementById('erpStkModal');
    if (m) m.remove();
    m = document.createElement('div'); m.id = 'erpStkModal';
    m.innerHTML = '<div class="stk-box"><div class="stk-h"><i class="bi bi-info-circle-fill text-warning"></i><span style="flex:1">Items na ubos / mababa ang stock</span>' +
      '<input id="stkQ" placeholder="Search item..." style="border:1px solid #cbd5e1;border-radius:8px;padding:4px 10px;font-size:.85rem">' +
      '<button class="stk-btn" type="button" id="stkClose">Close</button></div><div class="stk-body"></div></div>';
    document.body.appendChild(m);
    function draw() {
      var q = (m.querySelector('#stkQ').value || '').toLowerCase();
      var rows = _flagList.filter(function (f) { return !q || (f.c + ' ' + (f.d || '')).toLowerCase().indexOf(q) !== -1; }).slice(0, 400).map(function (f) {
        return '<tr><td><code>' + esc(f.c) + '</code></td><td>' + esc(f.d || '') + '</td><td><span class="stk-tag" style="background:' + FLAG_CLR[f.k] + '">' +
          FLAG_TXT[f.k] + '</span></td><td style="text-align:right">' + num(f.free) + '</td></tr>';
      }).join('') || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">Walang tugma.</td></tr>';
      m.querySelector('.stk-body').innerHTML = '<table><thead><tr><th>Item</th><th>Description</th><th>Status</th><th style="text-align:right">Available</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }
    m.querySelector('#stkQ').addEventListener('input', draw);
    m.querySelector('#stkClose').addEventListener('click', function () { m.remove(); });
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    m.style.display = 'flex'; draw();
  }

  // ── start ────────────────────────────────────────────────
  function start() {
    var role = ls('ivm_userRole') || '';
    if (role === 'production') {
      try { setFlags(JSON.parse(ls('ivm_stk_flags') || '[]')); } catch (e) {}
      renderProdBanner();
      loadFlags();
      setInterval(loadFlags, 5 * POLL_MS);
      return;
    }
    if (role !== 'warehouse') return;
    load();
    _timer = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  }

  window.erpStockAlerts = { flagFor: flagFor, badgeFor: badgeFor, noteRow: noteRow, bellItems: bellItems, refresh: load, open: openModal, data: function () { return _data; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 800); });
  else setTimeout(start, 800);
  console.log('✅ stock-alerts.js v1.0 loaded');
})();
