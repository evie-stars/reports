import { prisma } from "../src/lib/db";

/**
 * Report rows that would violate the unique constraints introduced with the schema hardening.
 * Run this before `npm run db:push` on an existing database; it exits non-zero when duplicates exist.
 */
type KeywordDuplicate = { projectId: string; phrase: string; count: bigint };
type ResultDuplicate = { runId: string; keywordId: string; locationId: string; searchType: string; device: string; count: bigint };

async function main() {
  const keywords = await prisma.$queryRaw<KeywordDuplicate[]>`
    SELECT "projectId", "phrase", COUNT(*)::bigint AS "count"
    FROM "Keyword"
    GROUP BY "projectId", "phrase"
    HAVING COUNT(*) > 1
  `;
  const results = await prisma.$queryRaw<ResultDuplicate[]>`
    SELECT "runId", "keywordId", "locationId", "searchType"::text, "device"::text, COUNT(*)::bigint AS "count"
    FROM "RankResult"
    GROUP BY "runId", "keywordId", "locationId", "searchType", "device"
    HAVING COUNT(*) > 1
  `;

  if (keywords.length === 0 && results.length === 0) {
    console.log("No duplicates found. It is safe to run npm run db:push.");
    return;
  }

  if (keywords.length > 0) {
    console.log(`Duplicate keywords (${keywords.length} project/phrase pairs):`);
    for (const row of keywords) console.log(`  project ${row.projectId} · "${row.phrase}" × ${row.count}`);
  }
  if (results.length > 0) {
    console.log(`Duplicate rank results (${results.length} run/keyword/area/type/device combinations):`);
    for (const row of results) {
      console.log(`  run ${row.runId} · keyword ${row.keywordId} · area ${row.locationId} · ${row.searchType}/${row.device} × ${row.count}`);
    }
  }
  console.log("Resolve these before running npm run db:push, otherwise the unique constraints will fail to apply.");
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
