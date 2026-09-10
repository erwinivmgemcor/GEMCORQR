// ============================================================
// UTILITY FUNCTIONS (Optimized for speed)
// ============================================================

// ─── Audio context for beeps ───
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  return audioCtx;
}

// ─── Clean document number ───
function cleanDocNo(docNo) {
  if (!docNo) return '';
  return docNo.replace(/-\w+$/, '').replace(/-\w+-\w+$/, '');
}

// ─── Build unit <option> list ───
function buildUnitOptions(selected) {
  var html = '';
  UNIT_OPTIONS.forEach(function(u) {
    var sel = (u === selected) ? ' selected' : '';
    html += '<option value="' + u + '"' + sel + '>' + u + '</option>';
  });
  return html;
}

// ─── Non-blocking top progress bar ────────────────────────────
let _progressBar = null;
let _progressCount = 0;
let _blockingMode = false;

function showLoading(text) {
  if (_blockingMode) {
    state.isLoading = true;
    var lo = document.getElementById('loadingOverlay');
    var lt = document.getElementById('loadingText');
    if (lo) lo.classList.remove('d-none');
    if (lt) lt.textContent = text || 'Loading...';
    return;
  }
  _progressCount++;
  if (!_progressBar) {
    _progressBar = document.createElement('div');
    _progressBar.id = 'topProgressBar';
    _progressBar.style.cssText =
      'position:fixed;top:0;left:0;height:3px;width:0%;background:#f59e0b;' +
      'z-index:99999;transition:width 0.3s ease;box-shadow:0 0 6px #f59e0b;';
    document.body.appendChild(_progressBar);
  }
  _progressBar.style.width = '40%';
}

function hideLoading() {
  if (_blockingMode) {
    state.isLoading = false;
    var lo = document.getElementById('loadingOverlay');
    if (lo) lo.classList.add('d-none');
    _blockingMode = false;
    return;
  }
  _progressCount = Math.max(0, _progressCount - 1);
  if (_progressCount === 0 && _progressBar) {
    _progressBar.style.width = '100%';
    var pb = _progressBar;
    setTimeout(function() {
      if (pb && pb.parentNode) pb.parentNode.removeChild(pb);
      if (_progressBar === pb) _progressBar = null;
    }, 250);
  }
}

function showBlockingLoading(text) {
  _blockingMode = true;
  showLoading(text);
}

// ─── Toast ─────────────────────────────────────────────────────
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

// ─── Extract sheet id from URL/ID ─────────────────────────────
function extractSheetId(url) {
  if (!url) return '';
  if (url.length === 44 && url.indexOf('/') === -1) return url;
  var match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : url;
}

// ─── Debounce helper ──────────────────────────────────────────
function debounce(fn, delay) {
  let t;
  return function() {
    var ctx = this, args = arguments;
    clearTimeout(t);
    t = setTimeout(function() { fn.apply(ctx, args); }, delay);
  };
}

// ─── Sound: success ───────────────────────────────────────────
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

// ─── Sound: error buzz ────────────────────────────────────────
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
