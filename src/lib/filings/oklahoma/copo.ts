import { cleanCity, cleanZip, closestCities, countyKey } from "./clean.ts";

/**
 * Oklahoma COPO import file. Each sale is net taxable sales under its city's
 * COPO code and again under its county's xx88 code; the Tax Commission's
 * portal imports a two-column CSV of totals per code.
 */

/**
 * Oklahoma's 77 counties in Tax Commission order: alphabetical, so county n's
 * code is n padded to two digits plus 88 (Adair 0188 ... Woodward 7788). Fixed
 * here rather than loaded, so a bad table can't move a county's tax.
 */
export const OK_COUNTIES = [
  "Adair", "Alfalfa", "Atoka", "Beaver", "Beckham", "Blaine", "Bryan", "Caddo", "Canadian", "Carter",
  "Cherokee", "Choctaw", "Cimarron", "Cleveland", "Coal", "Comanche", "Cotton", "Craig", "Creek", "Custer",
  "Delaware", "Dewey", "Ellis", "Garfield", "Garvin", "Grady", "Grant", "Greer", "Harmon", "Harper",
  "Haskell", "Hughes", "Jackson", "Jefferson", "Johnston", "Kay", "Kingfisher", "Kiowa", "Latimer", "Le Flore",
  "Lincoln", "Logan", "Love", "McClain", "McCurtain", "McIntosh", "Major", "Marshall", "Mayes", "Murray",
  "Muskogee", "Noble", "Nowata", "Okfuskee", "Oklahoma", "Okmulgee", "Osage", "Ottawa", "Pawnee", "Payne",
  "Pittsburg", "Pontotoc", "Pottawatomie", "Pushmataha", "Roger Mills", "Rogers", "Seminole", "Sequoyah", "Stephens", "Texas",
  "Tillman", "Tulsa", "Wagoner", "Washington", "Washita", "Woods", "Woodward",
] as const;

/** County key -> xx88 code. "LeFlore" and "Le Flore" both work. */
export const COUNTY_COPOS: ReadonlyMap<string, string> = new Map(
  OK_COUNTIES.flatMap((name, i) => {
    const code = `${String(i + 1).padStart(2, "0")}88`;
    const key = countyKey(name);
    return key.includes(" ") ? [[key, code], [key.replace(/ /g, ""), code]] : [[key, code]];
  }),
);

export type OkTables = {
  /** Every COPO code the portal accepts (the base template). Empty = not loaded, skip validation. */
  copos: Set<string>;
  /** County key -> xx88 code (COUNTY_COPOS). */
  counties: ReadonlyMap<string, string>;
  /** Cleaned city name or alias -> one or more COPO codes (several for multi-county cities). */
  cities: Map<string, string[]>;
  /** 5-digit zip -> county key. */
  zips: Map<string, string>;
  /** Unincorporated town -> county key. */
  towns: Map<string, string>;
};

export type OkSale = {
  id: string;
  city: string | null;
  zip: string | null;
  /** Cents, after refunds. */
  net: number;
  customer: string | null;
  account?: string;
};

/** What this month's operator already decided. */
export type OkOverrides = {
  /** Cleaned city names whose fuzzy suggestion was rejected. */
  rejected: Set<string>;
  /** Sale ids left out of the file. */
  skipped: Set<string>;
  /** Sale ids whose county-only (by zip) mapping was accepted as is. */
  accepted: Set<string>;
};

export type Resolution =
  /** City found exactly (or via a saved alias). */
  | { kind: "city"; cityCopo: string; countyCopo: string | null; note?: string }
  /** Known unincorporated town: county tax only. */
  | { kind: "town"; countyCopo: string }
  /** Likely typo of a known city; used in the file, operator confirms. */
  | { kind: "fuzzy"; match: string; score: number; cityCopo: string; countyCopo: string | null; note?: string }
  /** No city match; county from the zip, county tax only. Operator confirms. */
  | { kind: "zip"; countyCopo: string; accepted: boolean; suggestions: { city: string; score: number }[] }
  /** Nothing matched; left out of the file until resolved. */
  | { kind: "unmapped"; reason: string; suggestions: { city: string; score: number }[] }
  | { kind: "skipped" };

export type ResolvedSale = OkSale & { cleanCity: string; cleanZip: string; resolution: Resolution };

export type OkFiling = {
  sales: ResolvedSale[];
  /** COPO code -> cents, codes with non-zero totals only, ascending. */
  totals: [string, number][];
  expected: number;
  cityTotal: number;
  countyOnlyTotal: number;
  unmappedTotal: number;
  skippedTotal: number;
  /** True when city + county-only + unmapped + skipped equals the expected net. */
  balanced: boolean;
  /** Sales the operator should look at (fuzzy matches, county-only by zip not yet accepted, unmapped). */
  openItems: number;
};

/** Fuzzy matches at or above this score are used automatically (and flagged). */
export const FUZZY_MIN = 0.88;

export const emptyOverrides = (): OkOverrides => ({ rejected: new Set(), skipped: new Set(), accepted: new Set() });

const countyOf = (copo: string) => `${copo.slice(0, 2)}88`;
const isCounty = (copo: string) => copo.endsWith("88");

