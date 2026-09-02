import { Device, Prisma, RankDirection, SearchType } from "@prisma/client";
import { DataForSeoClient, DataForSeoTask } from "@/lib/dataforseo";
import { prisma } from "@/lib/db";
import { MAX_SANDBOX_TASKS } from "@/lib/rank-config";
import { parseDataForSeoItems, ParsedRankItem } from "@/lib/rank-parser";

export type SandboxRunSelection = {
  projectId: string;
  keywordIds: string[];
  locationIds: string[];
  devices: Device[];
  searchTypes: SearchType[];
};

export async function executeSandboxRankRun(selection: SandboxRunSelection) {
  const project = await prisma.project.findUnique({
    where: { id: selection.projectId },
    include: {
      keywords: {
        where: { id: { in: selection.keywordIds }, active: true },
        orderBy: { phrase: "asc" }
      },
      locations: {
        where: { id: { in: selection.locationIds }, active: true },
        orderBy: { name: "asc" }
      }
    }
  });

  if (!project) throw new Error("Project not found.");
  if (project.keywords.length === 0) throw new Error("Select at least one active keyword.");
  if (project.locations.length === 0) throw new Error("Select at least one active location.");
  if (selection.devices.length === 0) throw new Error("Select at least one device.");
  if (selection.searchTypes.length === 0) throw new Error("Select at least one result type.");

  const requestedTasks =
    project.keywords.length * project.locations.length * selection.devices.length * selection.searchTypes.length;

  if (requestedTasks > MAX_SANDBOX_TASKS) {
    throw new Error(`Sandbox batch limited to ${MAX_SANDBOX_TASKS} tasks. Reduce the selection and run another batch.`);
  }

  const run = await prisma.rankRun.create({
    data: {
      projectId: project.id,
      status: "running",
      sandbox: true,
      startedAt: new Date(),
      requestedTasks,
      notes: `Sandbox batch: ${project.keywords.length} keyword(s), ${project.locations.length} location(s), ${selection.devices.length} device(s), ${selection.searchTypes.length} result type(s).`
    }
  });

  const client = new DataForSeoClient();
  let completedTasks = 0;
  let failedTasks = 0;
  let totalCostUsd = 0;

  for (const keyword of project.keywords) {
    for (const location of project.locations) {
      for (const device of selection.devices) {
        for (const searchType of selection.searchTypes) {
          const tag = buildDataForSeoTag(project.clientId, project.id, run.id, searchType, device);
          const task = buildTask(keyword.phrase, location, device, tag);
          const endpoint = `/v3/serp/google/${searchType}/live/advanced`;
          let apiRequestId: string | undefined;

          try {
            const response = await client.postSerpTask(searchType, task, "sandbox");
            const responseError = getDataForSeoError(response.responseBody, response.statusCode);

            const apiRequest = await prisma.apiRequest.create({
              data: {
                rankRunId: run.id,
                endpoint: response.endpoint,
                tag: response.tag,
                sandbox: true,
                requestBody: response.requestBody as Prisma.InputJsonValue,
                responseBody: response.responseBody as Prisma.InputJsonValue,
                statusCode: response.statusCode,
                costUsd: response.costUsd,
                errorMessage: responseError
              }
            });
            apiRequestId = apiRequest.id;

            totalCostUsd += response.costUsd;

            if (responseError) {
              failedTasks += 1;
              continue;
            }

            const parsedItems = parseDataForSeoItems(response.responseBody, {
              targetDomain: project.domain,
              targetBusinessName: project.targetBusinessName
            });
            const matchedItem = bestMatchedItem(parsedItems);
            const previousResult = await findPreviousResult(keyword.id, location.id, searchType, device);
            const previousRank = previousResult?.rankAbsolute ?? previousResult?.rankGroup ?? null;
            const currentRank = matchedItem?.rankAbsolute ?? matchedItem?.rankGroup ?? null;

            await prisma.rankResult.create({
              data: {
                runId: run.id,
                keywordId: keyword.id,
                locationId: location.id,
                searchType,
                device,
                rankGroup: matchedItem?.rankGroup,
                rankAbsolute: matchedItem?.rankAbsolute,
                matched: Boolean(matchedItem),
                matchedName: matchedItem?.title,
                matchedUrl: matchedItem?.url,
                resultTitle: matchedItem?.title,
                resultUrl: matchedItem?.url,
                resultDomain: matchedItem?.domain,
                direction: getDirection(currentRank, previousRank),
                previousRank,
                ...(matchedItem ? { rawItem: matchedItem.rawItem as Prisma.InputJsonValue } : {}),
                serpFeatures: {
                  create: getSerpFeatures(parsedItems, searchType).map((item) => ({
                    type: item.type,
                    title: item.title,
                    url: item.url,
                    rankGroup: item.rankGroup,
                    rankAbsolute: item.rankAbsolute,
                    rawItem: item.rawItem as Prisma.InputJsonValue
                  }))
                }
              }
            });

            completedTasks += 1;
          } catch (error) {
            failedTasks += 1;
            if (apiRequestId) {
              await prisma.apiRequest.update({
                where: { id: apiRequestId },
                data: { errorMessage: `Result storage failed: ${errorMessage(error)}` }
              });
            } else {
              await prisma.apiRequest.create({
                data: {
                  rankRunId: run.id,
                  endpoint,
                  tag,
                  sandbox: true,
                  requestBody: [task] as Prisma.InputJsonValue,
                  errorMessage: errorMessage(error)
                }
              });
            }
          }
        }
      }
    }
  }

  const status = completedTasks === 0 ? "failed" : "completed";
  const summary = `${completedTasks} of ${requestedTasks} sandbox task(s) completed${failedTasks ? `; ${failedTasks} failed` : ""}.`;

  await prisma.rankRun.update({
    where: { id: run.id },
    data: {
      status,
      completedAt: new Date(),
      actualCostUsd: totalCostUsd,
      notes: `${run.notes} ${summary}`
    }
  });

  return run.id;
}

