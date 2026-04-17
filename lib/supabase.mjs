// =============================================================
// CONFIG SUPABASE
// =============================================================
// Centralise la création du client Supabase pour le réutiliser
// dans les routes d'auth et le middleware.
// =============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ SUPABASE_URL et SUPABASE_ANON_KEY doivent être définis dans .env");
  process.exit(1);
}

// Le client "public" — utilisé pour inscription/connexion
// (avec la clé anon, pas de privilèges admin)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,    // Le serveur ne stocke pas les sessions
    autoRefreshToken: false,  // Les tokens sont gérés par le client
  },
});
