// Force light mode
document.documentElement.setAttribute('data-theme', 'light');
try { localStorage.setItem('erp_theme', 'light'); } catch(e) {}

// ============================================================
// GEMCOR ERP — Configuration
// Pure Supabase, no GAS
// ============================================================

const ERP_SUPABASE_URL = 'https://tphstadcscquiezuxsis.supabase.co';
const ERP_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwaHN0YWRjc2NxdWllenV4c2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1OTI4NTksImV4cCI6MjEwNjE2ODg1OX0.7x7KCpcdGYkDsjs3RBdfhhhSamFP-xEfNY5prIkLWL8';

const ERP_APP_VERSION = '1.3.9';
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

// ─── Display-only wording: "CUTOVER" → "BEGBAL" / "Beg. Bal." ───
// Ang data sa database (hal. reference "CUTOVER-20261031-1157") ay HINDI binabago — ang ipinapakita lang.
// May mga report na gumagamit ng salitang iyon para makilala ang beginning-balance rows.
function erpDisplayText(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/CUTOVER/g, 'BEGBAL')
    .replace(/(^|[^A-Za-z0-9_])cut-?over(?![A-Za-z0-9_])/gi, '$1Beg. Bal.');
}
window.erpDisplayText = erpDisplayText;

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

// ═══════════════════════════════════════════════════════════
// ITEM TURNOVER RATIO (per item) — shared by Stock Monitor and Management Dashboard
// Turnover (×/year) = (Ave monthly consumption × 12) ÷ current On-Hand
// Days of stock    = 365 ÷ turnover  (= On-Hand ÷ average daily usage)
// Bands are rules of thumb; adjust with management.
// ═══════════════════════════════════════════════════════════
var ERP_TURNOVER_BANDS = [
  { max: 2,        label: 'Very slow', cls: 'danger', meaning: 'Stock sits in the warehouse for most of the year. A lot of cash is tied up.' },
  { max: 4,        label: 'Slow',      cls: 'warn',   meaning: 'Stock moves, but slowly. There is room to reduce over-stocking.' },
  { max: 8,        label: 'Healthy',   cls: 'ok',     meaning: 'Stock moves at a good pace for a manufacturing operation.' },
  { max: Infinity, label: 'Fast',      cls: 'fast',   meaning: 'Stock moves very quickly. Check that buffers are enough to avoid stock-outs.' }
];

function erpItemTurnover(onHand, aveMonthly) {
  onHand = Number(onHand || 0); aveMonthly = Number(aveMonthly || 0);
  if (onHand <= 0) return { ratio: null, cls: 'na', label: 'Out of stock', days: null, annual: aveMonthly * 12, onHand: onHand };
  if (aveMonthly <= 0) return { ratio: 0, cls: 'danger', label: 'No usage', days: null, annual: 0, onHand: onHand };
  var annual = aveMonthly * 12, ratio = annual / onHand, band = ERP_TURNOVER_BANDS[ERP_TURNOVER_BANDS.length - 1];
  for (var i = 0; i < ERP_TURNOVER_BANDS.length; i++) { if (ratio < ERP_TURNOVER_BANDS[i].max) { band = ERP_TURNOVER_BANDS[i]; break; } }
  return { ratio: ratio, cls: band.cls, label: band.label, days: 365 / ratio, annual: annual, onHand: onHand };
}

// Small colored badge (inline styles, so it works on any page)
function erpTurnoverBadge(onHand, aveMonthly) {
  var t = erpItemTurnover(onHand, aveMonthly);
  var colors = {
    danger: ['#fee2e2', '#b91c1c'], warn: ['#fef3c7', '#b45309'], ok: ['#dcfce7', '#166534'],
    fast: ['#dbeafe', '#1d4ed8'], na: ['#f1f5f9', '#64748b']
  }[t.cls];
  var txt, tip;
  if (t.ratio === null) { txt = '—'; tip = 'Out of stock: turnover not applicable'; }
  else {
    txt = t.ratio === 0 ? '0.0×' : (t.ratio < 0.1 ? '<0.1×' : (t.ratio >= 100 ? '99+×' : t.ratio.toFixed(1) + '×'));
    tip = t.label + '\nAnnual usage ' + Math.round(t.annual).toLocaleString() + ' ÷ On-Hand ' + Math.round(t.onHand).toLocaleString() +
          (t.days !== null ? '\n≈ ' + Math.round(t.days).toLocaleString() + ' days of stock on hand' : '\nNo consumption recorded');
  }
  return '<span title="' + tip.replace(/"/g, '&quot;').replace(/\n/g, '&#10;') + '" style="display:inline-block;min-width:44px;padding:2px 8px;border-radius:999px;' +
    'font-size:0.72rem;font-weight:700;background:' + colors[0] + ';color:' + colors[1] + ';">' + txt + '</span>';
}


// Inventory Ratio per item = days of stock on hand = On-Hand ÷ average daily usage (= 365 ÷ turnover)
function erpInventoryRatioBadge(onHand, aveMonthly) {
  var t = erpItemTurnover(onHand, aveMonthly);
  var colors = {
    danger: ['#fee2e2', '#b91c1c'], warn: ['#fef3c7', '#b45309'], ok: ['#dcfce7', '#166534'],
    fast: ['#dbeafe', '#1d4ed8'], na: ['#f1f5f9', '#64748b']
  }[t.cls];
  var txt, tip;
  if (t.ratio === null) { txt = '—'; tip = 'Out of stock'; }
  else if (t.days === null) { txt = 'No usage'; tip = 'Has stock but no recorded consumption'; }
  else {
    var d = Math.round(t.days);
    txt = d >= 3650 ? '10y+' : d.toLocaleString() + ' d';
    tip = t.label + '\nOn-Hand ' + Math.round(t.onHand).toLocaleString() + ' ÷ average daily usage ' + (t.annual / 365).toFixed(2) +
          '\n= ' + d.toLocaleString() + ' days (≈ ' + (t.days / 30.4).toFixed(1) + ' months) of stock';
  }
  return '<span title="' + tip.replace(/"/g, '&quot;').replace(/\n/g, '&#10;') + '" style="display:inline-block;min-width:50px;padding:2px 8px;border-radius:999px;' +
    'font-size:0.72rem;font-weight:700;background:' + colors[0] + ';color:' + colors[1] + ';">' + txt + '</span>';
}

console.log('✅ erp-config.js loaded — v' + ERP_APP_VERSION);
