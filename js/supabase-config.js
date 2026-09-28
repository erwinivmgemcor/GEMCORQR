// ============================================================
// SUPABASE CONFIGURATION
// ============================================================

// ⚠️ IMPORTANT: Replace with your actual Supabase project URL
const SUPABASE_URL = 'https://tphstadcscquiezuxsis.supabase.co';

// ⚠️ IMPORTANT: Replace with your actual anon public key
// Get it from: Supabase Dashboard → Settings → API → anon public
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwaHN0YWRjc2NxdWllenV4c2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1OTI4NTksImV4cCI6MjEwNjE2ODg1OX0.7x7KCpcdGYkDsjs3RBdfhhhSamFP-xEfNY5prIkLWL8';

// Whether to use Supabase or Google Apps Script
// Set to true when testing the Supabase version
// Set to false to use the current GAS version
const USE_SUPABASE = true;

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
