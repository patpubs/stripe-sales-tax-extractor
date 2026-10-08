import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCsvVariant, type CsvVariant } from "@/lib/report-variants";
import { reportCsvResponse } from "@/lib/report-csv";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Combined CSV for every account in a report group. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const variantParam = req.nextUrl.searchParams.get("variant");
  const variant: CsvVariant = isCsvVariant(variantParam) ? variantParam : "full";

  const db = createAdminClient();
  const { data: group } = await db.from("report_groups").select("id, state, period_label").eq("id", id).maybeSingle();
  if (!group) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: reports } = await db
    .from("reports")
    .select("id, status, timezone, stripe_accounts(name)")
    .eq("group_id", id);
  if (!reports?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (reports.some((r) => r.status !== "ready")) {
    return NextResponse.json({ error: "every account in this report must finish first" }, { status: 409 });
  }

  const sources = reports
    .map((r) => ({
      id: r.id,
      account_name: (r.stripe_accounts as unknown as { name: string } | null)?.name ?? "stripe",
      timezone: r.timezone,
    }))
    .sort((a, b) => a.account_name.localeCompare(b.account_name));

  return reportCsvResponse({
    sources,
    state: group.state,
    periodLabel: group.period_label,
    variant,
    userId: user.id,
    log: { group_id: group.id },
  });
}
