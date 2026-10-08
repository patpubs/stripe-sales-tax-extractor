"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";
import { getCurrentUser, needsSetup, requireSuperAdmin, requireUser } from "@/lib/auth";
import { encryptSecret, keyHint } from "@/lib/crypto";
import { verifyKey } from "@/lib/stripe";
import { env } from "@/lib/env";
import { customPeriod, monthPeriod } from "@/lib/period";
import { ALL_STATES, US_STATES } from "@/lib/states";
import { triggerWorker } from "@/lib/worker-trigger";

export type ActionResult = { ok: true; message?: string; link?: string } | { ok: false; error: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

// Auth -------------------------------------------------------------------------

export async function signIn(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: str(fd, "email").toLowerCase(),
    password: String(fd.get("password") ?? ""),
  });
  if (error) return { ok: false, error: "Email or password is incorrect." };
  const user = await getCurrentUser();
  if (!user) {
    await supabase.auth.signOut();
    return { ok: false, error: "This account doesn't have access. Ask the admin for an invite." };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createSuperAdmin(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  if (!(await needsSetup())) return { ok: false, error: "Setup is already complete. Sign in instead." };

  const email = str(fd, "email").toLowerCase();
  const password = String(fd.get("password") ?? "");
  const fullName = str(fd, "full_name");
  if (email !== env.superAdminEmail) {
    return { ok: false, error: "This email isn't allowed to create the admin account." };
  }
  if (password.length < 10) return { ok: false, error: "Use a password of at least 10 characters." };

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !created.user) return { ok: false, error: error?.message ?? "Could not create user." };

  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: created.user.id, email, full_name: fullName || null, role: "super_admin" });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "Setup was already completed by someone else." };
  }

  const supabase = await createSessionClient();
  await supabase.auth.signInWithPassword({ email, password });
  redirect("/");
}

export async function setPassword(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const password = String(fd.get("password") ?? "");
  const fullName = str(fd, "full_name");
  if (password.length < 10) return { ok: false, error: "Use a password of at least 10 characters." };
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error || !data.user) return { ok: false, error: error?.message ?? "Your link has expired. Ask the admin for a new one." };
  if (fullName) {
    await createAdminClient().from("profiles").update({ full_name: fullName }).eq("id", data.user.id);
  }
  redirect("/");
}

// Users (super admin) ----------------------------------------------------------

function confirmLink(hashedToken: string, type: "invite" | "magiclink") {
  const url = new URL("/auth/confirm", env.siteUrl);
  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", type);
  return url.toString();
}

export async function inviteUser(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  const email = str(fd, "email").toLowerCase();
  const fullName = str(fd, "full_name");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email." };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) return { ok: false, error: "That person already has an account. Use “New login link” instead." };

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: fullName } },
  });
  if (error || !data.user) return { ok: false, error: error?.message ?? "Could not create the invite." };

  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    email,
    full_name: fullName || null,
    role: "member",
    invited_by: me.id,
  });
  if (profileError) return { ok: false, error: profileError.message };

  revalidatePath("/users");
  return {
    ok: true,
    message: `Invite created for ${email}. Send them this link; it works once and expires in 24 hours.`,
    link: confirmLink(data.properties.hashed_token, "invite"),
  };
}

export async function createLoginLink(userId: string): Promise<ActionResult> {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("email").eq("id", userId).single();
  if (!profile) return { ok: false, error: "User not found." };
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: profile.email });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    message: `Send this to ${profile.email}. It signs them in once so they can set a new password.`,
    link: confirmLink(data.properties.hashed_token, "magiclink"),
  };
}

export async function removeUser(userId: string): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  if (userId === me.id) return { ok: false, error: "You can't remove yourself." };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/users");
  return { ok: true };
}

// Stripe accounts (super admin) ------------------------------------------------

export async function addStripeAccount(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  const name = str(fd, "name");
  const key = str(fd, "secret_key");
  const timezone = str(fd, "timezone") || "America/Chicago";
  if (!name) return { ok: false, error: "Give the account a name." };

  let verified;
  try {
    verified = await verifyKey(key);
  } catch (err) {
    return { ok: false, error: `Stripe check failed: ${(err as Error).message}` };
  }

  const { error } = await createAdminClient().from("stripe_accounts").insert({
    name,
    encrypted_key: encryptSecret(key),
    key_hint: keyHint(key),
    stripe_account_id: verified.accountId,
    livemode: verified.livemode,
    timezone,
    created_by: me.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/accounts");
  revalidatePath("/");
  return {
    ok: true,
    message: verified.isRestricted
      ? `Connected ${name}.`
      : `Connected ${name}. This is a full secret key; a restricted read-only key (rk_…) is safer.`,
  };
}

export async function updateStripeAccount(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const id = str(fd, "id");
  const name = str(fd, "name");
  const timezone = str(fd, "timezone");
  const key = str(fd, "secret_key");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name) patch.name = name;
  if (timezone) patch.timezone = timezone;
  if (key) {
    try {
      const verified = await verifyKey(key);
      patch.encrypted_key = encryptSecret(key);
      patch.key_hint = keyHint(key);
      patch.stripe_account_id = verified.accountId;
      patch.livemode = verified.livemode;
    } catch (err) {
      return { ok: false, error: `Stripe check failed: ${(err as Error).message}` };
    }
  }
  const { error } = await createAdminClient().from("stripe_accounts").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true, message: "Saved." };
}

