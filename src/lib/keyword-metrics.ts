import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { DataForSeoClient, type DataForSeoApiResponse } from "@/lib/dataforseo";
import { assertBudgetAvailable, configuredKeywordMetricsCostUsd } from "@/lib/dataforseo-costs";
import { prisma } from "@/lib/db";
import { getDataForSeoError } from "@/lib/rank-runner";
import { readTaskState } from "@/lib/rank-standard";

export async function queueKeywordMetrics(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      keywords: { where: { active: true }, select: { id: true } },
      locations: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 }
    }
  });
  if (!project) throw new Error("Report not found.");
  if (project.keywords.length === 0) throw new Error("Add at least one active keyword first.");
  if (project.keywords.length > 1000) throw new Error("Keyword metrics support up to 1,000 active keywords per report.");
  if (project.locations.length === 0) throw new Error("Add an active DataForSEO area first.");
  if (["queued", "submitting", "submitted"].includes(project.keywordMetricsStatus)) {
    throw new Error("Keyword metrics are already queued for this report.");
  }

  new DataForSeoClient().assertKeywordMetricsEnabled();
  const estimatedCostUsd = configuredKeywordMetricsCostUsd();
  await prisma.$transaction(async (tx) => {
    await assertBudgetAvailable(estimatedCostUsd, tx);
    await tx.project.update({
      where: { id: projectId },
      data: {
        keywordMetricsStatus: "queued",
        keywordMetricsTaskId: null,
        keywordMetricsRequestedAt: new Date(),
        keywordMetricsNextPollAt: null,
        keywordMetricsPollAttempts: 0,
        keywordMetricsEstimatedCostUsd: estimatedCostUsd,
        keywordMetricsActualCostUsd: 0,
        keywordMetricsError: null
      }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function processKeywordMetricsQueue(client = new DataForSeoClient()) {
  const owner = randomUUID();
  if (!(await acquireMetricsLock(owner))) return { submitted: 0, collected: 0, locked: true };
  try {
    return await processKeywordMetricsQueueUnlocked(client);
  } finally {
    await releaseMetricsLock(owner);
  }
}

async function processKeywordMetricsQueueUnlocked(client: DataForSeoClient) {
  let collected = 0;
  let submitted = 0;

  const pending = await prisma.project.findMany({
    where: {
      keywordMetricsStatus: "submitted",
      keywordMetricsTaskId: { not: null },
      OR: [{ keywordMetricsNextPollAt: null }, { keywordMetricsNextPollAt: { lte: new Date() } }]
    },
    include: { keywords: { where: { active: true } } },
    take: 3
  });

  for (const project of pending) {
    if (!project.keywordMetricsTaskId) continue;
    try {
      const response = await client.getKeywordMetricsTask(project.keywordMetricsTaskId);
      await logMetricsRequest(response, `collect:${project.keywordMetricsTaskId}`);
      const state = readTaskState(response.responseBody, response.statusCode);
      if (state.kind === "pending") {
        await rescheduleMetricsPoll(project.id, project.keywordMetricsPollAttempts, state.message);
        continue;
      }
      if (state.kind === "failed") {
        await failProject(project.id, state.message);
        continue;
      }

      const metrics = readKeywordMetrics(response.responseBody);
      const keywordByPhrase = new Map(project.keywords.map((keyword) => [keyword.phrase.trim().toLowerCase(), keyword]));
      const checkedAt = new Date();
      for (const metric of metrics) {
        const keyword = keywordByPhrase.get(metric.keyword.trim().toLowerCase());
        if (!keyword) continue;
        await prisma.$transaction([
          prisma.keyword.update({
            where: { id: keyword.id },
            data: {
              searchVolume: metric.searchVolume,
              cpcUsd: metric.cpc,
              competition: metric.competition,
              ...(metric.monthlySearches ? { monthlySearches: metric.monthlySearches as Prisma.InputJsonValue } : {}),
              metricsUpdatedAt: checkedAt
            }
          }),
          prisma.keywordMetricSnapshot.create({
            data: {
              keywordId: keyword.id,
              locationName: metric.locationName,
              searchVolume: metric.searchVolume,
              cpcUsd: metric.cpc,
              competition: metric.competition,
              ...(metric.monthlySearches ? { monthlySearches: metric.monthlySearches as Prisma.InputJsonValue } : {}),
              checkedAt,
              rawData: metric.raw as Prisma.InputJsonValue
            }
          })
        ]);
      }

      await prisma.project.update({
        where: { id: project.id },
        data: {
          keywordMetricsStatus: "completed",
          keywordMetricsUpdatedAt: checkedAt,
          keywordMetricsNextPollAt: null,
          keywordMetricsError: null
        }
      });
      collected += 1;
    } catch (error) {
      await rescheduleMetricsPoll(project.id, project.keywordMetricsPollAttempts, errorMessage(error));
    }
  }

  const queued = await prisma.project.findFirst({
    where: { keywordMetricsStatus: "queued" },
    orderBy: { keywordMetricsRequestedAt: "asc" },
    include: {
      keywords: { where: { active: true }, orderBy: { phrase: "asc" } },
      locations: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 }
    }
  });
  if (queued) {
    await prisma.project.update({ where: { id: queued.id }, data: { keywordMetricsStatus: "submitting" } });
    try {
      const location = queued.locations[0];
      if (!location) throw new Error("No active area is configured.");
      if (queued.keywords.length === 0) throw new Error("No active keywords are configured.");
      const tag = `keyword-metrics:${queued.clientId}:${queued.id}`.slice(0, 255);
      const response = await client.postKeywordMetricsTask({
        keywords: queued.keywords.map((keyword) => keyword.phrase),
        location_name: location.dataForSeoLocationName ?? location.name,
        language_code: "en",
        tag
      });
      await logMetricsRequest(response, tag);
      const failure = getDataForSeoError(response.responseBody, response.statusCode);
      const taskId = readPostedTaskId(response.responseBody);
      if (failure || !taskId) throw new Error(failure ?? "DataForSEO did not return a keyword metrics task ID.");

      await prisma.project.update({
        where: { id: queued.id },
        data: {
          keywordMetricsStatus: "submitted",
          keywordMetricsTaskId: taskId,
          keywordMetricsPollAttempts: 0,
          keywordMetricsActualCostUsd: response.costUsd,
          keywordMetricsNextPollAt: new Date(Date.now() + 10 * 60 * 1000),
          keywordMetricsError: null
        }
      });
      submitted += 1;
    } catch (error) {
      await failProject(queued.id, errorMessage(error));
    }
  }

  return { submitted, collected, locked: false };
}

async function acquireMetricsLock(owner: string) {
  await prisma.systemLock.upsert({
    where: { key: "keyword-metrics-queue" },
    create: { key: "keyword-metrics-queue", owner: null, lockedUntil: new Date(0) },
    update: {}
  });
  const claimed = await prisma.systemLock.updateMany({
    where: { key: "keyword-metrics-queue", lockedUntil: { lt: new Date() } },
    data: { owner, lockedUntil: new Date(Date.now() + 2 * 60 * 60 * 1000) }
  });
  return claimed.count === 1;
}

async function releaseMetricsLock(owner: string) {
  await prisma.systemLock.updateMany({
    where: { key: "keyword-metrics-queue", owner },
    data: { owner: null, lockedUntil: new Date(0) }
  });
}

async function logMetricsRequest(response: DataForSeoApiResponse, tag: string) {
  await prisma.apiRequest.create({
    data: {
      endpoint: response.endpoint,
      tag,
      sandbox: false,
      requestBody: response.requestBody as Prisma.InputJsonValue,
      responseBody: response.responseBody as Prisma.InputJsonValue,
      statusCode: response.statusCode,
      costUsd: response.costUsd,
      errorMessage: getDataForSeoError(response.responseBody, response.statusCode) ?? undefined
    }
  });
}

async function rescheduleMetricsPoll(projectId: string, currentAttempts: number, message: string) {
  const attempts = currentAttempts + 1;
  if (attempts >= configuredInteger("KEYWORD_METRICS_MAX_POLL_ATTEMPTS", 24)) {
    await failProject(projectId, message || "Timed out waiting for DataForSEO keyword metrics.");
    return;
  }
  await prisma.project.update({
    where: { id: projectId },
    data: {
      keywordMetricsPollAttempts: attempts,
      keywordMetricsNextPollAt: new Date(Date.now() + 10 * 60 * 1000),
      keywordMetricsError: message
    }
  });
}

async function failProject(projectId: string, message: string) {
  await prisma.project.update({
    where: { id: projectId },
    data: { keywordMetricsStatus: "failed", keywordMetricsNextPollAt: null, keywordMetricsError: message }
  });
}

function readPostedTaskId(body: unknown) {
  const tasks = record(body)?.tasks;
  if (!Array.isArray(tasks)) return null;
  const id = record(tasks[0])?.id;
  return typeof id === "string" ? id : null;
}

export function readKeywordMetrics(body: unknown) {
  const tasks = record(body)?.tasks;
  if (!Array.isArray(tasks)) return [];
  const result = record(tasks[0])?.result;
  if (!Array.isArray(result)) return [];

  return result.flatMap((value) => {
    const item = record(value);
    if (!item || typeof item.keyword !== "string") return [];
    return [{
      keyword: item.keyword,
      locationName: typeof item.location_name === "string" ? item.location_name : "Configured area",
      searchVolume: nullableNumber(item.search_volume),
      cpc: nullableNumber(item.cpc),
      competition: nullableNumber(item.competition),
      monthlySearches: Array.isArray(item.monthly_searches) ? item.monthly_searches : null,
      raw: item
    }];
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown keyword metrics failure.";
}

function configuredInteger(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
