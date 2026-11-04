// ============================================================
// GEMCOR ERP — UOM suggestions  (v1.0)
// Shared na listahan ng Unit (UOM) para sa lahat ng edit/create forms:
//   • Kinukuha ang LAHAT ng units na ginagamit sa inventory (erp_items.base_unit)
//   • Naka-cache ng 6 oras; may built-in na fallback kung offline
//   • Laging kasama ang kasalukuyang unit ng item (para hindi "mawala" o magpalit
//     nang hindi mo namamalayan kapag wala ito sa listahan)
//   • "+ Other…" para sa bagong unit na wala pa sa listahan
// ============================================================
(function () {
  if (window.ErpUom) return;
  var KEY = 'erp_uom_list_v1', TTL = 6 * 60 * 60 * 1000;
  var FALLBACK = ['PIECE', 'PCS', 'PAIR', 'SET', 'BOX', 'ROLL', 'SHEET', 'KG', 'LITER', 'LITERS', 'GAL', 'METER', 'MM',
                  'LENGTH', 'ASSEMB', 'CAN', 'REAM', 'TANK', 'UNIT', 'PACK', 'BAG', 'LOT', 'BOTTLE', 'PAIL', 'CARTON', 'FEET'];
  var OTHER = '__other__';
  var _list = null, _loading = null;

  function clean(u) { return String(u == null ? '' : u).trim(); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function merge(arrs) {
    var seen = {};   // key (uppercase) → pinakamagandang spelling (mas gusto ang ALL CAPS)
    arrs.forEach(function (a) {
      (a || []).forEach(function (u) {
        u = clean(u); if (!u) return;
        var k = u.toUpperCase();
        if (!seen[k] || (u === k && seen[k] !== k)) seen[k] = u;
      });
    });
    return Object.keys(seen).map(function (k) { return seen[k]; })
      .sort(function (a, b) { return a.localeCompare(b); });
  }

  function readCache() {
    try {
      var c = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (c && Array.isArray(c.v) && c.v.length && (Date.now() - c.t) < TTL) return c.v;
    } catch (e) {}
    return null;
  }

  async function load(force) {
    if (!force && _list) return _list;
    if (!force) { var c = readCache(); if (c) { _list = merge([c, FALLBACK]); return _list; } }
    if (_loading) return _loading;
    _loading = (async function () {
      var units = [];
      try {
        if (typeof erpFetchAll === 'function') {
          var rows = await erpFetchAll('erp_items', 'select=base_unit&base_unit=not.is.null&order=item_code.asc');
          units = (rows || []).map(function (r) { return r.base_unit; });
          try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), v: merge([units]) })); } catch (e) {}
        }
      } catch (e) { console.warn('[ErpUom] load failed, using fallback', e); }
      _list = merge([units, FALLBACK]);
      _loading = null;
      return _list;
    })();
    return _loading;
  }

  function list() { return _list || merge([readCache() || [], FALLBACK]); }

  // Listahan para sa isang select: kasama ang kasalukuyang halaga (+ extras)
  function options(current, extras) { return merge([list(), [current], extras || []]); }

  function optionsHtml(current, extras) {
    var cur = clean(current), curKey = cur.toUpperCase();
    var html = options(cur, extras).map(function (u) {
      return '<option value="' + esc(u) + '"' + (u.toUpperCase() === curKey ? ' selected' : '') + '>' + esc(u) + '</option>';
    }).join('');
    return html + '<option value="' + OTHER + '">+ Other…</option>';
  }

  // Tinatawag ng onchange ng select. cb(value) ang ginagawa kapag may napili.
  function pick(sel, cb) {
    if (sel.value === OTHER) {
      var v = prompt('I-type ang Unit (UOM) na gagamitin:');
      v = v ? clean(v).toUpperCase() : '';
      if (!v) {   // na-cancel: ibalik sa dating pili
        var prev = sel.getAttribute('data-prev') || ((sel.querySelector('option[selected]') || {}).value || '');
        sel.value = prev; return;
      }
      var exists = Array.prototype.some.call(sel.options, function (o) { return o.value.toUpperCase() === v; });
      if (!exists) {
        var o = document.createElement('option');
        o.value = v; o.textContent = v;
        sel.insertBefore(o, sel.querySelector('option[value="' + OTHER + '"]'));
      }
      sel.value = Array.prototype.filter.call(sel.options, function (o) { return o.value.toUpperCase() === v; })[0].value;
    }
    sel.setAttribute('data-prev', sel.value);
    if (typeof cb === 'function') cb(sel.value);
  }

  // Italaga ang value ng select (idagdag ang option kung wala pa)
  function setValue(sel, val) {
    if (!sel) return;
    val = clean(val);
    if (!val) return;
    var found = Array.prototype.filter.call(sel.options, function (o) { return o.value.toUpperCase() === val.toUpperCase(); })[0];
    if (!found) {
      var o = document.createElement('option');
      o.value = val; o.textContent = val;
      var other = sel.querySelector('option[value="' + OTHER + '"]');
      other ? sel.insertBefore(o, other) : sel.appendChild(o);
      found = o;
    }
    sel.value = found.value;
    sel.setAttribute('data-prev', sel.value);
  }

  // Tandaan ang dating pili bago magbukas ang dropdown (para sa cancel ng "+ Other…")
  function remember(e) {
    var t = e.target;
    if (t && t.tagName === 'SELECT' && t.value !== OTHER && t.querySelector('option[value="' + OTHER + '"]')) t.setAttribute('data-prev', t.value);
  }
  document.addEventListener('focusin', remember, true);
  document.addEventListener('mousedown', remember, true);

  window.ErpUom = { load: load, list: list, options: options, optionsHtml: optionsHtml, pick: pick, setValue: setValue, OTHER: OTHER };

  // i-preload na para handa na bago pa buksan ang edit form
  function prefetch() { load().catch(function () {}); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prefetch); else prefetch();
})();
