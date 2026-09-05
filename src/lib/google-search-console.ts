import { GOOGLE_READ_RETRIES, googleAccessTokenForConnection } from "@/lib/google-oauth";
import { fetchWithTimeout, readJsonResponse } from "@/lib/http";

export { GSC_READONLY_SCOPE } from "@/lib/google-oauth";

const GSC_SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";
const GSC_API_BASE_URL = "https://www.googleapis.com/webmasters/v3";

export type SearchConsoleSite = {
  siteUrl: string;
  permissionLevel: string;
};

export type SearchConsoleDailyRow = {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  raw: SearchConsoleApiRow;
};

export type SearchConsoleQueryResult = {
  endpoint: string;
  requestBody: SearchConsoleQueryBody;
  responseBody: SearchConsoleQueryResponse;
  statusCode: number;
};

type SearchConsoleQueryBody = {
  startDate: string;
  endDate: string;
  dimensions: ["date"];
  dataState: "final";
  rowLimit: number;
  startRow: number;
  type: "web";
};

type SearchConsoleApiRow = {
  keys?: unknown[];
  clicks?: unknown;
  impressions?: unknown;
  ctr?: unknown;
  position?: unknown;
};

type SearchConsoleQueryResponse = {
  rows?: SearchConsoleApiRow[];
  responseAggregationType?: string;
  error?: { message?: string };
};

export async function listSearchConsoleSites(encryptedRefreshToken: string) {
  const accessToken = await googleAccessTokenForConnection(encryptedRefreshToken);
  const response = await fetchWithTimeout(GSC_SITES_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    retries: GOOGLE_READ_RETRIES
  });
  const payload = (await readJsonResponse(response) ?? {}) as { siteEntry?: SearchConsoleSite[]; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "Google could not list Search Console properties.");
  return (payload.siteEntry ?? [])
    .filter((site) => site.siteUrl && site.permissionLevel !== "siteUnverifiedUser")
    .sort((left, right) => left.siteUrl.localeCompare(right.siteUrl));
}

export async function querySearchConsoleDailyTotals(
  encryptedRefreshToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string
): Promise<SearchConsoleQueryResult> {
  const accessToken = await googleAccessTokenForConnection(encryptedRefreshToken);
  const endpoint = `${GSC_API_BASE_URL}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const requestBody: SearchConsoleQueryBody = {
    startDate,
    endDate,
    dimensions: ["date"],
    dataState: "final",
    rowLimit: 25000,
    startRow: 0,
    type: "web"
  };
  // A search analytics query is a read, so it is safe to retry after a timeout or a 5xx.
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
  const responseBody = (await readJsonResponse(response) ?? {}) as SearchConsoleQueryResponse;
  return { endpoint, requestBody, responseBody, statusCode: response.status };
}

export function readSearchConsoleDailyRows(payload: SearchConsoleQueryResponse): SearchConsoleDailyRow[] {
  return (payload.rows ?? []).map((row) => {
    const date = row.keys?.[0];
    const parsedDate = typeof date === "string" ? new Date(`${date}T00:00:00.000Z`) : null;
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !parsedDate ||
      Number.isNaN(parsedDate.getTime()) ||
      isoDate(parsedDate) !== date
    ) {
      throw new Error("Google returned an invalid Search Console date.");
    }
    return {
      date,
      clicks: numericMetric(row.clicks, "clicks"),
      impressions: numericMetric(row.impressions, "impressions"),
      ctr: numericMetric(row.ctr, "CTR"),
      position: numericMetric(row.position, "position"),
      raw: row
    };
  });
}

export function searchConsoleDateRange(days = 90, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > 500) throw new Error("Search Console import days must be between 1 and 500.");
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

function numericMetric(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Google returned an invalid Search Console ${label} value.`);
  }
  return value;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
