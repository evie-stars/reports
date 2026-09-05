import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { writeAuditLog } from "../src/lib/audit";
import {
  archiveHeader,
  archiveTables,
  BACKUP_CHECKSUM_EXTENSION,
  BACKUP_LOCK_KEY,
  BACKUP_MANIFEST_EXTENSION,
  backupSettings,
  formatBytes,
  missingTables,
  postgresTarget,
  preRestoreFileName,
  redactSecrets,
  requiredTables,
  scratchTargetProblem,
  type BackupManifest,
  type PostgresTarget
} from "../src/lib/backups";
import { prisma } from "../src/lib/db";
import { isImportLockHeldError, withImportLock } from "../src/lib/import-lock";
import {
  countRows,
  createScratchMarker,
  databaseClient,
  dumpDatabase,
  emptySchema,
  fileSha256,
  otherSessionCount,
  pgRestoreArguments,
  pgRestoreListArguments,
  settleRestoredState,
  runPostgresTool,
  scratchDatabaseUsable,
  type ToolOptions
} from "../src/lib/postgres-tools";
import { masterKeyFingerprint, readMasterEncryptionKey, readPreviousEncryptionKey } from "../src/lib/secret-crypto";
import { RANK_WORKER_KEY } from "../src/lib/worker-health";

/**
 * Put a backup archive back: `npm run db:restore -- --file <archive> --target live --confirm <database name>`.
 *
 * Without `--confirm` naming the target database exactly, the script only reports: the archive's
 * origin, checksum, tables, and master-key fingerprint, then what the target holds now. With it, the
 * live database is first copied to BACKUP_DIR (pre-restore-<database>-<time>.dump), then its schema
 * is emptied and the archive restored in one transaction. `--target verify` restores into the
 * scratch database from BACKUP_VERIFY_DATABASE_URL instead, for restore drills.
 *
 * Stop the app and disable the worker's scheduled task first; other connections to the target are
 * refused unless --allow-other-sessions is passed. Afterwards run `npm run db:push` (tables added
 * since the archive was taken), restart the app and the worker, and check under Settings that the
 * stored keys are readable. See README, "Database Backups".
 */
type Arguments = {
  file: string | null;
  target: "live" | "verify" | null;
  confirm: string | null;
  allowOtherSessions: boolean;
  ignoreKeyMismatch: boolean;
  skipSafetyCopy: boolean;
};

