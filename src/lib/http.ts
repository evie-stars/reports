import { configuredPositiveInteger } from "@/lib/env";

export class HttpTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${describeUrl(url)} timed out after ${Math.round(timeoutMs / 1000)}s.`);
    this.name = "HttpTimeoutError";
  }
}

export type FetchWithTimeoutOptions = RequestInit & {
  /** Abort the request after this many milliseconds. Defaults to HTTP_TIMEOUT_MS or 30s. */
  timeoutMs?: number;
  /**
   * Number of additional attempts after a timeout, network failure, or retryable HTTP status.
   * Defaults to 0 so that non-idempotent calls (anything that creates a paid task) are never
   * silently repeated. Pass a positive number only for reads.
   */
  retries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchWithTimeout(url: string, options: FetchWithTimeoutOptions = {}): Promise<Response> {
  const {
    timeoutMs = configuredPositiveInteger("HTTP_TIMEOUT_MS", 30_000),
    retries = 0,
    retryDelayMs = configuredPositiveInteger("HTTP_RETRY_DELAY_MS", 500),
    fetchImpl = fetch,
    sleep = defaultSleep,
    ...init
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(backoffDelay(retryDelayMs, attempt));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new HttpTimeoutError(url, timeoutMs)), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      if (attempt < retries && RETRYABLE_STATUSES.has(response.status)) {
        lastError = new Error(`HTTP ${response.status} from ${describeUrl(url)}.`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = controller.signal.aborted ? controller.signal.reason : error;
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request to ${describeUrl(url)} failed.`);
}

/**
 * Read a JSON body without letting an HTML error page or an empty body surface as a bare
 * "Unexpected token" exception. The HTTP status is preserved in the error message so audit
 * rows can still record what the provider returned.
 */
export async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const contentType = response.headers.get("content-type") ?? "unknown content type";
    throw new Error(`Non-JSON response (HTTP ${response.status}, ${contentType}): ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  }
}

export function backoffDelay(baseMs: number, attempt: number) {
  const exponential = baseMs * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * baseMs);
  return Math.min(exponential + jitter, 10_000);
}

function describeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
