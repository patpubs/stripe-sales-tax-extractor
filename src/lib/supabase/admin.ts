import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "../env";

// Service-role client. Bypasses RLS, so it is only ever used in server code
// after the caller has been authenticated (or by the worker with CRON_SECRET).
export function createAdminClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
