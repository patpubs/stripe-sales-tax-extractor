/**
 * Normalize a customer-typed city for COPO lookup. The steps and their order
 * follow the monthly process this replaces; see the examples in
 * tests/oklahoma.test.ts.
 */
export function cleanCity(raw: string | null | undefined): string {
  let s = (raw ?? "").toLowerCase().trim();
  s = s.replace(/^["']+|["']+$/g, "").trim();
  s = s.replace(/[‘’]/g, "'");
  s = s.replace(/^[([]+/, "").replace(/[)\]]+$/, "");
  s = s.replace(/[,.\s]+$/, "");
  s = s.replace(/^ok\s*[-–—]\s*/, "");
  const poBox = s.match(/^p\.?\s*o\.?\s*box\s+\S+\s+(.+)$/);
  if (poBox) s = poBox[1];
  // Trailing state names. "\s+ok" needs the space so Skiatook, Muskogee,
  // Checotah etc. keep their "ok".
  s = s.replace(/\s+oklahoma\s*,?\s*(\d{5}(-\d{4})?)?\s*$/, "");
  s = s.replace(/,\s*oklahoma\s*$/, "");
  s = s.replace(/[\s,]+ok\s*,?\s*(\d{5}(-\d{4})?)?\s*$/, "");
  s = s.replace(/\s+\d{5}\s*$/, "");
  s = s.replace(/[,.\s]+$/, "");
  return s.replace(/\s+/g, " ");
}

/** First five digits of a zip, ignoring ZIP+4 and junk. Shorter results are kept but won't match anything. */
export function cleanZip(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/["'\s]/g, "").split("-")[0];
  return s.replace(/\D/g, "").slice(0, 5);
}

/** County key: "Oklahoma County" and "oklahoma" both become "oklahoma". */
export function countyKey(name: string): string {
  return name.toLowerCase().replace(/\s+county\s*$/, "").replace(/\s+/g, " ").trim();
}

/** Accent-insensitive key for fuzzy comparison ("Tulsà" vs "tulsa"). */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Jaro-Winkler similarity, 0..1. */
export function similarity(a: string, b: string): number {
  a = fold(a);
  b = fold(b);
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array<boolean>(a.length).fill(false);
  const bHit = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = bHit[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Best matches for `city` among `candidates`, highest first. Spaces are ignored ("brokenarrow"). */
export function closestCities(city: string, candidates: Iterable<string>, limit = 3): { city: string; score: number }[] {
  if (!city) return [];
  const squash = (s: string) => s.replace(/[\s'.-]/g, "");
  const out: { city: string; score: number }[] = [];
  for (const c of candidates) {
    out.push({ city: c, score: Math.max(similarity(city, c), similarity(squash(city), squash(c))) });
  }
  return out.sort((x, y) => y.score - x.score || x.city.localeCompare(y.city)).slice(0, limit);
}
