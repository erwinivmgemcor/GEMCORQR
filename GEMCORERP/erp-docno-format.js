// ============================================================
// GEMCOR ERP — SOF# / PRF# input formatter
//  SOF  → stored as the bare number:  12897   ("SOF#12897", "sof 12897" → 12897)
//  PRF  → stored with prefix:         PRF#26-878   ("26-878", "prf 26-878" → PRF#26-878)
// Several values can be separated by commas.
// ============================================================
(function () {
  function clean(raw, name, addPrefix) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var re = new RegExp('^' + name + '\\s*#?\\s*[:\\-]?\\s*', 'i');
    s = s.replace(re, '').replace(/\s+/g, '').toUpperCase();
    if (!s) return '';
    return addPrefix ? name + '#' + s : s;
  }

  function fmtList(raw, name, addPrefix) {
    var seen = {}, out = [];
    String(raw || '').split(/[,;]+/).forEach(function (p) {
      var v = clean(p, name, addPrefix);
      if (v && !seen[v]) { seen[v] = true; out.push(v); }
    });
    return out;
  }

  window.erpFmtSof = function (raw) { return fmtList(raw, 'SOF', false).join(', '); };
  window.erpFmtPrf = function (raw) { return clean(raw, 'PRF', true); };
  // PO: bare number/code — "PO#16811", "po 16811" → 16811
  window.erpFmtPo = function (raw) { return clean(raw, 'PO', false); };
  window.erpFmtPrfList = function (raw) { return fmtList(raw, 'PRF', true).join(', '); };

  function bind(id, fn) {
    var el = document.getElementById(id);
    if (!el || el._erpFmtBound) return;
    el._erpFmtBound = true;
    el.addEventListener('blur', function () { var v = fn(el.value); if (v !== el.value) el.value = v; });
  }

  function init() {
    bind('mrrSofNo', window.erpFmtSof);
    bind('mrrSofNoDisplay', window.erpFmtSof);
    bind('mrifSofNo', window.erpFmtSof);      // Manual MRIF
    bind('mrrPoNo', window.erpFmtPo);
    bind('mrrPrfNo', window.erpFmtPrfList);
    bind('editPrfNewNo', window.erpFmtPrf);   // PRF Monitor: edit PRF number
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
