import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { refreshRateChart } from "@/lib/filings/oklahoma/chart-import";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${env.cronSecret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called daily by pg_cron: loads the quarter's Oklahoma rate chart once it's published. */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await refreshRateChart());
}
