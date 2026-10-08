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

  const [accountIds, setAccountIds] = useState<string[]>(accounts[0] ? [accounts[0].id] : []);
  const [usState, setUsState] = useState("OK");
  const [periodType, setPeriodType] = useState<"month" | "custom">("month");

  // Remember the last account and state on this device.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}");
      const savedIds: string[] = saved.accountIds ?? (saved.accountId ? [saved.accountId] : []);
      const valid = savedIds.filter((id) => accounts.some((a) => a.id === id));
      if (valid.length) setAccountIds(valid);
      if (saved.state) setUsState(saved.state);
    } catch {}
  }, [accounts]);
  useEffect(() => {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ accountIds, state: usState }));
    } catch {}
  }, [accountIds, usState]);

  useEffect(() => {
    if (state?.ok) window.dispatchEvent(new Event("reports:changed"));
  }, [state]);

  const selected = accounts.filter((a) => accountIds.includes(a.id));
  const timezones = [...new Set(selected.map((a) => a.timezone))];

  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Report Parameters</h2>
      <form action={action} className="mt-5 space-y-5">
        <input type="hidden" name="period_type" value={periodType} />
        <div className="grid gap-5 md:grid-cols-2">
          <AccountPicker accounts={accounts} value={accountIds} onChange={setAccountIds} />
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

        {timezones.length > 0 && (
          <p className="text-xs text-slate-500">
            Dates are in {timezones.join(" / ")}, the timezone set for {selected.length > 1 ? "each account" : "this account"}.
            {selected.length > 1 && " Picking several accounts makes one combined report."}
          </p>
        )}
        <FormMessage state={state} />
        <SubmitButton className="btn-primary">{selected.length > 1 ? "Generate Combined Report" : "Generate Report"}</SubmitButton>
      </form>
    </section>
  );
}

/** Checkbox list of Stripe accounts; submits each checked id as stripe_account_id. */
export function AccountPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountOption[];
  value?: string[];
  onChange?: (ids: string[]) => void;
}) {
  const [inner, setInner] = useState<string[]>(accounts[0] ? [accounts[0].id] : []);
  const ids = value ?? inner;
  const set = onChange ?? setInner;
  const toggle = (id: string) => set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  return (
    <fieldset>
      <legend className="label">Stripe account{accounts.length > 1 ? "s" : ""}</legend>
      <div className="flex flex-wrap gap-2">
        {accounts.map((a) => {
          const on = ids.includes(a.id);
          return (
            <label
              key={a.id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                on ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                name="stripe_account_id"
                value={a.id}
                checked={on}
                onChange={() => toggle(a.id)}
                className="size-4"
              />
              {a.name}
              {a.livemode === false && <span className="text-xs text-amber-700">(test)</span>}
            </label>
          );
        })}
      </div>
      {accounts.length > 1 && (
        <button type="button" className="mt-1.5 text-xs text-blue-600 hover:underline" onClick={() => set(accounts.map((a) => a.id))}>
          Select all
        </button>
      )}
    </fieldset>
  );
}
