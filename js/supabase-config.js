// ============================================================
// SUPABASE CONFIGURATION
// ============================================================
// This file is only loaded when USE_SUPABASE = true.
// The GAS version uses js/config.js instead.
// ============================================================

const SUPABASE_URL = 'https://tphstadcscquiezuxsis.supabase.co';

// ⚠️ Verified: This is the ANON (public) key. Safe to embed in client-side JS.
//    The service_role key is NEVER used here.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwaHN0YWRjc2NxdWllenV4c2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1OTI4NTksImV4cCI6MjEwNjE2ODg1OX0.7x7KCpcdGYkDsjs3RBdfhhhSamFP-xEfNY5prIkLWL8';

// ─── Build Supabase REST API URL ───
function sbUrl(table) {
  return SUPABASE_URL + '/rest/v1/' + table;
}

// ─── Build Supabase headers ───
function sbHeaders(extra) {
  var h = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  if (extra) {
    for (var k in extra) h[k] = extra[k];
  }
  return h;
}

// ─── App constants (same as GAS version) ───
const APP_VERSION = '3.0.0';
const APP_BUILD   = 'supabase';
const DEFAULT_PIN = '0000';

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

console.log('✅ supabase-config.js loaded');
