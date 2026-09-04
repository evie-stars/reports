import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDataForSeoTag,
  getDataForSeoError,
  movementDirection,
  readCost,
  readPostedTasks,
  readRootError,
  reconcilePostedTasks
} from "../src/lib/dataforseo-response";

const posted = (tag: string, id: string, extra: Record<string, unknown> = {}) => ({
  id,
  status_code: 20100,
  status_message: "Task Created.",
  data: { tag },
  ...extra
});

test("binds posted tasks by tag even when DataForSEO reorders or drops them", () => {
  const tasks = [{ id: "a", tag: "run:kw1:loc1" }, { id: "b", tag: "run:kw2:loc1" }, { id: "c", tag: "run:kw3:loc1" }];
  const body = { status_code: 20000, tasks: [posted("run:kw3:loc1", "ext-3"), posted("run:kw1:loc1", "ext-1")] };

  const result = reconcilePostedTasks(tasks, readPostedTasks(body), readRootError(body, 200));

  assert.deepEqual(result.map((item) => [item.task.id, item.externalTaskId, item.failure]), [
    ["a", "ext-1", null],
    ["c", "ext-3", null],
    ["b", null, "DataForSEO did not acknowledge this task in its response."]
  ].sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
});

test("a rejected task fails alone instead of failing the whole batch", () => {
  const tasks = [{ id: "a", tag: "t1" }, { id: "b", tag: "t2" }];
  const body = {
    status_code: 20000,
    tasks: [posted("t1", "ext-1"), { id: "ext-2", status_code: 40501, status_message: "Invalid Field", data: { tag: "t2" } }]
  };

  const result = reconcilePostedTasks(tasks, readPostedTasks(body), readRootError(body, 200));
  assert.deepEqual(result.map((item) => item.failure), [null, "Invalid Field"]);
  assert.equal(readRootError(body, 200), null);
  assert.equal(getDataForSeoError(body, 200), "Invalid Field");
});

test("a root-level failure applies to every task", () => {
  const tasks = [{ id: "a", tag: "t1" }];
  const body = { status_code: 40100, status_message: "Authentication failed", tasks: null };
  assert.deepEqual(reconcilePostedTasks(tasks, readPostedTasks(body), readRootError(body, 200)), [
    { task: tasks[0], externalTaskId: null, failure: "Authentication failed" }
  ]);
  assert.equal(readRootError({}, 503), "HTTP 503 returned by DataForSEO.");
});

test("a posted task without an id cannot be collected later", () => {
  const tasks = [{ id: "a", tag: "t1" }];
  const body = { status_code: 20000, tasks: [{ status_code: 20100, data: { tag: "t1" } }] };
  assert.equal(reconcilePostedTasks(tasks, readPostedTasks(body), null)[0].failure, "DataForSEO did not return a task ID.");
});

test("reads cost from the root or sums task costs", () => {
  assert.equal(readCost({ cost: 0.0012 }), 0.0012);
  assert.equal(readCost({ tasks: [{ cost: 0.0006 }, { cost: 0.0006 }, { cost: "n/a" }] }), 0.0012);
  assert.equal(readCost(null), 0);
});

test("tags are sanitised and capped at DataForSEO's limit", () => {
  assert.equal(buildDataForSeoTag("client 1", "project/2", "organic"), "client-1:project-2:organic");
  assert.equal(buildDataForSeoTag("x".repeat(300)).length, 255);
});

test("movement direction covers new, lost, and unchanged rankings", () => {
  assert.equal(movementDirection(null, null), null);
  assert.equal(movementDirection(null, 4), "lost");
  assert.equal(movementDirection(4, null), "new");
  assert.equal(movementDirection(2, 5), "up");
  assert.equal(movementDirection(7, 5), "down");
  assert.equal(movementDirection(5, 5), "unchanged");
});
