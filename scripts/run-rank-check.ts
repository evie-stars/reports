import { prisma } from "../src/lib/db";
import { enqueueVerification } from "../src/lib/rank-queue";
import { executeSandboxRankRun } from "../src/lib/rank-runner";

/**
 * Smoke-test the DataForSEO integration with the first active keyword and area.
 *
 * `--sandbox` (default) runs immediately against the free sandbox host.
 * `--live` queues a single paid verification through the same budget reservation and worker
 * path as the application, so nothing can be spent outside the ledger.
 */
const args = new Set(process.argv.slice(2));
const mode = args.has("--live") ? "live" : "sandbox";

async function main() {
  const project = await prisma.project.findFirst({
    include: {
      keywords: { where: { active: true }, take: 1 },
      locations: { where: { active: true }, take: 1 }
    }
  });
  if (!project || project.keywords.length === 0 || project.locations.length === 0) {
    throw new Error("No project with active keywords and locations found. Run npm run db:seed or add tracking data first.");
  }

  const selection = {
    projectId: project.id,
    keywordIds: [project.keywords[0].id],
    locationIds: [project.locations[0].id],
    devices: ["desktop" as const],
    searchTypes: ["organic" as const]
  };

  if (mode === "sandbox") {
    const runId = await executeSandboxRankRun(selection);
    console.log(`Sandbox rank check completed. Run ID: ${runId}`);
    return;
  }

  const runId = await enqueueVerification({ ...selection, pageLimit: 1 }, "rank-check-script");
  console.log(`Live verification queued within the monthly budget. Run ID: ${runId}. Run "npm run rank:worker" to process it.`);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
