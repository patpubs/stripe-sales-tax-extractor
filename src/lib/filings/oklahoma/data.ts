import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildFiling, COUNTY_COPOS, countyKey, emptyOverrides, type OkFiling, type OkOverrides, type OkSale, type OkTables } from "./copo";

const PAGE = 1000;
type Db = ReturnType<typeof createAdminClient>;

/** Read a whole table; PostgREST caps each response at 1000 rows. */
async function all<T>(db: Db, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).order(columns.split(",")[0].trim()).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

export async function loadTables(db: Db = createAdminClient()): Promise<OkTables> {
  const [copos, cities, zips, towns] = await Promise.all([
    all<{ code: string }>(db, "ok_copos", "code"),
    all<{ city: string; copos: string[] }>(db, "ok_city_copos", "city, copos"),
    all<{ zip: string; county: string }>(db, "ok_zip_counties", "zip, county"),
    all<{ town: string; county: string }>(db, "ok_town_counties", "town, county"),
  ]);
  return {
    copos: new Set(copos.map((r) => r.code)),
    counties: COUNTY_COPOS,
    cities: new Map(cities.map((r) => [r.city, r.copos])),
    zips: new Map(zips.map((r) => [r.zip, countyKey(r.county)])),
    towns: new Map(towns.map((r) => [r.town, countyKey(r.county)])),
  };
}

/** A finished-or-running Oklahoma report the file can be built from: one account, or a combined report. */
export type OkSource = {
  key: string; // "r-<report id>" or "g-<group id>"
  kind: "report" | "group";
  id: string;
  periodLabel: string;
  periodStart: string;
  accounts: { reportId: string; name: string }[];
  status: "ready" | "running" | "failed";
  scheduled: boolean;
  createdAt: string;
};

type ReportRow = {
  id: string;
  group_id: string | null;
  period_label: string;
  period_start: string;
  status: string;
  schedule_id: string | null;
  created_at: string;
  stripe_accounts: { name: string } | null;
};

function sourceStatus(statuses: string[]): OkSource["status"] {
  if (statuses.every((s) => s === "ready")) return "ready";
  if (statuses.some((s) => s === "failed" || s === "canceled")) return "failed";
  return "running";
}

function toSources(reports: ReportRow[]): OkSource[] {
  const groups = new Map<string, ReportRow[]>();
  const out: OkSource[] = [];
  for (const r of reports) {
    if (r.group_id) groups.set(r.group_id, [...(groups.get(r.group_id) ?? []), r]);
    else
      out.push({
        key: `r-${r.id}`,
        kind: "report",
        id: r.id,
        periodLabel: r.period_label,
        periodStart: r.period_start,
        accounts: [{ reportId: r.id, name: r.stripe_accounts?.name ?? "Deleted account" }],
        status: sourceStatus([r.status]),
        scheduled: !!r.schedule_id,
        createdAt: r.created_at,
      });
  }
  for (const [id, members] of groups) {
    out.push({
      key: `g-${id}`,
      kind: "group",
      id,
      periodLabel: members[0].period_label,
      periodStart: members.map((m) => m.period_start).sort()[0],
      accounts: members
        .map((m) => ({ reportId: m.id, name: m.stripe_accounts?.name ?? "Deleted account" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      status: sourceStatus(members.map((m) => m.status)),
      scheduled: members.some((m) => !!m.schedule_id),
      createdAt: members.map((m) => m.created_at).sort()[0],
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const REPORT_COLUMNS = "id, group_id, period_label, period_start, status, schedule_id, created_at, stripe_accounts(name)";

/** Recent Oklahoma reports (single-account and combined), newest first. */
export async function listSources(limit = 24): Promise<OkSource[]> {
  const { data, error } = await createAdminClient()
    .from("reports")
    .select(REPORT_COLUMNS)
    .eq("state", "OK")
    .order("created_at", { ascending: false })
    .limit(limit * 4);
  if (error) throw error;
  return toSources((data ?? []) as unknown as ReportRow[]).slice(0, limit);
}

export async function getSource(key: string): Promise<OkSource | null> {
  const m = key.match(/^([rg])-([0-9a-f-]{36})$/);
  if (!m) return null;
  const q = createAdminClient().from("reports").select(REPORT_COLUMNS).eq("state", "OK");
  const { data, error } = await (m[1] === "g" ? q.eq("group_id", m[2]) : q.eq("id", m[2]).is("group_id", null));
  if (error) throw error;
  if (!data?.length) return null;
  return toSources(data as unknown as ReportRow[])[0];
}

/** Every Oklahoma sale in the source, net of refunds. */
export async function loadSales(source: OkSource, db: Db = createAdminClient()): Promise<OkSale[]> {
  const accountOf = new Map(source.accounts.map((a) => [a.reportId, a.name]));
  const out: OkSale[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("report_rows")
      .select("report_id, charge_id, city, postal_code, amount, amount_refunded, customer_name")
      .in("report_id", [...accountOf.keys()])
      .eq("state", "OK")
      .order("created")
      .order("charge_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      out.push({
        id: r.charge_id,
        city: r.city,
        zip: r.postal_code,
        net: r.amount - r.amount_refunded,
        customer: r.customer_name,
        account: accountOf.get(r.report_id),
      });
    }
    if (!data || data.length < PAGE) return out;
  }
}

export function overrideTarget(source: OkSource) {
  return source.kind === "group" ? { group_id: source.id } : { report_id: source.id };
}

export async function loadOverrides(source: OkSource, db: Db = createAdminClient()): Promise<OkOverrides> {
  const target = overrideTarget(source);
  const [col, val] = Object.entries(target)[0];
  const { data, error } = await db.from("filing_overrides").select("kind, value").eq("state", "OK").eq(col, val);
  if (error) throw error;
  const o = emptyOverrides();
  for (const r of data ?? []) {
    if (r.kind === "reject") o.rejected.add(r.value);
    else if (r.kind === "skip") o.skipped.add(r.value);
    else if (r.kind === "accept") o.accepted.add(r.value);
  }
  return o;
}

export async function computeFiling(source: OkSource, tables?: OkTables): Promise<OkFiling> {
  const db = createAdminClient();
  const [t, sales, o] = await Promise.all([tables ?? loadTables(db), loadSales(source, db), loadOverrides(source, db)]);
  return buildFiling(sales, t, o);
}

export async function tableCounts() {
  const db = createAdminClient();
  const count = async (table: string, alias?: boolean) => {
    let q = db.from(table).select("*", { count: "exact", head: true });
    if (alias !== undefined) q = q.eq("alias", alias);
    const { count: n, error } = await q;
    if (error) throw error;
    return n ?? 0;
  };
  const [copos, cities, aliases, zips, towns] = await Promise.all([
    count("ok_copos"),
    count("ok_city_copos", false),
    count("ok_city_copos", true),
    count("ok_zip_counties"),
    count("ok_town_counties"),
  ]);
  return { copos, cities, aliases, zips, towns };
}