export async function setStripeAccountArchived(id: string, archived: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  const { error } = await createAdminClient().from("stripe_accounts").update({ archived }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true };
}

// Reports ----------------------------------------------------------------------

const ids = (fd: FormData, k: string) => [...new Set(fd.getAll(k).map((v) => String(v).trim()).filter(Boolean))];

/** Live (not archived) accounts among `accountIds`, in the order given. */
async function liveAccounts(accountIds: string[]) {
  if (accountIds.length === 0) return [];
  const { data } = await createAdminClient()
    .from("stripe_accounts")
    .select("id, timezone, archived")
    .in("id", accountIds);
  const live = (data ?? []).filter((a) => !a.archived);
  return accountIds.map((id) => live.find((a) => a.id === id)).filter((a) => !!a);
}

type ReportPeriodInput =
  | { type: "month"; year: number; month: number }
  | { type: "custom"; from: string; to: string };

/**
 * Queue one report per account. Several accounts are tied together in a
 * report group so they show and download as one combined report.
 */
async function queueReports(opts: {
  accounts: { id: string; timezone: string }[];
  state: string;
  period: ReportPeriodInput;
  createdBy: string;
  scheduleId?: string;
}): Promise<{ label: string } | { error: string }> {
  const db = createAdminClient();
  let rows;
  try {
    rows = opts.accounts.map((a) => {
      const p =
        opts.period.type === "month"
          ? monthPeriod(opts.period.year, opts.period.month, a.timezone)
          : customPeriod(opts.period.from, opts.period.to, a.timezone);
      return {
        stripe_account_id: a.id,
        state: opts.state,
        period_type: opts.period.type,
        period_start: p.start.toISOString(),
        period_end: p.end.toISOString(),
        period_label: p.label,
        timezone: a.timezone,
        created_by: opts.createdBy,
        schedule_id: opts.scheduleId ?? null,
      };
    });
  } catch (err) {
    return { error: (err as Error).message };
  }
  if (rows.every((r) => Date.parse(r.period_start) > Date.now())) return { error: "That period hasn't started yet." };

  let groupId: string | null = null;
  if (rows.length > 1) {
    const { data: group, error } = await db
      .from("report_groups")
      .insert({ state: opts.state, period_label: rows[0].period_label, created_by: opts.createdBy, schedule_id: opts.scheduleId ?? null })
      .select("id")
      .single();
    if (error) return { error: error.message };
    groupId = group.id;
  }

  // In a group the schedule link lives on the group (see the combined_reports migration).
  const { error } = await db
    .from("reports")
    .insert(rows.map((r) => ({ ...r, group_id: groupId, schedule_id: groupId ? null : r.schedule_id })));
  if (error) {
    if (groupId) await db.from("report_groups").delete().eq("id", groupId);
    return { error: error.message };
  }
  after(triggerWorker);
  revalidatePath("/");
  return { label: rows[0].period_label };
}

export async function requestReport(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const state = str(fd, "state");
  if (state !== ALL_STATES && !US_STATES.some((s) => s.code === state)) {
    return { ok: false, error: "Pick a state." };
  }

  const accounts = await liveAccounts(ids(fd, "stripe_account_id"));
  if (accounts.length === 0) return { ok: false, error: "Pick at least one Stripe account." };

  const period: ReportPeriodInput =
    str(fd, "period_type") === "custom"
      ? { type: "custom", from: str(fd, "from"), to: str(fd, "to") }
      : { type: "month", year: Number(str(fd, "year")), month: Number(str(fd, "month")) };

  const result = await queueReports({ accounts, state, period, createdBy: me.id });
  if ("error" in result) return { ok: false, error: result.error };
  return {
    ok: true,
    message:
      accounts.length > 1
        ? `Combined report for ${accounts.length} accounts queued. It runs in the background; you can leave this page.`
        : "Report queued. It runs in the background; you can leave this page.",
  };
}

async function canManageReport(reportId: string) {
  const me = await requireUser();
  const { data } = await createAdminClient().from("reports").select("created_by").eq("id", reportId).maybeSingle();
  return !!data && (me.role === "super_admin" || data.created_by === me.id);
}

