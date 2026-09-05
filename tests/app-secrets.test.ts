import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageSecrets,
  confirmationRequired,
  GOOGLE_PROBE_REFRESH_TOKEN,
  identityChanged,
  interpretDataForSeoUserData,
  interpretGoogleTokenProbe,
  maskIdentifier,
  resolveSecretWith,
  SECRET_DEFINITIONS,
  secretStoreLocked,
  validateSecretValues,
  verifyDataForSeoCredentials,
  verifyGoogleClientCredentials
} from "../src/lib/app-secrets";
import { encryptSecret } from "../src/lib/secret-crypto";

const masterKey = "c".repeat(64);
const storedDataForSeo = encryptSecret(JSON.stringify([["login", "app@example.test"], ["password", "app-password"]]), masterKey);
const envWithCredentials = { DATAFORSEO_LOGIN: "env@example.test", DATAFORSEO_PASSWORD: "env-password" };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("a stored key wins over the environment, which remains the fallback", async () => {
  const fromApp = await resolveSecretWith("dataforseo", {
    loadRow: async () => ({ encryptedValue: storedDataForSeo }),
    env: envWithCredentials,
    masterKey
  });
  assert.deepEqual(fromApp, { values: { login: "app@example.test", password: "app-password" }, source: "app" });

  const fromEnv = await resolveSecretWith("dataforseo", { loadRow: async () => null, env: envWithCredentials, masterKey });
  assert.deepEqual(fromEnv, { values: { login: "env@example.test", password: "env-password" }, source: "environment" });

  const missing = await resolveSecretWith("dataforseo", { loadRow: async () => null, env: { DATAFORSEO_LOGIN: "only-login" }, masterKey });
  assert.deepEqual(missing, { values: null, source: "missing" });
});

test("APP_SECRETS_SOURCE=environment ignores the store entirely", async () => {
  let loaded = 0;
  const locked = await resolveSecretWith("dataforseo", {
    loadRow: async () => { loaded += 1; return { encryptedValue: storedDataForSeo }; },
    env: { ...envWithCredentials, APP_SECRETS_SOURCE: "environment" },
    masterKey
  });
  assert.equal(loaded, 0);
  assert.equal(locked.source, "environment");
  assert.equal(secretStoreLocked({ APP_SECRETS_SOURCE: " Environment " }), true);
  assert.equal(secretStoreLocked({ APP_SECRETS_SOURCE: "app" }), false);
  assert.equal(secretStoreLocked({}), false);
});

test("a store that cannot be read or decrypted is an error, never a silent fallback to old environment values", async () => {
  await assert.rejects(
    resolveSecretWith("dataforseo", {
      loadRow: async () => { throw new Error("connection refused"); },
      env: envWithCredentials,
      masterKey
    }),
    /could not be read for DataForSEO: connection refused/
  );

  // A wrong master key and a corrupt row both surface the same operator-facing message, never a raw cipher error.
  await assert.rejects(
    resolveSecretWith("dataforseo", { loadRow: async () => ({ encryptedValue: storedDataForSeo }), env: envWithCredentials, masterKey: "d".repeat(64) }),
    /unreadable.*APP_SECRETS_ENCRYPTION_KEY/
  );
  await assert.rejects(
    resolveSecretWith("dataforseo", { loadRow: async () => ({ encryptedValue: "v1.not.a.row" }), env: envWithCredentials, masterKey }),
    /unreadable.*APP_SECRETS_ENCRYPTION_KEY/
  );
  const wrongShape = encryptSecret(JSON.stringify({ login: "x" }), masterKey);
  await assert.rejects(
    resolveSecretWith("dataforseo", { loadRow: async () => ({ encryptedValue: wrongShape }), env: {}, masterKey }),
    /unreadable/
  );
});

test("only environment-listed administrators can change keys once sign-in is enabled", () => {
  const production = { AUTH_ENABLED: "true", AUTH_ADMIN_EMAILS: "owner@starwebsites.co.uk" };
  assert.equal(canManageSecrets({ role: "admin", email: "owner@starwebsites.co.uk" }, production), true);
  assert.equal(canManageSecrets({ role: "admin", email: "Owner@StarWebsites.co.uk" }, production), true);
  assert.equal(canManageSecrets({ role: "admin", email: "other-admin@starwebsites.co.uk" }, production), false);
  assert.equal(canManageSecrets({ role: "manager", email: "owner@starwebsites.co.uk" }, production), false);
  assert.equal(canManageSecrets({ role: "admin", email: "local-admin" }, { AUTH_ENABLED: "false" }), true);
  assert.equal(canManageSecrets({ role: "team", email: "local-admin" }, { AUTH_ENABLED: "false" }), false);
});

