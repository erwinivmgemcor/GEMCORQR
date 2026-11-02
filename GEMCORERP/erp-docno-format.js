// ============================================================
// GEMCOR ERP — SOF# / PRF# input formatter
// The user may type "13472", "SOF 13472" or "sof#13472" — all become "SOF#13472".
// The user may type "26-878", "PRF 26-878" or "prf#26-878" — all become "PRF#26-878".
// Several PRFs can be separated by commas: "26-878, 26-879" → "PRF#26-878, PRF#26-879".
// ============================================================
(function () {
  function fmtOne(raw, prefix) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var re = new RegExp('^' + prefix + '\\s*#?\\s*[:\\-]?\\s*', 'i');
    s = s.replace(re, '').replace(/\s+/g, '').toUpperCase();
    return s ? prefix + '#' + s : '';
  }

  function fmtList(raw, prefix) {
    var seen = {}, out = [];
    String(raw || '').split(/[,;]+/).forEach(function (p) {
      var v = fmtOne(p, prefix);
      if (v && !seen[v]) { seen[v] = true; out.push(v); }
    });
    return out;
  }

  window.erpFmtSof = function (raw) { return fmtList(raw, 'SOF').join(', '); };
  window.erpFmtPrf = function (raw) { return fmtOne(raw, 'PRF'); };
  window.erpFmtPrfList = function (raw) { return fmtList(raw, 'PRF').join(', '); };

  function bind(id, fn) {
    var el = document.getElementById(id);
    if (!el || el._erpFmtBound) return;
    el._erpFmtBound = true;
    el.addEventListener('blur', function () { var v = fn(el.value); if (v !== el.value) el.value = v; });
  }

  function init() {
    bind('mrrSofNo', window.erpFmtSof);
    bind('mrrSofNoDisplay', window.erpFmtSof);
    bind('mrrPrfNo', window.erpFmtPrfList);
    bind('editPrfNewNo', window.erpFmtPrf);   // PRF Monitor: edit PRF number
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
