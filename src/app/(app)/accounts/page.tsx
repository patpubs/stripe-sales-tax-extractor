import { requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateTime } from "@/lib/format";
import { AddAccountForm, AccountRow } from "./account-forms";

export default async function AccountsPage() {
  await requireSuperAdmin();
  // Never select encrypted_key here: this data is rendered to the browser.
  const { data, error } = await createAdminClient()
    .from("stripe_accounts")
    .select("id, name, key_hint, stripe_account_id, livemode, timezone, archived, created_at")
    .order("archived")
    .order("name");
  if (error) throw error;

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-lg font-semibold">Connect a Stripe account</h2>
        <p className="mt-1 text-sm text-slate-600">
          In Stripe, go to Developers → API keys → Create restricted key, and give it <strong>Read</strong> access to
          Charges (under Core) and Customers. Leave everything else as None. The key is encrypted before it is stored and
          is never shown again.
        </p>
        <AddAccountForm />
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold">Connected accounts</h2>
        <div className="mt-4 divide-y divide-slate-100">
          {(data ?? []).length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
          {(data ?? []).map((a) => (
            <AccountRow key={a.id} account={{ ...a, created_label: dateTime(a.created_at) }} />
          ))}
        </div>
      </section>
    </div>
  );
}
