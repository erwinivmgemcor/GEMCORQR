// ============================================================
// CONFIGURATION
// ============================================================

const API_URL = 'https://script.google.com/macros/s/AKfycbwVA3jgdDU1_O07bQ0CktKHaFEwsImBiO83Sc3zA919FN07svtGyYQNwqRHXJ1Vtvc2/exec';

const DEFAULT_PIN = '0000';
const APP_VERSION = '2.4.6';
const APP_BUILD = '20260927-2050-8b7de6c';

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
  ANALYTICS:    10 * 60 * 1000,        // ★ increased from 5 to 10 min
  MODULE_LINKS: 60 * 60 * 1000
};

// ─── Clear cache on version change ───
var CACHE_VERSION_KEY = 'ivm_cache_version';
if (localStorage.getItem(CACHE_VERSION_KEY) !== APP_VERSION) {
  Object.keys(localStorage).forEach(function(k) {
    if (k.indexOf('ivm_cache_') === 0) localStorage.removeItem(k);
  });
  localStorage.setItem(CACHE_VERSION_KEY, APP_VERSION);
}
