import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listAccountOptions, listReports } from "@/lib/reports";
import { ReportForm } from "@/components/report-form";
import { ReportHistory } from "@/components/report-history";

export default async function ReportsPage() {
  const user = await requireUser();
  const [accounts, reports] = await Promise.all([listAccountOptions(), listReports({ limit: 100 })]);

  return (
    <div className="space-y-6">
      <p className="text-slate-600">Generate itemized transaction reports from Stripe for state sales tax filing.</p>

      {accounts.length === 0 ? (
        <div className="card">
          <h2 className="text-lg font-semibold">No Stripe accounts yet</h2>
          <p className="mt-1 text-sm text-slate-600">
            {user.role === "super_admin" ? (
              <>
                <Link href="/accounts" className="text-blue-600 hover:underline">Connect a Stripe account</Link> with a
                restricted read-only key to start pulling reports.
              </>
            ) : (
              "Ask your admin to connect a Stripe account."
            )}
          </p>
        </div>
      ) : (
        <ReportForm accounts={accounts} />
      )}

      <ReportHistory initialReports={reports} accounts={accounts} currentUserId={user.id} isAdmin={user.role === "super_admin"} />
    </div>
  );
}