export function resolveSale(sale: OkSale, t: OkTables, o: OkOverrides): ResolvedSale {
  const city = cleanCity(sale.city);
  const zip = cleanZip(sale.zip);
  const base = { ...sale, cleanCity: city, cleanZip: zip };
  if (o.skipped.has(sale.id)) return { ...base, resolution: { kind: "skipped" } };

  const valid = (copo: string | null | undefined): copo is string => !!copo && (t.copos.size === 0 || t.copos.has(copo));
  const zipCounty = zip.length === 5 ? t.zips.get(zip) : undefined;
  const zipCountyCopo = zipCounty ? t.counties.get(zipCounty) : undefined;

  /** Pick the city's COPO in the zip's county; default to the first. */
  const cityResolution = (copos: string[]) => {
    let pick = copos[0];
    let note: string | undefined;
    if (copos.length > 1) {
      const inCounty = zipCountyCopo ? copos.find((c) => c.slice(0, 2) === zipCountyCopo.slice(0, 2)) : undefined;
      if (inCounty) pick = inCounty;
      else note = `Spans ${copos.length} counties and the zip didn't settle which; used ${pick}.`;
    }
    const county = isCounty(pick) ? null : countyOf(pick);
    if (!valid(pick)) return { error: `COPO ${pick} isn't in the base template.` };
    if (county && !valid(county)) return { error: `County COPO ${county} isn't in the base template.` };
    return { cityCopo: pick, countyCopo: county, note };
  };

  const suggestions = () => closestCities(city, t.cities.keys());

  const exact = city ? t.cities.get(city) : undefined;
  if (exact?.length) {
    const r = cityResolution(exact);
    if ("error" in r) return { ...base, resolution: { kind: "unmapped", reason: r.error!, suggestions: [] } };
    return { ...base, resolution: { kind: "city", ...r } };
  }

  const town = city ? t.towns.get(city) : undefined;
  const townCopo = town ? t.counties.get(town) : undefined;
  if (valid(townCopo)) return { ...base, resolution: { kind: "town", countyCopo: townCopo } };

  const best = suggestions();
  if (best[0] && best[0].score >= FUZZY_MIN && !o.rejected.has(city)) {
    const r = cityResolution(t.cities.get(best[0].city)!);
    if (!("error" in r)) {
      return { ...base, resolution: { kind: "fuzzy", match: best[0].city, score: best[0].score, ...r } };
    }
  }

  if (valid(zipCountyCopo)) return { ...base, resolution: { kind: "zip", countyCopo: zipCountyCopo, accepted: o.accepted.has(sale.id), suggestions: best } };

  const reason = !city
    ? "No city and the zip doesn't identify a county."
    : town
      ? `Town is assigned to "${town}", which isn't a known county.`
      : "City not recognized and the zip doesn't identify a county.";
  return { ...base, resolution: { kind: "unmapped", reason, suggestions: best } };
}

export function buildFiling(sales: OkSale[], t: OkTables, o: OkOverrides = emptyOverrides()): OkFiling {
  const totals = new Map<string, number>();
  const add = (copo: string, cents: number) => totals.set(copo, (totals.get(copo) ?? 0) + cents);
  let expected = 0, cityTotal = 0, countyOnlyTotal = 0, unmappedTotal = 0, skippedTotal = 0, openItems = 0;

  const resolved = sales.map((s) => resolveSale(s, t, o));
  for (const s of resolved) {
    const r = s.resolution;
    expected += s.net;
    switch (r.kind) {
      case "city":
      case "fuzzy":
        add(r.cityCopo, s.net);
        if (r.countyCopo) add(r.countyCopo, s.net);
        cityTotal += s.net;
        if (r.kind === "fuzzy") openItems++;
        break;
      case "town":
      case "zip":
        add(r.countyCopo, s.net);
        countyOnlyTotal += s.net;
        if (r.kind === "zip" && !r.accepted) openItems++;
        break;
      case "unmapped":
        unmappedTotal += s.net;
        openItems++;
        break;
      case "skipped":
        skippedTotal += s.net;
        break;
    }
  }

  return {
    sales: resolved,
    totals: [...totals].filter(([, c]) => c !== 0).sort(([a], [b]) => a.localeCompare(b)),
    expected,
    cityTotal,
    countyOnlyTotal,
    unmappedTotal,
    skippedTotal,
    balanced: cityTotal + countyOnlyTotal + unmappedTotal + skippedTotal === expected,
    openItems,
  };
}

/** The import file itself: Copo,CoPoNetTaxSales with one row per code. */
export function importCsv(filing: OkFiling): string {
  const lines = ["Copo,CoPoNetTaxSales", ...filing.totals.map(([code, c]) => `${code},${(c / 100).toFixed(2)}`)];
  return lines.join("\r\n") + "\r\n";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "September 2026" -> OK-SalesTax-Sep2026-Import.csv */
export function importFilename(periodLabel: string): string {
  const m = periodLabel.match(/^([A-Za-z]+)\s+(\d{4})$/);
  const part =
    m && MONTHS.includes(m[1]) ? `${m[1].slice(0, 3)}${m[2]}` : periodLabel.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `OK-SalesTax-${part}-Import.csv`;
}

/** Normalize a COPO code from a table or upload: "115" -> "0115". Null if it isn't 1-4 digits. */
export function normalizeCopo(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/^'/, "");
  return /^\d{1,4}$/.test(s) ? s.padStart(4, "0") : null;
}

export { countyKey };