const USAGE = "Usage: npm run db:restore -- --file <archive.dump> --target live|verify --confirm <database name> [--allow-other-sessions] [--ignore-key-mismatch] [--no-safety-copy]";

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.file || !args.target) throw new Error(USAGE);
  const settings = backupSettings(process.env);
  const live = postgresTarget(process.env.DATABASE_URL);
  const target = args.target === "live" ? live : resolveScratch(settings.verifyDatabaseUrl, live);
  const targetUrl = args.target === "live" ? (process.env.DATABASE_URL as string) : (settings.verifyDatabaseUrl as string);
  const toolOptions: ToolOptions = { toolDirectory: settings.toolDirectory, password: target.password, timeoutMs: settings.timeoutMinutes * 60 * 1000 };

  const filePath = path.resolve(args.file);
  const fileName = path.basename(filePath);
  const sizeBytes = (await stat(filePath).catch(() => null))?.size;
  if (sizeBytes === undefined) throw new Error(`${filePath} does not exist.`);
  console.log(`Archive:   ${filePath} (${formatBytes(sizeBytes)})`);
  console.log(`Checksum:  ${await checksumStatus(filePath, fileName)}`);

  const manifest = await readManifest(filePath);
  const listing = await runPostgresTool("pg_restore", pgRestoreListArguments(filePath), toolOptions);
  for (const line of archiveHeader(listing.stdout)) console.log(`           ${line}`);
  const tables = archiveTables(listing.stdout, target.schema);
  if (tables.length === 0) throw new Error(`The archive holds no tables in schema "${target.schema}"; it was not made from this database.`);
  const missing = missingTables(tables, requiredTables());
  console.log(`Tables:    ${tables.length} in the archive${missing.length > 0 ? `; ${missing.length} added since it was taken will be empty after db:push (${missing.join(", ")})` : ""}`);
  if (manifest) {
    const rows = ["Client", "Project", "RankRun", "AuditLog"].filter((table) => table in manifest.rows).map((table) => `${manifest.rows[table]} ${table}`).join(", ");
    console.log(`Contents:  ${rows || "row counts not recorded"}; verified by ${manifest.verification === "restore" ? "a test restore" : "decoding the archive"} when taken`);
  }
  const keyStatus = keyMismatchStatus(manifest);
  console.log(`Key:       ${keyStatus.message}`);
  if (keyStatus.mismatch && !args.ignoreKeyMismatch) {
    throw new Error("The stored API keys and Google tokens in this archive would be unreadable here. Set the key it was taken under as APP_SECRETS_ENCRYPTION_KEY (or as APP_SECRETS_PREVIOUS_ENCRYPTION_KEY to rotate, see README), or pass --ignore-key-mismatch to restore anyway.");
  }

  console.log(`Target:    ${target.label}, schema "${target.schema}" (${args.target})`);
  // The scripts' own connections carry an application name so the session check can ignore them.
  const targetClient = databaseClient(targetUrl);
  try {
    if (args.target === "verify" && !(await scratchDatabaseUsable(targetClient, target.schema))) {
      throw new Error(`${target.label} holds tables the backup script did not create; it is not a scratch database.`);
    }
    if (args.target === "live") await describeLiveDatabase(targetClient, target, tables);
    const others = await otherSessionCount(targetClient);
    if (others > 0 && !args.allowOtherSessions) {
      throw new Error(`${others} other session(s) are connected to ${target.database}. Stop the app in Plesk and disable the worker's scheduled task first, or pass --allow-other-sessions if you are sure they are idle.`);
    }

    if (args.confirm !== target.database) {
      console.log(`\nNothing was changed. To replace ${target.database} with this archive, re-run with: --target ${args.target} --confirm ${target.database}`);
      process.exitCode = 1;
      return;
    }

    // The same lock the nightly backup takes, so a backup cannot start (or use the scratch database) mid-restore.
    await withImportLock(BACKUP_LOCK_KEY, "A backup is running right now; wait for it to finish, then try again.", async () => {
      if (args.target === "live" && !args.skipSafetyCopy) {
        const directory = path.resolve(settings.directory);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const copyPath = path.join(directory, preRestoreFileName(target.database, new Date()));
        const copy = await dumpDatabase(target, copyPath, toolOptions);
        console.log(`\nSafety copy of the current database: ${copyPath} (${formatBytes(copy.sizeBytes)}). Delete it yourself once the restore is confirmed good.`);
      }

      console.log("Emptying the schema and restoring the archive…");
      await emptySchema(targetClient, target.schema);
      if (args.target === "verify") await createScratchMarker(targetClient, target.schema, `restored ${fileName} for a drill`);
      await targetClient.$disconnect();
      await runPostgresTool("pg_restore", pgRestoreArguments(target, filePath), toolOptions);
      await settleRestoredState(targetClient, target.schema, `Restored from ${fileName} at ${new Date().toISOString()}; the last backup before that is the one recorded here.`);
    }, settings.timeoutMinutes * 4);
    if (args.target === "live") {
      await writeAuditLog({ event: "backup.restored", actorEmail: "system", actorRole: "system", entityType: "backup", entityId: fileName, metadata: { sizeBytes, tables: tables.length } });
    }
    console.log(`Restored ${fileName} into ${target.label}.`);
    if (args.target === "live") {
      console.log("Next: run npm run db:push, restart the app and the worker, re-enable the worker's scheduled task, then check Settings > API keys shows every stored key as readable.");
    } else {
      console.log("Next: point a copy of the app at BACKUP_VERIFY_DATABASE_URL to inspect it (see README, restore drill). The next nightly backup empties the scratch database again.");
    }
  } finally {
    await targetClient.$disconnect();
  }
}

