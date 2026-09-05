import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { emptyGa4Report, readReportSnapshot, reportSnapshotSlug, reportSnapshotStatus } from "../src/lib/report-snapshot";

test("creates recognizable, URL-safe client snapshot slugs", () => {
  assert.equal(reportSnapshotSlug("LPB Building & Roofing Ltd."), "lpb-building-roofing-ltd");
  assert.equal(reportSnapshotSlug("  £££  "), "client-report");
});

test("distinguishes active, expired, and revoked snapshots", () => {
  const now = new Date("2026-09-04T10:00:00.000Z");
  assert.equal(reportSnapshotStatus({ expiresAt: new Date("2026-09-05T10:00:00.000Z"), revokedAt: null }, now), "active");
  assert.equal(reportSnapshotStatus({ expiresAt: new Date("2026-09-03T10:00:00.000Z"), revokedAt: null }, now), "expired");
  assert.equal(reportSnapshotStatus({ expiresAt: new Date("2026-09-05T10:00:00.000Z"), revokedAt: now }, now), "revoked");
});


/** The shape buildReportSnapshot wrote before the Analytics module existed: no `ga4` block at all. */
function legacySnapshotPayload(modulesOverride?: Record<string, boolean>) {
  const rankStats = { activeKeywords: 0, topThree: 0, pageOne: 0, topTwenty: 0, averageRank: null, improved: 0, declined: 0, newRankings: 0, issues: 0 };
  const gsc = {
    mapped: true,
    latestDataDate: "2026-08-30",
    lastImportedAt: "2026-08-31T09:00:00.000Z",
    stats: { clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
    trend: [{ date: "2026-08-30", label: "30 Aug", clicks: 10, impressions: 100, ctr: 0.1, position: 4 }]
  };
  return {
    version: 1,
    clientName: "Legacy Client",
    generatedAt: "2026-08-31T09:00:00.000Z",
    modules: ["rankings", "gsc"],
    base: {
      options: { projects: [], areas: [], groups: [] },
      filters: { section: "overview", period: "90", sort: "current", sortDirection: "asc" },
      latestResults: [],
      keywordHistory: [],
      selectedKeyword: null,
      trend: [],
      stats: rankStats,
      gsc,
      modules: modulesOverride ?? { rankings: true, seo: true, maps: false, gsc: true, ga4: false }
    },
    sections: { seo: { latestResults: [], stats: rankStats, trend: [] } }
  } as unknown as Prisma.JsonValue;
}

test("snapshots stored before the Analytics module read back with an empty Analytics block", () => {
  const withFlag = readReportSnapshot(legacySnapshotPayload());
  assert.deepEqual(withFlag.report.ga4, emptyGa4Report());
  assert.equal(withFlag.report.modules.ga4, false);
  assert.equal(withFlag.report.gsc.mapped, true);

  const withoutFlag = readReportSnapshot(legacySnapshotPayload({ rankings: true, seo: true, maps: false, gsc: true }));
  assert.equal(withoutFlag.report.modules.ga4, false);
  assert.deepEqual(withoutFlag.report.ga4, emptyGa4Report());

  const seoSection = readReportSnapshot(legacySnapshotPayload(), "seo");
  assert.equal(seoSection.report.filters.section, "seo");
  assert.deepEqual(seoSection.report.ga4, emptyGa4Report());
});

test("the maps view of a snapshot never carries Search Console or Analytics data", () => {
  const payload = legacySnapshotPayload() as { base: Record<string, unknown>; sections: Record<string, unknown> };
  payload.base.ga4 = { ...emptyGa4Report(), mapped: true, trend: [{ date: "2026-08-30", label: "30 Aug", sessions: 5, activeUsers: 4, newUsers: 2, keyEvents: 1 }] };
  payload.base.modules = { rankings: true, seo: true, maps: true, gsc: true, ga4: true };
  payload.sections = { ...payload.sections, maps: { latestResults: [], stats: (payload.base as { stats: unknown }).stats, trend: [] } };

  const overview = readReportSnapshot(payload as unknown as Prisma.JsonValue);
  assert.equal(overview.report.ga4.mapped, true);
  assert.equal(overview.report.modules.ga4, true);

  const maps = readReportSnapshot(payload as unknown as Prisma.JsonValue, "maps");
  assert.equal(maps.report.filters.section, "maps");
  assert.equal(maps.report.ga4.mapped, false);
  assert.equal(maps.report.gsc.mapped, false);
});
