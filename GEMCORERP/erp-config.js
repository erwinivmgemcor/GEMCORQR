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
// RATIO FORMULA SETTINGS — Turnover Ratio & Inventory Ratio
// Ang formula, days-per-year at status thresholds ay puwedeng baguhin sa "Ratio Settings"
// (Management Dashboard / Stock Monitor) — walang kailangang i-edit sa code.
// Naka-save sa Supabase table `erp_settings` (key = 'ratio_formula'), kaya pareho ang makikita ng lahat.
// Kung wala pa ang table, sa browser lang na ito muna ang save (localStorage).
//
// Defaults = eksaktong dating formula:
//   Per item : Turnover = (Ave/Mo × 12) ÷ On-Hand ;  Inventory Ratio (stock cover) = days-per-year ÷ Turnover, shown as days / months / years
//   Dashboard: Turnover = computed by the server (stock-ledger stock-out value ÷ current inventory × 365/days) ; Inventory Ratio = 365 ÷ Turnover
// ═══════════════════════════════════════════════════════════
var ERP_RATIO_LS_KEY = 'erp_ratio_settings_v1';
var ERP_RATIO_DEFAULTS = {
  dpy: 365,
  bands: [2, 4, 8],
  overall: { tMode: 'system', turnover: 'stockOut / inv * (dpy / days)', invRatio: 'dpy / turnover', invUnit: 'days' },
  item:    { turnover: 'aveMo * 12 / onHand', invRatio: 'dpy / turnover' }
};
// Mga variable na puwedeng gamitin sa bawat formula
var ERP_RATIO_VARS = {
  'overall.turnover': ['issuedMo', 'receivedMo', 'stockOut', 'issued', 'returned', 'inv', 'invActive', 'usageMo', 'days', 'dpy'],
  'overall.invRatio': ['issuedMo', 'receivedMo', 'stockOut', 'issued', 'returned', 'inv', 'invActive', 'usageMo', 'days', 'dpy', 'turnover'],
  'item.turnover':    ['onHand', 'aveMo', 'dpy'],
  'item.invRatio':    ['onHand', 'aveMo', 'dpy', 'turnover']
};
var ERP_RATIO_FUNCS = { min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, round: Math.round };

// Plain-language na pangalan ng bawat variable (ito ang makikita ng users, hindi ang code name)
var ERP_RATIO_NAMES = {
  issuedMo:  'Average monthly issued value (history)',
  receivedMo:'Average monthly received value (history)',
  stockOut:  'Stock-out value (stock ledger)',
  issued:    'Issued value (MRIF)',
  returned:  'Returned value (MRS)',
  inv:       'Inventory value',
  invActive: 'Inventory value (items with usage only)',
  usageMo:   'Average monthly usage value',
  days:      'Days in period',
  dpy:       'Days in a year',
  turnover:  'Turnover Ratio',
  onHand:    'On-Hand qty',
  aveMo:     'Average monthly usage'
};
// Mga pagpipilian para sa "Days in a year"
var ERP_RATIO_DPY_OPTIONS = [
  { v: 365, label: '365 — every calendar day (default)' },
  { v: 360, label: '360 — 12 months × 30 days (banking style)' },
  { v: 312, label: '312 — working days, Mon–Sat' },
  { v: 260, label: '260 — working days, Mon–Fri' }
];
// Gawing pangungusap ang formula: "issued / inv * (dpy / days)" → "Issued value (MRIF) ÷ Inventory value × (Days in a year ÷ Days in period)"
function erpRatioWords(expr) {
  return String(expr == null ? '' : expr).replace(/[A-Za-z_][A-Za-z0-9_]*|[*\/+\-]/g, function (t) {
    if (ERP_RATIO_NAMES[t]) return ERP_RATIO_NAMES[t];
    return { '*': '×', '/': '÷', '-': '−', '+': '+' }[t] || t;
  }).replace(/\s+/g, ' ').trim();
}

var _erpRatio = { saved: null, cur: null, preview: false, loaded: false, compiled: {} };

