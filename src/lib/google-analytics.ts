import { GOOGLE_READ_RETRIES, googleAccessTokenForConnection } from "@/lib/google-oauth";
import { fetchWithTimeout, readJsonResponse } from "@/lib/http";

export { GA4_READONLY_SCOPE } from "@/lib/google-oauth";

const GA4_ADMIN_BASE_URL = "https://analyticsadmin.googleapis.com/v1beta";
const GA4_DATA_BASE_URL = "https://analyticsdata.googleapis.com/v1beta";
const ACCOUNT_SUMMARY_PAGE_SIZE = 200;
const ACCOUNT_SUMMARY_MAX_PAGES = 10;
/** Well above the ~90 days x ~10 channels a report needs, and below the API's 250,000-row ceiling. */
const REPORT_ROW_LIMIT = 100000;

/** `Ga4Snapshot.dimension` values: whole-property daily rows, and daily rows split by channel. */
export const GA4_DAILY_TOTAL = "daily_total";
export const GA4_CHANNEL = "channel";

export const ANALYTICS_METRICS = ["sessions", "activeUsers", "newUsers", "engagedSessions", "keyEvents"] as const;
export const ANALYTICS_DATE_DIMENSION = "date";
export const ANALYTICS_CHANNEL_DIMENSION = "sessionDefaultChannelGroup";
/** GA4's default channel group label for organic search traffic. */
export const ANALYTICS_ORGANIC_CHANNEL = "Organic Search";

export type AnalyticsProperty = {
  /** Canonical resource name, e.g. `properties/123456789`. */
  propertyId: string;
  displayName: string;
  accountName: string;
};

export type AnalyticsReportRequest = {
  dateRanges: Array<{ startDate: string; endDate: string }>;
  dimensions: Array<{ name: string }>;
  metrics: Array<{ name: string }>;
  orderBys: Array<{ dimension: { dimensionName: string } }>;
  limit: number;
  keepEmptyRows: boolean;
};

export type AnalyticsApiRow = {
  dimensionValues?: Array<{ value?: unknown }>;
  metricValues?: Array<{ value?: unknown }>;
};

export type AnalyticsReportResponse = {
  dimensionHeaders?: Array<{ name?: unknown }>;
  metricHeaders?: Array<{ name?: unknown; type?: unknown }>;
  rows?: AnalyticsApiRow[];
  rowCount?: unknown;
  error?: { code?: number; message?: string; status?: string };
};

export type AnalyticsReportResult = {
  endpoint: string;
  requestBody: AnalyticsReportRequest;
  responseBody: AnalyticsReportResponse;
  statusCode: number;
};

export type AnalyticsRow = {
  date: string;
  /** Default channel group for channel reports; empty for daily totals. */
  channel: string;
  sessions: number;
  activeUsers: number;
  newUsers: number;
  engagedSessions: number;
  keyEvents: number;
  raw: AnalyticsApiRow;
};

type AccountSummariesResponse = {
  accountSummaries?: Array<{
    account?: unknown;
    displayName?: unknown;
    propertySummaries?: Array<{ property?: unknown; displayName?: unknown; propertyType?: unknown }>;
  }>;
  nextPageToken?: unknown;
  error?: { message?: string };
};

export function isAnalyticsPropertyId(value: unknown): value is string {
  return typeof value === "string" && /^properties\/\d{1,20}$/.test(value);
}

/** Every GA4 property the connected account can read, grouped by account, via the Admin API. */
export async function listAnalyticsProperties(encryptedRefreshToken: string): Promise<AnalyticsProperty[]> {
  const accessToken = await googleAccessTokenForConnection(encryptedRefreshToken);
  const properties: AnalyticsProperty[] = [];
  let pageToken: string | null = null;

  for (let page = 0; page < ACCOUNT_SUMMARY_MAX_PAGES; page += 1) {
    const url = new URL(`${GA4_ADMIN_BASE_URL}/accountSummaries`);
    url.searchParams.set("pageSize", String(ACCOUNT_SUMMARY_PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetchWithTimeout(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      retries: GOOGLE_READ_RETRIES
    });
    const payload = (await readJsonResponse(response) ?? {}) as AccountSummariesResponse;
    if (!response.ok) throw new Error(payload.error?.message || "Google could not list Analytics properties.");

    for (const account of payload.accountSummaries ?? []) {
      const accountName = typeof account.displayName === "string" && account.displayName ? account.displayName : "Google Analytics";
      for (const summary of account.propertySummaries ?? []) {
        if (!isAnalyticsPropertyId(summary.property)) continue;
        properties.push({
          propertyId: summary.property,
          displayName: typeof summary.displayName === "string" && summary.displayName ? summary.displayName : summary.property,
          accountName
        });
      }
    }

    pageToken = typeof payload.nextPageToken === "string" && payload.nextPageToken ? payload.nextPageToken : null;
    if (!pageToken) break;
  }

  return properties.sort((left, right) =>
    left.accountName.localeCompare(right.accountName) ||
    left.displayName.localeCompare(right.displayName) ||
    left.propertyId.localeCompare(right.propertyId)
  );
}

export function analyticsDailyTotalsRequest(startDate: string, endDate: string): AnalyticsReportRequest {
  return analyticsReportRequest(startDate, endDate, [ANALYTICS_DATE_DIMENSION]);
}

export function analyticsChannelRequest(startDate: string, endDate: string): AnalyticsReportRequest {
  return analyticsReportRequest(startDate, endDate, [ANALYTICS_DATE_DIMENSION, ANALYTICS_CHANNEL_DIMENSION]);
}

/** Run one Data API report. Reads are idempotent, so timeouts and 5xx responses are retried. */
export async function runAnalyticsReport(
  encryptedRefreshToken: string,
  propertyId: string,
  requestBody: AnalyticsReportRequest
): Promise<AnalyticsReportResult> {
  if (!isAnalyticsPropertyId(propertyId)) throw new Error("The stored Google Analytics property is invalid.");
  const accessToken = await googleAccessTokenForConnection(encryptedRefreshToken);
  const endpoint = `${GA4_DATA_BASE_URL}/${propertyId}:runReport`;
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    cache: "no-store",
    retries: GOOGLE_READ_RETRIES
  });
  const responseBody = (await readJsonResponse(response) ?? {}) as AnalyticsReportResponse;
  return { endpoint, requestBody, responseBody, statusCode: response.status };
}

