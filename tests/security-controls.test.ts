import assert from "node:assert/strict";
import test from "node:test";
import {
  actionRateLimit,
  apiRateLimit,
  configuredPositiveInteger,
  gscImportRateLimit,
  notificationSendRateLimit,
  notificationTestRateLimit,
  paidRunRateLimit,
  secretChangeRateLimit,
  shareRateLimit,
  shareViewRateLimit
} from "../src/lib/rate-limit";
import { workerHealth } from "../src/lib/worker-health";

test("uses conservative default rate-limit policies", () => {
  assert.deepEqual(actionRateLimit(), { limit: 30, windowSeconds: 60 });
  assert.deepEqual(paidRunRateLimit(), { limit: 10, windowSeconds: 3600 });
  assert.deepEqual(shareRateLimit(), { limit: 10, windowSeconds: 3600 });
  assert.deepEqual(gscImportRateLimit(), { limit: 6, windowSeconds: 3600 });
  assert.deepEqual(apiRateLimit(), { limit: 60, windowSeconds: 60 });
  assert.deepEqual(secretChangeRateLimit(), { limit: 10, windowSeconds: 3600 });
  assert.deepEqual(shareViewRateLimit(), { limit: 60, windowSeconds: 60 });
  assert.deepEqual(notificationTestRateLimit(), { limit: 5, windowSeconds: 3600 });
  assert.deepEqual(notificationSendRateLimit(), { limit: 20, windowSeconds: 3600 });
});

test("rejects missing and invalid positive integer configuration", () => {
  const previous = process.env.TEST_POSITIVE_INTEGER;
  try {
    delete process.env.TEST_POSITIVE_INTEGER;
    assert.equal(configuredPositiveInteger("TEST_POSITIVE_INTEGER", 12), 12);
    process.env.TEST_POSITIVE_INTEGER = "0";
    assert.equal(configuredPositiveInteger("TEST_POSITIVE_INTEGER", 12), 12);
    process.env.TEST_POSITIVE_INTEGER = "24";
    assert.equal(configuredPositiveInteger("TEST_POSITIVE_INTEGER", 12), 24);
  } finally {
    if (previous === undefined) delete process.env.TEST_POSITIVE_INTEGER;
    else process.env.TEST_POSITIVE_INTEGER = previous;
  }
});

test("reports healthy, stale, and failed worker states", () => {
  const now = new Date("2026-09-03T10:00:00.000Z");
  assert.deepEqual(workerHealth(null, now), { state: "never", label: "Never run", healthy: false });
  assert.deepEqual(
    workerHealth({ status: "healthy", startedAt: now, lastSuccessAt: new Date("2026-09-03T09:55:00.000Z") }, now),
    { state: "healthy", label: "Healthy", healthy: true }
  );
  assert.deepEqual(
    workerHealth({ status: "healthy", startedAt: now, lastSuccessAt: new Date("2026-09-03T09:30:00.000Z") }, now),
    { state: "stale", label: "Stale", healthy: false }
  );
  assert.deepEqual(
    workerHealth({ status: "failed", startedAt: now, lastSuccessAt: null }, now),
    { state: "failed", label: "Failed", healthy: false }
  );
});
