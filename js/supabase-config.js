// ============================================================
// SUPABASE CONFIGURATION
// ============================================================

const SUPABASE_URL = 'https://tphstadcscquiezuxsis.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwaHN0YWRjc2NxdWllenV4c2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1OTI4NTksImV4cCI6MjEwNjE2ODg1OX0.7x7KCpcdGYkDsjs3RBdfhhhSamFP-xEfNY5prIkLWL8';

// Toggle: reads from Supabase when true, falls back to GAS when false
const USE_SUPABASE_READS = true;

function sbUrl(table) {
  return SUPABASE_URL + '/rest/v1/' + table;
}

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

console.log('✅ supabase-config.js loaded');
