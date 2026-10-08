import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCity, cleanZip, similarity } from "../src/lib/filings/oklahoma/clean.ts";
import { buildFiling, emptyOverrides, importCsv, importFilename, normalizeCopo, type OkSale, type OkTables } from "../src/lib/filings/oklahoma/copo.ts";

test("city cleaning", () => {
  const cases: [string, string][] = [
    ["Duncan", "duncan"],
    ["duncan ok 73533", "duncan"],
    ["Ok - Tulsa", "tulsa"],
    ["Ok – Tulsa", "tulsa"],
    ["PO Box 68 Harrah", "harrah"],
    ["P.O. Box 12 Harrah", "harrah"],
    ["DEL CITY", "del city"],
    ["Webber’s Fall’s", "webber's fall's"],
    ["Skiatook", "skiatook"],
    ["Muskogee,", "muskogee"],
    ["Oktaha ok", "oktaha"],
    ["Pocasset ok", "pocasset"],
    ["Tulsa, Oklahoma", "tulsa"],
    ["Norman, OK", "norman"],
    ["(Ada)", "ada"],
    ["  hominy  ", "hominy"],
  ];
  for (const [raw, want] of cases) assert.equal(cleanCity(raw), want, raw);
});

test("zip cleaning", () => {
  assert.equal(cleanZip("740215219"), "74021");
  assert.equal(cleanZip("73099-4148"), "73099");
  assert.equal(cleanZip("7300i"), "7300");
  assert.equal(cleanZip("740565282150007861686"), "74056");
  assert.equal(cleanZip("7422"), "7422");
  assert.equal(cleanZip(null), "");
});

test("fuzzy similarity ranks typos high", () => {
  assert.ok(similarity("andarko", "anadarko") >= 0.9);
  assert.ok(similarity("tulsà", "tulsa") === 1);
  assert.ok(similarity("norman", "newcastle") < 0.7);
});

// Small fixture in the shape of the real tables.
const tables: OkTables = {
  copos: new Set(["0921", "0988", "1411", "1421", "1488", "5521", "5588", "0801", "0888", "6201", "6288", "6488"]),
  counties: new Map([["canadian", "0988"], ["cleveland", "1488"], ["oklahoma", "5588"], ["caddo", "0888"], ["pontotoc", "6288"], ["pushmataha", "6488"]]),
  cities: new Map([
    ["oklahoma city", ["5521", "0921", "1421"]],
    ["norman", ["1411"]],
    ["anadarko", ["0801"]],
    ["ada", ["6201"]],
  ]),
  zips: new Map([["73160", "cleveland"], ["73102", "oklahoma"], ["73099", "canadian"], ["74820", "pontotoc"]]),
  towns: new Map([["tuskahoma", "pushmataha"]]),
};

const sale = (id: string, city: string, zip: string, net: number): OkSale => ({ id, city, zip, net, customer: null });

test("filing: city + county rows, multi-county by zip, towns, fuzzy, zip fallback, unmapped", () => {
  const f = buildFiling(
    [
      sale("a", "Oklahoma City", "73160", 1000), // Cleveland part of OKC -> 1421 + 1488
      sale("b", "oklahoma city ok 73102", "73102", 500), // 5521 + 5588
      sale("c", "Norman", "73071", 250), // 1411 + 1488
      sale("d", "Andarko", "", 300), // fuzzy -> anadarko 0801 + 0888
      sale("e", "Tuskahoma", "", 700), // town -> 6488 only
      sale("f", "Somewhere", "74820", 400), // zip -> 6288 only
      sale("g", "Nowhere", "", 90), // unmapped
      sale("h", "Ada", "74820", 0), // zero net still maps
    ],
    tables,
  );
  const byId = Object.fromEntries(f.sales.map((s) => [s.id, s.resolution.kind]));
  assert.deepEqual(byId, { a: "city", b: "city", c: "city", d: "fuzzy", e: "town", f: "zip", g: "unmapped", h: "city" });
  assert.deepEqual(f.totals, [
    ["0801", 300],
    ["0888", 300],
    ["1411", 250],
    ["1421", 1000],
    ["1488", 1250],
    ["5521", 500],
    ["5588", 500],
    ["6288", 400],
    ["6488", 700],
  ]);
  assert.equal(f.expected, 3240);
  assert.equal(f.cityTotal, 2050);
  assert.equal(f.countyOnlyTotal, 1100);
  assert.equal(f.unmappedTotal, 90);
  assert.ok(f.balanced);
  assert.equal(f.openItems, 3);
  assert.equal(importCsv(f).split("\r\n")[0], "Copo,CoPoNetTaxSales");
  assert.equal(importCsv(f).split("\r\n")[1], "0801,3.00");
});

