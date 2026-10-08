import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateTime } from "@/lib/format";
import { stateName } from "@/lib/states";
import { CSV_VARIANTS, isCsvVariant } from "@/lib/report-variants";

export default async function DownloadsPage() {
  await requireUser();
  const { data, error } = await createAdminClient()
    .from("downloads")
    .select("id, variant, filename, row_count, created_at, report_id, profiles:user_id(full_name, email), reports(state, period_label, status, stripe_accounts(name))")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  // Supabase types embedded rows loosely; shape them here.
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    variant: string;
    filename: string;
    row_count: number | null;
    created_at: string;
    report_id: string | null;
    profiles: { full_name: string | null; email: string } | null;
    reports: { state: string; period_label: string; status: string; stripe_accounts: { name: string } | null } | null;
  }>;

  return (
    <div className="space-y-6">
      <p className="text-slate-600">Every CSV downloaded from this app, newest first.</p>
      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Downloaded</th>
              <th className="px-5 py-3 font-medium">Report</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Rows</th>
              <th className="px-5 py-3 font-medium">By</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-slate-500">No downloads yet.</td>
              </tr>
            )}
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="whitespace-nowrap px-5 py-3">{dateTime(d.created_at)}</td>
                <td className="px-5 py-3">
                  {d.reports ? (
                    <>
                      <div className="font-medium">{stateName(d.reports.state)} — {d.reports.period_label}</div>
                      <div className="text-xs text-slate-500">{d.reports.stripe_accounts?.name}</div>
                    </>
                  ) : (
                    <span className="text-slate-400">{d.filename} (report deleted)</span>
                  )}
                </td>
                <td className="px-5 py-3">{isCsvVariant(d.variant) ? CSV_VARIANTS[d.variant].short : d.variant}</td>
                <td className="px-5 py-3">{d.row_count?.toLocaleString() ?? "—"}</td>
                <td className="px-5 py-3">{d.profiles?.full_name || d.profiles?.email || "—"}</td>
                <td className="px-5 py-3 text-right">
                  {d.report_id && d.reports?.status === "ready" && (
                    <a className="btn-secondary py-1.5" href={`/api/reports/${d.report_id}/csv?variant=${d.variant}`}>
                      <Download className="size-4" /> Again
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