/**
 * Validate a report response against the request shape before anything is stored. Header order is
 * checked explicitly so a metric can never be filed under the wrong column, and a truncated result
 * (`rowCount` larger than the rows returned) is rejected rather than silently stored as a short month.
 */
export function readAnalyticsRows(
  payload: AnalyticsReportResponse,
  options: { withChannel: boolean }
): AnalyticsRow[] {
  const rows = payload.rows ?? [];
  const expectedDimensions = options.withChannel
    ? [ANALYTICS_DATE_DIMENSION, ANALYTICS_CHANNEL_DIMENSION]
    : [ANALYTICS_DATE_DIMENSION];

  if (rows.length === 0) return [];

  const dimensionNames = (payload.dimensionHeaders ?? []).map((header) => header.name);
  const metricNames = (payload.metricHeaders ?? []).map((header) => header.name);
  if (!sameList(dimensionNames, expectedDimensions) || !sameList(metricNames, ANALYTICS_METRICS)) {
    throw new Error("Google returned an Analytics report with unexpected columns.");
  }

  const rowCount = typeof payload.rowCount === "number" ? payload.rowCount : Number(payload.rowCount ?? rows.length);
  if (Number.isFinite(rowCount) && rowCount > rows.length) {
    throw new Error(`Google truncated the Analytics report (${rowCount} rows available, ${rows.length} returned).`);
  }

  return rows.map((row) => {
    const dimensionValues = row.dimensionValues ?? [];
    const metricValues = row.metricValues ?? [];
    if (dimensionValues.length !== expectedDimensions.length || metricValues.length !== ANALYTICS_METRICS.length) {
      throw new Error("Google returned an Analytics row with missing values.");
    }
    const channel = options.withChannel ? dimensionValues[1]?.value : "";
    if (typeof channel !== "string" || (options.withChannel && !channel)) {
      throw new Error("Google returned an invalid Analytics channel value.");
    }
    return {
      date: analyticsDate(dimensionValues[0]?.value),
      channel,
      sessions: integerMetric(metricValues[0]?.value, "sessions"),
      activeUsers: integerMetric(metricValues[1]?.value, "active users"),
      newUsers: integerMetric(metricValues[2]?.value, "new users"),
      engagedSessions: integerMetric(metricValues[3]?.value, "engaged sessions"),
      keyEvents: numericMetric(metricValues[4]?.value, "key events"),
      raw: row
    };
  });
}

/**
 * Inclusive range of `days` calendar days ending yesterday (UTC), matching Search Console so a
 * schedule on the 1st covers the whole previous month. GA4 may still be finalising the most recent
 * day; every import replaces the full range, so it self-corrects on the next refresh.
 */
export function analyticsDateRange(days = 90, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > 500) throw new Error("Analytics import days must be between 1 and 500.");
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

export function displayAnalyticsProperty(project: { ga4PropertyName: string | null; ga4PropertyId: string | null }) {
  return project.ga4PropertyName || project.ga4PropertyId?.replace("properties/", "Property ") || "";
}

function analyticsReportRequest(startDate: string, endDate: string, dimensions: string[]): AnalyticsReportRequest {
  return {
    dateRanges: [{ startDate, endDate }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: ANALYTICS_METRICS.map((name) => ({ name })),
    orderBys: [{ dimension: { dimensionName: ANALYTICS_DATE_DIMENSION } }],
    limit: REPORT_ROW_LIMIT,
    keepEmptyRows: false
  };
}

/** GA4 reports the `date` dimension as YYYYMMDD in the property's reporting time zone. */
function analyticsDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) throw new Error("Google returned an invalid Analytics date.");
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || isoDate(parsed) !== date) throw new Error("Google returned an invalid Analytics date.");
  return date;
}

function numericMetric(value: unknown, label: string) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Google returned an invalid Analytics ${label} value.`);
  return parsed;
}

function integerMetric(value: unknown, label: string) {
  return Math.round(numericMetric(value, label));
}

function sameList(actual: readonly unknown[], expected: readonly string[]) {
  return actual.length === expected.length && expected.every((name, index) => actual[index] === name);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
