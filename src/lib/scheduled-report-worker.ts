import {
  Prisma,
  ReportModule,
  SearchType,
  type Project,
  type RankRun,
  type ReportExecution,
  type ReportModuleRunStatus
} from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { estimateRankRunCost } from "@/lib/dataforseo-costs";
import { errorMessage as describeError } from "@/lib/dataforseo-response";
import { prisma } from "@/lib/db";
import { configuredPositiveInteger } from "@/lib/env";
import { importProjectAnalyticsData } from "@/lib/ga4-import";
import { importProjectSearchConsoleData } from "@/lib/gsc-import";
import { ga4ImportLockKey, gscImportLockKey, importLockHeld, isImportLockHeldError } from "@/lib/import-lock";
import { enqueueScheduledRankRun, type QueueSelection } from "@/lib/rank-queue";
import { deriveReportExecutionStatus, isTerminalReportExecutionStatus } from "@/lib/report-execution-status";
import { enabledRankSearchTypes, hasRankTracking } from "@/lib/report-modules";
import { effectiveScheduleDay, scheduleIsDue } from "@/lib/schedules";

type ScheduledProject = Project & {
  keywords: { id: string }[];
  locations: { id: string }[];
};

/**
 * How one imported data source (Search Console, Analytics) is claimed, run, and recorded on a
 * `ReportExecution`. The module status column on the execution row is the source of truth for
 * retries; the per-report import lock only says whether an import is still alive.
 */
type ModuleImportAdapter = {
  status: (execution: ReportExecution) => ReportModuleRunStatus;
  lockKey: (projectId: string) => string;
  claim: (execution: ReportExecution, from: ReportModuleRunStatus) => Promise<boolean>;
  complete: (executionId: string, rowCount: number) => Promise<unknown>;
  fail: (executionId: string, message: string) => Promise<unknown>;
  requeue: (executionId: string) => Promise<unknown>;
  run: (projectId: string) => Promise<{ rowCount: number }>;
};

const GSC_ADAPTER: ModuleImportAdapter = {
  status: (execution) => execution.gscStatus,
  lockKey: gscImportLockKey,
  claim: async (execution, from) => {
    const claimed = await prisma.reportExecution.updateMany({
      where: { id: execution.id, gscStatus: from },
      data: { gscStatus: "running", status: "running", startedAt: execution.startedAt ?? new Date() }
    });
    return claimed.count === 1;
  },
  complete: (id, rowCount) => prisma.reportExecution.update({
    where: { id },
    data: { gscStatus: "completed", gscRowsImported: rowCount, gscError: null }
  }),
  fail: (id, message) => prisma.reportExecution.update({ where: { id }, data: { gscStatus: "failed", gscError: message } }),
  requeue: (id) => prisma.reportExecution.update({ where: { id }, data: { gscStatus: "queued" } }),
  run: importProjectSearchConsoleData
};

const GA4_ADAPTER: ModuleImportAdapter = {
  status: (execution) => execution.ga4Status,
  lockKey: ga4ImportLockKey,
  claim: async (execution, from) => {
    const claimed = await prisma.reportExecution.updateMany({
      where: { id: execution.id, ga4Status: from },
      data: { ga4Status: "running", status: "running", startedAt: execution.startedAt ?? new Date() }
    });
    return claimed.count === 1;
  },
  complete: (id, rowCount) => prisma.reportExecution.update({
    where: { id },
    data: { ga4Status: "completed", ga4RowsImported: rowCount, ga4Error: null }
  }),
  fail: (id, message) => prisma.reportExecution.update({ where: { id }, data: { ga4Status: "failed", ga4Error: message } }),
  requeue: (id) => prisma.reportExecution.update({ where: { id }, data: { ga4Status: "queued" } }),
  run: importProjectAnalyticsData
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

export async function processScheduledReportExecutions(options: { maxGscImports?: number; maxGa4Imports?: number } = {}) {
  const candidates = await prisma.reportExecution.findMany({
    where: { status: { in: ["queued", "running"] } },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }]
  });
  const gsc = await runModuleImports(candidates, GSC_ADAPTER, options.maxGscImports ?? configuredMaxImports("SCHEDULED_REPORT_MAX_GSC_IMPORTS"));
  const ga4 = await runModuleImports(candidates, GA4_ADAPTER, options.maxGa4Imports ?? configuredMaxImports("SCHEDULED_REPORT_MAX_GA4_IMPORTS"));

  const transitions = await syncOpenExecutions();
  return { gscImported: gsc.imported, gscFailed: gsc.failed, ga4Imported: ga4.imported, ga4Failed: ga4.failed, ...transitions };
}

