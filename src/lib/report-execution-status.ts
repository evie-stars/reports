import type { ReportExecutionStatus, ReportModuleRunStatus } from "@prisma/client";

export function deriveReportExecutionStatus(
  states: ReportModuleRunStatus[]
): ReportExecutionStatus {
  const active = states.filter((state) => state !== "not_selected");
  if (active.length === 0) return "blocked";
  if (active.some((state) => state === "running")) return "running";
  if (active.some((state) => state === "queued")) {
    return active.some((state) => state !== "queued") ? "running" : "queued";
  }

  const completed = active.filter((state) => state === "completed").length;
  if (completed === active.length) return "completed";
  if (completed > 0) return "partial";
  if (active.every((state) => state === "blocked")) return "blocked";
  return "failed";
}

export function isTerminalReportExecutionStatus(status: ReportExecutionStatus) {
  return ["completed", "partial", "failed", "blocked"].includes(status);
}
