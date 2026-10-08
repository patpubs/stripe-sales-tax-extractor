import { after, NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runWorker } from "@/lib/extract";
import { triggerWorker } from "@/lib/worker-trigger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Leave headroom under maxDuration for the final save and the re-trigger.
const BUDGET_MS = 240_000;

function authorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.cronSecret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Background worker. Called by Supabase pg_cron every minute, right after a
 * report is requested, and by itself while work remains. It answers at once
 * and does the work after the response, so callers never wait on it.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  after(async () => {
    const { moreWork } = await runWorker(BUDGET_MS);
    if (moreWork) await triggerWorker();
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
