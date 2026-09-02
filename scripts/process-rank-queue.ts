import { enqueueDueSchedules, processRankQueue } from "../src/lib/rank-queue";

async function main() {
  const scheduled = await enqueueDueSchedules();
  const result = await processRankQueue();
  console.log(`Rank worker: ${scheduled} scheduled, ${result.processed} processed${result.locked ? "; another worker owns the lock" : ""}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
