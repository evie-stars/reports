import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

/**
 * AES-256-GCM at rest for everything the app must keep secret: Google refresh tokens and the API
 * credentials managed from Settings. The master key lives only in the server environment.
 */
const ENCRYPTION_VERSION = "v1";

export const MASTER_KEY_ENV = "APP_SECRETS_ENCRYPTION_KEY";
/** The original, Search Console specific name; still honoured so existing deployments keep working. */
export const LEGACY_MASTER_KEY_ENV = "GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY";

/** Set only while rotating the master key; values still encrypted with it keep decrypting until rekeyed. */
export const PREVIOUS_MASTER_KEY_ENV = "APP_SECRETS_PREVIOUS_ENCRYPTION_KEY";

export function readMasterEncryptionKey(env: Record<string, string | undefined> = process.env) {
  return env[MASTER_KEY_ENV]?.trim() || env[LEGACY_MASTER_KEY_ENV]?.trim() || undefined;
}

/**
 * The key that older values may still be encrypted with: the explicit rotation variable, or a legacy
 * Search Console key left in place next to a newly generated master key. Either way the store keeps
 * reading until `npm run secrets:rekey` has moved everything to the current key.
 */
export function readPreviousEncryptionKey(env: Record<string, string | undefined> = process.env) {
  const explicit = env[PREVIOUS_MASTER_KEY_ENV]?.trim();
  if (explicit) return explicit;
  const current = env[MASTER_KEY_ENV]?.trim();
  const legacy = env[LEGACY_MASTER_KEY_ENV]?.trim();
  return current && legacy && legacy !== current ? legacy : undefined;
}

export function masterEncryptionKeyConfigured(env: Record<string, string | undefined> = process.env) {
  return isValidMasterKey(readMasterEncryptionKey(env));
}

export function encryptSecret(value: string, keyValue = readMasterEncryptionKey()) {
  if (!value) throw new Error("Cannot encrypt an empty secret.");
  const key = parseMasterKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/**
 * Decrypt with the given key, or, when no key is passed, with the current master key and then the
 * previous one (if `APP_SECRETS_PREVIOUS_ENCRYPTION_KEY` is set) so a rotation has no outage window.
 */
export function decryptSecret(value: string, keyValue?: string) {
  if (keyValue !== undefined) return decryptWithKey(value, keyValue);
  const previousKey = readPreviousEncryptionKey();
  try {
    return decryptWithKey(value, readMasterEncryptionKey());
  } catch (error) {
    if (!previousKey) throw error;
    return decryptWithKey(value, previousKey);
  }
}

function decryptWithKey(value: string, keyValue: string | undefined) {
  const [version, ivValue, tagValue, ciphertextValue, ...extra] = value.split(".");
  if (version !== ENCRYPTION_VERSION || !ivValue || !tagValue || !ciphertextValue || extra.length > 0) {
    throw new Error("The stored secret has an invalid format.");
  }

  const decipher = createDecipheriv("aes-256-gcm", parseMasterKey(keyValue), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

/**
 * A short, keyed digest for displaying and comparing a secret without revealing it. Keying with
 * the master key means a leaked fingerprint cannot be used to confirm a guessed password offline.
 */
export function fingerprintSecret(scope: string, value: string, keyValue = readMasterEncryptionKey()) {
  return createHmac("sha256", parseMasterKey(keyValue)).update(`${scope}\n${value}`).digest("hex").slice(0, 12);
}

/**
 * Re-encrypt one stored value under a new master key. Values that already open with the new key are
 * returned unchanged so the rekey script can be re-run safely after a partial failure.
 */
export function rotateEncryptedValue(value: string, previousKey: string, nextKey: string) {
  // Both keys are validated first so a missing key can never make a value look "already rotated".
  parseMasterKey(previousKey);
  parseMasterKey(nextKey);
  try {
    decryptSecret(value, nextKey);
    return { value, changed: false };
  } catch {
    return { value: encryptSecret(decryptSecret(value, previousKey), nextKey), changed: true };
  }
}

function isValidMasterKey(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/i.test(value));
}

function parseMasterKey(value: string | undefined) {
  if (!isValidMasterKey(value)) {
    throw new Error(`${MASTER_KEY_ENV} must be a 64-character hexadecimal value (generate one with: openssl rand -hex 32).`);
  }
  return Buffer.from(value, "hex");
}

/**
 * Whether a stored value opens with the given key (or, with none given, the current key and then
 * the previous one). The plaintext never leaves this function, so backup verification can prove
 * a key matches without a credential ever reaching a log or a message.
 */
export function canDecryptSecret(value: string, keyValue?: string) {
  try {
    decryptSecret(value, keyValue);
    return true;
  } catch {
    return false;
  }
}

/**
 * A short public identity for a master key, recorded beside each backup so a restore can tell
 * whether this server holds the key the archive's stored values were encrypted under. It is a plain
 * digest of a 32-byte random key: it cannot be reversed and reveals nothing about the key.
 */
export function masterKeyFingerprint(keyValue: string | undefined) {
  if (!isValidMasterKey(keyValue)) return null;
  return createHash("sha256").update(parseMasterKey(keyValue)).digest("hex").slice(0, 12);
}
