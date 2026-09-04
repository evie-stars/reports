import { Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { movementDirection } from "@/lib/dataforseo-response";
import { prisma } from "@/lib/db";

const IMPORT_SOURCE = "legacy_rank_history_csv";

type HistoricalSnapshot = {
  checkedAt: Date;
  rank: number | null;
  rankLabel: string;
  matchedUrl: string | null;
};

type HistoricalRow = {
  keyword: string;
  domain: string;
  location: string;
  snapshots: HistoricalSnapshot[];
};

export type ParsedRankHistory = {
  clientName: string;
  domain: string;
  rows: HistoricalRow[];
  dates: Date[];
  keywords: string[];
  locations: string[];
  resultCount: number;
};

export function parseRankHistoryCsv(csvText: string): ParsedRankHistory {
  const records = parse(csvText, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true
  }) as string[][];

  if (records.length < 3) throw new Error("The CSV does not contain any ranking rows.");

  const clientName = clean(records[0]?.[0]);
  const header = records[1]?.map(clean) ?? [];
  if (!clientName) throw new Error("The client name is missing from the first row.");
  if (header[0]?.toLowerCase() !== "keywords" || header[1]?.toLowerCase() !== "domain" || header[2]?.toLowerCase() !== "search location") {
    throw new Error("The CSV must begin with Keywords, Domain and Search Location columns.");
  }
  if (header.length < 6 || (header.length - 3) % 3 !== 0) {
    throw new Error("Historical columns must repeat in Date, Ranking and Ranked URL groups.");
  }

  for (let index = 3; index < header.length; index += 3) {
    if (header[index]?.toLowerCase() !== "date" || header[index + 1]?.toLowerCase() !== "ranking" || header[index + 2]?.toLowerCase() !== "ranked url") {
      throw new Error(`Columns ${index + 1}-${index + 3} must be Date, Ranking and Ranked URL.`);
    }
  }

  const rows: HistoricalRow[] = [];
  const pairKeys = new Set<string>();
  const domains = new Set<string>();

  records.slice(2).forEach((record, rowOffset) => {
    const rowNumber = rowOffset + 3;
    const keyword = clean(record[0]);
    const domain = normalizeDomain(clean(record[1]));
    const location = clean(record[2]);
    if (!keyword && !domain && !location) return;
    if (!keyword || !domain || !location) throw new Error(`Row ${rowNumber} is missing a keyword, domain or search location.`);

    const pairKey = `${keyword.toLowerCase()}::${location.toLowerCase()}`;
    if (pairKeys.has(pairKey)) throw new Error(`Row ${rowNumber} duplicates the keyword and location combination “${keyword} / ${location}”.`);
    pairKeys.add(pairKey);
    domains.add(domain);

    const snapshots: HistoricalSnapshot[] = [];
    for (let column = 3; column < header.length; column += 3) {
      const dateText = clean(record[column]);
      const rankText = clean(record[column + 1]);
      const urlText = clean(record[column + 2]);
      if (!dateText && !rankText && !urlText) continue;
      if (!dateText) throw new Error(`Row ${rowNumber}, column ${column + 1} has a ranking without a date.`);

      const checkedAt = parseUkDate(dateText, rowNumber);
      const rank = parseRank(rankText, rowNumber, column + 2);
      snapshots.push({
        checkedAt,
        rank,
        rankLabel: rankText || "Not Found",
        matchedUrl: rank === null ? null : completeUrl(domain, urlText)
      });
    }

    if (snapshots.length === 0) throw new Error(`Row ${rowNumber} has no historical ranking snapshots.`);
    snapshots.sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
    rows.push({ keyword, domain, location, snapshots });
  });

  if (rows.length === 0) throw new Error("The CSV does not contain any usable ranking rows.");
  if (domains.size !== 1) throw new Error("A historical import must contain exactly one domain.");

  const dates = uniqueDates(rows.flatMap((row) => row.snapshots.map((snapshot) => snapshot.checkedAt)));
  return {
    clientName,
    domain: Array.from(domains)[0],
    rows,
    dates,
    keywords: uniqueStrings(rows.map((row) => row.keyword)),
    locations: uniqueStrings(rows.map((row) => row.location)),
    resultCount: rows.reduce((total, row) => total + row.snapshots.length, 0)
  };
}

