import Link from "next/link";
import { FileText, LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { signOut } from "@/app/actions";
import { NavLinks } from "@/components/nav-links";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const name = user.full_name || user.email;
  const links = [
    { href: "/", label: "Reports" },
    { href: "/schedules", label: "Schedules" },
    { href: "/filings", label: "State filings" },
    { href: "/downloads", label: "Download history" },
    ...(user.role === "super_admin"
      ? [
          { href: "/accounts", label: "Stripe accounts" },
          { href: "/users", label: "Users" },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-blue-50 text-blue-600">
              <FileText className="size-5" />
            </span>
            <span className="text-lg font-semibold">Sales Tax Report</span>
          </Link>
          <NavLinks links={links} />
          <div className="ml-auto flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-full bg-orange-500 text-sm font-semibold text-white">
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="hidden text-sm text-slate-600 sm:inline">{name}</span>
            <form action={signOut}>
              <button className="btn-ghost" title="Sign out" aria-label="Sign out">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
