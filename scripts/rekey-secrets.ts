import { SECRETS_REKEY_LOCK_KEY } from "../src/lib/app-secrets";
import { prisma } from "../src/lib/db";
import { withImportLock } from "../src/lib/import-lock";
import {
  decryptSecret,
  fingerprintSecret,
  LEGACY_MASTER_KEY_ENV,
  MASTER_KEY_ENV,
  PREVIOUS_MASTER_KEY_ENV,
  readPreviousEncryptionKey,
  rotateEncryptedValue
} from "../src/lib/secret-crypto";

/**
 * Rotate the master encryption key.
 *
 * 1. Set APP_SECRETS_ENCRYPTION_KEY to the new key and APP_SECRETS_PREVIOUS_ENCRYPTION_KEY to the key
 *    currently protecting the database. A deployment that only ever had the legacy
 *    GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY can leave that in place instead: it counts as the
 *    previous key. Restart the app and the worker so both read values under either key.
 * 2. Run `npm run secrets:rekey`.
 * 3. Remove APP_SECRETS_PREVIOUS_ENCRYPTION_KEY and the legacy variable, then restart again.
 *
 * Every stored API credential (current and previous version, including their keyed fingerprints)
 * and every Google refresh token is re-encrypted in one transaction while a lock blocks saves from
 * Settings. Values that already open with the new key are skipped, so the script can be re-run
 * after a partial failure or after anything written during the window.
 */
async function main() {
  const nextKey = process.env[MASTER_KEY_ENV]?.trim();
  const previousKey = readPreviousEncryptionKey();
  if (!nextKey || !previousKey) {
    throw new Error(
      `Set ${MASTER_KEY_ENV} (the new key) and ${PREVIOUS_MASTER_KEY_ENV} (the current key) before rekeying. ` +
      `A legacy ${LEGACY_MASTER_KEY_ENV} left in place is treated as the previous key.`
    );
  }
  if (previousKey === nextKey) throw new Error("The previous and new keys are identical; nothing to rotate.");
  const legacy = process.env[LEGACY_MASTER_KEY_ENV]?.trim();
  if (legacy && legacy !== nextKey && legacy !== previousKey) {
    throw new Error(`${LEGACY_MASTER_KEY_ENV} holds a third key. Remove it, or set it to the previous or the new key, so it is clear which key the data is under.`);
  }

  const counts = await withImportLock(SECRETS_REKEY_LOCK_KEY, "Another rekey is already running.", async () => {
    const [secrets, connections] = await Promise.all([prisma.appSecret.findMany(), prisma.googleConnection.findMany()]);
    let rotated = 0;
    let skipped = 0;

    await prisma.$transaction(async (tx) => {
      for (const secret of secrets) {
        const current = rotateEncryptedValue(secret.encryptedValue, previousKey, nextKey);
        const previous = secret.previousEncryptedValue
          ? rotateEncryptedValue(secret.previousEncryptedValue, previousKey, nextKey)
          : null;
        if (!current.changed && !previous?.changed) {
          skipped += 1;
          continue;
        }
        // Fingerprints are keyed with the master key, so they change with it.
        await tx.appSecret.update({
          where: { id: secret.id },
          data: {
            encryptedValue: current.value,
            fingerprint: fingerprintSecret(secret.name, decryptSecret(current.value, nextKey), nextKey),
            ...(previous ? {
              previousEncryptedValue: previous.value,
              previousFingerprint: fingerprintSecret(secret.name, decryptSecret(previous.value, nextKey), nextKey)
            } : {})
          }
        });
        rotated += 1;
      }
      for (const connection of connections) {
        const token = rotateEncryptedValue(connection.encryptedRefreshToken, previousKey, nextKey);
        if (!token.changed) {
          skipped += 1;
          continue;
        }
        await tx.googleConnection.update({ where: { id: connection.id }, data: { encryptedRefreshToken: token.value } });
        rotated += 1;
      }
    });
    return { rotated, skipped };
  });

  console.log(
    `Rekey complete: ${counts.rotated} value(s) re-encrypted, ${counts.skipped} already used the new key. ` +
    `You can now remove ${PREVIOUS_MASTER_KEY_ENV} and ${LEGACY_MASTER_KEY_ENV}, then restart the app and worker.`
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
