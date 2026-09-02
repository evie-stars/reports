"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentActor, requireAdmin } from "@/lib/access";
import { DataForSeoClient } from "@/lib/dataforseo";
import { prisma } from "@/lib/db";
import { importRankHistoryCsv } from "@/lib/rank-history-import";
import { enqueueProjectRerun, enqueueVerification, retryRankRun } from "@/lib/rank-queue";
import { executeSandboxRankRun } from "@/lib/rank-runner";
import { queueKeywordMetrics as enqueueKeywordMetrics } from "@/lib/keyword-metrics";

const optionalText = z.string().trim().optional().transform((value) => value || null);

const clientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required."),
  notes: optionalText
});

const projectSchema = z.object({
  clientId: z.string().trim().min(1),
  name: z.string().trim().min(1, "Project name is required."),
  domain: z.string().trim().min(1, "Domain is required."),
  targetBusinessName: optionalText,
  serviceArea: optionalText
});

const keywordSchema = z.object({
  projectId: z.string().trim().min(1),
  phrase: z.string().trim().min(1, "Keyword is required."),
  group: optionalText,
  targetUrl: optionalText
});

const bulkKeywordSchema = z.object({
  projectId: z.string().trim().min(1),
  phrases: z.string().trim().min(1, "Add at least one keyword."),
  group: optionalText,
  targetUrl: optionalText
});

const locationSchema = z.object({
  projectId: z.string().trim().min(1),
  countryCode: z.string().trim().min(2).max(2).default("GB"),
  dataForSeoLocationName: z.string().trim().min(1, "Select an area from the DataForSEO list.")
});

const sandboxRunSchema = z.object({
  projectId: z.string().trim().min(1),
  keywordIds: z.array(z.string().trim().min(1)).transform(uniqueValues),
  locationIds: z.array(z.string().trim().min(1)).transform(uniqueValues),
  devices: z.array(z.enum(["desktop", "mobile"])).transform(uniqueValues),
  searchTypes: z.array(z.enum(["organic", "local_finder", "maps"])).transform(uniqueValues)
});

const liveRunSchema = z.object({
  projectId: z.string().trim().min(1),
  keywordId: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  device: z.enum(["desktop", "mobile"]),
  searchType: z.enum(["organic", "local_finder", "maps"]),
  pageLimit: z.coerce.number().int().min(1).max(10),
  confirmLiveCost: z.literal("yes")
});

const scheduleSchema = z.object({
  scheduleEnabled: z.boolean(),
  scheduleDay: z.coerce.number().int().min(1).max(28),
  scheduleDevices: z.array(z.enum(["desktop", "mobile"])).min(1),
  scheduleSearchTypes: z.array(z.enum(["organic", "local_finder", "maps"])).min(1),
  schedulePageLimit: z.coerce.number().int().min(1).max(10)
});

export async function createClient(formData: FormData) {
  await requireAdmin();
  const data = clientSchema.parse(readForm(formData, ["name", "notes"]));
  const client = await prisma.client.create({ data });

  revalidatePath("/clients");
  redirect(`/clients/${client.id}?view=settings`);
}

export async function importRankHistory(formData: FormData) {
  await requireAdmin();
  let clientId: string;

  try {
    const file = formData.get("historyFile");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a historical ranking CSV to import.");
    if (file.size > 900 * 1024) throw new Error("The CSV must be smaller than 900 KB.");
    if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("The historical ranking file must be a CSV.");

    const result = await importRankHistoryCsv(await file.text(), {
      clientName: stringFromForm(formData.get("clientName")),
      projectName: stringFromForm(formData.get("projectName"))
    });
    clientId = result.clientId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import the historical rankings.";
    redirect(`/clients?import=1&importError=${encodeURIComponent(message)}`);
  }

  revalidatePath("/");
  revalidatePath("/clients");
  redirect(`/clients/${clientId}`);
}

export async function updateClient(clientId: string, formData: FormData) {
  await requireAdmin();
  const data = clientSchema.parse(readForm(formData, ["name", "notes"]));
  await prisma.client.update({ where: { id: clientId }, data });

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

export async function enableClientShare(clientId: string) {
  await requireAdmin();
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { shareToken: true } });
  if (!client) throw new Error("Client not found.");

  await prisma.client.update({
    where: { id: clientId },
    data: {
      shareEnabled: true,
      shareToken: client.shareToken ?? randomBytes(24).toString("base64url")
    }
  });

  revalidatePath(`/clients/${clientId}`);
}

export async function disableClientShare(clientId: string) {
  await requireAdmin();
  await prisma.client.update({ where: { id: clientId }, data: { shareEnabled: false } });
  revalidatePath(`/clients/${clientId}`);
}

export async function createProject(formData: FormData) {
  await requireAdmin();
  const data = projectSchema.parse(readForm(formData, ["clientId", "name", "domain", "targetBusinessName", "serviceArea"]));
  const project = await prisma.project.create({ data });

  revalidatePath("/clients");
  revalidatePath(`/clients/${data.clientId}`);
  redirect(`/projects/${project.id}`);
}

