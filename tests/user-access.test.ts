import assert from "node:assert/strict";
import test from "node:test";
import { decideUserAccess, emailAllowedByEnvironment, isBootstrapAdmin } from "../src/lib/user-access";

const env = {
  AUTH_ADMIN_EMAILS: "Owner@StarWebsites.co.uk",
  AUTH_MANAGER_EMAILS: "lead@starwebsites.co.uk",
  AUTH_ALLOWED_EMAILS: "contractor@example.com",
  AUTH_ALLOWED_DOMAINS: "starwebsites.co.uk"
};

test("environment administrators are admitted without a managed record", () => {
  assert.equal(isBootstrapAdmin("owner@starwebsites.co.uk", env), true);
  assert.deepEqual(decideUserAccess("owner@starwebsites.co.uk", { unavailable: true }, env), { allowed: true, role: "admin" });
});

test("a managed record decides both access and role, including revocation", () => {
  assert.deepEqual(decideUserAccess("sam@starwebsites.co.uk", { record: { enabled: true, role: "manager" } }, env), { allowed: true, role: "manager" });
  assert.deepEqual(decideUserAccess("sam@starwebsites.co.uk", { record: { enabled: false, role: "manager" } }, env), { allowed: false, role: "manager" });
});

test("a failed managed lookup denies access even for an allowlisted domain", () => {
  assert.deepEqual(decideUserAccess("sam@starwebsites.co.uk", { unavailable: true }, env), { allowed: false, role: "team" });
});

test("without a managed record the environment allowlists bootstrap access", () => {
  assert.deepEqual(decideUserAccess("lead@starwebsites.co.uk", { record: null }, env), { allowed: true, role: "manager" });
  assert.deepEqual(decideUserAccess("new@starwebsites.co.uk", { record: null }, env), { allowed: true, role: "team" });
  assert.deepEqual(decideUserAccess("contractor@example.com", { record: null }, env), { allowed: true, role: "team" });
  assert.deepEqual(decideUserAccess("stranger@example.com", { record: null }, env), { allowed: false, role: "team" });
  assert.deepEqual(decideUserAccess("", { record: null }, env), { allowed: false, role: "team" });
});

test("environment allowlist matching is case-insensitive", () => {
  assert.equal(emailAllowedByEnvironment("Someone@StarWebsites.co.uk", env), true);
  assert.equal(emailAllowedByEnvironment("someone@other.co.uk", env), false);
});
