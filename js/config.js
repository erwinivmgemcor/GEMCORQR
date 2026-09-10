// ============================================================
// CONFIGURATION
// ============================================================

// ⚠️ IMPORTANT: Replace this URL with your CURRENT GAS Web App /exec URL
// To get a new URL: Apps Script → Deploy → Manage deployments → copy the /exec URL
const API_URL = 'https://script.google.com/macros/s/AKfycbw-EX38TvEOLHcYRh0EUks9c9e7M0pIGS1fwi8ELPqs7KZnKtcy99hYZvIyg9blVSJz/exec';

const DEFAULT_PIN = '0000';
const APP_VERSION = '2.3.0';

const UNIT_OPTIONS = [
  'ASSEMB', 'BOX', 'CAN', 'GAL', 'KG', 'LENGTH', 'LITERS',
  'METER', 'MM', 'PAIR', 'PIECE', 'REAM', 'ROLL', 'SET',
  'SHEET', 'TANK', 'UNIT'
];

// ─── Cache TTLs (milliseconds) — DEFINED ONLY HERE ──────
const CACHE_TTL = {
  INVENTORY: 5 * 60 * 1000,    // 5 minutes
  VENDORS: 10 * 60 * 1000,     // 10 minutes
  IVM_TEAM: 10 * 60 * 1000,    // 10 minutes
  PENDING_DOCS: 1 * 60 * 1000, // 1 minute
  REQUESTORS: 10 * 60 * 1000   // 10 minutes
};

// ─── Clear cache on version change ──────────────────────
var CACHE_VERSION_KEY = 'ivm_cache_version';
if (localStorage.getItem(CACHE_VERSION_KEY) !== APP_VERSION) {
  Object.keys(localStorage).forEach(function(k) {
    if (k.indexOf('ivm_cache_') === 0) localStorage.removeItem(k);
  });
  localStorage.setItem(CACHE_VERSION_KEY, APP_VERSION);
}
