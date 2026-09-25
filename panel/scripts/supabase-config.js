// panel/scripts/supabase-config.js
// Supabase frontend kimlik bilgileri. Bu dosya repoya PLACEHOLDER'LI commit edilir
// (Commit A). Gerçek değerler local'de elle doldurulur (Commit B) — anon key
// public'tir ve RLS (0002, 28 politika) ile korunur; bu yüzden repoya yazılması
// güvenlik ihlali değildir. service_role key BURAYA HİÇBİR ZAMAN GİRMEZ.
window.ATLAS_SUPABASE_CONFIG = {
  url: "",      // ör. https://lfllontezrfcmjntsgix.supabase.co  (sen doldur)
  anonKey: ""   // publishable anon key  (sen doldur)
};
