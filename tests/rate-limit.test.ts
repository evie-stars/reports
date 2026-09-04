import assert from "node:assert/strict";
import test from "node:test";
import { decideRateLimit, rateLimitKey } from "../src/lib/rate-limit";

const policy = { limit: 3, windowSeconds: 60 };
const now = new Date("2026-09-04T10:00:00.000Z");

test("starts a fresh window when there is no bucket or the window has expired", () => {
  assert.deepEqual(decideRateLimit(null, policy, now), { kind: "reset" });
  assert.deepEqual(decideRateLimit({ count: 99, expiresAt: new Date("2026-09-04T09:59:59.000Z") }, policy, now), { kind: "reset" });
  assert.deepEqual(decideRateLimit({ count: 99, expiresAt: now }, policy, now), { kind: "reset" });
});

test("increments while under the limit and rejects with a retry hint once it is reached", () => {
  const expiresAt = new Date("2026-09-04T10:00:45.500Z");
  assert.deepEqual(decideRateLimit({ count: 2, expiresAt }, policy, now), { kind: "increment" });
  assert.deepEqual(decideRateLimit({ count: 3, expiresAt }, policy, now), { kind: "reject", retryAfterSeconds: 46 });
});

test("bucket keys are scoped and case-insensitive on the identifier", () => {
  assert.equal(rateLimitKey("share", "Evie@Example.com"), rateLimitKey("share", "evie@example.com"));
  assert.notEqual(rateLimitKey("share", "evie@example.com"), rateLimitKey("paid", "evie@example.com"));
  assert.match(rateLimitKey("share", "evie@example.com"), /^[a-f0-9]{64}$/);
});
