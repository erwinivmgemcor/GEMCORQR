// ============================================================
// GEMCOR ERP — Vendor / Supplier autosuggest  (v1.0)
// Pinalitan ang native <datalist> (walang ranking, substring lang,
// at kulang dahil sa 1000-row cap).
//
// Ano ang ginagawa nito:
//  • Kumukuha ng LAHAT ng vendor (paged via erpFetchAll) mula sa MRR docs,
//    PRF PO suppliers, at PO cache
//  • Nililinis: tinatanggal ang quotes sa dulo, sobrang space, at
//    pinagsasama ang duplicates (hindi tinitingnan ang punctuation/case)
//  • Rank: nagsisimula sa tinype > nagsisimula ang isang salita > may laman
//    (tapos pinakamadalas gamitin muna)
//  • Keyboard: ↑ ↓ Enter Esc Tab
//
// Gamit:  ErpVendorSuggest.attach('mrrVendor');
// ============================================================
(function () {
  var CACHE_KEY = 'erp_vendor_names_v2';
  var CACHE_TTL = 2 * 60 * 60 * 1000; // 2 oras
  var MAX_SHOWN = 12;

  var _vendors = null;      // [{ name, key, count }]
  var _loading = null;

  // ── Helpers ────────────────────────────────────────────────
  function clean(v) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    // tanggalin ang quotes sa simula/dulo:  "ABC Corp."  →  ABC Corp.
    s = s.replace(/^["'`\u201C\u201D\u2018\u2019]+|["'`\u201C\u201D\u2018\u2019]+$/g, '').trim();
    return s;
  }
  function keyOf(s) { return String(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Data loading ───────────────────────────────────────────
  async function pull(table, select, filter) {
    // subukan ang iba't ibang stable order; kung walang ganoong column, susunod
    var orders = ['order=created_at.desc', 'order=id.asc', ''];
    for (var i = 0; i < orders.length; i++) {
      var q = 'select=' + select + (filter ? '&' + filter : '') + (orders[i] ? '&' + orders[i] : '');
      try {
        return (await erpFetchAll(table, q)) || [];
      } catch (e) {
        if (e && e.status && e.status !== 400) break; // hindi order problem
      }
    }
    return [];
  }

  function build(rows) {
    // rows: array of raw names → group by normalized key, piliin ang pinakamadalas na spelling
    var groups = {};
    rows.forEach(function (raw) {
      var name = clean(raw);
      if (!name) return;
      var k = keyOf(name);
      if (!k) return;
      var g = groups[k] || (groups[k] = { key: k, count: 0, variants: {} });
      g.count++;
      g.variants[name] = (g.variants[name] || 0) + 1;
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k], best = '', bestN = -1;
      Object.keys(g.variants).forEach(function (n) {
        var c = g.variants[n];
        if (c > bestN || (c === bestN && n.length > best.length)) { best = n; bestN = c; }
      });
      return { name: best, key: k, count: g.count };
    });
  }

  function readCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && c.t && Array.isArray(c.v) && (Date.now() - c.t) < CACHE_TTL) return c.v;
    } catch (e) {}
    return null;
  }
  function writeCache(v) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), v: v })); } catch (e) {}
  }

  async function load(force) {
    if (!force && _vendors) return _vendors;
    if (!force) {
      var c = readCache();
      if (c) { _vendors = c; return _vendors; }
    }
    if (_loading) return _loading;
    _loading = (async function () {
      var raw = [];
      var results = await Promise.all([
        pull('documents', 'vendor', 'doc_type=eq.MRR&vendor=not.is.null'),
        pull('prf_items', 'po_supplier', 'po_supplier=not.is.null'),
        pull('erp_prf_po_cache', 'supplier', 'supplier=not.is.null')
      ]);
      results[0].forEach(function (r) { raw.push(r.vendor); });
      results[1].forEach(function (r) { raw.push(r.po_supplier); });
      results[2].forEach(function (r) { raw.push(r.supplier); });
      var built = build(raw);
      if (built.length) { _vendors = built; writeCache(built); }
      else _vendors = _vendors || [];
      console.log('[VendorSuggest] Loaded', _vendors.length, 'unique vendors from', raw.length, 'rows');
      _loading = null;
      return _vendors;
    })();
    return _loading;
  }

  // ── Ranking ────────────────────────────────────────────────
  function search(q) {
    var list = _vendors || [];
    var qc = clean(q).toUpperCase();
    if (!qc) {
      return list.slice().sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); })
        .slice(0, MAX_SHOWN);
    }
    var tokens = qc.split(/[^A-Z0-9]+/).filter(Boolean);
    if (!tokens.length) return [];
    var qk = keyOf(qc);
    var out = [];
    list.forEach(function (v) {
      var up = v.name.toUpperCase();
      // lahat ng salitang tinype ay dapat nasa pangalan
      var allTokens = tokens.every(function (t) { return up.indexOf(t) !== -1; });
      if (!allTokens && v.key.indexOf(qk) === -1) return; // fallback: kings → KING'S
      var words = up.split(/[^A-Z0-9]+/).filter(Boolean);
      var score;
      if (v.key.indexOf(qk) === 0) score = 0;                                        // nagsisimula sa tinype
      else if (words.some(function (w) { return w.indexOf(tokens[0]) === 0; })) score = 1; // simula ng isang salita
      else score = 2;                                                                // nasa gitna lang
      out.push({ v: v, score: score });
    });
    out.sort(function (a, b) {
      return a.score - b.score || b.v.count - a.v.count || a.v.name.localeCompare(b.v.name);
    });
    return out.slice(0, MAX_SHOWN).map(function (o) { return o.v; });
  }

  function highlight(name, q) {
    var tokens = clean(q).split(/\s+/).filter(Boolean);
    var html = esc(name);
    tokens.forEach(function (t) {
      var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      html = html.replace(re, function (m) { return '<b>' + m + '</b>'; });
    });
    return html;
  }

  // ── UI ─────────────────────────────────────────────────────
  function injectCss() {
    if (document.getElementById('erpVendorSuggestCss')) return;
    var st = document.createElement('style');
    st.id = 'erpVendorSuggestCss';
    st.textContent =
      '.erp-vs-box{position:fixed;z-index:3000;background:#fff;border:1px solid #cbd5e1;border-radius:8px;' +
      'box-shadow:0 10px 25px rgba(0,0,0,.15);max-height:280px;overflow-y:auto;display:none;font-size:.9rem}' +
      '.erp-vs-item{padding:9px 14px;cursor:pointer;border-bottom:1px solid #f1f5f9;color:#1e293b}' +
      '.erp-vs-item:last-child{border-bottom:0}' +
      '.erp-vs-item b{color:#1d4ed8;font-weight:700}' +
      '.erp-vs-item.active,.erp-vs-item:hover{background:#eff6ff}' +
      '.erp-vs-empty{padding:10px 14px;color:#64748b;font-style:italic}';
    document.head.appendChild(st);
  }

  function attach(inputOrId) {
    var input = typeof inputOrId === 'string' ? document.getElementById(inputOrId) : inputOrId;
    if (!input || input._erpVs) return;
    input._erpVs = true;
    injectCss();

    // tanggalin ang native datalist para hindi mag-doble
    input.removeAttribute('list');
    input.setAttribute('autocomplete', 'off');

    var box = document.createElement('div');
    box.className = 'erp-vs-box';
    document.body.appendChild(box);

    var items = [], active = -1;

    function position() {
      var r = input.getBoundingClientRect();
      box.style.left = r.left + 'px';
      box.style.top = (r.bottom + 2) + 'px';
      box.style.width = Math.max(r.width, 280) + 'px';
    }
    function hide() { box.style.display = 'none'; active = -1; }
    function setActive(i) {
      var els = box.querySelectorAll('.erp-vs-item');
      if (!els.length) return;
      active = (i + els.length) % els.length;
      els.forEach(function (el, n) { el.classList.toggle('active', n === active); });
      els[active].scrollIntoView({ block: 'nearest' });
    }
    function choose(name) {
      input.value = name;
      hide();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function render() {
      var q = input.value;
      items = search(q);
      if (!items.length) {
        if (!clean(q)) { hide(); return; }
        box.innerHTML = '<div class="erp-vs-empty">' +
          (_vendors ? 'Walang kapareho — maaari mong i-type ang bagong vendor' : 'Naglo-load ng vendors…') + '</div>';
      } else {
        box.innerHTML = items.map(function (v, i) {
          return '<div class="erp-vs-item" data-i="' + i + '">' + highlight(v.name, q) + '</div>';
        }).join('');
      }
      position();
      box.style.display = 'block';
      active = -1;
    }

    box.addEventListener('mousedown', function (e) {
      var el = e.target.closest('.erp-vs-item');
      if (!el) return;
      e.preventDefault(); // huwag mawala ang focus ng input
      var v = items[+el.getAttribute('data-i')];
      if (v) choose(v.name);
    });

    input.addEventListener('focus', function () { load().then(function () { if (document.activeElement === input) render(); }); });
    input.addEventListener('input', function () {
      if (_vendors) render(); else load().then(render);
    });
    input.addEventListener('keydown', function (e) {
      var open = box.style.display === 'block' && items.length;
      if (e.key === 'ArrowDown') { if (!open) render(); setActive(active + 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && open) { setActive(active - 1); e.preventDefault(); }
      else if (e.key === 'Enter' && open && active >= 0) { choose(items[active].name); e.preventDefault(); }
      else if (e.key === 'Escape') hide();
      else if (e.key === 'Tab' && open && active >= 0) { choose(items[active].name); }
    });
    input.addEventListener('blur', function () { setTimeout(hide, 120); });
    window.addEventListener('resize', function () { if (box.style.display === 'block') position(); });
    window.addEventListener('scroll', function () { if (box.style.display === 'block') position(); }, true);

    // i-preload na habang hindi pa nagta-type
    load();
  }

  window.ErpVendorSuggest = { attach: attach, reload: function () { return load(true); }, search: search };
})();
