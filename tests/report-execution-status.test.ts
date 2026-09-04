import assert from "node:assert/strict";
import test from "node:test";
import { deriveReportExecutionStatus, isTerminalReportExecutionStatus } from "../src/lib/report-execution-status";

test("scheduled execution stays queued while every selected module is waiting", () => {
  assert.equal(deriveReportExecutionStatus(["queued", "queued", "not_selected"]), "queued");
});

test("scheduled execution runs while a module is active or another has finished", () => {
  assert.equal(deriveReportExecutionStatus(["running", "queued"]), "running");
  assert.equal(deriveReportExecutionStatus(["completed", "queued"]), "running");
});

test("scheduled execution distinguishes terminal outcomes", () => {
  assert.equal(deriveReportExecutionStatus(["completed", "completed"]), "completed");
  assert.equal(deriveReportExecutionStatus(["completed", "failed"]), "partial");
  assert.equal(deriveReportExecutionStatus(["failed", "blocked"]), "failed");
  assert.equal(deriveReportExecutionStatus(["blocked", "blocked"]), "blocked");
  assert.equal(isTerminalReportExecutionStatus("queued"), false);
  assert.equal(isTerminalReportExecutionStatus("running"), false);
  assert.equal(isTerminalReportExecutionStatus("partial"), true);
});
