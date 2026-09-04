import { Prisma, type RankTask, type SearchType } from "@prisma/client";
import { DataForSeoClient, type DataForSeoApiResponse, type DataForSeoTask } from "@/lib/dataforseo";
import {
  asRecord,
  buildDataForSeoTag,
  errorMessage,
  getDataForSeoError,
  readPostedTasks,
  readRootError,
  readTaskState,
  reconcilePostedTasks,
  stringValue
} from "@/lib/dataforseo-response";
import { prisma } from "@/lib/db";
import { configuredPositiveInteger } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";
import { buildDataForSeoTask, storeRankResultFromResponse, type RankRunSelection } from "@/lib/rank-runner";

const TASK_BATCH_SIZE = 100;
const INTERRUPTED_SUBMISSION = "Submission was interrupted before DataForSEO confirmed the task. Retry the report to resubmit it.";

/**
 * Materialise one RankTask per keyword, area, device and result type, then post them to
 * DataForSEO in batches. When the run already has tasks (a resumed or retried run) only the
 * tasks still marked `queued` are posted, so nothing that DataForSEO already accepted is paid
 * for twice.
 */
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
  if (existingTasks === 0) {
    const taskInputs = project.keywords.flatMap((keyword) =>
      project.locations.flatMap((location) =>
        selection.devices.flatMap((device) =>
          selection.searchTypes.map((searchType) => {
            const tag = buildDataForSeoTag(project.clientId, project.id, runId, keyword.id, location.id, searchType, device);
            const requestBody = buildDataForSeoTask(keyword.phrase, project.domain, location, device, searchType, "live", pageLimit, tag);
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
  }

  await submitQueuedTasks(runId, client);
  return refreshStandardRun(runId);
}

/** Post every task on the run that is still `queued`, batched per result type. */
export async function submitQueuedTasks(runId: string, client = new DataForSeoClient()) {
  const queued = await prisma.rankTask.findMany({ where: { runId, status: "queued" }, orderBy: { createdAt: "asc" } });
  const bySearchType = new Map<SearchType, RankTask[]>();
  for (const task of queued) {
    bySearchType.set(task.searchType, [...(bySearchType.get(task.searchType) ?? []), task]);
  }

  let submitted = 0;
  for (const [searchType, tasks] of bySearchType) {
    for (let offset = 0; offset < tasks.length; offset += TASK_BATCH_SIZE) {
      submitted += await submitBatch(runId, searchType, tasks.slice(offset, offset + TASK_BATCH_SIZE), client);
    }
  }
  return submitted;
}

export async function collectStandardRankRuns(client = new DataForSeoClient()) {
  const maxPollAttempts = configuredPositiveInteger("RANK_QUEUE_MAX_POLL_ATTEMPTS", 24);
  const runs = await prisma.rankRun.findMany({
    where: {
      status: "running",
      deliveryMethod: "standard",
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }]
    },
    orderBy: { startedAt: "asc" },
    take: configuredPositiveInteger("RANK_QUEUE_MAX_COLLECT_RUNS", 3),
    include: {
      project: true,
      rankTasks: {
        where: { status: "submitted" },
        orderBy: { submittedAt: "asc" },
        take: configuredPositiveInteger("RANK_QUEUE_MAX_TASK_GETS", 100)
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
          const exhausted = attempts >= maxPollAttempts;
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
        const exhausted = attempts >= maxPollAttempts;
        await prisma.rankTask.update({
          where: { id: task.id },
          data: exhausted
            ? { status: "failed", attempts, completedAt: new Date(), lastError: taskErrorMessage(error) }
            : { status: "submitted", attempts, lastError: taskErrorMessage(error) }
        });
      }
    }
    await refreshStandardRun(run.id);
  }
  return collected;
}

/**
 * Tasks left in `submitting` mean the worker died between claiming them and recording
 * DataForSEO's answer. We cannot tell whether DataForSEO accepted (and charged for) them, so
 * they are failed rather than re-posted; an operator can retry the run once the cause is known.
 */
export async function reapStalledStandardTasks(now = new Date()) {
  const stalled = await prisma.rankTask.findMany({
    where: { status: "submitting", updatedAt: { lt: staleCutoff(now) } },
    select: { id: true, runId: true }
  });
  if (stalled.length === 0) return 0;

  await prisma.rankTask.updateMany({
    where: { id: { in: stalled.map((task) => task.id) } },
    data: { status: "failed", completedAt: now, lastError: INTERRUPTED_SUBMISSION }
  });
  for (const runId of new Set(stalled.map((task) => task.runId))) {
    await refreshStandardRun(runId);
    await writeAuditLog({
      event: "report.tasks_reaped",
      outcome: "failure",
      actorEmail: "system",
      actorRole: "system",
      entityType: "rankRun",
      entityId: runId,
      metadata: { reaped: stalled.filter((task) => task.runId === runId).length }
    });
  }
  return stalled.length;
}

/**
 * Runs still `running` whose tasks were never posted: the worker died after creating the
 * tasks but before submitting them. Those tasks were never sent, so posting them is safe.
 */
export async function resumeStalledStandardRuns(client = new DataForSeoClient(), now = new Date()) {
  const runs = await prisma.rankRun.findMany({
    where: {
      status: "running",
      deliveryMethod: "standard",
      rankTasks: { some: { status: "queued", updatedAt: { lt: staleCutoff(now) } } }
    },
    select: { id: true },
    take: configuredPositiveInteger("RANK_QUEUE_MAX_COLLECT_RUNS", 3)
  });

  let resumed = 0;
  for (const run of runs) {
    resumed += await submitQueuedTasks(run.id, client);
    await refreshStandardRun(run.id);
  }
  return resumed;
}

async function submitBatch(runId: string, searchType: SearchType, tasks: RankTask[], client: DataForSeoClient) {
  const ids = tasks.map((task) => task.id);
  const claimed = await prisma.rankTask.updateMany({ where: { id: { in: ids }, status: "queued" }, data: { status: "submitting" } });
  if (claimed.count === 0) return 0;

  const taggedTasks = tasks.map((task) => ({ ...task, tag: taskTag(task) }));
  try {
    const response = await client.postStandardSerpTasks(searchType, taggedTasks.map((task) => task.requestBody as DataForSeoTask));
    await logApiResponse(runId, response, `submit:${searchType}`);

    const reconciled = reconcilePostedTasks(
      taggedTasks,
      readPostedTasks(response.responseBody),
      readRootError(response.responseBody, response.statusCode)
    );
    let submitted = 0;
    for (const item of reconciled) {
      await prisma.rankTask.update({
        where: { id: item.task.id },
        data: item.failure
          ? { status: "failed", completedAt: new Date(), lastError: item.failure }
          : { status: "submitted", externalTaskId: item.externalTaskId, submittedAt: new Date(), lastError: null }
      });
      if (!item.failure) submitted += 1;
    }

    await prisma.rankRun.update({ where: { id: runId }, data: { actualCostUsd: { increment: response.costUsd } } });
    return submitted;
  } catch (error) {
    await prisma.rankTask.updateMany({
      where: { id: { in: ids }, status: "submitting" },
      data: { status: "failed", completedAt: new Date(), lastError: taskErrorMessage(error) }
    });
    return 0;
  }
}

export async function refreshStandardRun(runId: string) {
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
  const pollIntervalMs = configuredPositiveInteger("RANK_QUEUE_POLL_INTERVAL_MINUTES", 4) * 60 * 1000;

  await prisma.rankRun.update({
    where: { id: runId },
    data: {
      status,
      submittedTasks,
      completedTasks,
      failedTasks,
      lastError: lastFailure?.lastError ?? null,
      nextPollAt: done ? null : new Date(Date.now() + pollIntervalMs),
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

function taskTag(task: RankTask) {
  return stringValue(asRecord(task.requestBody)?.tag) ?? "";
}

function staleCutoff(now: Date) {
  return new Date(now.getTime() - configuredPositiveInteger("RANK_TASK_STALE_MINUTES", 30) * 60 * 1000);
}

function taskErrorMessage(error: unknown) {
  return errorMessage(error, "Unknown Standard task failure.");
}