test("form values are trimmed and rejected when empty, oversized, or containing control characters", () => {
  assert.deepEqual(
    validateSecretValues("dataforseo", { login: "  name@example.test ", password: "secret " }),
    { login: "name@example.test", password: "secret" }
  );
  assert.equal(validateSecretValues("dataforseo", { login: "name@example.test", password: "a".repeat(512) }).password.length, 512);
  assert.throws(() => validateSecretValues("dataforseo", { login: "name@example.test", password: "" }), /Enter the API password/);
  assert.throws(() => validateSecretValues("dataforseo", { login: "name@example.test", password: "a".repeat(513) }), /too long/);
  assert.throws(() => validateSecretValues("dataforseo", { login: "name@example.test", password: "bad\u0007value" }), /invalid characters/);
  assert.throws(() => validateSecretValues("dataforseo", { login: "name@example.test", password: "bad\u007fvalue" }), /invalid characters/);
  assert.throws(() => validateSecretValues("dataforseo", { login: "name@example.test", password: "bad\u001fvalue" }), /invalid characters/);
  assert.throws(() => validateSecretValues("dataforseo", { login: "a\nb@x.y", password: "secret" }), /invalid characters/);
  assert.throws(() => validateSecretValues("google-integrations", { clientId: 12, clientSecret: "x" }), /Enter the OAuth client ID/);
  assert.deepEqual(
    validateSecretValues("smtp", { host: "mail.example.test", port: " 587 ", user: "reports@example.test", password: "pw" }),
    { host: "mail.example.test", port: "587", user: "reports@example.test", password: "pw" }
  );
  assert.throws(() => validateSecretValues("smtp", { host: "mail.example.test", port: "70000", user: "u", password: "pw" }), /between 1 and 65535/);
  assert.throws(() => validateSecretValues("smtp", { host: "mail.example.test", port: "smtp", user: "u", password: "pw" }), /between 1 and 65535/);
  assert.equal(SECRET_DEFINITIONS.smtp.hint({ host: "mail.example.test", port: "587", user: "u", password: "pw" }), "mail.example.test:587");
});

test("display hints reveal at most two characters, and only from a well-formed email", () => {
  assert.equal(maskIdentifier("evelyn@starwebsites.co.uk"), "ev***@starwebsites.co.uk");
  assert.equal(maskIdentifier("abcde@x.y"), "ab***@x.y");
  assert.equal(maskIdentifier("evie@starwebsites.co.uk"), "***@starwebsites.co.uk");
  assert.equal(maskIdentifier("a@b.c"), "***@b.c");
  assert.equal(maskIdentifier("plainlogin"), "***");
  assert.equal(maskIdentifier("has space@x.y"), "***");
  assert.equal(maskIdentifier(""), "");
  assert.equal(maskIdentifier(undefined), "");
  assert.equal(
    SECRET_DEFINITIONS["google-integrations"].hint({ clientId: "id.apps.googleusercontent.com", clientSecret: "GOCSPX-secret" }),
    "id.apps.googleusercontent.com"
  );
});

test("an identity change needs confirmation when it is real or unknown and something would be lost", () => {
  assert.equal(identityChanged("a@x.y", "a@x.y"), false);
  assert.equal(identityChanged("a@x.y", "b@x.y"), true);
  assert.equal(identityChanged("", "b@x.y"), false);
  assert.equal(identityChanged(undefined, "b@x.y"), false);
  assert.equal(identityChanged(null, "b@x.y"), null);

  assert.equal(confirmationRequired({ changed: true, collateral: 3 }, false), true);
  assert.equal(confirmationRequired({ changed: true, collateral: 3 }, true), false);
  assert.equal(confirmationRequired({ changed: true, collateral: 0 }, false), false);
  assert.equal(confirmationRequired({ changed: null, collateral: 1 }, false), true);
  assert.equal(confirmationRequired({ changed: null, collateral: 0 }, false), false);
  assert.equal(confirmationRequired({ changed: false, collateral: 9 }, false), false);
});

