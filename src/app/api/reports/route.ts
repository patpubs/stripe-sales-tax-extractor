import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listGroups, listReports } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const reports = await listReports({ limit: 150 });
  const groups = await listGroups(reports);
  return NextResponse.json({ reports, groups }, { headers: { "cache-control": "no-store" } });
}
