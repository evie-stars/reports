import {
  Prisma,
  ReportModule,
  SearchType,
  type Project,
  type RankRun,
  type ReportModuleRunStatus
} from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { estimateRankRunCost } from "@/lib/dataforseo-costs";
import { errorMessage as describeError } from "@/lib/dataforseo-response";
import { prisma } from "@/lib/db";
import { configuredPositiveInteger } from "@/lib/env";
import { importProjectSearchConsoleData } from "@/lib/gsc-import";
import { enqueueScheduledRankRun, type QueueSelection } from "@/lib/rank-queue";
import { deriveReportExecutionStatus, isTerminalReportExecutionStatus } from "@/lib/report-execution-status";
import { enabledRankSearchTypes, hasRankTracking } from "@/lib/report-modules";
import { effectiveScheduleDay, scheduleIsDue } from "@/lib/schedules";

type ScheduledProject = Project & {
  keywords: { id: string }[];
  locations: { id: string }[];
};

export async function enqueueDueReportExecutions(now = new Date()) {
  const projects = await prisma.project.findMany({
    where: { scheduleEnabled: true },
    include: {
      keywords: { where: { active: true }, select: { id: true } },
      locations: { where: { active: true }, select: { id: true } }
    }
  });
  let queued = 0;

  // The day is clamped to the current month's length so a schedule on the 31st still runs in shorter months.
  for (const project of projects.filter((project) => scheduleIsDue(project.scheduleDay, now))) {
    if (await createExecution(project, now)) queued += 1;
  }
  return queued;
}

export async function processScheduledReportExecutions(maxGscImports = configuredMaxGscImports()) {
  const candidates = await prisma.reportExecution.findMany({
    where: { status: { in: ["queued", "running"] } },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }]
  });
  let gscImported = 0;
  let gscFailed = 0;

  for (const execution of candidates) {
    if (gscImported + gscFailed >= maxGscImports || execution.gscStatus !== "queued") continue;
    const claimed = await prisma.reportExecution.updateMany({
      where: { id: execution.id, gscStatus: "queued" },
      data: { gscStatus: "running", status: "running", startedAt: execution.startedAt ?? new Date() }
    });
    if (claimed.count === 0) continue;

    try {
      const result = await importProjectSearchConsoleData(execution.projectId);
      await prisma.reportExecution.update({
        where: { id: execution.id },
        data: { gscStatus: "completed", gscRowsImported: result.rowCount, gscError: null }
      });
      gscImported += 1;
    } catch (error) {
      await prisma.reportExecution.update({
        where: { id: execution.id },
        data: { gscStatus: "failed", gscError: errorMessage(error) }
      });
      gscFailed += 1;
    }
  }

  const transitions = await syncOpenExecutions();
  return { gscImported, gscFailed, ...transitions };
}

async function createExecution(project: ScheduledProject, now: Date) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const scheduledFor = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    effectiveScheduleDay(project.scheduleDay, now.getUTCFullYear(), now.getUTCMonth())
  ));
  const modules = [...project.reportModules];
  if (
    enabledRankSearchTypes(project.reportModules, project.scheduleSearchTypes).includes(SearchType.maps) &&
    !modules.includes(ReportModule.maps)
  ) {
    modules.push(ReportModule.maps);
  }
  const hasRankings = hasRankTracking(modules);
  const hasGsc = modules.includes("gsc");
  const hasGa4 = modules.includes("ga4");

  let executionId: string;
  try {
    const execution = await prisma.reportExecution.create({
      data: {
        projectId: project.id,
        periodStart,
        scheduledFor,
        modules,
        rankingsStatus: hasRankings ? "queued" : "not_selected",
        gscStatus: hasGsc ? "queued" : "not_selected",
        ga4Status: hasGa4 ? "blocked" : "not_selected",
        ga4Error: hasGa4 ? "Google Analytics 4 automation is not connected yet." : null
      }
    });
    executionId = execution.id;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await prisma.reportExecution.findUnique({
        where: { projectId_periodStart: { projectId: project.id, periodStart } }
      });
      const staleInitialization = existing &&
        existing.status === "queued" &&
        existing.rankingsStatus === "queued" &&
        !existing.rankRunId &&
        hasRankings &&
        existing.createdAt < new Date(Date.now() - 10 * 60 * 1000);
      if (!staleInitialization) return false;
      executionId = existing.id;
    } else {
      throw error;
    }
  }

  let rankingsStatus: ReportModuleRunStatus = hasRankings ? "queued" : "not_selected";
  let rankingsError: string | null = null;
  let rankRunId: string | null = null;
  if (hasRankings) {
    const existing = await prisma.rankRun.findFirst({
      where: { projectId: project.id, source: "scheduled", createdAt: { gte: periodStart } },
      orderBy: { createdAt: "desc" }
    });
    if (existing) {
      rankRunId = existing.id;
      rankingsStatus = rankModuleStatus(existing.status);
      rankingsError = existing.lastError;
    } else {
      const selection = rankSelection(project);
      if (selection.keywordIds.length === 0 || selection.locationIds.length === 0) {
        rankingsStatus = "blocked";
        rankingsError = "Add at least one active keyword and area before the scheduled ranking check.";
      } else {
        try {
          rankRunId = await enqueueScheduledRankRun(selection);
        } catch (error) {
          rankingsStatus = "blocked";
          rankingsError = errorMessage(error);
          rankRunId = await createBlockedRankRun(project, selection, rankingsError);
        }
      }
    }
  }

  let gscStatus: ReportModuleRunStatus = hasGsc ? "queued" : "not_selected";
  let gscError: string | null = null;
  if (hasGsc && (!project.gscConnectionId || !project.gscPropertyUrl)) {
    gscStatus = "blocked";
    gscError = "Map a Search Console property before the scheduled report.";
  }

  const ga4Status: ReportModuleRunStatus = hasGa4 ? "blocked" : "not_selected";
  const status = deriveReportExecutionStatus([rankingsStatus, gscStatus, ga4Status]);
  await prisma.reportExecution.update({
    where: { id: executionId },
    data: {
      rankRunId,
      rankingsStatus,
      rankingsError,
      gscStatus,
      gscError,
      status,
      completedAt: isTerminalReportExecutionStatus(status) ? new Date() : null
    }
  });
  await writeAuditLog({
    event: isTerminalReportExecutionStatus(status) ? "report.execution_blocked" : "report.execution_queued",
    outcome: isTerminalReportExecutionStatus(status) ? "failure" : "success",
    actorEmail: "scheduler",
    actorRole: "system",
    entityType: "reportExecution",
    entityId: executionId,
    metadata: { projectId: project.id, modules, rankingsError, gscError }
  });
  return true;
}

