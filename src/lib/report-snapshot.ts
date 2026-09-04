import type { Prisma } from "@prisma/client";
import type { ClientReportData, ClientReportViewData, ReportSearchParams } from "@/lib/client-report";
import { getClientReportData } from "@/lib/client-report";

const snapshotPeriod = "180" as const satisfies NonNullable<ReportSearchParams["period"]>;

type SnapshotSection = Pick<ClientReportViewData, "latestResults" | "stats" | "trend">;

export type StoredReportSnapshot = {
  version: 1;
  clientName: string;
  generatedAt: string;
  modules: Array<"rankings" | "maps" | "gsc">;
  base: ClientReportViewData;
  sections: {
    seo?: SnapshotSection;
    maps?: SnapshotSection;
  };
};

export async function buildReportSnapshot(
  clientId: string,
  modules: Array<"rankings" | "maps" | "gsc">
): Promise<Prisma.InputJsonValue> {
  const wantsSeo = modules.includes("rankings");
  const wantsMaps = modules.includes("maps");
  const wantsGsc = modules.includes("gsc");
  const [overview, seo, maps] = await Promise.all([
    getClientReportData(clientId, { period: snapshotPeriod }),
    wantsSeo ? getClientReportData(clientId, { period: snapshotPeriod, section: "seo" }) : null,
    wantsMaps ? getClientReportData(clientId, { period: snapshotPeriod, section: "maps" }) : null
  ]);

  if (!overview) throw new Error("Client not found.");
  const overviewRankings = wantsSeo && wantsMaps ? overview : wantsSeo ? seo : wantsMaps ? maps : null;
  const base = {
    options: overview.options,
    filters: { ...overview.filters, section: "overview", period: "90" },
    latestResults: (overviewRankings?.latestResults ?? []).map(snapshotResult),
    keywordHistory: [],
    selectedKeyword: null,
    trend: overviewRankings?.trend ?? [],
    stats: overviewRankings?.stats ?? emptyRankStats(),
    gsc: wantsGsc ? overview.gsc : emptyGscReport(),
    modules: {
      rankings: wantsSeo || wantsMaps,
      seo: wantsSeo,
      maps: wantsMaps,
      gsc: wantsGsc && overview.gsc.mapped,
      ga4: false
    }
  } satisfies ClientReportViewData;

  const payload: StoredReportSnapshot = {
    version: 1,
    clientName: overview.client.name,
    generatedAt: new Date().toISOString(),
    modules,
    base,
    sections: {
      ...(seo ? { seo: pickSection(seo) } : {}),
      ...(maps ? { maps: pickSection(maps) } : {})
    }
  };

  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
}

export function readReportSnapshot(payload: Prisma.JsonValue, requestedSection?: string) {
  const stored = reviveDates(payload) as unknown as StoredReportSnapshot;
  if (!stored || stored.version !== 1 || !stored.base) throw new Error("Unsupported report snapshot.");

  const section = requestedSection === "seo" && stored.sections.seo
    ? "seo"
    : requestedSection === "maps" && stored.sections.maps
      ? "maps"
      : "overview";
  const sectionData = section === "seo" ? stored.sections.seo : section === "maps" ? stored.sections.maps : undefined;
  const report = {
    ...stored.base,
    filters: { ...stored.base.filters, section },
    ...(sectionData ?? {})
  } as ClientReportViewData;

  if (section === "maps") report.gsc = emptyGscReport();
  return { stored, report };
}

export function reportSnapshotSlug(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return slug || "client-report";
}

export function reportSnapshotStatus(snapshot: { expiresAt: Date; revokedAt: Date | null }, now = new Date()) {
  if (snapshot.revokedAt) return "revoked" as const;
  if (snapshot.expiresAt <= now) return "expired" as const;
  return "active" as const;
}

function pickSection(data: ClientReportData): SnapshotSection {
  return { latestResults: data.latestResults.map(snapshotResult), stats: data.stats, trend: data.trend };
}

function snapshotResult(result: ClientReportData["latestResults"][number]) {
  return {
    id: result.id,
    keywordId: result.keywordId,
    locationId: result.locationId,
    searchType: result.searchType,
    device: result.device,
    rank: result.rank,
    previousRank: result.previousRank,
    direction: result.direction,
    movement: result.movement,
    matchedUrl: result.matchedUrl,
    checkedAt: result.checkedAt,
    issues: result.issues,
    keyword: { phrase: result.keyword.phrase, searchVolume: result.keyword.searchVolume },
    location: { name: result.location.name },
    run: { projectId: result.run.projectId, project: { name: result.run.project.name } }
  } as ClientReportData["latestResults"][number];
}

function emptyGscReport(): ClientReportViewData["gsc"] {
  return {
    mapped: false,
    latestDataDate: null,
    lastImportedAt: null,
    stats: { clicks: 0, impressions: 0, ctr: null, position: null },
    trend: []
  };
}

function emptyRankStats(): ClientReportViewData["stats"] {
  return {
    activeKeywords: 0,
    topThree: 0,
    pageOne: 0,
    topTwenty: 0,
    averageRank: null,
    improved: 0,
    declined: 0,
    newRankings: 0,
    issues: 0
  };
}

function reviveDates(value: Prisma.JsonValue): unknown {
  if (Array.isArray(value)) return value.map((item) => reviveDates(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key.endsWith("At") && typeof item === "string" && !Number.isNaN(Date.parse(item))) {
      return [key, new Date(item)];
    }
    return [key, reviveDates(item as Prisma.JsonValue)];
  }));
}
