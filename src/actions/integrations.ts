"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { importProjectAnalyticsData } from "@/lib/ga4-import";
import { GA4_READONLY_SCOPE, isAnalyticsPropertyId, listAnalyticsProperties } from "@/lib/google-analytics";
import { connectionHasScope, GSC_READONLY_SCOPE } from "@/lib/google-oauth";
import { listSearchConsoleSites } from "@/lib/google-search-console";
import { importProjectSearchConsoleData } from "@/lib/gsc-import";
import { ga4ImportLockKey, gscImportLockKey, withImportLock } from "@/lib/import-lock";
import { actionRateLimit, ga4ImportRateLimit, gscImportRateLimit } from "@/lib/rate-limit";
import { auditAction, describeError, guardedAdminAction, guardedManagerAction } from "@/actions/shared";

const gscPropertySelectionSchema = z.object({
  connectionId: z.string().min(1),
  siteUrl: z.string().min(1)
});

const ga4PropertySelectionSchema = z.object({
  connectionId: z.string().min(1),
  propertyId: z.string().refine(isAnalyticsPropertyId, "Select a valid Google Analytics property.")
});

const GSC_MAPPING_BUSY = "A Search Console import is running for this report. Try again in a few minutes.";
const GA4_MAPPING_BUSY = "A Google Analytics import is running for this report. Try again in a few minutes.";

export async function updateProjectGscProperty(projectId: string, formData: FormData) {
  const actor = await guardedManagerAction("integration", actionRateLimit());

  try {
    const selection = readSelection(formData.get("gscProperty"), gscPropertySelectionSchema, "Search Console");
    // The mapping and any import share one lock so a change can never land in the middle of a refresh.
    const mapped = await withImportLock(gscImportLockKey(projectId), GSC_MAPPING_BUSY, async () => {
      const [connection, currentProject] = await Promise.all([
        prisma.googleConnection.findUnique({ where: { id: selection.connectionId } }),
        prisma.project.findUnique({ where: { id: projectId }, select: { gscConnectionId: true, gscPropertyUrl: true } })
      ]);
      if (!connection) throw new Error("That Google account is no longer connected.");
      if (!connectionHasScope(connection, GSC_READONLY_SCOPE)) throw new Error("That Google account has not granted Search Console access.");
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
        await tx.googleConnection.update({
          where: { id: connection.id },
          data: { lastValidatedAt: new Date(), lastError: null }
        });
      });
      return { accountEmail: connection.accountEmail, siteUrl: site.siteUrl };
    });
    await auditAction("gsc.property_mapped", actor, "project", projectId, mapped);
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
  try {
    await withImportLock(gscImportLockKey(projectId), GSC_MAPPING_BUSY, () =>
      prisma.project.update({
        where: { id: projectId },
        data: {
          gscConnectionId: null,
          gscPropertyUrl: null,
          gscPermissionLevel: null,
          gscConnectedAt: null,
          gscImportStatus: "idle",
          gscImportError: null
        }
      })
    );
    await auditAction("gsc.property_unmapped", actor, "project", projectId);
  } catch (error) {
    const message = describeError(error, "Search Console mapping could not be removed.");
    await auditAction("gsc.property_unmapped", actor, "project", projectId, { error: message }, "failure");
    redirect(`/projects/${projectId}?gscError=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/projects/${projectId}`);
}

