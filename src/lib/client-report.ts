import { Device, Prisma, SearchType } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ReportSearchParams = {
  period?: string;
  project?: string;
  area?: string;
  device?: string;
  type?: string;
  group?: string;
  keyword?: string;
};

export type ReportFilters = {
  period: "30" | "90" | "180" | "all";
  projectId?: string;
  locationId?: string;
  device?: Device;
  searchType?: SearchType;
  group?: string;
  keywordId?: string;
};

export async function getClientReportData(clientId: string, searchParams: ReportSearchParams) {
  const filters = normalizeFilters(searchParams);
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      projects: {
        orderBy: { name: "asc" },
        include: {
          keywords: { where: { active: true }, orderBy: { phrase: "asc" } },
          locations: { where: { active: true }, orderBy: { name: "asc" } }
        }
      }
    }
  });

  if (!client) return null;

  const where: Prisma.RankResultWhereInput = {
    run: {
      sandbox: false,
      status: "completed",
      project: { clientId },
      ...(filters.projectId ? { projectId: filters.projectId } : {})
    },
    keyword: {
      active: true,
      ...(filters.group ? { group: filters.group } : {})
    },
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
    ...(filters.device ? { device: filters.device } : {}),
    ...(filters.searchType ? { searchType: filters.searchType } : {})
  };

  const descendingResults = await prisma.rankResult.findMany({
    where,
    orderBy: { checkedAt: "desc" },
    take: 10000,
    include: {
      keyword: true,
      location: true,
      serpFeatures: {
        where: { type: "target_match" },
        select: { type: true }
      },
      run: { include: { project: true } }
    }
  });

  const histories = new Map<string, typeof descendingResults>();
  for (const result of descendingResults) {
    const key = resultKey(result);
    const history = histories.get(key) ?? [];
    history.push(result);
    histories.set(key, history);
  }

  const latestResults = Array.from(histories.values())
    .map((history) => enrichResult(history[0], history[1]))
    .sort((a, b) => {
      const projectOrder = a.run.project.name.localeCompare(b.run.project.name);
      return projectOrder || a.keyword.phrase.localeCompare(b.keyword.phrase) || a.location.name.localeCompare(b.location.name);
    });

  markMultipleCurrentUrls(latestResults);

  const keywordHistory = filters.keywordId
    ? descendingResults
        .filter((result) => result.keywordId === filters.keywordId)
        .slice(0, 40)
        .map((result) => ({
          id: result.id,
          checkedAt: result.checkedAt,
          rank: result.rankAbsolute ?? result.rankGroup,
          previousRank: result.previousRank,
          direction: result.direction,
          matchedUrl: result.matchedUrl,
          locationName: result.location.name,
          device: result.device,
          searchType: result.searchType,
          projectName: result.run.project.name
        }))
    : [];

  const selectedKeyword = filters.keywordId
    ? client.projects.flatMap((project) => project.keywords).find((keyword) => keyword.id === filters.keywordId) ?? null
    : null;

  const groups = Array.from(new Set(client.projects.flatMap((project) => project.keywords.map((keyword) => keyword.group).filter(Boolean))))
    .filter((group): group is string => Boolean(group))
    .sort((a, b) => a.localeCompare(b));
  const areas = Array.from(
    new Map(client.projects.flatMap((project) => project.locations).map((location) => [location.id, location])).values()
  );
  const activeKeywordCount = client.projects
    .filter((project) => !filters.projectId || project.id === filters.projectId)
    .reduce(
      (total, project) => total + project.keywords.filter((keyword) => !filters.group || keyword.group === filters.group).length,
      0
    );

  return {
    client,
    filters,
    latestResults,
    keywordHistory,
    selectedKeyword,
    trend: buildTrend(descendingResults, filters.period),
    stats: buildStats(latestResults, activeKeywordCount),
    options: {
      projects: client.projects.map((project) => ({ id: project.id, name: project.name })),
      areas: areas.map((area) => ({ id: area.id, name: area.name })),
      groups
    }
  };
}

export type ClientReportData = NonNullable<Awaited<ReturnType<typeof getClientReportData>>>;
export type CurrentReportResult = ClientReportData["latestResults"][number];

function normalizeFilters(params: ReportSearchParams): ReportFilters {
  const period = params.period === "30" || params.period === "180" || params.period === "all" ? params.period : "90";
  return {
    period,
    projectId: clean(params.project),
    locationId: clean(params.area),
    device: params.device === "desktop" || params.device === "mobile" ? params.device : undefined,
    searchType: params.type === "organic" || params.type === "local_finder" || params.type === "maps" ? params.type : undefined,
    group: clean(params.group),
    keywordId: clean(params.keyword)
  };
}

