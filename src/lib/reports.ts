import "server-only";
import { createAdminClient } from "./supabase/admin";

export type ReportView = {
  id: string;
  stripe_account_id: string;
  account_name: string;
  state: string;
  period_label: string;
  period_start: string;
  period_end: string;
  timezone: string;
  status: "queued" | "processing" | "ready" | "failed" | "canceled";
  scanned_count: number;
  scanned_through: string | null;
  error: string | null;
  attempts: number;
  gross_amount: number | null;
  refunded_amount: number | null;
  net_amount: number | null;
  transaction_count: number | null;
  refunded_count: number | null;
  currency: string | null;
  schedule_id: string | null;
  group_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  completed_at: string | null;
};

export async function listReports(opts: { accountId?: string; limit?: number } = {}): Promise<ReportView[]> {
  let q = createAdminClient()
    .from("reports")
    .select("*, stripe_accounts(name), profiles:created_by(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.accountId) q = q.eq("stripe_account_id", opts.accountId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => {
    const { stripe_accounts, profiles, cursor: _cursor, locked_until: _l, ...rest } = r;
    return {
      ...rest,
      account_name: stripe_accounts?.name ?? "Deleted account",
      created_by_name: profiles?.full_name || profiles?.email || null,
    } as ReportView;
  });
}

export type GroupView = {
  id: string;
  state: string;
  period_label: string;
  schedule_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

/** Groups (combined reports) that the given reports belong to. */
export async function listGroups(reports: ReportView[]): Promise<GroupView[]> {
  const ids = [...new Set(reports.map((r) => r.group_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return [];
  const { data, error } = await createAdminClient()
    .from("report_groups")
    .select("*, profiles:created_by(full_name, email)")
    .in("id", ids);
  if (error) throw error;
  return (data ?? []).map(({ profiles, ...g }) => ({
    ...g,
    created_by_name: profiles?.full_name || profiles?.email || null,
  })) as GroupView[];
}

export type AccountOption = { id: string; name: string; timezone: string; livemode: boolean | null };

export async function listAccountOptions(includeArchived = false): Promise<AccountOption[]> {
  let q = createAdminClient()
    .from("stripe_accounts")
    .select("id, name, timezone, livemode")
    .order("name");
  if (!includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
