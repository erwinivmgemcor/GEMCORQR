// ============================================================
// GEMCOR ERP — Form Identity  (v1.0)   [production: New MRIF / New MRS]
// Para hindi malito kung MRIF o MRS ang pini-fillupan:
//   1. Malaking color-coded banner sa taas ng form  (MRIF = amber/REQUEST, MRS = violet/RETURN)
//   2. Kulay na guhit sa tuktok ng page + prefix sa tab title
//   3. "Mali ang form?" na link papunta sa tamang form (same variant: With JO / Manual)
//   4. Bago mag-submit: malinaw na confirmation ("ISASAULI mo ito sa warehouse") na may
//      item list, at option na lumipat sa kabilang form
// Loaded AFTER the page's own script (new-mrif.js, new-mrs.js, ...).
// ============================================================
(function () {
  'use strict';
  var path = location.pathname.toLowerCase();
  var isMrs = /new-mrs/.test(path), isMrif = /new-mrif/.test(path);
  if (!isMrs && !isMrif) return;
  var manual = /-manual/.test(path);

  var T = isMrs ? {
    code: 'MRS', color: '#7c3aed', soft: '#f5f3ff', border: '#ddd6fe', icon: 'bi-arrow-counterclockwise',
    title: 'MRS — RETURN materials',
    what: 'Gamitin ito kung <b>ISASAULI</b> mo sa warehouse ang sobra o hindi nagamit na materyales.',
    flow: 'YOU → WAREHOUSE',
    other: { code: 'MRIF', label: 'Kailangan mo ng materyales?', btn: 'Pumunta sa MRIF (Request)', href: manual ? 'new-mrif-manual.html' : 'new-mrif.html' },
    confirmTitle: 'ISASAULI mo ang mga ito sa warehouse',
    confirmBody: 'Ito ay <b>MRS (Return)</b>. Ang mga item sa ibaba ay <b>ibabalik sa warehouse</b> — hindi ka kukuha ng materyales.',
    yes: 'Oo, isasauli ko — i-submit ang MRS',
    no: 'Hindi, kukuha ako ng materyales → MRIF'
  } : {
    code: 'MRIF', color: '#d97706', soft: '#fffbeb', border: '#fde68a', icon: 'bi-box-arrow-up-right',
    title: 'MRIF — REQUEST materials',
    what: 'Gamitin ito kung <b>KAILANGAN MO</b> ng materyales mula sa warehouse.',
    flow: 'WAREHOUSE → YOU',
    other: { code: 'MRS', label: 'Magsasauli ka ba ng sobra?', btn: 'Pumunta sa MRS (Return)', href: manual ? 'new-mrs-manual.html' : 'new-mrs.html' },
    confirmTitle: 'HIHILINGIN mo ang mga ito sa warehouse',
    confirmBody: 'Ito ay <b>MRIF (Request)</b>. Ang mga item sa ibaba ay <b>ibibigay ng warehouse sa iyo</b> — hindi ito pagsasauli.',
    yes: 'Oo, hihingi ako — i-submit ang MRIF',
    no: 'Hindi, magsasauli ako → MRS'
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ── 1+2: banner, top stripe, title ─────────────────────────
  function inject() {
    if (document.getElementById('erpFormIdentity')) return;
    var st = document.createElement('style'); st.id = 'erpFormIdentityCss';
    st.textContent =
      'body::before{content:"";position:fixed;top:0;left:0;right:0;height:6px;background:' + T.color + ';z-index:2000}' +
      '.erp-container>.erp-card:nth-of-type(2){border-left:6px solid ' + T.color + '}' +
      '#erpFormIdentity{display:flex;gap:16px;align-items:center;flex-wrap:wrap;background:' + T.soft + ';border:2px solid ' + T.border + ';border-left:8px solid ' + T.color + ';border-radius:14px;padding:16px 20px;margin-bottom:16px}' +
      '#erpFormIdentity .fi-ico{width:56px;height:56px;border-radius:50%;background:' + T.color + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.7rem;flex-shrink:0}' +
      '#erpFormIdentity .fi-main{flex:1;min-width:230px}' +
      '#erpFormIdentity .fi-title{font-weight:800;font-size:1.25rem;color:' + T.color + ';letter-spacing:.01em}' +
      '#erpFormIdentity .fi-what{font-size:.92rem;color:#334155;margin-top:2px}' +
      '#erpFormIdentity .fi-flow{display:inline-block;margin-top:6px;font-size:.72rem;font-weight:800;letter-spacing:.06em;color:#fff;background:' + T.color + ';border-radius:999px;padding:3px 12px}' +
      '#erpFormIdentity .fi-wrong{text-align:right;min-width:210px}' +
      '#erpFormIdentity .fi-wrong small{display:block;color:#64748b;font-weight:600;margin-bottom:4px}' +
      '#erpFormIdentity .fi-wrong a{display:inline-block;font-weight:700;font-size:.85rem;padding:8px 14px;border-radius:10px;border:2px solid ' + T.color + ';color:' + T.color + ';background:#fff;text-decoration:none}' +
      '#erpFormIdentity .fi-wrong a:hover{background:' + T.color + ';color:#fff}' +
      '#erpFormIdentity .fi-tip{flex-basis:100%;font-size:.76rem;color:#64748b;margin-top:-4px}' +
      '#erpFiOverlay{position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px}' +
      '#erpFiBox{background:#fff;border-radius:18px;max-width:520px;width:100%;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35);font-family:inherit}' +
      '#erpFiBox .fi-head{background:' + T.color + ';color:#fff;padding:16px 20px;display:flex;gap:12px;align-items:center}' +
      '#erpFiBox .fi-head i{font-size:1.8rem}' +
      '#erpFiBox .fi-head b{font-size:1.05rem;display:block}' +
      '#erpFiBox .fi-head span{font-size:.78rem;opacity:.9}' +
      '#erpFiBox .fi-body{padding:16px 20px;font-size:.92rem;color:#334155}' +
      '#erpFiBox ul{list-style:none;margin:10px 0 0;padding:0;border:1px solid #e2e8f0;border-radius:10px;max-height:190px;overflow:auto}' +
      '#erpFiBox li{display:flex;justify-content:space-between;gap:10px;padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:.84rem}' +
      '#erpFiBox li:last-child{border-bottom:0}' +
      '#erpFiBox li code{color:#1e3a5f;font-weight:700}' +
      '#erpFiBox .fi-foot{padding:4px 20px 18px;display:flex;flex-direction:column;gap:8px}' +
      '#erpFiBox button{border:0;border-radius:10px;padding:11px 14px;font-weight:700;font-size:.9rem;cursor:pointer}' +
      '#erpFiBox .yes{background:' + T.color + ';color:#fff}' +
      '#erpFiBox .no{background:#fff;color:' + T.color + ';border:2px solid ' + T.color + '}' +
      '#erpFiBox .back{background:#f1f5f9;color:#334155}';
    document.head.appendChild(st);

    document.title = '[' + T.code + (isMrs ? ' · RETURN' : ' · REQUEST') + '] ' + document.title.replace(/^\[[^\]]*\]\s*/, '');

    var host = document.querySelector('.erp-container');
    if (!host) return;
    var b = document.createElement('div'); b.id = 'erpFormIdentity';
    b.innerHTML =
      '<div class="fi-ico"><i class="bi ' + T.icon + '"></i></div>' +
      '<div class="fi-main"><div class="fi-title">' + T.title + (manual ? ' <span style="font-weight:600;font-size:.8rem;color:#64748b">(Manual — No JO)</span>' : '') + '</div>' +
        '<div class="fi-what">' + T.what + '</div><span class="fi-flow">' + T.flow + '</span></div>' +
      '<div class="fi-wrong"><small>' + esc(T.other.label) + '</small><a href="' + T.other.href + '"><i class="bi bi-arrow-left-right me-1"></i>' + esc(T.other.btn) + '</a></div>' +
      '<div class="fi-tip"><i class="bi bi-info-circle me-1"></i>Na-submit na at mali ang form? Buksan ang <b>My Requests</b> → <b>Discuss</b> at hilingin sa warehouse na i-cancel ito.</div>';
    host.insertBefore(b, host.firstChild);
  }

  // ── 4: confirmation before submit ──────────────────────────
  function readItems() {
    var out = [];
    document.querySelectorAll('#itemsBody tr').forEach(function (tr) {
      var c = tr.querySelector('.item-code-input'), q = tr.querySelector('.item-qty-input');
      var code = c ? c.value.trim() : '';
      if (!code) return;
      var d = tr.querySelector('[id*="ItemDesc"], .item-desc-input');
      var u = tr.querySelector('select[id*="ItemUnit"], .item-unit-input');
      out.push({ code: code, qty: q ? q.value : '', unit: u ? (u.value || '') : '' });
    });
    return out;
  }

  function ask(items) {
    return new Promise(function (resolve) {
      var ov = document.createElement('div'); ov.id = 'erpFiOverlay';
      var lis = items.slice(0, 30).map(function (i) {
        return '<li><code>' + esc(i.code) + '</code><span>' + esc(i.qty) + ' ' + esc(i.unit) + '</span></li>';
      }).join('') + (items.length > 30 ? '<li><span>… +' + (items.length - 30) + ' pa</span></li>' : '');
      ov.innerHTML =
        '<div id="erpFiBox" role="dialog" aria-modal="true">' +
          '<div class="fi-head"><i class="bi ' + T.icon + '"></i><div><b>' + esc(T.confirmTitle) + '</b><span>' + T.code + ' · ' + items.length + ' item' + (items.length > 1 ? 's' : '') + '</span></div></div>' +
          '<div class="fi-body">' + T.confirmBody + '<ul>' + lis + '</ul></div>' +
          '<div class="fi-foot"><button class="yes" type="button">' + esc(T.yes) + '</button>' +
          '<button class="no" type="button">' + esc(T.no) + '</button>' +
          '<button class="back" type="button">Bumalik sa form</button></div></div>';
      function done(v) { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done('back'); } }
      ov.querySelector('.yes').onclick = function () { done('yes'); };
      ov.querySelector('.no').onclick = function () { done('other'); };
      ov.querySelector('.back').onclick = function () { done('back'); };
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(ov);
      ov.querySelector('.back').focus();           // safe default: Enter never submits by accident
    });
  }

  function wrapSubmit() {
    var name = isMrs ? 'submitMrs' : 'submitMrif';
    var orig = window[name];
    if (typeof orig !== 'function' || orig._fiWrapped) return;
    var wrapped = async function () {
      var items = readItems();
      if (!items.length) return orig.apply(this, arguments);     // let the page show its own validation message
      var ans = await ask(items);
      if (ans === 'back') return;
      if (ans === 'other') { location.href = T.other.href; return; }
      // the page has its own confirm() right after validation — we already asked, so don't ask twice
      var realConfirm = window.confirm, ret;
      window.confirm = function () { return true; };
      try { ret = orig.apply(this, arguments); } finally { window.confirm = realConfirm; }
      return ret;
    };
    wrapped._fiWrapped = true;
    window[name] = wrapped;
  }

  function init() { inject(); wrapSubmit(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  console.log('✅ form-identity.js v1.0 loaded (' + T.code + (manual ? ' manual' : '') + ')');
})();
