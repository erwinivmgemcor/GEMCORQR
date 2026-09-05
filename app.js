/* ═══════════════════════════════════════════════════════════════════════════
   IVM WAREHOUSE QR — APPLICATION LOGIC
   (Full version with QR Download & Share)
   ═══════════════════════════════════════════════════════════════════════════ */

const API_URL = 'https://script.google.com/macros/s/AKfycbw-EX38TvEOLHcYRh0EUks9c9e7M0pIGS1fwi8ELPqs7KZnKtcy99hYZvIyg9blVSJz/exec';
const DEFAULT_PIN = '0000';

// ─── Unit Options for dropdowns ───
const UNIT_OPTIONS = [
  'ASSEMB', 'BOX', 'CAN', 'GAL', 'KG', 'LENGTH', 'LITERS',
  'METER', 'MM', 'PAIR', 'PIECE', 'REAM', 'ROLL', 'SET',
  'SHEET', 'TANK', 'UNIT'
];

// ─── Helper: Clean document number (remove suffix like -after-sales) ───
function cleanDocNo(docNo) {
  if (!docNo) return '';
  return docNo.replace(/-\w+$/, '').replace(/-\w+-\w+$/, '');
}

// ─── For QR download/share ───
let lastQrDocNo = '';
let lastQrTicketNo = '';
let lastQrImageData = '';

const state = {
currentModule: 'MRIF',
currentDoc: null,
items: [],
html5QrCode: null,
quickScanner: null,
currentCamera: 'environment',
torchOn: false,
cameras: [],
requestInventoryList: [],
requestorList: [],
poItemsData: [],
currentPoNo: '',
currentPoPrf: '',
currentPoClient: '',
currentPoSupplier: '',
poScanModal: null,
poItemsModal: null,
errorTimer: null,
docList: [],
pinBuffer: '',
pinAttempts: 0,
isLoading: false
};

const qtyModal = new bootstrap.Modal(document.getElementById('qtyModal'));
const successModal = new bootstrap.Modal(document.getElementById('successModal'));
const settingsModal = new bootstrap.Modal(document.getElementById('settingsModal'));
const newRequestModal = new bootstrap.Modal(document.getElementById('newRequestModal'));
const requestSuccessModal = new bootstrap.Modal(document.getElementById('requestSuccessModal'));
var whNotifModal = document.getElementById('whNotifModal') ? new bootstrap.Modal(document.getElementById('whNotifModal')) : null;
var mrifListModal = document.getElementById('mrifListModal') ? new bootstrap.Modal(document.getElementById('mrifListModal')) : null;
var mrifPrintModal = document.getElementById('mrifPrintModal') ? new bootstrap.Modal(document.getElementById('mrifPrintModal')) : null;
var pendingMrifModal = document.getElementById('pendingMrifModal') ? new bootstrap.Modal(document.getElementById('pendingMrifModal')) : null;
var mrrListModal = document.getElementById('mrrListModal') ? new bootstrap.Modal(document.getElementById('mrrListModal')) : null;
var mrrPrintModal = document.getElementById('mrrPrintModal') ? new bootstrap.Modal(document.getElementById('mrrPrintModal')) : null;
var mrsListModal = document.getElementById('mrsListModal') ? new bootstrap.Modal(document.getElementById('mrsListModal')) : null;
var mrsPrintModal = document.getElementById('mrsPrintModal') ? new bootstrap.Modal(document.getElementById('mrsPrintModal')) : null;
const quickScanModal = new bootstrap.Modal(document.getElementById('quickScanModal'));
const roleModal = new bootstrap.Modal(document.getElementById('roleModal'));
const productionNameModal = new bootstrap.Modal(document.getElementById('productionNameModal'));
state.poScanModal = new bootstrap.Modal(document.getElementById('poScanModal'));
state.poItemsModal = new bootstrap.Modal(document.getElementById('poItemsModal'));

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

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

async function testConnection() {
const resultDiv = document.getElementById('testResult');
resultDiv.classList.remove('d-none');
resultDiv.textContent = 'Testing...';
try {
const url = API_URL + '?action=ping&_t=' + Date.now();
console.log('[Test] URL:', url);
resultDiv.textContent += '\nURL: ' + url.substring(0, 80) + '...';
const res = await fetch(url, { redirect: 'follow' });
console.log('[Test] Status:', res.status);
resultDiv.textContent += '\nHTTP Status: ' + res.status;
const text = await res.text();
console.log('[Test] Response:', text);
resultDiv.textContent += '\nRaw Response: ' + text.substring(0, 200);
try {
const data = JSON.parse(text);
resultDiv.textContent += '\nParsed: ' + JSON.stringify(data, null, 2);
if (data.success) {
resultDiv.textContent += '\n✅ CONNECTION OK - GAS is responding!';
} else {
resultDiv.textContent += '\n⚠️ GAS responded but reported error: ' + data.error;
}
} catch(e) {
resultDiv.textContent += '\n❌ Response is not valid JSON!';
}
} catch(err) {
console.error('[Test] Error:', err);
resultDiv.textContent += '\n❌ FETCH FAILED: ' + err.message;
resultDiv.textContent += '\n\nThis means CORS is blocking the request OR the URL is wrong.';
resultDiv.textContent += '\nMake sure you deployed the NEW Master.gs and updated the URL above.';
}
}

function initRole() {
const role = localStorage.getItem('ivm_userRole');
if (!role) {
roleModal.show();
} else {
applyRoleUI();
if (role === 'warehouse') {
if (!localStorage.getItem('sheetId_MRIF') && !localStorage.getItem('sheetId_MRR')) {
setTimeout(() => settingsModal.show(), 500);
}
selectModule('MRIF');
} else {
checkProductionName();
}
}
}
function selectRole(role) {
if (role === 'production') {
localStorage.setItem('ivm_userRole', 'production');
roleModal.hide();
applyRoleUI();
showToast('Production mode activated', 'success');
checkProductionName();
}
}
function checkProductionName() {
var name = localStorage.getItem('ivm_requestorName');
if (!name) {
productionNameModal.show();
} else {
loadMyRequests();
}
}
function saveProductionName() {
var name = document.getElementById('productionNameInput').value.trim();
if (!name) { alert('Please enter your name'); return; }
localStorage.setItem('ivm_requestorName', name);
productionNameModal.hide();
localStorage.removeItem('ivm_requestStatuses');
loadMyRequests();
}
function showPinEntry() {
document.getElementById('pinEntrySection').classList.remove('d-none');
clearPin();
}
function enterPinDigit(d) {
if (state.pinBuffer.length < 4) {
state.pinBuffer += d;
updatePinDots();
}
}
function backspacePin() {
state.pinBuffer = state.pinBuffer.slice(0, -1);
updatePinDots();
}
function clearPin() {
state.pinBuffer = '';
updatePinDots();
document.getElementById('pinError').classList.add('d-none');
}
function updatePinDots() {
for (let i = 1; i <= 4; i++) {
const dot = document.getElementById('pinDot' + i);
if (i <= state.pinBuffer.length) dot.classList.add('filled');
else dot.classList.remove('filled');
}
}
function verifyPin() {
const storedPin = localStorage.getItem('ivm_warehousePin') || DEFAULT_PIN;
if (state.pinBuffer === storedPin) {
localStorage.setItem('ivm_userRole', 'warehouse');
state.pinAttempts = 0;
roleModal.hide();
applyRoleUI();
showToast('Warehouse mode unlocked', 'success');
if (!localStorage.getItem('sheetId_MRIF') && !localStorage.getItem('sheetId_MRR')) {
setTimeout(() => settingsModal.show(), 500);
}
selectModule('MRIF');
} else {
state.pinAttempts++;
document.getElementById('pinError').classList.remove('d-none');
clearPin();
playErrorBuzz();
if (state.pinAttempts >= 3) {
alert('Too many failed attempts. Please contact admin.');
state.pinAttempts = 0;
}
}
}
function applyRoleUI() {
const role = localStorage.getItem('ivm_userRole');
const isProduction = (role === 'production');
document.getElementById('btnMRR').style.display = isProduction ? 'none' : '';
document.getElementById('btnMRIF').style.display = isProduction ? 'none' : '';
document.getElementById('btnMRS').style.display = isProduction ? 'none' : '';
document.getElementById('productionBanner').classList.toggle('d-none', !isProduction);
document.getElementById('warehouseDashboard').classList.toggle('d-none', isProduction);
document.getElementById('myRequestsSection').classList.toggle('d-none', !isProduction);
document.getElementById('docPickerSection').style.display = isProduction ? 'none' : '';
document.getElementById('quickScanCard').style.display = isProduction ? 'none' : '';
const whBtn = document.getElementById('whNotifBtn');
if (whBtn) whBtn.classList.toggle('d-none', isProduction);
if (isProduction) {
document.getElementById('activeTransactionSection').classList.add('d-none');
document.getElementById('warehouseDashboard').classList.add('d-none');
if (window._requestsInterval) clearInterval(window._requestsInterval);
window._requestsInterval = setInterval(function() {
if (!state.isLoading) loadMyRequests();
}, 30000);
if (window._whInterval) clearInterval(window._whInterval);
} else {
document.getElementById('warehouseDashboard').classList.remove('d-none');
if (window._requestsInterval) clearInterval(window._requestsInterval);
if (window._whInterval) clearInterval(window._whInterval);
window._whInterval = setInterval(function() {
if (!state.isLoading) loadWarehouseNotifications();
}, 30000);
loadWarehouseNotifications();
updateWarehouseKPIs();
}
}

function switchRole() {
settingsModal.hide();
document.getElementById('pinEntrySection').classList.add('d-none');
clearPin();
roleModal.show();
}
function changePin() {
const current = document.getElementById('currentPinInput').value;
const newPin = document.getElementById('newPinInput').value;
const storedPin = localStorage.getItem('ivm_warehousePin') || DEFAULT_PIN;
const msg = document.getElementById('pinChangeMsg');
if (current !== storedPin) {
msg.textContent = 'Current PIN is incorrect';
msg.className = 'small mt-2 text-danger';
return;
}
if (!/^\d{4}$/.test(newPin)) {
msg.textContent = 'New PIN must be exactly 4 digits';
msg.className = 'small mt-2 text-danger';
return;
}
localStorage.setItem('ivm_warehousePin', newPin);
msg.textContent = 'PIN changed successfully';
msg.className = 'small mt-2 text-success';
document.getElementById('currentPinInput').value = '';
document.getElementById('newPinInput').value = '';
}

function openSettings() {
loadSettingsToUI();
const role = localStorage.getItem('ivm_userRole');
const isProduction = (role === 'production');
document.getElementById('pinManagementSection').style.display = isProduction ? 'none' : '';
document.getElementById('syncSection').style.display = isProduction ? 'none' : '';
document.getElementById('sheetIdsSection').style.display = isProduction ? 'none' : '';
document.getElementById('currentRoleDisplay').textContent = role === 'warehouse' ? 'Warehouse Staff' : 'Production Staff';
document.getElementById('currentRoleDisplay').className = role === 'warehouse' ? 'badge bg-success' : 'badge bg-primary';
settingsModal.show();
}
function loadSettingsToUI() {
document.getElementById('sheetId_MRR').value = localStorage.getItem('sheetId_MRR') || '';
document.getElementById('sheetId_MRIF').value = localStorage.getItem('sheetId_MRIF') || '';
document.getElementById('sheetId_MRS').value = localStorage.getItem('sheetId_MRS') || '';
}
function saveSettings() {
const mrr = document.getElementById('sheetId_MRR').value.trim();
const mrif = document.getElementById('sheetId_MRIF').value.trim();
const mrs = document.getElementById('sheetId_MRS').value.trim();
if (mrr) localStorage.setItem('sheetId_MRR', extractSheetId(mrr));
if (mrif) localStorage.setItem('sheetId_MRIF', extractSheetId(mrif));
if (mrs) localStorage.setItem('sheetId_MRS', extractSheetId(mrs));
showToast('Settings saved!', 'success');
settingsModal.hide();
if (state.currentModule) selectModule(state.currentModule);
}
function extractSheetId(url) {
if (!url) return '';
if (url.length === 44 && !url.includes('/')) return url;
const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
return match ? match[1] : url;
}
function getCleanSheetId() {
const key = 'sheetId_' + state.currentModule;
const val = localStorage.getItem(key);
return val ? extractSheetId(val) : '';
}

async function syncModuleLinks() {
if (state.isLoading) return;
showLoading('Syncing...');
try {
const url = API_URL + '?action=getModuleLinks&_t=' + Date.now();
console.log('[Sync] URL:', url);
const res = await fetch(url, { redirect: 'follow' });
console.log('[Sync] HTTP Status:', res.status);
const text = await res.text();
console.log('[Sync] Raw response:', text.substring(0, 500));
let data;
try {
data = JSON.parse(text);
} catch(e) {
console.error('[Sync] JSON parse failed. Raw response:', text);
alert('Sync error: Invalid response from server.\n\nThe server did not return valid JSON.\nCheck the browser console (F12) for details.\n\nFirst 200 chars of response:\n' + text.substring(0, 200));
throw new Error('Invalid response');
}
console.log('[Sync] Parsed:', data);
if (data && data.success && data.links) {
const links = data.links;
const MRIF = links.MRIF || links.mrif || '';
const MRR = links.MRR || links.mrr || '';
const MRS = links.MRS || links.mrs || '';
if (MRIF) { localStorage.setItem('sheetId_MRIF', extractSheetId(MRIF)); document.getElementById('sheetId_MRIF').value = extractSheetId(MRIF); }
if (MRR) { localStorage.setItem('sheetId_MRR', extractSheetId(MRR)); document.getElementById('sheetId_MRR').value = extractSheetId(MRR); }
if (MRS) { localStorage.setItem('sheetId_MRS', extractSheetId(MRS)); document.getElementById('sheetId_MRS').value = extractSheetId(MRS); }
alert('Module IDs synced!\nMRIF: ' + (MRIF?'OK':'Missing') + '\nMRR: ' + (MRR?'OK':'Missing') + '\nMRS: ' + (MRS?'OK':'Missing'));
if (state.currentModule) selectModule(state.currentModule);
} else {
alert('Sync failed: ' + (data.error || 'No links found') + '\n\nResponse: ' + JSON.stringify(data).substring(0, 200));
}
} catch(err) {
console.error('[Sync] Error:', err);
if (err.message !== 'Invalid response') {
alert('Sync error: ' + err.message);
}
} finally {
hideLoading();
}
}

async function selectModule(mod) {
if (state.isLoading) return;
showLoading('Loading ' + mod + '...');
try {
state.currentModule = mod;
document.querySelectorAll('.module-btn').forEach(b => b.classList.remove('active'));
const btn = document.querySelector('.module-btn[data-module="' + mod + '"]');
if (btn) btn.classList.add('active');
document.getElementById('moduleLabel').textContent = mod;
updateLabels();
changeDocument();
await fetchPendingDocs();
var mrifCard = document.getElementById('mrifListCard');
if (mrifCard) mrifCard.classList.toggle('d-none', mod !== 'MRIF');
var mrrCard = document.getElementById('mrrListCard');
if (mrrCard) mrrCard.classList.toggle('d-none', mod !== 'MRR');
var mrsCard = document.getElementById('mrsListCard');
if (mrsCard) mrsCard.classList.toggle('d-none', mod !== 'MRS');
} finally {
hideLoading();
}
}
function updateLabels() {
const isMRR = state.currentModule === 'MRR';
const isMRS = state.currentModule === 'MRS';
document.getElementById('headerExpected').textContent = isMRR ? 'REC. QTY' : (isMRS ? 'QTY RETURNED' : 'Req. Qty');
document.getElementById('headerInput').textContent = isMRR ? 'ATL QTY' : (isMRS ? 'ATL QTY (Actual)' : 'Issued Qty');
}

