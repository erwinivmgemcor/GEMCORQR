/* ═══════════════════════════════════════════════════════════════
   erp-shortcuts.js  v1.0
   Keyboard shortcuts for the ERP item-entry pages.

   Pages: new-mrif, new-mrif-manual, new-mrr, new-mrr-manual,
          new-mrs, new-mrs-manual, replenishment (PRF modal)

   The module does not know about page internals. It finds rows,
   dropdowns and buttons from the DOM and clicks the same buttons
   a user would click, so each page's own logic still runs.

   Alt+A            Add item row (Replenishment: Create PRF / add other item)
   Enter            Next field → next row → new row after the last field
   ↑ ↓ Enter Tab    Pick from the item-search dropdown
   Esc              Close dropdown
   Alt+Delete / X   Remove current row (the page's own confirm still shows)
   Ctrl+↑ / Ctrl+↓  Same column, previous / next row
   Ctrl+S           Submit
   /                Replenishment: focus search
   Ctrl+/           Show this list
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__erpShortcutsLoaded) return;
  window.__erpShortcutsLoaded = true;

  var ROW_SEL = '.erp-item-row, #itemsBody > tr[data-idx]';
  var DD_SEL  = '.item-search-dropdown, .erp-item-dropdown, #rpAddItemResults';
  var OPT_SEL = '.item-search-item, .erp-item-dropdown-item, button[data-code]';
  var ADD_BTN_SEL = 'button[onclick*="addItemRow"], button[onclick*="mrsManualAddItem"]';
  var SUBMIT_FNS = ['submitMrr', 'submitMrif', 'submitMrs', 'rpSubmitPrf'];

  // ── helpers ──────────────────────────────────────────────────
  function visible(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (n.classList.contains('d-none') || n.hidden) return false;
      if (n.style && n.style.display === 'none') return false;
      try { if (window.getComputedStyle(n).display === 'none') return false; } catch (e) {}
    }
    return !!el;
  }

  function modalOpen() { return document.querySelector('.modal.show'); }
  function isRpPage() { return !!document.getElementById('rpSearchInput'); }

  function getRows() {
    return Array.prototype.slice.call(document.querySelectorAll(ROW_SEL)).filter(visible);
  }
  function getRow(el) { return el && el.closest ? el.closest(ROW_SEL) : null; }

  function rowFields(row) {
    return Array.prototype.slice.call(row.querySelectorAll('input, select, textarea')).filter(function (f) {
      return f.type !== 'hidden' && f.type !== 'checkbox' && f.type !== 'radio' &&
             !f.disabled && !f.readOnly && visible(f);
    });
  }

  function isAutoFilled(f) {
    return /desc/i.test((f.id || '') + ' ' + (f.className || '')) && String(f.value || '').trim() !== '';
  }

  function focusEl(el) {
    if (!el) return;
    el.focus();
    if (el.tagName === 'INPUT' && /^(text|number|search|tel|email|url)$/.test(el.type || 'text')) {
      try { el.select(); } catch (e) {}
    }
  }

  function findButton(sel) {
    var list = document.querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) {
      if (visible(list[i]) && !list[i].disabled) return list[i];
    }
    return null;
  }

  function findSubmitButton() {
    for (var i = 0; i < SUBMIT_FNS.length; i++) {
      var b = findButton('button[onclick*="' + SUBMIT_FNS[i] + '("]');
      if (b) return b;
    }
    return null;
  }

  // ── item-search dropdown ─────────────────────────────────────
  function findDropdown(input) {
    if (!input || input.tagName !== 'INPUT') return null;
    var scope = input.closest('td, .erp-item-field, .item-search-wrap, .position-relative') || input.parentNode;
    var dd = scope && scope.querySelector(DD_SEL);
    return dd && visible(dd) ? dd : null;
  }

  function dropdownOptions(dd) {
    return Array.prototype.slice.call(dd.querySelectorAll(OPT_SEL)).filter(function (o) {
      return !o.classList.contains('muted') && !o.classList.contains('disabled');
    });
  }

  function activeOption(dd) { return dd.querySelector('.erp-sc-active'); }

  function moveHighlight(dd, dir) {
    var opts = dropdownOptions(dd);
    if (!opts.length) return;
    var cur = activeOption(dd);
    var i = cur ? opts.indexOf(cur) : -1;
    if (cur) cur.classList.remove('erp-sc-active');
    i = dir > 0 ? (i + 1) % opts.length : (i <= 0 ? opts.length - 1 : i - 1);
    opts[i].classList.add('erp-sc-active');
    if (opts[i].scrollIntoView) opts[i].scrollIntoView({ block: 'nearest' });
  }

  function chooseOption(opt, input) {
    var rows = getRows();
    var pos = rows.indexOf(getRow(input));
    var isRp = input.id === 'rpAddItemInput';

    // Pages select on mousedown (MRR, MRS, MRIF) or on click (MRR-manual, Replenishment).
    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    if (opt.tagName === 'BUTTON' || opt.hasAttribute('onclick')) opt.click();

    // Pages may re-render, so look the row up again by position.
    setTimeout(function () {
      if (isRp) { focusEl(document.getElementById('rpAddItemInput')); return; }
      var row = pos >= 0 ? getRows()[pos] : null;
      if (!row) return;
      var qty = row.querySelector('.item-qty-input');
      if (qty && visible(qty) && !qty.readOnly) { focusEl(qty); return; }
      var f = rowFields(row);
      if (f.length > 1) focusEl(f[1]);
    }, 40);
  }

  function closeDropdown(dd) {
    if (dd.id === 'rpAddItemResults') dd.style.display = 'none';
    else dd.classList.add('d-none');
  }

  // ── rows ─────────────────────────────────────────────────────
  function addRow() {
    if (modalOpen()) return false;
    var btn = findButton(ADD_BTN_SEL);
    if (!btn) return false;
    btn.click();
    // Pages focus the new row themselves; this is a fallback in case a re-render ate the focus.
    setTimeout(function () {
      var rows = getRows();
      var last = rows[rows.length - 1];
      if (last && !last.contains(document.activeElement)) focusEl(rowFields(last)[0]);
    }, 300);
    return true;
  }

  function removeCurrentRow() {
    var row = getRow(document.activeElement);
    if (!row) return;
    var btn = row.querySelector('.btn-outline-danger');
    if (!btn) return;
    var rows = getRows();
    var pos = rows.indexOf(row);
    var before = rows.length;
    btn.click(); // the page shows its own confirm(): Enter = OK, Esc = Cancel
    setTimeout(function () {
      var now = getRows();
      if (now.length === before) return; // cancelled
      if (!now.length) return;
      focusEl(rowFields(now[Math.min(pos, now.length - 1)])[0]);
    }, 80);
  }

  function enterNext(t) {
    var row = getRow(t);
    var full = rowFields(row);
    var i = full.indexOf(t);
    for (var j = i + 1; j < full.length; j++) {
      if (!isAutoFilled(full[j])) { focusEl(full[j]); return; }
    }
    var rows = getRows();
    var ri = rows.indexOf(row);
    if (ri < rows.length - 1) { focusEl(rowFields(rows[ri + 1])[0]); return; }
    addRow();
  }

  function moveRow(t, dir) {
    var row = getRow(t);
    var rows = getRows();
    var target = rows[rows.indexOf(row) + dir];
    if (!target) return;
    var col = rowFields(row).indexOf(t);
    var f = rowFields(target);
    focusEl(f[Math.max(0, Math.min(col, f.length - 1))]);
  }

  // ── main handler ─────────────────────────────────────────────
  function isTyping(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }

  function onKey(e) {
    if (e.isComposing) return;
    var t = e.target;
    var key = e.key;
    var mod = e.ctrlKey || e.metaKey;

    // Help overlay
    if (mod && !e.altKey && key === '/') { e.preventDefault(); toggleHelp(); return; }
    if (key === 'Escape' && helpOpen()) { e.preventDefault(); e.stopPropagation(); closeHelp(); return; }

    // Submit
    if (mod && !e.altKey && !e.shiftKey && (key === 's' || key === 'S')) {
      e.preventDefault(); // never open the browser's "Save page" dialog here
      if (e.repeat || (modalOpen() && !isRpPage())) return;
      if (isRpPage()) { // only the PRF window has something to submit
        var pm = document.getElementById('rpConfirmPrfModal');
        if (!pm || !pm.classList.contains('show')) return;
      }
      var sb = findSubmitButton();
      if (sb) sb.click();
      return;
    }

    // Alt+A
    if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyA') {
      e.preventDefault();
      if (isRpPage()) {
        var rpInput = document.getElementById('rpAddItemInput');
        if (rpInput && visible(rpInput) && modalOpen()) focusEl(rpInput);
        else if (!modalOpen()) { var cb = findButton('button[onclick*="rpCreatePrfFromSelection"]'); if (cb) cb.click(); }
      } else {
        addRow();
      }
      return;
    }

    // Alt+Delete / Alt+X
    if (e.altKey && !mod && !e.shiftKey && (key === 'Delete' || e.code === 'KeyX')) {
      if (getRow(t) && !modalOpen()) { e.preventDefault(); removeCurrentRow(); }
      return;
    }

    // "/" focuses search on Replenishment
    if (key === '/' && !mod && !e.altKey && isRpPage() && !isTyping(t) && !modalOpen()) {
      var s = document.getElementById('rpSearchInput');
      if (s) { e.preventDefault(); focusEl(s); }
      return;
    }

    // Item-search dropdown
    var dd = findDropdown(t);
    if (dd && !mod && !e.altKey) {
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        moveHighlight(dd, key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (key === 'Enter' || (key === 'Tab' && !e.shiftKey && activeOption(dd))) {
        var opts = dropdownOptions(dd);
        if (opts.length) {
          e.preventDefault(); e.stopPropagation();
          chooseOption(activeOption(dd) || opts[0], t);
          return;
        }
      }
      if (key === 'Escape') { closeDropdown(dd); return; }
    }

    // Row navigation
    if (!getRow(t) || modalOpen()) return;

    if (mod && !e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      e.preventDefault();
      moveRow(t, key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (key === 'Enter' && !mod && !e.altKey && !e.shiftKey &&
        (t.tagName === 'INPUT' || t.tagName === 'SELECT') &&
        !/^(button|submit|checkbox|radio)$/.test(t.type || '')) {
      e.preventDefault();
      enterNext(t);
    }
  }

  // ── help overlay ─────────────────────────────────────────────
  var OVERLAY_ID = 'erpScOverlay';

  function helpOpen() { return !!document.getElementById(OVERLAY_ID); }
  function closeHelp() { var o = document.getElementById(OVERLAY_ID); if (o) o.remove(); }
  function toggleHelp() { if (helpOpen()) closeHelp(); else showHelp(); }

  function helpRows() {
    var rows = [];
    var hasRows = !!document.querySelector(ADD_BTN_SEL) || getRows().length > 0;
    if (isRpPage()) {
      rows.push(['Alt + A', 'Create PRF (inside the PRF window: add another item)']);
      rows.push(['/', 'Jump to search']);
      rows.push(['↑ ↓  Enter', 'Pick an item in the search list']);
      rows.push(['Ctrl + S', 'Submit the PRF (when the PRF window is open)']);
    } else if (hasRows) {
      rows.push(['Alt + A', 'Add an item row']);
      rows.push(['Enter', 'Next field, then next row; a new row after the last field']);
      rows.push(['↑ ↓  Enter / Tab', 'Pick an item in the search list']);
      rows.push(['Esc', 'Close the search list']);
      rows.push(['Alt + Delete  (or Alt + X)', 'Remove the current row']);
      rows.push(['Ctrl + ↑ / Ctrl + ↓', 'Same field in the previous / next row']);
      rows.push(['Ctrl + S', 'Submit']);
    }
    rows.push(['Ctrl + K', 'Global search']);
    rows.push(['Ctrl + /', 'Show / hide this list']);
    return rows;
  }

  function showHelp() {
    injectStyle();
    var o = document.createElement('div');
    o.id = OVERLAY_ID;
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-label', 'Keyboard shortcuts');
    var html = '<div class="erp-sc-card"><div class="erp-sc-title">Keyboard shortcuts' +
      '<button type="button" class="erp-sc-x" aria-label="Close">×</button></div><table>';
    helpRows().forEach(function (r) {
      html += '<tr><td><kbd>' + r[0] + '</kbd></td><td>' + r[1] + '</td></tr>';
    });
    html += '</table></div>';
    o.innerHTML = html;
    o.addEventListener('click', function (ev) {
      if (ev.target === o || ev.target.classList.contains('erp-sc-x')) closeHelp();
    });
    document.body.appendChild(o);
  }

  function injectStyle() {
    if (document.getElementById('erpScStyle')) return;
    var st = document.createElement('style');
    st.id = 'erpScStyle';
    st.textContent =
      '.erp-sc-active{background:#dbeafe !important;outline:2px solid #3b82f6;outline-offset:-2px;}' +
      '#erpScOverlay{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:16px;}' +
      '.erp-sc-card{background:#fff;color:#0f172a;border-radius:12px;max-width:520px;width:100%;padding:18px 20px;box-shadow:0 20px 50px rgba(0,0,0,.3);font-size:14px;}' +
      '.erp-sc-title{font-weight:700;font-size:16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;}' +
      '.erp-sc-x{border:0;background:none;font-size:24px;line-height:1;cursor:pointer;color:#64748b;}' +
      '.erp-sc-card table{width:100%;border-collapse:collapse;}' +
      '.erp-sc-card td{padding:6px 4px;border-top:1px solid #e2e8f0;vertical-align:top;}' +
      '.erp-sc-card td:first-child{white-space:nowrap;padding-right:14px;}' +
      '.erp-sc-card kbd{background:#f1f5f9;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:5px;padding:1px 6px;font-size:12px;color:#0f172a;}' +
      '#erpScToast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;background:#1e293b;color:#fff;padding:8px 14px;border-radius:999px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.25);}' +
      '#erpScToast kbd{background:#334155;border:0;color:#fff;border-radius:4px;padding:1px 5px;font-size:12px;}';
    document.head.appendChild(st);
  }

  // One-time tip so people can discover the list
  function showHintOnce() {
    try {
      if (localStorage.getItem('erp_sc_hint_seen')) return;
      localStorage.setItem('erp_sc_hint_seen', '1');
    } catch (e) { /* storage blocked: skip the hint */ return; }
    injectStyle();
    var t = document.createElement('div');
    t.id = 'erpScToast';
    t.innerHTML = 'Tip: press <kbd>Ctrl</kbd> + <kbd>/</kbd> for keyboard shortcuts';
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 6000);
  }

  // ── init ─────────────────────────────────────────────────────
  document.addEventListener('keydown', onKey, true);
  injectStyle();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showHintOnce);
  else setTimeout(showHintOnce, 800);

  window.erpShortcuts = { help: toggleHelp, addRow: addRow };
  console.log('✅ erp-shortcuts.js v1.0 loaded');
})();
