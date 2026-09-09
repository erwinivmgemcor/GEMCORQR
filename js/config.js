// ============================================================
// CONFIGURATION
// ============================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbw-EX38TvEOLHcYRh0EUks9c9e7M0pIGS1fwi8ELPqs7KZnKtcy99hYZvIyg9blVSJz/exec';
const DEFAULT_PIN = '0000';
const APP_VERSION = '2.1.0';

const UNIT_OPTIONS = [
  'ASSEMB', 'BOX', 'CAN', 'GAL', 'KG', 'LENGTH', 'LITERS',
  'METER', 'MM', 'PAIR', 'PIECE', 'REAM', 'ROLL', 'SET',
  'SHEET', 'TANK', 'UNIT'
];

// ─── Cache TTLs (milliseconds) ──────────────────────────────
const CACHE_TTL = {
  INVENTORY: 5 * 60 * 1000,    // 5 minutes
  VENDORS: 10 * 60 * 1000,     // 10 minutes
  IVM_TEAM: 10 * 60 * 1000,    // 10 minutes
  PENDING_DOCS: 1 * 60 * 1000, // 1 minute
  REQUESTORS: 10 * 60 * 1000,  // 10 minutes
};

// ─── Clear cache on version change ──────────────────────────
const CACHE_VERSION_KEY = 'ivm_cache_version';
if (localStorage.getItem(CACHE_VERSION_KEY) !== APP_VERSION) {
  // Clear all cache
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('ivm_cache_')) localStorage.removeItem(k);
  });
  localStorage.setItem(CACHE_VERSION_KEY, APP_VERSION);
}
