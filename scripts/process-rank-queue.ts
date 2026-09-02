import { enqueueDueSchedules, processRankQueue } from "../src/lib/rank-queue";
import { processKeywordMetricsQueue } from "../src/lib/keyword-metrics";

async function main() {
  const scheduled = await enqueueDueSchedules();
  const result = await processRankQueue();
  const metrics = result.locked ? { submitted: 0, collected: 0 } : await processKeywordMetricsQueue();
  console.log(
    `Rank worker: ${scheduled} scheduled, ${result.processed} submitted, ${result.collected ?? 0} results collected; ` +
    `${metrics.submitted} keyword metrics submitted, ${metrics.collected} collected` +
    `${result.locked ? "; another worker owns the lock" : ""}.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