async function runModuleImports(candidates: ReportExecution[], adapter: ModuleImportAdapter, maxImports: number) {
  let imported = 0;
  let failed = 0;

  for (const execution of candidates) {
    if (imported + failed >= maxImports) break;
    const current = adapter.status(execution);
    if (current !== "queued" && current !== "running") continue;
    // A module left "running" by a worker that died is retried once its import lock has expired.
    if (current === "running" && await importLockHeld(adapter.lockKey(execution.projectId))) continue;
    if (!(await adapter.claim(execution, current))) continue;

    try {
      const result = await adapter.run(execution.projectId);
      await adapter.complete(execution.id, result.rowCount);
      imported += 1;
    } catch (error) {
      if (isImportLockHeldError(error)) {
        // A manual import owns the lock right now; leave the month's report for the next worker run.
        await adapter.requeue(execution.id);
        continue;
      }
      await adapter.fail(execution.id, errorMessage(error));
      failed += 1;
    }
  }
  return { imported, failed };
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
  const gscMapped = Boolean(project.gscConnectionId && project.gscPropertyUrl);
  const ga4Mapped = Boolean(project.ga4ConnectionId && project.ga4PropertyId);
  // Imported modules are fully decided here; the module loops own those columns from now on.
  const gscStatus: ReportModuleRunStatus = hasGsc ? (gscMapped ? "queued" : "blocked") : "not_selected";
  const gscError = hasGsc && !gscMapped ? "Map a Search Console property before the scheduled report." : null;
  const ga4Status: ReportModuleRunStatus = hasGa4 ? (ga4Mapped ? "queued" : "blocked") : "not_selected";
  const ga4Error = hasGa4 && !ga4Mapped ? "Map a Google Analytics property before the scheduled report." : null;

  let executionId: string;
  try {
    const execution = await prisma.reportExecution.create({
      data: {
        projectId: project.id,
        periodStart,
        scheduledFor,
        modules,
        rankingsStatus: hasRankings ? "queued" : "not_selected",
        gscStatus,
        gscError,
        ga4Status,
        ga4Error
      }
    });
    executionId = execution.id;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await prisma.reportExecution.findUnique({
        where: { projectId_periodStart: { projectId: project.id, periodStart } }
      });
      // A row whose rank run was never queued (crash between create and the update below) is
      // resumed even if an import loop has already claimed one of its other modules.
      const staleInitialization = existing &&
        (existing.status === "queued" || existing.status === "running") &&
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

  // Module columns are re-read rather than rewritten: an import loop may already have claimed one.
  const current = await prisma.reportExecution.findUniqueOrThrow({ where: { id: executionId } });
  const status = deriveReportExecutionStatus([rankingsStatus, current.gscStatus, current.ga4Status]);
  await prisma.reportExecution.update({
    where: { id: executionId },
    data: {
      rankRunId,
      rankingsStatus,
      rankingsError,
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
    metadata: { projectId: project.id, modules, rankingsError, gscError: current.gscError, ga4Error: current.ga4Error }
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

function configuredMaxImports(name: string) {
  return configuredPositiveInteger(name, 2);
}

function errorMessage(error: unknown) {
  return describeError(error, "Unknown scheduled report failure.");
}
