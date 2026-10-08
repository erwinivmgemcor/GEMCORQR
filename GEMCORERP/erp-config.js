// Force light mode
document.documentElement.setAttribute('data-theme', 'light');
try { localStorage.setItem('erp_theme', 'light'); } catch(e) {}

// ============================================================
// GEMCOR ERP — Configuration
// Pure Supabase, no GAS
// ============================================================

const ERP_SUPABASE_URL = 'https://tphstadcscquiezuxsis.supabase.co';
const ERP_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwaHN0YWRjc2NxdWllenV4c2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1OTI4NTksImV4cCI6MjEwNjE2ODg1OX0.7x7KCpcdGYkDsjs3RBdfhhhSamFP-xEfNY5prIkLWL8';

const ERP_APP_VERSION = '1.0.0';
const ERP_CACHE_TTL = {
  STOCK_SUMMARY:  60 * 1000,       // 1 min
  ALL_ITEMS:      5 * 60 * 1000,   // 5 min
  WEEKLY:         5 * 60 * 1000,   // 5 min
  REORDER:        2 * 60 * 1000,   // 2 min
  ALERTS:         30 * 1000,       // 30 sec
  ITEM_DETAILS:   5 * 60 * 1000    // 5 min
};

// ─── Supabase helpers ───
function erpUrl(table) {
  return ERP_SUPABASE_URL + '/rest/v1/' + table;
}

function erpHeaders(extra) {
  var h = {
    'apikey': ERP_SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + ERP_SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  if (extra) {
    for (var k in extra) h[k] = extra[k];
  }
  return h;
}

// ─── Simple localStorage cache ───
function erpGetCache(key) {
  try {
    var raw = localStorage.getItem('erp_cache_' + key);
    if (!raw) return null;
    var item = JSON.parse(raw);
    if (Date.now() > item.expires) {
      localStorage.removeItem('erp_cache_' + key);
      return null;
    }
    return item.data;
  } catch (e) {
    return null;
  }
}

function erpSetCache(key, data, ttl) {
  try {
    localStorage.setItem('erp_cache_' + key, JSON.stringify({
      data: data,
      expires: Date.now() + (ttl || 60000)
    }));
  } catch (e) {
    console.warn('[ERP Cache] Could not save:', key, e.message);
  }
}

function erpClearCache(key) {
  if (key) {
    localStorage.removeItem('erp_cache_' + key);
  } else {
    Object.keys(localStorage).forEach(function(k) {
      if (k.indexOf('erp_cache_') === 0) localStorage.removeItem(k);
    });
  }
}

// ─── Utility: escape HTML ───
function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Utility: format peso ───
function erpPeso(n) {
  if (n === null || n === undefined || isNaN(n)) return '₱0';
  return '₱' + Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

// ─── Utility: format number ───
function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}
console.log('✅ erp-config.js loaded — v' + ERP_APP_VERSION);
