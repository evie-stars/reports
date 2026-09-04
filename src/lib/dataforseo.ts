import { z } from "zod";
import { readCost } from "@/lib/dataforseo-response";
import { configuredPositiveInteger } from "@/lib/env";
import { fetchWithTimeout, readJsonResponse } from "@/lib/http";

const configSchema = z.object({
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
  DATAFORSEO_SANDBOX: z.string().default("true"),
  DATAFORSEO_LIVE_ENABLED: z.string().default("false"),
  DATAFORSEO_MAX_LIVE_TASKS_PER_RUN: z.coerce.number().int().positive().default(1),
  DATAFORSEO_MAX_STANDARD_TASKS_PER_RUN: z.coerce.number().int().positive().default(1000),
  DATAFORSEO_KEYWORD_METRICS_ENABLED: z.string().default("false")
});

export type DataForSeoTask = {
  keyword: string;
  location_name?: string;
  location_coordinate?: string;
  language_code: string;
  device: "desktop" | "mobile";
  os?: "windows" | "macos" | "android" | "ios";
  depth?: number;
  max_crawl_pages?: number;
  stop_crawl_on_match?: Array<{
    match_value: string;
    match_type: "domain" | "with_subdomains" | "wildcard";
  }>;
  find_targets_in?: string[];
  tag?: string;
};

export type DataForSeoMode = "sandbox" | "live";

export type DataForSeoApiResponse = {
  endpoint: string;
  sandbox: boolean;
  requestBody: unknown;
  responseBody: unknown;
  statusCode: number;
  tag?: string;
  costUsd: number;
};

export type DataForSeoLocation = {
  locationCode: number;
  locationName: string;
  countryIsoCode: string;
  locationType: string;
};

type SerpSearchType = "organic" | "local_finder" | "maps";

const locationCache = new Map<string, { expiresAt: number; locations: DataForSeoLocation[] }>();

/** Reads (task_get, locations) are safe to repeat. Anything that creates a paid task is never retried. */
const READ_RETRIES = 2;

export class DataForSeoClient {
  private readonly login?: string;
  private readonly password?: string;
  private readonly sandboxDefault: boolean;
  private readonly liveEnabled: boolean;
  private readonly maxLiveTasks: number;
  private readonly maxStandardTasks: number;
  private readonly keywordMetricsEnabled: boolean;

  constructor(env: Record<string, string | undefined> = process.env) {
    const config = configSchema.parse(env);
    this.login = config.DATAFORSEO_LOGIN;
    this.password = config.DATAFORSEO_PASSWORD;
    this.sandboxDefault = config.DATAFORSEO_SANDBOX !== "false";
    this.liveEnabled = config.DATAFORSEO_LIVE_ENABLED === "true";
    this.maxLiveTasks = config.DATAFORSEO_MAX_LIVE_TASKS_PER_RUN;
    this.maxStandardTasks = config.DATAFORSEO_MAX_STANDARD_TASKS_PER_RUN;
    this.keywordMetricsEnabled = config.DATAFORSEO_KEYWORD_METRICS_ENABLED === "true";
  }

  async postSerpTask(searchType: SerpSearchType, task: DataForSeoTask, mode?: DataForSeoMode): Promise<DataForSeoApiResponse> {
    const resolvedMode = mode ?? (this.sandboxDefault ? "sandbox" : "live");
    this.assertSafeToRun(resolvedMode, 1);

    const host = resolvedMode === "sandbox" ? "sandbox.dataforseo.com" : "api.dataforseo.com";
    const endpoint = `/v3/serp/google/${searchType}/live/advanced`;
    const response = await fetchWithTimeout(`https://${host}${endpoint}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify([task]),
      timeoutMs: this.timeoutMs(),
      retries: 0
    });
    const body = await readJsonResponse(response);

    return {
      endpoint,
      sandbox: resolvedMode === "sandbox",
      requestBody: [task],
      responseBody: body,
      statusCode: response.status,
      tag: task.tag,
      costUsd: readCost(body)
    };
  }

  /** The locations list is a free endpoint, so it is available in sandbox mode too. */
  async getGoogleLocations(countryCode = "gb") {
    const country = countryCode.trim().toLowerCase();
    const cached = locationCache.get(country);
    if (cached && cached.expiresAt > Date.now()) return cached.locations;

    const response = await fetchWithTimeout(`https://api.dataforseo.com/v3/serp/google/locations/${country}`, {
      headers: this.headers(),
      cache: "no-store",
      timeoutMs: this.timeoutMs(),
      retries: READ_RETRIES
    });
    const body = await readJsonResponse(response);
    if (!response.ok) throw new Error(`Unable to load DataForSEO locations (HTTP ${response.status}).`);

    const locations = readLocations(body);
    if (locations.length === 0) throw new Error("DataForSEO returned no supported locations for this country.");

