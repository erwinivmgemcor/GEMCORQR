// ============================================================
// GEMCOR ERP — Ratio Settings (Turnover Ratio & Inventory Ratio)  · v2 (simple mode)
// Pumili lang sa dropdowns — walang kailangang i-type na formula. May "In words" sa bawat isa
// para malinaw sa lahat ng user. Ang pag-type ng sariling formula ay nasa "Advanced".
//
//  • Preview  → ina-apply agad sa page (hindi pa naka-save, mawawala pag nag-reload)
//  • Save     → naka-save sa Supabase (erp_settings), makikita ng lahat — Admin lang
//
// Ang engine (erpRatioGet / erpRatioApply / erpRatioSave / erpItemTurnover / erpRatioWords ...) ay nasa erp-config.js
// ============================================================
(function () {
  'use strict';

  var PATHS = ['overall.turnover', 'overall.invRatio', 'item.turnover', 'item.invRatio'];

  // ── Mga pagpipilian (plain language) ─────────────────────
  var PRESETS = {
    'overall.turnover': [
      { id: 'system', label: 'Standard — computed by the system (current default)', expr: 'stockOut / inv * (dpy / days)', system: true,
        say: 'Value of ALL stock taken out of the warehouse in the period (from the stock ledger), divided by the current inventory value, then scaled to a full year. This is what the system uses today.' },
      { id: 'p2', label: 'Same as Standard, calculated on this page (follows “Days in a year”)', expr: 'stockOut / inv * (dpy / days)',
        say: 'Same idea as Standard, but computed here so it follows your “Days in a year” setting and the dashboard inventory value.' },
      { id: 'p9', label: 'Average monthly issuance × 12 ÷ Inventory — complete history (recommended)', expr: 'issuedMo * 12 / inv',
        say: 'Takes the average value issued to production (MRIF) per complete month since January 2026 (legacy sheet plus live system data), multiplies it by 12, and divides by the current inventory value. It does not depend on the selected date range, so it stays stable.' },
      { id: 'p7', label: 'Issued to production (MRIF) ÷ Inventory, scaled to a year', expr: 'issued / inv * (dpy / days)',
        say: 'Counts only material requisitions (MRIF) created in the period. Based on the issued quantities of those documents.' },
      { id: 'p8', label: 'Net issued (MRIF − returns) ÷ Inventory, scaled to a year', expr: '(issued - returned) / inv * (dpy / days)',
        say: 'Like the one above, but subtracts materials returned to the warehouse (MRS) in the same period.' },
      { id: 'p6', label: 'Stock-out ÷ Inventory for the period only (not scaled to a year)', expr: 'stockOut / inv',
        say: 'How many times the inventory was taken out during the selected period only.' },
      { id: 'p3', label: 'Average yearly usage ÷ Inventory', expr: 'usageMo * 12 / inv',
        say: 'Uses each item’s average monthly usage (the “Ave/Mo” from the item list) × 12, divided by inventory value.' },
      { id: 'p4', label: 'Stock-out ÷ Inventory of items with usage only', expr: 'stockOut / invActive * (dpy / days)',
        say: 'Ignores stock that has never been used, so dead stock does not drag the ratio down.' },
      { id: 'p5', label: 'Average yearly usage ÷ Inventory of items with usage only', expr: 'usageMo * 12 / invActive',
        say: 'Average yearly usage divided by the value of only the items that have recorded usage.' },
      { id: 'custom', label: 'My own formula… (Advanced)' }
    ],
    'overall.invRatio': [
      { id: 'p1', label: 'Days in a year ÷ Turnover Ratio (recommended)', expr: 'dpy / turnover',
        say: 'How many days one “turn” of the inventory takes. Follows the Turnover Ratio above.' },
      { id: 'p2', label: 'Inventory ÷ average daily stock-out', expr: 'inv / (stockOut / days)',
        say: 'How many days the current inventory would last at the stock-out pace of the selected period.' },
      { id: 'p3', label: 'Inventory ÷ average daily usage (from item averages)', expr: 'inv / (usageMo * 12 / dpy)',
        say: 'How many days the inventory would last at the average usage of all items.' },
      { id: 'p4', label: 'Inventory of items with usage ÷ average daily usage', expr: 'invActive / (usageMo * 12 / dpy)',
        say: 'Same as above but only counts stock of items that are actually being used.' },
      { id: 'custom', label: 'My own formula… (Advanced)' }
    ],
    'item.turnover': [
      { id: 'p1', label: 'Average yearly usage ÷ On-Hand (recommended)', expr: 'aveMo * 12 / onHand',
        say: 'How many times the item’s current stock would be used up in a year.' },
      { id: 'custom', label: 'My own formula… (Advanced)' }
    ],
    'item.invRatio': [
      { id: 'p1', label: 'Days in a year ÷ Turnover Ratio (recommended)', expr: 'dpy / turnover',
        say: 'Days of stock on hand, based on the item’s Turnover Ratio.' },
      { id: 'p2', label: 'On-Hand ÷ average daily usage', expr: 'onHand / (aveMo * 12 / dpy)',
        say: 'How many days the current On-Hand lasts at the item’s average daily usage.' },
      { id: 'custom', label: 'My own formula… (Advanced)' }
    ]
  };

  var draft = null, lastFocus = null, timer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(id) { return document.getElementById(id); }
  function pid(path) { return path.replace('.', '_'); }
  function isAdmin() { try { return localStorage.getItem('ivm_isAdmin') === 'true'; } catch (e) { return false; } }
  function onDashboard() { return typeof window.mdashRatioVars === 'function' && !!window.mdashRatioVars(); }
  function toast(msg, type) { if (typeof window.erpShowToast === 'function') window.erpShowToast(msg, type || 'success'); else alert(msg); }
  function get(path) { var p = path.split('.'); return draft[p[0]][p[1]]; }
  function set(path, v) { var p = path.split('.'); draft[p[0]][p[1]] = v; }
  function presetOf(path, id) { return PRESETS[path].filter(function (x) { return x.id === id; })[0]; }

  // ── Styles ──────────────────────────────────────────────
  function injectCss() {
    if ($('erpRatioCss')) return;
    var st = document.createElement('style');
    st.id = 'erpRatioCss';
    st.textContent = [
      '.rs-sec{border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:12px;background:#fff}',
      '.rs-sec h6{font-weight:700;color:#1e3a5f;margin:0 0 2px}',
      '.rs-sub{font-size:.8rem;color:#64748b;margin-bottom:10px}',
      '.rs-words{margin-top:8px;font-size:.84rem;color:#1e293b;background:#f0f9ff;border:1px solid #bae6fd;border-left:4px solid #0284c7;border-radius:8px;padding:8px 12px}',
      '.rs-words b{color:#075985}',
      '.rs-words .f{display:block;margin-top:3px;font-weight:600}',
      '.rs-expr{font-family:ui-monospace,Consolas,monospace;font-size:.9rem}',
      '.rs-expr.bad{border-color:#dc2626;background:#fef2f2}',
      '.rs-err{color:#b91c1c;font-size:.75rem;min-height:1em}',
      '.rs-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}',
      '.rs-chip{border:1px dashed #94a3b8;background:#f8fafc;border-radius:999px;padding:2px 10px;font-size:.75rem;cursor:pointer}',
      '.rs-chip.op{border-style:solid;font-weight:700;min-width:28px;text-align:center}',
      '.rs-chip:hover{background:#e0f2fe;border-color:#0284c7}',
      '.rs-prev{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}',
      '.rs-card{border-radius:12px;padding:10px 14px;border:1px solid #e2e8f0;background:#fff}',
      '.rs-card .l{font-size:.72rem;font-weight:700;text-transform:uppercase;color:#64748b}',
      '.rs-card .n{font-size:1.7rem;font-weight:800;color:#1e3a5f;line-height:1.1}',
      '.rs-card .w{font-size:.75rem;color:#64748b}',
      '.rs-card .st{display:inline-block;margin-top:3px;font-size:.7rem;font-weight:700;padding:1px 8px;border-radius:999px}',
      '.rs-bands{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
      '.rs-band{border-radius:10px;padding:8px 10px;border:1px solid transparent}',
      '.rs-band label{font-size:.72rem;font-weight:800;display:block;margin-bottom:3px}',
      '.rs-band .ex{font-size:.7rem;margin-top:3px;opacity:.85}',
      '.rs-note{font-size:.78rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 10px;margin-bottom:10px}',
      '.erp-ratio-badge{display:inline-block;margin-left:5px;font-size:.62rem;font-weight:800;background:#f59e0b;color:#fff;border-radius:999px;padding:1px 7px}',
      'details.rs-sec>summary{cursor:pointer;font-weight:700;color:#1e3a5f}',
      '@media(max-width:640px){.rs-prev,.rs-bands{grid-template-columns:1fr}}'
    ].join('');
    document.head.appendChild(st);
  }

  // ── Compute (draft o current) ───────────────────────────
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
  function selectFor(path) {
    return '<select class="form-select" id="rsPre_' + pid(path) + '">' +
      PRESETS[path].map(function (p) { return '<option value="' + p.id + '">' + esc(p.label) + '</option>'; }).join('') + '</select>';
  }
  function pickBlock(path, title, sub) {
    return '<div class="mb-3"><label class="form-label fw-bold mb-1">' + title + '</label>' +
      (sub ? '<div class="rs-sub mb-1">' + sub + '</div>' : '') + selectFor(path) +
      '<div class="rs-words" id="rsWords_' + pid(path) + '"></div></div>';
  }
  function advBlock(path, title) {
    var id = pid(path), vars = ERP_RATIO_VARS[path];
    return '<div class="mb-3" data-row="' + path + '"><label class="form-label fw-bold small mb-1">' + title + '</label>' +
      '<input type="text" class="form-control rs-expr" id="rsExpr_' + id + '" data-path="' + path + '" spellcheck="false" autocomplete="off" maxlength="200">' +
      '<div class="rs-err" id="rsErr_' + id + '"></div>' +
      '<div class="rs-chips">' + vars.map(function (v) {
        return '<span class="rs-chip" data-var="' + v + '" title="' + esc(v) + '">' + esc(ERP_RATIO_NAMES[v] || v) + '</span>';
      }).join('') +
      '<span class="rs-chip op" data-var="(">(</span><span class="rs-chip op" data-var=")">)</span>' +
      '<span class="rs-chip op" data-var=" + ">+</span><span class="rs-chip op" data-var=" - ">−</span>' +
      '<span class="rs-chip op" data-var=" * ">×</span><span class="rs-chip op" data-var=" / ">÷</span></div></div>';
  }

  function buildModal() {
    injectCss();
    var old = $('erpRatioModal'); if (old) old.remove();
    var dash = onDashboard();
    var dpyOpts = ERP_RATIO_DPY_OPTIONS.map(function (o) { return '<option value="' + o.v + '">' + esc(o.label) + '</option>'; }).join('') +
      '<option value="other">Other number of days…</option>';
    var w = document.createElement('div');
    w.innerHTML =
      '<div class="modal fade" id="erpRatioModal" tabindex="-1"><div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header" style="background:#1e3a5f;color:#fff;"><h5 class="modal-title"><i class="bi bi-sliders me-2"></i>Ratio Settings</h5>' +
      '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>' +
      '<div class="modal-body" style="background:#f1f5f9;">' +
        '<div class="rs-note" id="rsStateNote"></div>' +

        (dash ? '<div class="rs-prev">' +
          '<div class="rs-card"><div class="l">Turnover Ratio · with these settings</div><div class="n" id="rsPvT">—</div><div class="w" id="rsPvTw"></div><span class="st" id="rsPvSt"></span></div>' +
          '<div class="rs-card"><div class="l">Inventory Ratio · with these settings</div><div class="n" id="rsPvD">—</div><div class="w" id="rsPvDw"></div></div></div>' : '') +

        (dash ? '<div class="rs-sec"><h6><i class="bi bi-speedometer2 me-1"></i>Dashboard cards</h6>' +
          '<div class="rs-sub">Pick how each number is computed. The box below each choice explains it in plain words.</div>' +
          pickBlock('overall.turnover', 'Turnover Ratio', 'How many times per year the inventory is used up and replaced.') +
          pickBlock('overall.invRatio', 'Inventory Ratio', 'How long the current stock would last.') +
          '<div class="d-flex align-items-center gap-2"><label class="small fw-bold mb-0">Show Inventory Ratio in</label>' +
          '<select class="form-select form-select-sm" style="width:auto" id="rsUnit"><option value="days">days</option><option value="months">months</option></select></div></div>'
          : '<div class="rs-note" style="color:#1e40af;background:#eff6ff;border-color:#bfdbfe;"><i class="bi bi-info-circle me-1"></i>The formulas of the <b>Turnover / Inventory Ratio cards</b> are set on the <b>Management Dashboard</b>. Here you can change the per-item columns, days in a year, and status colors.</div>') +

        '<div class="rs-sec"><h6><i class="bi bi-calendar3 me-1"></i>Days in a year</h6>' +
          '<div class="rs-sub">Used whenever a ratio is converted between “per year” and “days”. If unsure, keep 365.</div>' +
          '<div class="d-flex flex-wrap gap-2 align-items-center"><select class="form-select" style="max-width:380px" id="rsDpySel">' + dpyOpts + '</select>' +
          '<input type="number" step="1" min="1" max="400" class="form-control d-none" style="width:110px" id="rsDpy"></div>' +
          '<div class="rs-err mt-1" id="rsErrDpy"></div></div>' +

        '<div class="rs-sec"><h6><i class="bi bi-traffic-light me-1"></i>Status colors</h6>' +
          '<div class="rs-sub">Based on the Turnover Ratio (times per year). The “days of stock” ranges in the info windows follow these automatically.</div>' +
          '<div class="rs-bands">' +
            '<div class="rs-band" style="background:#fee2e2;color:#b91c1c;border-color:#fecaca"><label>VERY SLOW — below</label><input type="number" step="0.1" min="0" class="form-control form-control-sm" id="rsB0"><div class="ex" id="rsBx0"></div></div>' +
            '<div class="rs-band" style="background:#fef3c7;color:#b45309;border-color:#fde68a"><label>SLOW — below</label><input type="number" step="0.1" min="0" class="form-control form-control-sm" id="rsB1"><div class="ex" id="rsBx1"></div></div>' +
            '<div class="rs-band" style="background:#dcfce7;color:#166534;border-color:#bbf7d0"><label>HEALTHY — below</label><input type="number" step="0.1" min="0" class="form-control form-control-sm" id="rsB2"><div class="ex" id="rsBx2"></div></div>' +
          '</div><div class="rs-err mt-1" id="rsErrBands"></div>' +
          '<div class="rs-sub mb-0" id="rsBandFast"></div></div>' +

        '<details class="rs-sec" id="rsItemSec"><summary><i class="bi bi-table me-1"></i>Per-item columns (Stock Monitor &amp; item tables)</summary>' +
          '<div class="rs-sub mt-2">Applies to the Turnover and Inventory Ratio column of every item. “No usage” and “Out of stock” are always handled separately.</div>' +
          pickBlock('item.turnover', 'Item Turnover Ratio', '') +
          pickBlock('item.invRatio', 'Item Inventory Ratio (days of stock)', '') +
          '<div class="d-flex flex-wrap align-items-end gap-2"><div><label class="small fw-bold">Try it: On-Hand</label><input type="number" class="form-control form-control-sm" id="rsTestOn" value="100" style="width:110px"></div>' +
          '<div><label class="small fw-bold">Average usage / month</label><input type="number" class="form-control form-control-sm" id="rsTestAve" value="20" style="width:130px"></div>' +
          '<div class="small pb-1">→ Turnover <b id="rsTestT">—</b> · Inventory Ratio <b id="rsTestD">—</b></div></div>' +
        '</details>' +

        '<details class="rs-sec" id="rsAdv"><summary><i class="bi bi-code-slash me-1"></i>Advanced — write my own formula</summary>' +
          '<div class="rs-sub mt-2">Optional. Click the blocks below to build a formula, or type it. Pick “My own formula…” in the dropdowns above to come here. The plain-words explanation updates as you build.</div>' +
          (dash ? advBlock('overall.turnover', 'Turnover Ratio formula') + advBlock('overall.invRatio', 'Inventory Ratio formula') : '') +
          advBlock('item.turnover', 'Item Turnover Ratio formula') + advBlock('item.invRatio', 'Item Inventory Ratio formula') +
        '</details>' +
      '</div>' +
      '<div class="modal-footer" style="justify-content:space-between;">' +
        '<div><button class="btn btn-outline-secondary btn-sm" id="rsReset"><i class="bi bi-arrow-counterclockwise me-1"></i>Reset to default</button> ' +
        '<button class="btn btn-outline-danger btn-sm d-none" id="rsRevert"><i class="bi bi-x-circle me-1"></i>Revert preview</button></div>' +
        '<div class="d-flex gap-2"><button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">Close</button>' +
        '<button class="btn btn-warning btn-sm" id="rsPreview"><i class="bi bi-eye me-1"></i>Try on this page</button>' +
        '<button class="btn btn-primary btn-sm" id="rsSave"><i class="bi bi-cloud-check me-1"></i>Save for everyone</button></div></div>' +
      '</div></div></div>';
    document.body.appendChild(w.firstChild);
    wire();
  }

  // ── Sync UI mula sa draft ───────────────────────────────
  function presetIdFor(path) {
    var expr = get(path), list = PRESETS[path];
    if (path === 'overall.turnover' && draft.overall.tMode === 'system') return 'system';
    for (var i = 0; i < list.length; i++) {
      if (list[i].system) continue;
      if (list[i].expr && list[i].expr === expr) return list[i].id;
    }
    return 'custom';
  }

  function wordsHtml(path) {
    var id = presetIdFor(path), p = presetOf(path, id), expr = get(path);
    var sys = path === 'overall.turnover' && draft.overall.tMode === 'system';
    var say = p && p.say ? p.say : 'Your own formula.';
    var formula = sys ? erpRatioWords(PRESETS[path][0].expr) : erpRatioWords(expr);
    return '<b>In words:</b> ' + esc(say) + '<span class="f">' + esc(formula) + (sys ? ' <span class="text-muted fw-normal">(worked out by the system)</span>' : '') + '</span>';
  }

  function fillFromDraft() {
    PATHS.forEach(function (path) {
      var id = pid(path), ex = $('rsExpr_' + id), pr = $('rsPre_' + id), wd = $('rsWords_' + id);
      if (ex && document.activeElement !== ex) ex.value = get(path);
      if (pr) pr.value = presetIdFor(path);
      if (wd) wd.innerHTML = wordsHtml(path);
      if (ex) {
        var sys = path === 'overall.turnover' && draft.overall.tMode === 'system';
        ex.readOnly = sys;
        ex.title = sys ? 'Computed by the system — pick “My own formula…” to change' : '';
      }
    });
    if ($('rsUnit')) $('rsUnit').value = draft.overall.invUnit;
    $('rsB0').value = draft.bands[0]; $('rsB1').value = draft.bands[1]; $('rsB2').value = draft.bands[2];
    var known = ERP_RATIO_DPY_OPTIONS.some(function (o) { return o.v === Number(draft.dpy); });
    $('rsDpySel').value = known ? String(draft.dpy) : 'other';
    $('rsDpy').classList.toggle('d-none', known);
    if (document.activeElement !== $('rsDpy')) $('rsDpy').value = draft.dpy;
    bandTexts();
  }

  function bandTexts() {
    var b = draft.bands, dp = Number(draft.dpy) || 365;
    function dd(t) { return t > 0 ? Math.round(dp / t) : '—'; }
    $('rsBx0').textContent = 'Under ' + b[0] + '× a year ≈ over ' + dd(b[0]) + ' days of stock';
    $('rsBx1').textContent = b[0] + '× to ' + b[1] + '× ≈ ' + dd(b[1]) + '–' + dd(b[0]) + ' days';
    $('rsBx2').textContent = b[1] + '× to ' + b[2] + '× ≈ ' + dd(b[2]) + '–' + dd(b[1]) + ' days';
    $('rsBandFast').textContent = 'Fast (blue) = ' + b[2] + '× a year or more (under ' + dd(b[2]) + ' days of stock).';
  }

  function validate() {
    var ok = true;
    PATHS.forEach(function (path) {
      var id = pid(path), ex = $('rsExpr_' + id);
      if (!ex) return;
      var sys = path === 'overall.turnover' && draft.overall.tMode === 'system';
      var r = sys ? { ok: true } : erpRatioCheck(path, get(path));
      ex.classList.toggle('bad', !r.ok);
      $('rsErr_' + id).textContent = r.ok ? '' : '⚠ ' + r.error;
      if (!r.ok) { ok = false; $('rsAdv').open = true; }
    });
    var b = draft.bands, bandsOk = b[0] > 0 && b[0] < b[1] && b[1] < b[2];
    var dpyOk = draft.dpy >= 1 && draft.dpy <= 400;
    $('rsErrBands').textContent = !bandsOk ? '⚠ Each limit must be higher than the one before: Very slow < Slow < Healthy (all above 0).' : '';
    $('rsErrDpy').textContent = !dpyOk ? '⚠ Days in a year must be between 1 and 400.' : '';
    return ok && bandsOk && dpyOk;
  }

  function refreshPreview() {
    var ok = validate();
    var sn = $('rsStateNote'), prev = erpRatioIsPreview(), admin = isAdmin();
    sn.innerHTML = prev
      ? '<i class="bi bi-eye me-1"></i><b>A preview is showing on this page now.</b> It is not saved and goes away when you reload.'
      : '<i class="bi bi-check-circle me-1"></i>The saved settings are in use.';
    var bv = window.mdashRatioVars && window.mdashRatioVars();
    if (bv && /issuedMo|receivedMo/.test(get('overall.turnover') + ' ' + get('overall.invRatio')) && !(bv.issuedMo > 0)) {
      sn.innerHTML += ' <b>Monthly history is not loaded yet</b> (run erp-history-setup.sql and erp-history-import.sql, then refresh).';
    }
    sn.innerHTML += admin ? '' : ' <b>Only an Admin can save for everyone</b>; you can still try it on your own screen.';
    $('rsRevert').classList.toggle('d-none', !prev);
    $('rsSave').disabled = !ok || !admin;
    $('rsSave').title = admin ? '' : 'Only an Admin can save the formula';
    $('rsPreview').disabled = !ok;
    PATHS.forEach(function (path) { var wd = $('rsWords_' + pid(path)); if (wd) wd.innerHTML = wordsHtml(path); });
    bandTexts();

    if ($('rsPvT')) {
      var months = draft.overall.invUnit === 'months';
      var n = ok ? calcOverall(draft) : null, c = calcOverall(erpRatioGet());
      $('rsPvT').textContent = n ? fmtT(n.t) : '—';
      $('rsPvTw').textContent = 'Showing now: ' + (c ? fmtT(c.t) : '—');
      var stEl = $('rsPvSt');
      if (n && ST_COLOR[n.st]) { stEl.textContent = n.st; stEl.style.background = ST_COLOR[n.st][0]; stEl.style.color = ST_COLOR[n.st][1]; } else stEl.textContent = '';
      $('rsPvD').textContent = n ? fmtD(n.d, months) : '—';
      $('rsPvDw').textContent = 'Showing now: ' + (c ? fmtD(c.d, erpRatioGet().overall.invUnit === 'months') : '—');
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
    PATHS.forEach(function (path) {
      var id = pid(path), ex = $('rsExpr_' + id), pr = $('rsPre_' + id);
      if (ex) {
        ex.addEventListener('focus', function () { lastFocus = ex; });
        ex.addEventListener('input', function () {
          if (path === 'overall.turnover') draft.overall.tMode = 'custom';
          set(path, ex.value);
          if (pr) pr.value = presetIdFor(path);
          ex.readOnly = false;
          schedule();
        });
      }
      if (pr) pr.addEventListener('change', function () {
        var p = presetOf(path, pr.value);
        if (path === 'overall.turnover') draft.overall.tMode = (p && p.system) ? 'system' : 'custom';
        if (p && p.expr) set(path, p.expr);
        fillFromDraft();
        if (p && p.id === 'custom' && ex) { $('rsAdv').open = true; ex.readOnly = false; ex.focus(); ex.select(); }
        schedule();
      });
    });
    el.querySelectorAll('.rs-chip').forEach(function (c) {
      c.addEventListener('mousedown', function (e) { e.preventDefault(); });
      c.addEventListener('click', function () {
        var row = c.closest('[data-row]'), box = row.querySelector('.rs-expr');
        var target = (lastFocus && row.contains(lastFocus)) ? lastFocus : box;
        if (target.readOnly) { if (target.getAttribute('data-path') === 'overall.turnover') draft.overall.tMode = 'custom'; target.readOnly = false; }
        var s = target.selectionStart == null ? target.value.length : target.selectionStart, e2 = target.selectionEnd == null ? s : target.selectionEnd;
        var ins = c.getAttribute('data-var');
        if (/^[A-Za-z]/.test(ins) && s > 0 && /[A-Za-z0-9_)]$/.test(target.value.slice(0, s))) ins = ' ' + ins;
        target.value = target.value.slice(0, s) + ins + target.value.slice(e2);
        var pos = s + ins.length; target.focus(); target.setSelectionRange(pos, pos);
        target.dispatchEvent(new Event('input'));
      });
    });
    ['rsB0', 'rsB1', 'rsB2'].forEach(function (id, i) {
      $(id).addEventListener('input', function () { draft.bands[i] = Number($(id).value); schedule(); });
    });
    $('rsDpySel').addEventListener('change', function () {
      var v = $('rsDpySel').value;
      if (v === 'other') { $('rsDpy').classList.remove('d-none'); $('rsDpy').focus(); }
      else { draft.dpy = Number(v); $('rsDpy').classList.add('d-none'); $('rsDpy').value = v; }
      schedule();
    });
    $('rsDpy').addEventListener('input', function () { draft.dpy = Number($('rsDpy').value); schedule(); });
    if ($('rsUnit')) $('rsUnit').addEventListener('change', function () { draft.overall.invUnit = $('rsUnit').value; schedule(); });
    $('rsTestOn').addEventListener('input', schedule); $('rsTestAve').addEventListener('input', schedule);

    $('rsReset').onclick = function () { draft = erpRatioClone(ERP_RATIO_DEFAULTS); fillFromDraft(); refreshPreview(); };
    $('rsRevert').onclick = function () { erpRatioRevert(); draft = erpRatioClone(erpRatioGet()); fillFromDraft(); refreshPreview(); toast('Back to the saved settings'); };
    $('rsPreview').onclick = function () {
      if (!validate()) return;
      erpRatioApply(draft, true);
      bootstrap.Modal.getInstance(el).hide();
      toast('Now showing on this page (not saved yet)', 'info');
    };
    $('rsSave').onclick = async function () {
      if (!validate() || !isAdmin()) return;
      var btn = $('rsSave'); btn.disabled = true;
      try {
        var res = await erpRatioSave(draft);
        bootstrap.Modal.getInstance(el).hide();
        toast(res.shared ? '✅ Saved for everyone' : '⚠ Saved on this browser only — run erp-settings.sql in Supabase so others see it too', res.shared ? 'success' : 'warning');
      } catch (e) { toast('Could not save: ' + (e.message || e), 'danger'); }
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

  // ── Column header tooltips (plain words) ────────────────
  function refreshHeaderTitles() {
    var S = erpRatioGet();
    document.querySelectorAll('th').forEach(function (th) {
      var txt = (th.textContent || '').trim();
      var isT = /^Turnover\b/i.test(txt), isI = /^Inventory Ratio\b/i.test(txt);
      if (!isT && !isI) return;
      if (th.dataset.origTitle === undefined) th.dataset.origTitle = th.getAttribute('title') || '';
      var isDef = erpRatioIsDefault(isT ? 'item.turnover' : 'item.invRatio');
      if (isDef) { if (th.dataset.origTitle) th.setAttribute('title', th.dataset.origTitle); return; }
      th.setAttribute('title', (isT ? 'Turnover Ratio per item = ' : 'Inventory Ratio per item (days) = ') +
        erpRatioWords(isT ? S.item.turnover : S.item.invRatio) + '   [Days in a year = ' + S.dpy + ']');
    });
  }

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
