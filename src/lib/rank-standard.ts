import { Prisma, type RankTask, type SearchType } from "@prisma/client";
import { DataForSeoClient, type DataForSeoApiResponse, type DataForSeoTask } from "@/lib/dataforseo";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import {
  buildDataForSeoTask,
  getDataForSeoError,
  storeRankResultFromResponse,
  type RankRunSelection
} from "@/lib/rank-runner";

const TASK_BATCH_SIZE = 100;

export async function submitStandardRankRun(
  runId: string,
  selection: RankRunSelection,
  pageLimit: number,
  client = new DataForSeoClient()
) {
  const project = await prisma.project.findUnique({
    where: { id: selection.projectId },
    include: {
      keywords: { where: { id: { in: selection.keywordIds }, active: true }, orderBy: { phrase: "asc" } },
      locations: { where: { id: { in: selection.locationIds }, active: true }, orderBy: { name: "asc" } }
    }
  });
  if (!project) throw new Error("Report not found.");
  if (project.keywords.length === 0 || project.locations.length === 0) {
    throw new Error("A Standard report needs at least one active keyword and area.");
  }

  const requestedTasks = project.keywords.length * project.locations.length * selection.devices.length * selection.searchTypes.length;
  client.assertStandardTaskCount(requestedTasks);

  const existingTasks = await prisma.rankTask.count({ where: { runId } });
  if (existingTasks > 0) return refreshStandardRun(runId);

  const taskInputs = project.keywords.flatMap((keyword) =>
    project.locations.flatMap((location) =>
      selection.devices.flatMap((device) =>
        selection.searchTypes.map((searchType) => {
          const tag = buildStandardTag(project.clientId, project.id, runId, keyword.id, location.id, searchType, device);
          const requestBody = buildDataForSeoTask(
            keyword.phrase,
            project.domain,
            location,
            device,
            searchType,
            "live",
            pageLimit,
            tag
          );
          return { keywordId: keyword.id, locationId: location.id, device, searchType, requestBody };
        })
      )
    )
  );

  await prisma.$transaction([
    prisma.rankRun.update({
      where: { id: runId },
      data: {
        status: "running",
        deliveryMethod: "standard",
        startedAt: new Date(),
        requestedTasks,
        submittedTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        lastError: null
      }
    }),
    prisma.rankTask.createMany({
      data: taskInputs.map((task) => ({
        runId,
        keywordId: task.keywordId,
        locationId: task.locationId,
        device: task.device,
        searchType: task.searchType,
        requestBody: task.requestBody as Prisma.InputJsonValue
      }))
    })
  ]);

  const storedTasks = await prisma.rankTask.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
  for (const searchType of selection.searchTypes) {
    const typedTasks = storedTasks.filter((task) => task.searchType === searchType);
    for (let offset = 0; offset < typedTasks.length; offset += TASK_BATCH_SIZE) {
      await submitBatch(runId, searchType, typedTasks.slice(offset, offset + TASK_BATCH_SIZE), client);
    }
  }

  return refreshStandardRun(runId);
}

export async function collectStandardRankRuns(client = new DataForSeoClient()) {
  const runs = await prisma.rankRun.findMany({
    where: {
      status: "running",
      deliveryMethod: "standard",
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }]
    },
    orderBy: { startedAt: "asc" },
    take: configuredInteger("RANK_QUEUE_MAX_COLLECT_RUNS", 3),
    include: {
      project: true,
      rankTasks: {
        where: { status: "submitted" },
        orderBy: { submittedAt: "asc" },
        take: configuredInteger("RANK_QUEUE_MAX_TASK_GETS", 100)
      }
    }
  });

  let collected = 0;
  for (const run of runs) {
    for (const task of run.rankTasks) {
      if (!task.externalTaskId) continue;
      try {
        const response = await client.getStandardSerpTask(task.searchType, task.externalTaskId);
        await logApiResponse(run.id, response, `collect:${task.externalTaskId}`);
        const state = readTaskState(response.responseBody, response.statusCode);

        if (state.kind === "pending") {
          const attempts = task.attempts + 1;
          const exhausted = attempts >= configuredInteger("RANK_QUEUE_MAX_POLL_ATTEMPTS", 24);
          await prisma.rankTask.update({
            where: { id: task.id },
            data: exhausted
              ? { status: "failed", attempts, completedAt: new Date(), lastError: "Timed out waiting for DataForSEO." }
              : { attempts, lastError: state.message }
          });
          continue;
        }

        if (state.kind === "failed") {
          await prisma.rankTask.update({
            where: { id: task.id },
            data: { status: "failed", attempts: { increment: 1 }, completedAt: new Date(), lastError: state.message }
          });
          continue;
        }

        await storeRankResultFromResponse({
          runId: run.id,
          keywordId: task.keywordId,
          locationId: task.locationId,
          searchType: task.searchType,
          device: task.device,
          targetDomain: run.project.domain,
          targetBusinessName: run.project.targetBusinessName,
          responseBody: response.responseBody
        });
        await prisma.rankTask.update({
          where: { id: task.id },
          data: { status: "completed", attempts: { increment: 1 }, completedAt: new Date(), lastError: null }
        });
        collected += 1;
      } catch (error) {
        const attempts = task.attempts + 1;
        const exhausted = attempts >= configuredInteger("RANK_QUEUE_MAX_POLL_ATTEMPTS", 24);
        await prisma.rankTask.update({
          where: { id: task.id },
          data: exhausted
            ? { status: "failed", attempts, completedAt: new Date(), lastError: errorMessage(error) }
            : { status: "submitted", attempts, lastError: errorMessage(error) }
        });
      }
    }
    await refreshStandardRun(run.id);
  }
  return collected;
}