test("DataForSEO credential checks judge the envelope and keep nothing about the account", () => {
  const accepted = interpretDataForSeoUserData(200, {
    status_code: 20000,
    status_message: "Ok.",
    tasks: [{ status_code: 20000, result: [{ login: "name@example.test", money: { balance: 12.5, total: 99 }, rates: { limits: 1 } }] }]
  });
  assert.deepEqual(accepted, { ok: true, indeterminate: false, message: "DataForSEO accepted the credentials." });
  assert.doesNotMatch(JSON.stringify(accepted), /name@example\.test|12\.5/);

  const rejected = interpretDataForSeoUserData(401, { status_code: 40100, status_message: "Authentication failed. Invalid login/password." });
  assert.deepEqual([rejected.ok, rejected.indeterminate], [false, false]);
  assert.match(rejected.message, /rejected this login/);
  assert.equal(interpretDataForSeoUserData(200, { status_code: 20000, tasks: [{ status_code: 40101 }] }).indeterminate, false);
  assert.deepEqual([interpretDataForSeoUserData(401, null).ok, interpretDataForSeoUserData(401, null).indeterminate], [false, false]);

  // A root success with no task entry proves nothing.
  for (const body of [{ status_code: 20000 }, { status_code: 20000, tasks: [] }]) {
    const noTask = interpretDataForSeoUserData(200, body);
    assert.deepEqual([noTask.ok, noTask.indeterminate], [false, true]);
  }
  const payment = interpretDataForSeoUserData(200, { status_code: 20000, tasks: [{ status_code: 40201, status_message: "Payment Required" }] });
  assert.deepEqual([payment.ok, payment.indeterminate], [false, true]);
  assert.match(payment.message, /Payment Required/);
  const limited = interpretDataForSeoUserData(429, { status_code: 40202, status_message: "Too many requests" });
  assert.deepEqual([limited.ok, limited.indeterminate], [false, true]);
});

test("the Google token probe accepts invalid_grant only and rejects every other definitive 4xx", () => {
  assert.equal(interpretGoogleTokenProbe(400, { error: "invalid_grant", error_description: "Bad Request" }).ok, true);
  const badClient = interpretGoogleTokenProbe(401, { error: "invalid_client", error_description: "Unauthorized" });
  assert.deepEqual([badClient.ok, badClient.indeterminate], [false, false]);
  assert.equal(interpretGoogleTokenProbe(401, { error: "unauthorized_client" }).ok, false);
  const deleted = interpretGoogleTokenProbe(401, { error: "deleted_client", error_description: "The OAuth client was deleted." });
  assert.deepEqual([deleted.ok, deleted.indeterminate], [false, false]);
  assert.match(deleted.message, /deleted_client/);
  const malformed = interpretGoogleTokenProbe(400, { error: "invalid_request", error_description: "Missing parameter" });
  assert.deepEqual([malformed.ok, malformed.indeterminate], [false, false]);

  // Throttling, empty bodies and unexpected successes prove nothing about the client.
  for (const [status, body] of [[429, { error: "rate_limit_exceeded" }], [408, { error: "timeout" }], [400, {}], [403, null], [200, { access_token: "x" }], [500, null], [503, { error: "temporarily_unavailable" }]] as const) {
    const outcome = interpretGoogleTokenProbe(status, body);
    assert.deepEqual([outcome.ok, outcome.indeterminate], [false, true], `status ${status}`);
  }
  assert.match(interpretGoogleTokenProbe(400, {}).message, /HTTP 400/);
});

test("the DataForSEO probe sends Basic auth once, and turns transport failures into indeterminate outcomes", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const rejecting = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
    return jsonResponse(401, { status_code: 40100, status_message: "Invalid login/password." });
  }) as typeof fetch;
  const rejected = await verifyDataForSeoCredentials("name@example.test", "p@ss", rejecting);
  assert.deepEqual([rejected.ok, rejected.indeterminate], [false, false]);
  assert.equal(calls.length, 1, "a rejected login must not be retried against the vendor");
  assert.equal(calls[0].url, "https://api.dataforseo.com/v3/appendix/user_data");
  assert.equal(calls[0].authorization, `Basic ${Buffer.from("name@example.test:p@ss").toString("base64")}`);

  const html = (async () => new Response("<html>maintenance</html>", { status: 503, headers: { "content-type": "text/html" } })) as typeof fetch;
  const outage = await verifyDataForSeoCredentials("name@example.test", "p@ss", html);
  assert.deepEqual([outage.ok, outage.indeterminate], [false, true]);
  assert.match(outage.message, /Non-JSON response \(HTTP 503/);

  const unreachable = (async () => { throw new Error("ECONNRESET"); }) as typeof fetch;
  const network = await verifyDataForSeoCredentials("name@example.test", "p@ss", unreachable);
  assert.deepEqual([network.ok, network.indeterminate, network.message], [false, true, "ECONNRESET"]);
});

test("the Google probe posts the sentinel refresh token with the client credentials", async () => {
  let seen: URLSearchParams | null = null;
  const accepting = (async (_url: string | URL | Request, init?: RequestInit) => {
    seen = new URLSearchParams(String(init?.body));
    return jsonResponse(400, { error: "invalid_grant", error_description: "Bad Request" });
  }) as typeof fetch;
  const outcome = await verifyGoogleClientCredentials("client-id", "client-secret", accepting);
  assert.equal(outcome.ok, true);
  assert.ok(seen);
  const body = seen as URLSearchParams;
  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("refresh_token"), GOOGLE_PROBE_REFRESH_TOKEN);
  assert.equal(body.get("client_id"), "client-id");
  assert.equal(body.get("client_secret"), "client-secret");
});
