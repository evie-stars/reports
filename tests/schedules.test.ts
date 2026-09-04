import assert from "node:assert/strict";
import test from "node:test";
import { daysInUtcMonth, effectiveScheduleDay, nextScheduleDate, scheduleIsDue } from "../src/lib/schedules";

test("schedule days beyond the month's end are clamped to the last day", () => {
  assert.equal(daysInUtcMonth(2026, 1), 28);
  assert.equal(daysInUtcMonth(2028, 1), 29);
  assert.equal(effectiveScheduleDay(31, 2026, 1), 28);
  assert.equal(effectiveScheduleDay(31, 2026, 3), 30);
  assert.equal(effectiveScheduleDay(15, 2026, 1), 15);
});

test("a schedule on the 31st is due on the last day of February", () => {
  assert.equal(scheduleIsDue(31, new Date("2026-02-27T12:00:00.000Z")), false);
  assert.equal(scheduleIsDue(31, new Date("2026-02-28T12:00:00.000Z")), true);
  assert.equal(scheduleIsDue(10, new Date("2026-02-09T12:00:00.000Z")), false);
  assert.equal(scheduleIsDue(10, new Date("2026-02-10T00:00:00.000Z")), true);
});

test("the next scheduled date rolls into the following month and respects month length", () => {
  assert.equal(nextScheduleDate(31, new Date("2026-01-31T13:00:00.000Z")).toISOString(), "2026-02-28T12:00:00.000Z");
  assert.equal(nextScheduleDate(5, new Date("2026-03-04T09:00:00.000Z")).toISOString(), "2026-03-05T12:00:00.000Z");
  assert.equal(nextScheduleDate(5, new Date("2026-03-05T13:00:00.000Z")).toISOString(), "2026-04-05T12:00:00.000Z");
});
