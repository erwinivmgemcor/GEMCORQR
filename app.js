/* ═══════════════════════════════════════════════════════════════════════════
   IVM WAREHOUSE QR — APPLICATION LOGIC
   ═══════════════════════════════════════════════════════════════════════════ */

const API_URL = 'https://script.google.com/macros/s/AKfycbw-EX38TvEOLHcYRh0EUks9c9e7M0pIGS1fwi8ELPqs7KZnKtcy99hYZvIyg9blVSJz/exec';
const DEFAULT_PIN = '0000';

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
const quickScanModal = new bootstrap.Modal(document.getElementById('quickScanModal'));
const roleModal = new bootstrap.Modal(document.getElementById('roleModal'));
const productionNameModal = new bootstrap.Modal(document.getElementById('productionNameModal'));
state.poScanModal = new bootstrap.Modal(document.getElementById('poScanModal'));
state.poItemsModal = new bootstrap.Modal(document.getElementById('poItemsModal'));

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
document.getElementById('myRequestsSection').classList.toggle('d-none', !isProduction);
document.getElementById('docPickerSection').style.display = isProduction ? 'none' : '';
document.getElementById('quickScanCard').style.display = isProduction ? 'none' : '';
const whBtn = document.getElementById('whNotifBtn');
if (whBtn) whBtn.classList.toggle('d-none', isProduction);
if (isProduction) {
document.getElementById('activeTransactionSection').classList.add('d-none');
if (window._requestsInterval) clearInterval(window._requestsInterval);
window._requestsInterval = setInterval(function() {
if (!state.isLoading) loadMyRequests();
}, 30000);
if (window._whInterval) clearInterval(window._whInterval);
} else {
if (window._requestsInterval) clearInterval(window._requestsInterval);
if (window._whInterval) clearInterval(window._whInterval);
window._whInterval = setInterval(function() {
if (!state.isLoading) loadWarehouseNotifications();
}, 30000);
loadWarehouseNotifications();
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
// Show/hide MRIF List button
var mrifCard = document.getElementById('mrifListCard');
if (mrifCard) {
mrifCard.classList.toggle('d-none', mod !== 'MRIF');
}
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
opt.value = val; opt.textContent = val;
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
if (val.toLowerCase().includes(term)) {
const opt = document.createElement('option');
opt.value = val; opt.textContent = val;
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
document.getElementById('docTitle').textContent = docNo;
await fetchDocItems(docNo, state.currentModule);
checkForProgress();
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
if (!sheetId) return;
try {
const url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) + '&docType=' + docType + '&sheetId=' + sheetId + '&_t=' + Date.now();
const res = await fetch(url, { redirect: 'follow' });
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch(e) { data = []; }
if (data.error) {
showToast('Error: ' + data.error, 'danger');
return;
}
const items = Array.isArray(data) ? data : (data.items || []);
state.items = items.map((it, idx) => ({
inventoryId: it.inventoryId || it.code || it.itemCode || '',
description: it.description || it.desc || '',
qty: Number(it.qty || it.requestedQty || it.expectedQty || 0),
issuedQty: Number(it.issuedQty || it.actualQty || 0),
rowIndex: it.rowIndex || (idx + 13),
verified: false
}));
renderItems();
startScanner();
} catch(err) {
showToast('Failed to load items', 'danger');
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
const docPattern = /^(MRIF|MRR|MRS)\d{6,}$/i;
if (docPattern.test(decodedText)) {
playSuccessBeep();
if (confirm('Document QR detected: ' + decodedText + '\n\nSwitch to this document?')) {
const mod = decodedText.substring(0, 4).toUpperCase();
if (['MRIF','MRR','MRS'].includes(mod)) {
selectModule(mod);
setTimeout(() => onDocSelect(decodedText), 300);
}
}
return;
}
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

// 1. Document QR pattern
const docPattern = /^(MRIF|MRR|MRS)\d{6,}$/i;
if (docPattern.test(decodedText)) {
const mod = decodedText.substring(0, 4).toUpperCase();
if (['MRIF','MRR','MRS'].includes(mod)) {
playSuccessBeep();
showToast('Loading document ' + decodedText + '...', 'success');
selectModule(mod);
setTimeout(() => onDocSelect(decodedText), 500);
return;
}
}

// 2. Try as PO Number (for MRR creation)
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

// 3. Item QR (existing document)
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
currentModalItem.issuedQty = qtyVal;
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
encodeURIComponent(i.inventoryId) + ',' + i.issuedQty + ',' + i.rowIndex
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
// NEW REQUEST FUNCTIONS - WITH JO No. + SOF AUTO-FILL + REQUESTOR DROPDOWN
// =============================================================================
function openNewRequest() {
if (state.isLoading) return;
// Reset all form fields
document.getElementById('reqJoNo').value = '';
document.getElementById('reqGemSoNo').value = '';
document.getElementById('reqClientName').value = '';
document.getElementById('reqProject').value = '';
document.getElementById('reqDepartment').value = '';
document.getElementById('requestItemsContainer').innerHTML = '';
addRequestItemRow();
loadRequestInventory();
loadRequestorList();
newRequestModal.show();
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
if (data.success && data.requestors) {
state.requestorList = data.requestors;
data.requestors.forEach(r => {
const opt = document.createElement('option');
opt.value = r.name;
opt.textContent = r.name;
opt.dataset.department = r.department;
sel.appendChild(opt);
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
div.innerHTML = '<div class="col-5"><label class="form-label small">Item</label><input type="text" class="form-control req-item-search" placeholder="Type to search..." oninput="filterRequestItems(this,'+idx+')" onfocus="filterRequestItems(this,'+idx+')"><div class="list-group position-absolute z-3 d-none req-dropdown" style="max-height:150px;overflow-y:auto;" id="reqDropdown'+idx+'"></div><input type="hidden" class="req-item-code" id="reqCode'+idx+'"><input type="hidden" class="req-item-desc" id="reqDesc'+idx+'"></div>' +
'<div class="col-3"><label class="form-label small">Qty</label><input type="number" class="form-control req-qty" min="1" value="1"></div>' +
'<div class="col-3"><label class="form-label small">Unit</label><input type="text" class="form-control req-unit" value="PCS" readonly></div>' +
'<div class="col-1"><button class="btn btn-outline-danger btn-sm" onclick="this.closest(\'.row\').remove()"><i class="bi bi-trash"></i></button></div>';
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
const el = document.createElement('div');
el.className = 'list-group-item list-group-item-action';
el.innerHTML = '<div class="fw-bold small">' + code + '</div><div class="small text-muted">' + desc + '</div>';
el.onclick = () => {
input.value = code + ' - ' + desc;
document.getElementById('reqCode'+idx).value = code;
document.getElementById('reqDesc'+idx).value = desc;
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
document.querySelectorAll('#requestItemsContainer .row').forEach(row => {
const code = row.querySelector('.req-item-code').value;
const desc = row.querySelector('.req-item-desc').value;
const qty = parseInt(row.querySelector('.req-qty').value, 10);
if (code && qty > 0) items.push({ inventoryId: code, description: desc, qty: qty });
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

function showRequestQr(ticketNo, docNo) {
document.getElementById('requestTicketNo').textContent = ticketNo;
document.getElementById('requestDocNo').textContent = docNo;
const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=' + encodeURIComponent(docNo);
const img = document.getElementById('requestQrImg');
img.src = qrUrl;
img.style.display = 'block';
img.onerror = function() {
img.style.display = 'none';
document.getElementById('qrFallback').classList.remove('d-none');
document.getElementById('qrFallback').innerHTML = '<strong>Doc No:</strong> ' + docNo;
};
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
});
localStorage.setItem('ivm_requestStatuses', JSON.stringify(newStatuses));
var badge = document.getElementById('myRequestsBadge');
if (badge) {
badge.textContent = readyCount;
badge.classList.toggle('d-none', readyCount === 0);
console.log('[loadMyRequests] Badge count:', readyCount);
}
renderMyRequests(data.requests);
if (hasNewReady) {
playSuccessBeep();
showToast('Your request has been processed by the warehouse!', 'success');
console.log('[loadMyRequests] Toast notification shown!');
}
} else {
console.log('[loadMyRequests] No requests or error:', data.error);
}
} catch(e) {
console.error('[loadMyRequests] Error:', e);
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
selected.push({
inventoryId: item.inventoryId || item.itemCode || '',
description: item.description || '',
qty: item.qty || 0,
unit: item.unit || 'PCS',
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
// WAREHOUSE NOTIFICATIONS
// ============================================================================

async function loadWarehouseNotifications() {
if (localStorage.getItem('ivm_userRole') === 'production') return;
try {
var url = API_URL + '?action=getPendingRequests&_t=' + Date.now();
var res = await fetch(url);
var data = await res.json();
console.log('[WH Notifications] Response:', data);
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
console.log('[WH Notifications] Today MRIF count:', filtered.length);

var prevCount = parseInt(localStorage.getItem('ivm_whNotifCount') || '0');
var newCount = filtered.length;
localStorage.setItem('ivm_whNotifCount', newCount);

if (newCount > prevCount && prevCount > 0) {
playSuccessBeep();
showToast('New MRIF request received today!', 'warning');
}

var badge = document.getElementById('whNotifBadge');
var btn = document.getElementById('whNotifBtn');
if (badge && btn) {
badge.textContent = newCount;
badge.classList.toggle('d-none', newCount === 0);
btn.classList.toggle('d-none', false);
}
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
'<div class="doc-no">' + docNo + ' <span class="badge bg-secondary">' + type + '</span></div>' +
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
'<div class="doc-no">' + docNo + ' <span class="badge bg-secondary">' + type + '</span></div>' +
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
showToast('Loading ' + docNo + '...', 'info');
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
showToast('Could not find ' + docNo + '. It may have been processed.', 'danger');
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
el.innerHTML = '<div><i class="bi bi-file-earmark-text me-2 text-warning"></i><strong>' + docNo + '</strong></div>' +
'<button class="btn btn-sm btn-outline-primary"><i class="bi bi-eye me-1"></i>View / Print</button>';
el.addEventListener('click', function() { openMrifPrint(docNo); });
container.appendChild(el);
});
}

async function openMrifPrint(docNo) {
if (state.isLoading) return;
showLoading('Loading ' + docNo + '...');
try {
var sheetId = getCleanSheetId();
var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) + '&docType=MRIF&sheetId=' + sheetId + '&_t=' + Date.now();
var res = await fetch(url, { redirect: 'follow' });
var text = await res.text();
var data;
try { data = JSON.parse(text); } catch(e) { data = {}; }
if (data.error) {
showToast('Error: ' + data.error, 'danger');
return;
}
renderMrifPrint(docNo, data.info || {}, data.items || []);
if (mrifListModal) mrifListModal.hide();
setTimeout(function() {
if (mrifPrintModal) mrifPrintModal.show();
}, 300);
} catch(err) {
showToast('Failed to load document: ' + err.message, 'danger');
} finally {
hideLoading();
}
}

function renderMrifPrint(docNo, info, items) {
var container = document.getElementById('mrifPrintContent');
if (!container) return;

var requestor = info.Requestor || info.requestor || '';
var department = info.Department || info.department || '';
var dateRaw = info.Date || info.date || '';
var gemSo = info['GEM SO No.'] || info.gemSoNo || info.gemSo || '';
var joNo = info['JO No.'] || info.joNo || '';
var client = info['Client Name'] || info.clientName || info.client || '';
var project = info.Project || info.project || '';

// Format date nicely
var dateStr = dateRaw;
try {
var d = new Date(dateRaw);
if (!isNaN(d.getTime())) {
var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
dateStr = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}
} catch(e) {}

var itemsHtml = '';
items.forEach(function(it, idx) {
var code = it.itemCode || it.inventoryId || '';
var desc = it.description || '';
var qty = it.expectedQty || it.qty || 0;
var issued = it.actualQty || it.issuedQty || 0;
var unit = it.unit || 'PIECE';
var remarks = it.remarks || '';
var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=50x50&data=' + encodeURIComponent(code);
itemsHtml += '<tr>' +
'<td class="td-center">' + (idx + 1) + '</td>' +
'<td class="td-center">' + code + '</td>' +
'<td class="td-center"><img src="' + qrUrl + '" style="width:32px;height:32px;display:block;margin:0 auto;" alt=""></td>' +
'<td class="td-left">' + desc + '</td>' +
'<td class="td-center">' + qty + '</td>' +
'<td class="td-center">' + issued + '</td>' +
'<td class="td-center">' + unit + '</td>' +
'<td class="td-center">' + remarks + '</td>' +
'</tr>';
});

// Add 1 empty row after data for spacing
itemsHtml += '<tr><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-left">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td></tr>';

// "no further entries" row — merged across all columns, centered
itemsHtml += '<tr><td class="td-nofurther" colspan="8">******************** no further entries below this line ********************</td></tr>';

var mrifQrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(docNo);

var html = `<div class="mrif-print-sheet">
<div class="mrif-header">
<div class="mrif-logo"><img src="gemcor-logo.png" alt="GEMCOR"></div>
<div class="mrif-docno">
<div><span class="mrif-dn-label">MRIF No.:</span><span class="mrif-dn-box">${docNo}</span></div>
<div class="mrif-doc-qr"><img src="${mrifQrUrl}" alt="MRIF QR" style="width:90px;height:90px;margin-top:4px;"></div>
</div>
</div>
<div class="mrif-title">MATERIALS REQUEST AND ISSUANCE FORM</div>
<table class="mrif-meta">
<tr>
<td class="meta-label">REQUESTOR:</td>
<td class="meta-value" colspan="2">${requestor}</td>
<td class="meta-label-right">GEM SO No.:</td>
<td class="meta-blue">${gemSo}</td>
<td class="meta-label-right">JO No.:</td>
<td class="meta-blue">${joNo}</td>
</tr>
<tr>
<td class="meta-label">DEPARTMENT/SECTION:</td>
<td class="meta-value" colspan="4">${department}</td>
<td class="meta-label-right">CLIENT NAME:</td>
<td class="meta-value">${client}</td>
</tr>
<tr>
<td class="meta-label">DATE:</td>
<td class="meta-blue" colspan="2">${dateStr}</td>
<td class="meta-label-right">PROJECT:</td>
<td class="meta-value" colspan="3">${project}</td>
</tr>
</table>
<table class="mrif-items">
<thead>
<tr>
<th style="width:5%">ITEM<br>NO.</th>
<th style="width:14%">ITEM<br>CODE</th>
<th style="width:7%">QR<br>IMG</th>
<th style="width:34%">ITEM DESCRIPTION</th>
<th style="width:9%">REQ.<br>QTY</th>
<th style="width:9%">ISSUED<br>QTY</th>
<th style="width:7%">UNIT</th>
<th style="width:15%">REMARKS</th>
</tr>
</thead>
<tbody>${itemsHtml}</tbody>
</table>
<div class="mrif-sigs">
<div class="mrif-sig">
<div class="mrif-sig-line">ANGEL / JOMAR / RICHEL / ERWIN / MARCEL</div>
<div class="mrif-sig-label">ISSUED BY</div>
</div>
<div class="mrif-sig">
<div class="mrif-sig-line">&nbsp;</div>
<div class="mrif-sig-label">CHECKED BY</div>
</div>
<div class="mrif-sig">
<div class="mrif-sig-line">&nbsp;</div>
<div class="mrif-sig-label">RECEIVED BY/DATE</div>
</div>
</div>
</div>`;

container.innerHTML = html;
}
function printMrif() {
window.print();
}

function closeMrifPrint() {
if (mrifPrintModal) mrifPrintModal.hide();
}

document.addEventListener('DOMContentLoaded', () => {
initRole();
// Set default receiving date for MRR
document.getElementById('mrrReceivingDate').valueAsDate = new Date();
});