function parseArguments(argv: string[]): Arguments {
  const args: Arguments = { file: null, target: null, confirm: null, allowOtherSessions: false, ignoreKeyMismatch: false, skipSafetyCopy: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined || next.startsWith("--")) throw new Error(`${argument} needs a value. ${USAGE}`);
      return next;
    };
    if (argument === "--file") args.file = value();
    else if (argument.startsWith("--file=")) args.file = argument.slice("--file=".length);
    else if (argument === "--target") args.target = parseTarget(value());
    else if (argument.startsWith("--target=")) args.target = parseTarget(argument.slice("--target=".length));
    else if (argument === "--confirm") args.confirm = value();
    else if (argument.startsWith("--confirm=")) args.confirm = argument.slice("--confirm=".length);
    else if (argument === "--allow-other-sessions") args.allowOtherSessions = true;
    else if (argument === "--ignore-key-mismatch") args.ignoreKeyMismatch = true;
    else if (argument === "--no-safety-copy") args.skipSafetyCopy = true;
    else if (!argument.startsWith("--") && !args.file) args.file = argument;
    else throw new Error(`Unknown argument ${argument}. ${USAGE}`);
  }
  return args;
}

function parseTarget(value: string) {
  if (value === "live" || value === "verify") return value;
  throw new Error(`--target must be "live" or "verify". ${USAGE}`);
}

function resolveScratch(verifyDatabaseUrl: string | null, live: PostgresTarget) {
  if (!verifyDatabaseUrl) throw new Error("--target verify needs BACKUP_VERIFY_DATABASE_URL in .env.");
  const scratch = postgresTarget(verifyDatabaseUrl, "BACKUP_VERIFY_DATABASE_URL");
  const problem = scratchTargetProblem(live, scratch);
  if (problem) throw new Error(problem);
  return scratch;
}

async function checksumStatus(filePath: string, fileName: string) {
  const expected = await readFile(`${filePath}${BACKUP_CHECKSUM_EXTENSION}`, "utf8").catch(() => null);
  if (expected === null) return "no .sha256 file beside the archive (the backup script writes one; a copied archive may have lost it)";
  if (expected.trim().split(/\s+/)[0] !== (await fileSha256(filePath))) {
    throw new Error(`${fileName} does not match its .sha256 file. The archive is corrupt or was altered; use another backup.`);
  }
  return "matches the .sha256 file";
}

async function readManifest(filePath: string): Promise<BackupManifest | null> {
  const text = await readFile(`${filePath}${BACKUP_MANIFEST_EXTENSION}`, "utf8").catch(() => null);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as BackupManifest;
    return parsed && typeof parsed === "object" && typeof parsed.rows === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Compare the key the archive was taken under with the keys this environment holds. */
function keyMismatchStatus(manifest: BackupManifest | null) {
  if (!manifest) return { mismatch: false, message: "no manifest beside the archive, so the master key it was taken under is unknown; check Settings after restoring" };
  if (!manifest.keyFingerprint) return { mismatch: false, message: "no master key was configured when the archive was taken" };
  const here = [masterKeyFingerprint(readMasterEncryptionKey()), masterKeyFingerprint(readPreviousEncryptionKey())].filter(Boolean);
  if (here.includes(manifest.keyFingerprint)) return { mismatch: false, message: `the master key the archive was taken under (${manifest.keyFingerprint}) is configured here` };
  return { mismatch: true, message: `the archive was taken under master key ${manifest.keyFingerprint}, which is not configured here (${here.length > 0 ? here.join(", ") : "no key set"})` };
}

async function describeLiveDatabase(client: ReturnType<typeof databaseClient>, target: PostgresTarget, tables: string[]) {
  try {
    const counts = await countRows(client, target.schema, tables.filter((table) => ["Client", "Project", "RankRun", "AuditLog"].includes(table)));
    const summary = Object.entries(counts).map(([table, count]) => `${count} ${table}`).join(", ");
    const latest = await client.auditLog.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    console.log(`Now:       ${summary || "no rows"}${latest ? `; newest audit entry ${latest.createdAt.toISOString()}` : ""}. All of it will be replaced.`);
    const worker = await client.workerHeartbeat.findUnique({ where: { key: RANK_WORKER_KEY } });
    const activity = worker?.completedAt ?? worker?.startedAt;
    if (worker?.status === "running" || (activity && Date.now() - activity.getTime() < 10 * 60 * 1000)) {
      console.log("Warning:   the rank worker ran within the last ten minutes. Disable its Plesk scheduled task before restoring, or it will write into the restored data.");
    }
  } catch (error) {
    console.log(`Now:       the live database could not be read (${redactSecrets(error instanceof Error ? error.message : String(error), target.password)}); it may already be empty.`);
  }
}

main()
  .catch((error) => {
    console.error(isImportLockHeldError(error) ? error.message : redactSecrets(error instanceof Error ? error.message : String(error), null));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
