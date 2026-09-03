import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENCRYPTION_VERSION = "v1";

export function encryptGscToken(value: string, keyValue = process.env.GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY) {
  if (!value) throw new Error("Cannot encrypt an empty Google token.");
  const key = readEncryptionKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptGscToken(value: string, keyValue = process.env.GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY) {
  const [version, ivValue, tagValue, ciphertextValue, ...extra] = value.split(".");
  if (version !== ENCRYPTION_VERSION || !ivValue || !tagValue || !ciphertextValue || extra.length > 0) {
    throw new Error("The stored Google token has an invalid format.");
  }

  const decipher = createDecipheriv("aes-256-gcm", readEncryptionKey(keyValue), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function readEncryptionKey(value: string | undefined) {
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal value.");
  }
  return Buffer.from(value, "hex");
}
