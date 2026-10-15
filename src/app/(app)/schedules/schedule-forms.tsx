"use client";
import { useActionState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { createSchedule, deleteSchedule, setScheduleEnabled } from "@/app/actions";
import type { AccountOption } from "@/lib/reports";
import { ALL_STATES, US_STATES, stateName } from "@/lib/states";
import { AccountPicker } from "@/components/report-form";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

export function ScheduleForm({ accounts }: { accounts: AccountOption[] }) {
  const [state, action] = useActionState(createSchedule, null);
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">New monthly schedule</h2>
      <form action={action} className="mt-5 space-y-5">
        <div className="grid gap-5 md:grid-cols-3">
          <div className="md:col-span-3">
            <AccountPicker accounts={accounts} />
          </div>
          <div>
            <label className="label" htmlFor="state">State</label>
            <select id="state" name="state" className="input" defaultValue="OK">
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
              <option value={ALL_STATES}>All states (summary by state)</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="frequency">Covers</label>
            <select id="frequency" name="frequency" className="input" defaultValue="monthly">
              <option value="monthly">Each month</option>
              <option value="quarterly">Each quarter</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="day_of_month">Run on day</label>
            <select id="day_of_month" name="day_of_month" className="input" defaultValue={1}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{ordinal(d)} of the month</option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="run_now" className="size-4" /> Also run the last month or quarter now
        </label>
        <p className="text-xs text-slate-500">
          Monthly schedules run every month for the previous full month. Quarterly schedules run in January, April, July
          and October for the quarter that just ended (Q1 is Jan – Mar). Dates use the account&apos;s timezone.
        </p>
        <FormMessage state={state} />
        <SubmitButton className="btn-primary">Save schedule</SubmitButton>
      </form>
    </section>
  );
}

type Schedule = {
  id: string;
  state: string;
  day_of_month: number;
  frequency: "monthly" | "quarterly";
  enabled: boolean;
  account_names: string[];
  timezone: string;
  created_by_name: string | null;
  last_run_label: string | null;
};

export function ScheduleRow({ schedule: s, canManage }: { schedule: Schedule; canManage: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className={`flex flex-wrap items-center gap-3 py-4 ${s.enabled ? "" : "opacity-60"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium">
          {stateName(s.state)} · {s.account_names.join(" + ")}
          {s.account_names.length > 1 && <span className="badge border-violet-200 bg-violet-50 text-violet-700">Combined</span>}
          {!s.enabled && <span className="badge border-slate-200 bg-slate-50 text-slate-500">Paused</span>}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          {s.frequency === "quarterly"
            ? `Runs on the ${ordinal(s.day_of_month)} of Jan, Apr, Jul and Oct for the previous quarter`
            : `Runs on the ${ordinal(s.day_of_month)} of each month for the previous month`}{" "}
          ({s.timezone})
          {s.last_run_label ? ` · last queued ${s.last_run_label}` : " · not run yet"}
          {s.created_by_name && ` · by ${s.created_by_name}`}
        </div>
      </div>
      {canManage && (
        <>
          <button
            className="btn-secondary py-1.5"
            disabled={pending}
            onClick={() => start(async () => { await setScheduleEnabled(s.id, !s.enabled); })}
          >
            {s.enabled ? "Pause" : "Resume"}
          </button>
          <button
            className="btn-ghost"
            title="Delete schedule"
            disabled={pending}
            onClick={() => {
              if (confirm("Delete this schedule? Reports it already ran stay in history.")) {
                start(async () => { await deleteSchedule(s.id); });
              }
            }}
          >
            <Trash2 className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}