test("multi-county city with unusable zip defaults to its first code", () => {
  const f = buildFiling([sale("a", "Oklahoma City", "7300i", 100)], tables);
  const r = f.sales[0].resolution;
  assert.equal(r.kind, "city");
  assert.equal(r.kind === "city" && r.cityCopo, "5521");
  assert.ok(r.kind === "city" && r.note);
});

test("overrides: rejected fuzzy falls through, skipped leaves the file, accepted closes the item", () => {
  const o = emptyOverrides();
  o.rejected.add("andarko");
  o.skipped.add("g");
  o.accepted.add("f");
  const f = buildFiling([sale("d", "Andarko", "", 300), sale("f", "Somewhere", "74820", 400), sale("g", "Nowhere", "", 90)], tables, o);
  assert.deepEqual(f.sales.map((s) => s.resolution.kind), ["unmapped", "zip", "skipped"]);
  assert.equal(f.skippedTotal, 90);
  assert.equal(f.openItems, 1);
  assert.ok(f.balanced);
});

test("codes missing from the base template are not written", () => {
  const t = { ...tables, cities: new Map([...tables.cities, ["ghost", ["9901"]]]) };
  const f = buildFiling([sale("a", "Ghost", "", 100)], t);
  assert.equal(f.sales[0].resolution.kind, "unmapped");
  assert.equal(f.totals.length, 0);
});

test("filename and code normalization", () => {
  assert.equal(importFilename("September 2026"), "OK-SalesTax-Sep2026-Import.csv");
  assert.equal(importFilename("Sep 1 – Sep 15, 2026"), "OK-SalesTax-Sep-1-Sep-15-2026-Import.csv");
  assert.equal(normalizeCopo("115"), "0115");
  assert.equal(normalizeCopo(5521), "5521");
  assert.equal(normalizeCopo("abc"), null);
});

import { parseBaseCopos, parseTablesJson } from "../src/lib/filings/oklahoma/upload.ts";

test("base COPO template parsing", () => {
  const rows = parseBaseCopos('﻿Copo,Jurisdiction\r\n115,"Stilwell, City"\r\n0188,Adair County\r\n0188,dup\r\n');
  assert.deepEqual(rows, [{ code: "0115", name: "Stilwell, City" }, { code: "0188", name: "Adair County" }]);
  assert.deepEqual(parseBaseCopos("5521\n5588\n").map((r) => r.code), ["5521", "5588"]);
});

test("lookup tables JSON import", () => {
  const t = parseTablesJson(JSON.stringify({
    city_copo: { "Oklahoma City": ["5521", "921"], ada: "6201", bad: ["x"] },
    zip_county_map: { "73160": "Cleveland County", "12": "x" },
    county_copo: { Oklahoma: "5588", Bad: "5521" },
    city_to_county_fallback: { Newalla: "Oklahoma" },
    valid_copos: ["5521", 921],
  }));
  assert.deepEqual(t.cities, [{ city: "oklahoma city", copos: ["5521", "0921"] }, { city: "ada", copos: ["6201"] }]);
  assert.deepEqual(t.zips, [{ zip: "73160", county: "cleveland" }]);
  assert.deepEqual(t.counties, [{ name: "oklahoma", copo: "5588" }]);
  assert.deepEqual(t.towns, [{ town: "newalla", county: "oklahoma" }]);
  assert.deepEqual(t.copos.map((c) => c.code), ["5521", "0921"]);
  assert.equal(t.problems.length, 3);
});
