// ============================================================
// GEMCOR ERP — Profile & Settings window  v1.0
//   • Profile picture (upload + crop)
//   • Preferences (notification sound, volume, sidebar)
//   • Change own password
// Loaded on demand by erp-nav.js when the user clicks "Settings".
// Needs: erp-config.js (erpUrl / erpHeaders) and 03_user_profile.sql
// ============================================================
(function () {
  'use strict';
  if (window.erpProfile) return;

  var K_AVATAR = 'ivm_avatar';
  var K_MUTED = 'ivm_sound_muted';
  var K_VOL = 'ivm_sound_vol';
  var K_SIDEBAR = 'erp_sidebar_collapsed';
  var CROP = 280;      // on-screen crop viewport (px)
  var OUT = 256;       // saved avatar size (px)

  // ── helpers ────────────────────────────────────────────────
  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(id) { return document.getElementById(id); }
  function toast(msg, type) {
    if (typeof window.erpShowToast === 'function') window.erpShowToast(msg, type || 'success');
  }
  function me() {
    var roles = [];
    try { roles = JSON.parse(ls('ivm_allowedRoles') || '[]'); } catch (e) {}
    var fullname = ls('ivm_userFullname') || ls('ivm_username') || '';
    var parts = fullname.trim().split(/\s+/);
    var initials = parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]) : fullname.substring(0, 2);
    return {
      username: ls('ivm_username') || '',
      fullname: fullname,
      role: ls('ivm_userRole') || '',
      roles: roles,
      department: ls('ivm_userDepartment') || '',
      isAdmin: ls('ivm_isAdmin') === 'true',
      initials: (initials || '?').toUpperCase()
    };
  }

  async function rpc(name, body) {
    var res = await fetch(window.erpUrl('rpc/' + name), {
      method: 'POST', headers: window.erpHeaders(), body: JSON.stringify(body), cache: 'no-store'
    });
    if (!res.ok) {
      var txt = '';
      try { txt = await res.text(); } catch (e) {}
      if (res.status === 404 || /Could not find the function/i.test(txt)) {
        throw new Error('Database function missing — run 03_user_profile.sql in Supabase first.');
      }
      throw new Error('Server error ' + res.status);
    }
    return res.json();
  }

  // ── preferences (local + synced) ───────────────────────────
  function readPrefs() {
    var vol = parseFloat(ls(K_VOL));
    return {
      sound: ls(K_MUTED) !== '1',
      volume: isNaN(vol) ? 0.7 : Math.min(1, Math.max(0, vol)),
      sidebarCollapsed: ls(K_SIDEBAR) === 'true'
    };
  }
  function applyPrefsLocal(p) {
    if (!p) return;
    if (typeof p.sound === 'boolean') lsSet(K_MUTED, p.sound ? '0' : '1');
    if (typeof p.volume === 'number') lsSet(K_VOL, String(p.volume));
    if (typeof p.sidebarCollapsed === 'boolean') {
      lsSet(K_SIDEBAR, String(p.sidebarCollapsed));
      var sb = document.getElementById('erpSidebar');
      if (sb) {
        sb.classList.toggle('collapsed', p.sidebarCollapsed);
        document.body.classList.toggle('erp-sidebar-collapsed', p.sidebarCollapsed);
        var ic = sb.querySelector('.erp-sidebar-toggle i');
        if (ic) ic.className = p.sidebarCollapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-left';
      }
    }
  }

  function applyAvatar() {
    if (typeof window.erpApplyAvatar === 'function') window.erpApplyAvatar();
  }

  // ── state ──────────────────────────────────────────────────
  var S = { open: false, avatarDraft: undefined, busy: false };
  // avatarDraft: undefined = unchanged, string = new data URL, null = remove

  function avatarHtml(src, initials) {
    return src ? '<img src="' + esc(src) + '" alt="">' : esc(initials);
  }

  // ── main modal ─────────────────────────────────────────────
  function ensureCss() {
    if (document.getElementById('epfCss')) return;
    var l = document.createElement('link');
    l.id = 'epfCss'; l.rel = 'stylesheet'; l.href = 'erp-profile.css';
    document.head.appendChild(l);
  }

  function open(tab) {
    if (S.open) return;
    var u = me();
    if (!u.username) return;
    ensureCss();
    S.open = true; S.avatarDraft = undefined;
    var p = readPrefs();
    var avatar = ls(K_AVATAR);

    var ov = document.createElement('div');
    ov.className = 'epf-overlay'; ov.id = 'epfOverlay';
    ov.innerHTML =
      '<div class="epf-modal" role="dialog" aria-modal="true" aria-label="Settings">' +
        '<div class="epf-head"><h2><i class="bi bi-gear"></i> Settings</h2>' +
          '<button class="epf-x" type="button" data-epf="close" aria-label="Close">&times;</button></div>' +
        '<div class="epf-tabs">' +
          '<button class="epf-tab active" type="button" data-tab="profile"><i class="bi bi-person-circle"></i> Profile</button>' +
          '<button class="epf-tab" type="button" data-tab="prefs"><i class="bi bi-sliders"></i> Preferences</button>' +
          '<button class="epf-tab" type="button" data-tab="password"><i class="bi bi-key"></i> Password</button>' +
        '</div>' +
        '<div class="epf-body">' +

          // ── Profile
          '<div class="epf-pane active" data-pane="profile">' +
            '<div class="epf-avatar-row">' +
              '<div class="epf-avatar" id="epfAvatar">' + avatarHtml(avatar, u.initials) + '</div>' +
              '<div class="epf-avatar-actions">' +
                '<button class="epf-btn" type="button" data-epf="pick"><i class="bi bi-camera"></i> Upload photo</button>' +
                '<button class="epf-btn danger" type="button" data-epf="remove" id="epfRemove"' + (avatar ? '' : ' style="display:none"') + '><i class="bi bi-trash"></i> Remove</button>' +
                '<div class="epf-hint">JPG, PNG or WebP. You can zoom and position it before saving.</div>' +
              '</div>' +
              '<input type="file" id="epfFile" accept="image/png,image/jpeg,image/webp" hidden>' +
            '</div>' +
            '<div class="epf-grid">' +
              '<div class="epf-field"><label>Full name</label><div class="epf-ro">' + esc(u.fullname) + '</div></div>' +
              '<div class="epf-field"><label>Username</label><div class="epf-ro">' + esc(u.username) + '</div></div>' +
              '<div class="epf-field"><label>Department</label><div class="epf-ro">' + esc(u.department || '—') + '</div></div>' +
              '<div class="epf-field"><label>Access</label><div class="epf-ro">' +
                esc((u.roles.length ? u.roles : [u.role]).join(', ')) + (u.isAdmin ? ' · admin' : '') + '</div></div>' +
            '</div>' +
            '<div class="epf-hint" style="margin-top:10px">Name and department are managed by an administrator.</div>' +
            '<div class="epf-msg" id="epfMsgProfile"></div>' +
            '<div style="display:flex;justify-content:flex-end;margin-top:14px">' +
              '<button class="epf-btn primary" type="button" data-epf="saveProfile" id="epfSaveProfile" disabled><i class="bi bi-check2"></i> Save photo</button>' +
            '</div>' +
          '</div>' +

          // ── Preferences
          '<div class="epf-pane" data-pane="prefs">' +
            '<div class="epf-pref"><div><b>Notification sound</b><small>Play a sound when a request arrives or is served.</small></div>' +
              '<label class="epf-switch"><input type="checkbox" id="epfSound"' + (p.sound ? ' checked' : '') + '><i></i></label></div>' +
            '<div class="epf-pref"><div><b>Volume</b><small>Applies to notification sounds.</small></div>' +
              '<div style="display:flex;align-items:center;gap:8px"><input type="range" class="epf-range" id="epfVol" min="0" max="100" value="' + Math.round(p.volume * 100) + '">' +
              '<button class="epf-btn" type="button" data-epf="testSound"><i class="bi bi-play-circle"></i> Test</button></div></div>' +
            '<div class="epf-pref"><div><b>Collapse sidebar</b><small>Keep the left menu in its compact form.</small></div>' +
              '<label class="epf-switch"><input type="checkbox" id="epfSidebar"' + (p.sidebarCollapsed ? ' checked' : '') + '><i></i></label></div>' +
            '<div class="epf-hint" style="margin-top:10px">Your preferences follow you to other computers when you sign in.</div>' +
            '<div class="epf-msg" id="epfMsgPrefs"></div>' +
            '<div style="display:flex;justify-content:flex-end;margin-top:14px">' +
              '<button class="epf-btn primary" type="button" data-epf="savePrefs" id="epfSavePrefs"><i class="bi bi-check2"></i> Save preferences</button>' +
            '</div>' +
          '</div>' +

          // ── Password
          '<div class="epf-pane" data-pane="password">' +
            '<form class="epf-pwstack" id="epfPwForm" autocomplete="off">' +
              '<input type="text" value="' + esc(u.username) + '" autocomplete="username" hidden>' +
              pwField('epfOld', 'Current password', 'current-password') +
              '<div>' + pwField('epfNew', 'New password', 'new-password') +
                '<div class="epf-meter"><span id="epfMeter"></span></div><div class="epf-meter-label" id="epfMeterLbl">At least 6 characters</div></div>' +
              pwField('epfNew2', 'Confirm new password', 'new-password') +
              '<div class="epf-msg" id="epfMsgPw"></div>' +
              '<div style="display:flex;justify-content:flex-end">' +
                '<button class="epf-btn primary" type="submit" id="epfSavePw"><i class="bi bi-shield-lock"></i> Change password</button>' +
              '</div>' +
            '</form>' +
          '</div>' +

        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    bind(ov, u);
    if (tab) switchTab(tab);

    // refresh from server in the background
    loadRemote().then(function (r) {
      if (!r || !S.open) return;
      var av = $('epfAvatar');
      if (av && S.avatarDraft === undefined) {
        av.innerHTML = avatarHtml(r.avatar, me().initials);
        var rm = $('epfRemove'); if (rm) rm.style.display = r.avatar ? '' : 'none';
      }
    });
  }

  function pwField(id, label, ac) {
    return '<div class="epf-field"><label for="' + id + '">' + label + '</label>' +
      '<div class="epf-pw"><input class="epf-input" type="password" id="' + id + '" autocomplete="' + ac + '">' +
      '<button type="button" tabindex="-1" data-epf="eye" data-for="' + id + '" aria-label="Show password"><i class="bi bi-eye"></i></button></div></div>';
  }

  function close() {
    var ov = $('epfOverlay'); if (ov) ov.remove();
    S.open = false; S.avatarDraft = undefined;
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    if ($('epfCropOverlay')) { closeCrop(); e.stopPropagation(); return; }
    if (S.open) { close(); e.stopPropagation(); }
  }

  function switchTab(name) {
    var ov = $('epfOverlay'); if (!ov) return;
    ov.querySelectorAll('.epf-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    ov.querySelectorAll('.epf-pane').forEach(function (p) { p.classList.toggle('active', p.dataset.pane === name); });
  }

  function msg(id, text, kind) {
    var el = $(id); if (!el) return;
    el.className = 'epf-msg' + (text ? ' show ' + (kind || 'err') : '');
    el.textContent = text || '';
  }

  function bind(ov, u) {
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    ov.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tab],[data-epf]'); if (!t) return;
      if (t.dataset.tab) return switchTab(t.dataset.tab);
      var a = t.dataset.epf;
      if (a === 'close') close();
      else if (a === 'pick') $('epfFile').click();
      else if (a === 'remove') draftAvatar(null, u);
      else if (a === 'saveProfile') saveProfile();
      else if (a === 'savePrefs') savePrefs();
      else if (a === 'testSound') testSound();
      else if (a === 'eye') {
        var inp = $(t.dataset.for); var show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        t.querySelector('i').className = show ? 'bi bi-eye-slash' : 'bi bi-eye';
      }
    });
    $('epfFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (f) startCrop(f, u);
    });
    $('epfNew').addEventListener('input', meter);
    $('epfPwForm').addEventListener('submit', function (e) { e.preventDefault(); changePassword(); });
    $('epfVol').addEventListener('input', function () { lsSet(K_VOL, String(this.value / 100)); });
    var first = ov.querySelector('.epf-tab'); if (first) first.focus();
  }

  // ── profile picture ────────────────────────────────────────
  function draftAvatar(val, u) {
    S.avatarDraft = val;
    var av = $('epfAvatar');
    var shown = val === null ? null : (val || ls(K_AVATAR));
    av.innerHTML = avatarHtml(shown, u.initials);
    $('epfRemove').style.display = (val === null) ? 'none' : ((val || ls(K_AVATAR)) ? '' : 'none');
    $('epfSaveProfile').disabled = false;
    msg('epfMsgProfile', '');
  }

  async function saveProfile() {
    if (S.avatarDraft === undefined) return;
    var u = me(), btn = $('epfSaveProfile');
    btn.disabled = true; msg('epfMsgProfile', '');
    try {
      var body = { p_username: u.username, p_prefs: null, p_clear_avatar: S.avatarDraft === null };
      body.p_avatar = typeof S.avatarDraft === 'string' ? S.avatarDraft : null;
      var r = await rpc('save_user_profile', body);
      if (!r || !r.success) throw new Error((r && r.error) || 'Could not save');
      if (S.avatarDraft === null) lsDel(K_AVATAR); else lsSet(K_AVATAR, S.avatarDraft);
      S.avatarDraft = undefined;
      applyAvatar();
      msg('epfMsgProfile', 'Profile photo saved.', 'ok');
      toast('Profile photo updated', 'success');
    } catch (e) {
      btn.disabled = false;
      msg('epfMsgProfile', e.message || 'Could not save');
    }
  }

  // ── cropper ────────────────────────────────────────────────
  var C = null;
  function startCrop(file, u) {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) { msg('epfMsgProfile', 'Please choose a JPG, PNG or WebP image.'); return; }
    if (file.size > 12 * 1024 * 1024) { msg('epfMsgProfile', 'That image is too large (max 12 MB).'); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      if (img.naturalWidth < 32 || img.naturalHeight < 32) { msg('epfMsgProfile', 'That image is too small.'); return; }
      openCrop(img, u);
    };
    img.onerror = function () { URL.revokeObjectURL(url); msg('epfMsgProfile', 'Could not read that image.'); };
    img.src = url;
  }

  function openCrop(img, u) {
    var ov = document.createElement('div');
    ov.className = 'epf-overlay'; ov.id = 'epfCropOverlay'; ov.style.zIndex = 5100;
    ov.innerHTML =
      '<div class="epf-modal" style="width:360px">' +
        '<div class="epf-head"><h2>Position your photo</h2><button class="epf-x" type="button" data-c="cancel" aria-label="Close">&times;</button></div>' +
        '<div class="epf-body"><div class="epf-crop-wrap">' +
          '<div class="epf-crop-stage" id="epfStage"><canvas id="epfCanvas" width="' + CROP + '" height="' + CROP + '"></canvas>' +
            '<div class="epf-crop-mask"></div><div class="epf-crop-ring"></div></div>' +
          '<div class="epf-zoom"><i class="bi bi-image"></i><input type="range" id="epfZoom" min="100" max="400" value="100"><i class="bi bi-image" style="font-size:1.2rem"></i></div>' +
          '<div class="epf-hint" style="margin:0">Drag to move · scroll or use the slider to zoom</div>' +
        '</div></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #E2E8F0;background:#F8FAFC">' +
          '<button class="epf-btn" type="button" data-c="cancel">Cancel</button>' +
          '<button class="epf-btn primary" type="button" data-c="use"><i class="bi bi-check2"></i> Use photo</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    var canvas = $('epfCanvas'), ctx = canvas.getContext('2d'), stage = $('epfStage');
    var w = img.naturalWidth, h = img.naturalHeight;
    var base = CROP / Math.min(w, h);
    C = { img: img, zoom: 1, ox: 0, oy: 0, base: base, u: u };

    function scale() { return C.base * C.zoom; }
    function clamp() {
      var mx = Math.max(0, (w * scale() - CROP) / 2), my = Math.max(0, (h * scale() - CROP) / 2);
      C.ox = Math.min(mx, Math.max(-mx, C.ox));
      C.oy = Math.min(my, Math.max(-my, C.oy));
    }
    function draw() {
      clamp();
      var s = scale();
      ctx.fillStyle = '#0F172A'; ctx.fillRect(0, 0, CROP, CROP);
      ctx.drawImage(img, CROP / 2 + C.ox - w * s / 2, CROP / 2 + C.oy - h * s / 2, w * s, h * s);
    }
    C.draw = draw;
    draw();

    function setZoom(z) {
      z = Math.min(4, Math.max(1, z));
      var r = z / C.zoom; C.ox *= r; C.oy *= r; C.zoom = z;
      $('epfZoom').value = Math.round(z * 100);
      draw();
    }
    $('epfZoom').addEventListener('input', function () { setZoom(this.value / 100); });
    stage.addEventListener('wheel', function (e) { e.preventDefault(); setZoom(C.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });

    var drag = null;
    stage.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, ox: C.ox, oy: C.oy };
      stage.classList.add('drag'); stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', function (e) {
      if (!drag) return;
      C.ox = drag.ox + (e.clientX - drag.x); C.oy = drag.oy + (e.clientY - drag.y); draw();
    });
    function endDrag() { drag = null; stage.classList.remove('drag'); }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    ov.addEventListener('click', function (e) {
      var t = e.target.closest('[data-c]'); if (!t) return;
      if (t.dataset.c === 'cancel') closeCrop();
      else if (t.dataset.c === 'use') useCrop();
    });
  }

  function closeCrop() { var ov = $('epfCropOverlay'); if (ov) ov.remove(); C = null; }

  function exportCrop() {
    var out = document.createElement('canvas'); out.width = OUT; out.height = OUT;
    var o = out.getContext('2d');
    var k = OUT / CROP, s = C.base * C.zoom * k;
    var w = C.img.naturalWidth, h = C.img.naturalHeight;
    o.fillStyle = '#FFFFFF'; o.fillRect(0, 0, OUT, OUT);
    o.imageSmoothingQuality = 'high';
    o.drawImage(C.img, OUT / 2 + C.ox * k - w * s / 2, OUT / 2 + C.oy * k - h * s / 2, w * s, h * s);
    var q = 0.88, data = out.toDataURL('image/jpeg', q);
    while (data.length > 90000 && q > 0.4) { q -= 0.1; data = out.toDataURL('image/jpeg', q); }
    return data;
  }

  function useCrop() {
    var u = C.u, data = exportCrop();
    closeCrop();
    draftAvatar(data, u);
  }

  // ── preferences ────────────────────────────────────────────
  function testSound() {
    lsSet(K_VOL, String($('epfVol').value / 100));
    var wasMuted = ls(K_MUTED);
    lsSet(K_MUTED, '0');
    if (window.erpAlerts && typeof window.erpAlerts.test === 'function') window.erpAlerts.test();
    else msg('epfMsgPrefs', 'Sound engine is not loaded on this page.');
    if (wasMuted === '1' && !$('epfSound').checked) lsSet(K_MUTED, '1');
  }

  async function savePrefs() {
    var u = me(), btn = $('epfSavePrefs');
    var p = {
      sound: $('epfSound').checked,
      volume: Math.round($('epfVol').value) / 100,
      sidebarCollapsed: $('epfSidebar').checked
    };
    applyPrefsLocal(p);
    btn.disabled = true; msg('epfMsgPrefs', '');
    try {
      var r = await rpc('save_user_profile', { p_username: u.username, p_avatar: null, p_prefs: p, p_clear_avatar: false });
      if (!r || !r.success) throw new Error((r && r.error) || 'Could not save');
      msg('epfMsgPrefs', 'Preferences saved.', 'ok');
      toast('Preferences saved', 'success');
    } catch (e) {
      msg('epfMsgPrefs', 'Saved on this device only: ' + (e.message || 'could not reach the server'));
    } finally { btn.disabled = false; }
  }

  // ── password ───────────────────────────────────────────────
  function strength(pw) {
    var s = 0;
    if (pw.length >= 6) s++;
    if (pw.length >= 10) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    if (pw.length < 6) s = Math.min(s, 1);
    return s; // 0..5
  }
  function meter() {
    var pw = $('epfNew').value, s = pw ? strength(pw) : 0;
    var m = $('epfMeter'), l = $('epfMeterLbl');
    var cols = ['#E2E8F0', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#16A34A'];
    var names = ['At least 6 characters', 'Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
    m.style.width = (pw ? Math.max(12, s * 20) : 0) + '%';
    m.style.background = cols[s];
    l.textContent = names[s];
  }

  async function changePassword() {
    var u = me();
    var oldp = $('epfOld').value, n1 = $('epfNew').value, n2 = $('epfNew2').value;
    msg('epfMsgPw', '');
    if (!oldp) return msg('epfMsgPw', 'Enter your current password.');
    if (n1.length < 6) return msg('epfMsgPw', 'New password must be at least 6 characters.');
    if (n1 === oldp) return msg('epfMsgPw', 'New password must be different from the current one.');
    if (n1 !== n2) return msg('epfMsgPw', 'The new passwords do not match.');
    var btn = $('epfSavePw'); btn.disabled = true;
    try {
      var r = await rpc('change_own_password', { p_username: u.username, p_old: oldp, p_new: n1 });
      if (!r || !r.success) throw new Error((r && r.error) || 'Could not change password');
      $('epfPwForm').reset(); meter();
      msg('epfMsgPw', 'Password changed. Use the new one the next time you sign in.', 'ok');
      toast('Password changed', 'success');
    } catch (e) {
      msg('epfMsgPw', e.message || 'Could not change password');
    } finally { btn.disabled = false; }
  }

  // ── server sync ────────────────────────────────────────────
  async function loadRemote() {
    var u = me(); if (!u.username) return null;
    try {
      var r = await rpc('get_user_profile', { p_username: u.username });
      if (!r) return null;
      if (r.avatar) lsSet(K_AVATAR, r.avatar); else lsDel(K_AVATAR);
      if (r.prefs && Object.keys(r.prefs).length) applyPrefsLocal(r.prefs);
      applyAvatar();
      return r;
    } catch (e) { return null; }
  }

  window.erpProfile = { open: open, sync: loadRemote, close: close };
  console.log('✅ erp-profile.js v1.0 loaded');
})();
