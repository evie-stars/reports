import { processRankQueue } from "../src/lib/rank-queue";
import { processKeywordMetricsQueue } from "../src/lib/keyword-metrics";
import { writeAuditLog } from "../src/lib/audit";
import { notificationSettings, notifyBackupHealth } from "../src/lib/notifications";
import { recordWorkerFailure, recordWorkerStart, recordWorkerSuccess } from "../src/lib/worker-health";
import { enqueueDueReportExecutions, processScheduledReportExecutions } from "../src/lib/scheduled-report-worker";

async function main() {
  await recordWorkerStart();
  try {
    const scheduled = await enqueueDueReportExecutions();
    const result = await processRankQueue();
    const reports = await processScheduledReportExecutions();
    const metrics = result.locked ? { submitted: 0, collected: 0 } : await processKeywordMetricsQueue();
    await recordWorkerSuccess({
      scheduled,
      submitted: result.processed,
      collected: result.collected ?? 0,
      metricsSubmitted: metrics.submitted,
      metricsCollected: metrics.collected,
      // Recorded so Settings can show when the worker's .env disagrees with the app's environment.
      notificationsEnabled: notificationSettings().enabled
    });
    await writeAuditLog({
      event: "worker.completed",
      actorEmail: "system",
      actorRole: "system",
      entityType: "worker",
      entityId: "rank-worker",
      metadata: { scheduled, submitted: result.processed, collected: result.collected ?? 0, ...reports }
    });
    console.log(
      `Rank worker: ${scheduled} scheduled, ${result.processed} submitted, ${result.collected ?? 0} results collected; ` +
      `${reports.gscImported} GSC imported, ${reports.gscFailed} GSC failed; ` +
      `${reports.ga4Imported} GA4 imported, ${reports.ga4Failed} GA4 failed; ` +
      `${metrics.submitted} keyword metrics submitted, ${metrics.collected} collected` +
      `${result.locked ? "; another worker owns the lock" : ""}.`
    );
    // Backups run from their own task; the worker is the process that notices when they stop.
    try {
      const alert = await notifyBackupHealth();
      if (!alert.skipped) console.log(`Backup alert: ${alert.message}`);
    } catch (error) {
      console.error("The backup health check could not run:", error instanceof Error ? error.message : error);
    }
  } catch (error) {
    await recordWorkerFailure(error);
    await writeAuditLog({
      event: "worker.failed",
      outcome: "failure",
      actorEmail: "system",
      actorRole: "system",
      entityType: "worker",
      entityId: "rank-worker",
      metadata: { error: error instanceof Error ? error.message : "Unknown worker failure." }
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
