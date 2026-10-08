import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, csvLine, cents } from "../src/lib/csv.ts";

test("csv escaping", () => {
  assert.equal(csvCell('He said "hi", ok'), '"He said ""hi"", ok"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("-12.50"), "-12.50");
  assert.equal(csvLine(["a", 1, "b,c"]), 'a,1,"b,c"\r\n');
  assert.equal(cents(123456), "1234.56");
});
