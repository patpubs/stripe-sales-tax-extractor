import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Download, Layers, XCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { money } from "@/lib/format";
import { computeFiling, listSources, loadTables, tableCounts } from "@/lib/filings/oklahoma/data";
import { importFilename } from "@/lib/filings/oklahoma/copo";

const RATE_CHART = "https://oklahoma.gov/tax/businesses/sales-use-tax/sales-tax-rate-locator.html";

/** During the first month of each quarter, the quarter's rate chart is new. */
function newQuarter(now = new Date()) {
  const m = now.getMonth();
  return m % 3 === 0 ? `Q${m / 3 + 1} ${now.getFullYear()}` : null;
}

export default async function FilingsPage() {
  const user = await requireUser();
  const [sources, tables, counts] = await Promise.all([listSources(), loadTables(), tableCounts()]);
  const filings = new Map(
    await Promise.all(sources.filter((s) => s.status === "ready").map(async (s) => [s.key, await computeFiling(s, tables)] as const)),
  );
  const missing = [
    !counts.copos && "base COPO template",
    !counts.cities && "city codes",
    !counts.zips && "zip codes",
  ].filter(Boolean);
  const quarter = newQuarter();

  return (
    <div className="space-y-6">
      <p className="text-slate-600">
        Import files for state sales tax portals, built from finished reports. Schedule a monthly Oklahoma report (pick
        every account to combine them) on the{" "}
        <Link href="/schedules" className="text-blue-600 hover:underline">Schedules</Link> page and its file shows up here
        as soon as the report finishes.
      </p>

      {missing.length > 0 && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            The Oklahoma lookup tables are missing the {missing.join(", ")}. Files can&apos;t map sales until they&apos;re
            loaded on the <Link href="/filings/oklahoma/data" className="font-medium underline">lookup tables</Link> page.
          </p>
        </div>
      )}
      {quarter && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          The {quarter} Oklahoma sales tax rate chart is out. COPO codes rarely change, but if a city was added or
          removed, upload a fresh base template on the{" "}
          <Link href="/filings/oklahoma/data" className="text-blue-600 hover:underline">lookup tables</Link> page.{" "}
          <a href={RATE_CHART} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Rate chart</a>
        </div>
      )}

      <section className="card">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Oklahoma COPO import</h2>
          <Link href="/filings/oklahoma/data" className="ml-auto text-sm text-blue-600 hover:underline">
            Lookup tables{user.role === "super_admin" ? "" : " (view)"}
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Net taxable sales by city and county COPO code, as Copo,CoPoNetTaxSales.
        </p>

        <div className="mt-5 divide-y divide-slate-100">
          {sources.length === 0 && (
            <p className="text-sm text-slate-500">
              No Oklahoma reports yet. Run one on the <Link href="/" className="text-blue-600 hover:underline">Reports</Link>{" "}
              page or set up a schedule.
            </p>
          )}
          {sources.map((s) => {
            const f = filings.get(s.key);
            return (
              <div key={s.key} className="flex flex-wrap items-center gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {s.periodLabel}
                    {s.kind === "group" && (
                      <span className="badge border-violet-200 bg-violet-50 text-violet-700">
                        <Layers className="size-3" /> Combined
                      </span>
                    )}
                    {s.scheduled && <span className="badge border-slate-200 bg-slate-50 text-slate-600">Scheduled</span>}
                    {s.status === "running" && (
                      <span className="badge border-blue-200 bg-blue-50 text-blue-700"><Clock className="size-3" /> Report running</span>
                    )}
                    {s.status === "failed" && (
                      <span className="badge border-red-200 bg-red-50 text-red-700"><XCircle className="size-3" /> Report failed</span>
                    )}
                    {f && (f.openItems > 0 || !f.balanced ? (
                      <span className="badge border-amber-200 bg-amber-50 text-amber-800">
                        <AlertTriangle className="size-3" /> {f.openItems} to review
                      </span>
                    ) : (
                      <span className="badge border-green-200 bg-green-50 text-green-700"><CheckCircle2 className="size-3" /> Ready</span>
                    ))}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {s.accounts.map((a) => a.name).join(" + ")}
                    {f && ` · ${f.sales.length} sales · ${money(f.expected)} net · ${f.totals.length} COPO rows`}
                  </div>
                </div>
                {f && (
                  <>
                    <Link href={`/filings/oklahoma/${s.key}`} className="btn-secondary py-1.5">Review</Link>
                    <a href={`/api/filings/oklahoma/${s.key}/csv`} className="btn-primary py-1.5" title={importFilename(s.periodLabel)}>
                      <Download className="size-4" /> Import file
                    </a>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
