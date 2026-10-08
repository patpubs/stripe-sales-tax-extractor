"use client";
import { useActionState, useEffect, useState } from "react";
import { requestReport } from "@/app/actions";
import type { AccountOption } from "@/lib/reports";
import { MONTHS } from "@/lib/period";
import { ALL_STATES, US_STATES } from "@/lib/states";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";

const LAST_KEY = "report-form:last";

function previousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

export function ReportForm({ accounts }: { accounts: AccountOption[] }) {
  const [state, action] = useActionState(requestReport, null);
  const prev = previousMonth();
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => thisYear - i);

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [usState, setUsState] = useState("OK");
  const [periodType, setPeriodType] = useState<"month" | "custom">("month");

  // Remember the last account and state on this device.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}");
      if (saved.accountId && accounts.some((a) => a.id === saved.accountId)) setAccountId(saved.accountId);
      if (saved.state) setUsState(saved.state);
    } catch {}
  }, [accounts]);
  useEffect(() => {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ accountId, state: usState }));
    } catch {}
  }, [accountId, usState]);

  useEffect(() => {
    if (state?.ok) window.dispatchEvent(new Event("reports:changed"));
  }, [state]);

  const account = accounts.find((a) => a.id === accountId);

  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Report Parameters</h2>
      <form action={action} className="mt-5 space-y-5">
        <input type="hidden" name="period_type" value={periodType} />
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="stripe_account_id">Stripe account</label>
            <select
              id="stripe_account_id"
              name="stripe_account_id"
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.livemode === false ? " (test mode)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="state">State</label>
            <select id="state" name="state" className="input" value={usState} onChange={(e) => setUsState(e.target.value)}>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
              <option value={ALL_STATES}>All states (summary by state)</option>
            </select>
          </div>
        </div>

        <div>
          <span className="label">Period</span>
          <div className="inline-flex rounded-lg border border-slate-300 p-0.5 text-sm">
            {(["month", "custom"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPeriodType(t)}
                className={`rounded-md px-3 py-1.5 ${periodType === t ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}
              >
                {t === "month" ? "Month" : "Date range"}
              </button>
            ))}
          </div>
        </div>

        {periodType === "month" ? (
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="month">Month</label>
              <select id="month" name="month" className="input" defaultValue={prev.month}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="year">Year</label>
              <select id="year" name="year" className="input" defaultValue={prev.year}>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="from">From</label>
              <input id="from" name="from" type="date" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="to">To (inclusive)</label>
              <input id="to" name="to" type="date" required className="input" />
            </div>
          </div>
        )}

        {account && (
          <p className="text-xs text-slate-500">Dates are in {account.timezone}, the timezone set for this account.</p>
        )}
        <FormMessage state={state} />
        <SubmitButton className="btn-primary">Generate Report</SubmitButton>
      </form>
    </section>
  );
}
