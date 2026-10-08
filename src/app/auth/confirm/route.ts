import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSessionClient } from "@/lib/supabase/server";

// Invite and login links point here with a one-time token hash.
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const type = req.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const fail = new URL("/login?error=link", req.url);
  if (!tokenHash || (type !== "invite" && type !== "magiclink")) return NextResponse.redirect(fail);

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(fail);
  return NextResponse.redirect(new URL("/auth/set-password", req.url));
}
