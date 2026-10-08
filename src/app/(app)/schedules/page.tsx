import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAccountOptions } from "@/lib/reports";
import { dateTime } from "@/lib/format";
import { ScheduleForm, ScheduleRow } from "./schedule-forms";

type ScheduleRecord = {
  id: string;
  state: string;
  day_of_month: number;
  enabled: boolean;
  last_run_at: string | null;
  created_by: string | null;
  stripe_accounts: { name: string; timezone: string } | null;
  profiles: { full_name: string | null; email: string } | null;
};

export default async function SchedulesPage() {
  const user = await requireUser();
  const [accounts, { data, error }] = await Promise.all([
    listAccountOptions(),
    createAdminClient()
      .from("report_schedules")
      .select("id, state, day_of_month, enabled, last_run_at, created_by, stripe_accounts(name, timezone), profiles:created_by(full_name, email)")
      .order("created_at"),
  ]);
  if (error) throw error;

  return (
    <div className="space-y-6">
      <p className="text-slate-600">
        Scheduled reports run automatically each month for the previous full month. Finished reports show up in{" "}
        <Link href="/" className="text-blue-600 hover:underline">Report History</Link> like any other.
      </p>

      {accounts.length > 0 && <ScheduleForm accounts={accounts} />}

      <section className="card">
        <h2 className="text-lg font-semibold">Schedules</h2>
        <div className="mt-4 divide-y divide-slate-100">
          {(data ?? []).length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
          {((data ?? []) as unknown as ScheduleRecord[]).map((s) => (
            <ScheduleRow
              key={s.id}
              schedule={{
                id: s.id,
                state: s.state,
                day_of_month: s.day_of_month,
                enabled: s.enabled,
                account_name: s.stripe_accounts?.name ?? "Deleted account",
                timezone: s.stripe_accounts?.timezone ?? "",
                created_by_name: s.profiles?.full_name || s.profiles?.email || null,
                last_run_label: s.last_run_at ? dateTime(s.last_run_at) : null,
              }}
              canManage={user.role === "super_admin" || s.created_by === user.id}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
