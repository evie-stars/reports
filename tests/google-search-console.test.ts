import assert from "node:assert/strict";
import test from "node:test";
import {
  GSC_READONLY_SCOPE,
  readSearchConsoleDailyRows,
  searchConsoleDateRange
} from "../src/lib/google-search-console";
import {
  buildGoogleAuthorizationUrl,
  droppedIntegrationProducts,
  GA4_READONLY_SCOPE,
  googleIntegrationsAppUrl,
  isGoogleIntegrationProduct
} from "../src/lib/google-oauth";
import { buildGscReport } from "../src/lib/client-report";

test("builds a read-only, offline Google authorization request", () => {
  const url = buildGoogleAuthorizationUrl("test-state", [GSC_READONLY_SCOPE], {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://reports.example.test/api/integrations/google/callback"
  });

  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("state"), "test-state");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://reports.example.test/api/integrations/google/callback"
  );
  assert.equal(url.searchParams.get("scope"), `openid email ${GSC_READONLY_SCOPE}`);
  assert.doesNotMatch(url.searchParams.get("scope") ?? "", /auth\/webmasters(?:\s|$)/);
});

test("detects a product whose earlier grant is missing from a new token response", () => {
  assert.deepEqual(droppedIntegrationProducts([GSC_READONLY_SCOPE, "openid"], ["openid", GA4_READONLY_SCOPE]), ["search-console"]);
  assert.deepEqual(droppedIntegrationProducts([GA4_READONLY_SCOPE], [GSC_READONLY_SCOPE]), ["analytics"]);
  // Order is stable so the first dropped product becomes the Settings warning.
  assert.deepEqual(droppedIntegrationProducts([GSC_READONLY_SCOPE, GA4_READONLY_SCOPE], ["openid"]), ["search-console", "analytics"]);
  assert.deepEqual(droppedIntegrationProducts([GSC_READONLY_SCOPE], [GSC_READONLY_SCOPE, GA4_READONLY_SCOPE]), []);
  assert.deepEqual(droppedIntegrationProducts([], [GA4_READONLY_SCOPE]), []);
});

test("only the two known products are accepted from the start route and the product cookie", () => {
  assert.equal(isGoogleIntegrationProduct("search-console"), true);
  assert.equal(isGoogleIntegrationProduct("analytics"), true);
  for (const value of ["constructor", "__proto__", "toString", "", "Analytics", null, undefined]) {
    assert.equal(isGoogleIntegrationProduct(value), false, `${String(value)} must be rejected`);
  }
});

test("builds post-OAuth redirects from the configured public callback origin", () => {
  const previousClientId = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID;
  const previousClientSecret = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET;
  const previousRedirectUri = process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI;

  try {
    process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI = "https://reports.example.test/api/integrations/google/callback";

    assert.equal(
      googleIntegrationsAppUrl("/settings?google=search-console").toString(),
      "https://reports.example.test/settings?google=search-console"
    );
  } finally {
    restoreEnvironmentVariable("GOOGLE_SEARCH_CONSOLE_CLIENT_ID", previousClientId);
    restoreEnvironmentVariable("GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET", previousClientSecret);
    restoreEnvironmentVariable("GOOGLE_SEARCH_CONSOLE_REDIRECT_URI", previousRedirectUri);
  }
});

test("builds an inclusive 90-day Search Console range ending yesterday", () => {
  assert.deepEqual(searchConsoleDateRange(90, new Date("2026-09-03T15:00:00.000Z")), {
    startDate: "2026-06-05",
    endDate: "2026-09-02"
  });
});

test("validates daily Search Console rows", () => {
  const rows = readSearchConsoleDailyRows({
    rows: [{ keys: ["2026-09-01"], clicks: 12, impressions: 300, ctr: 0.04, position: 7.5 }]
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(
    {
      date: rows[0].date,
      clicks: rows[0].clicks,
      impressions: rows[0].impressions,
      ctr: rows[0].ctr,
      position: rows[0].position
    },
    { date: "2026-09-01", clicks: 12, impressions: 300, ctr: 0.04, position: 7.5 }
  );
  assert.throws(
    () => readSearchConsoleDailyRows({
      rows: [{ keys: ["2026-09-31"], clicks: 1, impressions: 1, ctr: 1, position: 1 }]
    }),
    /invalid Search Console date/
  );
  assert.throws(
    () => readSearchConsoleDailyRows({
      rows: [{ keys: ["2026-09-01"], clicks: -1, impressions: 1, ctr: 1, position: 1 }]
    }),
    /invalid Search Console clicks value/
  );
});

test("combines mapped report totals using impression-weighted position", () => {
  const report = buildGscReport(
    [
      { date: new Date("2026-09-01T00:00:00.000Z"), clicks: 10, impressions: 100, position: 5 },
      { date: new Date("2026-09-01T00:00:00.000Z"), clicks: 20, impressions: 300, position: 10 }
    ],
    true,
    new Date("2026-09-02T12:00:00.000Z")
  );

  assert.equal(report.stats.clicks, 30);
  assert.equal(report.stats.impressions, 400);
  assert.equal(report.stats.ctr, 0.075);
  assert.equal(report.stats.position, 8.75);
  assert.equal(report.trend.length, 1);
});

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
