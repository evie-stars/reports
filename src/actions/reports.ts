"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentActor } from "@/lib/access";
import { prisma } from "@/lib/db";
import { queueKeywordMetrics as enqueueKeywordMetrics } from "@/lib/keyword-metrics";
import { enqueueProjectRerun, enqueueVerification, retryRankRun } from "@/lib/rank-queue";
import { executeSandboxRankRun } from "@/lib/rank-runner";
import { actionRateLimit, paidRunRateLimit } from "@/lib/rate-limit";
import {
  auditAction,
  describeError,
  guardedActorAction,
  guardedAdminAction,
  optionalText,
  readForm,
  stringFromForm,
  stringListFromForm,
  uniqueValues
} from "@/actions/shared";

const sandboxRunSchema = z.object({
  projectId: z.string().trim().min(1),
  keywordIds: z.array(z.string().trim().min(1)).transform(uniqueValues),
  locationIds: z.array(z.string().trim().min(1)).transform(uniqueValues),
  devices: z.array(z.enum(["desktop", "mobile"])).transform(uniqueValues),
  searchTypes: z.array(z.enum(["organic", "maps"])).transform(uniqueValues)
});

const liveRunSchema = z.object({
  projectId: z.string().trim().min(1),
  keywordId: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  device: z.enum(["desktop", "mobile"]),
  searchType: z.enum(["organic", "maps"]),
  pageLimit: z.coerce.number().int().min(1).max(10),
  confirmLiveCost: z.literal("yes")
});

const reportRequestSchema = z.object({
  clientName: z.string().trim().min(1, "Client or prospect name is required.").max(120),
  websiteUrl: optionalText,
  notes: z.string().trim().min(1, "Tell us what the report is needed for.").max(1000)
});

export async function runSandboxCheck(projectId: string, formData: FormData) {
  const actor = await guardedAdminAction("mutation", actionRateLimit());
  let runId: string;

  try {
    const selection = sandboxRunSchema.parse({
      projectId,
      keywordIds: stringListFromForm(formData, "keywordIds"),
      locationIds: stringListFromForm(formData, "locationIds"),
      devices: stringListFromForm(formData, "devices"),
      searchTypes: stringListFromForm(formData, "searchTypes")
    });
    runId = await executeSandboxRankRun(selection);
    await auditAction("report.sandbox_run", actor, "rankRun", runId, { projectId });
  } catch (error) {
    const message = describeError(error, "Unable to start the sandbox check.");
    await auditAction("report.sandbox_run", actor, "project", projectId, { error: message }, "failure");
    redirect(`/projects/${projectId}?sandboxError=${encodeURIComponent(message)}`);
  }

  revalidatePath("/");
  revalidatePath("/runs");
  revalidatePath(`/projects/${projectId}`);
  redirect(`/runs/${runId}`);
}

export async function runLiveCheck(projectId: string, formData: FormData) {
  let runId: string;

  try {
    const actor = await guardedAdminAction("paid", paidRunRateLimit());
    const selection = liveRunSchema.parse({
      projectId,
      keywordId: stringFromForm(formData.get("keywordId")),
      locationId: stringFromForm(formData.get("locationId")),
      device: stringFromForm(formData.get("device")),
      searchType: stringFromForm(formData.get("searchType")),
      pageLimit: stringFromForm(formData.get("pageLimit")),
      confirmLiveCost: stringFromForm(formData.get("confirmLiveCost"))
    });
    runId = await enqueueVerification({
      projectId: selection.projectId,
      keywordIds: [selection.keywordId],
      locationIds: [selection.locationId],
      devices: [selection.device],
      searchTypes: [selection.searchType],
      pageLimit: selection.pageLimit
    }, actor.email);
    await auditAction("report.live_queued", actor, "rankRun", runId, { projectId });
  } catch (error) {
    const message = describeError(error, "Unable to start the live verification.");
    const actor = await currentActor();
    await auditAction("report.live_queued", actor, "project", projectId, { error: message }, "failure");
    redirect(`/projects/${projectId}?liveError=${encodeURIComponent(message)}`);
  }

  revalidatePath("/");
  revalidatePath("/runs");
  revalidatePath(`/projects/${projectId}`);
  redirect(`/runs/${runId}`);
}

export async function queueProjectRerun(clientId: string, formData: FormData) {
  let runId: string;
  try {
    const actor = await guardedActorAction("paid", paidRunRateLimit());
    const projectId = stringFromForm(formData.get("projectId"));
    runId = await enqueueProjectRerun({ projectId, requestedByEmail: actor.email, role: actor.role });
    await auditAction("report.rerun_queued", actor, "rankRun", runId, { projectId });
  } catch (error) {
    const message = describeError(error, "Unable to queue the report.");
    const actor = await currentActor();
    await auditAction("report.rerun_queued", actor, "client", clientId, { error: message }, "failure");
    const displayedMessage = actor.role === "team" ? teamQueueError(message) : message;
    redirect(`/clients/${clientId}?queueError=${encodeURIComponent(displayedMessage)}`);
  }

  revalidatePath("/runs");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/runs/${runId}`);
}

export async function retryFailedRankRun(runId: string) {
  const actor = await guardedAdminAction("paid", paidRunRateLimit());
  const queuedRunId = await retryRankRun(runId, actor.email);
  await auditAction("report.retry_queued", actor, "rankRun", queuedRunId, { originalRunId: runId });
  revalidatePath("/runs");
  redirect(`/runs/${queuedRunId}`);
}

export async function queueKeywordMetrics(projectId: string) {
  const actor = await guardedAdminAction("paid", paidRunRateLimit());
  try {
    await enqueueKeywordMetrics(projectId);
    await auditAction("keyword_metrics.queued", actor, "project", projectId);
  } catch (error) {
    const message = describeError(error, "Unable to queue keyword metrics.");
    await auditAction("keyword_metrics.queued", actor, "project", projectId, { error: message }, "failure");
    redirect(`/projects/${projectId}?metricsError=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}?metricsQueued=1`);
}

export async function requestReport(formData: FormData) {
  const actor = await guardedActorAction("report-request", actionRateLimit());
  const data = reportRequestSchema.parse(readForm(formData, ["clientName", "websiteUrl", "notes"]));
  const request = await prisma.reportRequest.create({
    data: { ...data, requestedByEmail: actor.email, requestedByName: actor.name }
  });
  await auditAction("report.requested", actor, "reportRequest", request.id, { clientName: data.clientName });
  revalidatePath("/");
  revalidatePath("/clients");
  redirect("/clients?requestSent=1");
}

export async function reviewReportRequest(requestId: string) {
  const actor = await guardedAdminAction("report-request", actionRateLimit());
  await prisma.reportRequest.update({ where: { id: requestId }, data: { status: "reviewed" } });
  await auditAction("report.request_reviewed", actor, "reportRequest", requestId);
  revalidatePath("/");
}

function teamQueueError(message: string) {
  if (message.includes("days after its latest completed report")) return message;
  if (message === "This report is already queued or running.") return message;
  if (message === "Report not found." || message === "SEO and Maps rankings are not enabled for this report.") return message;
  return "This report could not be queued. A manager can review the reporting limits and configuration.";
}
