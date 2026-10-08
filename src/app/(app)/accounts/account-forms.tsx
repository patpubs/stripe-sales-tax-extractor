"use client";
import { useActionState, useState, useTransition } from "react";
import { addStripeAccount, setStripeAccountArchived, updateStripeAccount } from "@/app/actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
];

function TimezoneSelect({ defaultValue = "America/Chicago" }: { defaultValue?: string }) {
  return (
    <select name="timezone" className="input" defaultValue={defaultValue}>
      {TIMEZONES.map((tz) => (
        <option key={tz} value={tz}>{tz}</option>
      ))}
    </select>
  );
}

export function AddAccountForm() {
  const [state, action] = useActionState(addStripeAccount, null);
  return (
    <form action={action} className="mt-5 grid gap-4 md:grid-cols-[1fr_1.5fr_1fr_auto] md:items-end">
      <div>
        <label className="label" htmlFor="name">Name</label>
        <input id="name" name="name" placeholder="e.g. Main store" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="secret_key">Restricted key</label>
        <input id="secret_key" name="secret_key" type="password" autoComplete="off" placeholder="rk_live_…" required className="input font-mono" />
      </div>
      <div>
        <label className="label">Reporting timezone</label>
        <TimezoneSelect />
      </div>
      <SubmitButton className="btn-primary">Connect</SubmitButton>
      <div className="md:col-span-4">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

type Account = {
  id: string;
  name: string;
  key_hint: string;
  stripe_account_id: string | null;
  livemode: boolean | null;
  timezone: string;
  archived: boolean;
  created_label: string;
};

export function AccountRow({ account: a }: { account: Account }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(updateStripeAccount, null);
  const [pending, start] = useTransition();

  return (
    <div className={`py-4 ${a.archived ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium">
            {a.name}
            {a.livemode === false && <span className="badge border-amber-200 bg-amber-50 text-amber-700">Test mode</span>}
            {a.archived && <span className="badge border-slate-200 bg-slate-50 text-slate-500">Archived</span>}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            <span className="font-mono">{a.key_hint}</span>
            {a.stripe_account_id && <> · {a.stripe_account_id}</>} · {a.timezone} · added {a.created_label}
          </div>
        </div>
        <button className="btn-secondary py-1.5" onClick={() => setEditing((e) => !e)}>
          {editing ? "Close" : "Edit"}
        </button>
        <button
          className="btn-ghost"
          disabled={pending}
          onClick={() => start(async () => { await setStripeAccountArchived(a.id, !a.archived); })}
        >
          {a.archived ? "Restore" : "Archive"}
        </button>
      </div>
      {editing && (
        <form action={action} className="mt-4 grid gap-4 rounded-lg bg-slate-50 p-4 md:grid-cols-[1fr_1.5fr_1fr_auto] md:items-end">
          <input type="hidden" name="id" value={a.id} />
          <div>
            <label className="label">Name</label>
            <input name="name" defaultValue={a.name} className="input" />
          </div>
          <div>
            <label className="label">Replace key (optional)</label>
            <input name="secret_key" type="password" autoComplete="off" placeholder="rk_live_…" className="input font-mono" />
          </div>
          <div>
            <label className="label">Reporting timezone</label>
            <TimezoneSelect defaultValue={a.timezone} />
          </div>
          <SubmitButton className="btn-primary">Save</SubmitButton>
          <div className="md:col-span-4">
            <FormMessage state={state} />
          </div>
        </form>
      )}
    </div>
  );
}
