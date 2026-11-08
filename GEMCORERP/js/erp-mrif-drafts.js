// ============================================================
// GEMCOR ERP — Save as Draft (MRIF With JO + MRIF Manual)
// • "Save as Draft": itabi muna ang encoding, balikan kahit kailan, i-submit pag all good
// • "My Drafts": listahan ng mga draft (Resume / Delete)
// • Auto-recovery: kahit na-refresh o nag-crash ang browser, may "Ibalik" na banner
// Nakatago ito sa browser (localStorage) na ginamit sa pag-save, per user. Hindi ito nasa database,
// kaya hindi nito naaapektuhan ang stock, request counts o monitoring hangga't hindi na-submit.
// ============================================================
(function () {
  'use strict';

  var CFG = null;
  var S = { currentId: null, submitted: false, timer: null, pendingRecovery: false, modal: null };
  var MAX_DRAFTS = 30, PURGE_DAYS = 60;

  // ───────── helpers ─────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function user() { return localStorage.getItem('ivm_username') || localStorage.getItem('ivm_userFullname') || 'anon'; }
  function dKey() { return 'erp_drafts_v1:' + user() + ':' + CFG.type; }
  function aKey() { return 'erp_draft_auto_v1:' + user() + ':' + CFG.type; }
  function load(k, fb) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function toast(m, t) { if (typeof window.erpShowToast === 'function') window.erpShowToast(m, t || 'info'); }
  function ago(ts) {
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'ngayon lang';
    if (m < 60) return m + ' min ang nakaraan';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' oras ang nakaraan';
    return Math.round(h / 24) + ' araw ang nakaraan';
  }
  function newId() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ───────── form <-> data ─────────
  function rowEls() { return Array.prototype.slice.call(document.querySelectorAll('.erp-item-row')); }
  function readRows() {
    return rowEls().map(function (r) {
      function v(sel) { var e = r.querySelector(sel); return e ? e.value : ''; }
      return { code: v('.item-code-input').trim(), description: v('.item-desc-input'), qty: v('.item-qty-input'),
               unit: v('.item-unit-input'), remarks: v('.item-remarks-input') };
    });
  }
  function snapshot() { return { header: CFG.getHeader() || {}, items: readRows().filter(function (r) { return r.code; }) }; }
  function makeTitle(h) { try { return CFG.makeTitle(h) || CFG.label; } catch (e) { return CFG.label; } }

  function setVal(row, sel, val) {
    var e = row.querySelector(sel);
    if (!e || val == null) return;
    e.value = val;
    if (e.tagName === 'SELECT' && e.value !== String(val) && val) {      // unit na wala sa listahan
      var o = document.createElement('option'); o.value = val; o.textContent = val; e.appendChild(o); e.value = val;
    }
  }

  // ───────── storage ─────────
  function listDrafts() {
    var arr = load(dKey(), []);
    var cut = Date.now() - PURGE_DAYS * 864e5;
    var kept = arr.filter(function (d) { return d && d.savedAt > cut; });
    if (kept.length !== arr.length) save(dKey(), kept);
    return kept.sort(function (a, b) { return b.savedAt - a.savedAt; });
  }
  function getAuto() { var a = load(aKey(), null); return a && a.items && a.items.length ? a : null; }
  function removeAuto() { try { localStorage.removeItem(aKey()); } catch (e) {} }

  // ───────── actions ─────────
  function saveDraft() {
    var snap = snapshot();
    if (!snap.items.length) { toast('Magdagdag muna ng kahit isang item (may item code) bago i-save bilang draft', 'warning'); return; }
    var arr = load(dKey(), []);
    var idx = S.currentId ? arr.findIndex(function (d) { return d.id === S.currentId; }) : -1;
    var d = { id: idx >= 0 ? arr[idx].id : newId(), savedAt: Date.now(), title: makeTitle(snap.header),
              count: snap.items.length, header: snap.header, items: snap.items };
    if (idx >= 0) arr[idx] = d;
    else {
      if (arr.length >= MAX_DRAFTS) { toast('Puno na ang drafts (max ' + MAX_DRAFTS + '). Burahin muna ang ilan sa My Drafts.', 'warning'); return; }
      arr.push(d);
    }
    if (!save(dKey(), arr)) { toast('Hindi ma-save ang draft (puno ang browser storage)', 'danger'); return; }
    S.currentId = d.id; S.submitted = false;
    removeAuto(); S.pendingRecovery = false;
    refreshUi();
    toast('📝 Draft saved — ' + d.count + ' item' + (d.count === 1 ? '' : 's') + '. Makikita ito sa My Drafts.', 'success');
  }

  function restore(d, fromAuto) {
    CFG.clear();                                  // linisin ang form (page's own reset)
    CFG.setHeader(d.header || {});
    (d.items || []).forEach(function (it) {
      CFG.addRow({ noFocus: true });
      var rows = rowEls(); var r = rows[rows.length - 1];
      if (!r) return;
      setVal(r, '.item-code-input', it.code);
      setVal(r, '.item-desc-input', it.description);
      setVal(r, '.item-qty-input', it.qty);
      setVal(r, '.item-unit-input', it.unit);
      setVal(r, '.item-remarks-input', it.remarks);
      if (window.erpStockAlerts && typeof window.erpStockAlerts.noteRow === 'function') { try { window.erpStockAlerts.noteRow(r); } catch (e) {} }
    });
    document.querySelectorAll('.item-dropdown').forEach(function (el) { el.classList.add('d-none'); });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    S.currentId = fromAuto ? null : d.id;
    S.submitted = false;
    if (fromAuto) { removeAuto(); S.pendingRecovery = false; }
    refreshUi();
    toast('📂 Naibalik ang ' + (d.items || []).length + ' item(s). I-review bago i-submit.', 'success');
  }

  function formHasItems() { return readRows().some(function (r) { return r.code; }); }

  function resumeDraft(id) {
    var d = listDrafts().filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    if (formHasItems() && !confirm('Papalitan ng draft na ito ang laman ng form ngayon (hindi pa nase-save). Tuloy?')) return;
    if (S.modal) S.modal.hide();
    restore(d, false);
  }

  function deleteDraft(id) {
    if (!confirm('Burahin ang draft na ito?')) return;
    var arr = load(dKey(), []).filter(function (d) { return d.id !== id; });
    save(dKey(), arr);
    if (S.currentId === id) S.currentId = null;
    refreshUi(); renderModalList();
  }

  // ───────── autosave (recovery) ─────────
  function scheduleAuto() {
    if (S.submitted) return;
    clearTimeout(S.timer);
    S.timer = setTimeout(doAuto, 1200);
  }
  function doAuto() {
    if (S.submitted || !CFG) return;
    var snap = snapshot();
    if (!snap.items.length) { if (!S.pendingRecovery) removeAuto(); return; }
    if (S.currentId) {                            // walang bago kumpara sa naka-save na draft → walang kailangang auto-copy
      var cur = load(dKey(), []).filter(function (d) { return d.id === S.currentId; })[0];
      if (cur && JSON.stringify([cur.header, cur.items]) === JSON.stringify([snap.header, snap.items])) { removeAuto(); return; }
    }
    if (S.pendingRecovery) {                      // may naghihintay na recovery pero nagsimula na ng bago → ilipat sa drafts, huwag mawala
      var old = getAuto();
      if (old) {
        var arr = load(dKey(), []);
        if (arr.length < MAX_DRAFTS) {
          arr.push({ id: newId(), savedAt: old.savedAt, title: '↺ ' + (old.title || CFG.label) + ' (auto-recovered)',
                     count: old.items.length, header: old.header, items: old.items });
          save(dKey(), arr);
        }
      }
      S.pendingRecovery = false;
    }
    save(aKey(), { savedAt: Date.now(), title: makeTitle(snap.header), count: snap.items.length, header: snap.header, items: snap.items });
    refreshUi();
  }

  // ───────── UI ─────────
  function ensureUi() {
    if (document.getElementById('erpDraftBar')) return;
    var first = document.querySelector('.erp-card');
    if (first && first.parentNode) {
      var bar = document.createElement('div');
      bar.id = 'erpDraftBar';
      bar.innerHTML =
        '<div id="erpDraftRecovery" style="display:none;" class="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2 py-2 mb-2"></div>' +
        '<div class="d-flex justify-content-end mb-2">' +
          '<button type="button" class="btn btn-sm btn-outline-primary" id="btnMyDrafts"><i class="bi bi-journal-text me-1"></i>My Drafts ' +
          '<span class="badge bg-primary" id="erpDraftCount">0</span></button></div>';
      first.parentNode.insertBefore(bar, first);
      document.getElementById('btnMyDrafts').addEventListener('click', openModal);
    }
    var resetBtn = document.querySelector('button[onclick="resetForm()"]');
    if (resetBtn && !document.getElementById('btnSaveDraft')) {
      var b = document.createElement('button');
      b.type = 'button'; b.id = 'btnSaveDraft'; b.className = 'btn btn-outline-primary me-2';
      b.innerHTML = '<i class="bi bi-journal-plus me-1"></i><span id="btnSaveDraftLabel">Save as Draft</span>';
      b.title = 'I-save muna ang encoding at balikan mo mamaya';
      b.addEventListener('click', saveDraft);
      resetBtn.parentNode.insertBefore(b, resetBtn);
    }
    if (!document.getElementById('erpDraftModal')) {
      var m = document.createElement('div');
      m.className = 'modal fade'; m.id = 'erpDraftModal'; m.tabIndex = -1;
      m.innerHTML =
        '<div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable"><div class="modal-content">' +
        '<div class="modal-header"><h6 class="modal-title"><i class="bi bi-journal-text me-2"></i>My Drafts — ' + esc(CFG.label) + '</h6>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
        '<div class="modal-body" id="erpDraftList"></div>' +
        '<div class="modal-footer"><small class="text-muted me-auto">Nakatago ang mga draft sa browser na ito. Hindi pa ito request hangga\'t hindi na-submit.</small>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Close</button></div></div></div>';
      document.body.appendChild(m);
    }
  }

  function renderModalList() {
    var el = document.getElementById('erpDraftList');
    if (!el) return;
    var ds = listDrafts();
    if (!ds.length) { el.innerHTML = '<div class="text-center text-muted py-4"><i class="bi bi-inbox fs-2 d-block mb-2"></i>Wala pang draft. Gamitin ang <b>Save as Draft</b> habang nag-eencode.</div>'; return; }
    el.innerHTML = ds.map(function (d) {
      var on = d.id === S.currentId;
      return '<div class="d-flex align-items-center justify-content-between border rounded p-2 mb-2' + (on ? ' border-primary' : '') + '">' +
        '<div><div class="fw-semibold">' + esc(d.title) + (on ? ' <span class="badge bg-primary">nakabukas</span>' : '') + '</div>' +
        '<div class="small text-muted">' + d.count + ' item' + (d.count === 1 ? '' : 's') + ' · ' + esc(ago(d.savedAt)) + '</div></div>' +
        '<div class="d-flex gap-1"><button class="btn btn-sm btn-primary" data-resume="' + esc(d.id) + '"><i class="bi bi-box-arrow-in-right me-1"></i>Resume</button>' +
        '<button class="btn btn-sm btn-outline-danger" data-del="' + esc(d.id) + '" title="Burahin"><i class="bi bi-trash"></i></button></div></div>';
    }).join('');
    el.querySelectorAll('[data-resume]').forEach(function (b) { b.addEventListener('click', function () { resumeDraft(b.getAttribute('data-resume')); }); });
    el.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { deleteDraft(b.getAttribute('data-del')); }); });
  }

  function openModal() {
    renderModalList();
    var el = document.getElementById('erpDraftModal');
    if (window.bootstrap) { S.modal = bootstrap.Modal.getOrCreateInstance(el); S.modal.show(); }
  }

  function refreshUi() {
    var c = document.getElementById('erpDraftCount');
    if (c) c.textContent = listDrafts().length;
    var lbl = document.getElementById('btnSaveDraftLabel');
    if (lbl) lbl.textContent = S.currentId ? 'Update Draft' : 'Save as Draft';
    var rec = document.getElementById('erpDraftRecovery');
    if (!rec) return;
    var a = S.pendingRecovery ? getAuto() : null;
    if (!a) { rec.style.display = 'none'; rec.innerHTML = ''; return; }
    rec.style.display = '';
    rec.innerHTML =
      '<div><i class="bi bi-arrow-counterclockwise me-2"></i><b>May hindi pa na-submit na encoding</b> — ' + esc(a.title) + ', ' + a.count +
      ' item(s), ' + esc(ago(a.savedAt)) + '.</div>' +
      '<div class="d-flex gap-2"><button type="button" class="btn btn-sm btn-warning" id="btnRecoverAuto">Ibalik</button>' +
      '<button type="button" class="btn btn-sm btn-outline-secondary" id="btnDiscardAuto">Itapon</button></div>';
    document.getElementById('btnRecoverAuto').addEventListener('click', function () { var x = getAuto(); if (x) restore(x, true); });
    document.getElementById('btnDiscardAuto').addEventListener('click', function () {
      if (!confirm('Itapon ang na-recover na encoding? Hindi na ito maibabalik.')) return;
      removeAuto(); S.pendingRecovery = false; refreshUi();
    });
  }

  // ───────── public API ─────────
  window.ErpDrafts = {
    // cfg: {type, label, getHeader(), setHeader(h), makeTitle(h), clear(), addRow(opts)}
    init: function (cfg) {
      CFG = cfg;
      ensureUi();
      listDrafts();                                // purge luma
      if (getAuto() && !formHasItems()) S.pendingRecovery = true;
      refreshUi();
      ['input', 'change', 'click'].forEach(function (ev) { document.addEventListener(ev, scheduleAuto, true); });
      window.addEventListener('storage', function (e) { if (e.key === dKey()) refreshUi(); });
    },
    // tawagin pagkatapos ma-submit ang MRIF: burahin ang draft na pinagmulan at ang auto-copy
    onSubmitted: function () {
      if (!CFG) return;
      if (S.currentId) save(dKey(), load(dKey(), []).filter(function (d) { return d.id !== S.currentId; }));
      S.currentId = null; S.submitted = true; S.pendingRecovery = false;
      clearTimeout(S.timer); removeAuto(); refreshUi();
    },
    // tawagin kapag nilinis ang form (reset o pagkatapos ng success)
    onFormCleared: function () {
      if (!CFG) return;
      S.currentId = null; S.submitted = false;
      clearTimeout(S.timer);
      if (!S.pendingRecovery) removeAuto();
      refreshUi();
    }
  };
})();
