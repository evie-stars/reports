import type { RankDirection } from "@prisma/client";

/** DataForSEO task status codes that mean "not ready yet" rather than "failed". */
const PENDING_TASK_CODES = new Set([40601, 40602]);

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

export function errorMessage(error: unknown, fallback = "Unknown failure.") {
  return error instanceof Error ? error.message : fallback;
}

/** An error that applies to the whole response: an HTTP failure or a root-level DataForSEO error. */
export function readRootError(responseBody: unknown, statusCode: number) {
  if (statusCode >= 400) return `HTTP ${statusCode} returned by DataForSEO.`;
  const body = asRecord(responseBody);
  const rootCode = numberValue(body?.status_code);
  if (rootCode && rootCode >= 40000) return stringValue(body?.status_message) ?? `DataForSEO status ${rootCode}.`;
  return null;
}

/** The first error anywhere in the response, used when a response carries a single task. */
export function getDataForSeoError(responseBody: unknown, statusCode: number) {
  const rootError = readRootError(responseBody, statusCode);
  if (rootError) return rootError;

  const tasks = asRecord(responseBody)?.tasks;
  if (!Array.isArray(tasks)) return null;
  for (const task of tasks) {
    const item = asRecord(task);
    const code = numberValue(item?.status_code);
    if (code === undefined || PENDING_TASK_CODES.has(code)) continue;
    if (code >= 40000) return stringValue(item?.status_message) ?? `DataForSEO task status ${code}.`;
  }
  return null;
}

export type TaskState =
  | { kind: "pending"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "ready" };

export function readTaskState(body: unknown, statusCode: number): TaskState {
  const rootError = readRootError(body, statusCode);
  if (rootError) return { kind: "failed", message: rootError };
  const tasks = asRecord(body)?.tasks;
  const item = Array.isArray(tasks) ? asRecord(tasks[0]) : undefined;
  const code = numberValue(item?.status_code);
  if (code !== undefined && PENDING_TASK_CODES.has(code)) {
    return { kind: "pending", message: stringValue(item?.status_message) ?? "Waiting for DataForSEO." };
  }
  if (code && code >= 40000) {
    return { kind: "failed", message: stringValue(item?.status_message) ?? `DataForSEO status ${code}.` };
  }
  if (item?.result === null || item?.result === undefined) {
    return { kind: "pending", message: stringValue(item?.status_message) ?? "Waiting for DataForSEO." };
  }
  return { kind: "ready" };
}

export type PostedTask = {
  id?: string;
  /** DataForSEO echoes the request `tag` inside `data`, which is how a posted task is matched back. */
  tag?: string;
  error: string | null;
};

export function readPostedTasks(body: unknown): PostedTask[] {
  const tasks = asRecord(body)?.tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.map((task) => {
    const item = asRecord(task);
    const data = asRecord(item?.data);
    const code = numberValue(item?.status_code);
    return {
      id: stringValue(item?.id),
      tag: stringValue(data?.tag),
      error: code && code >= 40000 ? stringValue(item?.status_message) ?? `DataForSEO status ${code}.` : null
    };
  });
}

export type ReconciledTask<T> = { task: T; externalTaskId: string | null; failure: string | null };

/**
 * Bind each request we sent to the task DataForSEO created for it.
 *
 * Matching is by the unique `tag` we attached to each request, never by array position:
 * if DataForSEO reorders, drops, or partially rejects a batch, every task still lands
 * against the keyword and area it was posted for.
 */
export function reconcilePostedTasks<T extends { tag: string }>(
  tasks: T[],
  posted: PostedTask[],
  rootError: string | null
): ReconciledTask<T>[] {
  const byTag = new Map<string, PostedTask>();
  for (const item of posted) {
    if (item.tag && !byTag.has(item.tag)) byTag.set(item.tag, item);
  }

  return tasks.map((task) => {
    if (rootError) return { task, externalTaskId: null, failure: rootError };
    const match = task.tag ? byTag.get(task.tag) : undefined;
    if (!match) return { task, externalTaskId: null, failure: "DataForSEO did not acknowledge this task in its response." };
    if (match.error) return { task, externalTaskId: null, failure: match.error };
    if (!match.id) return { task, externalTaskId: null, failure: "DataForSEO did not return a task ID." };
    return { task, externalTaskId: match.id, failure: null };
  });
}

export function readCost(body: unknown) {
  const response = asRecord(body);
  if (!response) return 0;
  if (typeof response.cost === "number") return response.cost;
  if (!Array.isArray(response.tasks)) return 0;
  return response.tasks.reduce<number>((total, task) => total + (numberValue(asRecord(task)?.cost) ?? 0), 0);
}

/** DataForSEO tags are limited to 255 characters and are safest as plain ASCII. */
export function buildDataForSeoTag(...parts: string[]) {
  return parts.map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "-")).join(":").slice(0, 255);
}

export function movementDirection(currentRank: number | null, previousRank: number | null): RankDirection | null {
  if (currentRank === null && previousRank === null) return null;
  if (currentRank === null) return "lost";
  if (previousRank === null) return "new";
  if (currentRank < previousRank) return "up";
  if (currentRank > previousRank) return "down";
  return "unchanged";
}
