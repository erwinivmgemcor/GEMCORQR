// ============================================================
// GEMCOR ERP — Notification Alerts  v1.0
// Sound + popup toast + tab-title badge + optional desktop alert.
//
// notifications.js hands every fresh poll to erpAlerts.process().
// This file decides which items are NEW for this user, then alerts.
//
//   warehouse  hears:  a new MRIF / MRS request from production
//   production hears:  their request was served (completed / partial)
//
// Sounds are synthesized with Web Audio, so there are no audio files.
// ============================================================
(function () {
  'use strict';
  if (window.erpAlerts) return;

  var CFG = {
    // notification type (from notifications.js) -> sound name.
    // A type that is missing here never alerts; it stays bell-only (e.g. new_prf).
    sounds: { new_request: 'request', completed: 'done', partial: 'partial' },
    summaryAbove: 3,     // more fresh items than this => one summary toast per type
    maxToasts: 4,
    toastMs: 9000,
    seenCap: 300,
    pendingSoundMs: 120000   // a sound blocked by the browser still plays if unlocked within this time
  };

  // ── storage (never throws) ───────────────────────────────
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function username() { return lsGet('ivm_username') || ''; }
  function role() { return lsGet('ivm_userRole') || ''; }

  function isMuted() { return lsGet('ivm_sound_muted') === '1'; }
  function volume() {
    var v = parseFloat(lsGet('ivm_sound_vol'));
    return isNaN(v) ? 0.7 : Math.min(1, Math.max(0, v));
  }

  // ── sound engine ─────────────────────────────────────────
  var ctx = null, pendingSound = null, pendingAt = 0;

  function getCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; }
    return ctx;
  }

  function tone(freq, start, dur, level) {
    var c = ctx, t = c.currentTime + start;
    var main = c.createOscillator(), over = c.createOscillator();
    var gain = c.createGain(), overGain = c.createGain();
    main.type = 'sine'; main.frequency.value = freq;
    over.type = 'sine'; over.frequency.value = freq * 2.01;   // slight detune = bell-like shimmer
    overGain.gain.value = 0.25;
    main.connect(gain); over.connect(overGain); overGain.connect(gain); gain.connect(c.destination);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    main.start(t); over.start(t);
    main.stop(t + dur + 0.05); over.stop(t + dur + 0.05);
  }

  // [frequency Hz, start s, duration s]
  var PATTERNS = {
    request: [[880, 0, 0.7], [659.25, 0.22, 0.95], [880, 1.3, 0.7], [659.25, 1.52, 0.95]],   // door-bell, twice: hard to miss
    done:    [[523.25, 0, 0.5], [659.25, 0.12, 0.5], [783.99, 0.24, 0.5], [1046.5, 0.36, 0.95]], // rising chime = good news
    partial: [[783.99, 0, 0.5], [987.77, 0.16, 0.85]],                                         // softer two-note
    message: [[1174.66, 0, 0.22], [1567.98, 0.13, 0.5], [1174.66, 0.9, 0.22], [1567.98, 1.03, 0.5]]   // chat: bright two-note "pop", repeated once
  };

  function playNow(name) {
    var c = getCtx(), pat = PATTERNS[name];
    if (!c || !pat || c.state !== 'running') return false;
    var level = 0.42 * volume();
    if (level <= 0) return false;
    pat.forEach(function (n) { tone(n[0], n[1], n[2], level); });
    return true;
  }

  function play(name) {
    if (!name || isMuted()) return false;
    if (playNow(name)) return true;
    // The browser has not allowed audio yet (needs one click/key on the page).
    pendingSound = name; pendingAt = Date.now();
    showHint(true);
    return false;
  }

  function onUnlocked() {
    showHint(false);
    if (pendingSound && Date.now() - pendingAt < CFG.pendingSoundMs) {
      var n = pendingSound; pendingSound = null; playNow(n);
    }
    pendingSound = null;
  }

  function unlock() {
    var c = getCtx();
    if (!c) return;
    if (c.state === 'running') { onUnlocked(); return; }
    try {
      var p = c.resume();
      if (p && p.then) p.then(function () { if (c.state === 'running') onUnlocked(); }, function () {});
    } catch (e) {}
  }

  ['pointerdown', 'keydown', 'touchstart', 'click'].forEach(function (ev) {
    document.addEventListener(ev, unlock, { capture: true, passive: true });
  });

  // ── styles ───────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById('erpAlertStyle')) return;
    var st = document.createElement('style');
    st.id = 'erpAlertStyle';
    st.textContent =
      '#erpAlertHost{position:fixed;top:70px;right:16px;z-index:99998;display:flex;flex-direction:column;gap:10px;width:350px;max-width:calc(100vw - 24px);pointer-events:none;}' +
      '.erp-alert{pointer-events:auto;position:relative;overflow:hidden;display:flex;gap:12px;align-items:flex-start;background:#fff;border-radius:12px;padding:12px 34px 14px 12px;' +
        'box-shadow:0 12px 32px rgba(15,23,42,.22),0 2px 6px rgba(15,23,42,.08);border-left:5px solid var(--ac,#3b82f6);cursor:pointer;' +
        'animation:erpAlertIn .35s cubic-bezier(.2,.9,.3,1.2);}' +
      '.erp-alert.out{animation:erpAlertOut .25s ease forwards;}' +
      '.erp-alert:hover{box-shadow:0 14px 36px rgba(15,23,42,.3);}' +
      '.erp-alert-ico{flex:0 0 auto;width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;background:color-mix(in srgb,var(--ac,#3b82f6) 14%,#fff);color:var(--ac,#3b82f6);}' +
      '.erp-alert-body{min-width:0;flex:1;}' +
      '.erp-alert-title{font-weight:800;font-size:.9rem;color:#0f172a;line-height:1.25;}' +
      '.erp-alert-sub{font-size:.8rem;color:#334155;margin-top:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}' +
      '.erp-alert-meta{font-size:.74rem;color:#64748b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.erp-alert-x{position:absolute;top:6px;right:8px;border:0;background:none;color:#94a3b8;font-size:1.25rem;line-height:1;cursor:pointer;padding:2px 4px;}' +
      '.erp-alert-x:hover{color:#0f172a;}' +
      '.erp-alert-bar{position:absolute;left:0;bottom:0;height:3px;background:var(--ac,#3b82f6);opacity:.55;width:100%;transform-origin:left;animation:erpAlertBar linear forwards;}' +
      '.erp-alert:hover .erp-alert-bar{animation-play-state:paused;}' +
      '@keyframes erpAlertIn{from{opacity:0;transform:translateX(40px) scale(.96);}to{opacity:1;transform:none;}}' +
      '@keyframes erpAlertOut{to{opacity:0;transform:translateX(40px);}}' +
      '@keyframes erpAlertBar{from{transform:scaleX(1);}to{transform:scaleX(0);}}' +
      '#erpAlertHint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99997;background:#1e293b;color:#fff;padding:9px 16px;border-radius:999px;font-size:.82rem;box-shadow:0 8px 24px rgba(0,0,0,.3);cursor:pointer;display:none;}' +
      '#erpAlertHint.show{display:block;animation:erpAlertIn .3s ease;}' +
      '.erp-notif-settings{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 12px;border-top:1px solid #e2e8f0;background:#f8fafc;}' +
      '.erp-notif-settings button{border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:4px 10px;font-size:.72rem;font-weight:600;color:#334155;cursor:pointer;}' +
      '.erp-notif-settings button:hover{background:#eef2f8;}' +
      '.erp-notif-settings .off{color:#b91c1c;}' +
      '.erp-notif-settings small{flex-basis:100%;font-size:.68rem;color:#b45309;}' +
      '@media (prefers-reduced-motion:reduce){.erp-alert,.erp-alert-bar{animation:none !important;}}';
    document.head.appendChild(st);
  }

  // ── "click to enable sound" hint ─────────────────────────
  function showHint(on) {
    injectStyle();
    var el = document.getElementById('erpAlertHint');
    if (!el) {
      if (!on) return;
      el = document.createElement('div');
      el.id = 'erpAlertHint';
      el.textContent = '🔇 Click anywhere to enable notification sound';
      el.addEventListener('click', unlock);
      document.body.appendChild(el);
    }
    el.classList.toggle('show', !!on);
  }

  // ── toasts ───────────────────────────────────────────────
  function host() {
    injectStyle();
    var h = document.getElementById('erpAlertHost');
    if (!h) {
      h = document.createElement('div');
      h.id = 'erpAlertHost';
      h.setAttribute('role', 'status');
      h.setAttribute('aria-live', 'polite');
      document.body.appendChild(h);
    }
    return h;
  }

  function go(n) {
    if (typeof handleNotifClick === 'function') handleNotifClick(n.link, n.docNo);
    else if (n.link && n.link !== '#') window.location.href = n.link;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function showToast(n) {
    var h = host();
    var t = el('div', 'erp-alert');
    t.style.setProperty('--ac', n.iconColor || '#3b82f6');
    t.setAttribute('data-alert-id', n.id || '');

    var ico = el('div', 'erp-alert-ico');
    ico.appendChild(el('i', 'bi ' + (n.icon || 'bi-bell-fill')));
    var body = el('div', 'erp-alert-body');
    body.appendChild(el('div', 'erp-alert-title', n.title));
    if (n.subtitle) body.appendChild(el('div', 'erp-alert-sub', n.subtitle));
    if (n.meta) body.appendChild(el('div', 'erp-alert-meta', n.meta));
    var x = el('button', 'erp-alert-x', '×');
    x.type = 'button'; x.setAttribute('aria-label', 'Dismiss');
    var bar = el('div', 'erp-alert-bar');
    bar.style.animationDuration = CFG.toastMs + 'ms';

    t.appendChild(ico); t.appendChild(body); t.appendChild(x); t.appendChild(bar);

    var closed = false;
    function close() {
      if (closed) return; closed = true;
      t.classList.add('out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }
    x.addEventListener('click', function (e) { e.stopPropagation(); close(); });
    t.addEventListener('click', function () { close(); go(n); });
    bar.addEventListener('animationend', close);

    h.insertBefore(t, h.firstChild);                 // newest on top
    var all = h.querySelectorAll('.erp-alert:not(.out)');
    for (var i = CFG.maxToasts; i < all.length; i++) {
      all[i].classList.add('out');
      (function (node) { setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 260); })(all[i]);
    }
    return t;
  }

  // ── tab title badge + desktop notification ───────────────
  var baseTitle = document.title, titleCount = 0;
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { titleCount = 0; document.title = baseTitle; }
  });

  function bumpTitle(count, label) {
    if (!document.hidden) return;
    if (titleCount === 0) baseTitle = document.title;
    titleCount += count;
    document.title = '(' + titleCount + ') ' + label + ' — ' + baseTitle;
  }

  function osNotify(n) {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      var body = [n.subtitle, n.meta].filter(Boolean).join(' · ');
      var no = new Notification(n.title, { body: body, tag: n.id || n.title, icon: '../gemcor-logo.png' });
      no.onclick = function () { try { window.focus(); no.close(); } catch (e) {} go(n); };
    } catch (e) { /* some browsers only allow it from a service worker */ }
  }

  // ── detection + dispatch ─────────────────────────────────
  var SOUND_ORDER = ['request', 'done', 'partial'];
  function strongest(items) {
    var best = null;
    items.forEach(function (n) {
      var s = CFG.sounds[n.type];
      if (s && (best === null || SOUND_ORDER.indexOf(s) < SOUND_ORDER.indexOf(best))) best = s;
    });
    return best;
  }

  function summarize(items) {
    var groups = {}, order = [];
    items.forEach(function (n) { if (!groups[n.type]) { groups[n.type] = []; order.push(n.type); } groups[n.type].push(n); });
    return order.map(function (type) {
      var g = groups[type], first = g[0], c = g.length;
      var label = type === 'new_request' ? c + ' new requests'
                : type === 'completed'   ? c + ' requests served'
                : c + ' requests partially served';
      return { id: 'sum_' + type, type: type, icon: first.icon, iconColor: first.iconColor,
               title: label, subtitle: '', meta: 'Click to view', link: first.link, docNo: '' };
    });
  }

  function dispatch(items) {
    var shown = items.length > CFG.summaryAbove ? summarize(items) : items;
    shown.forEach(function (n) { showToast(n); osNotify(n); });
    bumpTitle(items.length, shown[0].title);
    play(strongest(items));
  }

  // Returns the items that were new. The very first call for a user only records a baseline.
  function process(list) {
    var u = username();
    if (!u || !list) return [];
    var key = 'ivm_notif_seen_' + u;
    var raw = lsGet(key), first = raw === null, seen = [];
    if (raw) { try { seen = JSON.parse(raw) || []; } catch (e) { seen = []; } }

    var set = {};
    seen.forEach(function (id) { set[id] = 1; });
    var fresh = [];
    list.forEach(function (n) {
      if (set[n.id]) return;
      set[n.id] = 1; seen.push(n.id);
      if (CFG.sounds[n.type]) fresh.push(n);
    });
    if (seen.length > CFG.seenCap) seen = seen.slice(-CFG.seenCap);
    lsSet(key, JSON.stringify(seen));

    if (first || !fresh.length) return [];
    dispatch(fresh);
    return fresh;
  }

  // ── bell-dropdown settings row ───────────────────────────
  function settingsHtml() {
    var muted = isMuted();
    var canDesktop = 'Notification' in window && Notification.permission === 'default';
    var c = getCtx();
    var blocked = !muted && c && c.state !== 'running';
    return '<div class="erp-notif-settings">' +
      '<button type="button" onclick="erpAlerts.toggleMute(event)" title="Turn notification sound ' + (muted ? 'on' : 'off') + '">' +
        '<i class="bi ' + (muted ? 'bi-volume-mute-fill off' : 'bi-volume-up-fill') + '"></i> Sound ' + (muted ? 'off' : 'on') + '</button>' +
      '<button type="button" onclick="erpAlerts.test(event)"><i class="bi bi-play-circle"></i> Test</button>' +
      (canDesktop ? '<button type="button" onclick="erpAlerts.enableDesktop(event)"><i class="bi bi-window-desktop"></i> Desktop alerts</button>' : '') +
      (blocked ? '<small>Sound is waiting for a click on this page.</small>' : '') +
    '</div>';
  }

  function refreshDropdown() { if (typeof renderDropdown === 'function') renderDropdown(); }

  function toggleMute(e) {
    if (e) e.stopPropagation();
    lsSet('ivm_sound_muted', isMuted() ? '0' : '1');
    if (!isMuted()) test();
    refreshDropdown();
  }

  function test(e) {
    if (e) e.stopPropagation();
    unlock();
    var r = role();
    var sample = r === 'production'
      ? { id: 'test', type: 'completed', icon: 'bi-check-circle-fill', iconColor: '#10b981', title: 'Request Served!', subtitle: 'MRIF-TEST-0001', meta: 'Sample notification', link: '#', docNo: '' }
      : { id: 'test', type: 'new_request', icon: 'bi-file-earmark-plus', iconColor: '#f59e0b', title: 'New MRIF', subtitle: 'MRIF-TEST-0001', meta: 'Sample notification', link: '#', docNo: '' };
    showToast(sample);
    play(CFG.sounds[sample.type]);
  }

  function enableDesktop(e) {
    if (e) e.stopPropagation();
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(refreshDropdown, refreshDropdown);
  }

  window.erpAlerts = {
    process: process, play: play, test: test, toggleMute: toggleMute,
    enableDesktop: enableDesktop, settingsHtml: settingsHtml,
    isMuted: isMuted, config: CFG, _unlock: unlock
  };
  console.log('✅ notif-alerts.js v1.1 loaded');
})();