function buildTask(
  keyword: string,
  location: {
    name: string;
    dataForSeoLocationName: string | null;
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number | null;
  },
  device: Device,
  tag: string
): DataForSeoTask {
  const locationInput = location.dataForSeoLocationName
    ? { location_name: location.dataForSeoLocationName }
    : location.latitude !== null && location.longitude !== null
      ? { location_coordinate: `${location.latitude},${location.longitude},${location.radiusMeters ?? 5000}` }
      : { location_name: location.name };

  return {
    keyword,
    ...locationInput,
    language_code: "en",
    device,
    os: device === "mobile" ? "android" : "windows",
    depth: 20,
    tag
  };
}

async function findPreviousResult(keywordId: string, locationId: string, searchType: SearchType, device: Device) {
  return prisma.rankResult.findFirst({
    where: { keywordId, locationId, searchType, device },
    orderBy: { checkedAt: "desc" },
    select: { matched: true, rankAbsolute: true, rankGroup: true }
  });
}

function bestMatchedItem(items: ParsedRankItem[]) {
  return items
    .filter((item) => item.matched)
    .sort((a, b) => (a.rankAbsolute ?? a.rankGroup ?? Number.MAX_SAFE_INTEGER) - (b.rankAbsolute ?? b.rankGroup ?? Number.MAX_SAFE_INTEGER))[0];
}

function getSerpFeatures(items: ParsedRankItem[], searchType: SearchType) {
  if (searchType !== "organic") return [];
  return items.filter((item) => item.type !== "organic").slice(0, 50);
}

function getDirection(currentRank: number | null, previousRank: number | null): RankDirection | null {
  if (currentRank === null && previousRank === null) return null;
  if (currentRank === null) return "lost";
  if (previousRank === null) return "new";
  if (currentRank < previousRank) return "up";
  if (currentRank > previousRank) return "down";
  return "unchanged";
}

function getDataForSeoError(responseBody: unknown, statusCode: number) {
  if (statusCode >= 400) return `HTTP ${statusCode} returned by DataForSEO.`;
  const body = asRecord(responseBody);
  const rootCode = numberValue(body?.status_code);
  if (rootCode && rootCode >= 40000) return stringValue(body?.status_message) ?? `DataForSEO status ${rootCode}.`;

  const tasks = body?.tasks;
  if (!Array.isArray(tasks)) return null;

  for (const task of tasks) {
    const taskRecord = asRecord(task);
    const taskCode = numberValue(taskRecord?.status_code);
    if (taskCode && taskCode >= 40000) {
      return stringValue(taskRecord?.status_message) ?? `DataForSEO task status ${taskCode}.`;
    }
  }

  return null;
}

function buildDataForSeoTag(
  clientId: string,
  projectId: string,
  runId: string,
  searchType: SearchType,
  device: Device
) {
  return [clientId, projectId, runId, searchType, device]
    .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "-"))
    .join(":")
    .slice(0, 255);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown sandbox request failure.";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}
