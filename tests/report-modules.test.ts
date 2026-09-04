import assert from "node:assert/strict";
import test from "node:test";
import { enabledRankSearchTypes, hasRankTracking } from "../src/lib/report-modules";

test("builds rank search types from independently selected SEO and Maps modules", () => {
  assert.deepEqual(enabledRankSearchTypes(["rankings"], ["organic"]), ["organic"]);
  assert.deepEqual(enabledRankSearchTypes(["maps"], ["maps"]), ["maps"]);
  assert.deepEqual(enabledRankSearchTypes(["rankings", "maps"], ["organic", "maps"]), ["organic", "maps"]);
  assert.equal(hasRankTracking(["gsc"]), false);
  assert.equal(hasRankTracking(["maps"]), true);
});

test("preserves legacy Maps schedules until report content is explicitly saved", () => {
  assert.deepEqual(enabledRankSearchTypes(["rankings", "gsc"], ["organic", "maps"]), ["organic", "maps"]);
});
