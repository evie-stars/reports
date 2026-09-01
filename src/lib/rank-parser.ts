export type ParsedRankItem = {
  type: string;
  rankGroup?: number;
  rankAbsolute?: number;
  title?: string;
  url?: string;
  domain?: string;
  matched: boolean;
  rawItem: unknown;
};

type ParseOptions = {
  targetDomain?: string;
  targetBusinessName?: string | null;
};

export function parseDataForSeoItems(responseBody: unknown, options: ParseOptions): ParsedRankItem[] {
  const tasks = asRecord(responseBody)?.tasks;
  if (!Array.isArray(tasks)) return [];

  return tasks.flatMap((task) => {
    const results = asRecord(task)?.result;
    if (!Array.isArray(results)) return [];

    return results.flatMap((result) => {
      const items = asRecord(result)?.items;
      if (!Array.isArray(items)) return [];

      return items.map((item) => parseItem(item, options));
    });
  });
}

function parseItem(item: unknown, options: ParseOptions): ParsedRankItem {
  const record = asRecord(item) ?? {};
  const url = stringValue(record.url) ?? stringValue(record.domain);
  const title = stringValue(record.title);
  const domain = stringValue(record.domain) ?? extractDomain(url);
  const targetDomain = normalizeDomain(options.targetDomain);
  const targetBusinessName = options.targetBusinessName?.toLowerCase().trim();
  const normalizedDomain = normalizeDomain(domain);

  const domainMatched = Boolean(targetDomain && normalizedDomain?.includes(targetDomain));
  const nameMatched = Boolean(targetBusinessName && title?.toLowerCase().includes(targetBusinessName));

  return {
    type: stringValue(record.type) ?? "unknown",
    rankGroup: numberValue(record.rank_group),
    rankAbsolute: numberValue(record.rank_absolute),
    title,
    url,
    domain,
    matched: domainMatched || nameMatched,
    rawItem: item
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function extractDomain(url?: string) {
  if (!url) return undefined;

  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function normalizeDomain(domain?: string) {
  return domain?.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();
}
