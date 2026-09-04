import assert from "node:assert/strict";
import test from "node:test";
import { buildContentSecurityPolicy, generateNonce } from "../src/lib/csp";
import { canManageReports, isAppRole, roleAtLeast } from "../src/lib/roles";
import { assertAuthenticationConfigured } from "../src/lib/startup-checks";

test("production script policy relies on a nonce and never on unsafe-inline", () => {
  const nonce = generateNonce();
  const policy = buildContentSecurityPolicy(nonce);
  const scriptDirective = policy.split("; ").find((directive) => directive.startsWith("script-src"));
  assert.ok(scriptDirective);
  assert.match(scriptDirective, new RegExp(`'nonce-${nonce.replace(/[+/=]/g, "\\$&")}'`));
  assert.match(scriptDirective, /'strict-dynamic'/);
  assert.doesNotMatch(scriptDirective, /unsafe-inline|unsafe-eval/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /upgrade-insecure-requests/);
});

test("development policy permits eval for React debugging but keeps the nonce", () => {
  const policy = buildContentSecurityPolicy("abc", { development: true });
  assert.match(policy, /script-src 'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval'/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});

test("nonces are unique and base64 encoded", () => {
  const first = generateNonce();
  const second = generateNonce();
  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9+/]+=*$/);
});

test("role ordering places admin above manager above team", () => {
  assert.equal(roleAtLeast("admin", "manager"), true);
  assert.equal(roleAtLeast("manager", "admin"), false);
  assert.equal(roleAtLeast("team", "team"), true);
  assert.equal(canManageReports("manager"), true);
  assert.equal(canManageReports("team"), false);
  assert.equal(isAppRole("owner"), false);
});

test("a production server refuses to start with authentication disabled", () => {
  assert.throws(() => assertAuthenticationConfigured({ NODE_ENV: "production", AUTH_ENABLED: "false" }), /AUTH_ENABLED must be "true"/);
  assert.throws(() => assertAuthenticationConfigured({ NODE_ENV: "production", AUTH_ENABLED: "true" }), /AUTH_SECRET/);
  assert.doesNotThrow(() => assertAuthenticationConfigured({ NODE_ENV: "production", AUTH_ENABLED: "true", AUTH_SECRET: "x" }));
  assert.doesNotThrow(() => assertAuthenticationConfigured({ NODE_ENV: "development", AUTH_ENABLED: "false" }));
});
