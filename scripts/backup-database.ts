import { chmod, lstat, mkdir, readdir, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { writeAuditLog } from "../src/lib/audit";
import {
  archiveTables,
  BACKUP_CHECKSUM_EXTENSION,
  BACKUP_HEARTBEAT_KEY,
  BACKUP_LOCK_KEY,
  BACKUP_MANIFEST_EXTENSION,
  backupFileName,
  backupFileTime,
  backupSettings,
  backupsToPrune,
  clientCanDumpServer,
  companionFiles,
  compareRowCounts,
  describeBackup,
  formatBytes,
  missingTables,
  partialFilesToRemove,
  postgresTarget,
  redactSecrets,
  requiredTables,
  scratchTargetProblem,
  serverMajorVersion,
  tableForModel,
  toolMajorVersion,
  type BackupManifest,
  type BackupSettings,
  type BackupVerification,
  type PostgresTarget,
  type SecretsCheck
} from "../src/lib/backups";
import { prisma } from "../src/lib/db";
import { isImportLockHeldError, withImportLock } from "../src/lib/import-lock";
import {
  countRows,
  createScratchMarker,
  databaseClient,
  databaseSizeBytes,
  dumpDatabase,
  emptySchema,
  pgRestoreArguments,
  pgRestoreDecodeArguments,
  pgRestoreListArguments,
  runPostgresTool,
  schemaContents,
  scratchDatabaseUsable,
  serverVersion,
  toolVersion,
  type SqlClient,
  type ToolOptions
} from "../src/lib/postgres-tools";
import { canDecryptSecret, masterEncryptionKeyConfigured, masterKeyFingerprint, readMasterEncryptionKey, readPreviousEncryptionKey } from "../src/lib/secret-crypto";
import packageJson from "../package.json";

/**
 * Nightly database backup for a Plesk scheduled task: `npm run db:backup`.
 *
 * 1. Preflight: the backup directory is private to the app user and outside `public/`, the client
 *    tools exist and are not older than the server, there is room on the disk, and the scratch
 *    database (if configured) is really a scratch database. Leftovers of killed runs are removed and
 *    archives past BACKUP_RETENTION_DAYS are pruned first, so a full disk can recover by itself.
 * 2. Dump the app's schema with pg_dump inside one snapshot, counting every table from the same
 *    snapshot, into a compressed custom-format archive plus a SHA-256 checksum file.
 * 3. Prove the archive: `pg_restore --list` must name every table the Prisma schema defines, and a
 *    full decode to /dev/null must succeed (a truncated or corrupt file fails here).
 * 4. When BACKUP_VERIFY_DATABASE_URL names a scratch database, restore the archive into it, require
 *    every table's row count to equal the snapshot's, and confirm this server's master key opens the
 *    stored keys and Google tokens it holds. The scratch schema is emptied again afterwards.
 * 5. Write a manifest beside the archive (versions, row counts, the master key's fingerprint), record
 *    the result in the `database-backup` heartbeat (shown in Settings and on the dashboard) and the
 *    audit trail. An archive that fails any check is deleted, and the run exits non-zero so Plesk's
 *    task notification fires.
 *
 * The archive does not contain the master key or .env: a restore needs both. See README, "Database Backups".
 */
async function main() {
  // Everything this run writes (archive, checksum, manifest) is for the app user alone; pg_dump inherits this too.
  process.umask(0o077);
  const settings = backupSettings(process.env);
  const target = postgresTarget(process.env.DATABASE_URL);
  let failed = false;
  let completed = false;
  try {
    // The lock outlives the longest possible run (dump, decode, restore, each with its own timeout).
    await withImportLock(BACKUP_LOCK_KEY, "A previous backup run is still in progress.", async () => {
      const startedAt = new Date();
      await recordStart(startedAt);
      try {
        const result = await runBackup(settings, target, startedAt);
        console.log(`Backup complete: ${result.message}`);
        if (result.pruned.length > 0) console.log(`Removed ${result.pruned.length} archive(s) older than ${settings.retentionDays} days.`);
        for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
        completed = true;
        await recordSuccess(result);
      } catch (error) {
        failed = true;
        const message = redactSecrets(error instanceof Error ? error.message : String(error), target.password);
        console.error(`Backup failed: ${message}`);
        await recordFailure(message);
      }
    }, settings.timeoutMinutes * 4);
  } catch (error) {
    if (isImportLockHeldError(error)) {
      console.log("A previous backup run is still in progress; nothing was done.");
      return;
    }
    // Only the lock release can throw here; a verified backup stays a success even if the database went away afterwards.
    if (completed) {
      console.warn(`The backup lock could not be released: ${redactSecrets(error instanceof Error ? error.message : String(error), target.password)}`);
      return;
    }
    throw error;
  }
  if (failed) process.exitCode = 1;
}

type BackupResult = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  verification: BackupVerification;
  message: string;
  pruned: string[];
  warnings: string[];
};

