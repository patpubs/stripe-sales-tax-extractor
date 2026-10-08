import { redirect } from "next/navigation";
import { getCurrentUser, needsSetup } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (await needsSetup()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  return (
    <AuthShell title="Sign in" subtitle="Access is by invitation only.">
      {error === "link" && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          That link has expired or was already used. Ask your admin for a new one.
        </p>
      )}
      <LoginForm />
    </AuthShell>
  );
}
