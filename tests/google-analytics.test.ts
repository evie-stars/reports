import assert from "node:assert/strict";
import test from "node:test";
import { buildGa4Report } from "../src/lib/client-report";
import {
  ANALYTICS_METRICS,
  analyticsChannelRequest,
  analyticsDailyTotalsRequest,
  analyticsDateRange,
  GA4_CHANNEL,
  GA4_DAILY_TOTAL,
  GA4_READONLY_SCOPE,
  isAnalyticsPropertyId,
  readAnalyticsRows
} from "../src/lib/google-analytics";
import { buildGoogleAuthorizationUrl } from "../src/lib/google-oauth";

const metricHeaders = ANALYTICS_METRICS.map((name) => ({ name }));

function apiRow(dimensions: string[], metrics: Array<string | number>) {
  return {
    dimensionValues: dimensions.map((value) => ({ value })),
    metricValues: metrics.map((value) => ({ value: String(value) }))
  };
}

test("requests read-only Analytics access with offline consent on the shared Google client", () => {
  const url = buildGoogleAuthorizationUrl("state-value", [GA4_READONLY_SCOPE], {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://reports.example.test/api/integrations/google/callback"
  });

  assert.equal(url.searchParams.get("scope"), `openid email ${GA4_READONLY_SCOPE}`);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.doesNotMatch(url.searchParams.get("scope") ?? "", /analytics\.edit|analytics\.manage/);
});

test("accepts only canonical GA4 property resource names", () => {
  assert.equal(isAnalyticsPropertyId("properties/123456789"), true);
  assert.equal(isAnalyticsPropertyId("123456789"), false);
  assert.equal(isAnalyticsPropertyId("properties/abc"), false);
  assert.equal(isAnalyticsPropertyId("properties/1:runReport"), false);
  assert.equal(isAnalyticsPropertyId("properties/1/../2"), false);
  assert.equal(isAnalyticsPropertyId(null), false);
});

test("builds an inclusive 90-day Analytics range ending yesterday, matching Search Console", () => {
  assert.deepEqual(analyticsDateRange(90, new Date("2026-09-03T15:00:00.000Z")), {
    startDate: "2026-06-05",
    endDate: "2026-09-02"
  });
  assert.throws(() => analyticsDateRange(0), /between 1 and 500/);
});

test("report requests put the date dimension first and ask for the fixed metric list", () => {
  const totals = analyticsDailyTotalsRequest("2026-06-05", "2026-09-02");
  const channels = analyticsChannelRequest("2026-06-05", "2026-09-02");

  assert.deepEqual(totals.dateRanges, [{ startDate: "2026-06-05", endDate: "2026-09-02" }]);
  assert.deepEqual(totals.dimensions, [{ name: "date" }]);
  assert.deepEqual(channels.dimensions, [{ name: "date" }, { name: "sessionDefaultChannelGroup" }]);
  assert.deepEqual(totals.metrics.map((metric) => metric.name), [...ANALYTICS_METRICS]);
  assert.equal(totals.metrics.some((metric) => metric.name === "conversions"), false);
  assert.ok(totals.limit > 90 * 20);
});

test("parses daily totals and channel rows from a runReport response", () => {
  const totals = readAnalyticsRows({
    dimensionHeaders: [{ name: "date" }],
    metricHeaders,
    rows: [apiRow(["20260901"], [120, 95, 40, 70, "3.0"]), apiRow(["20260902"], ["0", "0", "0", "0", "0"])],
    rowCount: 2
  }, { withChannel: false });

  assert.equal(totals.length, 2);
  assert.deepEqual(
    { ...totals[0], raw: undefined },
    { date: "2026-09-01", channel: "", sessions: 120, activeUsers: 95, newUsers: 40, engagedSessions: 70, keyEvents: 3, raw: undefined }
  );

  const channels = readAnalyticsRows({
    dimensionHeaders: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
    metricHeaders,
    rows: [apiRow(["20260901", "Organic Search"], [80, 60, 30, 50, 2]), apiRow(["20260901", "Direct"], [40, 35, 10, 20, 1])],
    rowCount: 2
  }, { withChannel: true });

  assert.deepEqual(channels.map((row) => [row.date, row.channel, row.sessions]), [["2026-09-01", "Organic Search", 80], ["2026-09-01", "Direct", 40]]);
  assert.deepEqual(readAnalyticsRows({ dimensionHeaders: [{ name: "date" }], metricHeaders }, { withChannel: false }), []);
});

