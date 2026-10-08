import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { tableCounts } from "@/lib/filings/oklahoma/data";
import { DeleteEntry, TablesUpload } from "./data-forms";

export default async function OklahomaDataPage() {
  const user = await requireUser();
  const isAdmin = user.role === "super_admin";
  const db = createAdminClient();
  const [counts, aliases, towns] = await Promise.all([
    tableCounts(),
    db.from("ok_city_copos").select("city, copos, created_at, profiles:created_by(full_name, email)").eq("alias", true).order("city").limit(1000),
    db.from("ok_town_counties").select("town, county, created_at, profiles:created_by(full_name, email)").order("town").limit(1000),
  ]);
  type Who = { profiles: { full_name: string | null; email: string } | null };
  const who = (r: Who) => r.profiles?.full_name || r.profiles?.email || "imported";

  const stats = [
    ["Base COPO codes", counts.copos],
    ["Counties", counts.counties],
    ["Cities", counts.cities],
    ["Saved spellings", counts.aliases],
    ["Zip codes", counts.zips],
    ["Unincorporated towns", counts.towns],
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/filings" className="text-sm text-blue-600 hover:underline">← State filings</Link>
        <h1 className="mt-1 text-xl font-semibold">Oklahoma lookup tables</h1>
        <p className="text-sm text-slate-600">
          These map each sale&apos;s city and zip to COPO codes. Spellings and towns grow as sales are reviewed; the base
          template and city codes come from the Tax Commission.
        </p>
      </div>

      <section className="card">
        <dl className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {stats.map(([label, n]) => (
            <div key={label}>
              <dt className="text-slate-500">{label}</dt>
              <dd className={`text-lg font-semibold ${n === 0 && label !== "Saved spellings" && label !== "Unincorporated towns" ? "text-red-700" : ""}`}>
                {n.toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {isAdmin && <TablesUpload />}

      <section className="card">
        <h2 className="text-lg font-semibold">Saved spellings ({aliases.data?.length ?? 0})</h2>
        <p className="mt-1 text-sm text-slate-500">Typos and variants that map to a known city.</p>
        <div className="mt-4 divide-y divide-slate-100 text-sm">
          {(aliases.data ?? []).length === 0 && <p className="text-slate-500">None yet.</p>}
          {((aliases.data ?? []) as unknown as ({ city: string; copos: string[] } & Who)[]).map((a) => (
            <div key={a.city} className="flex items-center gap-3 py-2">
              <span className="flex-1">
                <span className="font-medium">{a.city}</span> → <span className="font-mono">{a.copos.join(", ")}</span>
                <span className="ml-2 text-xs text-slate-500">{who(a)}</span>
              </span>
              {isAdmin && <DeleteEntry kind="alias" value={a.city} />}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold">Unincorporated towns ({towns.data?.length ?? 0})</h2>
        <p className="mt-1 text-sm text-slate-500">Towns with no city COPO; their sales go to county tax only.</p>
        <div className="mt-4 divide-y divide-slate-100 text-sm">
          {(towns.data ?? []).length === 0 && <p className="text-slate-500">None yet.</p>}
          {((towns.data ?? []) as unknown as ({ town: string; county: string } & Who)[]).map((t) => (
            <div key={t.town} className="flex items-center gap-3 py-2">
              <span className="flex-1">
                <span className="font-medium">{t.town}</span> → {t.county} County
                <span className="ml-2 text-xs text-slate-500">{who(t)}</span>
              </span>
              {isAdmin && <DeleteEntry kind="town" value={t.town} />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