export async function updateProjectGa4Property(projectId: string, formData: FormData) {
  const actor = await guardedManagerAction("integration", actionRateLimit());

  try {
    const selection = readSelection(formData.get("ga4Property"), ga4PropertySelectionSchema, "Google Analytics");
    const mapped = await withImportLock(ga4ImportLockKey(projectId), GA4_MAPPING_BUSY, async () => {
      const [connection, currentProject] = await Promise.all([
        prisma.googleConnection.findUnique({ where: { id: selection.connectionId } }),
        prisma.project.findUnique({ where: { id: projectId }, select: { ga4ConnectionId: true, ga4PropertyId: true } })
      ]);
      if (!connection) throw new Error("That Google account is no longer connected.");
      if (!connectionHasScope(connection, GA4_READONLY_SCOPE)) throw new Error("That Google account has not granted Analytics access.");
      if (!currentProject) throw new Error("Report not found.");

      // The posted display name is never trusted; the property must be listed for the connected account.
      const properties = await listAnalyticsProperties(connection.encryptedRefreshToken);
      const property = properties.find((candidate) => candidate.propertyId === selection.propertyId);
      if (!property) throw new Error("That Google Analytics property is not available to the connected Google account.");

      const propertyChanged = currentProject.ga4ConnectionId !== connection.id || currentProject.ga4PropertyId !== property.propertyId;
      await prisma.$transaction(async (tx) => {
        if (propertyChanged) await tx.ga4Snapshot.deleteMany({ where: { projectId } });
        await tx.project.update({
          where: { id: projectId },
          data: {
            ga4ConnectionId: connection.id,
            ga4PropertyId: property.propertyId,
            ga4PropertyName: property.displayName,
            ga4AccountName: property.accountName,
            ga4ConnectedAt: new Date(),
            ...(propertyChanged ? {
              ga4ImportStatus: "idle",
              ga4ImportStartedAt: null,
              ga4LastImportedAt: null,
              ga4ImportStartDate: null,
              ga4ImportEndDate: null,
              ga4ImportedRows: 0,
              ga4ImportError: null
            } : {})
          }
        });
        await tx.googleConnection.update({
          where: { id: connection.id },
          data: { lastValidatedAt: new Date(), lastError: null }
        });
      });
      return { accountEmail: connection.accountEmail, propertyId: property.propertyId, propertyName: property.displayName };
    });
    await auditAction("ga4.property_mapped", actor, "project", projectId, mapped);
  } catch (error) {
    const message = describeError(error, "Google Analytics property could not be mapped.");
    await auditAction("ga4.property_mapped", actor, "project", projectId, { error: message }, "failure");
    redirect(`/projects/${projectId}?ga4Error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}?ga4Mapped=1`);
}

export async function disconnectProjectGa4Property(projectId: string) {
  const actor = await guardedManagerAction("integration", actionRateLimit());
  try {
    await withImportLock(ga4ImportLockKey(projectId), GA4_MAPPING_BUSY, () =>
      prisma.project.update({
        where: { id: projectId },
        data: {
          ga4ConnectionId: null,
          ga4PropertyId: null,
          ga4PropertyName: null,
          ga4AccountName: null,
          ga4ConnectedAt: null,
          ga4ImportStatus: "idle",
          ga4ImportError: null
        }
      })
    );
    await auditAction("ga4.property_unmapped", actor, "project", projectId);
  } catch (error) {
    const message = describeError(error, "Google Analytics mapping could not be removed.");
    await auditAction("ga4.property_unmapped", actor, "project", projectId, { error: message }, "failure");
    redirect(`/projects/${projectId}?ga4Error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/projects/${projectId}`);
}

/** Remove a Google account entirely: its Search Console and Analytics mappings are cleared per foreign key. */
export async function disconnectGoogleConnection(connectionId: string) {
  const actor = await guardedAdminAction("integration", actionRateLimit());
  const connection = await prisma.googleConnection.findUnique({
    where: { id: connectionId },
    select: { accountEmail: true, grantedScopes: true }
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
    prisma.project.updateMany({
      where: { ga4ConnectionId: connectionId },
      data: {
        ga4ConnectionId: null,
        ga4PropertyId: null,
        ga4PropertyName: null,
        ga4AccountName: null,
        ga4ConnectedAt: null,
        ga4ImportStatus: "idle",
        ga4ImportError: null
      }
    }),
    prisma.googleConnection.delete({ where: { id: connectionId } })
  ]);
  await auditAction("google.disconnected", actor, "googleConnection", connectionId, {
    accountEmail: connection.accountEmail,
    grantedScopes: connection.grantedScopes
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
    const message = describeError(error, "Search Console data could not be imported.");
    await auditAction("gsc.data_imported", actor, "project", projectId, { error: message }, "failure");
    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}?gscImportError=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/clients/${imported.clientId}`);
  redirect(`/projects/${projectId}?gscImported=${imported.rowCount}`);
}

export async function importProjectGa4Data(projectId: string) {
  const actor = await guardedManagerAction("ga4-import", ga4ImportRateLimit());
  let imported: Awaited<ReturnType<typeof importProjectAnalyticsData>>;

  try {
    imported = await importProjectAnalyticsData(projectId);
    await auditAction("ga4.data_imported", actor, "project", projectId, {
      rowCount: imported.rowCount,
      channelRowCount: imported.channelRowCount,
      startDate: imported.startDate,
      endDate: imported.endDate
    });
  } catch (error) {
    const message = describeError(error, "Google Analytics data could not be imported.");
    await auditAction("ga4.data_imported", actor, "project", projectId, { error: message }, "failure");
    revalidatePath(`/projects/${projectId}`);
    redirect(`/projects/${projectId}?ga4ImportError=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/clients/${imported.clientId}`);
  redirect(`/projects/${projectId}?ga4Imported=${imported.rowCount}`);
}

function readSelection<T>(value: FormDataEntryValue | null, schema: z.ZodType<T>, label: string): T {
  if (typeof value !== "string") throw new Error(`Select a ${label} property.`);
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    throw new Error(`Select a valid ${label} property.`);
  }
}
