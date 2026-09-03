import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  querySearchConsoleDailyTotals,
  readSearchConsoleDailyRows,
  searchConsoleDateRange
} from "@/lib/google-search-console";

const GSC_DAILY_TOTAL = "daily_total";

export async function importProjectSearchConsoleData(projectId: string) {
  const owner = randomUUID();
  if (!(await acquireImportLock(projectId, owner))) {
    throw new Error("A Search Console import is already running for this report.");
  }

  try {
    return await importProjectSearchConsoleDataUnlocked(projectId);
  } finally {
    await releaseImportLock(projectId, owner);
  }
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

  const startedAt = new Date();
  const range = searchConsoleDateRange(90, startedAt);
  await prisma.project.update({
    where: { id: projectId },
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
      await tx.project.update({
        where: { id: projectId },
        data: {
          gscImportStatus: "completed",
          gscLastImportedAt: importedAt,
          gscImportStartDate: rangeStart,
          gscImportEndDate: rangeEnd,
          gscImportedRows: rows.length,
          gscImportError: null
        }
      });
      await tx.googleSearchConsoleConnection.update({
        where: { id: project.gscConnectionId as string },
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
    await prisma.$transaction([
      prisma.project.update({
        where: { id: projectId },
        data: { gscImportStatus: "failed", gscImportError: message }
      }),
      prisma.googleSearchConsoleConnection.update({
        where: { id: project.gscConnectionId as string },
        data: { lastError: message }
      })
    ]);
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

async function acquireImportLock(projectId: string, owner: string) {
  const key = importLockKey(projectId);
  await prisma.systemLock.upsert({
    where: { key },
    create: { key, owner: null, lockedUntil: new Date(0) },
    update: {}
  });
  const claimed = await prisma.systemLock.updateMany({
    where: { key, lockedUntil: { lt: new Date() } },
    data: { owner, lockedUntil: new Date(Date.now() + 10 * 60 * 1000) }
  });
  return claimed.count === 1;
}

async function releaseImportLock(projectId: string, owner: string) {
  await prisma.systemLock.updateMany({
    where: { key: importLockKey(projectId), owner },
    data: { owner: null, lockedUntil: new Date(0) }
  });
}

function importLockKey(projectId: string) {
  return `gsc-import:${projectId}`;
}

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Search Console data could not be imported.";
}
