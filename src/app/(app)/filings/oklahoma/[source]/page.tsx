import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { computeFiling, getSource, loadTables } from "@/lib/filings/oklahoma/data";
import { importFilename, OK_COUNTIES } from "@/lib/filings/oklahoma/copo";
import { FilingReview } from "./filing-review";

export default async function OklahomaFilingPage({ params }: { params: Promise<{ source: string }> }) {
  await requireUser();
  const source = await getSource((await params).source);
  if (!source) notFound();
  const tables = await loadTables();

  if (source.status !== "ready") {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold">Oklahoma — {source.periodLabel}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {source.status === "running" ? "The report is still running." : "The report failed; re-run it on the Reports page."}{" "}
          <Link href="/filings" className="text-blue-600 hover:underline">Back</Link>
        </p>
      </div>
    );
  }

  const filing = await computeFiling(source, tables);
  return (
    <FilingReview
      sourceKey={source.key}
      title={`Oklahoma — ${source.periodLabel}`}
      accounts={source.accounts.map((a) => a.name)}
      filename={importFilename(source.periodLabel)}
      filing={filing}
      cities={[...tables.cities.keys()].sort()}
      counties={OK_COUNTIES.map((c) => c.toLowerCase())}
    />
  );
}