function erpRatioClone(o) { return JSON.parse(JSON.stringify(o)); }

// Ligtas na formula evaluator: letters/numbers/+ - * / ( ) . , lang, at kilalang variable/function lang.
function erpRatioCompile(expr, vars) {
  expr = String(expr == null ? '' : expr).trim();
  if (!expr) throw new Error('Formula is empty');
  if (expr.length > 200) throw new Error('Formula is too long');
  if (!/^[0-9A-Za-z_+\-*\/().,\s]+$/.test(expr)) throw new Error('Only letters, numbers and + − × ÷ ( ) are allowed');
  var ids = expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  for (var i = 0; i < ids.length; i++) {
    if (vars.indexOf(ids[i]) < 0 && !Object.prototype.hasOwnProperty.call(ERP_RATIO_FUNCS, ids[i])) {
      throw new Error('Unknown item: ' + ids[i]);
    }
  }
  var fnNames = Object.keys(ERP_RATIO_FUNCS);
  var names = vars.concat(fnNames);
  var fn;
  try { fn = new Function(names.join(','), '"use strict"; return (' + expr + ');'); }
  catch (e) { throw new Error('The formula is not written correctly'); }
  return function (v) {
    var args = vars.map(function (n) { return Number(v[n]); }).concat(fnNames.map(function (n) { return ERP_RATIO_FUNCS[n]; }));
    return fn.apply(null, args);
  };
}

