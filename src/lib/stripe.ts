import "server-only";
import Stripe from "stripe";
import { decryptSecret } from "./crypto";
import { createAdminClient } from "./supabase/admin";

export function stripeClient(secretKey: string) {
  return new Stripe(secretKey, {
    maxNetworkRetries: 2,
    timeout: 30_000,
    appInfo: { name: "stripe-sales-tax-extractor" },
  });
}

/** Load and decrypt a stored key. Server-only; never return this to a client. */
export async function stripeForAccount(stripeAccountRowId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("stripe_accounts")
    .select("encrypted_key")
    .eq("id", stripeAccountRowId)
    .single();
  if (error || !data) throw new Error("Stripe account not found");
  return stripeClient(decryptSecret(data.encrypted_key));
}

/**
 * Check that a key works and can read charges. Returns the Stripe account id
 * when the key is allowed to read it (restricted keys often are not).
 */
export async function verifyKey(secretKey: string) {
  if (!/^(rk|sk)_(live|test)_/.test(secretKey)) {
    throw new Error("That doesn't look like a Stripe secret or restricted key (rk_live_…).");
  }
  const stripe = stripeClient(secretKey);
  const charges = await stripe.charges.list({ limit: 1 });
  let accountId: string | null = null;
  try {
    const account = await stripe.accounts.retrieve();
    accountId = account.id;
  } catch {
    // Restricted keys without Connect read access can't retrieve the account; that's fine.
  }
  return {
    accountId,
    livemode: secretKey.includes("_live_") || Boolean(charges.data[0]?.livemode),
    isRestricted: secretKey.startsWith("rk_"),
  };
}
