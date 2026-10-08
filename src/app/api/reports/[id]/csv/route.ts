import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCsvVariant, type CsvVariant } from "@/lib/report-variants";
import { reportCsvResponse } from "@/lib/report-csv";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const variantParam = req.nextUrl.searchParams.get("variant");
  const variant: CsvVariant = isCsvVariant(variantParam) ? variantParam : "full";

  const { data: report } = await createAdminClient()
    .from("reports")
    .select("id, state, status, period_label, timezone, stripe_accounts(name)")
    .eq("id", id)
    .maybeSingle();
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (report.status !== "ready") return NextResponse.json({ error: "report is not ready" }, { status: 409 });

  const account = report.stripe_accounts as unknown as { name: string } | null;
  return reportCsvResponse({
    sources: [{ id: report.id, account_name: account?.name ?? "stripe", timezone: report.timezone }],
    state: report.state,
    periodLabel: report.period_label,
    variant,
    userId: user.id,
    log: { report_id: report.id },
  });
}
