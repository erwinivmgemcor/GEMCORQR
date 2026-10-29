// ============================================================
// GEMCOR ERP — Request lock ("in process by …")  v1.0
// Stops two warehouse staff from processing the same MRIF / MRS at once.
//   erpDocLock.guard(docNo)   → claim on page open; blocks the page if someone else has it
//   erpDocLock.verify(docNo)  → call right before submitting (still mine?)
//   erpDocLock.release(docNo) → on cancel / after submit
//   erpDocLock.list()         → live locks, for the All Requests list
// A soft lock: it lives in the database (erp_doc_locks) and expires 5 minutes after the
// last heartbeat, so a closed browser or a crash never leaves a request stuck.
// If the database part is not installed yet, everything silently does nothing.
// ============================================================
(function () {
  'use strict';
  if (window.erpDocLock) return;

  var HEARTBEAT_MS = 45 * 1000;
  var IDLE_STOP_MS = 10 * 60 * 1000;   // no mouse/keyboard for 10 min → stop heartbeat → lock frees itself
  var _state = { docNo: '', timer: null, lastActive: Date.now(), chip: null, lost: false, disabled: false };

  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function me() { return { username: ls('ivm_username'), fullname: ls('ivm_userFullname') || ls('ivm_username') }; }
  function isAdmin() { return ls('ivm_isAdmin') === 'true'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  async function rpc(name, body, opts) {
    var res = await fetch(erpUrl('rpc/' + name), Object.assign({ method: 'POST', headers: erpHeaders(), body: JSON.stringify(body || {}) }, opts || {}));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function ago(iso) {
    var t = new Date(iso); if (isNaN(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t.getTime()) / 60000));
    var clock = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return clock + (m >= 1 ? ' · ' + m + ' min ago' : ' · just now');
  }

  // ── UI ────────────────────────────────────────────────────
  function removeOverlay() { var o = document.getElementById('erpLockOverlay'); if (o) o.remove(); }

  function showBlocked(lock, reason) {
    removeOverlay();
    var o = document.createElement('div');
    o.id = 'erpLockOverlay';
    o.style.cssText = 'position:fixed;inset:0;z-index:5000;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;padding:16px;';
    var who = esc(lock && (lock.locked_by_name || lock.locked_by) || 'another staff');
    var when = lock && lock.locked_at ? ago(lock.locked_at) : '';
    o.innerHTML =
      '<div style="background:#fff;border-radius:16px;max-width:460px;width:100%;padding:28px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4);">' +
        '<div style="font-size:42px;line-height:1;">🔒</div>' +
        '<h4 style="margin:12px 0 6px;font-weight:700;">' + (reason === 'lost' ? 'You lost this request' : 'Already being processed') + '</h4>' +
        '<p style="margin:0 0 4px;color:#334155;"><strong>' + who + '</strong> ' + (reason === 'lost' ? 'took over this request.' : 'is processing this request.') + '</p>' +
        (when ? '<p style="margin:0 0 14px;color:#64748b;font-size:.9rem;">Started ' + esc(when) + '</p>' : '<div style="height:14px"></div>') +
        '<p style="margin:0 0 18px;color:#64748b;font-size:.85rem;">To avoid double processing, wait until they finish, or ask them to release it. The lock frees itself if they close the page or go idle.</p>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
          '<a href="all-requests.html" class="btn btn-primary">Back to requests</a>' +
          '<button type="button" class="btn btn-outline-secondary" id="erpLockRetry">Try again</button>' +
          (isAdmin() ? '<button type="button" class="btn btn-outline-danger" id="erpLockTake">Take over (admin)</button>' : '') +
        '</div>' +
      '</div>';
    document.body.appendChild(o);
    var retry = document.getElementById('erpLockRetry');
    if (retry) retry.onclick = function () { location.reload(); };
    var take = document.getElementById('erpLockTake');
    if (take) take.onclick = async function () {
      if (!confirm('Take over this request from ' + who + '?\nThey will be blocked from submitting.')) return;
      try {
        var r = await rpc('erp_claim_doc', { p_doc_no: _state.docNo, p_username: me().username, p_fullname: me().fullname, p_force: true });
        if (r && r.ok) location.reload(); else alert('Could not take over.');
      } catch (e) { alert('Could not take over: ' + e.message); }
    };
  }

  function showChip() {
    if (_state.chip) return;
    var c = document.createElement('div');
    c.id = 'erpLockChip';
    c.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:1900;background:#0f172a;color:#fff;border-radius:999px;padding:7px 14px;font-size:.8rem;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:.92;';
    c.innerHTML = '🔒 You are processing this request — others can see it';
    document.body.appendChild(c);
    _state.chip = c;
  }
  function hideChip() { if (_state.chip) { _state.chip.remove(); _state.chip = null; } }

  // ── heartbeat ─────────────────────────────────────────────
  function markActive() { _state.lastActive = Date.now(); }
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(function (ev) {
    window.addEventListener(ev, markActive, { passive: true });
  });

  async function beat() {
    if (!_state.docNo || _state.lost) return;
    if (Date.now() - _state.lastActive > IDLE_STOP_MS) return;      // idle: let it expire
    try {
      var ok = await rpc('erp_touch_doc', { p_doc_no: _state.docNo, p_username: me().username });
      if (ok === false) await reclaimOrLose();
    } catch (e) { /* network blip: try again next beat */ }
  }

  // heartbeat said "not yours": either it expired and nobody took it (re-claim) or someone took it
  async function reclaimOrLose() {
    try {
      var r = await rpc('erp_claim_doc', { p_doc_no: _state.docNo, p_username: me().username, p_fullname: me().fullname, p_force: false });
      if (r && r.ok) return true;
      _state.lost = true; hideChip(); showBlocked(r, 'lost');
      return false;
    } catch (e) { return true; }   // cannot tell → do not block work because of a network error
  }

  function startBeat(docNo) {
    _state.docNo = docNo; _state.lost = false;
    if (_state.timer) clearInterval(_state.timer);
    _state.timer = setInterval(beat, HEARTBEAT_MS);
    window.addEventListener('pagehide', function () { release(docNo, true); });
  }

  // ── public API ────────────────────────────────────────────
  async function guard(docNo) {
    var m = me();
    if (!docNo || !m.username) return true;                        // not logged in properly: do not block
    _state.docNo = docNo;
    try {
      var r = await rpc('erp_claim_doc', { p_doc_no: docNo, p_username: m.username, p_fullname: m.fullname, p_force: false });
      if (r && r.ok) { startBeat(docNo); showChip(); return true; }
      showBlocked(r, 'blocked');
      return false;
    } catch (e) {
      console.warn('[erpDocLock] lock not available (SQL not installed?):', e.message);
      _state.disabled = true;
      return true;                                                 // never block the warehouse because the lock failed
    }
  }

  // right before submit: is it still mine?
  async function verify(docNo) {
    if (_state.disabled) return true;
    var m = me();
    try {
      var ok = await rpc('erp_touch_doc', { p_doc_no: docNo, p_username: m.username });
      if (ok === true) return true;
      return await reclaimOrLose();
    } catch (e) { return true; }
  }

  function release(docNo, quick) {
    if (_state.disabled || !docNo) return Promise.resolve();
    if (_state.timer) { clearInterval(_state.timer); _state.timer = null; }
    hideChip();
    try {
      return rpc('erp_release_doc', { p_doc_no: docNo, p_username: me().username }, quick ? { keepalive: true } : null).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  async function list() {
    try {
      var rows = await rpc('erp_get_doc_locks', {});
      var map = {};
      (rows || []).forEach(function (r) { map[r.doc_no] = r; });
      return map;
    } catch (e) { return null; }
  }

  window.erpDocLock = { guard: guard, verify: verify, release: release, list: list, me: me };
})();