async function runBackup(settings: BackupSettings, target: PostgresTarget, startedAt: Date): Promise<BackupResult> {
  const timeoutMs = settings.timeoutMinutes * 60 * 1000;
  const toolOptions: ToolOptions = { toolDirectory: settings.toolDirectory, password: target.password, timeoutMs };
  const warnings: string[] = [];

  // Preflight: nothing below writes a file until every precondition holds.
  const directory = await prepareDirectory(settings.directory, warnings);
  await removeStalePartials(directory, settings, startedAt);
  const versions = await checkToolVersions(toolOptions);
  await checkDiskSpace(directory);
  const scratch = settings.verifyDatabaseUrl ? await prepareScratchDatabase(settings, target, startedAt) : null;
  const pruned = await pruneOldBackups(directory, settings, startedAt);

  // Dump and count from one snapshot, so a test restore must reproduce the counts exactly.
  const fileName = backupFileName(startedAt);
  const filePath = path.join(directory, fileName);
  const dumped = await prisma.$transaction(
    async (tx) => {
      const [{ snapshot }] = await tx.$queryRawUnsafe<{ snapshot: string }[]>("SELECT pg_export_snapshot() AS snapshot");
      const tables = (await schemaContents(tx, target.schema)).tables;
      const rows = await countRows(tx, target.schema, tables);
      const archive = await dumpDatabase(target, filePath, { ...toolOptions, snapshot });
      return { rows, ...archive };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: timeoutMs + 60_000 }
  );

  try {
    await writeFile(`${filePath}${BACKUP_CHECKSUM_EXTENSION}`, `${dumped.sha256}  ${fileName}\n`, { mode: 0o600 });

    // Tier 1: readable, complete, and fully decodable.
    const listing = await runPostgresTool("pg_restore", pgRestoreListArguments(filePath), toolOptions);
    const tables = archiveTables(listing.stdout, target.schema);
    const missing = missingTables(tables, requiredTables());
    if (missing.length > 0) throw new Error(`the archive does not contain every table (missing ${missing.join(", ")}); run npm run db:push if the schema changed`);
    await runPostgresTool("pg_restore", pgRestoreDecodeArguments(filePath), toolOptions);

    // Tier 2: it restores, with the same rows, and the stored keys open here.
    let verification: BackupVerification = { level: "archive", tables: tables.length };
    if (scratch) verification = await testRestore(settings, scratch, filePath, fileName, dumped.rows, tables.length, warnings);

    const manifest: BackupManifest = {
      archive: fileName,
      createdAt: startedAt.toISOString(),
      sha256: dumped.sha256,
      sizeBytes: dumped.sizeBytes,
      schema: target.schema,
      appVersion: packageJson.version,
      pgDumpVersion: versions.pgDump,
      serverVersion: versions.server,
      rows: dumped.rows,
      verification: verification.level,
      keyFingerprint: masterKeyFingerprint(readMasterEncryptionKey()),
      previousKeyFingerprint: masterKeyFingerprint(readPreviousEncryptionKey())
    };
    await writeFile(`${filePath}${BACKUP_MANIFEST_EXTENSION}`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

    const message = describeBackup({ fileName, sizeBytes: dumped.sizeBytes, verification });
    return { fileName, sizeBytes: dumped.sizeBytes, sha256: dumped.sha256, verification, message, pruned, warnings };
  } catch (error) {
    // An archive that failed a check must never count as a backup, or retention would keep it over good ones.
    await rm(filePath, { force: true });
    for (const companion of companionFiles(fileName)) await rm(path.join(directory, companion), { force: true });
    throw new Error(`${fileName} was deleted because ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Resolve BACKUP_DIR, keep it private to the app user, and refuse locations the web server could serve. */
async function prepareDirectory(configured: string, warnings: string[]) {
  const directory = path.resolve(configured);
  for (const forbidden of ["public", ".next"]) {
    const resolved = path.resolve(forbidden);
    if (directory === resolved || directory.startsWith(`${resolved}${path.sep}`)) {
      throw new Error(`BACKUP_DIR (${directory}) is inside ${forbidden}/, which the web server serves or a build replaces. Choose another directory.`);
    }
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (info.isSymbolicLink()) throw new Error(`BACKUP_DIR (${directory}) is a symbolic link. Point it at a real directory.`);
  if (!info.isDirectory()) throw new Error(`BACKUP_DIR (${directory}) is not a directory.`);
  if ((info.mode & 0o077) !== 0) {
    await chmod(directory, 0o700);
    warnings.push(`${directory} was readable by other users; its permissions were tightened to 0700.`);
  }
  return directory;
}

async function removeStalePartials(directory: string, settings: BackupSettings, now: Date) {
  const stale = partialFilesToRemove(await readdir(directory), { timeoutMinutes: settings.timeoutMinutes, now });
  for (const name of stale) await rm(path.join(directory, name), { force: true });
}

async function checkToolVersions(toolOptions: ToolOptions) {
  const [pgDump, pgRestore, server] = await Promise.all([toolVersion("pg_dump", toolOptions), toolVersion("pg_restore", toolOptions), serverVersion(prisma)]);
  const clientMajor = toolMajorVersion(pgDump);
  const serverMajor = serverMajorVersion(server.num);
  if (!clientCanDumpServer(clientMajor, serverMajor)) {
    throw new Error(
      `pg_dump ${clientMajor} cannot back up PostgreSQL ${server.text ?? serverMajor}: the client tools must be at least the server's major version. ` +
      `Set BACKUP_PG_BIN to a matching installation (for example /usr/pgsql-${serverMajor}/bin or /usr/lib/postgresql/${serverMajor}/bin).`
    );
  }
  void pgRestore;
  return { pgDump, server: server.text };
}

/**
 * Stop before filling the disk: the newest archive is the best estimate of the next one's size, so
 * twice that must be free. Without an earlier archive, a quarter of the database's size on disk
 * (compressed dumps are usually far smaller) stands in.
 */
async function checkDiskSpace(directory: string) {
  const [disk, newest] = await Promise.all([statfs(directory), newestArchiveSize(directory)]);
  const needed = newest !== null ? newest * 2 : (await databaseSizeBytes(prisma)) / 4;
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  if (freeBytes < needed) {
    throw new Error(`only ${formatBytes(freeBytes)} is free where backups are written (${directory}); about ${formatBytes(needed)} is needed. Free space or move BACKUP_DIR.`);
  }
}

async function newestArchiveSize(directory: string) {
  const archives = (await readdir(directory)).filter((name) => backupFileTime(name) !== null).sort().reverse();
  if (archives.length === 0) return null;
  return (await stat(path.join(directory, archives[0]))).size;
}

/**
 * The scratch database is checked and emptied before the dump so a misconfiguration fails the run
 * without leaving an unverified archive behind, and so a live database can never be emptied by
 * mistake: it must have a different name and be either empty or carry the marker table.
 */
async function prepareScratchDatabase(settings: BackupSettings, live: PostgresTarget, now: Date) {
  const scratch = postgresTarget(settings.verifyDatabaseUrl ?? undefined, "BACKUP_VERIFY_DATABASE_URL");
  const problem = scratchTargetProblem(live, scratch);
  if (problem) throw new Error(problem);
  const client = databaseClient(settings.verifyDatabaseUrl as string);
  try {
    if (!(await scratchDatabaseUsable(client, scratch.schema))) {
      throw new Error(`the scratch database ${scratch.label} holds tables that the backup script did not create. Use an empty database for BACKUP_VERIFY_DATABASE_URL.`);
    }
    await emptySchema(client, scratch.schema);
    await createScratchMarker(client, scratch.schema, `prepared for the backup started ${now.toISOString()}`);
  } finally {
    await client.$disconnect();
  }
  return scratch;
}

async function testRestore(
  settings: BackupSettings,
  scratch: PostgresTarget,
  filePath: string,
  fileName: string,
  snapshotRows: Record<string, number>,
  tables: number,
  warnings: string[]
): Promise<BackupVerification> {
  const toolOptions: ToolOptions = { toolDirectory: settings.toolDirectory, password: scratch.password, timeoutMs: settings.timeoutMinutes * 60 * 1000 };
  await runPostgresTool("pg_restore", pgRestoreArguments(scratch, filePath), toolOptions);

  // A fresh client after the restore so nothing cached refers to objects created outside it.
  const restored = databaseClient(settings.verifyDatabaseUrl as string);
  try {
    const restoredRows = await countRows(restored, scratch.schema, Object.keys(snapshotRows));
    const comparison = compareRowCounts(snapshotRows, restoredRows);
    if (comparison.mismatched.length > 0) {
      const detail = comparison.mismatched.map((item) => `${item.table} ${item.restored} of ${item.live}`).join(", ");
      throw new Error(`the test restore does not reproduce the snapshot's row counts (${detail})`);
    }
    const secrets = masterEncryptionKeyConfigured() ? await checkStoredSecrets(restored, scratch.schema) : null;
    if (secrets && secrets.current + secrets.previous < secrets.total) {
      warnings.push("Some stored API keys or Google tokens in this backup do not open with the master key on this server; check APP_SECRETS_ENCRYPTION_KEY in .env matches Plesk.");
    } else if (secrets && secrets.previous > 0) {
      warnings.push("Some stored values only open with the previous master key; finish the rotation with npm run secrets:rekey.");
    }
    return { level: "restore", tables, comparison, secrets };
  } finally {
    // Leave the scratch database empty so there is no second copy of client data at rest.
    try {
      await emptySchema(restored, scratch.schema);
      await createScratchMarker(restored, scratch.schema, `verified ${fileName}`);
    } catch (error) {
      warnings.push(`The scratch database could not be emptied after the test: ${error instanceof Error ? error.message : String(error)}`);
    }
    await restored.$disconnect();
  }
}

/** Try every stored value (keys, their previous versions, Google tokens) against the current and previous master keys. Plaintext never leaves canDecryptSecret. */
async function checkStoredSecrets(client: SqlClient, schema: string): Promise<SecretsCheck> {
  const secrets = await client.$queryRawUnsafe<{ current: string; previous: string | null }[]>(
    `SELECT "encryptedValue" AS "current", "previousEncryptedValue" AS "previous" FROM "${schema}"."${tableForModel("AppSecret")}"`
  );
  const tokens = await client.$queryRawUnsafe<{ value: string }[]>(
    `SELECT "encryptedRefreshToken" AS "value" FROM "${schema}"."${tableForModel("GoogleConnection")}"`
  );
  const values = [...secrets.flatMap((row) => [row.current, ...(row.previous ? [row.previous] : [])]), ...tokens.map((row) => row.value)];
  const currentKey = readMasterEncryptionKey();
  const previousKey = readPreviousEncryptionKey();
  const check: SecretsCheck = { total: values.length, current: 0, previous: 0 };
  for (const value of values) {
    if (canDecryptSecret(value, currentKey)) check.current += 1;
    else if (previousKey && canDecryptSecret(value, previousKey)) check.previous += 1;
  }
  return check;
}

async function pruneOldBackups(directory: string, settings: BackupSettings, now: Date) {
  const pruned = backupsToPrune(await readdir(directory), { retentionDays: settings.retentionDays, keepMinimum: settings.keepMinimum, now });
  for (const name of pruned) {
    await rm(path.join(directory, name), { force: true });
    for (const companion of companionFiles(name)) await rm(path.join(directory, companion), { force: true });
  }
  return pruned;
}

/** A heartbeat still "running" from last time means that run was killed before it could record anything; say so before starting over. */
async function recordStart(now: Date) {
  const previous = await prisma.workerHeartbeat.findUnique({ where: { key: BACKUP_HEARTBEAT_KEY } });
  if (previous?.status === "running") {
    const message = `The previous backup run did not finish (started ${previous.startedAt?.toISOString() ?? "at an unknown time"}).`;
    console.warn(message);
    await writeAuditLog({ event: "backup.failed", outcome: "failure", actorEmail: "system", actorRole: "system", entityType: "backup", metadata: { reason: message } });
    await prisma.workerHeartbeat.update({ where: { key: BACKUP_HEARTBEAT_KEY }, data: { lastFailureAt: previous.startedAt ?? now } });
  }
  await prisma.workerHeartbeat.upsert({
    where: { key: BACKUP_HEARTBEAT_KEY },
    create: { key: BACKUP_HEARTBEAT_KEY, status: "running", startedAt: now, message: null },
    update: { status: "running", startedAt: now, message: null }
  });
}

/** Best effort: the backup exists whether or not the outcome can be written down, so this never fails the run. */
async function recordSuccess(result: BackupResult) {
  const now = new Date();
  const message = result.warnings.length > 0 ? `${result.message} · ${result.warnings[0]}` : result.message;
  try {
    await prisma.workerHeartbeat.upsert({
      where: { key: BACKUP_HEARTBEAT_KEY },
      create: { key: BACKUP_HEARTBEAT_KEY, status: "healthy", startedAt: now, completedAt: now, lastSuccessAt: now, message },
      update: { status: "healthy", completedAt: now, lastSuccessAt: now, message }
    });
    await writeAuditLog({
      event: "backup.completed",
      actorEmail: "system",
      actorRole: "system",
      entityType: "backup",
      entityId: result.fileName,
      metadata: {
        sizeBytes: result.sizeBytes,
        sha256: result.sha256,
        tables: result.verification.tables,
        verification: result.verification.level,
        ...(result.verification.level === "restore" && result.verification.secrets ? { secrets: result.verification.secrets } : {}),
        pruned: result.pruned.length,
        warnings: result.warnings
      }
    });
  } catch (error) {
    console.warn(`The backup succeeded but its outcome could not be recorded in the database: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function recordFailure(message: string) {
  const now = new Date();
  try {
    await prisma.workerHeartbeat.upsert({
      where: { key: BACKUP_HEARTBEAT_KEY },
      create: { key: BACKUP_HEARTBEAT_KEY, status: "failed", startedAt: now, completedAt: now, lastFailureAt: now, message },
      update: { status: "failed", completedAt: now, lastFailureAt: now, message }
    });
    await writeAuditLog({ event: "backup.failed", outcome: "failure", actorEmail: "system", actorRole: "system", entityType: "backup", metadata: { reason: message } });
  } catch (error) {
    console.error("The backup failure could not be recorded in the database:", error instanceof Error ? error.message : error);
  }
}

main()
  .catch((error) => {
    console.error(redactSecrets(error instanceof Error ? error.message : String(error), null));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
