import { randomUUID } from "node:crypto";
import { Device, Prisma, RankRunSource, SearchType, type RankRun } from "@prisma/client";
import { z } from "zod";
import { DataForSeoClient } from "@/lib/dataforseo";
import { errorMessage } from "@/lib/dataforseo-response";
import { writeAuditLog } from "@/lib/audit";
import { assertBudgetAvailable, estimateRankRunCost, roundUsd, STANDARD_SERP_PAGE_COST_USD } from "@/lib/dataforseo-costs";
import { prisma } from "@/lib/db";
import { configuredPositiveInteger } from "@/lib/env";
import { executeQueuedRankRun, type RankRunSelection } from "@/lib/rank-runner";
import {
  collectStandardRankRuns,
  reapStalledStandardTasks,
  resumeStalledStandardRuns,
  submitStandardRankRun
} from "@/lib/rank-standard";
import { enabledRankSearchTypes, hasRankTracking } from "@/lib/report-modules";
import type { AppRole } from "@/lib/roles";

const queueSelectionSchema = z.object({
  projectId: z.string().min(1),
  keywordIds: z.array(z.string().min(1)).min(1),
  locationIds: z.array(z.string().min(1)).min(1),
  devices: z.array(z.nativeEnum(Device)).min(1),
  searchTypes: z.array(z.nativeEnum(SearchType)).min(1),
  pageLimit: z.number().int().min(1).max(10)
});

export type QueueSelection = z.infer<typeof queueSelectionSchema>;

const WORKER_LOCK_KEY = "rank-queue";

export async function enqueueVerification(selection: QueueSelection, requestedByEmail: string) {
  return enqueueSelection(selection, "verification", requestedByEmail);
}

export async function enqueueScheduledRankRun(selection: QueueSelection) {
  return enqueueSelection(selection, "scheduled", "scheduler");
}

export async function enqueueProjectRerun(input: { projectId: string; requestedByEmail: string; role: AppRole }) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: {
      keywords: { where: { active: true }, select: { id: true } },
      locations: { where: { active: true }, select: { id: true } }
    }
  });
  if (!project) throw new Error("Report not found.");
  if (!hasRankTracking(project.reportModules)) throw new Error("SEO and Maps rankings are not enabled for this report.");

  if (input.role === "team") await assertTeamCooldown(project.id);

  const existing = await prisma.rankRun.findFirst({
    where: { projectId: project.id, status: { in: ["queued", "running"] }, source: { in: ["manual", "scheduled"] } }
  });
  if (existing) throw new Error("This report is already queued or running.");

  return enqueueSelection({
    projectId: project.id,
    keywordIds: project.keywords.map(({ id }) => id),
    locationIds: project.locations.map(({ id }) => id),
    devices: project.scheduleDevices,
    searchTypes: enabledRankSearchTypes(project.reportModules, project.scheduleSearchTypes),
    pageLimit: project.schedulePageLimit
  }, "manual", input.requestedByEmail);
}

