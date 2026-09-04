"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentActor, requireAdmin, requireManager, type CurrentActor } from "@/lib/access";
import { writeRequestAudit } from "@/lib/audit";
import { DataForSeoClient } from "@/lib/dataforseo";
import { prisma } from "@/lib/db";
import { importRankHistoryCsv } from "@/lib/rank-history-import";
import { importProjectSearchConsoleData } from "@/lib/gsc-import";
import { enqueueProjectRerun, enqueueVerification, retryRankRun } from "@/lib/rank-queue";
import { executeSandboxRankRun } from "@/lib/rank-runner";
import { queueKeywordMetrics as enqueueKeywordMetrics } from "@/lib/keyword-metrics";
import { listSearchConsoleSites } from "@/lib/google-search-console";
import { buildReportSnapshot, reportSnapshotSlug } from "@/lib/report-snapshot";
import {
  actionRateLimit,
  enforceRateLimit,
  gscImportRateLimit,
  paidRunRateLimit,
  shareRateLimit,
  type RateLimitPolicy
} from "@/lib/rate-limit";

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

const scheduleSchema = z.object({
  scheduleEnabled: z.boolean(),
  scheduleDay: z.coerce.number().int().min(1).max(28),
  scheduleDevices: z.array(z.enum(["desktop", "mobile"])).min(1),
  scheduleSearchTypes: z.array(z.enum(["organic", "maps"])).transform(uniqueValues),
  schedulePageLimit: z.coerce.number().int().min(1).max(10)
});

const gscPropertySelectionSchema = z.object({
  connectionId: z.string().min(1),
  siteUrl: z.string().min(1)
});

const reportModulesSchema = z.object({
  reportModules: z.array(z.enum(["rankings", "maps", "gsc", "ga4"])).min(1, "Select at least one report section.")
});

const reportSnapshotSchema = z.object({
  snapshotModules: z.array(z.enum(["rankings", "maps", "gsc"])).min(1, "Select at least one snapshot section."),
  shareExpiryDays: z.coerce.number().int().refine((value) => [7, 30, 90, 365].includes(value), "Choose a valid link lifetime.")
});

const reportRequestSchema = z.object({
  clientName: z.string().trim().min(1, "Client or prospect name is required.").max(120),
  websiteUrl: optionalText,
  notes: z.string().trim().min(1, "Tell us what the report is needed for.").max(1000)
});

const userAccessSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  name: z.string().trim().max(100).optional().transform((value) => value || null),
  role: z.enum(["admin", "manager", "team"])
});

const userRoleSchema = z.object({ role: z.enum(["admin", "manager", "team"]) });

export async function createClient(formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = clientSchema.parse(readForm(formData, ["name", "notes"]));
  const client = await prisma.client.create({ data });
  await auditAction("client.created", actor, "client", client.id);

  revalidatePath("/clients");
  redirect(`/clients/${client.id}?view=settings`);
}

