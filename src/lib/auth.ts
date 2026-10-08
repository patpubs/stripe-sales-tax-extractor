import "server-only";
import { redirect } from "next/navigation";
import { createSessionClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";

export type Role = "super_admin" | "member";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  disabled: boolean;
  created_at: string;
};

/** The signed-in user's profile, or null. */
export async function getCurrentUser(): Promise<Profile | null> {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!data || data.disabled) return null;
  return data as Profile;
}

export async function requireUser(): Promise<Profile> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireSuperAdmin(): Promise<Profile> {
  const user = await requireUser();
  if (user.role !== "super_admin") redirect("/");
  return user;
}

/** True until the first (super admin) account has been created. */
export async function needsSetup(): Promise<boolean> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return (count ?? 0) === 0;
}