export async function updateProject(projectId: string, formData: FormData) {
  await requireAdmin();
  const data = projectSchema.parse(readForm(formData, ["clientId", "name", "domain", "targetBusinessName", "serviceArea"]));
  await prisma.project.update({ where: { id: projectId }, data });

  revalidatePath(`/clients/${data.clientId}`);
  revalidatePath(`/projects/${projectId}`);
}

export async function createKeyword(formData: FormData) {
  await requireAdmin();
  const data = keywordSchema.parse(readForm(formData, ["projectId", "phrase", "group", "targetUrl"]));
  await prisma.keyword.create({ data });

  revalidatePath(`/projects/${data.projectId}`);
}

export async function createKeywords(formData: FormData) {
  await requireAdmin();
  const data = bulkKeywordSchema.parse(readForm(formData, ["projectId", "phrases", "group", "targetUrl"]));
  const phrases = uniqueLines(data.phrases);

  await prisma.keyword.createMany({
    data: phrases.map((phrase) => ({
      projectId: data.projectId,
      phrase,
      group: data.group,
      targetUrl: data.targetUrl
    }))
  });

  revalidatePath(`/projects/${data.projectId}`);
}

export async function updateKeywordActive(keywordId: string, projectId: string, active: boolean) {
  await requireAdmin();
  await prisma.keyword.update({ where: { id: keywordId }, data: { active } });
  revalidatePath(`/projects/${projectId}`);
}

export async function createLocation(formData: FormData) {
  await requireAdmin();
  const data = locationSchema.parse(readForm(formData, ["projectId", "countryCode", "dataForSeoLocationName"]));
  const supportedAreas = await new DataForSeoClient().getGoogleLocations(data.countryCode);
  const area = supportedAreas.find((location) => location.locationName === data.dataForSeoLocationName);

  if (!area) {
    throw new Error("That area is not in DataForSEO's current supported locations list.");
  }

  const existing = await prisma.location.findFirst({
    where: {
      projectId: data.projectId,
      dataForSeoLocationName: area.locationName
    }
  });

  if (existing) {
    if (!existing.active) {
      await prisma.location.update({ where: { id: existing.id }, data: { active: true } });
    }
    revalidatePath(`/projects/${data.projectId}`);
    return;
  }

  await prisma.location.create({
    data: {
      projectId: data.projectId,
      name: area.locationName.split(",")[0],
      countryCode: area.countryIsoCode,
      dataForSeoLocationName: area.locationName
    }
  });
  revalidatePath(`/projects/${data.projectId}`);
}

export async function updateLocationActive(locationId: string, projectId: string, active: boolean) {
  await requireAdmin();
  await prisma.location.update({ where: { id: locationId }, data: { active } });
  revalidatePath(`/projects/${projectId}`);
}

export async function runSandboxCheck(projectId: string, formData: FormData) {
  await requireAdmin();
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start the sandbox check.";
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
    const actor = await requireAdmin();
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start the live verification.";
    redirect(`/projects/${projectId}?liveError=${encodeURIComponent(message)}`);
  }

  revalidatePath("/");
  revalidatePath("/runs");
  revalidatePath(`/projects/${projectId}`);
  redirect(`/runs/${runId}`);
}

export async function updateProjectSchedule(projectId: string, formData: FormData) {
  await requireAdmin();
  const data = scheduleSchema.parse({
    scheduleEnabled: formData.get("scheduleEnabled") === "on",
    scheduleDay: stringFromForm(formData.get("scheduleDay")),
    scheduleDevices: stringListFromForm(formData, "scheduleDevices"),
    scheduleSearchTypes: stringListFromForm(formData, "scheduleSearchTypes"),
    schedulePageLimit: stringFromForm(formData.get("schedulePageLimit"))
  });
  await prisma.project.update({ where: { id: projectId }, data });
  revalidatePath(`/projects/${projectId}`);
}

export async function queueProjectRerun(clientId: string, formData: FormData) {
  let runId: string;
  try {
    const actor = await currentActor();
    const projectId = stringFromForm(formData.get("projectId"));
    runId = await enqueueProjectRerun({ projectId, requestedByEmail: actor.email, role: actor.role });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to queue the report.";
    redirect(`/clients/${clientId}?queueError=${encodeURIComponent(message)}`);
  }

  revalidatePath("/runs");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/runs/${runId}`);
}

export async function retryFailedRankRun(runId: string) {
  const actor = await requireAdmin();
  const newRunId = await retryRankRun(runId, actor.email);
  revalidatePath("/runs");
  redirect(`/runs/${newRunId}`);
}

export async function queueKeywordMetrics(projectId: string) {
  await requireAdmin();
  try {
    await enqueueKeywordMetrics(projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to queue keyword metrics.";
    redirect(`/projects/${projectId}?metricsError=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}?metricsQueued=1`);
}

function readForm(formData: FormData, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, stringFromForm(formData.get(key))]));
}

function stringFromForm(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

function stringListFromForm(formData: FormData, key: string) {
  return formData.getAll(key).filter((value): value is string => typeof value === "string");
}

function uniqueValues<T>(values: T[]) {
  return Array.from(new Set(values));
}

function uniqueLines(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  );
}
