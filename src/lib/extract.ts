import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "./supabase/admin";
import { stripeForAccount } from "./stripe";
import { chargeToRow, type RowInsert } from "./charge-row";

export type ReportRecord = {
  id: string;
  stripe_account_id: string;
  state: string;
  period_start: string;
  period_end: string;
  status: string;
  cursor: string | null;
  scanned_count: number;
  attempts: number;
};

const PAGE_SIZE = 100;
const LEASE_SECONDS = 120;
const MAX_FAILURES = 8;

/**
 * Advance one report until it finishes or the deadline nears. Progress is
 * saved after every Stripe page, so a timeout or crash only loses one page.
 * Returns true when the report is finished (ready, failed or canceled).
 */
export async function processReport(report: ReportRecord, deadline: number): Promise<boolean> {
  const db = createAdminClient();
  let stripe: Stripe;
  try {
    stripe = await stripeForAccount(report.stripe_account_id);
  } catch (err) {
    await markFailed(report.id, `Could not load Stripe key: ${(err as Error).message}`);
    return true;
  }

  const created = {
    gte: Math.floor(new Date(report.period_start).getTime() / 1000),
    lt: Math.floor(new Date(report.period_end).getTime() / 1000),
  };
  let cursor = report.cursor;
  let scanned = report.scanned_count;

  while (Date.now() < deadline) {
    let page: Stripe.ApiList<Stripe.Charge>;
    try {
      page = await stripe.charges.list({
        created,
        limit: PAGE_SIZE,
        ...(cursor ? { starting_after: cursor } : {}),
        expand: ["data.customer"],
      });
    } catch (err) {
      return handleStripeError(report, err);
    }

    const rows = page.data
      .map((c) => chargeToRow(report.id, c, report.state))
      .filter((r): r is RowInsert => r !== null);

    if (rows.length) {
      const { error } = await db.from("report_rows").upsert(rows, { onConflict: "report_id,charge_id" });
      if (error) throw new Error(`Saving rows failed: ${error.message}`);
    }

    const last = page.data[page.data.length - 1];
    scanned += page.data.length;
    if (last) cursor = last.id;

    if (!page.has_more) {
      const { error } = await db.rpc("finalize_report", { p_report_id: report.id });
      if (error) throw new Error(`Finalizing failed: ${error.message}`);
      return true;
    }

    // Save progress and extend the lease. If the report was canceled or
    // deleted meanwhile, no row matches and we stop.
    const { data: still } = await db
      .from("reports")
      .update({
        cursor,
        scanned_count: scanned,
        scanned_through: last ? new Date(last.created * 1000).toISOString() : null,
        locked_until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
      })
      .eq("id", report.id)
      .eq("status", "processing")
      .select("id");
    if (!still?.length) return true;
  }

  // Out of time: release the lease so the next invocation picks it up now.
  await db.from("reports").update({ locked_until: null }).eq("id", report.id).eq("status", "processing");
  return false;
}

async function handleStripeError(report: ReportRecord, err: unknown): Promise<boolean> {
  const e = err as { type?: string; message?: string };
  const message = e.message ?? String(err);
  if (e.type === "StripeAuthenticationError" || e.type === "StripePermissionError") {
    await markFailed(report.id, `Stripe rejected the key: ${message}`);
    return true;
  }
  const attempts = report.attempts + 1;
  if (attempts >= MAX_FAILURES) {
    await markFailed(report.id, `Gave up after ${attempts} errors. Last error: ${message}`);
    return true;
  }
  // Transient: record it and back off; the next worker run resumes from the cursor.
  await createAdminClient()
    .from("reports")
    .update({
      attempts,
      error: message,
      locked_until: new Date(Date.now() + 30_000).toISOString(),
    })
    .eq("id", report.id);
  return true;
}

async function markFailed(id: string, error: string) {
  await createAdminClient()
    .from("reports")
    .update({ status: "failed", error, locked_until: null, completed_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Work through queued reports until the time budget is spent.
 * Returns whether any work is left over.
 */
export async function runWorker(budgetMs: number): Promise<{ processed: number; moreWork: boolean }> {
  const db = createAdminClient();
  const deadline = Date.now() + budgetMs;
  let processed = 0;

  while (Date.now() < deadline - 5_000) {
    const { data, error } = await db.rpc("claim_report", { lease_seconds: LEASE_SECONDS });
    if (error) throw new Error(`claim_report failed: ${error.message}`);
    const report = (data as ReportRecord[] | null)?.[0];
    if (!report) return { processed, moreWork: false };
    processed++;
    try {
      await processReport(report, deadline - 5_000);
    } catch (err) {
      await handleStripeError(report, err);
    }
  }

  // Only count work that can be claimed right now. Reports backing off after
  // an error, or leased by another invocation, are left to the scheduler.
  const { count } = await db
    .from("reports")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "processing"])
    .or(`locked_until.is.null,locked_until.lt.${new Date().toISOString()}`);
  return { processed, moreWork: (count ?? 0) > 0 };
}
