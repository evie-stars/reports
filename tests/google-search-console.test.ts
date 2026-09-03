import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleSearchConsoleAuthorizationUrl,
  GSC_READONLY_SCOPE
} from "../src/lib/google-search-console";
import { decryptGscToken, encryptGscToken } from "../src/lib/gsc-crypto";

const encryptionKey = "a".repeat(64);

test("encrypts and decrypts Search Console refresh tokens", () => {
  const encrypted = encryptGscToken("refresh-token-value", encryptionKey);

  assert.notEqual(encrypted, "refresh-token-value");
  assert.equal(decryptGscToken(encrypted, encryptionKey), "refresh-token-value");
});

test("rejects tampered Search Console refresh tokens", () => {
  const encrypted = encryptGscToken("refresh-token-value", encryptionKey);
  const parts = encrypted.split(".");
  parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith("a") ? "b" : "a"}`;

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
