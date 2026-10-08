import { cleanCity, cleanZip, countyKey } from "./clean.ts";
import { normalizeCopo } from "./copo.ts";

/** Minimal CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/**
 * The base template (CSV-BaseCopos) from the filing portal: every valid COPO
 * code. Uses the column headed "Copo" if there is one, else the first column
 * of 1-4 digit codes; a name column is kept when one is recognizable.
 */
export function parseBaseCopos(text: string): { code: string; name: string | null }[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => /[a-z]/.test(h));
  const body = hasHeader ? rows.slice(1) : rows;
  let codeCol = hasHeader ? header.findIndex((h) => h === "copo" || h === "copo code" || h === "code") : -1;
  if (codeCol < 0) codeCol = header.findIndex((h) => h.includes("copo"));
  if (codeCol < 0) {
    const width = Math.max(...body.map((r) => r.length));
    for (let c = 0; c < width && codeCol < 0; c++) {
      const vals = body.map((r) => r[c]).filter((v) => v?.trim());
      if (vals.length && vals.every((v) => normalizeCopo(v))) codeCol = c;
    }
  }
  if (codeCol < 0) return [];
  const nameCol = hasHeader ? header.findIndex((h, i) => i !== codeCol && /name|jurisdiction|city|county|description/.test(h)) : -1;
  const seen = new Map<string, string | null>();
  for (const r of body) {
    const code = normalizeCopo(r[codeCol]);
    if (code && !seen.has(code)) seen.set(code, nameCol >= 0 ? r[nameCol]?.trim() || null : null);
  }
  return [...seen].map(([code, name]) => ({ code, name }));
}

export type TablesImport = {
  cities: { city: string; copos: string[] }[];
  zips: { zip: string; county: string }[];
  counties: { name: string; copo: string }[];
  towns: { town: string; county: string }[];
  copos: { code: string; name: string | null }[];
  problems: string[];
};

/**
 * Lookup tables as JSON, keyed like the dictionaries in the monthly process:
 * city_copo, zip_county_map, county_copo, city_to_county_fallback and
 * optionally valid_copos. Any subset may be given.
 */
export function parseTablesJson(text: string): TablesImport {
  const out: TablesImport = { cities: [], zips: [], counties: [], towns: [], copos: [], problems: [] };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch (err) {
    out.problems.push(`Not valid JSON: ${(err as Error).message}`);
    return out;
  }
  const obj = (k: string) => (json[k] && typeof json[k] === "object" ? (json[k] as Record<string, unknown>) : {});

  for (const [rawCity, v] of Object.entries(obj("city_copo"))) {
    const city = cleanCity(rawCity);
    const copos = (Array.isArray(v) ? v : [v]).map(normalizeCopo);
    if (!city || !copos.length || copos.some((c) => !c)) out.problems.push(`city_copo "${rawCity}": ${JSON.stringify(v)}`);
    else out.cities.push({ city, copos: copos as string[] });
  }
  for (const [rawZip, county] of Object.entries(obj("zip_county_map"))) {
    const zip = cleanZip(rawZip);
    if (zip.length !== 5 || typeof county !== "string" || !county.trim()) out.problems.push(`zip_county_map "${rawZip}"`);
    else out.zips.push({ zip, county: countyKey(county) });
  }
  for (const [name, v] of Object.entries(obj("county_copo"))) {
    const copo = normalizeCopo(v);
    if (!copo || !copo.endsWith("88")) out.problems.push(`county_copo "${name}": ${JSON.stringify(v)}`);
    else out.counties.push({ name: countyKey(name), copo });
  }
  for (const [rawTown, county] of Object.entries(obj("city_to_county_fallback"))) {
    const town = cleanCity(rawTown);
    if (!town || typeof county !== "string" || !county.trim()) out.problems.push(`city_to_county_fallback "${rawTown}"`);
    else out.towns.push({ town, county: countyKey(county) });
  }
  const valid = Array.isArray(json.valid_copos) ? json.valid_copos : [];
  for (const v of valid) {
    const code = normalizeCopo(v);
    if (code) out.copos.push({ code, name: null });
    else out.problems.push(`valid_copos ${JSON.stringify(v)}`);
  }
  // Later duplicates (e.g. two spellings that clean to the same key) win.
  const dedupe = <T,>(rows: T[], key: (r: T) => string) => [...new Map(rows.map((r) => [key(r), r])).values()];
  out.cities = dedupe(out.cities, (r) => r.city);
  out.zips = dedupe(out.zips, (r) => r.zip);
  out.counties = dedupe(out.counties, (r) => r.name);
  out.towns = dedupe(out.towns, (r) => r.town);
  out.copos = dedupe(out.copos, (r) => r.code);
  return out;
}
