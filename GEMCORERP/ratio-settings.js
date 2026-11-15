// ============================================================
// GEMCOR ERP — Ratio Settings (Turnover Ratio & Inventory Ratio)
// Settings panel para baguhin ang formula, days-per-year at status thresholds
// nang hindi nagbubutingting sa code. Gamit ng Management Dashboard at Stock Monitor.
//
//  • Preview  → ina-apply agad sa page (hindi pa naka-save, mawawala pag nag-reload)
//  • Save     → naka-save sa Supabase (erp_settings), makikita ng lahat — Admin lang
//
// Ang engine (erpRatioGet / erpRatioApply / erpRatioSave / erpItemTurnover ...) ay nasa erp-config.js
// ============================================================
(function () {
  'use strict';

  // ── Presets ─────────────────────────────────────────────
  var PRESETS = {
    'overall.turnover': [
      { id: 'system', label: 'System default (computed by server)', expr: 'issued / inv * (dpy / days)', system: true },
      { id: 'p2', label: 'Issued value ÷ Inventory value, scaled to a year', expr: 'issued / inv * (dpy / days)' },
      { id: 'p3', label: 'Average annual usage ÷ Inventory value', expr: 'usageMo * 12 / inv' },
      { id: 'p4', label: 'Issued value ÷ Inventory of items with usage only', expr: 'issued / invActive * (dpy / days)' },
      { id: 'p5', label: 'Average annual usage ÷ Inventory of items with usage only', expr: 'usageMo * 12 / invActive' },
      { id: 'custom', label: 'Custom formula…' }
    ],
    'overall.invRatio': [
      { id: 'p1', label: 'Days per year ÷ Turnover (default)', expr: 'dpy / turnover' },
      { id: 'p2', label: 'Inventory ÷ average daily issuance', expr: 'inv / (issued / days)' },
      { id: 'p3', label: 'Inventory ÷ average daily usage (items)', expr: 'inv / (usageMo * 12 / dpy)' },
      { id: 'p4', label: 'Inventory of items with usage ÷ average daily usage', expr: 'invActive / (usageMo * 12 / dpy)' },
      { id: 'custom', label: 'Custom formula…' }
    ],
    'item.turnover': [
      { id: 'p1', label: 'Average annual usage ÷ On-Hand (default)', expr: 'aveMo * 12 / onHand' },
      { id: 'custom', label: 'Custom formula…' }
    ],
    'item.invRatio': [
      { id: 'p1', label: 'Days per year ÷ Turnover (default)', expr: 'dpy / turnover' },
      { id: 'p2', label: 'On-Hand ÷ average daily usage', expr: 'onHand / (aveMo * 12 / dpy)' },
      { id: 'custom', label: 'Custom formula…' }
    ]
  };

  // Ano ang ibig sabihin ng bawat variable
  var VAR_HELP = {
    issued:    'Value issued to production (MRIF) in the selected period (₱)',
    inv:       'Total inventory value on hand (₱)',
    invActive: 'Inventory value of items that have recorded usage only (₱)',
    usageMo:   'Average monthly usage value = Σ (Ave/Mo × unit cost) (₱ per month)',
    days:      'Number of days in the selected period (dashboard month filter)',
    dpy:       'Days per year (setting below)',
    turnover:  'Result of the Turnover formula above',
    onHand:    'Item: current on-hand quantity',
    aveMo:     'Item: average monthly consumption (Ave/Mo)'
  };

  var draft = null;          // working copy habang bukas ang modal
  var lastFocus = null;      // huling formula input na na-click (para sa variable chips)
  var timer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(id) { return document.getElementById(id); }
  function isAdmin() { try { return localStorage.getItem('ivm_isAdmin') === 'true'; } catch (e) { return false; } }
  function onDashboard() { return typeof window.mdashRatioVars === 'function' && !!window.mdashRatioVars(); }
  function toast(msg, type) { if (typeof window.erpShowToast === 'function') window.erpShowToast(msg, type || 'success'); else alert(msg); }
  function get(path) { var p = path.split('.'); return draft[p[0]][p[1]]; }
  function set(path, v) { var p = path.split('.'); draft[p[0]][p[1]] = v; }

  // ── Styles ──────────────────────────────────────────────
  function injectCss() {
    if ($('erpRatioCss')) return;
    var st = document.createElement('style');
    st.id = 'erpRatioCss';
    st.textContent =
      '.rs-sec{border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:12px;background:#fff}' +
      '.rs-sec h6{font-weight:700;color:#1e3a5f;margin:0 0 4px}' +
      '.rs-sub{font-size:.78rem;color:#64748b;margin-bottom:10px}' +
      '.rs-row{display:grid;grid-template-columns:1fr;gap:6px;margin-bottom:10px}' +
      '.rs-expr{font-family:ui-monospace,Consolas,monospace;font-size:.92rem}' +
      '.rs-expr.bad{border-color:#dc2626;background:#fef2f2}' +
      '.rs-err{color:#b91c1c;font-size:.75rem;min-height:1em}' +
      '.rs-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}' +
      '.rs-chip{border:1px dashed #94a3b8;background:#f8fafc;border-radius:999px;padding:1px 9px;font-family:ui-monospace,Consolas,monospace;font-size:.75rem;cursor:pointer}' +
      '.rs-chip:hover{background:#e0f2fe;border-color:#0284c7}' +
      '.rs-prev{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}' +
      '.rs-card{border-radius:10px;padding:10px 14px;border:1px solid #e2e8f0;background:#f8fafc}' +
      '.rs-card .l{font-size:.72rem;font-weight:700;text-transform:uppercase;color:#64748b}' +
      '.rs-card .n{font-size:1.6rem;font-weight:800;color:#1e3a5f;line-height:1.1}' +
      '.rs-card .w{font-size:.75rem;color:#64748b}' +
      '.rs-card .st{display:inline-block;margin-top:3px;font-size:.7rem;font-weight:700;padding:1px 8px;border-radius:999px}' +
      '.rs-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}' +
      '.rs-grid4 label{font-size:.72rem;font-weight:700;color:#475569}' +
      '.rs-note{font-size:.76rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 10px;margin-bottom:10px}' +
      '.erp-ratio-badge{display:inline-block;margin-left:5px;font-size:.62rem;font-weight:800;background:#f59e0b;color:#fff;border-radius:999px;padding:1px 7px}' +
      '@media(max-width:640px){.rs-prev,.rs-grid4{grid-template-columns:1fr 1fr}}';
    document.head.appendChild(st);
  }

  // ── Compute a (draft or current) settings object against dashboard data ─────
  function calcOverall(S) {
    var base = window.mdashRatioVars && window.mdashRatioVars();
    if (!base) return null;
    var vars = Object.assign({}, base, { dpy: S.dpy });
    var t = S.overall.tMode === 'system' ? window.mdashServerTurnover() : erpRatioEval('overall.turnover', vars, S.overall.turnover);
    if (t === null || !(t > 0)) t = 0;
    var d = erpRatioEval('overall.invRatio', Object.assign({}, vars, { turnover: t }), S.overall.invRatio);
    if (d !== null && !(d > 0)) d = null;
    var b = S.bands, st = t === 0 ? 'Very slow' : t < b[0] ? 'Very slow' : t < b[1] ? 'Slow' : t < b[2] ? 'Healthy' : 'Fast';
    return { t: t, d: d, st: st };
  }
  function calcItem(S, onHand, aveMo) {
    var v = { onHand: onHand, aveMo: aveMo, dpy: S.dpy };
    var t = erpRatioEval('item.turnover', v, S.item.turnover);
    var d = t === null ? null : erpRatioEval('item.invRatio', Object.assign({}, v, { turnover: t }), S.item.invRatio);
    return { t: t, d: d };
  }
  var ST_COLOR = { 'Very slow': ['#fee2e2', '#b91c1c'], 'Slow': ['#fef3c7', '#b45309'], 'Healthy': ['#dcfce7', '#166534'], 'Fast': ['#dbeafe', '#1d4ed8'] };
  function fmtT(t) { return (t === null || t === undefined) ? '—' : (t > 0 ? t.toFixed(2) + '×' : '0×'); }
  function fmtD(d, months) { return (d === null || d === undefined) ? '—' : (months ? (d / 30.4).toFixed(1) + ' months' : Math.round(d).toLocaleString() + ' days'); }

  // ── Modal skeleton ──────────────────────────────────────
  function presetSelect(path) {
    return '<select class="form-select form-select-sm" id="rsPre_' + path.replace('.', '_') + '">' +
      PRESETS[path].map(function (p) { return '<option value="' + p.id + '">' + esc(p.label) + '</option>'; }).join('') + '</select>';
  }
  function formulaBlock(path, title, hint, vars) {
    var id = path.replace('.', '_');
    return '<div class="rs-row"><div><label class="form-label fw-bold small mb-1">' + title + '</label>' + presetSelect(path) + '</div>' +
      '<div><input type="text" class="form-control rs-expr" id="rsExpr_' + id + '" data-path="' + path + '" spellcheck="false" autocomplete="off" maxlength="200">' +
      '<div class="rs-err" id="rsErr_' + id + '"></div>' +
      '<div class="rs-chips" data-for="' + path + '">' + vars.map(function (v) {
        return '<span class="rs-chip" data-var="' + v + '" title="' + esc(VAR_HELP[v] || '') + '">' + v + '</span>'; }).join('') +
      '<span class="rs-chip" data-var="(" style="border-style:solid">(</span><span class="rs-chip" data-var=")" style="border-style:solid">)</span>' +
      '<span class="rs-chip" data-var=" + " style="border-style:solid">+</span><span class="rs-chip" data-var=" - " style="border-style:solid">−</span>' +
      '<span class="rs-chip" data-var=" * " style="border-style:solid">×</span><span class="rs-chip" data-var=" / " style="border-style:solid">÷</span></div>' +
      '<div class="rs-sub mt-1 mb-0">' + hint + '</div></div></div>';
  }

  function buildModal() {
    injectCss();
    var old = $('erpRatioModal'); if (old) old.remove();
    var dash = onDashboard();
    var w = document.createElement('div');
    w.innerHTML =
      '<div class="modal fade" id="erpRatioModal" tabindex="-1"><div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header" style="background:#1e3a5f;color:#fff;"><h5 class="modal-title"><i class="bi bi-sliders me-2"></i>Ratio Settings — Turnover &amp; Inventory Ratio</h5>' +
      '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>' +
      '<div class="modal-body" style="background:#f1f5f9;">' +
        '<div class="rs-note" id="rsStateNote"></div>' +

        (dash ? '<div class="rs-prev">' +
          '<div class="rs-card"><div class="l">Turnover Ratio (dashboard)</div><div class="n" id="rsPvT">—</div><div class="w" id="rsPvTw"></div><span class="st" id="rsPvSt"></span></div>' +
          '<div class="rs-card"><div class="l">Inventory Ratio (dashboard)</div><div class="n" id="rsPvD">—</div><div class="w" id="rsPvDw"></div></div></div>' : '') +

        (dash ? '<div class="rs-sec"><h6><i class="bi bi-speedometer2 me-1"></i>Dashboard cards</h6>' +
          '<div class="rs-sub">Pumili ng preset o i-type ang sariling formula. Ang makikita sa itaas ay ang resulta ng formula na ito para sa kasalukuyang filter/month ng dashboard.</div>' +
          formulaBlock('overall.turnover', 'Turnover Ratio (times per year)', 'Halimbawa: <code>issued / inv * (dpy / days)</code>', ERP_RATIO_VARS['overall.turnover']) +
          formulaBlock('overall.invRatio', 'Inventory Ratio (result is in <b>days</b>)', 'Halimbawa: <code>dpy / turnover</code> o <code>inv / (issued / days)</code>', ERP_RATIO_VARS['overall.invRatio']) +
          '<div class="d-flex align-items-center gap-2"><label class="small fw-bold mb-0">Show Inventory Ratio as</label>' +
          '<select class="form-select form-select-sm" style="width:auto" id="rsUnit"><option value="days">days</option><option value="months">months</option></select></div></div>'
          : '<div class="rs-note" style="color:#1e40af;background:#eff6ff;border-color:#bfdbfe;"><i class="bi bi-info-circle me-1"></i>Ang formula ng <b>Turnover / Inventory Ratio cards</b> ay makikita sa <b>Management Dashboard</b>. Dito, ang per-item columns at thresholds ang puwedeng baguhin.</div>') +

        '<div class="rs-sec"><h6><i class="bi bi-traffic-light me-1"></i>Status thresholds &amp; days per year</h6>' +
          '<div class="rs-sub">Kung ilang beses/taon ang hangganan ng bawat status ng Turnover. Ang mga saklaw sa “days of stock” ay awtomatikong susunod.</div>' +
          '<div class="rs-grid4">' +
            '<div><label>Very slow below</label><input type="number" step="0.1" min="0" class="form-control form-control-sm" id="rsB0"></div>' +
            '<div><label>Slow below</label><input type="number" step="0.1" min="0" class="form-control form-control-sm" id="rsB1"></div>' +
            '<div><label>Healthy below</label><input type="number" step="0.1" min="0" class="form-control form-control-sm" id="rsB2"></div>' +
            '<div><label>Days per year</label><input type="number" step="1" min="1" max="400" class="form-control form-control-sm" id="rsDpy"></div>' +
          '</div><div class="rs-err mt-1" id="rsErrBands"></div>' +
          '<div class="rs-sub mb-0">Fast = at/above the “Healthy below” value. Karaniwang days per year: 365 (calendar), 360, o 312 (working days).</div></div>' +

        '<details class="rs-sec" id="rsItemSec"><summary style="cursor:pointer;font-weight:700;color:#1e3a5f"><i class="bi bi-table me-1"></i>Per-item columns (Stock Monitor &amp; item tables)</summary>' +
          '<div class="rs-sub mt-2">Para sa Turnover at Inventory Ratio na column ng bawat item. “No usage” at “Out of stock” ay laging hiwalay na tinatrato.</div>' +
          formulaBlock('item.turnover', 'Item Turnover Ratio', 'Variables: <code>onHand</code>, <code>aveMo</code>, <code>dpy</code>', ERP_RATIO_VARS['item.turnover']) +
          formulaBlock('item.invRatio', 'Item Inventory Ratio (days)', 'Variables: <code>onHand</code>, <code>aveMo</code>, <code>dpy</code>, <code>turnover</code>', ERP_RATIO_VARS['item.invRatio']) +
          '<div class="d-flex flex-wrap align-items-end gap-2"><div><label class="small fw-bold">Test: On-Hand</label><input type="number" class="form-control form-control-sm" id="rsTestOn" value="100" style="width:110px"></div>' +
          '<div><label class="small fw-bold">Ave/Mo</label><input type="number" class="form-control form-control-sm" id="rsTestAve" value="20" style="width:110px"></div>' +
          '<div class="small pb-1">→ Turnover <b id="rsTestT">—</b> · Inventory Ratio <b id="rsTestD">—</b></div></div>' +
        '</details>' +
      '</div>' +
      '<div class="modal-footer" style="justify-content:space-between;">' +
        '<div><button class="btn btn-outline-secondary btn-sm" id="rsReset"><i class="bi bi-arrow-counterclockwise me-1"></i>Reset to default</button> ' +
        '<button class="btn btn-outline-danger btn-sm d-none" id="rsRevert"><i class="bi bi-x-circle me-1"></i>Revert preview</button></div>' +
        '<div class="d-flex gap-2"><button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">Close</button>' +
        '<button class="btn btn-warning btn-sm" id="rsPreview"><i class="bi bi-eye me-1"></i>Preview on page</button>' +
        '<button class="btn btn-primary btn-sm" id="rsSave"><i class="bi bi-cloud-check me-1"></i>Save for everyone</button></div></div>' +
      '</div></div></div>';
    document.body.appendChild(w.firstChild);
    wire();
  }

  // ── Sync UI from draft ──────────────────────────────────
  function presetIdFor(path) {
    var expr = get(path), list = PRESETS[path];
    if (path === 'overall.turnover' && draft.overall.tMode === 'system') return 'system';
    for (var i = 0; i < list.length; i++) {
      if (list[i].system) continue;
      if (list[i].expr && list[i].expr === expr) return list[i].id;
    }
    return 'custom';
  }

  function fillFromDraft() {
    ['overall.turnover', 'overall.invRatio', 'item.turnover', 'item.invRatio'].forEach(function (path) {
      var id = path.replace('.', '_'), ex = $('rsExpr_' + id), pr = $('rsPre_' + id);
      if (!ex) return;
      if (document.activeElement !== ex) ex.value = get(path);
      pr.value = presetIdFor(path);
      var sys = path === 'overall.turnover' && draft.overall.tMode === 'system';
      ex.readOnly = sys;
      ex.title = sys ? 'Computed by the server — pumili ng ibang preset o “Custom formula” para baguhin' : '';
    });
    if ($('rsUnit')) $('rsUnit').value = draft.overall.invUnit;
    $('rsB0').value = draft.bands[0]; $('rsB1').value = draft.bands[1]; $('rsB2').value = draft.bands[2];
    $('rsDpy').value = draft.dpy;
  }

  // ── Validate draft; returns true kung puwede nang i-apply ──
  function validate() {
    var ok = true;
    ['overall.turnover', 'overall.invRatio', 'item.turnover', 'item.invRatio'].forEach(function (path) {
      var id = path.replace('.', '_'), ex = $('rsExpr_' + id);
      if (!ex) return;
      var sys = path === 'overall.turnover' && draft.overall.tMode === 'system';
      var r = sys ? { ok: true } : erpRatioCheck(path, get(path));
      ex.classList.toggle('bad', !r.ok);
      $('rsErr_' + id).textContent = r.ok ? '' : '⚠ ' + r.error;
      if (!r.ok) ok = false;
    });
    var b = draft.bands, bandsOk = b[0] > 0 && b[0] < b[1] && b[1] < b[2];
    var dpyOk = draft.dpy >= 1 && draft.dpy <= 400;
    $('rsErrBands').textContent = !bandsOk ? '⚠ Dapat tumataas: Very slow < Slow < Healthy (lahat higit sa 0)' : (!dpyOk ? '⚠ Days per year: 1 hanggang 400' : '');
    return ok && bandsOk && dpyOk;
  }

  function refreshPreview() {
    var ok = validate();
    var sn = $('rsStateNote'), prev = erpRatioIsPreview();
    var admin = isAdmin();
    sn.innerHTML = prev
      ? '<i class="bi bi-eye me-1"></i><b>Preview ang naka-apply ngayon</b> — hindi pa ito naka-save at mawawala pag nag-reload.'
      : '<i class="bi bi-check-circle me-1"></i>Naka-save na settings ang gamit ngayon.';
    sn.innerHTML += admin ? '' : ' <b>Admin lang ang makaka-save</b> para sa lahat; puwede kang mag-Preview para sa sarili mong screen.';
    $('rsRevert').classList.toggle('d-none', !prev);
    $('rsSave').disabled = !ok || !admin;
    $('rsSave').title = admin ? '' : 'Admin lang ang puwedeng mag-save ng formula';
    $('rsPreview').disabled = !ok;

    if ($('rsPvT')) {
      var months = draft.overall.invUnit === 'months';
      var n = ok ? calcOverall(draft) : null, c = calcOverall(erpRatioGet());
      $('rsPvT').textContent = n ? fmtT(n.t) : '—';
      $('rsPvTw').textContent = 'Ngayon sa dashboard: ' + (c ? fmtT(c.t) : '—');
      var stEl = $('rsPvSt');
      if (n && ST_COLOR[n.st]) { stEl.textContent = n.st; stEl.style.background = ST_COLOR[n.st][0]; stEl.style.color = ST_COLOR[n.st][1]; } else stEl.textContent = '';
      $('rsPvD').textContent = n ? fmtD(n.d, months) : '—';
      $('rsPvDw').textContent = 'Ngayon sa dashboard: ' + (c ? fmtD(c.d, erpRatioGet().overall.invUnit === 'months') : '—');
    }
    if ($('rsTestT')) {
      var r = ok ? calcItem(draft, Number($('rsTestOn').value) || 0, Number($('rsTestAve').value) || 0) : { t: null, d: null };
      $('rsTestT').textContent = fmtT(r.t); $('rsTestD').textContent = fmtD(r.d, false);
    }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(refreshPreview, 120); }

  // ── Events ──────────────────────────────────────────────
  function wire() {
    var el = $('erpRatioModal');
    ['overall.turnover', 'overall.invRatio', 'item.turnover', 'item.invRatio'].forEach(function (path) {
      var id = path.replace('.', '_'), ex = $('rsExpr_' + id), pr = $('rsPre_' + id);
      if (!ex) return;
      ex.addEventListener('focus', function () { lastFocus = ex; });
      ex.addEventListener('input', function () {
        if (path === 'overall.turnover') draft.overall.tMode = 'custom';
        set(path, ex.value);
        pr.value = presetIdFor(path);
        ex.readOnly = false;
        schedule();
      });
      pr.addEventListener('change', function () {
        var p = PRESETS[path].filter(function (x) { return x.id === pr.value; })[0];
        if (path === 'overall.turnover') draft.overall.tMode = (p && p.system) ? 'system' : 'custom';
        if (p && p.expr) set(path, p.expr);
        fillFromDraft(); if (p && p.id === 'custom') { ex.focus(); ex.select(); }
        schedule();
      });
    });
    el.querySelectorAll('.rs-chip').forEach(function (c) {
      c.addEventListener('mousedown', function (e) { e.preventDefault(); });
      c.addEventListener('click', function () {
        var target = lastFocus && el.contains(lastFocus) && lastFocus.closest('.rs-row') === c.closest('.rs-row') ? lastFocus : c.closest('.rs-row').querySelector('.rs-expr');
        if (target.readOnly) { var path = target.getAttribute('data-path'); if (path === 'overall.turnover') draft.overall.tMode = 'custom'; target.readOnly = false; }
        var s = target.selectionStart == null ? target.value.length : target.selectionStart, e2 = target.selectionEnd == null ? s : target.selectionEnd;
        target.value = target.value.slice(0, s) + c.getAttribute('data-var') + target.value.slice(e2);
        var pos = s + c.getAttribute('data-var').length; target.focus(); target.setSelectionRange(pos, pos);
        target.dispatchEvent(new Event('input'));
      });
    });
    ['rsB0', 'rsB1', 'rsB2'].forEach(function (id, i) {
      $(id).addEventListener('input', function () { draft.bands[i] = Number($(id).value); schedule(); });
    });
    $('rsDpy').addEventListener('input', function () { draft.dpy = Number($('rsDpy').value); schedule(); });
    if ($('rsUnit')) $('rsUnit').addEventListener('change', function () { draft.overall.invUnit = $('rsUnit').value; schedule(); });
    $('rsTestOn').addEventListener('input', schedule); $('rsTestAve').addEventListener('input', schedule);

    $('rsReset').onclick = function () { draft = erpRatioClone(ERP_RATIO_DEFAULTS); fillFromDraft(); refreshPreview(); };
    $('rsRevert').onclick = function () { erpRatioRevert(); draft = erpRatioClone(erpRatioGet()); fillFromDraft(); refreshPreview(); toast('Binalik sa naka-save na settings'); };
    $('rsPreview').onclick = function () {
      if (!validate()) return;
      erpRatioApply(draft, true);
      bootstrap.Modal.getInstance(el).hide();
      toast('Naka-preview na sa page (hindi pa naka-save)', 'info');
    };
    $('rsSave').onclick = async function () {
      if (!validate() || !isAdmin()) return;
      var btn = $('rsSave'); btn.disabled = true;
      try {
        var res = await erpRatioSave(draft);
        bootstrap.Modal.getInstance(el).hide();
        toast(res.shared ? '✅ Na-save ang formula para sa lahat' : '⚠ Na-save sa browser na ito lang — i-run ang erp-settings.sql sa Supabase para makita ng iba', res.shared ? 'success' : 'warning');
      } catch (e) { toast('Hindi na-save: ' + (e.message || e), 'danger'); }
      finally { btn.disabled = false; }
    };
    el.addEventListener('hidden.bs.modal', function () { el.remove(); });
  }

  // ── Public ──────────────────────────────────────────────
  window.erpRatioOpenSettings = function () {
    if (typeof erpRatioGet !== 'function' || typeof bootstrap === 'undefined') return;
    draft = erpRatioClone(erpRatioGet());
    buildModal();
    fillFromDraft();
    refreshPreview();
    bootstrap.Modal.getOrCreateInstance($('erpRatioModal')).show();
  };

  // ── Column header tooltips (sumusunod sa formula) ───────
  function refreshHeaderTitles() {
    var S = erpRatioGet();
    document.querySelectorAll('th').forEach(function (th) {
      var txt = (th.textContent || '').trim();
      var isT = /^Turnover\b/i.test(txt), isI = /^Inventory Ratio\b/i.test(txt);
      if (!isT && !isI) return;
      if (th.dataset.origTitle === undefined) th.dataset.origTitle = th.getAttribute('title') || '';
      var isDef = erpRatioIsDefault(isT ? 'item.turnover' : 'item.invRatio');
      if (isDef) { if (th.dataset.origTitle) th.setAttribute('title', th.dataset.origTitle); return; }
      th.setAttribute('title', (isT ? 'Turnover Ratio per item = ' + S.item.turnover : 'Inventory Ratio per item (days) = ' + S.item.invRatio) +
        '   [aveMo = Ave/Mo, onHand = On-Hand, dpy = ' + S.dpy + ' days/year]');
    });
  }

  // ── Badge sa Ratio Settings button kapag naka-preview ───
  function refreshBadges() {
    var prev = erpRatioIsPreview();
    document.querySelectorAll('.erp-ratio-btn').forEach(function (b) {
      var badge = b.querySelector('.erp-ratio-badge');
      if (prev && !badge) { badge = document.createElement('span'); badge.className = 'erp-ratio-badge'; badge.textContent = 'PREVIEW'; b.appendChild(badge); }
      if (!prev && badge) badge.remove();
    });
  }

  window.addEventListener('erp-ratio-changed', function () {
    refreshHeaderTitles(); refreshBadges();
    // Stock Monitor: i-redraw ang table (may cached items)
    if (typeof window.erpRenderTable === 'function' && document.getElementById('erpTableBody')) {
      try { window.erpRenderTable(); } catch (e) {}
    }
  });

  function init() {
    injectCss();
    refreshHeaderTitles(); refreshBadges();
    if (typeof erpRatioLoad === 'function') erpRatioLoad().then(function () { refreshHeaderTitles(); refreshBadges(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
