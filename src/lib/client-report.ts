import { Device, Prisma, ReportModule, SearchType } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ReportSearchParams = {
  period?: string;
  project?: string;
  area?: string;
  device?: string;
  type?: string;
  group?: string;
  keyword?: string;
  sort?: string;
  dir?: string;
};

export type ReportFilters = {
  period: "30" | "90" | "180" | "all";
  projectId?: string;
  locationId?: string;
  device?: Device;
  searchType?: SearchType;
  group?: string;
  keywordId?: string;
  sort: "keyword" | "area" | "current";
  sortDirection: "asc" | "desc";
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

  const selectedProjects = client.projects.filter((project) => !filters.projectId || project.id === filters.projectId);
  const enabledModules = new Set(selectedProjects.flatMap((project) => project.reportModules));

  const where: Prisma.RankResultWhereInput = {
    run: {
      sandbox: false,
      status: "completed",
      project: { clientId, reportModules: { has: ReportModule.rankings } },
      ...(filters.projectId ? { projectId: filters.projectId } : {})
    },
    keyword: {
      active: true,
      ...(filters.group ? { group: filters.group } : {})
    },
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
    ...(filters.device ? { device: filters.device } : {}),
    searchType: filters.searchType ? filters.searchType : { in: [SearchType.organic, SearchType.maps] }
  };
  const gscCutoff = gscDateCutoff(filters.period);

  const [descendingResults, gscSnapshots] = await Promise.all([
    prisma.rankResult.findMany({
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
    }),
    prisma.gscSnapshot.findMany({
      where: {
        dimension: "daily_total",
        project: {
          clientId,
          gscPropertyUrl: { not: null },
          reportModules: { has: ReportModule.gsc },
          ...(filters.projectId ? { id: filters.projectId } : {})
        },
        ...(gscCutoff ? { date: { gte: gscCutoff } } : {})
      },
      orderBy: { date: "asc" }
    })
  ]);

  const histories = new Map<string, typeof descendingResults>();
  for (const result of descendingResults) {
    const key = resultKey(result);
    const history = histories.get(key) ?? [];
    history.push(result);
    histories.set(key, history);
  }

  const latestResults = Array.from(histories.values()).map((history) => enrichResult(history[0], history[1]));

  markMultipleCurrentUrls(latestResults);
  sortCurrentResults(latestResults, filters);

  const keywordHistory = filters.keywordId
    ? descendingResults
        .filter((result) => result.keywordId === filters.keywordId)
        .slice(0, 40)
        .map((result) => ({
          id: result.id,
          runId: result.runId,
          projectId: result.run.projectId,
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
    .filter((project) => (!filters.projectId || project.id === filters.projectId) && project.reportModules.includes(ReportModule.rankings))
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
    gsc: buildGscReport(
      gscSnapshots,
      selectedProjects.some((project) => Boolean(project.gscPropertyUrl)),
      latestDate(selectedProjects.map((project) => project.gscLastImportedAt))
    ),
    stats: buildStats(latestResults, activeKeywordCount),
    modules: {
      rankings: enabledModules.has(ReportModule.rankings),
      gsc: enabledModules.has(ReportModule.gsc),
      ga4: enabledModules.has(ReportModule.ga4)
    },
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
    keywordId: clean(params.keyword),
    sort: params.sort === "keyword" || params.sort === "area" ? params.sort : "current",
    sortDirection: params.dir === "desc" ? "desc" : "asc"
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

function sortCurrentResults(results: Array<ReturnType<typeof enrichResult<ResultShape>>>, filters: ReportFilters) {
  const direction = filters.sortDirection === "asc" ? 1 : -1;
  results.sort((left, right) => {
    let comparison = 0;
    if (filters.sort === "area") comparison = left.location.name.localeCompare(right.location.name);
    if (filters.sort === "keyword") comparison = left.keyword.phrase.localeCompare(right.keyword.phrase);
    if (filters.sort === "current") {
      if (left.rank === null && right.rank !== null) return 1;
      if (left.rank !== null && right.rank === null) return -1;
      comparison = (left.rank ?? 0) - (right.rank ?? 0);
    }

    if (comparison !== 0) return comparison * direction;
    return left.keyword.phrase.localeCompare(right.keyword.phrase) || left.location.name.localeCompare(right.location.name);
  });
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

  const latestCheck = resultsDescending[0]?.checkedAt;
  const cutoff = period === "all" || !latestCheck
    ? null
    : new Date(latestCheck.getTime() - Number(period) * 24 * 60 * 60 * 1000);
  const current = new Map<string, ResultShape>();
  const points: Array<{
    date: string;
    label: string;
    first: number;
    twoToThree: number;
    fourToTen: number;
    elevenToTwenty: number;
    twentyOneToThirty: number;
    beyondThirty: number;
    total: number;
    pageOne: number;
    topThree: number;
    averageRank: number | null;
  }> = [];

  for (const [day, entries] of days) {
    entries.forEach((entry) => current.set(resultKey(entry), entry));
    const date = new Date(`${day}T12:00:00Z`);
    if (cutoff && date < cutoff) continue;

    const currentValues = Array.from(current.values());
    const bestRankByKeyword = new Map<string, number | null>();
    currentValues.forEach((result) => {
      const rank = result.rankAbsolute ?? result.rankGroup;
      const key = `${result.run.projectId}:${result.keywordId}`;
      const currentBest = bestRankByKeyword.get(key);
      if (!bestRankByKeyword.has(key) || (rank !== null && (currentBest === null || currentBest === undefined || rank < currentBest))) {
        bestRankByKeyword.set(key, rank);
      }
    });
    const ranks = Array.from(bestRankByKeyword.values());
    const ranked = ranks.filter((rank): rank is number => rank !== null);
    const buckets = countPositionBuckets(ranks);

    points.push({
      date: day,
      label: date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      ...buckets,
      total: ranks.length,
      pageOne: buckets.first + buckets.twoToThree + buckets.fourToTen,
      topThree: buckets.first + buckets.twoToThree,
      averageRank: ranked.length ? Number((ranked.reduce((sum, rank) => sum + rank, 0) / ranked.length).toFixed(1)) : null
    });
  }

  if (points.length <= 16) return points;
  const step = (points.length - 1) / 15;
  return Array.from({ length: 16 }, (_, index) => points[Math.round(index * step)]);
}

export function countPositionBuckets(ranks: Array<number | null>) {
  return {
    first: ranks.filter((rank) => rank === 1).length,
    twoToThree: ranks.filter((rank) => rank !== null && rank >= 2 && rank <= 3).length,
    fourToTen: ranks.filter((rank) => rank !== null && rank >= 4 && rank <= 10).length,
    elevenToTwenty: ranks.filter((rank) => rank !== null && rank >= 11 && rank <= 20).length,
    twentyOneToThirty: ranks.filter((rank) => rank !== null && rank >= 21 && rank <= 30).length,
    beyondThirty: ranks.filter((rank) => rank === null || rank > 30).length
  };
}

export function buildGscReport(
  snapshots: Array<{ date: Date; clicks: number; impressions: number; position: number | null }>,
  mapped: boolean,
  lastImportedAt: Date | null
) {
  const dates = new Map<string, { date: Date; clicks: number; impressions: number; weightedPosition: number }>();
  for (const snapshot of snapshots) {
    const key = isoDay(snapshot.date);
    const current = dates.get(key) ?? { date: snapshot.date, clicks: 0, impressions: 0, weightedPosition: 0 };
    current.clicks += snapshot.clicks;
    current.impressions += snapshot.impressions;
    current.weightedPosition += (snapshot.position ?? 0) * snapshot.impressions;
    dates.set(key, current);
  }

  const trend = Array.from(dates.values()).map((entry) => ({
    date: isoDay(entry.date),
    label: entry.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    clicks: entry.clicks,
    impressions: entry.impressions,
    ctr: entry.impressions > 0 ? entry.clicks / entry.impressions : 0,
    position: entry.impressions > 0 ? entry.weightedPosition / entry.impressions : null
  }));
  const clicks = trend.reduce((total, point) => total + point.clicks, 0);
  const impressions = trend.reduce((total, point) => total + point.impressions, 0);
  const weightedPosition = trend.reduce(
    (total, point) => total + (point.position ?? 0) * point.impressions,
    0
  );

  return {
    mapped,
    lastImportedAt,
    latestDataDate: trend.at(-1)?.date ?? null,
    stats: {
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : null,
      position: impressions > 0 ? weightedPosition / impressions : null
    },
    trend
  };
}

function gscDateCutoff(period: ReportFilters["period"]) {
  if (period === "all") return null;
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - (Number(period) - 1));
  return cutoff;
}

function latestDate(values: Array<Date | null>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    return !latest || value > latest ? value : latest;
  }, null);
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
