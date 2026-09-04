"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DataForSeoClient } from "@/lib/dataforseo";
import { prisma } from "@/lib/db";
import { actionRateLimit } from "@/lib/rate-limit";
import {
  auditAction,
  guardedManagerAction,
  normalizedKeyword,
  optionalText,
  readForm,
  stringFromForm,
  stringListFromForm,
  uniqueLines,
  uniqueValues
} from "@/actions/shared";

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

const scheduleSchema = z.object({
  scheduleEnabled: z.boolean(),
  scheduleDay: z.coerce.number().int().min(1).max(28),
  scheduleDevices: z.array(z.enum(["desktop", "mobile"])).min(1),
  scheduleSearchTypes: z.array(z.enum(["organic", "maps"])).transform(uniqueValues),
  schedulePageLimit: z.coerce.number().int().min(1).max(10)
});

const reportModulesSchema = z.object({
  reportModules: z.array(z.enum(["rankings", "maps", "gsc", "ga4"])).min(1, "Select at least one report section.")
});

export async function createProject(formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = projectSchema.parse(readForm(formData, ["clientId", "name", "domain", "targetBusinessName", "serviceArea"]));
  const project = await prisma.project.create({ data });
  await auditAction("project.created", actor, "project", project.id, { clientId: data.clientId });

  revalidatePath("/clients");
  revalidatePath(`/clients/${data.clientId}`);
  redirect(`/projects/${project.id}`);
}

export async function updateProject(projectId: string, formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = projectSchema.parse(readForm(formData, ["clientId", "name", "domain", "targetBusinessName", "serviceArea"]));
  await prisma.project.update({ where: { id: projectId }, data });
  await auditAction("project.updated", actor, "project", projectId, { clientId: data.clientId });

  revalidatePath(`/clients/${data.clientId}`);
  revalidatePath(`/projects/${projectId}`);
}

