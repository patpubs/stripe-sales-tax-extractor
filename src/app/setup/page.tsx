import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  return (
    <AuthShell
      title="Create the admin account"
      subtitle="This first account becomes the super admin. Only the email configured for this app can be used."
    >
      <SetupForm />
    </AuthShell>
  );
}