    locationCache.set(country, { expiresAt: Date.now() + 24 * 60 * 60 * 1000, locations });
    return locations;
  }

  async postStandardSerpTasks(searchType: SerpSearchType, tasks: DataForSeoTask[]): Promise<DataForSeoApiResponse> {
    this.assertPaidEnabled();
    this.assertStandardTaskCount(tasks.length);
    return this.request(`/v3/serp/google/${searchType}/task_post`, { method: "POST", body: tasks });
  }

  async getStandardSerpTask(searchType: SerpSearchType, taskId: string): Promise<DataForSeoApiResponse> {
    this.assertPaidEnabled();
    return this.request(`/v3/serp/google/${searchType}/task_get/advanced/${encodeURIComponent(taskId)}`);
  }

  async postKeywordMetricsTask(task: {
    keywords: string[];
    location_name: string;
    language_code: string;
    tag: string;
  }): Promise<DataForSeoApiResponse> {
    this.assertKeywordMetricsEnabled();
    return this.request("/v3/keywords_data/google_ads/search_volume/task_post", { method: "POST", body: [task] });
  }

  async getKeywordMetricsTask(taskId: string): Promise<DataForSeoApiResponse> {
    this.assertKeywordMetricsEnabled();
    return this.request(`/v3/keywords_data/google_ads/search_volume/task_get/${encodeURIComponent(taskId)}`);
  }

  assertSafeToRun(mode: DataForSeoMode, taskCount: number) {
    if (mode === "live" && !this.liveEnabled) {
      throw new Error("Live DataForSEO calls are blocked. Set DATAFORSEO_LIVE_ENABLED=true to allow a guarded live run.");
    }
    if (mode === "live" && taskCount > this.maxLiveTasks) {
      throw new Error(`Live run blocked: ${taskCount} tasks exceeds DATAFORSEO_MAX_LIVE_TASKS_PER_RUN=${this.maxLiveTasks}.`);
    }
  }

  assertStandardTaskCount(taskCount: number) {
    this.assertPaidEnabled();
    if (taskCount > this.maxStandardTasks) {
      throw new Error(
        `Standard run blocked: ${taskCount} tasks exceeds DATAFORSEO_MAX_STANDARD_TASKS_PER_RUN=${this.maxStandardTasks}.`
      );
    }
  }

  assertKeywordMetricsEnabled() {
    this.assertPaidEnabled();
    if (!this.keywordMetricsEnabled) {
      throw new Error("Keyword metrics calls are blocked. Set DATAFORSEO_KEYWORD_METRICS_ENABLED=true to enable them.");
    }
  }

  private assertPaidEnabled() {
    if (!this.liveEnabled) {
      throw new Error("Paid DataForSEO calls are blocked. Set DATAFORSEO_LIVE_ENABLED=true to allow them.");
    }
  }

  private headers() {
    if (!this.login || !this.password) throw new Error("Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD.");
    return {
      Authorization: `Basic ${Buffer.from(`${this.login}:${this.password}`).toString("base64")}`,
      "Content-Type": "application/json"
    };
  }

  private timeoutMs() {
    return configuredPositiveInteger("DATAFORSEO_TIMEOUT_MS", 90_000);
  }

  private async request(
    endpoint: string,
    options: { method?: "GET" | "POST"; body?: unknown } = {}
  ): Promise<DataForSeoApiResponse> {
    const method = options.method ?? "GET";
    const response = await fetchWithTimeout(`https://api.dataforseo.com${endpoint}`, {
      method,
      headers: this.headers(),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: "no-store",
      timeoutMs: this.timeoutMs(),
      retries: method === "GET" ? READ_RETRIES : 0
    });
    const body = await readJsonResponse(response);

    return {
      endpoint,
      sandbox: false,
      requestBody: options.body ?? {},
      responseBody: body,
      statusCode: response.status,
      costUsd: readCost(body)
    };
  }
}

function readLocations(body: unknown): DataForSeoLocation[] {
  if (!body || typeof body !== "object") return [];
  const tasks = (body as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return [];

  return tasks.flatMap((task) => {
    if (!task || typeof task !== "object") return [];
    const result = (task as { result?: unknown }).result;
    if (!Array.isArray(result)) return [];

    return result.flatMap((location) => {
      if (!location || typeof location !== "object") return [];
      const item = location as Record<string, unknown>;
      if (
        typeof item.location_code !== "number" ||
        typeof item.location_name !== "string" ||
        typeof item.country_iso_code !== "string" ||
        typeof item.location_type !== "string"
      ) {
        return [];
      }
      return [{
        locationCode: item.location_code,
        locationName: item.location_name,
        countryIsoCode: item.country_iso_code,
        locationType: item.location_type
      }];
    });
  });
}
