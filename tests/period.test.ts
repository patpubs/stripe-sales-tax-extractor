import { test } from "node:test";
import assert from "node:assert/strict";
import { monthPeriod, customPeriod, localMidnightUtc } from "../src/lib/period.ts";
import { normalizeState } from "../src/lib/states.ts";

test("month period in Chicago (CDT)", () => {
  const p = monthPeriod(2026, 9, "America/Chicago");
  assert.equal(p.start.toISOString(), "2026-09-01T05:00:00.000Z");
  assert.equal(p.end.toISOString(), "2026-10-01T05:00:00.000Z");
  assert.equal(p.label, "September 2026");
});

test("month period spanning DST end", () => {
  const p = monthPeriod(2026, 11, "America/Chicago");
  assert.equal(p.start.toISOString(), "2026-11-01T05:00:00.000Z");
  assert.equal(p.end.toISOString(), "2026-12-01T06:00:00.000Z");
});

test("December rolls into next year", () => {
  const p = monthPeriod(2026, 12, "UTC");
  assert.equal(p.start.toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal(p.end.toISOString(), "2027-01-01T00:00:00.000Z");
});

test("custom range is inclusive of the end day", () => {
  const p = customPeriod("2026-03-01", "2026-03-31", "America/New_York");
  assert.equal(p.start.toISOString(), "2026-03-01T05:00:00.000Z");
  assert.equal(p.end.toISOString(), "2026-04-01T04:00:00.000Z");
});

test("custom range rejects reversed dates", () => {
  assert.throws(() => customPeriod("2026-03-02", "2026-03-01", "UTC"));
});

test("local midnight on DST start day", () => {
  assert.equal(localMidnightUtc(2026, 3, 8, "America/Chicago").toISOString(), "2026-03-08T06:00:00.000Z");
});

test("state normalization", () => {
  assert.equal(normalizeState("OK"), "OK");
  assert.equal(normalizeState(" oklahoma "), "OK");
  assert.equal(normalizeState("Okla."), "OK");
  assert.equal(normalizeState("new  york"), "NY");
  assert.equal(normalizeState("Ontario"), null);
  assert.equal(normalizeState(""), null);
  assert.equal(normalizeState(null), null);
});