async function fetchPendingDocs() {
const sheetId = getCleanSheetId();
if (!sheetId) { showToast('No Sheet ID for ' + state.currentModule, 'warning'); return; }
try {
const url = API_URL + '?action=getPendingDocs&docType=' + state.currentModule + '&sheetId=' + sheetId + '&_t=' + Date.now();
const res = await fetch(url, { redirect: 'follow' });
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch(e) { data = []; }
if (data.error) {
showToast('Error: ' + data.error, 'danger');
return;
}
const docs = Array.isArray(data) ? data : (data.docs || data.documents || []);
populateDocSelect(docs);
} catch(err) {
showToast('Failed to load documents', 'danger');
}
}
function populateDocSelect(docs) {
const sel = document.getElementById('docSelect');
sel.innerHTML = '<option value="">-- Select Document --</option>';
state.docList = docs;
docs.forEach(d => {
const val = typeof d === 'string' ? d : (d.docNo || d.name || d);
const opt = document.createElement('option');
opt.value = val;
opt.textContent = cleanDocNo(val);
sel.appendChild(opt);
});
}
function filterDocs() {
const term = document.getElementById('docSearch').value.toLowerCase();
const sel = document.getElementById('docSelect');
sel.innerHTML = '<option value="">-- Select Document --</option>';
if (!state.docList) return;
state.docList.forEach(d => {
const val = typeof d === 'string' ? d : (d.docNo || d.name || d);
if (cleanDocNo(val).toLowerCase().includes(term)) {
const opt = document.createElement('option');
opt.value = val;
opt.textContent = cleanDocNo(val);
sel.appendChild(opt);
}
});
}
async function onDocSelect(docNo) {
if (state.isLoading) return;
if (!docNo) { hideScannerSection(); return; }
showLoading('Loading document...');
try {
clearErrorAlert();
resetDocumentState();
state.currentDoc = docNo;
document.getElementById('docPickerSection').classList.add('d-none');
document.getElementById('activeTransactionSection').classList.remove('d-none');
document.getElementById('docTitle').textContent = cleanDocNo(docNo);
await fetchDocItems(docNo, state.currentModule);
checkForProgress();
} catch(err) {
console.error('[onDocSelect] Error:', err);
showToast('Failed to load document: ' + err.message, 'danger');
// Ensure we hide loading and show the doc picker again
document.getElementById('docPickerSection').classList.remove('d-none');
document.getElementById('activeTransactionSection').classList.add('d-none');
} finally {
hideLoading();
}
}
function changeDocument() {
if (state.currentDoc) {
saveDocProgress();
clearDocProgress(state.currentDoc);
}
state.currentDoc = null;
resetDocumentState();
stopScanner();
document.getElementById('docPickerSection').classList.remove('d-none');
document.getElementById('activeTransactionSection').classList.add('d-none');
document.getElementById('docSelect').value = '';
document.getElementById('resumeBanner').classList.add('d-none');
}
function hideScannerSection() {
document.getElementById('activeTransactionSection').classList.add('d-none');
}
function resetDocumentState() {
state.items = [];
renderItems();
clearErrorAlert();
}

function saveDocProgress() {
if (state.currentDoc && state.items.length > 0) {
var verified = state.items.filter(i => i.verified).length;
if (verified > 0) {
localStorage.setItem('ivm_progress_' + state.currentDoc, JSON.stringify({
module: state.currentModule,
items: state.items,
savedAt: new Date().toISOString()
}));
}
}
}
function clearDocProgress(docNo) {
if (docNo) localStorage.removeItem('ivm_progress_' + docNo);
}
function checkForProgress() {
if (!state.currentDoc) return;
var saved = localStorage.getItem('ivm_progress_' + state.currentDoc);
if (saved) {
document.getElementById('resumeBanner').classList.remove('d-none');
}
}
function resumeProgress() {
if (!state.currentDoc) return;
var saved = localStorage.getItem('ivm_progress_' + state.currentDoc);
if (saved) {
try {
var data = JSON.parse(saved);
if (data.module === state.currentModule && data.items) {
state.items = data.items;
renderItems();
showToast('Progress restored', 'success');
}
} catch(e) {}
}
document.getElementById('resumeBanner').classList.add('d-none');
}

async function fetchDocItems(docNo, docType) {
const sheetId = getCleanSheetId();
if (!sheetId) {
showToast('⚠️ No Sheet ID configured for ' + docType + '. Please go to Settings and sync or enter the Sheet ID.', 'warning');
throw new Error('No Sheet ID');
}
try {
const url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) + '&docType=' + docType + '&sheetId=' + sheetId + '&_t=' + Date.now();
console.log('[fetchDocItems] URL:', url);
const res = await fetch(url, { redirect: 'follow' });
const text = await res.text();
console.log('[fetchDocItems] Raw response:', text.substring(0, 500));
let data;
try { data = JSON.parse(text); } catch(e) { 
console.error('[fetchDocItems] JSON parse error:', e);
showToast('Invalid response from server', 'danger');
throw new Error('Invalid response');
}
if (data.error) {
showToast('Error: ' + data.error, 'danger');
throw new Error(data.error);
}
if (!data.success) {
showToast('Error: ' + (data.error || 'Failed to load document'), 'danger');
throw new Error(data.error || 'Failed to load document');
}
const items = Array.isArray(data) ? data : (data.items || []);
if (items.length === 0) {
showToast('Warning: No items found in this document', 'warning');
}
state.items = items.map((it, idx) => ({
inventoryId: it.inventoryId || it.code || it.itemCode || '',
description: it.description || it.desc || '',
qty: Number(it.qty || it.requestedQty || it.expectedQty || 0),
issuedQty: Number(it.issuedQty || it.actualQty || 0),
unit: it.unit || 'PIECE',
rowIndex: it.rowIndex || (idx + 13),
verified: false
}));
renderItems();
startScanner();
} catch(err) {
console.error('[fetchDocItems] Error:', err);
throw err;
}
}
function renderItems() {
const tbody = document.getElementById('itemsTable');
tbody.innerHTML = '';
let verified = 0;
state.items.forEach((item, idx) => {
if (item.verified) verified++;
const tr = document.createElement('tr');
tr.className = 'item-row' + (item.verified ? ' verified' : '');
tr.innerHTML = '<td><div class="fw-bold small">' + item.inventoryId + '</div><div class="text-muted small">' + item.description + '</div></td>' +
'<td class="text-center">' + item.qty + '</td>' +
'<td class="text-center fw-bold">' + (item.verified ? item.issuedQty : '-') + '</td>' +
'<td class="text-center">' + (item.unit || 'PIECE') + '</td>' +
'<td>' + getStatusBadge(item) + '</td>';
tbody.appendChild(tr);
});
document.getElementById('verifyCount').textContent = verified + '/' + state.items.length + ' Verified';
updateSubmitButton(verified, state.items.length);
}
function getStatusBadge(item) {
if (!item.verified) return '<span class="status-badge status-pending">PENDING</span>';
if (state.currentModule === 'MRR') {
return item.issuedQty >= item.qty ? '<span class="status-badge status-served">COMPLETE</span>' : '<span class="status-badge status-partial">PARTIAL</span>';
}
return item.issuedQty >= item.qty ? '<span class="status-badge status-served">SERVED</span>' : '<span class="status-badge status-partial">PARTIAL</span>';
}
function filterItems() {
const term = document.getElementById('itemFilter').value.toLowerCase();
document.querySelectorAll('#itemsTable tr').forEach(tr => {
const text = tr.textContent.toLowerCase();
tr.style.display = text.includes(term) ? '' : 'none';
});
}
function updateSubmitButton(verified, total) {
const btn = document.getElementById('submitBtn');
const txt = document.getElementById('submitBtnText');
if (total === 0) { btn.disabled = true; txt.textContent = 'No Items'; return; }
btn.disabled = false;
if (verified === total) {
btn.className = 'btn btn-success w-100 mt-3 py-3';
txt.textContent = 'Confirm & Submit';
} else {
btn.className = 'btn btn-warning w-100 mt-3 py-3';
txt.textContent = 'Submit Partial (' + verified + '/' + total + ')';
}
}

function startScanner() {
if (state.html5QrCode) { state.html5QrCode.stop().catch(()=>{}); }
state.html5QrCode = new Html5Qrcode('reader');
Html5Qrcode.getCameras().then(cameras => {
state.cameras = cameras;
if (cameras.length === 0) { showToast('No cameras found', 'warning'); return; }
const camId = state.currentCamera === 'environment' ? cameras.find(c=>c.label.toLowerCase().includes('back'))?.id || cameras[0].id : cameras.find(c=>c.label.toLowerCase().includes('front'))?.id || cameras[0].id;
state.html5QrCode.start(camId, { fps:10, qrbox:{width:200,height:200} }, onScanSuccess, ()=>{}).then(()=>{
document.getElementById('torchBtn').classList.remove('d-none');
}).catch(err => showToast('Camera error: ' + err, 'danger'));
}).catch(err => showToast('Camera access denied', 'danger'));
}
function stopScanner() {
if (state.html5QrCode) { state.html5QrCode.stop().catch(()=>{}); state.html5QrCode = null; }
}
function onScanSuccess(decodedText) {
clearErrorAlert();

// ─── Check if it's a URL with ?doc= parameter (QR from new request) ───
var urlDocMatch = decodedText.match(/[?&]doc=([^&\s]+)/);
if (urlDocMatch) {
  var extractedDoc = decodeURIComponent(urlDocMatch[1]);
  console.log('[Scan] Extracted doc from URL:', extractedDoc);
  var mod = 'MRIF';
  if (extractedDoc.indexOf('MRR') === 0) mod = 'MRR';
  else if (extractedDoc.indexOf('MRS') === 0) mod = 'MRS';
  playSuccessBeep();
  showToast('Loading document ' + cleanDocNo(extractedDoc) + '...', 'success');
  // FIX: await selectModule before loading document
  selectModule(mod).then(() => {
    onDocSelect(extractedDoc);
  }).catch(err => {
    console.error('[onScanSuccess] Error switching module:', err);
    showToast('Failed to switch module: ' + err.message, 'danger');
  });
  return;
}

// ─── Check if it's a plain document number ───
const docPattern = /^(MRIF|MRR|MRS)\d{6,}/i;
if (docPattern.test(decodedText)) {
playSuccessBeep();
if (confirm('Document QR detected: ' + decodedText + '\n\nSwitch to this document?')) {
const mod = decodedText.substring(0, 4).toUpperCase();
if (['MRIF','MRR','MRS'].includes(mod)) {
selectModule(mod).then(() => {
  onDocSelect(decodedText);
}).catch(err => {
  console.error('[onScanSuccess] Error switching module:', err);
  showToast('Failed to switch module: ' + err.message, 'danger');
});
}
}
return;
}

// ─── Try as Item QR (existing document) ───
const item = state.items.find(i => i.inventoryId.toLowerCase() === decodedText.toLowerCase());
if (!item) {
playErrorBuzz();
showMismatchAlert(decodedText);
return;
}
playSuccessBeep();
openQtyModal(item);
}
function manualVerify() {
if (state.isLoading) return;
const val = document.getElementById('manualInput').value.trim();
if (!val) return;
document.getElementById('manualInput').value = '';
onScanSuccess(val);
}
function toggleTorch() {
const video = document.querySelector('#reader video');
if (!video || !video.srcObject) return;
const track = video.srcObject.getVideoTracks()[0];
if (!track) return;
const caps = track.getCapabilities();
if (!caps.torch) { showToast('Flashlight not supported', 'warning'); return; }
state.torchOn = !state.torchOn;
track.applyConstraints({ advanced:[{torch:state.torchOn}] }).then(()=>{
document.getElementById('torchBtn').classList.toggle('active', state.torchOn);
showToast(state.torchOn ? 'Flashlight ON' : 'Flashlight OFF', 'info');
}).catch(()=>showToast('Torch failed', 'warning'));
}
function switchCamera() {
state.currentCamera = state.currentCamera === 'environment' ? 'user' : 'environment';
startScanner();
}

