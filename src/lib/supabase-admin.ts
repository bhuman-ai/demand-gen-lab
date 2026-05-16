import { createClient } from "@supabase/supabase-js";

function getSupabaseAdminEnv() {
  return {
    url: process.env.SUPABASE_URL,
    // Support common env var names to avoid deployment footguns.
    key:
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SECRET_KEY,
  };
}

export function isSupabaseAdminConfigured() {
  const env = getSupabaseAdminEnv();
  return Boolean(env.url && env.key);
}

export function getSupabaseAdmin() {
  const env = getSupabaseAdminEnv();
  if (!env.url || !env.key) {
    return null;
  }
  return createClient(env.url, env.key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