async function syncOpenExecutions() {
  const executions = await prisma.reportExecution.findMany({
    where: { status: { in: ["queued", "running"] } },
    include: { rankRun: true }
  });
  const counts = { completed: 0, partial: 0, failed: 0, blocked: 0 };

  for (const execution of executions) {
    const rankingsStatus = execution.rankRun ? rankModuleStatus(execution.rankRun.status) : execution.rankingsStatus;
    const rankingsError = execution.rankRun?.lastError ?? execution.rankingsError;
    const status = deriveReportExecutionStatus([rankingsStatus, execution.gscStatus, execution.ga4Status]);
    const terminal = isTerminalReportExecutionStatus(status);
    await prisma.reportExecution.update({
      where: { id: execution.id },
      data: {
        rankingsStatus,
        rankingsError,
        status,
        startedAt: status !== "queued" ? execution.startedAt ?? new Date() : execution.startedAt,
        completedAt: terminal ? execution.completedAt ?? new Date() : null
      }
    });
    if (!terminal || status === execution.status) continue;
    if (status === "completed") counts.completed += 1;
    else if (status === "partial") counts.partial += 1;
    else if (status === "failed") counts.failed += 1;
    else if (status === "blocked") counts.blocked += 1;
    await writeAuditLog({
      event: `report.execution_${status}`,
      outcome: status === "completed" ? "success" : "failure",
      actorEmail: "system",
      actorRole: "system",
      entityType: "reportExecution",
      entityId: execution.id,
      metadata: {
        projectId: execution.projectId,
        rankingsStatus,
        gscStatus: execution.gscStatus,
        ga4Status: execution.ga4Status,
        rankingsError,
        gscError: execution.gscError,
        ga4Error: execution.ga4Error
      }
    });
  }
  return counts;
}

function rankSelection(project: ScheduledProject): QueueSelection {
  return {
    projectId: project.id,
    keywordIds: project.keywords.map(({ id }) => id),
    locationIds: project.locations.map(({ id }) => id),
    devices: project.scheduleDevices,
    searchTypes: enabledRankSearchTypes(project.reportModules, project.scheduleSearchTypes),
    pageLimit: project.schedulePageLimit
  };
}

async function createBlockedRankRun(project: ScheduledProject, selection: QueueSelection, message: string) {
  const requestedTasks = selection.keywordIds.length * selection.locationIds.length *
    selection.devices.length * selection.searchTypes.length;
  const estimatedCostUsd = estimateRankRunCost({
    keywordCount: selection.keywordIds.length,
    locationCount: selection.locationIds.length,
    devices: selection.devices,
    searchTypes: selection.searchTypes,
    pageLimit: selection.pageLimit
  }, "standard");
  const run = await prisma.rankRun.create({
    data: {
      projectId: project.id,
      status: "blocked",
      sandbox: false,
      source: "scheduled",
      deliveryMethod: "standard",
      requestedByEmail: "scheduler",
      requestedTasks,
      estimatedCostUsd,
      selection: selection as Prisma.InputJsonValue,
      lastError: message,
      notes: `Monthly schedule blocked: ${message}`
    }
  });
  return run.id;
}

function rankModuleStatus(status: RankRun["status"]): ReportModuleRunStatus {
  return status;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function configuredMaxGscImports() {
  return configuredPositiveInteger("SCHEDULED_REPORT_MAX_GSC_IMPORTS", 2);
}

function errorMessage(error: unknown) {
  return describeError(error, "Unknown scheduled report failure.");
}
