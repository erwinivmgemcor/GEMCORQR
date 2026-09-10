// ============================================================
// UTILITY FUNCTIONS (Optimized with prominent loading feedback)
// ============================================================

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  return audioCtx;
}

function cleanDocNo(docNo) {
  if (!docNo) return '';
  return docNo.replace(/-\w+$/, '').replace(/-\w+-\w+$/, '');
}

function buildUnitOptions(selected) {
  var html = '';
  UNIT_OPTIONS.forEach(function(u) {
    var sel = (u === selected) ? ' selected' : '';
    html += '<option value="' + u + '"' + sel + '>' + u + '</option>';
  });
  return html;
}

// ============================================================
// LOADING SYSTEM — 3-layer visual feedback
// ============================================================

let _progressBar = null;
let _busyPill = null;
let _busyCount = 0;
let _blockingMode = false;

(function injectLoadingStyles() {
  if (document.getElementById('loadingSystemStyles')) return;
  var style = document.createElement('style');
  style.id = 'loadingSystemStyles';
  style.textContent = `
    @keyframes pillFadeIn {
      from { opacity: 0; transform: translateY(-12px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes globalProgressStripe {
      0% { background-position: 0 0; }
      100% { background-position: 40px 0; }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    #globalProgressBar {
      position: fixed;
      top: 0; left: 0;
      height: 5px;
      width: 0%;
      background: linear-gradient(90deg, #f59e0b 0%, #fbbf24 25%, #f59e0b 50%, #fbbf24 75%, #f59e0b 100%);
      background-size: 40px 100%;
      z-index: 99999;
      transition: width 0.35s ease;
      box-shadow: 0 0 16px rgba(245,158,11,0.9), 0 2px 8px rgba(0,0,0,0.15);
      border-radius: 0 4px 4px 0;
      animation: globalProgressStripe 1.2s linear infinite;
      pointer-events: none;
    }
    #globalBusyPill {
      position: fixed;
      top: 16px; right: 16px;
      background: linear-gradient(135deg, #1e3a5f 0%, #2a4a73 100%);
      color: #fff;
      padding: 10px 18px 10px 14px;
      border-radius: 28px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.88rem;
      font-weight: 600;
      box-shadow: 0 6px 24px rgba(30,58,95,0.45), 0 2px 6px rgba(0,0,0,0.2);
      z-index: 99998;
      animation: pillFadeIn 0.25s ease;
      pointer-events: none;
      border: 1px solid rgba(255,255,255,0.15);
      letter-spacing: 0.3px;
    }
    #globalBusyPill .busy-spinner {
      width: 16px;
      height: 16px;
      border: 2.5px solid rgba(255,255,255,0.3);
      border-top-color: #fbbf24;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    .btn-loading {
      position: relative;
      pointer-events: none !important;
      opacity: 0.85;
    }
    .btn-loading .btn-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.4);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin-right: 6px;
      vertical-align: -2px;
    }
    .btn-loading.btn-outline-primary .btn-spinner,
    .btn-loading.btn-outline-secondary .btn-spinner,
    .btn-loading.btn-outline-success .btn-spinner {
      border-color: rgba(30,58,95,0.3);
      border-top-color: #1e3a5f;
    }
  `;
  document.head.appendChild(style);
})();

function _ensureProgressBar() {
  if (_progressBar) return;
  _progressBar = document.createElement('div');
  _progressBar.id = 'globalProgressBar';
  document.body.appendChild(_progressBar);
}

function _ensureBusyPill(text) {
  if (_busyPill) {
    var t = document.getElementById('globalBusyText');
    if (t && text) t.textContent = text;
    return;
  }
  _busyPill = document.createElement('div');
  _busyPill.id = 'globalBusyPill';
  _busyPill.innerHTML = '<div class="busy-spinner"></div><span id="globalBusyText">' + (text || 'Processing...') + '</span>';
  document.body.appendChild(_busyPill);
}

function _updateProgressBar() {
  if (!_progressBar) return;
  var w = Math.min(40 + _busyCount * 12, 92);
  _progressBar.style.width = w + '%';
}

function _completeProgressBar() {
  if (!_progressBar) return;
  _progressBar.style.width = '100%';
  var pb = _progressBar;
  _progressBar = null;
  setTimeout(function() {
    if (pb && pb.parentNode) pb.parentNode.removeChild(pb);
  }, 400);
}

function _removeBusyPill() {
  if (_busyPill && _busyPill.parentNode) {
    _busyPill.parentNode.removeChild(_busyPill);
    _busyPill = null;
  }
}

function showLoading(text) {
  if (_blockingMode) {
    state.isLoading = true;
    var lo = document.getElementById('loadingOverlay');
    var lt = document.getElementById('loadingText');
    if (lo) lo.classList.remove('d-none');
    if (lt) lt.textContent = text || 'Loading...';
    return;
  }
  _busyCount++;
  _ensureProgressBar();
  _ensureBusyPill(text);
  _updateProgressBar();
}

function hideLoading() {
  if (_blockingMode) {
    state.isLoading = false;
    var lo = document.getElementById('loadingOverlay');
    if (lo) lo.classList.add('d-none');
    _blockingMode = false;
    return;
  }
  _busyCount = Math.max(0, _busyCount - 1);
  if (_busyCount === 0) {
    _completeProgressBar();
    _removeBusyPill();
  }
}

function showBlockingLoading(text) {
  _blockingMode = true;
  showLoading(text);
}

// ─── Button-level loading: disable + inline spinner ─────────
function withButtonLoading(btn, asyncFn, loadingText) {
  if (!btn) return Promise.resolve().then(asyncFn);
  if (btn.disabled || btn.dataset.loading === '1') return Promise.resolve();

  var originalHtml = btn.innerHTML;
  var originalDisabled = btn.disabled;

  btn.dataset.loading = '1';
  btn.disabled = true;
  btn.classList.add('btn-loading');
  btn.innerHTML = '<span class="btn-spinner"></span>' + (loadingText || 'Processing...');

  return Promise.resolve()
    .then(asyncFn)
    .catch(function(err) {
      console.error('[withButtonLoading]', err);
      throw err;
    })
    .finally(function() {
      btn.classList.remove('btn-loading');
      btn.innerHTML = originalHtml;
      btn.disabled = originalDisabled;
      delete btn.dataset.loading;
    });
}

function showToast(msg, type) {
  var toast = document.getElementById('liveToast');
  if (!toast) { console.log('[Toast]', type, msg); return; }
  var title = document.getElementById('toastTitle');
  var body = document.getElementById('toastBody');
  if (title) title.textContent = type === 'danger' ? 'Error' : (type === 'success' ? 'Success' : 'Info');
  if (body) body.textContent = msg;
  toast.className = 'toast align-items-center text-white bg-' + type;
  bootstrap.Toast.getOrCreateInstance(toast).show();
}

function extractSheetId(url) {
  if (!url) return '';
  if (url.length === 44 && url.indexOf('/') === -1) return url;
  var match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : url;
}

function debounce(fn, delay) {
  let t;
  return function() {
    var ctx = this, args = arguments;
    clearTimeout(t);
    t = setTimeout(function() { fn.apply(ctx, args); }, delay);
  };
}

function playSuccessBeep() {
  try {
    var ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(); osc.stop(ctx.currentTime + 0.3);
    if (navigator.vibrate) navigator.vibrate(100);
  } catch(e) {}
}

function playErrorBuzz() {
  try {
    var ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  } catch(e) {}
}
