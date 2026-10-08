import { requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateTime } from "@/lib/format";
import { InviteForm, UserActions } from "./user-forms";

export default async function UsersPage() {
  const me = await requireSuperAdmin();
  const admin = createAdminClient();
  const [{ data: profiles, error }, { data: authUsers }] = await Promise.all([
    admin.from("profiles").select("id, email, full_name, role, created_at").order("created_at"),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (error) throw error;
  const lastSignIn = new Map(authUsers?.users.map((u) => [u.id, u.last_sign_in_at]) ?? []);

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-lg font-semibold">Invite someone</h2>
        <p className="mt-1 text-sm text-slate-600">
          There is no public sign-up. Invite a person here and send them the link it gives you; they choose their own
          password.
        </p>
        <InviteForm />
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold">Users</h2>
        <div className="mt-4 divide-y divide-slate-100">
          {(profiles ?? []).map((p) => {
            const signedIn = lastSignIn.get(p.id);
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {p.full_name || p.email}
                    {p.role === "super_admin" && <span className="badge border-blue-200 bg-blue-50 text-blue-700">Super admin</span>}
                    {!signedIn && <span className="badge border-amber-200 bg-amber-50 text-amber-700">Invite pending</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {p.email} · added {dateTime(p.created_at)}
                    {signedIn && <> · last sign-in {dateTime(signedIn)}</>}
                  </div>
                </div>
                {p.id !== me.id && <UserActions userId={p.id} pendingInvite={!signedIn} />}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
