// ============================================================
// CONFIGURATION
// ============================================================

// ⚠️ IMPORTANT: Replace this URL with your CURRENT GAS Web App /exec URL
// To get a new URL: Apps Script → Deploy → Manage deployments → copy the /exec URL
const API_URL = 'https://script.google.com/macros/s/AKfycbwVA3jgdDU1_O07bQ0CktKHaFEwsImBiO83Sc3zA919FN07svtGyYQNwqRHXJ1Vtvc2/exec';

const DEFAULT_PIN = '0000';
const APP_VERSION = '2.3.3';
const APP_BUILD = '20260922-0218-1d8eaad';

const UNIT_OPTIONS = [
  'ASSEMB', 'BOX', 'CAN', 'GAL', 'KG', 'LENGTH', 'LITERS',
  'METER', 'MM', 'PAIR', 'PIECE', 'REAM', 'ROLL', 'SET',
  'SHEET', 'TANK', 'UNIT'
];

// ─── Cache TTLs (milliseconds) — DEFINED ONLY HERE ──────
const CACHE_TTL = {
  INVENTORY: 60 * 60 * 1000,        // 60 min
  VENDORS: 60 * 60 * 1000,          // 60 min
  IVM_TEAM: 60 * 60 * 1000,         // 60 min
  PENDING_DOCS: 5 * 60 * 1000,      // 5 min
  REQUESTORS: 60 * 60 * 1000,       // 60 min
  DOC_ITEMS: 5 * 60 * 1000,         // 5 min
  ANALYTICS: 5 * 60 * 1000,         // 5 min
  MODULE_LINKS: 60 * 60 * 1000      // 60 min
};

// ─── Clear cache on version change ──────────────────────
var CACHE_VERSION_KEY = 'ivm_cache_version';
if (localStorage.getItem(CACHE_VERSION_KEY) !== APP_VERSION) {
  Object.keys(localStorage).forEach(function(k) {
    if (k.indexOf('ivm_cache_') === 0) localStorage.removeItem(k);
  });
  localStorage.setItem(CACHE_VERSION_KEY, APP_VERSION);
}
