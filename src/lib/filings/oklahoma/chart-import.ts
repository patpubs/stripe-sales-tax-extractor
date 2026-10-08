import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { chartPdfLines, chartProblems, chartUrl, parseChartLines, quarterOf, type RateChart } from "./rate-chart";

export type ChartImportResult = { status: "loaded" | "current" | "not_published" | "failed"; quarter: string; message: string };

/**
 * Load this quarter's rate chart from the Tax Commission if it isn't loaded
 * yet. Safe to call daily: it does nothing once the quarter is in, and a chart
 * that doesn't parse cleanly is logged and left out rather than loaded.
 */
export async function refreshRateChart(opts: { force?: boolean; userId?: string } = {}): Promise<ChartImportResult> {
  const db = createAdminClient();
  const { year, q, label } = quarterOf();
  const url = chartUrl(year, q);

  if (!opts.force) {
    const { count } = await db.from("ok_rate_chart").select("code", { count: "exact", head: true }).eq("effective", label);
    if (count) return { status: "current", quarter: label, message: `The ${label} chart is already loaded.` };
  }

  const log = async (r: ChartImportResult) => {
    await db.from("ok_chart_imports").insert({ quarter: label, url, status: r.status, message: r.message, created_by: opts.userId ?? null });
    return r;
  };

  let pdf: Uint8Array;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) return log({ status: "not_published", quarter: label, message: `No chart at ${url} yet.` });
    if (!res.ok) return log({ status: "failed", quarter: label, message: `${url} answered ${res.status}.` });
    pdf = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return log({ status: "failed", quarter: label, message: `Couldn't download ${url}: ${(err as Error).message}` });
  }

  let chart: RateChart;
  try {
    chart = parseChartLines(await chartPdfLines(pdf), label);
  } catch (err) {
    return log({ status: "failed", quarter: label, message: `Couldn't read the PDF: ${(err as Error).message}` });
  }
  const problems = chartProblems(chart);
  if (problems.length) {
    return log({ status: "failed", quarter: label, message: `The chart didn't parse cleanly, so nothing was loaded: ${problems.slice(0, 5).join("; ")}` });
  }

  try {
    return log({ status: "loaded", quarter: label, message: await saveChart(chart) });
  } catch (err) {
    return log({ status: "failed", quarter: label, message: `Saving failed: ${(err as Error).message}` });
  }
}

/** Store the chart and make sure every city on it maps to its codes. Returns a summary. */
async function saveChart(chart: RateChart): Promise<string> {
  const db = createAdminClient();
  const { data: before } = await db.from("ok_rate_chart").select("code, name").neq("effective", chart.quarter);
  const rows = [...chart.counties, ...chart.cities].map((c) => ({
    code: c.code,
    name: chart.counties.includes(c) ? `${title(c.name)} County` : title(c.name),
    rate: c.rate,
    county_tax: c.countyTax,
    effective: chart.quarter,
  }));
  const { error } = await db.from("ok_rate_chart").upsert(rows, { onConflict: "code" });
  if (error) throw new Error(error.message);

  // A city keeps every code it has on the chart (one per county it spans).
  const byName = new Map<string, string[]>();
  for (const c of chart.cities) {
    const key = c.name.toLowerCase().replace(/\s+/g, " ");
    byName.set(key, [...(byName.get(key) ?? []), c.code]);
  }
  const { data: existing } = await db.from("ok_city_copos").select("city, copos, alias").in("city", [...byName.keys()]);
  const known = new Map((existing ?? []).map((r) => [r.city, r]));
  const changed = [...byName]
    .filter(([city, codes]) => {
      const k = known.get(city);
      return !k || k.alias || [...k.copos].sort().join() !== [...codes].sort().join();
    })
    .map(([city, copos]) => ({ city, copos, alias: false }));
  if (changed.length) {
    const { error: e2 } = await db.from("ok_city_copos").upsert(changed, { onConflict: "city" });
    if (e2) throw new Error(e2.message);
  }

  const current = new Set(rows.map((r) => r.code));
  const dropped = (before ?? []).filter((r) => !current.has(r.code)).map((r) => `${r.name} (${r.code})`);
  return [
    `Loaded ${chart.cities.length} city and ${chart.counties.length} county codes for ${chart.quarter}.`,
    changed.length ? `Updated ${changed.length} cities: ${changed.slice(0, 8).map((c) => c.city).join(", ")}${changed.length > 8 ? ", …" : ""}.` : "",
    dropped.length ? `No longer on the chart: ${dropped.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function title(s: string) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);
}

export async function lastChartImports(limit = 5) {
  const { data } = await createAdminClient()
    .from("ok_chart_imports")
    .select("quarter, status, message, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
