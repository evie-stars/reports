import { Device, Prisma, RankDirection, SearchType } from "@prisma/client";
import { DataForSeoClient, DataForSeoMode, DataForSeoTask } from "@/lib/dataforseo";
import { prisma } from "@/lib/db";
import { MAX_SANDBOX_TASKS } from "@/lib/rank-config";
import { parseDataForSeoItems, ParsedRankItem } from "@/lib/rank-parser";

export type RankRunSelection = {
  projectId: string;
  keywordIds: string[];
  locationIds: string[];
  devices: Device[];
  searchTypes: SearchType[];
};

export type SandboxRunSelection = RankRunSelection;

export async function executeSandboxRankRun(selection: SandboxRunSelection) {
  return executeRankRun(selection, "sandbox", 1);
}

export async function executeLiveRankRun(selection: {
  projectId: string;
  keywordId: string;
  locationId: string;
  device: Device;
  searchType: SearchType;
  pageLimit: number;
}) {
  return executeRankRun(
    {
      projectId: selection.projectId,
      keywordIds: [selection.keywordId],
      locationIds: [selection.locationId],
      devices: [selection.device],
      searchTypes: [selection.searchType]
    },
    "live",
    selection.pageLimit
  );
}

export async function executeQueuedRankRun(runId: string, selection: RankRunSelection, pageLimit: number) {
  return executeRankRun(selection, "live", pageLimit, runId);
}

async function executeRankRun(
  selection: RankRunSelection,
  mode: DataForSeoMode,
  livePageLimit = 1,
  existingRunId?: string
) {
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

  if (mode === "sandbox" && requestedTasks > MAX_SANDBOX_TASKS) {
    throw new Error(`Sandbox batch limited to ${MAX_SANDBOX_TASKS} tasks. Reduce the selection and run another batch.`);
  }

  if (mode === "live" && (!Number.isInteger(livePageLimit) || livePageLimit < 1 || livePageLimit > 10)) {
    throw new Error("Live page depth must be between 1 and 10 pages.");
  }

  if (mode === "live" && project.keywords.some((keyword) => hasCostMultiplyingOperator(keyword.phrase))) {
    throw new Error("This keyword contains a search operator that can multiply DataForSEO cost. Use a plain keyword for the first live test.");
  }

  const client = new DataForSeoClient();
  client.assertSafeToRun(mode, requestedTasks);
  const modeLabel = mode === "sandbox" ? "Sandbox" : existingRunId ? "Queued live report" : "Live verification";

  const runNotes = `${modeLabel}: ${project.keywords.length} keyword(s), ${project.locations.length} location(s), ${selection.devices.length} device(s), ${selection.searchTypes.length} result type(s)${mode === "live" ? `, up to ${livePageLimit} organic result page(s)` : ""}.`;
  const run = existingRunId
    ? await prisma.rankRun.update({
        where: { id: existingRunId },
        data: { status: "running", sandbox: false, startedAt: new Date(), requestedTasks, notes: runNotes }
      })
    : await prisma.rankRun.create({
        data: {
          projectId: project.id,
          status: "running",
          sandbox: mode === "sandbox",
          source: mode === "sandbox" ? "sandbox" : "verification",
          startedAt: new Date(),
          requestedTasks,
          notes: runNotes
        }
      });

  let completedTasks = 0;
  let failedTasks = 0;
  let totalCostUsd = 0;

  for (const keyword of project.keywords) {
    for (const location of project.locations) {
      for (const device of selection.devices) {
        for (const searchType of selection.searchTypes) {
          const tag = buildDataForSeoTag(project.clientId, project.id, run.id, searchType, device);
          const task = buildDataForSeoTask(keyword.phrase, project.domain, location, device, searchType, mode, livePageLimit, tag);
          const endpoint = `/v3/serp/google/${searchType}/live/advanced`;
          let apiRequestId: string | undefined;

          try {
            const response = await client.postSerpTask(searchType, task, mode);
            const responseError = getDataForSeoError(response.responseBody, response.statusCode);

            const apiRequest = await prisma.apiRequest.create({
              data: {
                rankRunId: run.id,
                endpoint: response.endpoint,
                tag: response.tag,
                sandbox: mode === "sandbox",
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
              if (mode === "live") await pauseBetweenTasks();
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
                  create: getStoredItems(parsedItems, matchedItem, searchType).map((item) => ({
                    type: item.storedType,
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
                  sandbox: mode === "sandbox",
                  requestBody: [task] as Prisma.InputJsonValue,
                  errorMessage: errorMessage(error)
                }
              });
            }
          }

          if (mode === "live") await pauseBetweenTasks();
        }
      }
    }
  }

  const status = completedTasks === 0 ? "failed" : "completed";
  const summary = `${completedTasks} of ${requestedTasks} ${mode} task(s) completed${failedTasks ? `; ${failedTasks} failed` : ""}.`;

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

async function pauseBetweenTasks() {
  const configured = Number.parseInt(process.env.RANK_QUEUE_DELAY_MS ?? "750", 10);
  const milliseconds = Number.isFinite(configured) ? Math.max(0, Math.min(configured, 30_000)) : 750;
  if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function buildDataForSeoTask(
  keyword: string,
  targetDomain: string,
  location: {
    name: string;
    dataForSeoLocationName: string | null;
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number | null;
  },
  device: Device,
  searchType: SearchType,
  mode: DataForSeoMode,
  livePageLimit: number,
  tag: string
): DataForSeoTask {
  const locationInput = location.dataForSeoLocationName
    ? { location_name: location.dataForSeoLocationName }
    : location.latitude !== null && location.longitude !== null
      ? { location_coordinate: `${location.latitude},${location.longitude},${location.radiusMeters ?? 5000}` }
      : { location_name: location.name };

  const organicCrawlOptions = mode === "live" && searchType === "organic"
    ? {
        depth: livePageLimit * 10,
        max_crawl_pages: livePageLimit,
        stop_crawl_on_match: [
          {
            match_value: normalizeMatchDomain(targetDomain),
            match_type: "with_subdomains" as const
          }
        ],
        find_targets_in: ["organic"]
      }
    : { depth: getDepth(searchType, device, mode) };

  return {
    keyword,
    ...locationInput,
    language_code: "en",
    device,
    os: device === "mobile" ? "android" : "windows",
    ...organicCrawlOptions,
    tag
  };
}

function getDepth(searchType: SearchType, device: Device, mode: DataForSeoMode) {
  if (mode === "sandbox") return 20;
  if (searchType === "organic") return 10;
  if (searchType === "local_finder") return device === "mobile" ? 10 : 20;
  return 20;
}

function hasCostMultiplyingOperator(keyword: string) {
  return /(^|\s)-?(allinanchor|allintext|allintitle|allinurl|cache|define|definition|filetype|inanchor|info|intext|intitle|inurl|link|site):/i.test(keyword);
}

function normalizeMatchDomain(domain: string) {
  try {
    return new URL(domain.includes("://") ? domain : `https://${domain}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
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

function getStoredItems(items: ParsedRankItem[], bestMatch: ParsedRankItem | undefined, searchType: SearchType) {
  const serpFeatures = searchType === "organic"
    ? items.filter((item) => item.type !== "organic").map((item) => ({ ...item, storedType: item.type }))
    : [];
  const additionalTargets = items
    .filter((item) => item.matched && item.url && item.url !== bestMatch?.url)
    .map((item) => ({ ...item, storedType: "target_match" }));

  return [...serpFeatures, ...additionalTargets].slice(0, 50);
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
  return error instanceof Error ? error.message : "Unknown rank request failure.";
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