// → { ok: true } o { ok: false, error: '...' }
function erpRatioCheck(path, expr) {
  try {
    var f = erpRatioCompile(expr, ERP_RATIO_VARS[path]);
    var sample = {}; ERP_RATIO_VARS[path].forEach(function (n) { sample[n] = 1; });
    f(sample);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}

// Kalkulahin. Kung may exprOverride, ito ang gagamitin (para sa preview). → number | null
function erpRatioEval(path, vars, exprOverride) {
  try {
    var parts = path.split('.');
    var expr = exprOverride != null ? exprOverride : _erpRatio.cur[parts[0]][parts[1]];
    var key = path + '|' + expr;
    var f = _erpRatio.compiled[key] || (_erpRatio.compiled[key] = erpRatioCompile(expr, ERP_RATIO_VARS[path]));
    var r = f(vars);
    return (typeof r === 'number' && isFinite(r)) ? r : null;
  } catch (e) { return null; }
}

function erpRatioNormalize(raw) {
  var d = erpRatioClone(ERP_RATIO_DEFAULTS), r = raw || {};
  var dpy = Number(r.dpy);
  if (dpy >= 1 && dpy <= 400) d.dpy = dpy;
  if (Array.isArray(r.bands) && r.bands.length === 3) {
    var b = r.bands.map(Number);
    if (b[0] > 0 && b[0] < b[1] && b[1] < b[2]) d.bands = b;
  }
  ['overall.turnover', 'overall.invRatio', 'item.turnover', 'item.invRatio'].forEach(function (path) {
    var pp = path.split('.'), v = r[pp[0]] && r[pp[0]][pp[1]];
    if (typeof v === 'string' && erpRatioCheck(path, v).ok) d[pp[0]][pp[1]] = v.trim();
  });
  if (r.overall && r.overall.tMode === 'custom') d.overall.tMode = 'custom';
  if (r.overall && r.overall.invUnit === 'months') d.overall.invUnit = 'months';
  return d;
}

function erpRatioGet() { return _erpRatio.cur; }
function erpRatioGetSaved() { return _erpRatio.saved; }
function erpRatioIsPreview() { return _erpRatio.preview; }
function erpRatioIsDefault(path) {
  var pp = path.split('.');
  if (path === 'overall.turnover' && _erpRatio.cur.overall.tMode === 'system') return true;
  return _erpRatio.cur[pp[0]][pp[1]] === ERP_RATIO_DEFAULTS[pp[0]][pp[1]];
}

function erpRatioApplyBands() {
  var b = _erpRatio.cur.bands;
  // in-place, para ang lahat ng gumagamit ng ERP_TURNOVER_BANDS (dashboard, stock monitor) ay sumunod
  ERP_TURNOVER_BANDS[0].max = b[0]; ERP_TURNOVER_BANDS[1].max = b[1]; ERP_TURNOVER_BANDS[2].max = b[2];
}

function erpRatioNotify() {
  try { window.dispatchEvent(new CustomEvent('erp-ratio-changed', { detail: { preview: _erpRatio.preview } })); } catch (e) {}
}

// I-apply ang settings sa buong page. preview=true → hindi pa naka-save (mawawala pag nag-reload).
function erpRatioApply(settings, preview) {
  _erpRatio.cur = erpRatioNormalize(settings);
  _erpRatio.preview = !!preview;
  erpRatioApplyBands();
  erpRatioNotify();
}
function erpRatioRevert() { erpRatioApply(_erpRatio.saved, false); }

async function erpRatioLoad() {
  try {
    var res = await fetch(erpUrl('erp_settings') + '?select=value&key=eq.ratio_formula&limit=1', { headers: erpHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var rows = await res.json();
    _erpRatio.loaded = true;
    if (rows && rows[0] && rows[0].value) {
      var norm = erpRatioNormalize(rows[0].value);
      var changed = JSON.stringify(norm) !== JSON.stringify(_erpRatio.saved);
      _erpRatio.saved = norm;
      try { localStorage.setItem(ERP_RATIO_LS_KEY, JSON.stringify(norm)); } catch (e) {}
      if (!_erpRatio.preview && changed) erpRatioApply(norm, false);
    }
    return true;
  } catch (e) {
    console.warn('[Ratio] settings table unavailable, using local/default:', e.message);
    return false;
  }
}

// → { ok, shared }  shared=false kapag sa browser lang na ito na-save (wala pa ang table)
async function erpRatioSave(settings) {
  var norm = erpRatioNormalize(settings);
  var who = 'UNKNOWN';
  try { who = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'UNKNOWN'; } catch (e) {}
  var shared = true;
  try {
    var res = await fetch(erpUrl('erp_settings') + '?on_conflict=key', {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{ key: 'ratio_formula', value: norm, updated_by: who, updated_at: new Date().toISOString() }])
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (e) {
    console.warn('[Ratio] save to Supabase failed:', e.message);
    shared = false;
  }
  _erpRatio.saved = norm;
  try { localStorage.setItem(ERP_RATIO_LS_KEY, JSON.stringify(norm)); } catch (e) {}
  erpRatioApply(norm, false);
  return { ok: true, shared: shared };
}

// ═══════════════════════════════════════════════════════════
// ITEM TURNOVER RATIO (per item) — shared by Stock Monitor and Management Dashboard
// Default: Turnover (×/year) = (Ave monthly consumption × 12) ÷ current On-Hand
//          Days of stock    = days-per-year ÷ turnover (= On-Hand ÷ average daily usage)
// Puwedeng baguhin sa Ratio Settings. Bands (thresholds) ay nasa settings din.
// ═══════════════════════════════════════════════════════════
var ERP_TURNOVER_BANDS = [
  { max: 2,        label: 'Very slow', cls: 'danger', meaning: 'Stock sits in the warehouse for most of the year. A lot of cash is tied up.' },
  { max: 4,        label: 'Slow',      cls: 'warn',   meaning: 'Stock moves, but slowly. There is room to reduce over-stocking.' },
  { max: 8,        label: 'Healthy',   cls: 'ok',     meaning: 'Stock moves at a good pace for a manufacturing operation.' },
  { max: Infinity, label: 'Fast',      cls: 'fast',   meaning: 'Stock moves very quickly. Check that buffers are enough to avoid stock-outs.' }
];

// Initial settings: galing sa naka-save na cache (para agad), tapos erpRatioLoad() ang magre-refresh mula sa server
(function () {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(ERP_RATIO_LS_KEY) || 'null'); } catch (e) {}
  _erpRatio.saved = erpRatioNormalize(saved);
  _erpRatio.cur = erpRatioClone(_erpRatio.saved);
  erpRatioApplyBands();
})();

function erpItemTurnover(onHand, aveMonthly) {
  onHand = Number(onHand || 0); aveMonthly = Number(aveMonthly || 0);
  if (onHand <= 0) return { ratio: null, cls: 'na', label: 'Out of stock', days: null, annual: aveMonthly * 12, onHand: onHand };
  if (aveMonthly <= 0) return { ratio: 0, cls: 'danger', label: 'No usage', days: null, annual: 0, onHand: onHand };
  var S = _erpRatio.cur, annual = aveMonthly * 12;
  var v = { onHand: onHand, aveMo: aveMonthly, dpy: S.dpy };
  var ratio = erpRatioEval('item.turnover', v);
  if (ratio === null) ratio = annual / onHand;                  // fallback: default formula
  var band = ERP_TURNOVER_BANDS[ERP_TURNOVER_BANDS.length - 1];
  for (var i = 0; i < ERP_TURNOVER_BANDS.length; i++) { if (ratio < ERP_TURNOVER_BANDS[i].max) { band = ERP_TURNOVER_BANDS[i]; break; } }
  v.turnover = ratio;
  var days = erpRatioEval('item.invRatio', v);
  if (days === null || days < 0) days = ratio > 0 ? S.dpy / ratio : null;
  return { ratio: ratio, cls: band.cls, label: band.label, days: days, annual: annual, onHand: onHand };
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
    tip = t.label + (erpRatioIsDefault('item.turnover')
      ? '\nAnnual usage ' + Math.round(t.annual).toLocaleString() + ' ÷ On-Hand ' + Math.round(t.onHand).toLocaleString()
      : '\nFormula: ' + erpRatioWords(_erpRatio.cur.item.turnover)) +
          (t.days !== null ? '\n≈ ' + Math.round(t.days).toLocaleString() + ' days of stock on hand' : '\nNo consumption recorded');
  }
  return '<span title="' + tip.replace(/"/g, '&quot;').replace(/\n/g, '&#10;') + '" style="display:inline-block;min-width:44px;padding:2px 8px;border-radius:999px;' +
    'font-size:0.72rem;font-weight:700;background:' + colors[0] + ';color:' + colors[1] + ';">' + txt + '</span>';
}


// Inventory Ratio per item = days of stock on hand (default: days-per-year ÷ turnover = On-Hand ÷ average daily usage)
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
    var d = Math.round(t.days), mo = t.days * 12 / _erpRatio.cur.dpy;       // months on the same basis as the Google Sheet (On-Hand ÷ Ave/Mo)
    txt = d < 60 ? d.toLocaleString() + ' d' : (mo < 24 ? mo.toFixed(1) + ' mo' : (mo >= 1200 ? '100+ yr' : (mo / 12).toFixed(1) + ' yr'));
    tip = 'Stock cover: how long the current On-Hand lasts at average usage\n' + t.label +
          (erpRatioIsDefault('item.invRatio')
      ? '\nOn-Hand ' + Math.round(t.onHand).toLocaleString() + ' ÷ average monthly usage ' + (t.annual / 12).toLocaleString(undefined, { maximumFractionDigits: 2 })
      : '\nFormula: ' + erpRatioWords(_erpRatio.cur.item.invRatio)) +
          '\n= ' + mo.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' months (same as “Inventory Ratio” in the Google Sheet)' +
          '\n≈ ' + d.toLocaleString() + ' days' + (mo >= 24 ? ' ≈ ' + (mo / 12).toFixed(1) + ' years' : '');
  }
  return '<span title="' + tip.replace(/"/g, '&quot;').replace(/\n/g, '&#10;') + '" style="display:inline-block;min-width:50px;padding:2px 8px;border-radius:999px;' +
    'font-size:0.72rem;font-weight:700;background:' + colors[0] + ';color:' + colors[1] + ';">' + txt + '</span>';
}

console.log('✅ erp-config.js loaded — v' + ERP_APP_VERSION);
