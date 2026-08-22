// ============================================================
// Supabase client initialization
// - Replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` from your Supabase
//   project settings. Do NOT embed service_role keys in client-side code.
// - The anon/public key is intended for browser apps. Keep sensitive
//   keys on the server and never commit them to source control.
// ============================================================
(function(){
	const SUPABASE_URL = "https://cmphacwtgdnkifqxafch.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtcGhhY3d0Z2Rua2lmcXhhZmNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3OTI2ODgsImV4cCI6MjA5OTM2ODY4OH0.6SpbM_QanNb4W8OSySxBHKkYWZSLDjfi_4Vc8gw4o9g";

// Create a single client instance and expose both `supabase` and
// `supabaseClient` for compatibility across the codebase. Prefer using
// `supabase` (lowercase) where available.
const _supabaseClient = window.supabase && typeof window.supabase.createClient === 'function'
	? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
	: null;

if (!_supabaseClient) console.error('Supabase SDK not loaded. Ensure the CDN script is included before supabase-config.js');

// Expose consistently
window.supabase = _supabaseClient;
window.supabaseClient = _supabaseClient;
const supabase = _supabaseClient;

})();