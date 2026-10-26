// ============================================================
// GEMCOR ERP — Net Watch v1.0
//  - Sinusukat kung online / mabagal / offline ang koneksyon
//  - Naglalabas ng maliit na chip: "Maglaro muna" (Break Room)
//  - window.erpNet.state  +  event 'erp:net' {detail:{state, ms}}
//
// Paano nito nalalaman:
//  1) browser online/offline events
//  2) maliit na probe (1 row) sa Supabase kada 45s habang visible ang tab
//     - mabagal = ≥3.5s dalawang sunod, o ≥6s isang beses
//     - offline = 2 sunod na fail/timeout, o sinabi ng browser
//
// Para itago ang chip sa isang page:  window.ERP_NETWATCH_NO_CHIP = true
// (ginagamit sa game page at offline page).
// ============================================================
(function () {
  'use strict';
  if (window.erpNet) return;

  var SLOW_MS = 3500;
  var VERY_SLOW_MS = 6000;
  var TIMEOUT_MS = 8000;
  var PROBE_EVERY = 45000;
  var DISMISS_KEY = 'erp_netchip_dismissed_at';
  var DISMISS_COOLDOWN = 15 * 60 * 1000;
  var GAME_HREF = 'block-blast.html';

  var net = {
    state: (navigator.onLine === false) ? 'offline' : 'online',
    ms: null,
    lastProbe: 0,
    probe: probe
  };
  window.erpNet = net;

  var bad = 0;          // sunod-sunod na masamang probe
  var slowHits = 0;     // sunod-sunod na mabagal na probe
  var probing = false;
  var chip = null;
  var hideTimer = null;

  function set(state, ms) {
    net.ms = (ms == null) ? net.ms : ms;
    if (state === net.state) { updateChip(); return; }
    net.state = state;
    try { window.dispatchEvent(new CustomEvent('erp:net', { detail: { state: state, ms: net.ms } })); } catch (e) {}
    updateChip();
  }

  function canProbe() { return typeof window.erpUrl === 'function' && typeof window.erpHeaders === 'function'; }

  function probe() {
    if (probing) return Promise.resolve(net.state);
    if (navigator.onLine === false) { bad = 2; set('offline'); return Promise.resolve(net.state); }
    if (!canProbe()) return Promise.resolve(net.state);
    probing = true;
    net.lastProbe = Date.now();
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var t0 = Date.now();
    return fetch(window.erpUrl('erp_items') + '?select=id&limit=1', {
      headers: window.erpHeaders(), cache: 'no-store', signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      var ms = Date.now() - t0;
      // 4xx/5xx = may nakausap na server, so hindi offline.
      if (ms >= VERY_SLOW_MS) { slowHits = 2; }
      else if (ms >= SLOW_MS) { slowHits++; }
      else { slowHits = 0; }
      bad = 0;
      set(slowHits >= 2 ? 'slow' : 'online', ms);
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      bad++;
      if (bad >= 2 || navigator.onLine === false) { set('offline'); return; }
      // Unang bagsak: huwag agad mag-conclude. Timeout (8s) = mabagal; iba = subukan ulit agad.
      if (err && err.name === 'AbortError') set('slow');
      setTimeout(probe, 4000);
    }).then(function () { probing = false; return net.state; });
  }

  // ───────── Chip ─────────
  function onGamePage() {
    return !!window.ERP_NETWATCH_NO_CHIP || /block-blast\.html|offline\.html/.test(location.pathname);
  }
  function dismissedRecently() {
    try { var t = +sessionStorage.getItem(DISMISS_KEY) || 0; return t && (Date.now() - t) < DISMISS_COOLDOWN; } catch (e) { return false; }
  }
  function ensureStyles() {
    if (document.getElementById('erpNetChipCss')) return;
    var st = document.createElement('style');
    st.id = 'erpNetChipCss';
    st.textContent =
      '.erp-netchip{position:fixed;left:14px;bottom:14px;z-index:2147483000;max-width:min(360px,calc(100vw - 28px));' +
      'display:flex;align-items:center;gap:10px;padding:10px 10px 10px 14px;border-radius:14px;' +
      'background:#14283f;color:#eef2f7;font:600 13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);animation:erpNetIn .25s ease-out}' +
      '.erp-netchip[data-state="offline"]{border-left:4px solid #e2493e}' +
      '.erp-netchip[data-state="slow"]{border-left:4px solid #f4b81f}' +
      '.erp-netchip[data-state="back"]{border-left:4px solid #33b27a}' +
      '.erp-netchip span{flex:1;min-width:0}' +
      '.erp-netchip a{flex:none;display:inline-flex;align-items:center;gap:6px;text-decoration:none;background:#f4b81f;color:#2b1d00;' +
      'padding:8px 12px;border-radius:9px;font-weight:800;font-size:12.5px}' +
      '.erp-netchip a:hover{background:#ffc93a}' +
      '.erp-netchip a svg{width:16px;height:16px}' +
      '.erp-netchip button{flex:none;appearance:none;border:0;background:transparent;color:#8fa4bf;cursor:pointer;font-size:20px;line-height:1;padding:2px 6px}' +
      '.erp-netchip button:hover{color:#fff}' +
      '@keyframes erpNetIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}' +
      '@media (prefers-reduced-motion:reduce){.erp-netchip{animation:none}}';
    document.head.appendChild(st);
  }
  var PAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11" r=".6" fill="currentColor"/><circle cx="17.5" cy="13" r=".6" fill="currentColor"/><path d="M17.3 6H6.7A4.7 4.7 0 0 0 2 10.7v2.6A3.7 3.7 0 0 0 7.6 16.5L9 15h6l1.4 1.5a3.7 3.7 0 0 0 5.6-3.2v-2.6A4.7 4.7 0 0 0 17.3 6z"/></svg>';

  function removeChip() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
    chip = null;
  }
  function updateChip() {
    if (onGamePage() || !document.body) return;
    var st = net.state;
    if (st === 'online' || st === 'unknown') {
      // may ipinapakita pa bang "offline/slow"? ipakita sandali ang "bumalik na"
      if (chip && chip.getAttribute('data-state') !== 'back') {
        chip.setAttribute('data-state', 'back');
        chip.innerHTML = '<span>Bumalik na ang internet.</span>';
        hideTimer = setTimeout(removeChip, 3000);
      }
      return;
    }
    if (dismissedRecently()) return;
    ensureStyles();
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'erp-netchip';
      chip.setAttribute('role', 'status');
      chip.setAttribute('aria-live', 'polite');
      document.body.appendChild(chip);
    }
    chip.setAttribute('data-state', st);
    chip.innerHTML =
      '<span>' + (st === 'offline' ? 'Walang internet.' : 'Mabagal ang internet.') + ' Maglaro muna habang naghihintay.</span>' +
      '<a href="' + GAME_HREF + '">' + PAD + 'Maglaro</a>' +
      '<button type="button" aria-label="Isara">×</button>';
    chip.querySelector('button').addEventListener('click', function () {
      try { sessionStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {}
      removeChip();
    });
  }

  // ───────── Triggers ─────────
  window.addEventListener('offline', function () { bad = 2; set('offline'); });
  window.addEventListener('online', function () { bad = 0; slowHits = 0; probe(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - net.lastProbe > 15000) probe();
  });
  setInterval(function () {
    if (document.visibilityState === 'visible') probe();
  }, PROBE_EVERY);

  // Unang probe, medyo mamaya para hindi makipag-agawan sa pag-load ng page.
  setTimeout(probe, 4000);
})();
