import assert from "node:assert/strict";
import test from "node:test";
import { reportSnapshotSlug, reportSnapshotStatus } from "../src/lib/report-snapshot";

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