export async function importRankHistoryCsv(csvText: string, options?: { clientName?: string; projectName?: string }) {
  const history = parseRankHistoryCsv(csvText);
  const clientName = clean(options?.clientName) || history.clientName;
  const projectName = clean(options?.projectName) || "Organic Rankings";
  const existing = await prisma.project.findFirst({
    where: {
      domain: { equals: history.domain, mode: "insensitive" }
    },
    select: { clientId: true }
  });

  if (existing) throw new Error("A report for this domain already exists.");

  return prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        name: clientName,
        notes: `Imported from legacy ranking history on ${new Date().toLocaleDateString("en-GB")}.`
      }
    });
    const project = await tx.project.create({
      data: {
        clientId: client.id,
        name: projectName,
        domain: history.domain,
        targetBusinessName: clientName
      }
    });

    await tx.keyword.createMany({ data: history.keywords.map((phrase) => ({ projectId: project.id, phrase })) });
    await tx.location.createMany({
      data: history.locations.map((name) => ({ projectId: project.id, name, countryCode: "GB" }))
    });
    await tx.rankRun.createMany({
      data: history.dates.map((date) => ({
        projectId: project.id,
        status: "completed",
        startedAt: date,
        completedAt: date,
        sandbox: false,
        source: "import",
        requestedTasks: history.rows.filter((row) => row.snapshots.some((snapshot) => sameInstant(snapshot.checkedAt, date))).length,
        actualCostUsd: 0,
        notes: "Imported historical ranking data",
        createdAt: date
      }))
    });

    const [keywords, locations, runs] = await Promise.all([
      tx.keyword.findMany({ where: { projectId: project.id } }),
      tx.location.findMany({ where: { projectId: project.id } }),
      tx.rankRun.findMany({ where: { projectId: project.id } })
    ]);
    const keywordIds = new Map(keywords.map((keyword) => [keyword.phrase.toLowerCase(), keyword.id]));
    const locationIds = new Map(locations.map((location) => [location.name.toLowerCase(), location.id]));
    const runIds = new Map(runs.map((run) => [dayKey(run.createdAt), run.id]));
    const results: Prisma.RankResultCreateManyInput[] = [];

    for (const row of history.rows) {
      let previousRank: number | null = null;
      let hasPrevious = false;
      for (const snapshot of row.snapshots) {
        const rank = snapshot.rank;
        results.push({
          runId: requiredMapValue(runIds, dayKey(snapshot.checkedAt), "historical run"),
          keywordId: requiredMapValue(keywordIds, row.keyword.toLowerCase(), "keyword"),
          locationId: requiredMapValue(locationIds, row.location.toLowerCase(), "location"),
          searchType: "organic",
          device: "desktop",
          rankGroup: rank,
          rankAbsolute: rank,
          matched: rank !== null,
          matchedUrl: snapshot.matchedUrl,
          resultUrl: snapshot.matchedUrl,
          resultDomain: rank !== null ? row.domain : null,
          direction: hasPrevious ? movementDirection(rank, previousRank) : null,
          previousRank: hasPrevious ? previousRank : null,
          checkedAt: snapshot.checkedAt,
          rawItem: {
            source: IMPORT_SOURCE,
            original_rank: snapshot.rankLabel,
            original_url: snapshot.matchedUrl
          }
        });
        previousRank = rank;
        hasPrevious = true;
      }
    }

    await tx.rankResult.createMany({ data: results });
    return {
      clientId: client.id,
      projectId: project.id,
      keywordCount: history.keywords.length,
      locationCount: history.locations.length,
      runCount: history.dates.length,
      resultCount: history.resultCount
    };
  }, { timeout: 30_000 });
}

function parseUkDate(value: string, rowNumber: number) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) throw new Error(`Row ${rowNumber} contains an invalid date “${value}”. Expected DD-MM-YYYY.`);
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Row ${rowNumber} contains an invalid date “${value}”.`);
  }
  return date;
}

function parseRank(value: string, rowNumber: number, columnNumber: number) {
  if (/^\d+$/.test(value)) {
    const rank = Number(value);
    if (rank >= 1 && rank <= 1000) return rank;
  }
  if (!value || /^(not found|not in top \d+|n\/?a|-)$/i.test(value)) return null;
  throw new Error(`Row ${rowNumber}, column ${columnNumber} contains an unsupported ranking “${value}”.`);
}

function completeUrl(domain: string, value: string) {
  if (!value || /^(n\/?a|-)$/i.test(value)) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${domain}${value.startsWith("/") ? value : `/${value}`}`;
}

function normalizeDomain(value: string) {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function requiredMapValue(map: Map<string, string>, key: string, label: string) {
  const value = map.get(key);
  if (!value) throw new Error(`Unable to resolve imported ${label}.`);
  return value;
}

function uniqueDates(values: Date[]) {
  return Array.from(new Map(values.map((value) => [dayKey(value), value])).values()).sort((a, b) => a.getTime() - b.getTime());
}

function uniqueStrings(values: string[]) {
  return Array.from(new Map(values.map((value) => [value.toLowerCase(), value])).values()).sort((a, b) => a.localeCompare(b));
}

function sameInstant(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

function dayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
