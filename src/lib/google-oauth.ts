import { resolveSecret } from "@/lib/app-secrets";
import { fetchWithTimeout, readJsonResponse } from "@/lib/http";
import { decryptSecret, masterEncryptionKeyConfigured } from "@/lib/secret-crypto";

/**
 * One read-only Google OAuth client serves every reporting integration. Each product asks for
 * its own scope with incremental authorisation, so an account can hold Search Console access,
 * Analytics access, or both, behind a single stored refresh token. The client ID and secret come
 * from the app's key store, falling back to the server environment.
 */

/** Google reads can be repeated safely; the one-time authorization-code exchange cannot. */
export const GOOGLE_READ_RETRIES = 2;

export const GSC_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GA4_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export const GOOGLE_OAUTH_STATE_COOKIE = "star_reports_google_oauth_state";
export const GOOGLE_OAUTH_PRODUCT_COOKIE = "star_reports_google_oauth_product";
export const GOOGLE_OAUTH_COOKIE_PATH = "/api/integrations/google";

export const GOOGLE_INTEGRATION_PRODUCTS = {
  "search-console": {
    scope: GSC_READONLY_SCOPE,
    label: "Search Console",
    auditPrefix: "gsc"
  },
  analytics: {
    scope: GA4_READONLY_SCOPE,
    label: "Google Analytics",
    auditPrefix: "ga4"
  }
} as const;

export type GoogleIntegrationProduct = keyof typeof GOOGLE_INTEGRATION_PRODUCTS;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_CREDENTIALS_MISSING_MESSAGE =
  "Google integration credentials are not configured. Add them in Settings or set GOOGLE_SEARCH_CONSOLE_CLIENT_ID and GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET.";

export type GoogleOauthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
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

export function isGoogleIntegrationProduct(value: string | null | undefined): value is GoogleIntegrationProduct {
  return typeof value === "string" && Object.hasOwn(GOOGLE_INTEGRATION_PRODUCTS, value);
}

/** Client credentials from the key store (or the environment) plus the deployment's redirect URI. */
export async function resolveGoogleIntegrationsConfig(): Promise<GoogleOauthConfig | null> {
  const redirectUri = process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI ?? "";
  const { values } = await resolveSecret("google-integrations");
  if (!values || !redirectUri) return null;
  return { clientId: values.clientId, clientSecret: values.clientSecret, redirectUri };
}

export type GoogleIntegrationsSetup = {
  credentials: boolean;
  redirectUri: boolean;
  masterKey: boolean;
  configured: boolean;
};

/** Which of the three prerequisites for a Google connection are in place. */
export async function googleIntegrationsSetup(): Promise<GoogleIntegrationsSetup> {
  const masterKey = masterEncryptionKeyConfigured();
  const redirectUri = Boolean(process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI);
  let credentials = false;
  try {
    credentials = Boolean((await resolveSecret("google-integrations")).values);
  } catch (error) {
    console.warn("[google] Integration credentials could not be resolved", error);
  }
  return { credentials, redirectUri, masterKey, configured: credentials && redirectUri && masterKey };
}

/** True when a connection could be started: credentials, redirect URI, and the master key are all present. */
export async function googleIntegrationsConfigured() {
  return (await googleIntegrationsSetup()).configured;
}

async function requireGoogleIntegrationsConfig() {
  const config = await resolveGoogleIntegrationsConfig();
  if (!config) throw new Error(GOOGLE_CREDENTIALS_MISSING_MESSAGE);
  return config;
}

/**
 * Build the consent URL for one product. `include_granted_scopes` asks Google to fold any scope the
 * account already granted this client into the new token, so granting Analytics later does not
 * drop Search Console access.
 */
export function buildGoogleAuthorizationUrl(state: string, scopes: readonly string[], config: GoogleOauthConfig) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    access_type: "offline",
    client_id: config.clientId,
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: ["openid", "email", ...scopes].join(" "),
    state
  }).toString();
  return url;
}

export function googleIntegrationsAppUrl(pathname: string) {
  const publicUrl = process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI || process.env.AUTH_URL;
  if (!publicUrl) throw new Error("The public application URL is not configured.");
  const publicOrigin = new URL(publicUrl).origin;
  return new URL(pathname, `${publicOrigin}/`);
}

export async function exchangeGoogleAuthorizationCode(code: string) {
  const config = await requireGoogleIntegrationsConfig();
  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    }),
    cache: "no-store",
    retries: 0
  });
  const payload = await readTokenResponse(response);
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error("Google did not provide the offline access token required for scheduled imports.");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    grantedScopes: parseScopes(payload.scope)
  };
}

export async function googleAccountForAccessToken(accessToken: string) {
  const response = await fetchWithTimeout(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    retries: GOOGLE_READ_RETRIES
  });
  const payload = await readJsonResponse(response) as { email?: string; email_verified?: boolean } | null;
  if (!payload) throw new Error("Google did not return a verified account email.");
  if (!response.ok || !payload.email || payload.email_verified === false) {
    throw new Error("Google did not return a verified account email.");
  }
  return payload.email.toLowerCase();
}

/** Mint a short-lived access token from the stored (encrypted) refresh token. */
export async function googleAccessTokenForConnection(encryptedRefreshToken: string) {
  return refreshGoogleAccessToken(decryptSecret(encryptedRefreshToken));
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const config = await requireGoogleIntegrationsConfig();
  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }),
    cache: "no-store",
    retries: 1
  });
  const payload = await readTokenResponse(response);
  if (!payload.access_token) throw new Error("Google access could not be refreshed. Reconnect the account.");
  return payload.access_token;
}

export function parseScopes(value: string | undefined) {
  return (value ?? "").split(" ").filter(Boolean);
}

/**
 * Products whose scope the stored connection held but the latest token response no longer carries.
 * With `include_granted_scopes` Google echoes every live grant back, so a missing scope means the
 * grant was revoked or declined and the new refresh token cannot exercise it.
 */
export function droppedIntegrationProducts(storedScopes: readonly string[], grantedScopes: readonly string[]) {
  return (Object.keys(GOOGLE_INTEGRATION_PRODUCTS) as GoogleIntegrationProduct[]).filter((product) => {
    const scope = GOOGLE_INTEGRATION_PRODUCTS[product].scope;
    return storedScopes.includes(scope) && !grantedScopes.includes(scope);
  });
}

export function connectionHasScope(connection: { grantedScopes: readonly string[] }, scope: string) {
  return connection.grantedScopes.includes(scope);
}

async function readTokenResponse(response: Response) {
  const payload = (await readJsonResponse(response) ?? {}) as GoogleTokenResponse;
  if (!response.ok || payload.error) {
    throw new Error(payload.error_description || payload.error || "Google OAuth request failed.");
  }
  return payload;
}
