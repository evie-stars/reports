import { decryptGscToken } from "@/lib/gsc-crypto";

export const GSC_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GSC_OAUTH_STATE_COOKIE = "star_reports_gsc_oauth_state";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GSC_SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";
const GSC_API_BASE_URL = "https://www.googleapis.com/webmasters/v3";

export type GoogleSearchConsoleOauthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

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

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export function googleSearchConsoleConfigured() {
  const encryptionKey = process.env.GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY ?? "";
  return Boolean(
    process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID &&
    process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET &&
    process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI &&
    /^[a-f0-9]{64}$/i.test(encryptionKey)
  );
}

export function googleSearchConsoleOauthConfig(): GoogleSearchConsoleOauthConfig {
  const config = {
    clientId: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET ?? "",
    redirectUri: process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI ?? ""
  };
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new Error("Google Search Console OAuth credentials are not configured.");
  }
  return config;
}

export function buildGoogleSearchConsoleAuthorizationUrl(
  state: string,
  config = googleSearchConsoleOauthConfig()
) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    access_type: "offline",
    client_id: config.clientId,
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: `openid email ${GSC_READONLY_SCOPE}`,
    state
  }).toString();
  return url;
}

export function googleSearchConsoleAppUrl(pathname: string) {
  const publicUrl = process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI || process.env.AUTH_URL;
  if (!publicUrl) throw new Error("The public application URL is not configured.");
  const publicOrigin = new URL(publicUrl).origin;
  return new URL(pathname, `${publicOrigin}/`);
}

export async function exchangeGoogleSearchConsoleCode(code: string) {
  const config = googleSearchConsoleOauthConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    }),
    cache: "no-store"
  });
  const payload = await readTokenResponse(response);
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error("Google did not provide the offline access token required for scheduled Search Console imports.");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    grantedScopes: (payload.scope ?? "").split(" ").filter(Boolean)
  };
}

export async function googleAccountForAccessToken(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  const payload = await response.json() as { email?: string; email_verified?: boolean };
  if (!response.ok || !payload.email || payload.email_verified === false) {
    throw new Error("Google did not return a verified account email.");
  }
  return payload.email.toLowerCase();
}

export async function listSearchConsoleSites(encryptedRefreshToken: string) {
  const accessToken = await refreshGoogleAccessToken(decryptGscToken(encryptedRefreshToken));
  const response = await fetch(GSC_SITES_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  const payload = await response.json() as { siteEntry?: SearchConsoleSite[]; error?: { message?: string } };
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
  const accessToken = await refreshGoogleAccessToken(decryptGscToken(encryptedRefreshToken));
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
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    cache: "no-store"
  });
  const responseBody = await response.json() as SearchConsoleQueryResponse;
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

async function refreshGoogleAccessToken(refreshToken: string) {
  const config = googleSearchConsoleOauthConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }),
    cache: "no-store"
  });
  const payload = await readTokenResponse(response);
  if (!payload.access_token) throw new Error("Google Search Console access could not be refreshed. Reconnect the account.");
  return payload.access_token;
}

async function readTokenResponse(response: Response) {
  const payload = await response.json() as GoogleTokenResponse;
  if (!response.ok || payload.error) {
    throw new Error(payload.error_description || payload.error || "Google OAuth request failed.");
  }
  return payload;
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
