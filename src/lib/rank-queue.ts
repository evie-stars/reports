import { randomUUID } from "node:crypto";
import { Device, Prisma, RankRunSource, SearchType } from "@prisma/client";
import { z } from "zod";
import type { AppRole } from "../../auth";
import { DataForSeoClient } from "@/lib/dataforseo";
import { writeAuditLog } from "@/lib/audit";
import { assertBudgetAvailable, estimateRankRunCost } from "@/lib/dataforseo-costs";
import { prisma } from "@/lib/db";
import { executeQueuedRankRun, type RankRunSelection } from "@/lib/rank-runner";
import { collectStandardRankRuns, submitStandardRankRun } from "@/lib/rank-standard";
import { enabledRankSearchTypes, hasRankTracking } from "@/lib/report-modules";

const queueSelectionSchema = z.object({
  projectId: z.string().min(1),
  keywordIds: z.array(z.string().min(1)).min(1),
  locationIds: z.array(z.string().min(1)).min(1),
  devices: z.array(z.nativeEnum(Device)).min(1),
  searchTypes: z.array(z.nativeEnum(SearchType)).min(1),
  pageLimit: z.number().int().min(1).max(10)
});

export type QueueSelection = z.infer<typeof queueSelectionSchema>;

export async function enqueueVerification(selection: QueueSelection, requestedByEmail: string) {
  return enqueueSelection(selection, "verification", requestedByEmail);
}

export async function enqueueScheduledRankRun(selection: QueueSelection) {
  return enqueueSelection(selection, "scheduled", "scheduler");
}

export async function enqueueProjectRerun(input: {
  projectId: string;
  requestedByEmail: string;
  role: AppRole;
}) {
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
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });
  return run.id;
}

export async function retryRankRun(runId: string, requestedByEmail: string) {
  const run = await prisma.rankRun.findUnique({ where: { id: runId } });
  if (!run || !["failed", "blocked"].includes(run.status)) throw new Error("Only failed or blocked reports can be retried.");
  const selection = queueSelectionSchema.parse(run.selection);
  const replacementId = await enqueueSelection(
    { ...selection, searchTypes: currentSearchTypes(selection.searchTypes) },
    run.source === "scheduled" ? "scheduled" : "manual",
    requestedByEmail
  );
  if (run.source === "scheduled") {
    await prisma.reportExecution.updateMany({
      where: { rankRunId: run.id },
      data: {
        rankRunId: replacementId,
        rankingsStatus: "queued",
        rankingsError: null,
        status: "queued",
        completedAt: null
      }
    });
  }
  return replacementId;
}

export async function processRankQueue(maxJobs = configuredMaxJobs()) {
  const owner = randomUUID();
  if (!(await acquireWorkerLock(owner))) return { processed: 0, locked: true };
  let processed = 0;
  let collected = 0;

  try {
    collected = await collectStandardRankRuns();
    while (processed < maxJobs) {
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
          await writeAuditLog({
            event: "report.run_completed",
            actorEmail: "system",
            actorRole: "system",
            entityType: "rankRun",
            entityId: candidate.id
          });
        } else {
          await submitStandardRankRun(candidate.id, rankSelection(selection), selection.pageLimit);
          await writeAuditLog({
            event: "report.run_submitted",
            actorEmail: "system",
            actorRole: "system",
            entityType: "rankRun",
            entityId: candidate.id
          });
        }
      } catch (error) {
        await prisma.rankRun.update({
          where: { id: candidate.id },
          data: {
            status: "failed",
            completedAt: new Date(),
            lastError: errorMessage(error),
            notes: `${candidate.notes ?? "Queued report."} Failed: ${errorMessage(error)}`
          }
        });
        await writeAuditLog({
          event: "report.run_failed",
          outcome: "failure",
          actorEmail: "system",
          actorRole: "system",
          entityType: "rankRun",
          entityId: candidate.id,
          metadata: { error: errorMessage(error) }
        });
      }
      processed += 1;
    }
    return { processed, collected, locked: false };
  } finally {
    await releaseWorkerLock(owner);
  }
}

async function assertTeamCooldown(projectId: string) {
  const days = positiveInteger(process.env.RANK_TEAM_COOLDOWN_DAYS ?? process.env.RANK_SALES_COOLDOWN_DAYS, 7);
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
    where: { key: "rank-queue" },
    create: { key: "rank-queue", owner: null, lockedUntil: new Date(0) },
    update: {}
  });
  const claimed = await prisma.systemLock.updateMany({
    where: { key: "rank-queue", lockedUntil: { lt: new Date() } },
    data: { owner, lockedUntil: new Date(Date.now() + 2 * 60 * 60 * 1000) }
  });
  return claimed.count === 1;
}

async function releaseWorkerLock(owner: string) {
  await prisma.systemLock.updateMany({
    where: { key: "rank-queue", owner },
    data: { owner: null, lockedUntil: new Date(0) }
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

function configuredMaxJobs() {
  return positiveInteger(process.env.RANK_QUEUE_MAX_JOBS, 1);
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readableSource(source: RankRunSource) {
  if (source === "verification") return "Live verification";
  if (source === "scheduled") return "Monthly report";
  return "Ad hoc report";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown queue failure.";
}
