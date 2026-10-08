"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/actions";
import { cleanCity, countyKey } from "@/lib/filings/oklahoma/clean";
import { COUNTY_COPOS } from "@/lib/filings/oklahoma/copo";
import { getSource, overrideTarget } from "@/lib/filings/oklahoma/data";
import { parseBaseCopos, parseTablesJson } from "@/lib/filings/oklahoma/upload";

const CHUNK = 500;

function refresh() {
  revalidatePath("/filings", "layout");
}

/** Save "raw" as a permanent alias of a known city, so it maps on its own from now on. */
export async function saveAlias(raw: string, target: string): Promise<ActionResult> {
  const me = await requireUser();
  const city = cleanCity(raw);
  if (!city) return { ok: false, error: "There's no city name to save." };
  const db = createAdminClient();
  const { data: known } = await db.from("ok_city_copos").select("copos").eq("city", cleanCity(target)).maybeSingle();
  if (!known) return { ok: false, error: `"${target}" isn't a known city.` };
  const { data: existing } = await db.from("ok_city_copos").select("alias").eq("city", city).maybeSingle();
  if (existing && !existing.alias) return { ok: false, error: `"${city}" is already a city in the table.` };
  const { error } = await db
    .from("ok_city_copos")
    .upsert({ city, copos: known.copos, alias: true, created_by: me.id }, { onConflict: "city" });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** Record "raw" as an unincorporated town in a county (county tax only). */
export async function assignTown(raw: string, county: string): Promise<ActionResult> {
  const me = await requireUser();
  const town = cleanCity(raw);
  if (!town) return { ok: false, error: "There's no town name to save." };
  if (!COUNTY_COPOS.has(countyKey(county))) return { ok: false, error: "Pick a county." };
  const { error } = await createAdminClient()
    .from("ok_town_counties")
    .upsert({ town, county: countyKey(county), created_by: me.id }, { onConflict: "town" });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** A decision for this month only: reject a fuzzy match, leave a sale out, or accept county-only. */
export async function setOverride(
  sourceKey: string,
  kind: "reject" | "skip" | "accept",
  value: string,
  on: boolean,
): Promise<ActionResult> {
  const me = await requireUser();
  const source = await getSource(sourceKey);
  if (!source) return { ok: false, error: "Report not found." };
  const db = createAdminClient();
  const target = overrideTarget(source);
  if (on) {
    const { error } = await db.from("filing_overrides").insert({ state: "OK", kind, value, created_by: me.id, ...target });
    if (error && error.code !== "23505") return { ok: false, error: error.message };
  } else {
    const [col, val] = Object.entries(target)[0];
    await db.from("filing_overrides").delete().eq("state", "OK").eq(col, val).eq("kind", kind).eq("value", value);
  }
  refresh();
  return { ok: true };
}

async function upsertAll(table: string, rows: object[], onConflict: string) {
  const db = createAdminClient();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function fileText(fd: FormData): Promise<string | null> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > 5_000_000) throw new Error("That file is too big.");
  return file.text();
}

/** Replace the base template with a fresh CSV-BaseCopos download. */
export async function uploadBaseCopos(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  try {
    const text = await fileText(fd);
    if (!text) return { ok: false, error: "Choose the CSV file." };
    const rows = parseBaseCopos(text);
    if (rows.length < 50) return { ok: false, error: `Found only ${rows.length} COPO codes; is this the base template?` };
    const db = createAdminClient();
    const { error } = await db.from("ok_copos").delete().neq("code", "");
    if (error) throw new Error(error.message);
    await upsertAll("ok_copos", rows, "code");
    refresh();
    return { ok: true, message: `Loaded ${rows.length} COPO codes.` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Merge lookup tables from JSON (city_copo, zip_county_map, city_to_county_fallback, valid_copos; county_copo is only checked). */
export async function importTables(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  try {
    const text = await fileText(fd);
    if (!text) return { ok: false, error: "Choose the JSON file." };
    const t = parseTablesJson(text);
    const loaded = t.cities.length + t.zips.length + t.towns.length + t.copos.length;
    if (!loaded) return { ok: false, error: t.problems[0] ?? "Nothing recognizable in that file." };
    await upsertAll("ok_city_copos", t.cities.map((r) => ({ ...r, created_by: me.id })), "city");
    await upsertAll("ok_zip_counties", t.zips, "zip");
    await upsertAll("ok_town_counties", t.towns.map((r) => ({ ...r, created_by: me.id })), "town");
    await upsertAll("ok_copos", t.copos, "code");
    refresh();
    const parts = [
      `${t.cities.length} cities`,
      `${t.zips.length} zips`,
      `${t.towns.length} towns`,
      ...(t.copos.length ? [`${t.copos.length} COPO codes`] : []),
    ];
    const skipped = t.problems.length ? ` Skipped ${t.problems.length} entries: ${t.problems.slice(0, 5).join("; ")}${t.problems.length > 5 ? "; …" : ""}` : "";
    return { ok: true, message: `Loaded ${parts.join(", ")}.${skipped}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function deleteAlias(city: string): Promise<ActionResult> {
  await requireSuperAdmin();
  await createAdminClient().from("ok_city_copos").delete().eq("city", city).eq("alias", true);
  refresh();
  return { ok: true };
}

export async function deleteTown(town: string): Promise<ActionResult> {
  await requireSuperAdmin();
  await createAdminClient().from("ok_town_counties").delete().eq("town", town);
  refresh();
  return { ok: true };
}
