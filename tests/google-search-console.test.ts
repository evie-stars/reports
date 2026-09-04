import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleSearchConsoleAuthorizationUrl,
  googleSearchConsoleAppUrl,
  GSC_READONLY_SCOPE,
  readSearchConsoleDailyRows,
  searchConsoleDateRange
} from "../src/lib/google-search-console";
import { decryptGscToken, encryptGscToken } from "../src/lib/gsc-crypto";
import { buildGscReport } from "../src/lib/client-report";

const encryptionKey = "a".repeat(64);

test("encrypts and decrypts Search Console refresh tokens", () => {
  const encrypted = encryptGscToken("refresh-token-value", encryptionKey);

  assert.notEqual(encrypted, "refresh-token-value");
  assert.equal(decryptGscToken(encrypted, encryptionKey), "refresh-token-value");
});

test("rejects tampered Search Console refresh tokens", () => {
  const encrypted = encryptGscToken("refresh-token-value", encryptionKey);
  const parts = encrypted.split(".");
  parts[3] = `${parts[3].startsWith("a") ? "b" : "a"}${parts[3].slice(1)}`;

  assert.throws(() => decryptGscToken(parts.join("."), encryptionKey));
});

test("builds a read-only, offline Google authorization request", () => {
  const url = buildGoogleSearchConsoleAuthorizationUrl("test-state", {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://reports.example.test/api/integrations/google/callback"
  });

  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "test-state");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://reports.example.test/api/integrations/google/callback"
  );
  assert.match(url.searchParams.get("scope") ?? "", new RegExp(GSC_READONLY_SCOPE));
  assert.doesNotMatch(url.searchParams.get("scope") ?? "", /auth\/webmasters(?:\s|$)/);
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
      googleSearchConsoleAppUrl("/settings?gsc=connected").toString(),
      "https://reports.example.test/settings?gsc=connected"
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
