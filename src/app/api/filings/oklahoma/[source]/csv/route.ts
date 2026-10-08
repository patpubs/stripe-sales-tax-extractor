import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeFiling, getSource, overrideTarget } from "@/lib/filings/oklahoma/data";
import { importCsv, importFilename } from "@/lib/filings/oklahoma/copo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The Oklahoma COPO import file for a finished Oklahoma report (single or combined). */
export async function GET(_: Request, { params }: { params: Promise<{ source: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const source = await getSource((await params).source);
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (source.status !== "ready") {
    return NextResponse.json({ error: "the report must finish first" }, { status: 409 });
  }

  const filing = await computeFiling(source);
  const filename = importFilename(source.periodLabel);
  await createAdminClient()
    .from("downloads")
    .insert({ ...overrideTarget(source), user_id: user.id, variant: "ok_copo", filename, row_count: filing.totals.length });

  return new Response(importCsv(filing), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
