// ============================================================
// UTILITY FUNCTIONS
// ============================================================

// ─── Audio context for beeps ───
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

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

function showLoading(text) {
  state.isLoading = true;
  document.getElementById('loadingText').textContent = text || 'Loading...';
  document.getElementById('loadingOverlay').classList.remove('d-none');
}
function hideLoading() {
  state.isLoading = false;
  document.getElementById('loadingOverlay').classList.add('d-none');
}

function showToast(msg, type) {
  const toast = document.getElementById('liveToast');
  document.getElementById('toastTitle').textContent = type === 'danger' ? 'Error' : (type === 'success' ? 'Success' : 'Info');
  document.getElementById('toastBody').textContent = msg;
  toast.className = 'toast align-items-center text-white bg-' + type;
  bootstrap.Toast.getOrCreateInstance(toast).show();
}

function extractSheetId(url) {
  if (!url) return '';
  if (url.length === 44 && !url.includes('/')) return url;
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : url;
}

function playSuccessBeep() {
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.start(); osc.stop(audioCtx.currentTime + 0.3);
    if (navigator.vibrate) navigator.vibrate(100);
  } catch(e) {}
}
function playErrorBuzz() {
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
    osc.start(); osc.stop(audioCtx.currentTime + 0.4);
    if (navigator.vibrate) navigator.vibrate([100,50,100]);
  } catch(e) {}
}