async function enqueueSelection(selection: QueueSelection, source: RankRunSource, requestedByEmail: string | null) {
  const parsed = queueSelectionSchema.parse(selection);
  const requestedTasks = parsed.keywordIds.length * parsed.locationIds.length * parsed.devices.length * parsed.searchTypes.length;
  const deliveryMethod = source === "verification" ? "live" : "standard";
  const client = new DataForSeoClient();
  if (deliveryMethod === "live") client.assertSafeToRun("live", requestedTasks);
  else client.assertStandardTaskCount(requestedTasks);
  const estimatedCostUsd = estimateRankRunCost({
    keywordCount: parsed.keywordIds.length,
    locationCount: parsed.locationIds.length,
    devices: parsed.devices,
    searchTypes: parsed.searchTypes,
    pageLimit: parsed.pageLimit
  }, deliveryMethod);

  const run = await prisma.$transaction(async (tx) => {
    await assertBudgetAvailable(estimatedCostUsd, tx);
    return tx.rankRun.create({
      data: {
        projectId: parsed.projectId,
        status: "queued",
        sandbox: false,
        source,
        deliveryMethod,
        requestedByEmail,
        requestedTasks,
        estimatedCostUsd,
        selection: parsed as Prisma.InputJsonValue,
        notes: `${readableSource(source)} queued via ${deliveryMethod}: ${requestedTasks} task(s), up to ${parsed.pageLimit} organic result page(s).`
      }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return run.id;
}

/**
 * Retry a failed or blocked run. A Standard run keeps its identity and only its failed tasks
 * are re-queued, so tasks DataForSEO already accepted are neither re-posted nor re-charged.
 * Runs without stored tasks (blocked before submission, or live verifications) are queued afresh.
 */
export async function retryRankRun(runId: string, requestedByEmail: string) {
  const run = await prisma.rankRun.findUnique({ where: { id: runId } });
  if (!run || !["failed", "blocked"].includes(run.status)) throw new Error("Only failed or blocked reports can be retried.");

  const storedTasks = await prisma.rankTask.count({ where: { runId: run.id } });
  if (run.deliveryMethod === "standard" && storedTasks > 0) return requeueStandardRun(run, requestedByEmail);

  const selection = queueSelectionSchema.parse(run.selection);
  const replacementId = await enqueueSelection(
    { ...selection, searchTypes: currentSearchTypes(selection.searchTypes) },
    run.source === "scheduled" ? "scheduled" : "manual",
    requestedByEmail
  );
  if (run.source === "scheduled") await resetExecutionRankings(run.id, replacementId);
  return replacementId;
}

async function requeueStandardRun(run: RankRun, requestedByEmail: string) {
  const selection = queueSelectionSchema.parse(run.selection);
  const failed = await prisma.rankTask.findMany({ where: { runId: run.id, status: "failed" }, select: { searchType: true } });
  if (failed.length === 0) throw new Error("This report has no failed tasks to retry.");
  new DataForSeoClient().assertStandardTaskCount(failed.length);

  const retryEstimateUsd = roundUsd(failed.reduce(
    (total, task) => total + STANDARD_SERP_PAGE_COST_USD * (task.searchType === "organic" ? selection.pageLimit : 1),
    0
  ));

  await prisma.$transaction(async (tx) => {
    await assertBudgetAvailable(retryEstimateUsd, tx);
    await tx.rankTask.updateMany({
      where: { runId: run.id, status: "failed" },
      data: { status: "queued", attempts: 0, externalTaskId: null, submittedAt: null, completedAt: null, lastError: null }
    });
    await tx.rankRun.update({
      where: { id: run.id },
      data: {
        status: "queued",
        availableAt: new Date(),
        completedAt: null,
        lastError: null,
        requestedByEmail,
        // The reservation is estimated minus actual, so the estimate must cover what was already spent plus the retry.
        estimatedCostUsd: roundUsd(Number(run.actualCostUsd) + retryEstimateUsd),
        notes: `${run.notes ?? "Queued report."} Retry queued for ${failed.length} failed task(s).`
      }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (run.source === "scheduled") await resetExecutionRankings(run.id, run.id);
  return run.id;
}

async function resetExecutionRankings(previousRunId: string, rankRunId: string) {
  await prisma.reportExecution.updateMany({
    where: { rankRunId: previousRunId },
    data: { rankRunId, rankingsStatus: "queued", rankingsError: null, status: "queued", completedAt: null }
  });
}

export async function processRankQueue(maxJobs = configuredPositiveInteger("RANK_QUEUE_MAX_JOBS", 1)) {
  const owner = randomUUID();
  if (!(await acquireWorkerLock(owner))) return { processed: 0, collected: 0, reaped: 0, resumed: 0, locked: true };
  let processed = 0;
  let attempts = 0;

  try {
    const reaped = await reapStalledStandardTasks();
    const resumed = await resumeStalledStandardRuns();
    const collected = await collectStandardRankRuns();

    // A failed claim (another process took the run first) counts as an attempt so the loop always terminates.
    while (processed < maxJobs && attempts < maxJobs + 5) {
      attempts += 1;
      const candidate = await prisma.rankRun.findFirst({
        where: { status: "queued", sandbox: false, availableAt: { lte: new Date() } },
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }]
      });
      if (!candidate) break;

      const claimed = await prisma.rankRun.updateMany({
        where: { id: candidate.id, status: "queued" },
        data: { status: "running", startedAt: new Date() }
      });
      if (claimed.count === 0) continue;

      try {
        const selection = queueSelectionSchema.parse(candidate.selection);
        if (candidate.source === "verification") {
          await executeQueuedRankRun(candidate.id, rankSelection(selection), selection.pageLimit);
          await writeSystemAudit("report.run_completed", candidate.id);
        } else {
          await submitStandardRankRun(candidate.id, rankSelection(selection), selection.pageLimit);
          await writeSystemAudit("report.run_submitted", candidate.id);
        }
      } catch (error) {
        const message = errorMessage(error, "Unknown queue failure.");
        await prisma.rankRun.update({
          where: { id: candidate.id },
          data: {
            status: "failed",
            completedAt: new Date(),
            lastError: message,
            notes: `${candidate.notes ?? "Queued report."} Failed: ${message}`
          }
        });
        await writeSystemAudit("report.run_failed", candidate.id, { error: message }, "failure");
      }
      processed += 1;
    }
    return { processed, collected, reaped, resumed, locked: false };
  } finally {
    await releaseWorkerLock(owner);
  }
}

async function assertTeamCooldown(projectId: string) {
  const days = configuredPositiveInteger("RANK_TEAM_COOLDOWN_DAYS", 7);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const recent = await prisma.rankRun.findFirst({
    where: {
      projectId,
      sandbox: false,
      status: "completed",
      source: { in: ["manual", "scheduled"] },
      completedAt: { gte: cutoff }
    },
    orderBy: { completedAt: "desc" }
  });
  if (recent) throw new Error(`Team users can re-run this report ${days} days after its latest completed report.`);
}

async function acquireWorkerLock(owner: string) {
  await prisma.systemLock.upsert({
    where: { key: WORKER_LOCK_KEY },
    create: { key: WORKER_LOCK_KEY, owner: null, lockedUntil: new Date(0) },
    update: {}
  });
  const lockMinutes = configuredPositiveInteger("RANK_QUEUE_LOCK_MINUTES", 120);
  const claimed = await prisma.systemLock.updateMany({
    where: { key: WORKER_LOCK_KEY, lockedUntil: { lt: new Date() } },
    data: { owner, lockedUntil: new Date(Date.now() + lockMinutes * 60 * 1000) }
  });
  return claimed.count === 1;
}

async function releaseWorkerLock(owner: string) {
  await prisma.systemLock.updateMany({
    where: { key: WORKER_LOCK_KEY, owner },
    data: { owner: null, lockedUntil: new Date(0) }
  });
}

async function writeSystemAudit(
  event: string,
  runId: string,
  metadata?: Record<string, string>,
  outcome: "success" | "failure" = "success"
) {
  await writeAuditLog({
    event,
    outcome,
    actorEmail: "system",
    actorRole: "system",
    entityType: "rankRun",
    entityId: runId,
    ...(metadata ? { metadata } : {})
  });
}

function rankSelection(selection: QueueSelection): RankRunSelection {
  return {
    projectId: selection.projectId,
    keywordIds: selection.keywordIds,
    locationIds: selection.locationIds,
    devices: selection.devices,
    searchTypes: selection.searchTypes
  };
}

export function currentSearchTypes(searchTypes: SearchType[]) {
  const filtered = searchTypes.filter((searchType) => searchType !== SearchType.local_finder);
  return filtered.length > 0 ? filtered : [SearchType.organic];
}

function readableSource(source: RankRunSource) {
  if (source === "verification") return "Live verification";
  if (source === "scheduled") return "Monthly report";
  return "Ad hoc report";
}
