import { Prisma, SearchType } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { DataForSeoClient, DataForSeoMode } from "../src/lib/dataforseo";
import { parseDataForSeoItems } from "../src/lib/rank-parser";

const args = new Set(process.argv.slice(2));
const mode: DataForSeoMode = args.has("--live") ? "live" : "sandbox";

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

  const keyword = project.keywords[0];
  const location = project.locations[0];
  const searchType: SearchType = "organic";
  const client = new DataForSeoClient();
  const tag = buildDataForSeoTag(project.clientId, project.id, "rank-check");

  const run = await prisma.rankRun.create({
    data: {
      projectId: project.id,
      status: "running",
      sandbox: mode === "sandbox",
      startedAt: new Date(),
      requestedTasks: 1,
      notes: `${mode} check for ${keyword.phrase} in ${location.name}`
    }
  });

  try {
    const response = await client.postSerpTask(
      searchType,
      {
        keyword: keyword.phrase,
        location_name: location.dataForSeoLocationName ?? location.name,
        language_code: "en",
        device: "desktop",
        os: "windows",
        depth: 10,
        tag
      },
      mode
    );

    await prisma.apiRequest.create({
      data: {
        rankRunId: run.id,
        endpoint: response.endpoint,
        tag: response.tag,
        sandbox: response.sandbox,
        requestBody: response.requestBody as Prisma.InputJsonValue,
        responseBody: response.responseBody as Prisma.InputJsonValue,
        statusCode: response.statusCode,
        costUsd: response.costUsd
      }
    });

    const parsedItems = parseDataForSeoItems(response.responseBody, {
      targetDomain: project.domain,
      targetBusinessName: project.targetBusinessName
    });

    await prisma.rankResult.createMany({
      data: parsedItems.slice(0, 20).map((item) => ({
        runId: run.id,
        keywordId: keyword.id,
        locationId: location.id,
        searchType,
        device: "desktop",
        rankGroup: item.rankGroup,
        rankAbsolute: item.rankAbsolute,
        matched: item.matched,
        matchedName: item.title,
        matchedUrl: item.url,
        resultTitle: item.title,
        resultUrl: item.url,
        resultDomain: item.domain,
        rawItem: item.rawItem as Prisma.InputJsonValue
      }))
    });

    await prisma.rankRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        actualCostUsd: response.costUsd
      }
    });

    console.log(`Rank check completed in ${mode} mode. Run ID: ${run.id}. Cost: $${response.costUsd}`);
  } catch (error) {
    await prisma.rankRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        notes: error instanceof Error ? error.message : "Unknown rank check failure"
      }
    });
    throw error;
  }
}

function buildDataForSeoTag(clientId: string, projectId: string, jobType: string) {
  return [clientId, projectId, jobType].map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "-")).join(":").slice(0, 255);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
