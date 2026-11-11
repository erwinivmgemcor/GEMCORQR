// ============================================================
// GEMCOR ERP — Presence (Online / Last seen)  v1.0
// Loaded by erp-nav.js on EVERY page → the user counts as "online"
// as long as any ERP page is open and they are not idle.
//
//   Heartbeat : erp_presence_ping every 30s (+ right away on load / tab focus)
//   Idle      : no mouse / key / touch for 10 min → heartbeat stops → shows offline
//   Logout    : erpPresence.goOffline() → offline immediately
//   Reading   : only pages that call erpPresence.watch() (chat) fetch everyone's status
//
//   erpPresence.get(username) -> { online: bool, lastSeen: ms|0 }
//   erpPresence.label(username) -> 'Online' | 'Last seen 5 min ago' | 'Offline'
//   erpPresence.watch() -> stop()      (fires 'erp-presence-updated' on window)
//
// Needs sql/05_user_presence.sql. Without it everything silently does nothing.
// ============================================================
(function () {
  'use strict';
  if (window.erpPresence) return;

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var ME = ls('ivm_username') || '';
  if (!ME || typeof window.erpUrl !== 'function') return;

  var PING_MS    = 30 * 1000;        // heartbeat
  var FETCH_MS   = 15 * 1000;        // how often a watching page re-reads everyone
  var IDLE_MS    = 10 * 60 * 1000;   // no activity for this long → stop heartbeat
  var ONLINE_MS  = 90 * 1000;        // seen within this window = online (3 missed beats of slack)

  var map = {};                      // USERNAME -> { s: ms, on: bool }
  var offset = 0;                    // serverNow - clientNow  (so wrong PC clocks don't matter)
  var lastActivity = Date.now();
  var pingTimer = null, fetchTimer = null, watchers = 0, fetching = false;

  function up(u) { return String(u || '').toUpperCase(); }
  function stillLoggedIn() { return up(ls('ivm_username')) === up(ME); }

  async function rpc(name, body, opts) {
    var r = await fetch(window.erpUrl('rpc/' + name), Object.assign(
      { method: 'POST', headers: window.erpHeaders(), body: JSON.stringify(body || {}), cache: 'no-store' },
      opts || {}));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  }

  // ── heartbeat ──────────────────────────────────────────────
  function isIdle() { return Date.now() - lastActivity > IDLE_MS; }

  async function ping() {
    if (!stillLoggedIn()) { stop(); return; }
    if (isIdle() || navigator.onLine === false) return;
    try { await rpc('erp_presence_ping', { p_username: ME }); } catch (e) { /* offline or SQL not installed */ }
  }

  function markActive() {
    var wasIdle = isIdle();
    lastActivity = Date.now();
    if (wasIdle) ping();                       // came back from idle → online again right away
  }

  function stop() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (fetchTimer) { clearInterval(fetchTimer); fetchTimer = null; }
  }

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(function (ev) {
    window.addEventListener(ev, function () {
      // throttle: at most once per 5s
      if (Date.now() - lastActivity > 5000) markActive();
    }, { passive: true });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    markActive(); ping();
    if (watchers) fetchAll();
  });
  window.addEventListener('online', function () { ping(); if (watchers) fetchAll(); });

  // ── reading everyone's status ──────────────────────────────
  async function fetchAll() {
    if (fetching) return; fetching = true;
    try {
      var r = await rpc('erp_get_presence', {});
      var data = await r.json();
      if (data && data.users) {
        if (data.now) offset = new Date(data.now).getTime() - Date.now();
        var next = {};
        Object.keys(data.users).forEach(function (u) {
          var e = data.users[u] || {};
          next[up(u)] = { s: e.s ? new Date(e.s).getTime() : 0, on: e.on !== false };
        });
        map = next;
        window.dispatchEvent(new CustomEvent('erp-presence-updated'));
      }
    } catch (e) { /* not installed / offline → everybody just shows as offline */ }
    fetching = false;
  }

  function watch() {
    watchers++;
    fetchAll();
    if (!fetchTimer) fetchTimer = setInterval(function () { if (!document.hidden) fetchAll(); }, FETCH_MS);
    var done = false;
    return function unwatch() {
      if (done) return; done = true;
      watchers = Math.max(0, watchers - 1);
      if (!watchers && fetchTimer) { clearInterval(fetchTimer); fetchTimer = null; }
    };
  }

  // ── lookups ────────────────────────────────────────────────
  function get(username) {
    var u = up(username);
    if (u === up(ME)) return { online: true, lastSeen: Date.now() };     // you are always online to yourself
    var e = map[u];
    if (!e || !e.s) return { online: false, lastSeen: 0 };
    var age = (Date.now() + offset) - e.s;
    return { online: !!e.on && age < ONLINE_MS, lastSeen: e.s - offset };   // lastSeen in client-clock ms
  }

  function ago(ms) {
    var diff = Math.max(0, Date.now() - ms);
    var m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (h < 24) return h + (h === 1 ? ' hr ago' : ' hrs ago');
    if (d === 1) return 'yesterday at ' + clock(ms);
    if (d < 7) return d + ' days ago';
    var x = new Date(ms), mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return mo[x.getMonth()] + ' ' + x.getDate();
  }
  function clock(ms) {
    var d = new Date(ms), h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    return ((h % 12) || 12) + ':' + m + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  function label(username) {
    var p = get(username);
    if (p.online) return 'Online';
    return p.lastSeen ? 'Last seen ' + ago(p.lastSeen) : 'Offline';
  }

  // ── logout ─────────────────────────────────────────────────
  function goOffline() {
    stop();
    try { rpc('erp_presence_offline', { p_username: ME }, { keepalive: true }).catch(function () {}); } catch (e) {}
  }

  // ── start ──────────────────────────────────────────────────
  ping();
  pingTimer = setInterval(ping, PING_MS);

  window.erpPresence = { get: get, label: label, watch: watch, goOffline: goOffline, refresh: fetchAll };
  console.log('✅ erp-presence.js v1.0 loaded');
})();
