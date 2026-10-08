import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listReports } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const accountId = req.nextUrl.searchParams.get("account") || undefined;
  const reports = await listReports({ accountId, limit: 100 });
  return NextResponse.json({ reports }, { headers: { "cache-control": "no-store" } });
}
