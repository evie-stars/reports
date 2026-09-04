import { processRankQueue } from "../src/lib/rank-queue";
import { processKeywordMetricsQueue } from "../src/lib/keyword-metrics";
import { writeAuditLog } from "../src/lib/audit";
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
      metricsCollected: metrics.collected
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
      `${metrics.submitted} keyword metrics submitted, ${metrics.collected} collected` +
      `${result.locked ? "; another worker owns the lock" : ""}.`
    );
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
