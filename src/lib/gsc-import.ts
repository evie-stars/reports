import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  querySearchConsoleDailyTotals,
  readSearchConsoleDailyRows,
  searchConsoleDateRange
} from "@/lib/google-search-console";
import { gscImportLockKey, withImportLock } from "@/lib/import-lock";

const GSC_DAILY_TOTAL = "daily_total";

export async function importProjectSearchConsoleData(projectId: string) {
  return withImportLock(
    gscImportLockKey(projectId),
    "A Search Console import is already running for this report.",
    () => importProjectSearchConsoleDataUnlocked(projectId)
  );
}

async function importProjectSearchConsoleDataUnlocked(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { gscConnection: true }
  });
  if (!project) throw new Error("Report not found.");
  if (!project.gscConnection || !project.gscPropertyUrl) {
    throw new Error("Map a Search Console property before importing data.");
  }
  // Every later write is keyed on the mapping that was loaded here, so a property change made
  // while Google is answering can never file the old property's data under the new one.
  const mapping = { id: projectId, gscConnectionId: project.gscConnection.id, gscPropertyUrl: project.gscPropertyUrl };

  const startedAt = new Date();
  const range = searchConsoleDateRange(90, startedAt);
  await prisma.project.updateMany({
    where: mapping,
    data: {
      gscImportStatus: "running",
      gscImportStartedAt: startedAt,
      gscImportError: null
    }
  });

  try {
    const response = await querySearchConsoleDailyTotals(
      project.gscConnection.encryptedRefreshToken,
      project.gscPropertyUrl,
      range.startDate,
      range.endDate
    );
    await logSearchConsoleRequest(projectId, response);
    const apiError = response.responseBody.error?.message;
    if (response.statusCode < 200 || response.statusCode >= 300 || apiError) {
      throw new Error(apiError || `Google Search Console returned HTTP ${response.statusCode}.`);
    }

    const rows = readSearchConsoleDailyRows(response.responseBody);
    const importedAt = new Date();
    const rangeStart = utcDate(range.startDate);
    const rangeEnd = utcDate(range.endDate);

    await prisma.$transaction(async (tx) => {
      await tx.gscSnapshot.deleteMany({
        where: {
          projectId,
          dimension: GSC_DAILY_TOTAL,
          date: { gte: rangeStart, lte: rangeEnd }
        }
      });
      if (rows.length > 0) {
        await tx.gscSnapshot.createMany({
          data: rows.map((row) => ({
            projectId,
            date: utcDate(row.date),
            dimension: GSC_DAILY_TOTAL,
            clicks: Math.round(row.clicks),
            impressions: Math.round(row.impressions),
            ctr: row.ctr,
            position: row.position,
            rawData: row.raw as Prisma.InputJsonValue
          }))
        });
      }
      const updated = await tx.project.updateMany({
        where: mapping,
        data: {
          gscImportStatus: "completed",
          gscLastImportedAt: importedAt,
          gscImportStartDate: rangeStart,
          gscImportEndDate: rangeEnd,
          gscImportedRows: rows.length,
          gscImportError: null
        }
      });
      if (updated.count === 0) throw new Error("The Search Console mapping changed while data was importing. Run the import again.");
      await tx.googleConnection.updateMany({
        where: { id: mapping.gscConnectionId },
        data: { lastValidatedAt: importedAt, lastError: null }
      });
    });

    return {
      clientId: project.clientId,
      rowCount: rows.length,
      startDate: range.startDate,
      endDate: range.endDate
    };
  } catch (error) {
    const message = errorMessage(error);
    // Separate statements: a connection that vanished mid-import must not stop the failure being recorded.
    await prisma.project.updateMany({
      where: mapping,
      data: { gscImportStatus: "failed", gscImportError: message }
    });
    await prisma.googleConnection.updateMany({
      where: { id: mapping.gscConnectionId },
      data: { lastError: message }
    });
    throw new Error(message);
  }
}

async function logSearchConsoleRequest(
  projectId: string,
  response: Awaited<ReturnType<typeof querySearchConsoleDailyTotals>>
) {
  const errorMessage = response.responseBody.error?.message;
  await prisma.apiRequest.create({
    data: {
      provider: "google_search_console",
      endpoint: response.endpoint,
      tag: `gsc:${projectId}`,
      sandbox: false,
      requestBody: response.requestBody as Prisma.InputJsonValue,
      responseBody: response.responseBody as Prisma.InputJsonValue,
      statusCode: response.statusCode,
      costUsd: 0,
      errorMessage
    }
  });
}

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Search Console data could not be imported.";
}
