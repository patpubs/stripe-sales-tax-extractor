import { COUNTY_COPOS, OK_COUNTIES } from "./copo.ts";

/**
 * The Tax Commission's quarterly "Rates and Codes for Sales, Use, and Lodging
 * Tax" chart: every city and county COPO code with its rate, and whether a
 * city's sales also owe county tax (marked ** on the chart).
 */

export type ChartEntry = { code: string; name: string; rate: number; countyTax: boolean };
export type RateChart = { quarter: string; cities: ChartEntry[]; counties: ChartEntry[] };

/** "2026-Q4" for a date, in Oklahoma time. */
export function quarterOf(d = new Date()): { year: number; q: number; label: string } {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "numeric" })
    .formatToParts(d)
    .filter((p) => p.type !== "literal")
    .map((p) => Number(p.value));
  const q = Math.floor((m - 1) / 3) + 1;
  return { year: y, q, label: `${y}-Q${q}` };
}

/** Where the Tax Commission publishes each quarter's chart, e.g. .../2026/copo4Q26.pdf */
export function chartUrl(year: number, q: number): string {
  return (
    "https://oklahoma.gov/content/dam/ok/en/tax/documents/resources/publications/businesses/sales-and-use-tax/" +
    `rate-charts-copos/${year}/copo${q}Q${String(year).slice(-2)}.pdf`
  );
}

const ENTRY = /(?<!\d)(\d{4})\s+([A-Z][A-Z0-9 .'’&/-]*?)\s*(#)?\s*(\*\*)?\s*(\d+(?:\.\d+)?)\s*%/g;

/**
 * Parse the chart from its text, one string per printed line with columns in
 * reading order. The lodging column must already be left out; rate-change
 * notices are skipped because their names aren't uppercase.
 */
export function parseChartLines(lines: string[], quarter: string): RateChart {
  const cities: ChartEntry[] = [];
  const counties: ChartEntry[] = [];
  for (const line of lines) {
    for (const m of line.matchAll(ENTRY)) {
      const [, code, rawName, , star, rate] = m;
      const name = rawName.replace(/\s+/g, " ").trim();
      const entry = { code, name, rate: Number(rate), countyTax: !!star };
      if (code.endsWith("88") && /\bCTY$/.test(name)) counties.push({ ...entry, name: name.replace(/\s*CTY$/, "") });
      else cities.push(entry);
    }
  }
  return { quarter, cities, counties };
}

/** Reasons a parsed chart can't be trusted; empty when it looks complete. */
export function chartProblems(chart: RateChart): string[] {
  const problems: string[] = [];
  const counties = new Map(chart.counties.map((c) => [c.code, c]));
  for (const [i, name] of OK_COUNTIES.entries()) {
    const code = `${String(i + 1).padStart(2, "0")}88`;
    if (!counties.has(code)) problems.push(`${name} County (${code}) is missing`);
  }
  for (const c of chart.counties) {
    if (COUNTY_COPOS.get(c.name.toLowerCase().replace(/\s+/g, " ")) !== c.code &&
        COUNTY_COPOS.get(c.name.toLowerCase().replace(/\s+/g, "")) !== c.code) {
      problems.push(`${c.name} County has code ${c.code}`);
    }
  }
  if (chart.cities.length < 450) problems.push(`only ${chart.cities.length} cities found`);
  const seen = new Set<string>();
  for (const c of chart.cities) {
    const n = Number(c.code.slice(0, 2));
    if (n < 1 || n > 77 || c.code.endsWith("88")) problems.push(`odd city code ${c.code} ${c.name}`);
    if (seen.has(c.code)) problems.push(`code ${c.code} listed twice`);
    seen.add(c.code);
  }
  return problems;
}

type TextItem = { str: string; transform: number[]; width: number };

/** Text lines of each page of the chart PDF, columns in reading order, lodging column dropped. */
export async function chartPdfLines(pdf: Uint8Array): Promise<string[]> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(pdf);
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const items = ((await page.getTextContent()).items as TextItem[]).filter((i) => i.str?.trim());
    const lodging = items.find((i) => /LODGING/.test(i.str));
    // The lodging column starts at its header ("CITY/COUNTY LODGING" may be one item or several).
    const cut = lodging ? Math.min(...items.filter((i) => /CITY\/COUNTY/.test(i.str) || i === lodging).map((i) => i.transform[4])) - 5 : Infinity;
    const rows = new Map<number, TextItem[]>();
    for (const i of items) {
      if (i.transform[4] >= cut) continue;
      const y = Math.round(i.transform[5] / 2) * 2;
      rows.set(y, [...(rows.get(y) ?? []), i]);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const row = rows.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]);
      lines.push(row.map((i) => i.str).join("  "));
    }
  }
  return lines;
}