export async function requestReport(formData: FormData) {
  const actor = await guardedActorAction("report-request", actionRateLimit());
  const data = reportRequestSchema.parse(readForm(formData, ["clientName", "websiteUrl", "notes"]));
  const request = await prisma.reportRequest.create({
    data: {
      ...data,
      requestedByEmail: actor.email,
      requestedByName: actor.name
    }
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

export async function createUserAccess(formData: FormData) {
  const actor = await guardedAdminAction("user-access", actionRateLimit());
  const data = userAccessSchema.parse(readForm(formData, ["email", "name", "role"]));
  const role = isBootstrapAdmin(data.email) ? "admin" : data.role;
  const userAccess = await prisma.userAccess.upsert({
    where: { email: data.email },
    create: { ...data, role, enabled: true },
    update: { name: data.name, role, enabled: true }
  });

  await auditAction("user_access.saved", actor, "userAccess", userAccess.id, {
    email: userAccess.email,
    role: userAccess.role
  });
  revalidatePath("/");
}

export async function updateUserAccessRole(userAccessId: string, formData: FormData) {
  const actor = await guardedAdminAction("user-access", actionRateLimit());
  const { role } = userRoleSchema.parse(readForm(formData, ["role"]));
  const target = await prisma.userAccess.findUniqueOrThrow({ where: { id: userAccessId } });
  if (isBootstrapAdmin(target.email)) throw new Error("Environment administrators must be changed in Plesk.");
  if (target.role === "admin" && role !== "admin") await requireAnotherAdministrator(target.id, target.email);

  await prisma.userAccess.update({ where: { id: target.id }, data: { role } });
  await auditAction("user_access.role_changed", actor, "userAccess", target.id, {
    email: target.email,
    previousRole: target.role,
    role
  });
  revalidatePath("/");
}

export async function toggleUserAccess(userAccessId: string) {
  const actor = await guardedAdminAction("user-access", actionRateLimit());
  const target = await prisma.userAccess.findUniqueOrThrow({ where: { id: userAccessId } });
  if (isBootstrapAdmin(target.email)) throw new Error("Environment administrators cannot be disabled here.");
  if (target.email === actor.email && target.enabled) throw new Error("You cannot disable your own account.");
  if (target.enabled && target.role === "admin") await requireAnotherAdministrator(target.id, target.email);

  const updated = await prisma.userAccess.update({ where: { id: target.id }, data: { enabled: !target.enabled } });
  await auditAction(updated.enabled ? "user_access.enabled" : "user_access.disabled", actor, "userAccess", target.id, {
    email: target.email,
    role: target.role
  });
  revalidatePath("/");
}

export async function importRankHistory(formData: FormData) {
  const actor = await guardedAdminAction("mutation", actionRateLimit());
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
    await auditAction("client.history_imported", actor, "client", result.clientId, {
      projectId: result.projectId,
      keywordCount: result.keywordCount,
      resultCount: result.resultCount
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import the historical rankings.";
    await auditAction("client.history_imported", actor, "client", null, { error: message }, "failure");
    redirect(`/clients?import=1&importError=${encodeURIComponent(message)}`);
  }

  revalidatePath("/");
  revalidatePath("/clients");
  redirect(`/clients/${clientId}`);
}

export async function updateClient(clientId: string, formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = clientSchema.parse(readForm(formData, ["name", "notes"]));
  await prisma.client.update({ where: { id: clientId }, data });
  await auditAction("client.updated", actor, "client", clientId);

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

export async function enableClientShare(clientId: string, formData?: FormData) {
  const actor = await guardedAdminAction("share", shareRateLimit());
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new Error("Client not found.");
  const expiresAt = shareExpiry(formData);

  await prisma.client.update({
    where: { id: clientId },
    data: {
      shareEnabled: true,
      shareToken: randomBytes(24).toString("base64url"),
      shareCreatedAt: new Date(),
      shareExpiresAt: expiresAt,
      shareRevokedAt: null
    }
  });
  await auditAction("client.share_created", actor, "client", clientId, { expiresAt: expiresAt.toISOString() });

  revalidatePath(`/clients/${clientId}`);
}

export async function disableClientShare(clientId: string) {
  const actor = await guardedAdminAction("share", shareRateLimit());
  await prisma.client.update({
    where: { id: clientId },
    data: { shareEnabled: false, shareToken: null, shareExpiresAt: null, shareRevokedAt: new Date() }
  });
  await auditAction("client.share_revoked", actor, "client", clientId);
  revalidatePath(`/clients/${clientId}`);
}

export async function regenerateClientShare(clientId: string, formData: FormData) {
  const actor = await guardedAdminAction("share", shareRateLimit());
  const expiresAt = shareExpiry(formData);
  await prisma.client.update({
    where: { id: clientId },
    data: {
      shareEnabled: true,
      shareToken: randomBytes(24).toString("base64url"),
      shareCreatedAt: new Date(),
      shareExpiresAt: expiresAt,
      shareRevokedAt: null
    }
  });
  await auditAction("client.share_regenerated", actor, "client", clientId, { expiresAt: expiresAt.toISOString() });
  revalidatePath(`/clients/${clientId}`);
}

export async function createReportSnapshot(clientId: string, formData: FormData) {
  const actor = await guardedManagerAction("share", shareRateLimit());
  const data = reportSnapshotSchema.parse({
    snapshotModules: stringListFromForm(formData, "snapshotModules"),
    shareExpiryDays: formData.get("shareExpiryDays")
  });
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
  if (!client) throw new Error("Client not found.");

  const payload = await buildReportSnapshot(client.id, data.snapshotModules);
  const expiresAt = new Date(Date.now() + data.shareExpiryDays * 24 * 60 * 60 * 1000);
  const snapshot = await prisma.reportSnapshot.create({
    data: {
      clientId: client.id,
      slug: reportSnapshotSlug(client.name),
      token: randomBytes(32).toString("base64url"),
      modules: data.snapshotModules,
      payload,
      expiresAt,
      createdByEmail: actor.email
    }
  });
  await auditAction("report_snapshot.created", actor, "reportSnapshot", snapshot.id, {
    clientId: client.id,
    modules: data.snapshotModules,
    expiresAt: expiresAt.toISOString()
  });
  revalidatePath(`/clients/${client.id}`);
}

export async function regenerateReportSnapshot(snapshotId: string, formData: FormData) {
  const actor = await guardedManagerAction("share", shareRateLimit());
  const snapshot = await prisma.reportSnapshot.findUnique({
    where: { id: snapshotId },
    include: { client: { select: { id: true, name: true } } }
  });
  if (!snapshot) throw new Error("Snapshot not found.");

  const expiresAt = shareExpiry(formData);
  const modules = snapshot.modules.filter((module): module is "rankings" | "maps" | "gsc" => module !== "ga4");
  const payload = await buildReportSnapshot(snapshot.clientId, modules);
  const [, replacement] = await prisma.$transaction([
    prisma.reportSnapshot.update({ where: { id: snapshot.id }, data: { revokedAt: new Date() } }),
    prisma.reportSnapshot.create({
      data: {
        clientId: snapshot.clientId,
        slug: reportSnapshotSlug(snapshot.client.name),
        token: randomBytes(32).toString("base64url"),
        modules: snapshot.modules,
        payload,
        expiresAt,
        createdByEmail: actor.email
      }
    })
  ]);
  await auditAction("report_snapshot.regenerated", actor, "reportSnapshot", replacement.id, {
    clientId: snapshot.clientId,
    modules,
    expiresAt: expiresAt.toISOString(),
    replacedSnapshotId: snapshot.id
  });
  revalidatePath(`/clients/${snapshot.clientId}`);
}

export async function revokeReportSnapshot(snapshotId: string) {
  const actor = await guardedManagerAction("share", shareRateLimit());
  const snapshot = await prisma.reportSnapshot.findUnique({ where: { id: snapshotId }, select: { id: true, clientId: true } });
  if (!snapshot) throw new Error("Snapshot not found.");

  await prisma.reportSnapshot.update({ where: { id: snapshot.id }, data: { revokedAt: new Date() } });
  await auditAction("report_snapshot.revoked", actor, "reportSnapshot", snapshot.id, { clientId: snapshot.clientId });
  revalidatePath(`/clients/${snapshot.clientId}`);
}

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

export async function updateProjectGscProperty(projectId: string, formData: FormData) {
  const actor = await guardedManagerAction("integration", actionRateLimit());

  try {
    const selection = readGscPropertySelection(formData.get("gscProperty"));
    const [connection, currentProject] = await Promise.all([
      prisma.googleSearchConsoleConnection.findUnique({ where: { id: selection.connectionId } }),
      prisma.project.findUnique({
        where: { id: projectId },
        select: { gscConnectionId: true, gscPropertyUrl: true }
      })
    ]);
    if (!connection) throw new Error("That Google Search Console connection no longer exists.");
    if (!currentProject) throw new Error("Report not found.");

    const sites = await listSearchConsoleSites(connection.encryptedRefreshToken);
    const site = sites.find((candidate) => candidate.siteUrl === selection.siteUrl);
    if (!site) throw new Error("That Search Console property is not available to the connected Google account.");

    const propertyChanged = currentProject.gscConnectionId !== connection.id || currentProject.gscPropertyUrl !== site.siteUrl;
    await prisma.$transaction(async (tx) => {
      if (propertyChanged) await tx.gscSnapshot.deleteMany({ where: { projectId } });
      await tx.project.update({
        where: { id: projectId },
        data: {
          gscConnectionId: connection.id,
          gscPropertyUrl: site.siteUrl,
          gscPermissionLevel: site.permissionLevel,
          gscConnectedAt: new Date(),
          ...(propertyChanged ? {
            gscImportStatus: "idle",
            gscImportStartedAt: null,
            gscLastImportedAt: null,
            gscImportStartDate: null,
            gscImportEndDate: null,
            gscImportedRows: 0,
            gscImportError: null
          } : {})
        }
      });
      await tx.googleSearchConsoleConnection.update({
        where: { id: connection.id },
        data: { lastValidatedAt: new Date(), lastError: null }
      });
    });
    await auditAction("gsc.property_mapped", actor, "project", projectId, {
      accountEmail: connection.accountEmail,
      siteUrl: site.siteUrl
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search Console property could not be mapped.";
    await auditAction("gsc.property_mapped", actor, "project", projectId, { error: message }, "failure");
    redirect(`/projects/${projectId}?gscError=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}?gscMapped=1`);
}

export async function disconnectProjectGscProperty(projectId: string) {
  const actor = await guardedManagerAction("integration", actionRateLimit());
  await prisma.project.update({
    where: { id: projectId },
    data: {
      gscConnectionId: null,
      gscPropertyUrl: null,
      gscPermissionLevel: null,
      gscConnectedAt: null,
      gscImportStatus: "idle",
      gscImportError: null
    }
  });
  await auditAction("gsc.property_unmapped", actor, "project", projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function disconnectGoogleSearchConsole(connectionId: string) {
  const actor = await guardedAdminAction("integration", actionRateLimit());
  const connection = await prisma.googleSearchConsoleConnection.findUnique({
    where: { id: connectionId },
    select: { accountEmail: true }
  });
  if (!connection) return;

  await prisma.$transaction([
    prisma.project.updateMany({
      where: { gscConnectionId: connectionId },
      data: {
        gscConnectionId: null,
        gscPropertyUrl: null,
        gscPermissionLevel: null,
        gscConnectedAt: null,
        gscImportStatus: "idle",
        gscImportError: null
      }
    }),
    prisma.googleSearchConsoleConnection.delete({ where: { id: connectionId } })
  ]);
  await auditAction("gsc.disconnected", actor, "gscConnection", connectionId, {
    accountEmail: connection.accountEmail
  });
  revalidatePath("/settings");
}

export async function importProjectGscData(projectId: string) {
  const actor = await guardedManagerAction("gsc-import", gscImportRateLimit());
  let imported: Awaited<ReturnType<typeof importProjectSearchConsoleData>>;

  try {
    imported = await importProjectSearchConsoleData(projectId);
    await auditAction("gsc.data_imported", actor, "project", projectId, {
      rowCount: imported.rowCount,
      startDate: imported.startDate,
      endDate: imported.endDate
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search Console data could not be imported.";
    await auditAction("gsc.data_imported", actor, "project", projectId, { error: message }, "failure");
    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}?gscImportError=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/clients/${imported.clientId}`);
  redirect(`/projects/${projectId}?gscImported=${imported.rowCount}`);
}

export async function createKeyword(formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = keywordSchema.parse(readForm(formData, ["projectId", "phrase", "group", "targetUrl"]));
  const existingKeywords = await prisma.keyword.findMany({
    where: { projectId: data.projectId },
    select: { phrase: true }
  });
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
  const existingKeywords = await prisma.keyword.findMany({
    where: { projectId: data.projectId },
    select: { phrase: true }
  });
  const existingPhrases = new Set(existingKeywords.map((keyword) => normalizedKeyword(keyword.phrase)));
  const newPhrases = phrases.filter((phrase) => !existingPhrases.has(normalizedKeyword(phrase)));
  const skipped = phrases.length - newPhrases.length;

  if (newPhrases.length > 0) {
    await prisma.keyword.createMany({
      data: newPhrases.map((phrase) => ({
        projectId: data.projectId,
        phrase,
        group: data.group,
        targetUrl: data.targetUrl
      }))
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
    const message = error instanceof Error ? error.message : "Unable to start the sandbox check.";
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
    const message = error instanceof Error ? error.message : "Unable to start the live verification.";
    const actor = await currentActor();
    await auditAction("report.live_queued", actor, "project", projectId, { error: message }, "failure");
    redirect(`/projects/${projectId}?liveError=${encodeURIComponent(message)}`);
  }

  revalidatePath("/");
  revalidatePath("/runs");
  revalidatePath(`/projects/${projectId}`);
  redirect(`/runs/${runId}`);
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
  if (data.scheduleEnabled) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { reportModules: true, gscConnectionId: true, gscPropertyUrl: true }
    });
    if (!project?.reportModules.some((module) => module === "rankings" || module === "maps" || module === "gsc")) {
      throw new Error("Enable SEO, Maps or Search Console before scheduling this report.");
    }
    if (project.reportModules.includes("gsc") && (!project.gscConnectionId || !project.gscPropertyUrl)) {
      throw new Error("Map a Search Console property before enabling its monthly schedule.");
    }
  }
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { reportModules: true } });
  if (!project) throw new Error("Report not found.");
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

export async function queueProjectRerun(clientId: string, formData: FormData) {
  let runId: string;
  try {
    const actor = await guardedActorAction("paid", paidRunRateLimit());
    const projectId = stringFromForm(formData.get("projectId"));
    runId = await enqueueProjectRerun({ projectId, requestedByEmail: actor.email, role: actor.role });
    await auditAction("report.rerun_queued", actor, "rankRun", runId, { projectId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to queue the report.";
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
  const newRunId = await retryRankRun(runId, actor.email);
  await auditAction("report.retry_queued", actor, "rankRun", newRunId, { originalRunId: runId });
  revalidatePath("/runs");
  redirect(`/runs/${newRunId}`);
}

export async function queueKeywordMetrics(projectId: string) {
  const actor = await guardedAdminAction("paid", paidRunRateLimit());
  try {
    await enqueueKeywordMetrics(projectId);
    await auditAction("keyword_metrics.queued", actor, "project", projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to queue keyword metrics.";
    await auditAction("keyword_metrics.queued", actor, "project", projectId, { error: message }, "failure");
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
  const unique = new Map<string, string>();
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => unique.set(normalizedKeyword(line), line));
  return Array.from(unique.values());
}

function normalizedKeyword(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

function readGscPropertySelection(value: FormDataEntryValue | null) {
  if (typeof value !== "string") throw new Error("Select a Search Console property.");
  try {
    return gscPropertySelectionSchema.parse(JSON.parse(value));
  } catch {
    throw new Error("Select a valid Search Console property.");
  }
}

async function guardedAdminAction(scope: string, policy: RateLimitPolicy) {
  const actor = await requireAdmin();
  await enforceRateLimit(scope, actor.email, policy);
  return actor;
}

async function guardedManagerAction(scope: string, policy: RateLimitPolicy) {
  const actor = await requireManager();
  await enforceRateLimit(scope, actor.email, policy);
  return actor;
}

async function guardedActorAction(scope: string, policy: RateLimitPolicy) {
  const actor = await currentActor();
  await enforceRateLimit(scope, actor.email, policy);
  return actor;
}

async function auditAction(
  event: string,
  actor: CurrentActor,
  entityType: string,
  entityId: string | null,
  metadata?: Record<string, string | number | boolean | string[]>,
  outcome: "success" | "failure" = "success"
) {
  await writeRequestAudit({
    event,
    outcome,
    actorEmail: actor.email,
    actorRole: actor.role,
    entityType,
    entityId,
    ...(metadata ? { metadata } : {})
  });
}

function shareExpiry(formData?: FormData) {
  const parsed = Number.parseInt(stringFromForm(formData?.get("shareExpiryDays") ?? null), 10);
  const days = [7, 30, 90, 365].includes(parsed) ? parsed : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function teamQueueError(message: string) {
  if (message.includes("days after its latest completed report")) return message;
  if (message === "This report is already queued or running.") return message;
  if (message === "Report not found." || message === "SEO and Maps rankings are not enabled for this report.") return message;
  return "This report could not be queued. A manager can review the reporting limits and configuration.";
}

function isBootstrapAdmin(email: string) {
  return environmentAdminEmails().includes(email.toLowerCase());
}

function environmentAdminEmails() {
  return (process.env.AUTH_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function requireAnotherAdministrator(userAccessId: string, email: string) {
  const [databaseAdmins, environmentAdmins] = await Promise.all([
    prisma.userAccess.count({
      where: { id: { not: userAccessId }, role: "admin", enabled: true }
    }),
    Promise.resolve(environmentAdminEmails().filter((adminEmail) => adminEmail !== email.toLowerCase()).length)
  ]);
  if (databaseAdmins + environmentAdmins === 0) throw new Error("At least one active administrator must remain.");
}