async function submitBatch(
  runId: string,
  searchType: SearchType,
  tasks: RankTask[],
  client: DataForSeoClient
) {
  const ids = tasks.map((task) => task.id);
  await prisma.rankTask.updateMany({ where: { id: { in: ids }, status: "queued" }, data: { status: "submitting" } });

  try {
    const payload = tasks.map((task) => task.requestBody as DataForSeoTask);
    const response = await client.postStandardSerpTasks(searchType, payload);
    await logApiResponse(runId, response, `submit:${searchType}`);
    const rootError = getDataForSeoError(response.responseBody, response.statusCode);
    const posted = readPostedTasks(response.responseBody);

    for (const [index, task] of tasks.entries()) {
      const result = posted[index];
      const failure = rootError ?? result?.error ?? (!result?.id ? "DataForSEO did not return a task ID." : null);
      await prisma.rankTask.update({
        where: { id: task.id },
        data: failure
          ? { status: "failed", completedAt: new Date(), lastError: failure }
          : { status: "submitted", externalTaskId: result.id, submittedAt: new Date(), lastError: null }
      });
    }

    await prisma.rankRun.update({
      where: { id: runId },
      data: { actualCostUsd: { increment: response.costUsd } }
    });
  } catch (error) {
    await prisma.rankTask.updateMany({
      where: { id: { in: ids }, status: "submitting" },
      data: { status: "failed", completedAt: new Date(), lastError: errorMessage(error) }
    });
  }
}

async function refreshStandardRun(runId: string) {
  const counts = await prisma.rankTask.groupBy({ where: { runId }, by: ["status"], _count: { _all: true } });
  const count = (status: string) => counts.find((item) => item.status === status)?._count._all ?? 0;
  const submittedTasks = count("submitted");
  const completedTasks = count("completed");
  const failedTasks = count("failed");
  const pendingTasks = count("queued") + count("submitting") + submittedTasks;
  const done = pendingTasks === 0;
  const status = done ? (completedTasks > 0 ? "completed" : "failed") : "running";
  const lastFailure = await prisma.rankTask.findFirst({
    where: { runId, status: "failed" },
    orderBy: { updatedAt: "desc" },
    select: { lastError: true }
  });

  await prisma.rankRun.update({
    where: { id: runId },
    data: {
      status,
      submittedTasks,
      completedTasks,
      failedTasks,
      lastError: lastFailure?.lastError ?? null,
      nextPollAt: done ? null : new Date(Date.now() + 4 * 60 * 1000),
      ...(done ? { completedAt: new Date() } : {})
    }
  });
  if (done) {
    await writeAuditLog({
      event: status === "completed" ? "report.run_completed" : "report.run_failed",
      outcome: status === "completed" ? "success" : "failure",
      actorEmail: "system",
      actorRole: "system",
      entityType: "rankRun",
      entityId: runId,
      metadata: { completedTasks, failedTasks }
    });
  }
  return runId;
}

async function logApiResponse(runId: string, response: DataForSeoApiResponse, tag: string) {
  await prisma.apiRequest.create({
    data: {
      rankRunId: runId,
      endpoint: response.endpoint,
      tag,
      sandbox: false,
      requestBody: response.requestBody as Prisma.InputJsonValue,
      responseBody: response.responseBody as Prisma.InputJsonValue,
      statusCode: response.statusCode,
      costUsd: response.costUsd,
      errorMessage: getDataForSeoError(response.responseBody, response.statusCode)
    }
  });
}

function readPostedTasks(body: unknown) {
  const tasks = record(body)?.tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.map((task) => {
    const item = record(task);
    const code = numberValue(item?.status_code);
    return {
      id: stringValue(item?.id),
      error: code && code >= 40000 ? stringValue(item?.status_message) ?? `DataForSEO status ${code}.` : null
    };
  });
}

export function readTaskState(body: unknown, statusCode: number):
  | { kind: "pending"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "ready" } {
  if (statusCode >= 400) return { kind: "failed", message: `HTTP ${statusCode} returned by DataForSEO.` };
  const root = record(body);
  const rootCode = numberValue(root?.status_code);
  if (rootCode && rootCode >= 40000) {
    return { kind: "failed", message: stringValue(root?.status_message) ?? `DataForSEO status ${rootCode}.` };
  }
  const tasks = root?.tasks;
  const item = Array.isArray(tasks) ? record(tasks[0]) : undefined;
  const code = numberValue(item?.status_code);
  if (code === 40601 || code === 40602) {
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

function buildStandardTag(...parts: Array<string>) {
  return parts.map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "-")).join(":").slice(0, 255);
}

function configuredInteger(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Standard task failure.";
}
