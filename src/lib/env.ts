// Each setting accepts more than one name so the Supabase <-> Vercel
// integration's synced variables work without renaming.
function required(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing environment variable ${names[0]}`);
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY");
  },
  get encryptionKey() {
    return required("STRIPE_KEY_ENCRYPTION_KEY");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  get superAdminEmail() {
    return required("SUPER_ADMIN_EMAIL").trim().toLowerCase();
  },
  get siteUrl() {
    const explicit = process.env.NEXT_PUBLIC_SITE_URL;
    if (explicit) return explicit.replace(/\/$/, "");
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
    if (vercel) return `https://${vercel}`;
    return "http://localhost:3000";
  },
};