function clean(value?: string) {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function enrichResult<T extends ResultShape>(result: T, previous?: T) {
  const rank = result.rankAbsolute ?? result.rankGroup;
  const previousRank = result.previousRank ?? previous?.rankAbsolute ?? previous?.rankGroup ?? null;
  const issues: string[] = [];

  if (result.keyword.targetUrl && result.matchedUrl && !sameTargetPath(result.keyword.targetUrl, result.matchedUrl)) {
    issues.push("Wrong page");
  }
  if (previous?.matchedUrl && result.matchedUrl && normalizeUrl(previous.matchedUrl) !== normalizeUrl(result.matchedUrl)) {
    issues.push("URL changed");
  }
  if (result.serpFeatures.some((feature) => feature.type === "target_match")) {
    issues.push("Multiple URLs");
  }

  return {
    ...result,
    rank,
    previousRank,
    movement: rank !== null && previousRank !== null ? previousRank - rank : null,
    issues
  };
}

function markMultipleCurrentUrls(results: Array<ReturnType<typeof enrichResult<ResultShape>>>) {
  const urlGroups = new Map<string, Set<string>>();
  for (const result of results) {
    if (!result.matchedUrl) continue;
    const key = [result.run.projectId, result.keywordId, result.searchType, result.device].join(":");
    const urls = urlGroups.get(key) ?? new Set<string>();
    urls.add(normalizeUrl(result.matchedUrl));
    urlGroups.set(key, urls);
  }

  for (const result of results) {
    const key = [result.run.projectId, result.keywordId, result.searchType, result.device].join(":");
    if ((urlGroups.get(key)?.size ?? 0) > 1 && !result.issues.includes("Multiple URLs")) {
      result.issues.push("Multiple URLs");
    }
  }
}

function buildStats(results: Array<{ keywordId: string; rank: number | null; direction: string | null; issues: string[] }>, activeKeywords: number) {
  const topThree = new Set<string>();
  const pageOne = new Set<string>();
  const topTwenty = new Set<string>();
  const ranks: number[] = [];

  for (const result of results) {
    if (result.rank === null) continue;
    ranks.push(result.rank);
    if (result.rank <= 3) topThree.add(result.keywordId);
    if (result.rank <= 10) pageOne.add(result.keywordId);
    if (result.rank <= 20) topTwenty.add(result.keywordId);
  }

  return {
    activeKeywords,
    topThree: topThree.size,
    pageOne: pageOne.size,
    topTwenty: topTwenty.size,
    averageRank: ranks.length ? Number((ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length).toFixed(1)) : null,
    improved: results.filter((result) => result.direction === "up").length,
    declined: results.filter((result) => result.direction === "down" || result.direction === "lost").length,
    newRankings: results.filter((result) => result.direction === "new").length,
    issues: results.reduce((total, result) => total + result.issues.length, 0)
  };
}

function buildTrend(resultsDescending: ResultShape[], period: ReportFilters["period"]) {
  const days = new Map<string, ResultShape[]>();
  for (const result of [...resultsDescending].reverse()) {
    const day = isoDay(result.checkedAt);
    const entries = days.get(day) ?? [];
    entries.push(result);
    days.set(day, entries);
  }

  const cutoff = period === "all" ? null : new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000);
  const current = new Map<string, ResultShape>();
  const points: Array<{ date: string; label: string; pageOne: number; topThree: number; averageRank: number | null }> = [];

  for (const [day, entries] of days) {
    entries.forEach((entry) => current.set(resultKey(entry), entry));
    const date = new Date(`${day}T12:00:00Z`);
    if (cutoff && date < cutoff) continue;

    const currentValues = Array.from(current.values());
    const pageOne = new Set<string>();
    const topThree = new Set<string>();
    const ranks: number[] = [];
    currentValues.forEach((result) => {
      const rank = result.rankAbsolute ?? result.rankGroup;
      if (rank === null) return;
      ranks.push(rank);
      if (rank <= 10) pageOne.add(result.keywordId);
      if (rank <= 3) topThree.add(result.keywordId);
    });

    points.push({
      date: day,
      label: date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      pageOne: pageOne.size,
      topThree: topThree.size,
      averageRank: ranks.length ? Number((ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length).toFixed(1)) : null
    });
  }

  if (points.length <= 16) return points;
  const step = (points.length - 1) / 15;
  return Array.from({ length: 16 }, (_, index) => points[Math.round(index * step)]);
}

function resultKey(result: Pick<ResultShape, "keywordId" | "locationId" | "searchType" | "device" | "run">) {
  return [result.run.projectId, result.keywordId, result.locationId, result.searchType, result.device].join(":");
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function sameTargetPath(expected: string, actual: string) {
  return targetPath(expected) === targetPath(actual);
}

function targetPath(value: string) {
  try {
    return new URL(value, "https://target.local").pathname.replace(/\/$/, "") || "/";
  } catch {
    return value.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/";
  }
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();
  }
}

type ResultShape = Prisma.RankResultGetPayload<{
  include: {
    keyword: true;
    location: true;
    serpFeatures: {
      where: { type: "target_match" };
      select: { type: true };
    };
    run: { include: { project: true } };
  };
}>;
