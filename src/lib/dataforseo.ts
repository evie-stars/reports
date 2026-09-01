import { z } from "zod";

const configSchema = z.object({
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
  DATAFORSEO_SANDBOX: z.string().default("true"),
  DATAFORSEO_LIVE_ENABLED: z.string().default("false"),
  DATAFORSEO_MAX_LIVE_TASKS_PER_RUN: z.coerce.number().int().positive().default(1)
});

export type DataForSeoTask = {
  keyword: string;
  location_name?: string;
  location_coordinate?: string;
  language_code: string;
  device: "desktop" | "mobile";
  os?: "windows" | "macos" | "android" | "ios";
  depth?: number;
  tag?: string;
};

export type DataForSeoMode = "sandbox" | "live";

export class DataForSeoClient {
  private readonly login?: string;
  private readonly password?: string;
  private readonly sandboxDefault: boolean;
  private readonly liveEnabled: boolean;
  private readonly maxLiveTasks: number;

  constructor(env = process.env) {
    const config = configSchema.parse(env);
    this.login = config.DATAFORSEO_LOGIN;
    this.password = config.DATAFORSEO_PASSWORD;
    this.sandboxDefault = config.DATAFORSEO_SANDBOX !== "false";
    this.liveEnabled = config.DATAFORSEO_LIVE_ENABLED === "true";
    this.maxLiveTasks = config.DATAFORSEO_MAX_LIVE_TASKS_PER_RUN;
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
      costUsd: Number(body?.cost ?? 0)
    };
  }

  assertSafeToRun(mode: DataForSeoMode, taskCount: number) {
    if (mode === "live" && !this.liveEnabled) {
      throw new Error("Live DataForSEO calls are blocked. Set DATAFORSEO_LIVE_ENABLED=true to allow a guarded live run.");
    }

    if (mode === "live" && taskCount > this.maxLiveTasks) {
      throw new Error(`Live run blocked: ${taskCount} tasks exceeds DATAFORSEO_MAX_LIVE_TASKS_PER_RUN=${this.maxLiveTasks}.`);
    }
  }
}
