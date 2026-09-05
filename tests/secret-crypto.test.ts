import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  masterEncryptionKeyConfigured,
  readMasterEncryptionKey,
  readPreviousEncryptionKey,
  rotateEncryptedValue
} from "../src/lib/secret-crypto";

const keyA = "a".repeat(64);
const keyB = "b".repeat(64);

test("encrypts and decrypts stored secrets", () => {
  const encrypted = encryptSecret("refresh-token-value", keyA);

  assert.notEqual(encrypted, "refresh-token-value");
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(decryptSecret(encrypted, keyA), "refresh-token-value");
  assert.throws(() => decryptSecret(encrypted, keyB));
});

test("rejects tampered ciphertext and empty values", () => {
  const encrypted = encryptSecret("refresh-token-value", keyA);
  const parts = encrypted.split(".");
  parts[3] = `${parts[3].startsWith("a") ? "b" : "a"}${parts[3].slice(1)}`;

  assert.throws(() => decryptSecret(parts.join("."), keyA));
  assert.throws(() => decryptSecret("v2.a.b.c", keyA), /invalid format/);
  assert.throws(() => encryptSecret("", keyA), /empty secret/);
});

test("reads the master key from the new name and falls back to the legacy Search Console name", () => {
  assert.equal(readMasterEncryptionKey({ APP_SECRETS_ENCRYPTION_KEY: keyA, GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY: keyB }), keyA);
  assert.equal(readMasterEncryptionKey({ GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY: keyB }), keyB);
  // An empty value copied from .env.example must not shadow a legacy key that is still in use.
  assert.equal(readMasterEncryptionKey({ APP_SECRETS_ENCRYPTION_KEY: "", GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY: keyB }), keyB);
  assert.equal(readMasterEncryptionKey({ APP_SECRETS_ENCRYPTION_KEY: "  ", GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY: keyB }), keyB);
  assert.equal(readMasterEncryptionKey({}), undefined);
  assert.equal(masterEncryptionKeyConfigured({ APP_SECRETS_ENCRYPTION_KEY: keyA }), true);
  assert.equal(masterEncryptionKeyConfigured({ APP_SECRETS_ENCRYPTION_KEY: "short" }), false);
  assert.throws(() => encryptSecret("value", "not-hex"), /64-character hexadecimal/);
});

test("fingerprints are stable, scoped, keyed, and short", () => {
  const first = fingerprintSecret("dataforseo", "login:password", keyA);
  assert.equal(first, fingerprintSecret("dataforseo", "login:password", keyA));
  assert.match(first, /^[a-f0-9]{12}$/);
  assert.notEqual(first, fingerprintSecret("google-integrations", "login:password", keyA));
  assert.notEqual(first, fingerprintSecret("dataforseo", "login:password", keyB));
  assert.notEqual(first, fingerprintSecret("dataforseo", "login:passwore", keyA));
});

test("rotating the master key re-encrypts once and skips values already on the new key", () => {
  const underA = encryptSecret("value", keyA);
  const rotated = rotateEncryptedValue(underA, keyA, keyB);

  assert.equal(rotated.changed, true);
  assert.equal(decryptSecret(rotated.value, keyB), "value");
  assert.deepEqual(rotateEncryptedValue(rotated.value, keyA, keyB), { value: rotated.value, changed: false });
  assert.throws(() => rotateEncryptedValue(underA, keyB, "c".repeat(64)));
  assert.throws(() => rotateEncryptedValue(underA, keyA, undefined as unknown as string), /64-character hexadecimal/);
  assert.throws(() => rotateEncryptedValue(underA, "", keyB), /64-character hexadecimal/);
});

test("a legacy key left beside a new master key counts as the previous key until rekeyed", () => {
  assert.equal(readPreviousEncryptionKey({ APP_SECRETS_PREVIOUS_ENCRYPTION_KEY: keyA, APP_SECRETS_ENCRYPTION_KEY: keyB }), keyA);
  assert.equal(readPreviousEncryptionKey({ APP_SECRETS_ENCRYPTION_KEY: keyB, GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY: keyA }), keyA);
  assert.equal(readPreviousEncryptionKey({ APP_SECRETS_ENCRYPTION_KEY: keyB, GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY: keyB }), undefined);
  assert.equal(readPreviousEncryptionKey({ GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY: keyA }), undefined);
  assert.equal(readPreviousEncryptionKey({}), undefined);
});

test("during a rotation values under the previous key still decrypt while new values use the current key", () => {
  const saved = {
    APP_SECRETS_ENCRYPTION_KEY: process.env.APP_SECRETS_ENCRYPTION_KEY,
    APP_SECRETS_PREVIOUS_ENCRYPTION_KEY: process.env.APP_SECRETS_PREVIOUS_ENCRYPTION_KEY,
    GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY: process.env.GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY
  };
  try {
    process.env.APP_SECRETS_ENCRYPTION_KEY = keyB;
    process.env.APP_SECRETS_PREVIOUS_ENCRYPTION_KEY = keyA;
    delete process.env.GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY;
    const underPrevious = encryptSecret("older", keyA);
    assert.equal(decryptSecret(underPrevious), "older");
    const fresh = encryptSecret("newer");
    assert.equal(decryptSecret(fresh, keyB), "newer");
    assert.throws(() => decryptSecret(fresh, keyA));
    delete process.env.APP_SECRETS_PREVIOUS_ENCRYPTION_KEY;
    assert.throws(() => decryptSecret(underPrevious));
    // An existing deployment that adds a new key while the legacy one still protects its tokens keeps reading them.
    process.env.GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY = keyA;
    assert.equal(decryptSecret(underPrevious), "older");
    assert.equal(rotateEncryptedValue(underPrevious, keyA, keyB).changed, true);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