export async function updateProjectModules(projectId: string, formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = reportModulesSchema.parse({ reportModules: stringListFromForm(formData, "reportModules") });
  const scheduleSearchTypes = [
    ...(data.reportModules.includes("rankings") ? ["organic" as const] : []),
    ...(data.reportModules.includes("maps") ? ["maps" as const] : [])
  ];
  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      reportModules: data.reportModules,
      scheduleSearchTypes: scheduleSearchTypes.length > 0 ? scheduleSearchTypes : ["organic"],
      ...(data.reportModules.some((module) => module === "rankings" || module === "maps" || module === "gsc") ? {} : { scheduleEnabled: false })
    },
    select: { clientId: true }
  });
  await auditAction("project.modules_updated", actor, "project", projectId, { modules: data.reportModules });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/clients/${project.clientId}`);
}

export async function updateProjectSchedule(projectId: string, formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = scheduleSchema.parse({
    scheduleEnabled: formData.get("scheduleEnabled") === "on",
    scheduleDay: stringFromForm(formData.get("scheduleDay")),
    scheduleDevices: stringListFromForm(formData, "scheduleDevices"),
    scheduleSearchTypes: stringListFromForm(formData, "scheduleSearchTypes"),
    schedulePageLimit: stringFromForm(formData.get("schedulePageLimit"))
  });
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { reportModules: true, gscConnectionId: true, gscPropertyUrl: true }
  });
  if (!project) throw new Error("Report not found.");
  if (data.scheduleEnabled) {
    if (!project.reportModules.some((module) => module === "rankings" || module === "maps" || module === "gsc")) {
      throw new Error("Enable SEO, Maps or Search Console before scheduling this report.");
    }
    if (project.reportModules.includes("gsc") && (!project.gscConnectionId || !project.gscPropertyUrl)) {
      throw new Error("Map a Search Console property before enabling its monthly schedule.");
    }
  }
  const selectedSearchTypes = [
    ...(project.reportModules.includes("rankings") ? ["organic" as const] : []),
    ...(project.reportModules.includes("maps") ? ["maps" as const] : [])
  ];
  await prisma.project.update({
    where: { id: projectId },
    data: { ...data, scheduleSearchTypes: selectedSearchTypes.length > 0 ? selectedSearchTypes : ["organic"] }
  });
  await auditAction("project.schedule_updated", actor, "project", projectId, {
    enabled: data.scheduleEnabled,
    day: data.scheduleDay,
    devices: data.scheduleDevices,
    searchTypes: selectedSearchTypes
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/scheduled");
}

export async function createKeyword(formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = keywordSchema.parse(readForm(formData, ["projectId", "phrase", "group", "targetUrl"]));
  const existingKeywords = await prisma.keyword.findMany({ where: { projectId: data.projectId }, select: { phrase: true } });
  if (existingKeywords.some((keyword) => normalizedKeyword(keyword.phrase) === normalizedKeyword(data.phrase))) {
    throw new Error("That keyword is already included in this report.");
  }
  const keyword = await prisma.keyword.create({ data });
  await auditAction("keyword.created", actor, "keyword", keyword.id, { projectId: data.projectId });
  revalidatePath(`/projects/${data.projectId}`);
}

export async function createKeywords(formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = bulkKeywordSchema.parse(readForm(formData, ["projectId", "phrases", "group", "targetUrl"]));
  const phrases = uniqueLines(data.phrases);
  const existingKeywords = await prisma.keyword.findMany({ where: { projectId: data.projectId }, select: { phrase: true } });
  const existingPhrases = new Set(existingKeywords.map((keyword) => normalizedKeyword(keyword.phrase)));
  const newPhrases = phrases.filter((phrase) => !existingPhrases.has(normalizedKeyword(phrase)));
  const skipped = phrases.length - newPhrases.length;

  if (newPhrases.length > 0) {
    await prisma.keyword.createMany({
      data: newPhrases.map((phrase) => ({ projectId: data.projectId, phrase, group: data.group, targetUrl: data.targetUrl })),
      skipDuplicates: true
    });
  }
  await auditAction("keyword.bulk_created", actor, "project", data.projectId, { count: newPhrases.length, duplicatesSkipped: skipped });

  revalidatePath(`/projects/${data.projectId}`);
  redirect(`/projects/${data.projectId}?keywordsAdded=${newPhrases.length}&duplicatesSkipped=${skipped}`);
}

export async function updateKeywordActive(keywordId: string, projectId: string, active: boolean) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  await prisma.keyword.update({ where: { id: keywordId }, data: { active } });
  await auditAction("keyword.status_changed", actor, "keyword", keywordId, { projectId, active });
  revalidatePath(`/projects/${projectId}`);
}

export async function createLocation(formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = locationSchema.parse(readForm(formData, ["projectId", "countryCode", "dataForSeoLocationName"]));
  const supportedAreas = await new DataForSeoClient().getGoogleLocations(data.countryCode);
  const area = supportedAreas.find((location) => location.locationName === data.dataForSeoLocationName);
  if (!area) throw new Error("That area is not in DataForSEO's current supported locations list.");

  const existing = await prisma.location.findFirst({
    where: { projectId: data.projectId, dataForSeoLocationName: area.locationName }
  });
  if (existing) {
    if (!existing.active) {
      await prisma.location.update({ where: { id: existing.id }, data: { active: true } });
      await auditAction("location.status_changed", actor, "location", existing.id, { projectId: data.projectId, active: true });
    }
    revalidatePath(`/projects/${data.projectId}`);
    return;
  }

  const location = await prisma.location.create({
    data: {
      projectId: data.projectId,
      name: area.locationName.split(",")[0],
      countryCode: area.countryIsoCode,
      dataForSeoLocationName: area.locationName
    }
  });
  await auditAction("location.created", actor, "location", location.id, { projectId: data.projectId });
  revalidatePath(`/projects/${data.projectId}`);
}

export async function updateLocationActive(locationId: string, projectId: string, active: boolean) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  await prisma.location.update({ where: { id: locationId }, data: { active } });
  await auditAction("location.status_changed", actor, "location", locationId, { projectId, active });
  revalidatePath(`/projects/${projectId}`);
}