test("rejects reports whose columns, dates, values or row counts do not match the request", () => {
  const validRow = apiRow(["20260901"], [1, 1, 1, 1, 1]);

  assert.throws(
    () => readAnalyticsRows({ dimensionHeaders: [{ name: "date" }], metricHeaders: [...metricHeaders].reverse(), rows: [validRow] }, { withChannel: false }),
    /unexpected columns/
  );
  assert.throws(
    () => readAnalyticsRows({ dimensionHeaders: [{ name: "date" }], metricHeaders, rows: [validRow] }, { withChannel: true }),
    /unexpected columns/
  );
  assert.throws(
    () => readAnalyticsRows({ dimensionHeaders: [{ name: "date" }], metricHeaders, rows: [apiRow(["20260931"], [1, 1, 1, 1, 1])] }, { withChannel: false }),
    /invalid Analytics date/
  );
  assert.throws(
    () => readAnalyticsRows({ dimensionHeaders: [{ name: "date" }], metricHeaders, rows: [apiRow(["20260901"], ["-1", 1, 1, 1, 1])] }, { withChannel: false }),
    /invalid Analytics sessions value/
  );
  assert.throws(
    () => readAnalyticsRows({ dimensionHeaders: [{ name: "date" }], metricHeaders, rows: [validRow], rowCount: 3 }, { withChannel: false }),
    /truncated/
  );
  assert.throws(
    () => readAnalyticsRows({
      dimensionHeaders: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
      metricHeaders,
      rows: [apiRow(["20260901", ""], [1, 1, 1, 1, 1])]
    }, { withChannel: true }),
    /invalid Analytics channel/
  );
});

test("combines stored rows across projects without ever summing active users into a period total", () => {
  const day1 = new Date("2026-09-01T00:00:00.000Z");
  const day2 = new Date("2026-09-02T00:00:00.000Z");
  const totalRow = (date: Date, sessions: number, activeUsers: number, newUsers: number, engagedSessions: number, keyEvents: number) => ({
    date, dimension: GA4_DAILY_TOTAL, channel: "", sessions, activeUsers, newUsers, engagedSessions, keyEvents
  });
  const channelRow = (date: Date, channel: string, sessions: number, newUsers: number, keyEvents: number) => ({
    date, dimension: GA4_CHANNEL, channel, sessions, activeUsers: 999, newUsers, engagedSessions: 0, keyEvents
  });

  const report = buildGa4Report(
    [
      totalRow(day1, 100, 80, 30, 60, 2),
      totalRow(day1, 50, 40, 10, 20, 1), // second project, same day
      totalRow(day2, 120, 90, 25, 90, 0),
      channelRow(day1, "Organic Search", 90, 25, 2),
      channelRow(day1, "Direct", 60, 15, 1),
      channelRow(day2, "Organic Search", 70, 20, 0),
      channelRow(day2, "Referral", 50, 5, 0)
    ],
    true,
    new Date("2026-09-03T08:00:00.000Z")
  );

  assert.equal(report.mapped, true);
  assert.equal(report.latestDataDate, "2026-09-02");
  assert.equal(report.stats.sessions, 270);
  assert.equal(report.stats.newUsers, 65);
  assert.equal(report.stats.engagedSessions, 170);
  assert.equal(report.stats.engagementRate, 170 / 270);
  assert.equal(report.stats.keyEvents, 3);
  assert.equal(report.stats.organicSessions, 160);
  assert.equal(report.stats.organicShare, 160 / 270);
  assert.equal("activeUsers" in report.stats, false);
  assert.equal(report.stats.averageDailyActiveUsers, (120 + 90) / 2);

  assert.deepEqual(report.trend.map((point) => [point.date, point.sessions, point.activeUsers]), [["2026-09-01", 150, 120], ["2026-09-02", 120, 90]]);
  assert.deepEqual(report.channels.map((channel) => [channel.channel, channel.sessions, channel.newUsers]), [
    ["Organic Search", 160, 45],
    ["Direct", 60, 15],
    ["Referral", 50, 5]
  ]);
  assert.equal(report.channels.every((channel) => !("activeUsers" in channel)), true);
  assert.ok(Math.abs(report.channels.reduce((total, channel) => total + channel.share, 0) - 1) < 1e-9);

  const empty = buildGa4Report([], false, null);
  assert.equal(empty.stats.engagementRate, null);
  assert.equal(empty.stats.organicShare, null);
  assert.equal(empty.stats.averageDailyActiveUsers, null);
  assert.deepEqual(empty.channels, []);
});
