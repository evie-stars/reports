"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { listSearchConsoleSites } from "@/lib/google-search-console";
import { importProjectSearchConsoleData } from "@/lib/gsc-import";
import { actionRateLimit, gscImportRateLimit } from "@/lib/rate-limit";
import { auditAction, describeError, guardedAdminAction, guardedManagerAction } from "@/actions/shared";

const gscPropertySelectionSchema = z.object({
  connectionId: z.string().min(1),
  siteUrl: z.string().min(1)
});

export async function updateProjectGscProperty(projectId: string, formData: FormData) {
  const actor = await guardedManagerAction("integration", actionRateLimit());

  try {
    const selection = readGscPropertySelection(formData.get("gscProperty"));
    const [connection, currentProject] = await Promise.all([
      prisma.googleSearchConsoleConnection.findUnique({ where: { id: selection.connectionId } }),
      prisma.project.findUnique({ where: { id: projectId }, select: { gscConnectionId: true, gscPropertyUrl: true } })
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
    await auditAction("gsc.property_mapped", actor, "project", projectId, { accountEmail: connection.accountEmail, siteUrl: site.siteUrl });
  } catch (error) {
    const message = describeError(error, "Search Console property could not be mapped.");
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
  await auditAction("gsc.disconnected", actor, "gscConnection", connectionId, { accountEmail: connection.accountEmail });
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
    const message = describeError(error, "Search Console data could not be imported.");
    await auditAction("gsc.data_imported", actor, "project", projectId, { error: message }, "failure");
    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}?gscImportError=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/clients/${imported.clientId}`);
  redirect(`/projects/${projectId}?gscImported=${imported.rowCount}`);
}

function readGscPropertySelection(value: FormDataEntryValue | null) {
  if (typeof value !== "string") throw new Error("Select a Search Console property.");
  try {
    return gscPropertySelectionSchema.parse(JSON.parse(value));
  } catch {
    throw new Error("Select a valid Search Console property.");
  }
}
