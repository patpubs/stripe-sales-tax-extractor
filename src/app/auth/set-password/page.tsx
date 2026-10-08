import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { SetPasswordForm } from "./set-password-form";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?error=link");
  return (
    <AuthShell title="Set your password" subtitle={user.email}>
      <SetPasswordForm defaultName={user.full_name ?? ""} />
    </AuthShell>
  );
}
