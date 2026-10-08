"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Check, CheckCircle2, Download, X } from "lucide-react";
import { money } from "@/lib/format";
import type { OkFiling, ResolvedSale } from "@/lib/filings/oklahoma/copo";
import type { ActionResult } from "@/app/actions";
import { assignTown, saveAlias, setOverride } from "../actions";

const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const pct = (n: number) => `${Math.round(n * 100)}%`;
const sum = (sales: ResolvedSale[]) => sales.reduce((t, s) => t + s.net, 0);

export function FilingReview({
  sourceKey,
  title: heading,
  accounts,
  filename,
  filing: f,
  cities,
  counties,
}: {
  sourceKey: string;
  title: string;
  accounts: string[];
  filename: string;
  filing: OkFiling;
  cities: string[];
  counties: string[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
    });

  const of = (k: ResolvedSale["resolution"]["kind"]) => f.sales.filter((s) => s.resolution.kind === k);
  const exact = of("city");
  const fuzzy = of("fuzzy");
  const towns = of("town");
  const zip = of("zip");
  const unmapped = of("unmapped");
  const skipped = of("skipped");
  const needsInput = [...unmapped, ...zip.filter((s) => s.resolution.kind === "zip" && !s.resolution.accepted)];
  const notes = f.sales.filter((s) => (s.resolution.kind === "city" || s.resolution.kind === "fuzzy") && s.resolution.note);

  // One fuzzy decision covers every sale with the same typed city.
  const byCity = new Map<string, ResolvedSale[]>();
  for (const s of fuzzy) byCity.set(s.cleanCity, [...(byCity.get(s.cleanCity) ?? []), s]);
  const fuzzyGroups = [...byCity].map(([city, sales]) => ({ city, sales }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/filings" className="text-sm text-blue-600 hover:underline">← State filings</Link>
          <h1 className="mt-1 text-xl font-semibold">{heading}</h1>
          <p className="text-sm text-slate-500">{accounts.join(" + ")}</p>
        </div>
        <a href={`/api/filings/oklahoma/${sourceKey}/csv`} className="btn-primary">
          <Download className="size-4" /> {filename}
        </a>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="card">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Check</h2>
          {f.balanced ? (
            <span className="badge border-green-200 bg-green-50 text-green-700"><CheckCircle2 className="size-3" /> Totals reconcile</span>
          ) : (
            <span className="badge border-red-200 bg-red-50 text-red-700"><AlertTriangle className="size-3" /> Totals don&apos;t reconcile</span>
          )}
        </div>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Net taxable sales" value={money(f.expected)} sub={`${f.sales.length} sales`} />
          <Stat label="City level" value={money(f.cityTotal)} sub={`${exact.length + fuzzy.length} sales`} />
          <Stat label="County only" value={money(f.countyOnlyTotal)} sub={`${towns.length + zip.length} sales`} />
          <Stat label="Not in file" value={money(f.unmappedTotal)} sub={`${unmapped.length} unmapped`} warn={unmapped.length > 0} />
          <Stat label="Left out" value={money(f.skippedTotal)} sub={`${skipped.length} sales`} />
          <Stat label="In file" value={money(f.cityTotal + f.countyOnlyTotal)} sub={`${f.totals.length} COPO rows`} />
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          City level + county only + not in file + left out = net taxable sales. County rows (xx88) repeat the city-level
          dollars, so they aren&apos;t added again.
        </p>
      </section>

      {fuzzyGroups.length > 0 && (
        <section className="card">
          <h2 className="text-lg font-semibold">Likely typos ({fuzzy.length})</h2>
          <p className="mt-1 text-sm text-slate-500">
            Used in the file as shown. Approve to remember the spelling for good; reject to handle them below instead.
          </p>
          <div className="mt-4 divide-y divide-slate-100">
            {fuzzyGroups.map(({ city, sales }) => {
              const r = sales[0].resolution as Extract<ResolvedSale["resolution"], { kind: "fuzzy" }>;
              return (
                <div key={city} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">&ldquo;{sales[0].city}&rdquo;</span> → {title(r.match)}{" "}
                    <span className="text-slate-500">({pct(r.score)} match, COPO {r.cityCopo})</span>
                    <div className="text-xs text-slate-500">{sales.length} sale{sales.length > 1 ? "s" : ""} · {money(sum(sales))}</div>
                  </div>
                  <button className="btn-secondary py-1.5" disabled={pending} onClick={() => run(() => saveAlias(city, r.match))}>
                    <Check className="size-4" /> Approve
                  </button>
                  <button className="btn-ghost" disabled={pending} title="Reject" onClick={() => run(() => setOverride(sourceKey, "reject", city, true))}>
                    <X className="size-4" /> Reject
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {needsInput.length > 0 && (
        <section className="card">
          <h2 className="text-lg font-semibold">Needs your input ({needsInput.length})</h2>
          <p className="mt-1 text-sm text-slate-500">
            Map the city to a known one (saved as a spelling), put an unincorporated town in its county (saved), or leave
            the sale out of this month&apos;s file.
          </p>
          <div className="mt-4 divide-y divide-slate-100">
            {needsInput.map((s) => (
              <InputRow key={s.id} sale={s} sourceKey={sourceKey} cities={cities} counties={counties} pending={pending} run={run} />
            ))}
          </div>
        </section>
      )}

      {fuzzyGroups.length === 0 && needsInput.length === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <CheckCircle2 className="size-4" /> Every sale mapped on its own. Nothing to review.
        </div>
      )}

      <Details summary={`Mapped automatically: ${exact.length} sales, ${money(sum(exact))}`}>
        {notes.length > 0 && (
          <ul className="mb-3 space-y-1 text-xs text-amber-800">
            {notes.map((s) => (
              <li key={s.id}>{saleLine(s)}: {"note" in s.resolution ? s.resolution.note : ""}</li>
            ))}
          </ul>
        )}
        <SaleTable sales={exact} />
      </Details>

      {(towns.length > 0 || zip.length > 0) && (
        <Details summary={`County only: ${towns.length + zip.length} sales, ${money(sum([...towns, ...zip]))}`}>
          <SaleTable sales={[...towns, ...zip]} />
        </Details>
      )}

      {skipped.length > 0 && (
        <Details summary={`Left out of the file: ${skipped.length} sales, ${money(sum(skipped))}`} open>
          <div className="divide-y divide-slate-100">
            {skipped.map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1">{saleLine(s)} · {money(s.net)}</span>
                <button className="btn-ghost py-1" disabled={pending} onClick={() => run(() => setOverride(sourceKey, "skip", s.id, false))}>
                  Put back
                </button>
              </div>
            ))}
          </div>
        </Details>
      )}

      <Details summary={`Import file: ${f.totals.length} COPO rows`}>
        <table className="w-full max-w-sm text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="py-1 font-medium">Copo</th><th className="py-1 text-right font-medium">CoPoNetTaxSales</th></tr>
          </thead>
          <tbody className="font-mono">
            {f.totals.map(([code, cents]) => (
              <tr key={code}><td className="py-0.5">{code}</td><td className="py-0.5 text-right">{(cents / 100).toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
      </Details>
    </div>
  );
}

function saleLine(s: ResolvedSale) {
  return `${s.city || "(no city)"}${s.zip ? ` ${s.zip}` : ""}${s.customer ? ` · ${s.customer}` : ""}`;
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-lg font-semibold ${warn ? "text-red-700" : ""}`}>{value}</dd>
      <dd className="text-xs text-slate-500">{sub}</dd>
    </div>
  );
}

function Details({ summary, open, children }: { summary: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="card" open={open}>
      <summary className="cursor-pointer font-medium">{summary}</summary>
      <div className="mt-4 overflow-x-auto">{children}</div>
    </details>
  );
}

function SaleTable({ sales }: { sales: ResolvedSale[] }) {
  return (
    <table className="w-full min-w-[640px] text-left text-sm">
      <thead className="text-slate-500">
        <tr>
          <th className="py-1 pr-3 font-medium">City as typed</th>
          <th className="py-1 pr-3 font-medium">Zip</th>
          <th className="py-1 pr-3 font-medium">Customer</th>
          <th className="py-1 pr-3 font-medium">COPO</th>
          <th className="py-1 text-right font-medium">Net</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {sales.map((s) => {
          const r = s.resolution;
          const copo =
            r.kind === "city" || r.kind === "fuzzy"
              ? [r.cityCopo, r.countyCopo].filter(Boolean).join(" + ")
              : r.kind === "town"
                ? `${r.countyCopo} (town)`
                : r.kind === "zip"
                  ? `${r.countyCopo} (by zip)`
                  : "";
          return (
            <tr key={s.id}>
              <td className="py-1 pr-3">{s.city}</td>
              <td className="py-1 pr-3">{s.zip}</td>
              <td className="py-1 pr-3">{s.customer}</td>
              <td className="py-1 pr-3 font-mono">{copo}</td>
              <td className="py-1 text-right">{money(s.net)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function InputRow({
  sale: s,
  sourceKey,
  cities,
  counties,
  pending,
  run,
}: {
  sale: ResolvedSale;
  sourceKey: string;
  cities: string[];
  counties: string[];
  pending: boolean;
  run: (fn: () => Promise<ActionResult>) => void;
}) {
  const r = s.resolution;
  const suggestions = r.kind === "zip" || r.kind === "unmapped" ? r.suggestions : [];
  const [city, setCity] = useState(suggestions[0] && suggestions[0].score >= 0.75 ? suggestions[0].city : "");
  const [county, setCounty] = useState("");
  const listId = `cities-${s.id}`;

  return (
    <div className="space-y-2 py-4 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{s.city ? `“${s.city}”` : "(no city)"}</span>
        <span className="text-slate-600">zip {s.zip || "—"}</span>
        {s.customer && <span className="text-slate-600">{s.customer}</span>}
        {s.account && <span className="text-xs text-slate-500">{s.account}</span>}
        <span className="ml-auto font-medium">{money(s.net)}</span>
      </div>
      <p className={`text-xs ${r.kind === "unmapped" ? "text-red-700" : "text-amber-800"}`}>
        {r.kind === "zip"
          ? `In the file as county tax only (${r.countyCopo}, county from the zip). Map it to a city if it's a typo.`
          : r.kind === "unmapped"
            ? `Not in the file: ${r.reason}`
            : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {s.cleanCity && (
          <>
            <input
              className="input w-48 py-1.5"
              list={listId}
              placeholder="Known city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
            <datalist id={listId}>
              {cities.map((c) => <option key={c} value={c} />)}
            </datalist>
            <button className="btn-secondary py-1.5" disabled={pending || !city} onClick={() => run(() => saveAlias(s.cleanCity, city))}>
              Map to city
            </button>
            <select className="input w-44 py-1.5" value={county} onChange={(e) => setCounty(e.target.value)}>
              <option value="">County…</option>
              {counties.map((c) => <option key={c} value={c}>{title(c)} County</option>)}
            </select>
            <button className="btn-secondary py-1.5" disabled={pending || !county} onClick={() => run(() => assignTown(s.cleanCity, county))}>
              Town in county
            </button>
          </>
        )}
        {r.kind === "zip" && (
          <button className="btn-secondary py-1.5" disabled={pending} onClick={() => run(() => setOverride(sourceKey, "accept", s.id, true))}>
            Keep county only
          </button>
        )}
        <button className="btn-ghost py-1.5" disabled={pending} onClick={() => run(() => setOverride(sourceKey, "skip", s.id, true))}>
          Leave out
        </button>
      </div>
      {suggestions.length > 0 && (
        <p className="text-xs text-slate-500">
          Closest: {suggestions.map((x) => `${title(x.city)} (${pct(x.score)})`).join(", ")}
        </p>
      )}
    </div>
  );
}