function openQuickScan() {
if (state.isLoading) return;
quickScanModal.show();
setTimeout(startQuickScanner, 300);
}
function closeQuickScan() {
if (state.quickScanner) {
state.quickScanner.stop().catch(()=>{});
state.quickScanner = null;
}
quickScanModal.hide();
}
function startQuickScanner() {
if (state.quickScanner) { state.quickScanner.stop().catch(()=>{}); }
const el = document.getElementById('quickReader');
if (!el) return;
state.quickScanner = new Html5Qrcode('quickReader');
Html5Qrcode.getCameras().then(cameras => {
if (cameras.length === 0) { showToast('No cameras found', 'warning'); return; }
const camId = cameras.find(c=>c.label.toLowerCase().includes('back'))?.id || cameras[0].id;
state.quickScanner.start(camId, { fps:10, qrbox:{width:250,height:250} }, onQuickScanSuccess, ()=>{}).catch(err => {
showToast('Quick scan camera error: ' + err, 'danger');
});
}).catch(err => showToast('Camera access denied', 'danger'));
}
async function onQuickScanSuccess(decodedText) {
if (state.quickScanner) {
state.quickScanner.stop().catch(()=>{});
state.quickScanner = null;
}
quickScanModal.hide();

// ─── Check if it's a URL with ?doc= parameter (QR from new request) ───
var urlDocMatch = decodedText.match(/[?&]doc=([^&\s]+)/);
if (urlDocMatch) {
  var extractedDoc = decodeURIComponent(urlDocMatch[1]);
  console.log('[QuickScan] Extracted doc from URL:', extractedDoc);
  var mod = 'MRIF';
  if (extractedDoc.indexOf('MRR') === 0) mod = 'MRR';
  else if (extractedDoc.indexOf('MRS') === 0) mod = 'MRS';
  playSuccessBeep();
  
  // ─── Check if sheet ID is set ───
  var sheetKey = 'sheetId_' + mod;
  var sheetId = localStorage.getItem(sheetKey);
  if (!sheetId || !extractSheetId(sheetId)) {
    showToast('⚠️ Sheet ID for ' + mod + ' is missing. Please go to Settings and sync or enter the Sheet ID.', 'warning');
    // Also try to sync automatically
    await syncModuleLinks();
    // Check again after sync
    sheetId = localStorage.getItem(sheetKey);
    if (!sheetId || !extractSheetId(sheetId)) {
      showToast('Still missing Sheet ID. Please set it manually in Settings.', 'danger');
      return;
    }
  }
  
  showToast('Loading document ' + cleanDocNo(extractedDoc) + '...', 'success');
  try {
    await selectModule(mod);
    await onDocSelect(extractedDoc);
  } catch(err) {
    console.error('[QuickScan] Error loading document:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
    // Show the doc picker again so user can try manually
    document.getElementById('docPickerSection').classList.remove('d-none');
    document.getElementById('activeTransactionSection').classList.add('d-none');
  }
  return;
}

// ─── Check if it's a plain document number ───
const docPattern = /^(MRIF|MRR|MRS)\d{6,}/i;
if (docPattern.test(decodedText)) {
const mod = decodedText.substring(0, 4).toUpperCase();
if (['MRIF','MRR','MRS'].includes(mod)) {
  playSuccessBeep();
  // ─── Check if sheet ID is set ───
  var sheetKey = 'sheetId_' + mod;
  var sheetId = localStorage.getItem(sheetKey);
  if (!sheetId || !extractSheetId(sheetId)) {
    showToast('⚠️ Sheet ID for ' + mod + ' is missing. Please go to Settings and sync or enter the Sheet ID.', 'warning');
    await syncModuleLinks();
    sheetId = localStorage.getItem(sheetKey);
    if (!sheetId || !extractSheetId(sheetId)) {
      showToast('Still missing Sheet ID. Please set it manually in Settings.', 'danger');
      return;
    }
  }
  showToast('Loading document ' + cleanDocNo(decodedText) + '...', 'success');
  try {
    await selectModule(mod);
    await onDocSelect(decodedText);
  } catch(err) {
    console.error('[QuickScan] Error loading document:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
    document.getElementById('docPickerSection').classList.remove('d-none');
    document.getElementById('activeTransactionSection').classList.add('d-none');
  }
  return;
}
}

// ─── Try as PO Number (for MRR creation) ───
const poResult = await lookupPoFromScan(decodedText);
if (poResult && poResult.success) {
playSuccessBeep();
state.currentPoNo = decodedText;
state.currentPoPrf = poResult.prfNo || '';
state.currentPoClient = poResult.client || '';
state.currentPoSupplier = poResult.supplier || poResult.client || '';
state.poItemsData = poResult.items;
renderPoItems();
state.poItemsModal.show();
return;
}

// ─── Try as Item QR (existing document) ───
if (state.currentDoc && state.items.length > 0) {
const item = state.items.find(i => i.inventoryId.toLowerCase() === decodedText.toLowerCase());
if (item) {
playSuccessBeep();
document.getElementById('docPickerSection').classList.add('d-none');
document.getElementById('activeTransactionSection').classList.remove('d-none');
openQtyModal(item);
return;
}
}

playErrorBuzz();
showToast('Not recognized: ' + decodedText + '. Scan a Document QR, PO QR, or Item QR.', 'danger');
}

async function lookupPoFromScan(poNo) {
try {
const url = API_URL + '?action=getPoItems&poNo=' + encodeURIComponent(poNo) + '&_t=' + Date.now();
const res = await fetch(url, { redirect: 'follow' });
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch(e) { return null; }
return (data && data.success) ? data : null;
} catch(err) {
return null;
}
}

async function manualPoLookup() {
const poNo = document.getElementById('manualPoInput').value.trim();
if (!poNo) { showToast('Please enter a PO number', 'warning'); return; }
document.getElementById('manualPoInput').value = '';
showLoading('Looking up PO...');
try {
const poResult = await lookupPoFromScan(poNo);
if (poResult && poResult.success) {
playSuccessBeep();
state.currentPoNo = poNo;
state.currentPoPrf = poResult.prfNo || '';
state.currentPoClient = poResult.client || '';
state.currentPoSupplier = poResult.supplier || poResult.client || '';
state.poItemsData = poResult.items;
renderPoItems();
state.poItemsModal.show();
} else {
showToast((poResult && poResult.error) || 'No items found for PO: ' + poNo, 'warning');
}
} catch(err) {
showToast('Error: ' + err.message, 'danger');
} finally {
hideLoading();
}
}

function closePoItemsModal() {
state.poItemsModal.hide();
}

let currentModalItem = null;
function openQtyModal(item) {
currentModalItem = item;
const isMRR = state.currentModule === 'MRR';
const isMRS = state.currentModule === 'MRS';
document.getElementById('modalItemCode').textContent = item.inventoryId;
document.getElementById('modalItemDesc').textContent = item.description;
document.getElementById('modalExpectedLabel').textContent = isMRR ? 'REC. QTY' : (isMRS ? 'QTY RETURNED' : 'Requested Qty');
document.getElementById('modalExpectedQty').value = item.qty;
document.getElementById('modalInputLabel').textContent = isMRR ? 'ATL QTY (Received)' : (isMRS ? 'ATL QTY (Actual Returned)' : 'Enter Issued Qty');
document.getElementById('modalInputQty').value = item.qty;

var unitSelect = document.getElementById('modalUnit');
unitSelect.innerHTML = buildUnitOptions(item.unit || 'PIECE');

document.getElementById('modalHint').textContent = isMRR ? 'MRR Mode: You may receive any quantity.' : (isMRS ? 'MRS Mode: Returned qty cannot exceed expected.' : 'MRIF Mode: Issued qty cannot exceed requested.');
document.getElementById('modalInputQty').classList.remove('is-invalid');
qtyModal.show();
}
function onQtyInput() {
clearErrorAlert();
document.getElementById('modalInputQty').classList.remove('is-invalid');
}
function confirmQty() {
if (state.isLoading) return;
if (!currentModalItem) return;
const input = document.getElementById('modalInputQty');
const qtyVal = parseInt(input.value, 10);
if (isNaN(qtyVal) || qtyVal < 0) {
input.classList.add('is-invalid');
playErrorBuzz();
return;
}
const isMRR = state.currentModule === 'MRR';
if (!isMRR && qtyVal > currentModalItem.qty) {
const max = currentModalItem.qty;
const msg = state.currentModule === 'MRS'
? 'Returned Qty cannot exceed Expected Qty (Max: ' + max + ')'
: 'Issued Qty cannot exceed Requested Qty (Max: ' + max + ')';
showExceedError(msg);
input.value = max;
input.classList.add('is-invalid');
playErrorBuzz();
return;
}
var unitSelect = document.getElementById('modalUnit');
var selectedUnit = unitSelect.value || 'PIECE';

currentModalItem.issuedQty = qtyVal;
currentModalItem.unit = selectedUnit;
currentModalItem.verified = true;
saveDocProgress();
renderItems();
qtyModal.hide();
playSuccessBeep();
}
function showMismatchAlert(code) {
const alert = document.getElementById('mismatchAlert');
document.getElementById('mismatchText').textContent = 'Item "' + code + '" not found in this document.';
alert.classList.remove('d-none');
clearTimeout(state.errorTimer);
state.errorTimer = setTimeout(() => clearErrorAlert(), 4000);
}
function showExceedError(msg) {
const alert = document.getElementById('exceedErrorAlert');
document.getElementById('exceedText').textContent = 'Error: ' + msg;
alert.classList.remove('d-none');
clearTimeout(state.errorTimer);
state.errorTimer = setTimeout(() => clearErrorAlert(), 4000);
}
function clearErrorAlert() {
const a1 = document.getElementById('mismatchAlert');
const a2 = document.getElementById('exceedErrorAlert');
if (a1) a1.classList.add('d-none');
if (a2) a2.classList.add('d-none');
}

async function onSubmit() {
if (state.isLoading) return;
const verifiedItems = state.items.filter(i => i.verified);
const total = state.items.length;
const verified = verifiedItems.length;
if (verified === 0) {
showToast('No items verified. Scan or enter items first.', 'warning');
return;
}
if (verified < total) {
if (!confirm('You have ' + (total - verified) + ' unverified item(s). Submit partial transaction now?\nOnly scanned/entered items will be sent.')) {
return;
}
}
showLoading('Submitting...');
try {
const result = await submitTransaction(verifiedItems);
console.log('[Submit] Result:', result);
if (result && result.success === true) {
try {
var allComplete = true;
var anyProcessed = false;
state.items.forEach(function(it) {
if (!it.verified) { allComplete = false; }
else { anyProcessed = true; if (it.issuedQty < it.qty) allComplete = false; }
});
var newStatus = allComplete && anyProcessed ? 'COMPLETED' : (anyProcessed ? 'PARTIAL' : 'PENDING');
var statusUrl = API_URL + '?action=updateDocStatus&docNo=' + encodeURIComponent(state.currentDoc) + '&status=' + newStatus + '&_t=' + Date.now();
console.log('[Submit] Updating DOCLINKS status:', newStatus);
var statusRes = await fetch(statusUrl, { redirect: 'follow' });
var statusData = await statusRes.json();
console.log('[Submit] DOCLINKS update:', statusData);
if (statusData && statusData.success) {
showToast('Request status updated to ' + newStatus, 'success');
} else {
showToast('Warning: Could not update status. Error: ' + (statusData.error || 'Unknown'), 'warning');
}
} catch(statusErr) {
console.error('[Submit] DOCLINKS update error:', statusErr);
showToast('Warning: Status update failed', 'danger');
}
clearDocProgress(state.currentDoc);
successModal.show();
setTimeout(() => location.reload(), 2000);
} else {
showToast('Error: ' + (result.error || 'Submission failed'), 'danger');
}
} catch(err) {
console.error('[Submit] Error:', err);
showToast('Submit error: ' + err.message, 'danger');
} finally {
hideLoading();
}
}

async function submitTransaction(verifiedItems) {
const itemsStr = verifiedItems.map(i => 
encodeURIComponent(i.inventoryId) + ',' + i.issuedQty + ',' + i.rowIndex + ',' + encodeURIComponent(i.unit || 'PIECE')
).join(';');
const url = API_URL + '?action=submitTransaction' +
'&docNo=' + encodeURIComponent(state.currentDoc) +
'&docType=' + encodeURIComponent(state.currentModule) +
'&sheetId=' + encodeURIComponent(getCleanSheetId()) +
'&items=' + itemsStr +
'&_t=' + Date.now();
console.log('[Submit] URL length:', url.length);
console.log('[Submit] URL:', url);
const res = await fetch(url, { redirect: 'follow' });
console.log('[Submit] HTTP Status:', res.status);
const text = await res.text();
console.log('[Submit] Raw response:', text);
const result = JSON.parse(text);
console.log('[Submit] Parsed:', result);
return result;
}

// =============================================================================
// NEW REQUEST FUNCTIONS - WITH UNIT DROPDOWN
// =============================================================================
function openNewRequest() {
if (state.isLoading) return;
resetWizard();
loadRequestInventory();
loadRequestorList();
newRequestModal.show();
}

function resetWizard() {
  document.getElementById('reqDocType').value = '';
  document.getElementById('reqJoNo').value = '';
  document.getElementById('reqRequestor').value = '';
  document.getElementById('reqDepartment').value = '';
  document.getElementById('reqGemSoNo').value = '';
  document.getElementById('reqClientName').value = '';
  document.getElementById('reqProject').value = '';

  document.querySelectorAll('.doc-type-card').forEach(function(c) { c.classList.remove('selected'); });
  document.getElementById('btnStep1Next').disabled = true;

  document.getElementById('step2JoNo').value = '';
  document.getElementById('joNoStatus').innerHTML = '';

  document.getElementById('step3Requestor').value = '';
  document.getElementById('step3Department').value = '';
  document.getElementById('btnStep3Next').disabled = true;

  document.getElementById('step5ItemsContainer').innerHTML = '';
  addStep5ItemRow();
  document.getElementById('btnStep5Next').disabled = true;

  goToStep(1);
}

function goToStep(step) {
  document.querySelectorAll('.wizard-step').forEach(function(el) {
    var s = parseInt(el.getAttribute('data-step'));
    el.classList.remove('active', 'completed');
    if (s === step) {
      el.classList.add('active');
    } else if (s < step) {
      el.classList.add('completed');
    }
  });

  document.querySelectorAll('.wizard-panel').forEach(function(el) {
    el.classList.remove('active');
  });
  var panel = document.getElementById('step' + step);
  if (panel) panel.classList.add('active');

  if (step === 4) {
    populateReviewData();
  }

  if (step === 6) {
    populateFinalReview();
  }
}

function selectDocType(type) {
  document.getElementById('reqDocType').value = type;
  document.querySelectorAll('.doc-type-card').forEach(function(c) { c.classList.remove('selected'); });
  document.getElementById('docType' + type).classList.add('selected');
  document.getElementById('btnStep1Next').disabled = false;
}

function onJoNoInput() {
  var val = document.getElementById('step2JoNo').value.trim();
  var status = document.getElementById('joNoStatus');
  if (val.length > 0) {
    status.innerHTML = '<span class="text-muted"><i class="bi bi-info-circle"></i> Click <strong>Next</strong> to look up SOF data</span>';
  } else {
    status.innerHTML = '';
  }
}

async function doStep2Next() {
  var joNo = document.getElementById('step2JoNo').value.trim();
  if (!joNo) {
    document.getElementById('joNoStatus').innerHTML = '<span class="text-danger"><i class="bi bi-exclamation-circle"></i> Please enter a JO No.</span>';
    return;
  }

  document.getElementById('joNoStatus').innerHTML = '<span class="text-primary"><i class="bi bi-arrow-repeat spin"></i> Looking up SOF data...</span>';

  document.getElementById('reqJoNo').value = joNo;

  await lookupSofDataWizard();

  goToStep(3);
}

async function lookupSofDataWizard() {
  var joNo = document.getElementById('reqJoNo').value.trim();
  if (!joNo) return;

  showLoading('Looking up JO No....');
  try {
    var url = API_URL + '?action=getSofData&joNo=' + encodeURIComponent(joNo) + '&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch(e) { data = {}; }

    if (data.success) {
      document.getElementById('reqGemSoNo').value = data.gemSoNo || '';
      document.getElementById('reqClientName').value = data.clientName || '';
      document.getElementById('reqProject').value = data.project || '';
      document.getElementById('joNoStatus').innerHTML = '<span class="text-success"><i class="bi bi-check-circle"></i> JO No. found! SO data auto-filled.</span>';
      showToast('JO No. found! Auto-filled SO data.', 'success');
    } else {
      document.getElementById('reqGemSoNo').value = '';
      document.getElementById('reqClientName').value = '';
      document.getElementById('reqProject').value = '';
      document.getElementById('joNoStatus').innerHTML = '<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> JO No. not found. You can still proceed.</span>';
      showToast('JO No. not found in SOF Monitoring. You can still submit.', 'warning');
    }
  } catch(err) {
    document.getElementById('joNoStatus').innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> Lookup failed.</span>';
    showToast('SOF lookup failed: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

function onStep3RequestorChange() {
  var sel = document.getElementById('step3Requestor');
  var selected = sel.options[sel.selectedIndex];
  var name = sel.value;
  var dept = selected ? selected.dataset.department : '';

  document.getElementById('reqRequestor').value = name;
  document.getElementById('reqDepartment').value = dept || '';
  document.getElementById('step3Department').value = dept || '';

  document.getElementById('btnStep3Next').disabled = !name;
}

function populateReviewData() {
  var docType = document.getElementById('reqDocType').value;
  var joNo = document.getElementById('reqJoNo').value;
  var requestor = document.getElementById('reqRequestor').value;
  var dept = document.getElementById('reqDepartment').value;
  var gemSo = document.getElementById('reqGemSoNo').value;
  var client = document.getElementById('reqClientName').value;
  var project = document.getElementById('reqProject').value;

  document.getElementById('reviewDocType').textContent = docType || '-';
  document.getElementById('reviewJoNo').textContent = joNo || '-';
  document.getElementById('reviewGemSoNo').textContent = gemSo || '-';
  document.getElementById('reviewClientName').textContent = client || '-';
  document.getElementById('reviewProject').textContent = project || '-';
  document.getElementById('reviewRequestor').textContent = requestor || '-';
  document.getElementById('reviewDepartment').textContent = dept || '-';
}

function addStep5ItemRow() {
  var container = document.getElementById('step5ItemsContainer');
  var idx = container.children.length;
  var div = document.createElement('div');
  div.className = 'step5-item-row';
  div.innerHTML = '<div class="row g-2 align-items-end">' +
    '<div class="col-12 col-md-4">' +
      '<label class="form-label small">Item</label>' +
      '<input type="text" class="form-control req-item-search" placeholder="Type to search..." oninput="filterStep5Items(this,' + idx + ')" onfocus="filterStep5Items(this,' + idx + ')">' +
      '<div class="list-group position-absolute z-3 d-none req-dropdown" style="max-height:150px;overflow-y:auto;width:90%;" id="step5Dropdown' + idx + '"></div>' +
      '<input type="hidden" class="req-item-code" id="step5Code' + idx + '">' +
      '<input type="hidden" class="req-item-desc" id="step5Desc' + idx + '">' +
    '</div>' +
    '<div class="col-3 col-md-2">' +
      '<label class="form-label small">Qty</label>' +
      '<input type="number" class="form-control req-qty" min="1" value="1">' +
    '</div>' +
    '<div class="col-3 col-md-3">' +
      '<label class="form-label small">Unit</label>' +
      '<select class="form-select req-unit">' +
        buildUnitOptions('PIECE') +
      '</select>' +
    '</div>' +
    '<div class="col-2 col-md-3">' +
      '<button class="btn btn-outline-danger btn-sm w-100" onclick="this.closest(\'.step5-item-row\').remove(); checkStep5Items();">' +
        '<i class="bi bi-trash"></i> Remove' +
      '</button>' +
    '</div>' +
  '</div>';
  container.appendChild(div);
  checkStep5Items();
}

function filterStep5Items(input, idx) {
  var term = input.value.toLowerCase();
  var dropdown = document.getElementById('step5Dropdown' + idx);
  dropdown.innerHTML = '';
  if (!term) { dropdown.classList.add('d-none'); return; }

  var matches = state.requestInventoryList.filter(function(it) {
    var code = (it.code || it.inventoryId || '').toLowerCase();
    var desc = (it.description || '').toLowerCase();
    return code.includes(term) || desc.includes(term);
  }).slice(0, 10);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="list-group-item text-muted">No matches</div>';
  } else {
    matches.forEach(function(it) {
      var code = it.code || it.inventoryId || '';
      var desc = it.description || '';
      var unit = it.unit || 'PIECE';
      var el = document.createElement('div');
      el.className = 'list-group-item list-group-item-action';
      el.innerHTML = '<div class="fw-bold small">' + code + '</div><div class="small text-muted">' + desc + '</div>';
      el.onclick = function() {
        input.value = code + ' - ' + desc;
        document.getElementById('step5Code' + idx).value = code;
        document.getElementById('step5Desc' + idx).value = desc;
        var unitSelect = input.closest('.step5-item-row').querySelector('.req-unit');
        if (unitSelect && unitSelect.querySelector('option[value="' + unit + '"]')) {
          unitSelect.value = unit;
        }
        dropdown.classList.add('d-none');
        checkStep5Items();
      };
      dropdown.appendChild(el);
    });
  }
  dropdown.classList.remove('d-none');
}

function checkStep5Items() {
  var hasItems = false;
  document.querySelectorAll('#step5ItemsContainer .step5-item-row').forEach(function(row) {
    var code = row.querySelector('.req-item-code').value;
    if (code) hasItems = true;
  });
  document.getElementById('btnStep5Next').disabled = !hasItems;
}

function populateFinalReview() {
  document.getElementById('finalDocType').textContent = document.getElementById('reqDocType').value || '-';
  document.getElementById('finalJoNo').textContent = document.getElementById('reqJoNo').value || '-';
  document.getElementById('finalRequestor').textContent = document.getElementById('reqRequestor').value || '-';
  document.getElementById('finalDepartment').textContent = document.getElementById('reqDepartment').value || '-';
  document.getElementById('finalGemSoNo').textContent = document.getElementById('reqGemSoNo').value || '-';
  document.getElementById('finalClientName').textContent = document.getElementById('reqClientName').value || '-';
  document.getElementById('finalProject').textContent = document.getElementById('reqProject').value || '-';

  var tbody = document.getElementById('finalItemsTable');
  tbody.innerHTML = '';
  var rows = document.querySelectorAll('#step5ItemsContainer .step5-item-row');
  var count = 0;
  rows.forEach(function(row, i) {
    var code = row.querySelector('.req-item-code').value;
    var desc = row.querySelector('.req-item-desc').value;
    var qty = row.querySelector('.req-qty').value;
    var unit = row.querySelector('.req-unit').value;
    if (code) {
      count++;
      tbody.innerHTML += '<tr><td>' + count + '</td><td>' + code + '</td><td>' + desc + '</td><td>' + qty + '</td><td>' + unit + '</td></tr>';
    }
  });
}

async function loadRequestorList() {
try {
const url = API_URL + '?action=getRequestorList&_t=' + Date.now();
const res = await fetch(url, { redirect: 'follow' });
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch(e) { data = {}; }

const sel = document.getElementById('reqRequestor');
sel.innerHTML = '<option value="">-- Select Requestor --</option>';

const sel3 = document.getElementById('step3Requestor');
sel3.innerHTML = '<option value="">-- Select Requestor --</option>';

if (data.success && data.requestors) {
state.requestorList = data.requestors;
data.requestors.forEach(r => {
var opt = document.createElement('option');
opt.value = r.name;
opt.textContent = r.name;
opt.dataset.department = r.department;
sel.appendChild(opt);

var opt3 = document.createElement('option');
opt3.value = r.name;
opt3.textContent = r.name;
opt3.dataset.department = r.department;
sel3.appendChild(opt3);
});
}
} catch(err) {
console.error('Failed to load requestor list:', err);
}
}

function onRequestorChange() {
const sel = document.getElementById('reqRequestor');
const selected = sel.options[sel.selectedIndex];
const dept = selected ? selected.dataset.department : '';
document.getElementById('reqDepartment').value = dept || '';
}

async function lookupSofData() {
const joNo = document.getElementById('reqJoNo').value.trim();
if (!joNo) return;
showLoading('Looking up JO No....');
try {
const url = API_URL + '?action=getSofData&joNo=' + encodeURIComponent(joNo) + '&_t=' + Date.now();
const res = await fetch(url, { redirect: 'follow' });
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch(e) { data = {}; }
if (data.success) {
document.getElementById('reqGemSoNo').value = data.gemSoNo || '';
document.getElementById('reqClientName').value = data.clientName || '';
document.getElementById('reqProject').value = data.project || '';
showToast('JO No. found! Auto-filled SO data.', 'success');
} else {
document.getElementById('reqGemSoNo').value = '';
document.getElementById('reqClientName').value = '';
document.getElementById('reqProject').value = '';
showToast('JO No. not found in SOF Monitoring. You can still submit.', 'warning');
}
} catch(err) {
showToast('SOF lookup failed: ' + err.message, 'danger');
} finally {
hideLoading();
}
}

async function loadRequestInventory() {
try {
const url = API_URL + '?action=getInventoryList&_t=' + Date.now();
const res = await fetch(url, { redirect: 'follow' });
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch(e) { data = {}; }
const inv = data.inventory || data.items || [];
state.requestInventoryList = inv;
} catch(err) {
state.requestInventoryList = [];
}
}

function addRequestItemRow() {
const container = document.getElementById('requestItemsContainer');
const idx = container.children.length;
const div = document.createElement('div');
div.className = 'row g-2 mb-2 align-items-end';
div.innerHTML = '<div class="col-4"><label class="form-label small">Item</label><input type="text" class="form-control req-item-search" placeholder="Type to search..." oninput="filterRequestItems(this,'+idx+')" onfocus="filterRequestItems(this,'+idx+')"><div class="list-group position-absolute z-3 d-none req-dropdown" style="max-height:150px;overflow-y:auto;" id="reqDropdown'+idx+'"></div><input type="hidden" class="req-item-code" id="reqCode'+idx+'"><input type="hidden" class="req-item-desc" id="reqDesc'+idx+'"></div>' +
'<div class="col-3"><label class="form-label small">Qty</label><input type="number" class="form-control req-qty" min="1" value="1"></div>' +
'<div class="col-3"><label class="form-label small">Unit</label><select class="form-select req-unit">' + buildUnitOptions('PIECE') + '</select></div>' +
'<div class="col-2"><button class="btn btn-outline-danger btn-sm" onclick="this.closest(\'.row\').remove()"><i class="bi bi-trash"></i></button></div>';
container.appendChild(div);
}

function filterRequestItems(input, idx) {
const term = input.value.toLowerCase();
const dropdown = document.getElementById('reqDropdown'+idx);
dropdown.innerHTML = '';
if (!term) { dropdown.classList.add('d-none'); return; }
const matches = state.requestInventoryList.filter(it => {
const code = (it.code || it.inventoryId || '').toLowerCase();
const desc = (it.description || '').toLowerCase();
return code.includes(term) || desc.includes(term);
}).slice(0, 10);
if (matches.length === 0) {
dropdown.innerHTML = '<div class="list-group-item text-muted">No matches</div>';
} else {
matches.forEach(it => {
const code = it.code || it.inventoryId || '';
const desc = it.description || '';
const unit = it.unit || 'PIECE';
const el = document.createElement('div');
el.className = 'list-group-item list-group-item-action';
el.innerHTML = '<div class="fw-bold small">' + code + '</div><div class="small text-muted">' + desc + '</div>';
el.onclick = () => {
input.value = code + ' - ' + desc;
document.getElementById('reqCode'+idx).value = code;
document.getElementById('reqDesc'+idx).value = desc;
var unitSelect = input.closest('.row').querySelector('.req-unit');
if (unitSelect && unitSelect.querySelector('option[value="' + unit + '"]')) {
unitSelect.value = unit;
}
dropdown.classList.add('d-none');
};
dropdown.appendChild(el);
});
}
dropdown.classList.remove('d-none');
}

async function submitNewRequest() {
if (state.isLoading) return;
const docType = document.getElementById('reqDocType').value;
const requestor = document.getElementById('reqRequestor').value.trim();
const department = document.getElementById('reqDepartment').value.trim();
const joNo = document.getElementById('reqJoNo').value.trim();
const gemSoNo = document.getElementById('reqGemSoNo').value.trim();
const clientName = document.getElementById('reqClientName').value.trim();
const project = document.getElementById('reqProject').value.trim();
if (!requestor) { alert('Select a requestor'); return; }

const items = [];
document.querySelectorAll('#step5ItemsContainer .step5-item-row').forEach(function(row) {
const code = row.querySelector('.req-item-code').value;
const desc = row.querySelector('.req-item-desc').value;
const qty = parseInt(row.querySelector('.req-qty').value, 10);
const unit = row.querySelector('.req-unit').value || 'PIECE';
if (code && qty > 0) items.push({ inventoryId: code, description: desc, qty: qty, unit: unit });
});

document.querySelectorAll('#requestItemsContainer .row').forEach(function(row) {
const code = row.querySelector('.req-item-code');
const desc = row.querySelector('.req-item-desc');
const qty = row.querySelector('.req-qty');
const unit = row.querySelector('.req-unit');
if (code && desc && qty) {
var c = code.value;
var d = desc.value;
var q = parseInt(qty.value, 10);
var u = unit ? unit.value : 'PIECE';
if (c && q > 0) items.push({ inventoryId: c, description: d, qty: q, unit: u });
}
});

if (items.length === 0) { alert('Add at least one item'); return; }
showLoading('Creating request...');
try {
const payload = {
action: 'createRequest',
docType: docType,
requestor: requestor,
department: department,
joNo: joNo,
gemSoNo: gemSoNo,
clientName: clientName,
project: project,
items: items,
timestamp: new Date().toISOString()
};
const res = await fetch(API_URL, {
method: 'POST',
body: JSON.stringify(payload),
headers: { 'Content-Type': 'text/plain;charset=utf-8' },
redirect: 'follow'
});
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
if (data && data.success) {
localStorage.setItem('ivm_requestorName', requestor);
newRequestModal.hide();
showRequestQr(data.ticketNo || 'N/A', data.docNo || 'N/A');
var statuses = JSON.parse(localStorage.getItem('ivm_requestStatuses') || '{}');
statuses[data.docNo] = 'PENDING';
localStorage.setItem('ivm_requestStatuses', JSON.stringify(statuses));
loadMyRequests();
} else {
alert('Failed: ' + (data.error || 'Unknown error'));
}
} catch(err) {
alert('Error: ' + err.message);
} finally {
hideLoading();
}
}

function downloadRequestQr() {
  if (!lastQrDocNo || !lastQrTicketNo) {
    showToast('No QR to download', 'warning');
    return;
  }
  // Get the QR image element
  const img = document.getElementById('requestQrImg');
  if (!img || !img.src || img.src === '') {
    showToast('QR image not loaded', 'warning');
    return;
  }

  // Create a canvas with text + QR
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Load the image
  const qrImg = new Image();
  qrImg.crossOrigin = 'Anonymous';
  qrImg.onload = function() {
    // Set canvas size: QR image width, plus padding for text
    const padding = 30;
    const textHeight = 70; // space for two lines of text
    const width = qrImg.width + padding * 2;
    const height = qrImg.height + padding * 2 + textHeight;
    canvas.width = width;
    canvas.height = height;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Draw text at top
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText('Ticket: ' + lastQrTicketNo, width/2, 10);
    ctx.font = '14px Arial, sans-serif';
    ctx.fillText('Doc: ' + lastQrDocNo, width/2, 32);

    // Draw QR code below text
    ctx.drawImage(qrImg, padding, padding + textHeight);

    // Trigger download
    const link = document.createElement('a');
    link.download = 'QR-' + lastQrDocNo + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  qrImg.onerror = function() {
    showToast('Failed to load QR image for download', 'danger');
  };
  qrImg.src = img.src;
}

async function shareRequestQr() {
  if (!navigator.share) {
    showToast('Share not supported on this device', 'warning');
    return;
  }
  if (!lastQrDocNo || !lastQrTicketNo) {
    showToast('No QR to share', 'warning');
    return;
  }

  const img = document.getElementById('requestQrImg');
  if (!img || !img.src) {
    showToast('QR image not loaded', 'warning');
    return;
  }

  try {
    // Fetch the image as a blob
    const response = await fetch(img.src);
    const blob = await response.blob();
    const file = new File([blob], 'QR-' + lastQrDocNo + '.png', { type: 'image/png' });
    await navigator.share({
      title: 'GEMCOR Request QR',
      text: 'Ticket: ' + lastQrTicketNo + '\nDoc: ' + lastQrDocNo,
      files: [file]
    });
  } catch(err) {
    if (err.name !== 'AbortError') {
      showToast('Share failed: ' + err.message, 'danger');
    }
  }
}

function showRequestQr(ticketNo, docNo) {
  document.getElementById('requestTicketNo').textContent = ticketNo;
  document.getElementById('requestDocNo').textContent = docNo;
  
  // Store for download/share
  lastQrTicketNo = ticketNo;
  lastQrDocNo = docNo;

  var appUrl = window.location.origin + window.location.pathname;
  var qrDataUrl = appUrl + '?doc=' + encodeURIComponent(docNo);
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=' + encodeURIComponent(qrDataUrl);
  const img = document.getElementById('requestQrImg');
  img.src = qrUrl;
  img.style.display = 'block';
  img.onerror = function() {
    img.style.display = 'none';
    document.getElementById('qrFallback').classList.remove('d-none');
    document.getElementById('qrFallback').innerHTML = '<strong>Doc No:</strong> ' + docNo;
  };

  // Show share button if supported
  const shareBtn = document.getElementById('shareQrBtn');
  if (navigator.share) {
    shareBtn.style.display = 'inline-block';
  } else {
    shareBtn.style.display = 'none';
  }

  requestSuccessModal.show();
}

async function loadMyRequests() {
var requestor = localStorage.getItem('ivm_requestorName');
if (!requestor) return;
showLoading('Loading requests...');
try {
var url = API_URL + '?action=getMyRequests&requestor=' + encodeURIComponent(requestor) + '&_t=' + Date.now();
console.log('[loadMyRequests] Fetching:', url);
var res = await fetch(url);
var data = await res.json();
console.log('[loadMyRequests] Response:', data);
if (data.success && data.requests) {
data.requests.sort(function(a, b) {
var ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
var tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
return tb - ta;
});
var prevStatuses = {};
try { prevStatuses = JSON.parse(localStorage.getItem('ivm_requestStatuses') || '{}'); } catch(e) {}
console.log('[loadMyRequests] Previous statuses:', prevStatuses);
var newStatuses = {};
var hasNewReady = false;
var readyCount = 0;
var pendingCount = 0;
data.requests.forEach(function(req) {
var docNo = req.docNo || '';
var status = req.status || 'PENDING';
newStatuses[docNo] = status;
var prevStatus = prevStatuses[docNo] || 'PENDING';
if (prevStatus === 'PENDING' && (status === 'PARTIAL' || status === 'COMPLETED')) {
hasNewReady = true;
console.log('[loadMyRequests] STATUS CHANGE DETECTED:', docNo, prevStatus, '->', status);
}
if (status !== 'PENDING') readyCount++;
else pendingCount++;
});
localStorage.setItem('ivm_requestStatuses', JSON.stringify(newStatuses));
var badge = document.getElementById('myRequestsBadge');
if (badge) {
badge.textContent = readyCount;
badge.classList.toggle('d-none', readyCount === 0);
console.log('[loadMyRequests] Badge count:', readyCount);
}
renderMyRequests(data.requests);
var kpiActive = document.getElementById('kpiActiveDocs');
var kpiPending = document.getElementById('kpiPending');
var kpiCompleted = document.getElementById('kpiCompleted');
if (kpiActive) kpiActive.textContent = data.requests.length;
if (kpiPending) kpiPending.textContent = pendingCount;
if (kpiCompleted) kpiCompleted.textContent = readyCount;
if (hasNewReady) {
playSuccessBeep();
showToast('Your request has been processed by the warehouse!', 'success');
console.log('[loadMyRequests] Toast notification shown!');
}
} else {
console.log('[loadMyRequests] No requests or error:', data.error);
document.getElementById('myRequestsList').innerHTML = '<div class="list-group-item text-muted text-center py-3">' + (data.error ? 'Error: ' + data.error : 'No requests found') + '</div>';
}
} catch(e) {
console.error('[loadMyRequests] Error:', e);
document.getElementById('myRequestsList').innerHTML = '<div class="list-group-item text-danger text-center py-3">Failed to load requests. Check your connection.</div>';
}
finally { hideLoading(); }
}

function renderMyRequests(requests) {
var container = document.getElementById('myRequestsList');
container.innerHTML = '';
if (requests.length === 0) {
container.innerHTML = '<div class="list-group-item text-muted text-center">No requests found</div>';
return;
}
requests.forEach(function(req) {
var dateStr = req.timestamp ? new Date(req.timestamp).toLocaleString() : '';
var status = req.status || 'PENDING';
var isCompleted = (status === 'COMPLETED');
var isPartial = (status === 'PARTIAL');
var badgeClass = isCompleted ? 'success' : (isPartial ? 'info' : 'warning');
var statusText = isCompleted ? 'COMPLETED' : (isPartial ? 'PARTIAL' : 'PENDING');
var icon = isCompleted ? 'bi-check-circle-fill' : (isPartial ? 'bi-hourglass-split' : 'bi-clock');
var html = '<div class="list-group-item request-card ' + (isCompleted ? 'completed' : '') + '">' +
'<div class="d-flex justify-content-between align-items-start">' +
'<div>' +
'<div class="fw-bold">' + (req.docNo || '') + ' <span class="badge bg-secondary">' + (req.type || '') + '</span></div>' +
'<div class="small text-muted"><i class="bi bi-calendar me-1"></i>' + dateStr + '</div>' +
'</div>' +
'<span class="badge bg-' + badgeClass + '"><i class="bi ' + icon + ' me-1"></i>' + statusText + '</span>' +
'</div>' +
'<div class="small mt-1"><i class="bi bi-box me-1"></i>' + (req.itemCode || '') + ' <span class="badge bg-light text-dark">x' + (req.qty || 0) + '</span></div>' +
'</div>';
container.innerHTML += html;
});
}

function showToast(msg, type) {
const toast = document.getElementById('liveToast');
document.getElementById('toastTitle').textContent = type === 'danger' ? 'Error' : (type === 'success' ? 'Success' : 'Info');
document.getElementById('toastBody').textContent = msg;
toast.className = 'toast align-items-center text-white bg-' + type;
bootstrap.Toast.getOrCreateInstance(toast).show();
}

function renderPoItems() {
document.getElementById('poDisplayNo').textContent = state.currentPoNo;
document.getElementById('poDisplayPrf').textContent = state.currentPoPrf || '-';
document.getElementById('poDisplayClient').textContent = state.currentPoSupplier || state.currentPoClient || '-';
const list = document.getElementById('poItemsList');
list.innerHTML = state.poItemsData.map((item, idx) => `
<div class="card mb-2 po-item-card" id="po-card-${idx}">
<div class="card-body py-2 px-3">
<div class="d-flex align-items-center gap-2">
<div class="form-check m-0">
<input class="form-check-input po-check" type="checkbox" id="po-check-${idx}" checked onchange="togglePoCard(${idx})">
</div>
<div class="flex-grow-1" style="min-width:0">
<div class="fw-bold small text-truncate">${item.inventoryId || item.itemCode || ''}</div>
<div class="text-muted small text-truncate">${item.description || ''}</div>
<div class="d-flex gap-2 mt-1">
<small class="text-muted">PO Qty: <strong>${item.qty || 0}</strong></small>
<small class="text-muted">Unit: <strong>${item.unit || 'PCS'}</strong></small>
</div>
</div>
<div style="min-width:90px">
<label class="form-label mb-0 small">ATL Qty</label>
<input type="number" class="form-control form-control-sm" id="po-atl-${idx}" value="${item.qty || 0}" min="0" style="width:80px">
</div>
<div style="min-width:100px">
<label class="form-label mb-0 small">Unit</label>
<select class="form-select form-select-sm" id="po-unit-${idx}">
  ${buildUnitOptions(item.unit || 'PCS')}
</select>
</div>
</div>
</div>
</div>
`).join('');
}
function togglePoCard(idx) {
const checked = document.getElementById('po-check-' + idx).checked;
const card = document.getElementById('po-card-' + idx);
if (checked) {
card.classList.remove('opacity-50');
} else {
card.classList.add('opacity-50');
}
}
function selectAllPoItems(select) {
state.poItemsData.forEach((_, idx) => {
document.getElementById('po-check-' + idx).checked = select;
togglePoCard(idx);
});
}

function closePoItemsModal() {
if (state.poItemsModal) state.poItemsModal.hide();
}

async function createMrrFromPo() {
const selected = [];
state.poItemsData.forEach((item, idx) => {
if (document.getElementById('po-check-' + idx).checked) {
const atlQty = parseFloat(document.getElementById('po-atl-' + idx).value) || 0;
const unit = document.getElementById('po-unit-' + idx).value || 'PCS';
selected.push({
inventoryId: item.inventoryId || item.itemCode || '',
description: item.description || '',
qty: item.qty || 0,
unit: unit,
atlQty: atlQty
});
}
});
if (selected.length === 0) {
showToast('Please select at least one item', 'warning');
return;
}
const drNo = document.getElementById('mrrDrNo').value.trim();
const receivingDate = document.getElementById('mrrReceivingDate').value;
showLoading('Creating MRR...');
try {
const payload = {
action: 'createMrrRequest',
poNo: state.currentPoNo,
prfNo: state.currentPoPrf,
client: state.currentPoClient,
supplier: state.currentPoSupplier,
drNo: drNo,
receivingDate: receivingDate,
items: selected
};
const res = await fetch(API_URL, {
method: 'POST',
body: JSON.stringify(payload),
headers: { 'Content-Type': 'text/plain;charset=utf-8' },
redirect: 'follow'
});
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
if (data && data.success) {
closePoItemsModal();
showToast('MRR created: ' + data.docNo, 'success');
await fetchPendingDocs();
} else {
showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
}
} catch(err) {
showToast('Error: ' + err.message, 'danger');
} finally {
hideLoading();
}
}

// ============================================================================
// MANUAL MRR CREATION (No PO required) - WITH UNIT DROPDOWN
// ============================================================================
var manualMrrModal = null;
var manualMrrItems = [];

function openManualMrrModal() {
  if (!manualMrrModal) {
    manualMrrModal = new bootstrap.Modal(document.getElementById('manualMrrModal'));
  }
  document.getElementById('manualMrrPoNo').value = '';
  document.getElementById('manualMrrDrNo').value = '';
  document.getElementById('manualMrrVendor').value = '';
  document.getElementById('manualMrrSite').value = 'GEMCOR CATMON';
  document.getElementById('manualMrrPreparedBy').value = '';
  manualMrrItems = [];
  renderManualMrrItems();
  updateManualMrrSubmitButton();
  manualMrrModal.show();
}

function addManualMrrItem() {
  manualMrrItems.push({
    inventoryId: '',
    description: '',
    qty: 1,
    atlQty: 0,
    unit: 'PIECE'
  });
  renderManualMrrItems();
  updateManualMrrSubmitButton();
  setTimeout(function() {
    var inputs = document.querySelectorAll('.manual-mrr-code');
    if (inputs.length > 0) {
      inputs[inputs.length - 1].focus();
    }
  }, 100);
}

function removeManualMrrItem(index) {
  manualMrrItems.splice(index, 1);
  renderManualMrrItems();
  updateManualMrrSubmitButton();
}

function updateManualMrrItem(index, field, value) {
  if (manualMrrItems[index]) {
    manualMrrItems[index][field] = value;
  }
  updateManualMrrSubmitButton();
}

function renderManualMrrItems() {
  var tbody = document.getElementById('manualMrrItemsBody');
  var emptyState = document.getElementById('manualMrrEmptyState');
  if (!tbody) return;

  if (manualMrrItems.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  var html = '';
  for (var i = 0; i < manualMrrItems.length; i++) {
    var it = manualMrrItems[i];
    html += '<tr>' +
      '<td class="align-middle text-center">' + (i + 1) + '</td>' +
      '<td><input type="text" class="form-control form-control-sm manual-mrr-code" ' +
        'value="' + (it.inventoryId || '') + '" ' +
        'onchange="updateManualMrrItem(' + i + ', \'inventoryId\', this.value)" ' +
        'placeholder="Item code"></td>' +
      '<td><input type="text" class="form-control form-control-sm" ' +
        'value="' + (it.description || '') + '" ' +
        'onchange="updateManualMrrItem(' + i + ', \'description\', this.value)" ' +
        'placeholder="Description"></td>' +
      '<td><input type="number" class="form-control form-control-sm text-center" ' +
        'value="' + (it.qty || 0) + '" ' +
        'onchange="updateManualMrrItem(' + i + ', \'qty\', parseFloat(this.value)||0)" ' +
        'min="0" step="0.01"></td>' +
      '<td><input type="number" class="form-control form-control-sm text-center" ' +
        'value="' + (it.atlQty || 0) + '" ' +
        'onchange="updateManualMrrItem(' + i + ', \'atlQty\', parseFloat(this.value)||0)" ' +
        'min="0" step="0.01"></td>' +
      '<td><select class="form-select form-select-sm manual-mrr-unit" ' +
        'onchange="updateManualMrrItem(' + i + ', \'unit\', this.value)">' +
        buildUnitOptions(it.unit || 'PIECE') +
      '</select></td>' +
      '<td class="align-middle text-center">' +
        '<button class="btn btn-sm btn-outline-danger" onclick="removeManualMrrItem(' + i + ')" title="Remove">' +
          '<i class="bi bi-trash"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  }
  tbody.innerHTML = html;
}

function updateManualMrrSubmitButton() {
  var btn = document.getElementById('btnSubmitManualMrr');
  if (!btn) return;

  var drNo = document.getElementById('manualMrrDrNo').value.trim();
  var vendor = document.getElementById('manualMrrVendor').value.trim();
  var site = document.getElementById('manualMrrSite').value.trim();

  var hasValidItems = false;
  for (var i = 0; i < manualMrrItems.length; i++) {
    var it = manualMrrItems[i];
    if (it.inventoryId && it.inventoryId.trim() && it.description && it.description.trim() && it.qty > 0) {
      hasValidItems = true;
      break;
    }
  }

  btn.disabled = !(drNo && vendor && site && hasValidItems);
}

async function submitManualMrr() {
  var poNo = document.getElementById('manualMrrPoNo').value.trim();
  var drNo = document.getElementById('manualMrrDrNo').value.trim();
  var vendor = document.getElementById('manualMrrVendor').value.trim();
  var site = document.getElementById('manualMrrSite').value.trim();
  var receivingDate = document.getElementById('manualMrrDate').value;
  var preparedBy = document.getElementById('manualMrrPreparedBy').value.trim();

  var items = [];
  for (var i = 0; i < manualMrrItems.length; i++) {
    var it = manualMrrItems[i];
    if (it.inventoryId && it.inventoryId.trim() && it.description && it.description.trim() && it.qty > 0) {
      items.push({
        inventoryId: it.inventoryId.trim(),
        description: it.description.trim(),
        qty: it.qty,
        atlQty: it.atlQty || 0,
        unit: it.unit || 'PIECE'
      });
    }
  }

  if (items.length === 0) {
    showToast('Please add at least one valid item', 'warning');
    return;
  }

  showLoading('Creating Manual MRR...');
  try {
    var payload = {
      action: 'createMrrRequest',
      poNo: poNo || 'N/A',
      prfNo: '',
      client: vendor,
      supplier: vendor,
      drNo: drNo,
      receivingDate: receivingDate,
      receivingSite: site,
      preparedBy: preparedBy,
      items: items,
      isManual: true
    };

    var res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow'
    });

    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }

    if (data && data.success) {
      if (manualMrrModal) manualMrrModal.hide();
      showToast('Manual MRR created: ' + data.docNo, 'success');
      await fetchPendingDocs();
      await updateWarehouseKPIs();
    } else {
      showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
    }
  } catch(err) {
    showToast('Error: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

// ============================================================================
// INVENTORY BROWSER - SIMPLIFIED: QR, ITEM CODE, DESCRIPTION only
// ============================================================================
var inventoryBrowserModal = null;
var inventoryItemsCache = [];
var inventoryBrowserFiltered = [];

function openInventoryBrowser() {
  if (!inventoryBrowserModal) {
    inventoryBrowserModal = new bootstrap.Modal(document.getElementById('inventoryBrowserModal'));
  }
  document.getElementById('inventorySearchInput').value = '';
  inventoryBrowserModal.show();
  fetchInventoryItems();
}

async function fetchInventoryItems() {
  var tbody = document.getElementById('inventoryBrowserBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="3" class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Loading inventory...</td></tr>';

  try {
    var sheetId = '1HSxuSlik8hvbHppOE56ICzl1Jz9cCxFWCJ4EN-bzVFs';
    var url = API_URL + '?action=getInventoryItems&sheetId=' + sheetId + '&_t=' + Date.now();
    console.log('[fetchInventoryItems] URL:', url);
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    console.log('[fetchInventoryItems] Raw response:', text.substring(0, 500));
    var data;
    try { data = JSON.parse(text); } catch(e) { 
      console.error('[fetchInventoryItems] JSON parse error:', e);
      data = {}; 
    }

    if (data.success && data.items) {
      inventoryItemsCache = data.items;
      inventoryBrowserFiltered = data.items;
      renderInventoryItems();
      console.log('[fetchInventoryItems] Loaded ' + data.items.length + ' items');
    } else {
      console.error('[fetchInventoryItems] Error:', data.error || 'Unknown error');
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger py-3">' + (data.error || 'Failed to load inventory. Check console.') + '</td></tr>';
    }
  } catch(err) {
    console.error('[fetchInventoryItems] Error:', err);
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger py-3">Failed to load inventory: ' + err.message + '</td></tr>';
  }
}

function renderInventoryItems() {
  var tbody = document.getElementById('inventoryBrowserBody');
  if (!tbody) return;

  if (inventoryBrowserFiltered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No items match your search</td></tr>';
    return;
  }

  var html = '';
  for (var i = 0; i < inventoryBrowserFiltered.length; i++) {
    var it = inventoryBrowserFiltered[i];
    var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=40x40&data=' + encodeURIComponent(it.inventoryId);
    html += '<tr>' +
      '<td class="align-middle text-center"><img src="' + qrUrl + '" style="width:36px;height:36px;" alt="QR"></td>' +
      '<td class="align-middle"><code>' + it.inventoryId + '</code></td>' +
      '<td class="align-middle">' + it.description + '</td>' +
      '</tr>';
  }
  tbody.innerHTML = html;
}

function filterInventoryItems() {
  var query = document.getElementById('inventorySearchInput').value.toLowerCase().trim();
  if (!query) {
    inventoryBrowserFiltered = inventoryItemsCache;
  } else {
    inventoryBrowserFiltered = inventoryItemsCache.filter(function(it) {
      return (it.inventoryId && it.inventoryId.toLowerCase().indexOf(query) !== -1) ||
             (it.description && it.description.toLowerCase().indexOf(query) !== -1);
    });
  }
  renderInventoryItems();
}

function openInventoryQrScan() {
  state.inventoryScanMode = true;
  openQrScanner();
}

// ============================================================================
// WAREHOUSE NOTIFICATIONS
// ============================================================================

async function updateWarehouseKPIs() {
try {
var sheetId = getCleanSheetId() || '';
var url = API_URL + '?action=getPendingDocCount&docType=MRIF&sheetId=' + sheetId + '&_t=' + Date.now();
var res = await fetch(url, { redirect: 'follow' });
var text = await res.text();
var data;
try { data = JSON.parse(text); } catch(e) { data = {}; }
var pendingCount = data.pendingCount || 0;
var completedCount = data.completedCount || 0;
var totalCount = data.totalCount || 0;

var kpiActive = document.getElementById('kpiActiveDocs');
var kpiPending = document.getElementById('kpiPending');
var kpiNotif = document.getElementById('kpiNotifications');
var kpiCompleted = document.getElementById('kpiCompleted');

if (kpiActive) kpiActive.textContent = totalCount;
if (kpiPending) kpiPending.textContent = pendingCount;
if (kpiNotif) kpiNotif.textContent = pendingCount;
if (kpiCompleted) kpiCompleted.textContent = completedCount;

console.log('[KPI] Total:', totalCount, 'Pending:', pendingCount, 'Completed:', completedCount);
} catch(e) { console.error('[KPI] Error:', e); }
}

async function loadWarehouseNotifications() {
if (localStorage.getItem('ivm_userRole') === 'production') return;
try {
var url = API_URL + '?action=getPendingRequests&_t=' + Date.now();
var res = await fetch(url);
var data = await res.json();
console.log('[WH Notifications] Response:', data);
if (data.success && data.requests) {
var today = new Date();
var sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
var currentMrifId = localStorage.getItem('sheetId_MRIF') || '';
var filtered = data.requests.filter(function(req) {
var reqDate = new Date(req.timestamp);
var type = (req.type || '').toUpperCase();
if (reqDate < sevenDaysAgo || (type !== 'MRIF' && type !== 'MRS')) return false;
if (currentMrifId && req.url) {
var reqUrl = String(req.url || '');
if (reqUrl.indexOf(currentMrifId) === -1) return false;
}
return true;
});
filtered.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
console.log('[WH Notifications] Filtered count:', filtered.length);

var prevCount = parseInt(localStorage.getItem('ivm_whNotifCount') || '0');
var newCount = filtered.length;
localStorage.setItem('ivm_whNotifCount', newCount);

if (newCount > prevCount) {
var diff = newCount - prevCount;
playSuccessBeep();
showToast(diff + ' new request(s) received!', 'warning');
}

var badge = document.getElementById('whNotifBadge');
var btn = document.getElementById('whNotifBtn');
if (badge && btn) {
badge.textContent = newCount;
badge.classList.toggle('d-none', newCount === 0);
btn.classList.toggle('d-none', false);
}

updateWarehouseKPIs();
renderWarehouseNotifications(filtered);
}
} catch(e) {
console.error('[WH Notifications] Error:', e);
}
}

function renderWarehouseNotifications(requests) {
var container = document.getElementById('whNotificationsList');
if (!container) return;
container.innerHTML = '';
if (requests.length === 0) {
container.innerHTML = '<div class="list-group-item text-muted text-center py-3">No pending requests</div>';
return;
}
requests.slice(0, 5).forEach(function(req) {
var dateStr = req.timestamp ? new Date(req.timestamp).toLocaleString() : '';
var docNo = req.docNo || '';
var type = req.type || 'MRIF';
var html = '<div class="list-group-item wh-notif-item py-2" data-docno="' + docNo + '" data-type="' + type + '">' +
'<div class="d-flex justify-content-between align-items-start">' +
'<div>' +
'<div class="doc-no">' + cleanDocNo(docNo) + ' <span class="badge bg-secondary">' + type + '</span></div>' +
'<div class="requestor"><i class="bi bi-person me-1"></i>' + (req.requestor || 'Unknown') + '</div>' +
'<div class="timestamp"><i class="bi bi-clock me-1"></i>' + dateStr + '</div>' +
'</div>' +
'<span class="badge bg-warning text-dark">PENDING</span>' +
'</div>' +
'<div class="small mt-1 text-muted">' + (req.itemCode || '') + ' <span class="badge bg-light text-dark">x' + (req.qty || 0) + '</span></div>' +
'</div>';
container.innerHTML += html;
});
container.querySelectorAll('.wh-notif-item').forEach(function(el) {
el.addEventListener('click', function() {
processRequestFromNotification(this.getAttribute('data-docno'), this.getAttribute('data-type'));
});
});
if (requests.length > 5) {
container.innerHTML += '<div class="list-group-item text-center text-muted small py-2">+' + (requests.length - 5) + ' more pending requests</div>';
}
}

function renderWhNotifModal(requests) {
var container = document.getElementById('whNotifModalList');
if (!container) return;
container.innerHTML = '';
if (requests.length === 0) {
container.innerHTML = '<div class="list-group-item text-muted text-center py-3">No pending requests</div>';
return;
}
requests.forEach(function(req) {
var dateStr = req.timestamp ? new Date(req.timestamp).toLocaleString() : '';
var docNo = req.docNo || '';
var type = req.type || 'MRIF';
var html = '<div class="list-group-item wh-notif-item py-3" data-docno="' + docNo + '" data-type="' + type + '">' +
'<div class="d-flex justify-content-between align-items-start">' +
'<div>' +
'<div class="doc-no">' + cleanDocNo(docNo) + ' <span class="badge bg-secondary">' + type + '</span></div>' +
'<div class="requestor"><i class="bi bi-person me-1"></i>' + (req.requestor || 'Unknown') + '</div>' +
'<div class="timestamp"><i class="bi bi-clock me-1"></i>' + dateStr + '</div>' +
'</div>' +
'<span class="badge bg-warning text-dark">PENDING</span>' +
'</div>' +
'<div class="small mt-1 text-muted">' + (req.itemCode || '') + ' <span class="badge bg-light text-dark">x' + (req.qty || 0) + '</span></div>' +
'</div>';
container.innerHTML += html;
});
container.querySelectorAll('.wh-notif-item').forEach(function(el) {
el.addEventListener('click', function() {
if (whNotifModal) whNotifModal.hide();
processRequestFromNotification(this.getAttribute('data-docno'), this.getAttribute('data-type'));
});
});
}

function openWhNotifications() {
if (!whNotifModal && document.getElementById('whNotifModal')) {
whNotifModal = new bootstrap.Modal(document.getElementById('whNotifModal'));
}
if (whNotifModal) whNotifModal.show();
loadAndRenderWhModal();
}

async function loadAndRenderWhModal() {
var container = document.getElementById('whNotifModalList');
if (container) {
container.innerHTML = '<div class="list-group-item text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-1">Loading...</div></div>';
}
try {
var url = API_URL + '?action=getPendingRequests&_t=' + Date.now();
var res = await fetch(url);
var data = await res.json();
console.log('[WH Modal] Response:', data);
if (data.success && data.requests) {
var today = new Date();
var todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
var currentMrifId = localStorage.getItem('sheetId_MRIF') || '';
var filtered = data.requests.filter(function(req) {
var reqDate = new Date(req.timestamp);
var reqStr = reqDate.getFullYear() + '-' + String(reqDate.getMonth()+1).padStart(2,'0') + '-' + String(reqDate.getDate()).padStart(2,'0');
var type = (req.type || '').toUpperCase();
if (reqStr !== todayStr || type !== 'MRIF') return false;
if (currentMrifId && req.url) {
var reqUrl = String(req.url || '');
if (reqUrl.indexOf(currentMrifId) === -1) return false;
}
return true;
});
filtered.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
renderWhNotifModal(filtered);
} else {
renderWhNotifModal([]);
}
} catch(e) {
console.error('[WH Modal] Error:', e);
renderWhNotifModal([]);
}
}

async function processRequestFromNotification(docNo, docType) {
console.log('[WH] Processing request:', docNo, docType);
state.currentModule = docType;
updateLabels();
await fetchPendingDocs();
var select = document.getElementById('docSelect');
if (select) {
for (var i = 0; i < select.options.length; i++) {
if (select.options[i].value === docNo) {
select.selectedIndex = i;
onDocSelect(docNo);
showToast('Loading ' + cleanDocNo(docNo) + '...', 'info');
return;
}
}
}
showToast('Document not in current list. Refreshing...', 'warning');
await fetchPendingDocs();
setTimeout(function() {
var select2 = document.getElementById('docSelect');
if (select2) {
for (var i = 0; i < select2.options.length; i++) {
if (select2.options[i].value === docNo) {
select2.selectedIndex = i;
onDocSelect(docNo);
return;
}
}
}
showToast('Could not find ' + cleanDocNo(docNo) + '. It may have been processed.', 'danger');
}, 1000);
}

function clearWhNotifications() {
if (!confirm('Clear all warehouse notifications? This will reset the badge count.')) return;
localStorage.setItem('ivm_whNotifCount', '0');
var badge = document.getElementById('whNotifBadge');
if (badge) badge.classList.add('d-none');
showToast('Notifications cleared', 'info');
}

// ============================================================================
// MRIF PRINT PREVIEW — List & Print
// ============================================================================

async function openPendingMrifList() {
if (state.isLoading) return;
if (pendingMrifModal) pendingMrifModal.show();
var container = document.getElementById('pendingMrifListContainer');
if (container) {
container.innerHTML = '<div class="list-group-item text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-1">Loading pending MRIFs...</div></div>';
}
try {
var sheetId = getCleanSheetId() || '';
var url = API_URL + '?action=getPendingDocCount&docType=MRIF&sheetId=' + sheetId + '&_t=' + Date.now();
var res = await fetch(url, { redirect: 'follow' });
var text = await res.text();
var data;
try { data = JSON.parse(text); } catch(e) { data = {}; }
if (data.success && data.documents) {
renderPendingMrifList(data.documents);
} else {
if (container) container.innerHTML = '<div class="list-group-item text-center text-muted py-3">No pending MRIFs found</div>';
}
} catch(err) {
if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">Error: ' + err.message + '</div>';
}
}

function renderPendingMrifList(docs) {
var container = document.getElementById('pendingMrifListContainer');
if (!container) return;
container.innerHTML = '';
if (!docs || docs.length === 0) {
container.innerHTML = '<div class="list-group-item text-center text-muted py-3">No pending MRIFs</div>';
return;
}
docs.forEach(function(d) {
var docNo = typeof d === 'string' ? d : (d.docNo || d.name || '');
var el = document.createElement('div');
el.className = 'list-group-item pending-mrif-item';
el.innerHTML = '<div class="d-flex justify-content-between align-items-center">' +
'<div><i class="bi bi-file-earmark-text me-2 text-warning"></i><strong>' + cleanDocNo(docNo) + '</strong></div>' +
'<button class="btn btn-sm btn-primary"><i class="bi bi-box-arrow-in-right me-1"></i>Process</button>' +
'</div>' +
'<div class="small text-muted mt-1"><i class="bi bi-info-circle me-1"></i>Has items awaiting release</div>';
el.querySelector('button').addEventListener('click', async function(e) {
e.stopPropagation();
if (pendingMrifModal) pendingMrifModal.hide();
showToast('Loading ' + cleanDocNo(docNo) + '...', 'info');
try {
  await selectModule('MRIF');
  await onDocSelect(docNo);
} catch(err) {
  console.error('[Pending MRIF] Error loading doc:', err);
  showToast('Failed to load ' + cleanDocNo(docNo) + '. Try again.', 'danger');
}
});
container.appendChild(el);
});
}

// ============================================================================
// MRR PRINT PREVIEW — List & Print
// ============================================================================

async function openMrrList() {
if (state.isLoading) return;
if (mrrListModal) mrrListModal.show();
var container = document.getElementById('mrrListContainer');
if (container) {
container.innerHTML = '<div class="list-group-item text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-1">Loading MRR documents...</div></div>';
}
try {
var sheetId = getCleanSheetId();
if (!sheetId) {
if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">No MRR Sheet ID configured. Please sync or enter Sheet ID in Settings.</div>';
return;
}
var url = API_URL + '?action=getPendingDocs&docType=MRR&sheetId=' + sheetId + '&_t=' + Date.now();
var res = await fetch(url, { redirect: 'follow' });
var text = await res.text();
var data;
try { data = JSON.parse(text); } catch(e) { data = {}; }
var docs = Array.isArray(data) ? data : (data.documents || data.docs || []);
renderMrrList(docs);
} catch(err) {
if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">Error loading documents: ' + err.message + '</div>';
}
}

function renderMrrList(docs) {
var container = document.getElementById('mrrListContainer');
if (!container) return;
container.innerHTML = '';
if (!docs || docs.length === 0) {
container.innerHTML = '<div class="list-group-item text-center text-muted py-3">No MRR documents found</div>';
return;
}
docs.forEach(function(d) {
var docNo = typeof d === 'string' ? d : (d.docNo || d.name || d);
var el = document.createElement('div');
el.className = 'list-group-item mrif-list-item d-flex justify-content-between align-items-center';
el.innerHTML = '<div><i class="bi bi-file-earmark-text me-2 text-success"></i><strong>' + cleanDocNo(docNo) + '</strong></div>' +
'<button class="btn btn-sm btn-outline-primary"><i class="bi bi-eye me-1"></i>View / Print</button>';
el.addEventListener('click', function() { openMrrPrint(docNo); });
container.appendChild(el);
});
}

async function openMrrPrint(docNo) {
  if (state.isLoading) return;
  showLoading('Loading ' + cleanDocNo(docNo) + '...');
  try {
    var sheetId = getCleanSheetId();
    console.log('[openMrrPrint] sheetId:', sheetId, 'docNo:', docNo);
    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) + '&docType=MRR&sheetId=' + sheetId + '&_t=' + Date.now();
    console.log('[openMrrPrint] URL:', url);
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    console.log('[openMrrPrint] Raw response:', text.substring(0, 500));
    var data;
    try { data = JSON.parse(text); } catch(e) { 
      console.error('[openMrrPrint] JSON parse error:', e);
      data = {}; 
    }
    console.log('[openMrrPrint] Parsed data:', data);
    if (data.error) {
      showToast('Error: ' + data.error, 'danger');
      return;
    }
    if (!data.success) {
      showToast('Error: ' + (data.error || 'Failed to load document'), 'danger');
      return;
    }
    if (!data.items || data.items.length === 0) {
      console.warn('[openMrrPrint] No items found for ' + docNo, data.debug);
      showToast('Warning: No items found in this document', 'warning');
    }
    renderMrrPrint(docNo, data.info || {}, data.items || []);
    if (mrrListModal) mrrListModal.hide();
    setTimeout(function() {
      if (mrrPrintModal) mrrPrintModal.show();
    }, 300);
  } catch(err) {
    console.error('[openMrrPrint] Error:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

function renderMrrPrint(docNo, info, items) {
var container = document.getElementById('mrrPrintContent');
if (!container) return;

console.log('[renderMrrPrint] ==================== START ====================');
console.log('[renderMrrPrint] docNo:', docNo);
console.log('[renderMrrPrint] Info object:', JSON.stringify(info, null, 2));
console.log('[renderMrrPrint] Items count:', items ? items.length : 0);
if (items && items.length > 0) {
  console.log('[renderMrrPrint] First item:', JSON.stringify(items[0], null, 2));
}
console.log('[renderMrrPrint] ================================================');

var receivingSite = info['Receiving Site'] || info.receivingSite || 'GEMCOR CATMON';
var vendor = info['Vendor/Client'] || info.vendor || info.client || '';
var datePrepared = info['Date Prepared'] || info.datePrepared || '';
var poNo = info['PO No.'] || info.poNo || '';
var drNo = info['DR No.'] || info['DR No / SI No.'] || info['DR No'] || info.drNo || info['D.R. No.'] || info.dr || '';
var receivingDate = info['Receiving Date'] || info.receivingDate || '';
var preparedBy = info['Prepared By'] || info.preparedBy || '';

console.log('[renderMrrPrint] Extracted DR No.:', drNo);

function formatDate(val) {
  if (!val || val === '') return '';
  if (typeof val === 'string' && val.indexOf('GMT') === -1 && val.indexOf('Standard') === -1) {
    if (val.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)/)) return val;
    if (val.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) return val;
  }
  try {
    var d = new Date(val);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }
  } catch(e) {}
  return String(val).replace(/\s*GMT.*$/, '').replace(/\s*Standard.*$/, '').trim();
}

var dateStr = formatDate(datePrepared);
var recDateStr = formatDate(receivingDate);

var itemsHtml = '';
if (items && items.length > 0) {
  items.forEach(function(it, idx) {
    var code = it.inventoryId || it.itemCode || '';
    var desc = it.description || it.desc || it.itemDescription || '';
    var requestedQty = it.recQty || it.expectedQty || it.qty || it.quantity || 0;
    var receivedQty = it.atlQty || it.actualQty || it.issuedQty || it.actual || 0;
    var unit = it.unit || it.uom || 'PIECE';
    var remarks = it.remarks || it.status || it.note || '';
    
    console.log('[renderMrrPrint] Item ' + (idx+1) + ' - code: "' + code + '", requestedQty: ' + requestedQty + ', receivedQty: ' + receivedQty);
    
    var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=50x50&data=' + encodeURIComponent(code || 'blank');
    itemsHtml += '<tr>' +
      '<td class="td-center" style="width:5%">' + (idx + 1) + '</td>' +
      '<td class="td-center" style="width:16%">' + code + '</td>' +
      '<td class="td-left" style="width:35%">' + desc + '</td>' +
      '<td class="td-center" style="width:10%">' + requestedQty + '</td>' +
      '<td class="td-center" style="width:10%">' + receivedQty + '</td>' +
      '<td class="td-center" style="width:8%">' + unit + '</td>' +
      '<td class="td-center" style="width:16%">' + remarks + '</td>' +
      '</tr>';
  });
}

var mrrQrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(docNo);

var html = '<div class="mrr-print-sheet">' +
  '<div class="mrr-header">' +
    '<div class="mrr-logo"><img src="gemcor-logo.png" alt="GEMCOR" onerror="this.style.display=\'none\'"></div>' +
    '<div class="mrr-docno">' +
      '<div><span class="mrr-dn-label">Receipt No.:</span><span class="mrr-dn-box">' + cleanDocNo(docNo) + '</span></div>' +
      '<div class="mrr-doc-qr"><img src="' + mrrQrUrl + '" alt="MRR QR"></div>' +
    '</div>' +
  '</div>' +
  '<div class="mrr-title">MATERIALS RECEIVING REPORT</div>' +
  '<table class="mrr-meta-table">' +
    '<tr>' +
      '<td class="mrr-meta-label">RECEIVING SITE:</td>' +
      '<td class="mrr-meta-value" colspan="5">' + receivingSite + '</td>' +
      '<td class="mrr-meta-label-right">PO No. / SOF No.:</td>' +
      '<td class="mrr-meta-value-right">' + poNo + '</td>' +
    '</tr>' +
    '<tr>' +
      '<td class="mrr-meta-label">VENDOR:</td>' +
      '<td class="mrr-meta-value" colspan="5">' + vendor + '</td>' +
      '<td class="mrr-meta-label-right">DR No / SI No.:</td>' +
      '<td class="mrr-meta-value-right">' + drNo + '</td>' +
    '</tr>' +
    '<tr>' +
      '<td class="mrr-meta-label">DATE PREPARED:</td>' +
      '<td class="mrr-meta-value" colspan="2">' + dateStr + '</td>' +
      '<td class="mrr-meta-label-right">RECEIVING DATE:</td>' +
      '<td class="mrr-meta-value-right" colspan="4">' + recDateStr + '</td>' +
    '</tr>' +
  '</table>' +
  '<table class="mrr-items">' +
    '<thead>' +
      '<tr>' +
        '<th style="width:5%">ITEM<br>NO.</th>' +
        '<th style="width:16%">ITEM<br>CODE</th>' +
        '<th style="width:35%">ITEM DESCRIPTION</th>' +
        '<th style="width:10%">REQUESTED<br>QTY</th>' +
        '<th style="width:10%">RECEIVED<br>QTY</th>' +
        '<th style="width:8%">UNIT</th>' +
        '<th style="width:16%">REMARKS</th>' +
      '</tr>' +
    '</thead>' +
    '<tbody>' + itemsHtml + '</tbody>' +
  '</table>' +
  '<div class="mrr-checkboxes">' +
    '<div class="mrr-cb-section">' +
      '<div class="mrr-cb-title">ISSUES IN SUPPLIER PERFORMANCE:</div>' +
      '<div class="mrr-cb-row">' +
        '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> PRODUCT/SERVICE</span>' +
        '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> DELIVERY</span>' +
        '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> CUSTOMER RELATIONS</span>' +
        '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> SUPPORT FUNCTION</span>' +
        '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> PRICE</span>' +
      '</div>' +
    '</div>' +
    '<div class="mrr-cb-section">' +
      '<div class="mrr-cb-title">ACTION TAKEN IF REJECT / PARTIAL ACCEPTANCE:</div>' +
      '<div class="mrr-cb-row">' +
        '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> RETURN TO SUPPLIER</span>' +
        '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> ITEMS REPLACED BY SUPPLIER</span>' +
        '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> OTHERS</span>' +
      '</div>' +
    '</div>' +
  '</div>' +
  '<div class="mrr-sigs">' +
    '<div class="mrr-sig">' +
      '<div class="mrr-sig-name">' + preparedBy + '</div>' +
      '<div class="mrr-sig-line"></div>' +
      '<div class="mrr-sig-label">PREPARED BY</div>' +
    '</div>' +
    '<div class="mrr-sig">' +
      '<div class="mrr-sig-name"></div>' +
      '<div class="mrr-sig-line"></div>' +
      '<div class="mrr-sig-label">CHECKED BY</div>' +
    '</div>' +
    '<div class="mrr-sig">' +
      '<div class="mrr-sig-name"></div>' +
      '<div class="mrr-sig-line"></div>' +
      '<div class="mrr-sig-label">RECEIVED BY / DATE</div>' +
    '</div>' +
  '</div>' +
'</div>';

container.innerHTML = html;
console.log('[renderMrrPrint] HTML rendered. DR No displayed:', drNo);
console.log('[renderMrrPrint] ==================== END ====================');
}

function printMrr() {
  var previewContent = document.getElementById('mrrPrintContent');
  if (!previewContent) {
    showToast('Print content not found', 'danger');
    return;
  }
  var sheetHtml = previewContent.innerHTML;
  if (!sheetHtml || sheetHtml.trim() === '') {
    showToast('Nothing to print', 'warning');
    return;
  }

  var printStyles =
    '@page { size: letter portrait; margin: 0.25in; }' +
    '* { box-sizing: border-box; }' +
    'body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #000; line-height: 1.3; }' +
    '.mrr-print-sheet { width: 100%; max-width: 8in; margin: 0 auto; background: #fff; padding: 0.2in; }' +
    '.mrr-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }' +
    '.mrr-logo img { height: 48px; width: auto; }' +
    '.mrr-docno { text-align: right; }' +
    '.mrr-dn-label { font-weight: bold; font-size: 9pt; margin-right: 4px; }' +
    '.mrr-dn-box { display: inline-block; background: #f4cccc; border: 1px solid #e6b8b8; padding: 2px 10px; font-weight: bold; font-size: 10pt; color: #000; letter-spacing: 1px; }' +
    '.mrr-doc-qr { margin-top: 4px; text-align: right; }' +
    '.mrr-doc-qr img { width: 75px; height: 75px; }' +
    '.mrr-title { text-align: center; font-size: 12pt; font-weight: bold; letter-spacing: 5px; margin: 8px 0 14px 0; text-transform: uppercase; }' +
    '.mrr-meta-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 8.5pt; }' +
    '.mrr-meta-table td { padding: 0; vertical-align: middle; border: none; }' +
    '.mrr-meta-label { font-weight: bold; font-size: 8pt; letter-spacing: 2px; text-align: left; white-space: nowrap; padding: 3px 4px 3px 0; width: 18%; line-height: 1.2; }' +
    '.mrr-meta-value { background: #cfe2f3; padding: 4px 6px; font-size: 9pt; font-weight: bold; text-align: left; border: 1px solid #b6d7e8; width: 32%; line-height: 1.2; }' +
    '.mrr-meta-label-right { font-weight: bold; font-size: 8pt; letter-spacing: 1.5px; text-align: left; white-space: nowrap; padding: 3px 4px 3px 10px; width: 20%; line-height: 1.2; }' +
    '.mrr-meta-value-right { background: #cfe2f3; padding: 4px 6px; font-size: 9pt; font-weight: bold; text-align: left; border: 1px solid #b6d7e8; width: 30%; line-height: 1.2; }' +
    '.mrr-items { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 8.5pt; }' +
    '.mrr-items th, .mrr-items td { border: 1.5px solid #000; padding: 4px 5px; vertical-align: middle; }' +
    '.mrr-items th { background: #fff; font-weight: bold; text-align: center; font-size: 8pt; letter-spacing: 0.5px; }' +
    '.mrr-items td.td-center { text-align: center; }' +
    '.mrr-items td.td-left { text-align: left; }' +
    '.mrr-items td.td-nofurther { text-align: center; font-size: 7pt; font-weight: bold; padding: 3px; border: 1.5px solid #000; letter-spacing: 0.5px; }' +
    '.mrr-checkboxes { font-size: 7.5pt; margin-top: 6px; margin-bottom: 16px; }' +
    '.mrr-cb-section { margin-bottom: 6px; }' +
    '.mrr-cb-title { font-weight: bold; font-size: 7.5pt; letter-spacing: 0.5px; margin-bottom: 3px; text-transform: uppercase; }' +
    '.mrr-cb-row { display: flex; flex-wrap: wrap; gap: 4px 20px; margin-bottom: 4px; padding-left: 2px; }' +
    '.mrr-cb-item { font-size: 7.5pt; display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }' +
    '.mrr-cb-circle { font-size: 9pt; line-height: 1; font-family: "Courier New", monospace; }' +
    '.mrr-sigs { display: flex; justify-content: center; gap: 50px; margin-top: 24px; text-align: center; }' +
    '.mrr-sig { width: 26%; min-width: 140px; }' +
    '.mrr-sig-name { font-size: 9.5pt; font-weight: bold; text-transform: uppercase; margin-bottom: 1px; min-height: 16px; letter-spacing: 0.5px; }' +
    '.mrr-sig-line { border-bottom: 1.5px solid #000; height: 18px; margin-bottom: 2px; }' +
    '.mrr-sig-label { font-size: 8.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; font-style: italic; }';

  var fullHtml = '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><title>MRR Print</title><style>' + printStyles + '</style></head>' +
    '<body>' + sheetHtml + '</body></html>';

  var iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write(fullHtml);
  doc.close();

  setTimeout(function() {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {
      console.error('Print error:', e);
      showToast('Print failed. Try again.', 'danger');
    }
    setTimeout(function() {
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
    }, 2000);
  }, 800);
}

function closeMrrPrint() {
if (mrrPrintModal) mrrPrintModal.hide();
}

// ============================================================================
// MRIF LIST & PRINT
// ============================================================================

async function openMrifList() {
if (state.isLoading) return;
if (mrifListModal) mrifListModal.show();
var container = document.getElementById('mrifListContainer');
if (container) {
container.innerHTML = '<div class="list-group-item text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-1">Loading MRIF documents...</div></div>';
}
try {
var sheetId = getCleanSheetId();
if (!sheetId) {
if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">No MRIF Sheet ID configured. Please sync or enter Sheet ID in Settings.</div>';
return;
}
var url = API_URL + '?action=getPendingDocs&docType=MRIF&sheetId=' + sheetId + '&_t=' + Date.now();
var res = await fetch(url, { redirect: 'follow' });
var text = await res.text();
var data;
try { data = JSON.parse(text); } catch(e) { data = {}; }
var docs = Array.isArray(data) ? data : (data.documents || data.docs || []);
renderMrifList(docs);
} catch(err) {
if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">Error loading documents: ' + err.message + '</div>';
}
}

function renderMrifList(docs) {
var container = document.getElementById('mrifListContainer');
if (!container) return;
container.innerHTML = '';
if (!docs || docs.length === 0) {
container.innerHTML = '<div class="list-group-item text-center text-muted py-3">No MRIF documents found</div>';
return;
}
docs.forEach(function(d) {
var docNo = typeof d === 'string' ? d : (d.docNo || d.name || d);
var el = document.createElement('div');
el.className = 'list-group-item mrif-list-item d-flex justify-content-between align-items-center';
el.innerHTML = '<div><i class="bi bi-file-earmark-text me-2 text-warning"></i><strong>' + cleanDocNo(docNo) + '</strong></div>' +
'<button class="btn btn-sm btn-outline-primary"><i class="bi bi-eye me-1"></i>View / Print</button>';
el.addEventListener('click', function() { openMrifPrint(docNo); });
container.appendChild(el);
});
}

async function openMrifPrint(docNo) {
  if (state.isLoading) return;
  showLoading('Loading ' + cleanDocNo(docNo) + '...');
  try {
    var sheetId = getCleanSheetId();
    console.log('[openMrifPrint] sheetId:', sheetId, 'docNo:', docNo);
    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) + '&docType=MRIF&sheetId=' + sheetId + '&_t=' + Date.now();
    console.log('[openMrifPrint] URL:', url);
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    console.log('[openMrifPrint] Raw response:', text.substring(0, 500));
    var data;
    try { data = JSON.parse(text); } catch(e) { 
      console.error('[openMrifPrint] JSON parse error:', e);
      data = {}; 
    }
    console.log('[openMrifPrint] Parsed data:', data);
    if (data.error) {
      showToast('Error: ' + data.error, 'danger');
      return;
    }
    if (!data.success) {
      showToast('Error: ' + (data.error || 'Failed to load document'), 'danger');
      return;
    }
    if (!data.items || data.items.length === 0) {
      console.warn('[openMrifPrint] No items found for ' + docNo, data.debug);
      showToast('Warning: No items found in this document', 'warning');
    }
    renderMrifPrint(docNo, data.info || {}, data.items || []);
    if (mrifListModal) mrifListModal.hide();
    setTimeout(function() {
      if (mrifPrintModal) mrifPrintModal.show();
    }, 300);
  } catch(err) {
    console.error('[openMrifPrint] Error:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

function renderMrifPrint(docNo, info, items) {
  var container = document.getElementById('mrifPrintContent');
  if (!container) return;

  console.log('[renderMrifPrint] docNo:', docNo, 'items count:', items ? items.length : 0);
  console.log('[renderMrifPrint] info:', JSON.stringify(info));

  var requestor = info.Requestor || info.requestor || info.requestorName || '';
  var department = info.Department || info.department || info.dept || '';
  var dateRaw = info.Date || info.date || info['Date Prepared'] || info.datePrepared || '';
  var gemSo = info['GEM SO No.'] || info.gemSoNo || info.gemSo || '';
  var joNo = info['JO No.'] || info.joNo || '';
  var client = info['Client Name'] || info.clientName || info.client || '';
  var project = info.Project || info.project || '';

  var dateStr = dateRaw;
  try {
    var d = new Date(dateRaw);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      dateStr = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }
  } catch(e) {}

  var itemsHtml = '';
  if (items && items.length > 0) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var code = it.itemCode || it.inventoryId || it.code || '';
      var desc = it.description || it.desc || '';
      var qty = it.expectedQty || it.qty || it.requestedQty || 0;
      var issued = it.actualQty || it.issuedQty || it.atlQty || 0;
      var unit = it.unit || 'PIECE';
      var remarks = it.remarks || '';
      var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=50x50&data=' + encodeURIComponent(code);
      itemsHtml += '<tr>' +
        '<td class="td-center">' + (i + 1) + '</td>' +
        '<td class="td-center">' + code + '</td>' +
        '<td class="td-center"><img src="' + qrUrl + '" style="width:32px;height:32px;display:block;margin:0 auto;" alt=""></td>' +
        '<td class="td-left">' + desc + '</td>' +
        '<td class="td-center">' + qty + '</td>' +
        '<td class="td-center">' + issued + '</td>' +
        '<td class="td-center">' + unit + '</td>' +
        '<td class="td-center">' + remarks + '</td>' +
        '</tr>';
    }
  } else {
    itemsHtml += '<tr><td class="td-center" colspan="7" style="padding:20px;color:#999;font-style:italic;">No items found in this document</td></tr>';
  }

  itemsHtml += '<tr><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-left">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td></tr>';

  var mrifQrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(docNo);

  var html = '<div class="mrif-print-sheet">' +
    '<div class="mrif-header">' +
      '<div class="mrif-logo"><img src="gemcor-logo.png" alt="GEMCOR"></div>' +
      '<div class="mrif-docno">' +
        '<div><span class="mrif-dn-label">MRIF No.:</span><span class="mrif-dn-box">' + cleanDocNo(docNo) + '</span></div>' +
        '<div class="mrif-doc-qr"><img src="' + mrifQrUrl + '" alt="MRIF QR" style="width:90px;height:90px;margin-top:4px;"></div>' +
      '</div>' +
    '</div>' +
    '<div class="mrif-title">MATERIALS REQUEST AND ISSUANCE FORM</div>' +
    '<table class="mrif-meta">' +
      '<tr>' +
        '<td class="meta-label">REQUESTOR:</td>' +
        '<td class="meta-value" colspan="2">' + requestor + '</td>' +
        '<td class="meta-label-right">GEM SO No.:</td>' +
        '<td class="meta-blue">' + gemSo + '</td>' +
        '<td class="meta-label-right">JO No.:</td>' +
        '<td class="meta-blue">' + joNo + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="meta-label">DEPARTMENT/SECTION:</td>' +
        '<td class="meta-value" colspan="4">' + department + '</td>' +
        '<td class="meta-label-right">CLIENT NAME:</td>' +
        '<td class="meta-value">' + client + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="meta-label">DATE:</td>' +
        '<td class="meta-blue" colspan="2">' + dateStr + '</td>' +
        '<td class="meta-label-right">PROJECT:</td>' +
        '<td class="meta-value" colspan="3">' + project + '</td>' +
      '</tr>' +
    '</table>' +
    '<table class="mrif-items">' +
      '<thead>' +
        '<tr>' +
          '<th style="width:5%">ITEM<br>NO.</th>' +
          '<th style="width:14%">ITEM<br>CODE</th>' +
          '<th style="width:7%">QR<br>IMG</th>' +
          '<th style="width:34%">ITEM DESCRIPTION</th>' +
          '<th style="width:9%">REQ.<br>QTY</th>' +
          '<th style="width:9%">ISSUED<br>QTY</th>' +
          '<th style="width:7%">UNIT</th>' +
          '<th style="width:15%">REMARKS</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + itemsHtml + '</tbody>' +
    '</table>' +
    '<div class="mrif-sigs">' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line">ANGEL / JOMAR / RICHEL / ERWIN / MARCEL</div>' +
        '<div class="mrif-sig-label">ISSUED BY</div>' +
      '</div>' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line">&nbsp;</div>' +
        '<div class="mrif-sig-label">CHECKED BY</div>' +
      '</div>' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line">&nbsp;</div>' +
        '<div class="mrif-sig-label">RECEIVED BY/DATE</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  container.innerHTML = html;
  console.log('[renderMrifPrint] HTML rendered successfully');
}
function printMrif() {
  var previewContent = document.getElementById('mrifPrintContent');
  if (!previewContent) {
    showToast('Print content not found', 'danger');
    return;
  }
  var sheetHtml = previewContent.innerHTML;
  if (!sheetHtml || sheetHtml.trim() === '') {
    showToast('Nothing to print', 'warning');
    return;
  }

  var printStyles =
    '@page { size: letter portrait; margin: 0.3in; }' +
    '* { box-sizing: border-box; }' +
    'body { margin: 0; padding: 0; font-family: "Times New Roman", Times, serif; font-size: 10pt; color: #000; line-height: 1.3; }' +
    '.mrif-print-sheet { width: 100%; max-width: 8in; margin: 0 auto; background: #fff; padding: 0.2in; }' +
    '.mrif-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }' +
    '.mrif-logo img { height: 55px; width: auto; }' +
    '.mrif-docno { text-align: right; }' +
    '.mrif-dn-label { font-weight: bold; font-size: 10pt; margin-right: 6px; }' +
    '.mrif-dn-box { display: inline-block; background: #f8d7da; border: 1px solid #f5c6cb; padding: 2px 10px; font-weight: bold; font-size: 11pt; color: #721c24; }' +
    '.mrif-doc-qr { margin-top: 4px; }' +
    '.mrif-doc-qr img { width: 90px; height: 90px; }' +
    '.mrif-title { text-align: center; font-size: 14pt; font-weight: bold; letter-spacing: 4px; margin: 12px 0 16px 0; text-transform: uppercase; }' +
    '.mrif-meta { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9.5pt; }' +
    '.mrif-meta td { padding: 3px 6px; vertical-align: top; }' +
    '.meta-label { font-weight: bold; width: 18%; text-align: left; white-space: nowrap; }' +
    '.meta-value { width: 32%; text-align: left; border-bottom: 1px solid #000; }' +
    '.meta-label-right { font-weight: bold; width: 18%; text-align: left; white-space: nowrap; padding-left: 12px; }' +
    '.meta-value-right { width: 32%; text-align: left; border-bottom: 1px solid #000; }' +
    '.meta-blue { background: #cfe2f3; padding: 2px 6px; font-weight: bold; }' +
    '.mrif-items { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9pt; }' +
    '.mrif-items th, .mrif-items td { border: 1px solid #000; padding: 4px 5px; vertical-align: middle; }' +
    '.mrif-items th { background: #fff; font-weight: bold; text-align: center; font-size: 8.5pt; }' +
    '.mrif-items td.td-center { text-align: center; }' +
    '.mrif-items td.td-left { text-align: left; }' +
    '.mrif-items td.td-nofurther { text-align: center; font-size: 7pt; font-weight: bold; padding: 4px; border: 1px solid #000; }' +
    '.mrif-sigs { display: flex; justify-content: space-around; margin-top: 30px; text-align: center; }' +
    '.mrif-sig { width: 30%; }' +
    '.mrif-sig-line { border-bottom: 1px solid #000; height: 28px; margin-bottom: 2px; font-size: 8pt; }' +
    '.mrif-sig-label { font-size: 9pt; font-weight: bold; text-transform: uppercase; }';

  var fullHtml = '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><title>MRIF Print</title><style>' + printStyles + '</style></head>' +
    '<body>' + sheetHtml + '</body></html>';

  var iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write(fullHtml);
  doc.close();

  setTimeout(function() {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {
      console.error('Print error:', e);
      showToast('Print failed. Try again.', 'danger');
    }
    setTimeout(function() {
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
    }, 2000);
  }, 800);
}

function closeMrifPrint() {
if (mrifPrintModal) mrifPrintModal.hide();
}

// ============================================================================
// MRS PRINT PREVIEW — List & Print
// ============================================================================

async function openMrsList() {
if (state.isLoading) return;
if (mrsListModal) mrsListModal.show();
var container = document.getElementById('mrsListContainer');
if (container) {
container.innerHTML = '<div class="list-group-item text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-1">Loading MRS documents...</div></div>';
}
try {
var sheetId = getCleanSheetId();
if (!sheetId) {
if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">No MRS Sheet ID configured. Please sync or enter Sheet ID in Settings.</div>';
return;
}
var url = API_URL + '?action=getPendingDocs&docType=MRS&sheetId=' + sheetId + '&_t=' + Date.now();
var res = await fetch(url, { redirect: 'follow' });
var text = await res.text();
var data;
try { data = JSON.parse(text); } catch(e) { data = {}; }
var docs = Array.isArray(data) ? data : (data.documents || data.docs || []);
renderMrsList(docs);
} catch(err) {
if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">Error loading documents: ' + err.message + '</div>';
}
}

function renderMrsList(docs) {
var container = document.getElementById('mrsListContainer');
if (!container) return;
container.innerHTML = '';
if (!docs || docs.length === 0) {
container.innerHTML = '<div class="list-group-item text-center text-muted py-3">No MRS documents found</div>';
return;
}
docs.forEach(function(d) {
var docNo = typeof d === 'string' ? d : (d.docNo || d.name || d);
var el = document.createElement('div');
el.className = 'list-group-item mrif-list-item d-flex justify-content-between align-items-center';
el.innerHTML = '<div><i class="bi bi-file-earmark-text me-2 text-warning"></i><strong>' + cleanDocNo(docNo) + '</strong></div>' +
'<button class="btn btn-sm btn-outline-primary"><i class="bi bi-eye me-1"></i>View / Print</button>';
el.addEventListener('click', function() { openMrsPrint(docNo); });
container.appendChild(el);
});
}

async function openMrsPrint(docNo) {
  if (state.isLoading) return;
  showLoading('Loading ' + cleanDocNo(docNo) + '...');
  try {
    var sheetId = getCleanSheetId();
    console.log('[openMrsPrint] sheetId:', sheetId, 'docNo:', docNo);
    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) + '&docType=MRS&sheetId=' + sheetId + '&_t=' + Date.now();
    console.log('[openMrsPrint] URL:', url);
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    console.log('[openMrsPrint] Raw response:', text.substring(0, 500));
    var data;
    try { data = JSON.parse(text); } catch(e) { 
      console.error('[openMrsPrint] JSON parse error:', e);
      data = {}; 
    }
    console.log('[openMrsPrint] Parsed data:', data);
    if (data.error) {
      showToast('Error: ' + data.error, 'danger');
      return;
    }
    if (!data.success) {
      showToast('Error: ' + (data.error || 'Failed to load document'), 'danger');
      return;
    }
    if (!data.items || data.items.length === 0) {
      console.warn('[openMrsPrint] No items found for ' + docNo, data.debug);
      showToast('Warning: No items found in this document', 'warning');
    }
    renderMrsPrint(docNo, data.info || {}, data.items || []);
    if (mrsListModal) mrsListModal.hide();
    setTimeout(function() {
      if (mrsPrintModal) mrsPrintModal.show();
    }, 300);
  } catch(err) {
    console.error('[openMrsPrint] Error:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

function renderMrsPrint(docNo, info, items) {
  var container = document.getElementById('mrsPrintContent');
  if (!container) return;

  console.log('[renderMrsPrint] docNo:', docNo, 'items count:', items ? items.length : 0);
  console.log('[renderMrsPrint] info:', JSON.stringify(info));

  var requestor = info.Requestor || info.requestor || info.requestorName || '';
  var department = info.Department || info.department || info.dept || '';
  var dateRaw = info.Date || info.date || info['Date Prepared'] || info.datePrepared || '';
  var gemSo = info['GEM SO No.'] || info.gemSoNo || info.gemSo || '';
  var joNo = info['JO No.'] || info.joNo || '';
  var client = info['Client Name'] || info.clientName || info.client || '';
  var project = info.Project || info.project || '';

  var dateStr = dateRaw;
  try {
    var d = new Date(dateRaw);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      dateStr = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }
  } catch(e) {}

  var itemsHtml = '';
  if (items && items.length > 0) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var code = it.itemCode || it.inventoryId || it.code || '';
      var desc = it.description || it.desc || '';
      var qtyReturned = it.expectedQty || it.qty || it.requestedQty || 0;
      var actualReturned = it.actualQty || it.issuedQty || it.atlQty || 0;
      var unit = it.unit || 'PIECE';
      var remarks = it.remarks || '';
      var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=50x50&data=' + encodeURIComponent(code);
      itemsHtml += '<tr>' +
        '<td class="td-center">' + (i + 1) + '</td>' +
        '<td class="td-center">' + code + '</td>' +
        '<td class="td-center"><img src="' + qrUrl + '" style="width:32px;height:32px;display:block;margin:0 auto;" alt=""></td>' +
        '<td class="td-left">' + desc + '</td>' +
        '<td class="td-center">' + qtyReturned + '</td>' +
        '<td class="td-center">' + actualReturned + '</td>' +
        '<td class="td-center">' + unit + '</td>' +
        '<td class="td-center">' + remarks + '</td>' +
        '</tr>';
    }
  } else {
    itemsHtml += '<tr><td class="td-center" colspan="7" style="padding:20px;color:#999;font-style:italic;">No items found in this document</td></tr>';
  }

  itemsHtml += '<tr><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-left">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td></tr>';

  var mrsQrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(docNo);

  var html = '<div class="mrif-print-sheet">' +
    '<div class="mrif-header">' +
      '<div class="mrif-logo"><img src="gemcor-logo.png" alt="GEMCOR"></div>' +
      '<div class="mrif-docno">' +
        '<div><span class="mrif-dn-label">MRS No.:</span><span class="mrif-dn-box">' + cleanDocNo(docNo) + '</span></div>' +
        '<div class="mrif-doc-qr"><img src="' + mrsQrUrl + '" alt="MRS QR" style="width:90px;height:90px;margin-top:4px;"></div>' +
      '</div>' +
    '</div>' +
    '<div class="mrif-title">MATERIALS RETURN SLIP</div>' +
    '<table class="mrif-meta">' +
      '<tr>' +
        '<td class="meta-label">REQUESTOR:</td>' +
        '<td class="meta-value" colspan="2">' + requestor + '</td>' +
        '<td class="meta-label-right">GEM SO No.:</td>' +
        '<td class="meta-blue">' + gemSo + '</td>' +
        '<td class="meta-label-right">JO No.:</td>' +
        '<td class="meta-blue">' + joNo + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="meta-label">DEPARTMENT/SECTION:</td>' +
        '<td class="meta-value" colspan="4">' + department + '</td>' +
        '<td class="meta-label-right">CLIENT NAME:</td>' +
        '<td class="meta-value">' + client + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="meta-label">DATE:</td>' +
        '<td class="meta-blue" colspan="2">' + dateStr + '</td>' +
        '<td class="meta-label-right">PROJECT:</td>' +
        '<td class="meta-value" colspan="3">' + project + '</td>' +
      '</tr>' +
    '</table>' +
    '<table class="mrif-items">' +
      '<thead>' +
        '<tr>' +
          '<th style="width:5%">ITEM<br>NO.</th>' +
          '<th style="width:14%">ITEM<br>CODE</th>' +
          '<th style="width:7%">QR<br>IMG</th>' +
          '<th style="width:34%">ITEM DESCRIPTION</th>' +
          '<th style="width:9%">QTY<br>RETURNED</th>' +
          '<th style="width:9%">ATL QTY<br>(Actual)</th>' +
          '<th style="width:7%">UNIT</th>' +
          '<th style="width:15%">REMARKS</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + itemsHtml + '</tbody>' +
    '</table>' +
    '<div class="mrif-sigs">' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line"></div>' +
        '<div class="mrif-sig-label">ISSUED BY</div>' +
      '</div>' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line"></div>' +
        '<div class="mrif-sig-label">CHECKED BY</div>' +
      '</div>' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line"></div>' +
        '<div class="mrif-sig-label">RECEIVED BY/DATE</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  container.innerHTML = html;
  console.log('[renderMrsPrint] HTML rendered successfully');
}

function printMrs() {
  var previewContent = document.getElementById('mrsPrintContent');
  if (!previewContent) {
    showToast('Print content not found', 'danger');
    return;
  }
  var sheetHtml = previewContent.innerHTML;
  if (!sheetHtml || sheetHtml.trim() === '') {
    showToast('Nothing to print', 'warning');
    return;
  }

  var printStyles =
    '@page { size: letter portrait; margin: 0.3in; }' +
    '* { box-sizing: border-box; }' +
    'body { margin: 0; padding: 0; font-family: "Times New Roman", Times, serif; font-size: 10pt; color: #000; line-height: 1.3; }' +
    '.mrif-print-sheet { width: 100%; max-width: 8in; margin: 0 auto; background: #fff; padding: 0.2in; }' +
    '.mrif-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }' +
    '.mrif-logo img { height: 55px; width: auto; }' +
    '.mrif-docno { text-align: right; }' +
    '.mrif-dn-label { font-weight: bold; font-size: 10pt; margin-right: 6px; }' +
    '.mrif-dn-box { display: inline-block; background: #f8d7da; border: 1px solid #f5c6cb; padding: 2px 10px; font-weight: bold; font-size: 11pt; color: #721c24; }' +
    '.mrif-doc-qr { margin-top: 4px; }' +
    '.mrif-doc-qr img { width: 90px; height: 90px; }' +
    '.mrif-title { text-align: center; font-size: 14pt; font-weight: bold; letter-spacing: 4px; margin: 12px 0 16px 0; text-transform: uppercase; }' +
    '.mrif-meta { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9.5pt; }' +
    '.mrif-meta td { padding: 3px 6px; vertical-align: top; }' +
    '.meta-label { font-weight: bold; width: 18%; text-align: left; white-space: nowrap; }' +
    '.meta-value { width: 32%; text-align: left; border-bottom: 1px solid #000; }' +
    '.meta-label-right { font-weight: bold; width: 18%; text-align: left; white-space: nowrap; padding-left: 12px; }' +
    '.meta-value-right { width: 32%; text-align: left; border-bottom: 1px solid #000; }' +
    '.meta-blue { background: #cfe2f3; padding: 2px 6px; font-weight: bold; }' +
    '.mrif-items { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9pt; }' +
    '.mrif-items th, .mrif-items td { border: 1px solid #000; padding: 4px 5px; vertical-align: middle; }' +
    '.mrif-items th { background: #fff; font-weight: bold; text-align: center; font-size: 8.5pt; }' +
    '.mrif-items td.td-center { text-align: center; }' +
    '.mrif-items td.td-left { text-align: left; }' +
    '.mrif-items td.td-nofurther { text-align: center; font-size: 7pt; font-weight: bold; padding: 4px; border: 1px solid #000; }' +
    '.mrif-sigs { display: flex; justify-content: space-around; margin-top: 30px; text-align: center; }' +
    '.mrif-sig { width: 30%; }' +
    '.mrif-sig-line { border-bottom: 1px solid #000; height: 28px; margin-bottom: 2px; font-size: 8pt; }' +
    '.mrif-sig-label { font-size: 9pt; font-weight: bold; text-transform: uppercase; }';

  var fullHtml = '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><title>MRS Print</title><style>' + printStyles + '</style></head>' +
    '<body>' + sheetHtml + '</body></html>';

  var iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write(fullHtml);
  doc.close();

  setTimeout(function() {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {
      console.error('Print error:', e);
      showToast('Print failed. Try again.', 'danger');
    }
    setTimeout(function() {
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
    }, 2000);
  }, 800);
}

function closeMrsPrint() {
if (mrsPrintModal) mrsPrintModal.hide();
}

// ============================================================================
// AUTO-NAVIGATE FROM SCANNED QR CODE (?doc= parameter)
// ============================================================================
function checkUrlDocParam() {
  var params = new URLSearchParams(window.location.search);
  var docNo = params.get('doc');
  if (!docNo) return;

  console.log('[QR Scan] Detected doc parameter:', docNo);

  var docType = 'MRIF';
  if (docNo.indexOf('MRR') === 0) docType = 'MRR';
  else if (docNo.indexOf('MRS') === 0) docType = 'MRS';

  if (window.history.replaceState) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  showLoading('Opening ' + cleanDocNo(docNo) + '...');

  var role = localStorage.getItem('ivm_userRole');
  if (role === 'warehouse') {
    selectModule(docType).then(function() {
      setTimeout(function() {
        onDocSelect(docNo);
        hideLoading();
      }, 500);
    }).catch(function(err) {
      console.error('[QR Scan] Error:', err);
      hideLoading();
      showToast('Could not open document: ' + cleanDocNo(docNo), 'warning');
    });
  } else {
    hideLoading();
    showToast('Document ' + cleanDocNo(docNo) + ' scanned. Switch to Warehouse mode to process.', 'info');
  }
}

document.addEventListener('DOMContentLoaded', () => {
initRole();
document.getElementById('mrrReceivingDate').valueAsDate = new Date();
setTimeout(checkUrlDocParam, 1500);
});
