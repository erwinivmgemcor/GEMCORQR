// ============================================================
// GEMCOR ERP — Avatar cache  v1.0
// Gives chat (and popups) everybody's profile picture.
//   erpAvatars.html(username, fullname)  -> <img> or initials (HTML string)
//   erpAvatars.refresh(force)            -> sync from server (cheap: versions first)
// Pictures are shrunk to 96px thumbnails and kept in localStorage.
// Needs 04_chat_avatars.sql; without it everyone simply shows initials.
// ============================================================
(function () {
  'use strict';
  if (window.erpAvatars) return;

  var KEY = 'ivm_avc_v1', LAST = 'ivm_avc_last', EVERY = 5 * 60 * 1000, THUMB = 96;
  var cache = {};     // USERNAME -> { t: version, a: dataUrl|'' }
  var busy = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function up(u) { return String(u || '').toUpperCase(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  try { cache = JSON.parse(lsGet(KEY) || '{}') || {}; } catch (e) { cache = {}; }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); }
    catch (e) { // quota: drop everything but keep working in memory
      try { localStorage.removeItem(KEY); } catch (e2) {}
    }
  }

  function initials(name) {
    var p = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0].substring(0, 2)).toUpperCase();
  }

  function get(username) {
    var u = up(username);
    if (u && u === up(lsGet('ivm_username'))) return lsGet('ivm_avatar') || '';
    var c = cache[u];
    return (c && c.a) || '';
  }

  function html(username, fullname) {
    var a = get(username);
    return /^data:image\//.test(a) ? '<img src="' + a.replace(/"/g, '') + '" alt="">' : esc(initials(fullname || username));
  }

  function thumb(dataUrl) {
    return new Promise(function (res) {
      var i = new Image();
      i.onload = function () {
        try {
          var c = document.createElement('canvas'); c.width = c.height = THUMB;
          var x = c.getContext('2d'), s = Math.min(i.naturalWidth, i.naturalHeight);
          x.drawImage(i, (i.naturalWidth - s) / 2, (i.naturalHeight - s) / 2, s, s, 0, 0, THUMB, THUMB);
          res(c.toDataURL('image/jpeg', 0.82));
        } catch (e) { res(dataUrl); }
      };
      i.onerror = function () { res(''); };
      i.src = dataUrl;
    });
  }

  async function rpc(name, body) {
    var r = await fetch(window.erpUrl('rpc/' + name), {
      method: 'POST', headers: window.erpHeaders(), body: JSON.stringify(body || {}), cache: 'no-store'
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function refresh(force) {
    if (busy) return busy;
    var last = parseInt(lsGet(LAST) || '0', 10);
    if (!force && Date.now() - last < EVERY && Object.keys(cache).length) return Promise.resolve(false);
    busy = (async function () {
      var changed = false;
      try {
        var versions = await rpc('get_avatar_versions') || {};
        var need = [];
        Object.keys(versions).forEach(function (u) {
          if (!cache[u] || cache[u].t !== versions[u]) need.push(u);
        });
        Object.keys(cache).forEach(function (u) {          // photo removed on the server
          if (!versions[u] && cache[u].a) { cache[u] = { t: 0, a: '' }; changed = true; }
        });
        for (var i = 0; i < need.length; i += 20) {
          var batch = need.slice(i, i + 20);
          var imgs = await rpc('get_user_avatars', { p_usernames: batch }) || {};
          for (var j = 0; j < batch.length; j++) {
            var u = batch[j], src = imgs[u];
            cache[u] = { t: versions[u], a: src ? await thumb(src) : '' };
            changed = true;
          }
        }
        lsSet(LAST, String(Date.now()));
        if (changed) { save(); window.dispatchEvent(new CustomEvent('erp-avatars-updated')); }
      } catch (e) { /* function not installed yet, or offline: initials are shown */ }
      busy = null;
      return changed;
    })();
    return busy;
  }

  window.erpAvatars = { get: get, html: html, initials: initials, refresh: refresh };
  console.log('✅ erp-avatars.js v1.0 loaded');
})();
