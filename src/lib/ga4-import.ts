import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  analyticsChannelRequest,
  analyticsDailyTotalsRequest,
  analyticsDateRange,
  GA4_CHANNEL,
  GA4_DAILY_TOTAL,
  readAnalyticsRows,
  runAnalyticsReport,
  type AnalyticsReportResult,
  type AnalyticsRow
} from "@/lib/google-analytics";
import { ga4ImportLockKey, withImportLock } from "@/lib/import-lock";

/**
 * Replace the previous 90 days of GA4 data for one report: whole-property daily totals plus the same
 * metrics split by default channel group. Both reports are recorded in the API audit, and the rows
 * for the range are swapped in one transaction so a failed refresh leaves the old data untouched.
 */
export async function importProjectAnalyticsData(projectId: string) {
  return withImportLock(
    ga4ImportLockKey(projectId),
    "A Google Analytics import is already running for this report.",
    () => importProjectAnalyticsDataUnlocked(projectId)
  );
}

async function importProjectAnalyticsDataUnlocked(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { ga4Connection: true }
  });
  if (!project) throw new Error("Report not found.");
  if (!project.ga4Connection || !project.ga4PropertyId) {
    throw new Error("Map a Google Analytics property before importing data.");
  }
  // Every later write is keyed on the mapping loaded here, so a property change made while Google
  // is answering can never file the old property's data under the new one.
  const mapping = { id: projectId, ga4ConnectionId: project.ga4Connection.id, ga4PropertyId: project.ga4PropertyId };
  const encryptedRefreshToken = project.ga4Connection.encryptedRefreshToken;

  const startedAt = new Date();
  const range = analyticsDateRange(90, startedAt);
  await prisma.project.updateMany({
    where: mapping,
    data: {
      ga4ImportStatus: "running",
      ga4ImportStartedAt: startedAt,
      ga4ImportError: null
    }
  });

  try {
    const totalsResponse = await runAnalyticsReport(
      encryptedRefreshToken,
      mapping.ga4PropertyId,
      analyticsDailyTotalsRequest(range.startDate, range.endDate)
    );
    await logAnalyticsRequest(projectId, totalsResponse);
    assertReportSucceeded(totalsResponse);
    const totals = readAnalyticsRows(totalsResponse.responseBody, { withChannel: false });

    const channelResponse = await runAnalyticsReport(
      encryptedRefreshToken,
      mapping.ga4PropertyId,
      analyticsChannelRequest(range.startDate, range.endDate)
    );
    await logAnalyticsRequest(projectId, channelResponse);
    assertReportSucceeded(channelResponse);
    const channels = readAnalyticsRows(channelResponse.responseBody, { withChannel: true });

    const importedAt = new Date();
    const rangeStart = utcDate(range.startDate);
    const rangeEnd = utcDate(range.endDate);

    await prisma.$transaction(async (tx) => {
      await tx.ga4Snapshot.deleteMany({
        where: {
          projectId,
          dimension: { in: [GA4_DAILY_TOTAL, GA4_CHANNEL] },
          date: { gte: rangeStart, lte: rangeEnd }
        }
      });
      const data = [
        ...totals.map((row) => snapshotRow(projectId, GA4_DAILY_TOTAL, row)),
        ...channels.map((row) => snapshotRow(projectId, GA4_CHANNEL, row))
      ];
      if (data.length > 0) await tx.ga4Snapshot.createMany({ data, skipDuplicates: true });
      const updated = await tx.project.updateMany({
        where: mapping,
        data: {
          ga4ImportStatus: "completed",
          ga4LastImportedAt: importedAt,
          ga4ImportStartDate: rangeStart,
          ga4ImportEndDate: rangeEnd,
          ga4ImportedRows: totals.length,
          ga4ImportError: null
        }
      });
      if (updated.count === 0) throw new Error("The Google Analytics mapping changed while data was importing. Run the import again.");
      await tx.googleConnection.updateMany({
        where: { id: mapping.ga4ConnectionId },
        data: { lastValidatedAt: importedAt, lastError: null }
      });
    });

    return {
      clientId: project.clientId,
      rowCount: totals.length,
      channelRowCount: channels.length,
      startDate: range.startDate,
      endDate: range.endDate
    };
  } catch (error) {
    const message = errorMessage(error);
    // Separate statements: a connection that vanished mid-import must not stop the failure being recorded.
    await prisma.project.updateMany({
      where: mapping,
      data: { ga4ImportStatus: "failed", ga4ImportError: message }
    });
    await prisma.googleConnection.updateMany({
      where: { id: mapping.ga4ConnectionId },
      data: { lastError: message }
    });
    throw new Error(message);
  }
}

function assertReportSucceeded(response: AnalyticsReportResult) {
  const apiError = response.responseBody.error?.message;
  if (response.statusCode < 200 || response.statusCode >= 300 || apiError) {
    throw new Error(apiError || `Google Analytics returned HTTP ${response.statusCode}.`);
  }
}

function snapshotRow(projectId: string, dimension: string, row: AnalyticsRow): Prisma.Ga4SnapshotCreateManyInput {
  return {
    projectId,
    date: utcDate(row.date),
    dimension,
    channel: row.channel,
    sessions: row.sessions,
    activeUsers: row.activeUsers,
    newUsers: row.newUsers,
    engagedSessions: row.engagedSessions,
    keyEvents: row.keyEvents,
    rawData: row.raw as Prisma.InputJsonValue
  };
}

async function logAnalyticsRequest(projectId: string, response: AnalyticsReportResult) {
  await prisma.apiRequest.create({
    data: {
      provider: "google_analytics",
      endpoint: response.endpoint,
      tag: `ga4:${projectId}`,
      sandbox: false,
      requestBody: response.requestBody as unknown as Prisma.InputJsonValue,
      responseBody: response.responseBody as Prisma.InputJsonValue,
      statusCode: response.statusCode,
      costUsd: 0,
      errorMessage: response.responseBody.error?.message
    }
  });
}

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Google Analytics data could not be imported.";
}
