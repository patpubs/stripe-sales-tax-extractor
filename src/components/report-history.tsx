"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Clock, Download, Loader2, RefreshCw, RotateCw, Trash2, XCircle } from "lucide-react";
import type { AccountOption, ReportView } from "@/lib/reports";
import { cancelReport, deleteReport, retryReport } from "@/app/actions";
import { dateTime, money } from "@/lib/format";
import { stateName } from "@/lib/states";
import { CSV_VARIANTS, type CsvVariant } from "@/lib/report-variants";

const ACTIVE = new Set(["queued", "processing"]);

export function ReportHistory({
  initialReports,
  accounts,
  currentUserId,
  isAdmin,
}: {
  initialReports: ReportView[];
  accounts: AccountOption[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [reports, setReports] = useState(initialReports);
  const [accountFilter, setAccountFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const filterRef = useRef(accountFilter);
  filterRef.current = accountFilter;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const qs = filterRef.current ? `?account=${filterRef.current}` : "";
      const res = await fetch(`/api/reports${qs}`, { cache: "no-store" });
      if (res.ok) setReports((await res.json()).reports);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [accountFilter, refresh]);

  const anyActive = reports.some((r) => ACTIVE.has(r.status));
  useEffect(() => {
    const id = setInterval(refresh, anyActive ? 4000 : 30000);
    const onChange = () => refresh();
    window.addEventListener("reports:changed", onChange);
    return () => {
      clearInterval(id);
      window.removeEventListener("reports:changed", onChange);
    };
  }, [anyActive, refresh]);

  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Report History</h2>
        <div className="ml-auto flex items-center gap-3">
          {accounts.length > 1 && (
            <select className="input w-auto py-1.5" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          <span className="flex items-center gap-1.5 text-sm text-slate-500">
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            Auto-refreshing
          </span>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {reports.length === 0 && <p className="text-sm text-slate-500">No reports yet.</p>}
        {reports.map((r) => (
          <ReportCard
            key={r.id}
            report={r}
            canManage={isAdmin || r.created_by === currentUserId}
            showAccount={accounts.length > 1}
            onChanged={refresh}
          />
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: ReportView["status"] }) {
  const map = {
    queued: { cls: "border-slate-200 bg-slate-50 text-slate-600", icon: <Clock className="size-3" />, label: "Queued" },
    processing: { cls: "border-blue-200 bg-blue-50 text-blue-700", icon: <Loader2 className="size-3 animate-spin" />, label: "Processing" },
    ready: { cls: "border-green-200 bg-green-50 text-green-700", icon: <CheckCircle2 className="size-3" />, label: "Ready" },
    failed: { cls: "border-red-200 bg-red-50 text-red-700", icon: <AlertCircle className="size-3" />, label: "Failed" },
    canceled: { cls: "border-slate-200 bg-slate-50 text-slate-500", icon: <XCircle className="size-3" />, label: "Canceled" },
  }[status];
  return (
    <span className={`badge ${map.cls}`}>
      {map.icon}
      {map.label}
    </span>
  );
}

function progressPct(r: ReportView): number | null {
  if (!r.scanned_through) return null;
  // Stripe returns newest first, so we scan from period end back to period start.
  const start = Date.parse(r.period_start);
  const end = Math.min(Date.parse(r.period_end), Date.now());
  const at = Date.parse(r.scanned_through);
  if (end <= start) return null;
  return Math.max(1, Math.min(99, Math.round(((end - at) / (end - start)) * 100)));
}

function ReportCard({
  report: r,
  canManage,
  showAccount,
  onChanged,
}: {
  report: ReportView;
  canManage: boolean;
  showAccount: boolean;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); onChanged(); });
  const pct = progressPct(r);
  const currency = r.currency ?? "usd";

  return (
    <article className="rounded-xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">
              {stateName(r.state)} — {r.period_label}
            </h3>
            <StatusBadge status={r.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {showAccount && <span className="font-medium text-slate-600">{r.account_name} · </span>}
            {r.schedule_id ? "Scheduled" : "Requested"} {dateTime(r.created_at)}
            {r.created_by_name && ` by ${r.created_by_name}`}
            {r.completed_at && r.status === "ready" && ` · Completed ${dateTime(r.completed_at)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {r.status === "ready" && <DownloadMenu reportId={r.id} />}
          {canManage && ACTIVE.has(r.status) && (
            <button className="btn-ghost" disabled={pending} onClick={() => run(() => cancelReport(r.id))} title="Cancel">
              <XCircle className="size-4" />
            </button>
          )}
          {canManage && (r.status === "failed" || r.status === "canceled") && (
            <button className="btn-secondary" disabled={pending} onClick={() => run(() => retryReport(r.id))}>
              <RotateCw className="size-4" /> Resume
            </button>
          )}
          {canManage && r.status === "ready" && (
            <button
              className="btn-ghost"
              disabled={pending}
              title="Re-run to pick up refunds issued since"
              onClick={() => {
                if (confirm("Re-run this report from Stripe? This picks up any refunds issued since it was generated.")) {
                  run(() => retryReport(r.id, true));
                }
              }}
            >
              <RotateCw className="size-4" />
            </button>
          )}
          {canManage && (
            <button
              className="btn-ghost"
              disabled={pending}
              title="Delete"
              onClick={() => {
                if (confirm("Delete this report?")) run(() => deleteReport(r.id));
              }}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      {ACTIVE.has(r.status) && (
        <div className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            {r.status === "queued"
              ? "Waiting to start…"
              : `Fetching data from Stripe: ${r.scanned_count.toLocaleString()} charges scanned${
                  r.scanned_through ? `, back to ${dateTime(r.scanned_through)}` : ""
                }`}
            {pct !== null && <span className="ml-auto font-medium">{pct}%</span>}
          </div>
          {pct !== null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          {r.error && <p className="mt-2 text-xs text-amber-700">Retrying after a Stripe error: {r.error}</p>}
        </div>
      )}

      {r.status === "failed" && r.error && (
        <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-red-700">{r.error}</p>
      )}

      {r.status === "ready" && (
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 md:grid-cols-4">
          <Metric label="Gross Sales" value={money(r.gross_amount, currency)} />
          <Metric label="Refunds" value={money(r.refunded_amount, currency)} className="text-red-600" />
          <Metric label="Net Taxable Sales" value={money(r.net_amount, currency)} className="text-blue-600" />
          <Metric
            label="Transactions"
            value={(r.transaction_count ?? 0).toLocaleString()}
            hint={r.refunded_count ? `${r.refunded_count} with refunds` : undefined}
          />
        </dl>
      )}
    </article>
  );
}

function Metric({ label, value, className = "", hint }: { label: string; value: string; className?: string; hint?: string }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`text-lg font-semibold ${className}`}>{value}</dd>
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  );
}

function DownloadMenu({ reportId }: { reportId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button className="btn-secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Download className="size-4" /> Download CSV
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {(Object.keys(CSV_VARIANTS) as CsvVariant[]).map((v) => (
            <a
              key={v}
              href={`/api/reports/${reportId}/csv?variant=${v}`}
              className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              {CSV_VARIANTS[v].label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
