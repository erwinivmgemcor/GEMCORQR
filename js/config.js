// ============================================================
// CONFIGURATION — v4
// Auto health check + auto cache bust on unreachable API
// ============================================================

const API_URL = 'https://script.google.com/macros/s/AKfycbwTiA7IOQOdq7cfuiiptoA06Oa7xkuh2-wA1fSA3pP2gqZKHUvcjy5AF2rb28ThF842/exec';

const DEFAULT_PIN = '0000';
const APP_VERSION = '4.0.144';
const APP_BUILD = '20261005-1157-a3a549a';

const UNIT_OPTIONS = [
  'ASSEMB', 'BOX', 'CAN', 'GAL', 'KG', 'LENGTH', 'LITERS',
  'METER', 'MM', 'PAIR', 'PIECE', 'REAM', 'ROLL', 'SET',
  'SHEET', 'TANK', 'UNIT'
];

const CACHE_TTL = {
  INVENTORY:    60 * 60 * 1000,
  VENDORS:      60 * 60 * 1000,
  IVM_TEAM:     60 * 60 * 1000,
  PENDING_DOCS: 5 * 60 * 1000,
  REQUESTORS:   60 * 60 * 1000,
  DOC_ITEMS:    5 * 60 * 1000,
  ANALYTICS:    10 * 60 * 1000,
  MODULE_LINKS: 60 * 60 * 1000
};

// ─── Clear cache on version change ───
var CACHE_VERSION_KEY = 'ivm_cache_version';
if (localStorage.getItem(CACHE_VERSION_KEY) !== APP_VERSION) {
  Object.keys(localStorage).forEach(function(k) {
    if (k.indexOf('ivm_cache_') === 0) localStorage.removeItem(k);
  });
  localStorage.setItem(CACHE_VERSION_KEY, APP_VERSION);
  console.log('[Config] Cache cleared — new version', APP_VERSION);
}

// ─── GAS Health Check ───
window._apiHealthy = true;
window._apiLastCheck = 0;
window._apiLastSuccess = 0;

window.checkApiHealth = async function(force) {
  var now = Date.now();
  if (!force && (now - window._apiLastCheck) < 30000) return window._apiHealthy;
  window._apiLastCheck = now;

  try {
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, 30000);
    var res = await fetch(API_URL + '?action=ping&_t=' + now, {
      redirect: 'follow',
      signal: ctrl.signal,
      cache: 'no-store'
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    var trimmed = String(text || '').trim();
    if (!trimmed || trimmed.charAt(0) === '<') throw new Error('Server returned HTML');
    var data = JSON.parse(trimmed);
    if (!data.success) throw new Error('Ping failed');

    window._apiHealthy = true;
    window._apiLastSuccess = now;
    return true;
  } catch(e) {
    window._apiHealthy = false;
    console.error('[API Health] Unreachable:', e.message);
    return false;
  }
};

// ─── Initial health check (non-blocking) ───
setTimeout(function() { window.checkApiHealth(true); }, 500);
