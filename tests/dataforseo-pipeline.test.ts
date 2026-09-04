import assert from "node:assert/strict";
import test from "node:test";
import { DataForSeoClient } from "../src/lib/dataforseo";
import { estimateRankRunCost } from "../src/lib/dataforseo-costs";
import { readKeywordMetrics } from "../src/lib/keyword-metrics";
import { buildRankMatrix } from "../src/components/rank-matrix";
import { countPositionBuckets } from "../src/lib/client-report";
import { readTaskState } from "../src/lib/dataforseo-response";

test("estimates Standard SERP pages before a report is queued", () => {
  const cost = estimateRankRunCost({
    keywordCount: 2,
    locationCount: 1,
    devices: ["desktop", "mobile"],
    searchTypes: ["organic", "maps"],
    pageLimit: 10
  }, "standard");

  assert.equal(cost, 0.0264);
});

test("keeps every paid endpoint blocked until explicitly enabled", () => {
  const client = new DataForSeoClient({
    DATAFORSEO_SANDBOX: "true",
    DATAFORSEO_LIVE_ENABLED: "false",
    DATAFORSEO_MAX_LIVE_TASKS_PER_RUN: "1",
    DATAFORSEO_MAX_STANDARD_TASKS_PER_RUN: "1000",
    DATAFORSEO_KEYWORD_METRICS_ENABLED: "false"
  });

  assert.throws(() => client.assertStandardTaskCount(1), /Paid DataForSEO calls are blocked/);
  assert.throws(() => client.assertKeywordMetricsEnabled(), /Paid DataForSEO calls are blocked/);
});

test("recognises pending, failed, and completed Standard task responses", () => {
  assert.deepEqual(
    readTaskState({ tasks: [{ status_code: 40602, status_message: "Task In Queue", result: null }] }, 200),
    { kind: "pending", message: "Task In Queue" }
  );
  assert.deepEqual(
    readTaskState({ tasks: [{ status_code: 40501, status_message: "Invalid Field", result: null }] }, 200),
    { kind: "failed", message: "Invalid Field" }
  );
  assert.deepEqual(
    readTaskState({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] }, 200),
    { kind: "ready" }
  );
  assert.deepEqual(
    readTaskState({ status_code: 40100, status_message: "Authentication failed", tasks: null }, 200),
    { kind: "failed", message: "Authentication failed" }
  );
});

test("parses search volume, CPC, competition, and monthly trends", () => {
  const monthlySearches = [
    { year: 2026, month: 7, search_volume: 210 },
    { year: 2026, month: 8, search_volume: 260 }
  ];
  const metrics = readKeywordMetrics({
    tasks: [{
      result: [{
        keyword: "scaffolding chester",
        location_name: "Chester, England, United Kingdom",
        search_volume: 260,
        cpc: 2.45,
        competition: 0.42,
        monthly_searches: monthlySearches
      }]
    }]
  });

  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].keyword, "scaffolding chester");
  assert.equal(metrics[0].searchVolume, 260);
  assert.equal(metrics[0].cpc, 2.45);
  assert.equal(metrics[0].competition, 0.42);
  assert.deepEqual(metrics[0].monthlySearches, monthlySearches);
});

test("groups result types and devices into one ranking row per keyword and area", () => {
  const base = {
    projectId: "project-1",
    projectName: "Main Website",
    keywordId: "keyword-1",
    keyword: "builder cheshire",
    locationId: "location-1",
    location: "Chester",
    previousRank: null,
    direction: null,
    matchedUrl: null
  };
  const matrix = buildRankMatrix([
    { ...base, id: "organic-desktop", searchType: "organic", device: "desktop", rank: 8 },
    { ...base, id: "organic-mobile", searchType: "organic", device: "mobile", rank: 10 },
    { ...base, id: "maps-desktop", searchType: "maps", device: "desktop", rank: 2 }
  ]);

  assert.equal(matrix.rows.length, 1);
  assert.deepEqual(matrix.columns.map((column) => column.key), ["organic:desktop", "organic:mobile", "maps:desktop"]);
  assert.equal(matrix.rows[0].cells["maps:desktop"].rank, 2);
});

test("counts keyword positions in the correct distribution bands", () => {
  assert.deepEqual(countPositionBuckets([1, 2, 3, 4, 10, 11, 20, 21, 30, 31, null]), {
    first: 1,
    twoToThree: 2,
    fourToTen: 2,
    elevenToTwenty: 2,
    twentyOneToThirty: 2,
    beyondThirty: 2
  });
});