export async function deleteReport(reportId: string): Promise<ActionResult> {
  if (!(await canManageReport(reportId))) return { ok: false, error: "Only the person who ran it or the admin can delete it." };
  const { error } = await createAdminClient().from("reports").delete().eq("id", reportId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

export async function cancelReport(reportId: string): Promise<ActionResult> {
  if (!(await canManageReport(reportId))) return { ok: false, error: "Not allowed." };
  await createAdminClient()
    .from("reports")
    .update({ status: "canceled", locked_until: null, completed_at: new Date().toISOString() })
    .eq("id", reportId)
    .in("status", ["queued", "processing"]);
  revalidatePath("/");
  return { ok: true };
}

/** Rerun a failed or finished report. Keeps rows already saved and resumes or refreshes. */
export async function retryReport(reportId: string, fromScratch = false): Promise<ActionResult> {
  if (!(await canManageReport(reportId))) return { ok: false, error: "Not allowed." };
  const db = createAdminClient();
  if (fromScratch) await db.from("report_rows").delete().eq("report_id", reportId);
  const patch: Record<string, unknown> = { status: "queued", error: null, attempts: 0, locked_until: null, completed_at: null };
  if (fromScratch) Object.assign(patch, { cursor: null, scanned_count: 0, scanned_through: null, started_at: null });
  await db.from("reports").update(patch).eq("id", reportId);
  after(triggerWorker);
  revalidatePath("/");
  return { ok: true };
}

async function canManageGroup(groupId: string) {
  const me = await requireUser();
  const { data } = await createAdminClient().from("report_groups").select("created_by").eq("id", groupId).maybeSingle();
  return !!data && (me.role === "super_admin" || data.created_by === me.id);
}

export async function deleteReportGroup(groupId: string): Promise<ActionResult> {
  if (!(await canManageGroup(groupId))) return { ok: false, error: "Only the person who ran it or the admin can delete it." };
  // Its per-account reports are deleted with it.
  const { error } = await createAdminClient().from("report_groups").delete().eq("id", groupId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

/** Re-run every account in a combined report from scratch. */
export async function rerunReportGroup(groupId: string): Promise<ActionResult> {
  if (!(await canManageGroup(groupId))) return { ok: false, error: "Not allowed." };
  const { data } = await createAdminClient().from("reports").select("id").eq("group_id", groupId);
  for (const r of data ?? []) await retryReport(r.id, true);
  return { ok: true };
}

// Schedules ----------------------------------------------------------------------

/** Day of month and previous full month, in the account's timezone. */
function localToday(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const year = get("year");
  const month = get("month");
  return { day: get("day"), prevYear: month === 1 ? year - 1 : year, prevMonth: month === 1 ? 12 : month - 1 };
}

export async function createSchedule(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const state = str(fd, "state");
  const day = Number(str(fd, "day_of_month") || "1");
  const runNow = fd.get("run_now") === "on";

  if (state !== ALL_STATES && !US_STATES.some((s) => s.code === state)) return { ok: false, error: "Pick a state." };
  if (!Number.isInteger(day) || day < 1 || day > 28) return { ok: false, error: "Pick a day between 1 and 28." };

  const accounts = await liveAccounts(ids(fd, "stripe_account_id"));
  if (accounts.length === 0) return { ok: false, error: "Pick at least one Stripe account." };

  // The first account's timezone decides when the schedule is due (matches enqueue_due_schedules).
  const today = localToday(accounts[0].timezone);
  const last = monthPeriod(today.prevYear, today.prevMonth, accounts[0].timezone);
  // If this month's run day has already passed, last month counts as handled
  // unless the user asked to run it now.
  const alreadyDue = today.day >= day;

  const db = createAdminClient();
  const { data: schedule, error } = await db
    .from("report_schedules")
    .insert({
      stripe_account_ids: accounts.map((a) => a.id),
      state,
      day_of_month: day,
      last_period_start: alreadyDue || runNow ? last.start.toISOString() : null,
      last_run_at: runNow ? new Date().toISOString() : null,
      created_by: me.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (runNow) {
    const result = await queueReports({
      accounts,
      state,
      period: { type: "month", year: today.prevYear, month: today.prevMonth },
      createdBy: me.id,
      scheduleId: schedule.id,
    });
    if ("error" in result) return { ok: false, error: result.error };
  }

  revalidatePath("/schedules");
  return {
    ok: true,
    message: runNow ? `Schedule saved, and the ${last.label} report is queued.` : "Schedule saved.",
  };
}

async function canManageSchedule(id: string) {
  const me = await requireUser();
  const { data } = await createAdminClient().from("report_schedules").select("created_by").eq("id", id).maybeSingle();
  return !!data && (me.role === "super_admin" || data.created_by === me.id);
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  if (!(await canManageSchedule(id))) return { ok: false, error: "Only the person who created it or the admin can change it." };
  await createAdminClient().from("report_schedules").update({ enabled }).eq("id", id);
  revalidatePath("/schedules");
  return { ok: true };
}

export async function deleteSchedule(id: string): Promise<ActionResult> {
  if (!(await canManageSchedule(id))) return { ok: false, error: "Only the person who created it or the admin can delete it." };
  // Reports it already produced stay in history.
  await createAdminClient().from("report_schedules").delete().eq("id", id);
  revalidatePath("/schedules");
  return { ok: true };
}
