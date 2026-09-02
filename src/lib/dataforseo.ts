import { z } from "zod";

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

const locationCache = new Map<string, { expiresAt: number; locations: DataForSeoLocation[] }>();

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

  async postSerpTask(searchType: "organic" | "local_finder" | "maps", task: DataForSeoTask, mode?: DataForSeoMode) {
    const resolvedMode = mode ?? (this.sandboxDefault ? "sandbox" : "live");
    this.assertSafeToRun(resolvedMode, 1);

    if (!this.login || !this.password) {
      throw new Error("Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD.");
    }

    const host = resolvedMode === "sandbox" ? "sandbox.dataforseo.com" : "api.dataforseo.com";
    const endpoint = `/v3/serp/google/${searchType}/live/advanced`;
    const response = await fetch(`https://${host}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.login}:${this.password}`).toString("base64")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([task])
    });

    const body = await response.json();

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

  async getGoogleLocations(countryCode = "gb") {
    if (!this.login || !this.password) {
      throw new Error("Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD.");
    }

    const country = countryCode.trim().toLowerCase();
    const cached = locationCache.get(country);
    if (cached && cached.expiresAt > Date.now()) return cached.locations;

    const response = await fetch(`https://api.dataforseo.com/v3/serp/google/locations/${country}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.login}:${this.password}`).toString("base64")}`,
        "Content-Type": "application/json"
      },
      cache: "no-store"
    });
    const body = await response.json();

    if (!response.ok) {
      throw new Error(`Unable to load DataForSEO locations (HTTP ${response.status}).`);
    }

    const locations = readLocations(body);
    if (locations.length === 0) {
      throw new Error("DataForSEO returned no supported locations for this country.");
    }

    locationCache.set(country, {
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      locations
    });

    return locations;
  }

  async postStandardSerpTasks(
    searchType: "organic" | "local_finder" | "maps",
    tasks: DataForSeoTask[]
  ): Promise<DataForSeoApiResponse> {
    this.assertPaidEnabled();
    this.assertStandardTaskCount(tasks.length);
    const endpoint = `/v3/serp/google/${searchType}/task_post`;
    return this.request(endpoint, { method: "POST", body: tasks });
  }

  async getStandardSerpTask(
    searchType: "organic" | "local_finder" | "maps",
    taskId: string
  ): Promise<DataForSeoApiResponse> {
    this.assertPaidEnabled();
    const endpoint = `/v3/serp/google/${searchType}/task_get/advanced/${encodeURIComponent(taskId)}`;
    return this.request(endpoint);
  }

  async getReadySerpTaskIds(searchType: "organic" | "local_finder" | "maps") {
    this.assertPaidEnabled();
    const endpoint = `/v3/serp/google/${searchType}/tasks_ready`;
    const response = await this.request(endpoint);
    return { ...response, taskIds: readReadyTaskIds(response.responseBody) };
  }

  async postKeywordMetricsTask(task: {
    keywords: string[];
    location_name: string;
    language_code: string;
    tag: string;
  }): Promise<DataForSeoApiResponse> {
    this.assertPaidEnabled();
    if (!this.keywordMetricsEnabled) {
      throw new Error("Keyword metrics calls are blocked. Set DATAFORSEO_KEYWORD_METRICS_ENABLED=true to enable them.");
    }
    const endpoint = "/v3/keywords_data/google_ads/search_volume/task_post";
    return this.request(endpoint, { method: "POST", body: [task] });
  }

  async getKeywordMetricsTask(taskId: string): Promise<DataForSeoApiResponse> {
    this.assertPaidEnabled();
    if (!this.keywordMetricsEnabled) {
      throw new Error("Keyword metrics calls are blocked. Set DATAFORSEO_KEYWORD_METRICS_ENABLED=true to enable them.");
    }
    const endpoint = `/v3/keywords_data/google_ads/search_volume/task_get/${encodeURIComponent(taskId)}`;
    return this.request(endpoint);
  }

  async getReadyKeywordMetricsTaskIds() {
    this.assertPaidEnabled();
    if (!this.keywordMetricsEnabled) return { taskIds: [] as string[] };
    const endpoint = "/v3/keywords_data/google_ads/search_volume/tasks_ready";
    const response = await this.request(endpoint);
    return { ...response, taskIds: readReadyTaskIds(response.responseBody) };
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

  private async request(
    endpoint: string,
    options: { method?: "GET" | "POST"; body?: unknown } = {}
  ): Promise<DataForSeoApiResponse> {
    if (!this.login || !this.password) {
      throw new Error("Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD.");
    }

    const response = await fetch(`https://api.dataforseo.com${endpoint}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.login}:${this.password}`).toString("base64")}`,
        "Content-Type": "application/json"
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: "no-store"
    });
    const body = await response.json();

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

function readCost(body: unknown) {
  if (!body || typeof body !== "object") return 0;
  const response = body as { cost?: unknown; tasks?: unknown };
  if (typeof response.cost === "number") return response.cost;
  if (!Array.isArray(response.tasks)) return 0;

  return response.tasks.reduce((total, task) => {
    if (!task || typeof task !== "object") return total;
    const cost = (task as { cost?: unknown }).cost;
    return total + (typeof cost === "number" ? cost : 0);
  }, 0);
}

function readReadyTaskIds(body: unknown) {
  if (!body || typeof body !== "object") return [];
  const tasks = (body as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return [];

  return tasks.flatMap((task) => {
    if (!task || typeof task !== "object") return [];
    const result = (task as { result?: unknown }).result;
    if (!Array.isArray(result)) return [];
    return result.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const id = (item as { id?: unknown }).id;
      return typeof id === "string" ? [id] : [];
    });
  });
}
