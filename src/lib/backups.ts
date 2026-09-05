import { Prisma } from "@prisma/client";
import { configuredPositiveInteger } from "@/lib/env";

/**
 * Database backups. `npm run db:backup` (scripts/backup-database.ts) dumps PostgreSQL with pg_dump,
 * proves the archive decodes and lists every table, optionally test-restores it into a scratch
 * database, prunes old files, and records the outcome in the `database-backup` heartbeat that
 * Settings and the dashboard show. `npm run db:restore` (scripts/restore-database.ts) puts an
 * archive back. Everything here is pure so it can be tested without a database or the client tools.
 */
export const BACKUP_HEARTBEAT_KEY = "database-backup";
export const BACKUP_LOCK_KEY = "database-backup";
export const BACKUP_FILE_PREFIX = "star-reports-";
export const BACKUP_FILE_EXTENSION = ".dump";
export const BACKUP_CHECKSUM_EXTENSION = ".sha256";
export const BACKUP_MANIFEST_EXTENSION = ".meta.json";
export const BACKUP_PARTIAL_EXTENSION = ".partial";
/** Table the backup script creates in the scratch database; its presence is what allows the schema to be emptied. */
export const SCRATCH_MARKER_TABLE = "_star_reports_scratch";
const BACKUP_FILE_PATTERN = /^star-reports-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump$/;
const PRE_RESTORE_FILE_PATTERN = /^pre-restore-.+-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump$/;

/** Hours since the last successful backup after which the app reports backups as stale. A daily task gets a two-hour grace period. */
export const BACKUP_STALE_HOURS_ENV = "BACKUP_STALE_HOURS";
export const DEFAULT_BACKUP_STALE_HOURS = 26;
/** A run still marked "running" after this long has died: each tool step is bounded by BACKUP_TIMEOUT_MINUTES (60) and a run makes at most four. */
export const BACKUP_RUN_LIMIT_HOURS = 4;

export type BackupSettings = {
  directory: string;
  retentionDays: number;
  keepMinimum: number;
  /** Directory holding pg_dump and pg_restore, or null to rely on PATH. */
  toolDirectory: string | null;
  verifyDatabaseUrl: string | null;
  timeoutMinutes: number;
};

export function backupSettings(env: Record<string, string | undefined>): BackupSettings {
  return {
    directory: env.BACKUP_DIR?.trim() || "backups",
    retentionDays: positiveInteger(env.BACKUP_RETENTION_DAYS, 30),
    keepMinimum: positiveInteger(env.BACKUP_KEEP_MINIMUM, 7),
    toolDirectory: env.BACKUP_PG_BIN?.trim() || null,
    verifyDatabaseUrl: env.BACKUP_VERIFY_DATABASE_URL?.trim() || null,
    timeoutMinutes: positiveInteger(env.BACKUP_TIMEOUT_MINUTES, 60)
  };
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * A database connection prepared for the PostgreSQL client tools: the password is separated out so
 * it can travel in PGPASSWORD instead of a process argument (visible to every user on the host), and
 * Prisma-only URL parameters, which libpq rejects, are dropped.
 */
export type PostgresTarget = {
  /** Connection URL without the password and without Prisma-only parameters. */
  url: string;
  password: string | null;
  schema: string;
  database: string;
  host: string;
  /** Safe to print: database name and host, never credentials. */
  label: string;
};

/** libpq parameters that may stay on the URL. Anything else (schema, connection_limit, pool_timeout, pgbouncer, Prisma's ssl* names) is dropped. */
const LIBPQ_PARAMETERS = new Set(["sslmode", "sslrootcert", "connect_timeout", "application_name", "options", "target_session_attrs", "host"]);

export function postgresTarget(databaseUrl: string | undefined, variable = "DATABASE_URL"): PostgresTarget {
  let url: URL;
  try {
    url = new URL(databaseUrl ?? "");
  } catch {
    throw new Error(`${variable} is not a valid PostgreSQL connection URL.`);
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${variable} must start with postgresql://.`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error(`${variable} does not name a database.`);
  const schema = url.searchParams.get("schema")?.trim() || "public";
  const password = url.password ? decodeURIComponent(url.password) : null;

  const cleaned = new URL(url.toString());
  cleaned.password = "";
  for (const key of Array.from(cleaned.searchParams.keys())) {
    if (!LIBPQ_PARAMETERS.has(key)) cleaned.searchParams.delete(key);
  }
  const host = url.searchParams.get("host")?.trim() || url.host || "local socket";
  return { url: cleaned.toString(), password, schema, database, host, label: `${database} on ${host}` };
}

/**
 * The scratch database must have a different name from the live one. Host spellings are not
 * compared because localhost, 127.0.0.1, and the server's own name can all be the same server;
 * the name check, and the marker table the scratch database must carry, are what protect live data.
 */
export function scratchNameAcceptable(live: PostgresTarget, scratch: PostgresTarget) {
  return live.database !== scratch.database;
}

/** Why BACKUP_VERIFY_DATABASE_URL cannot be used as the scratch database, or null when it can. */
export function scratchTargetProblem(live: PostgresTarget, scratch: PostgresTarget) {
  if (!scratchNameAcceptable(live, scratch)) {
    return `BACKUP_VERIFY_DATABASE_URL names the live database (${scratch.database}). The test restore needs a separate, dedicated scratch database.`;
  }
  if (live.schema !== scratch.schema) {
    return `BACKUP_VERIFY_DATABASE_URL uses schema "${scratch.schema}" but DATABASE_URL uses "${live.schema}"; give both the same ?schema= parameter.`;
  }
  return null;
}

/** Remove the database password (and anything shaped like a URL credential) from text that will be stored or printed. */
export function redactSecrets(text: string, password: string | null) {
  let result = text.replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1***@");
  if (password) result = result.split(password).join("***");
  return result;
}

export function backupFileName(now: Date) {
  return `${BACKUP_FILE_PREFIX}${timestamp(now)}${BACKUP_FILE_EXTENSION}`;
}

/** The copy of a database taken just before it is replaced; a different name so retention never touches it. */
export function preRestoreFileName(database: string, now: Date) {
  return `pre-restore-${database.replace(/[^A-Za-z0-9_-]+/g, "_")}-${timestamp(now)}${BACKUP_FILE_EXTENSION}`;
}

function timestamp(now: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${date}-${time}`;
}

/** The UTC time embedded in a backup file name, or null for files the backup script did not write. */
export function backupFileTime(name: string, pattern = BACKUP_FILE_PATTERN) {
  const match = pattern.exec(name);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const time = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC silently rolls an impossible date (month 13, day 32) into the next one; only accept exact round-trips.
  const exact = time.getUTCFullYear() === year && time.getUTCMonth() === month - 1 && time.getUTCDate() === day
    && time.getUTCHours() === hour && time.getUTCMinutes() === minute && time.getUTCSeconds() === second;
  return exact ? time : null;
}

/**
 * Which backup files to delete: only files this script named, older than the retention window, and
 * never the newest `keepMinimum` regardless of age, so a task that stops running for a month cannot
 * leave the directory empty when it starts again. Every file in the directory passed verification
 * (failed archives are deleted on the spot), so the newest files are always usable backups.
 */
export function backupsToPrune(names: string[], options: { retentionDays: number; keepMinimum: number; now: Date }) {
  const dated = names
    .map((name) => ({ name, time: backupFileTime(name) }))
    .filter((file): file is { name: string; time: Date } => file.time !== null)
    .sort((a, b) => b.time.getTime() - a.time.getTime());
  const cutoff = options.now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000;
  return dated
    .slice(Math.max(options.keepMinimum, 0))
    .filter((file) => file.time.getTime() < cutoff)
    .map((file) => file.name);
}

/** Leftovers of runs that were killed mid-dump: `.partial` files older than the run timeout. */
export function partialFilesToRemove(names: string[], options: { timeoutMinutes: number; now: Date }) {
  const cutoff = options.now.getTime() - options.timeoutMinutes * 60 * 1000;
  return names.filter((name) => {
    if (!name.endsWith(BACKUP_PARTIAL_EXTENSION)) return false;
    const base = name.slice(0, -BACKUP_PARTIAL_EXTENSION.length);
    const time = backupFileTime(base) ?? backupFileTime(base, PRE_RESTORE_FILE_PATTERN);
    return time !== null && time.getTime() < cutoff;
  });
}

/** Sidecar files that belong to an archive and go with it. */
export function companionFiles(archiveName: string) {
  return [`${archiveName}${BACKUP_CHECKSUM_EXTENSION}`, `${archiveName}${BACKUP_MANIFEST_EXTENSION}`];
}

/** Every table the Prisma schema defines, by its database name. An archive missing any of them is not a usable backup. */
export function requiredTables() {
  return Prisma.dmmf.datamodel.models.map((model) => model.dbName ?? model.name);
}

/** The database table behind a Prisma model (models renamed with @@map differ from their table). */
export function tableForModel(model: string) {
  const found = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === model);
  if (!found) throw new Error(`Unknown Prisma model ${model}.`);
  return found.dbName ?? found.name;
}

/**
 * Table names from `pg_restore --list` output. Entries look like
 * `238; 1259 39438 TABLE public ApiRequest evie`; names with unusual characters are double-quoted.
 */
export function archiveTables(listing: string, schema = "public") {
  const tables = new Set<string>();
  const pattern = /^\d+; \d+ \d+ TABLE (\S+) ("(?:[^"]|"")*"|\S+) /;
  for (const line of listing.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (!match || match[1] !== schema) continue;
    const name = match[2];
    tables.add(name.startsWith('"') ? name.slice(1, -1).replaceAll('""', '"') : name);
  }
  return Array.from(tables).sort();
}

/** The comment lines pg_restore prints first: when the archive was made and by which versions. */
export function archiveHeader(listing: string) {
  return listing
    .split(/\r?\n/)
    .filter((line) => /^;\s+(Archive created at|Dumped from database version|Dumped by pg_dump version)/.test(line))
    .map((line) => line.replace(/^;\s+/, ""));
}

export function missingTables(listed: string[], required = requiredTables()) {
  const present = new Set(listed);
  return required.filter((table) => !present.has(table)).sort();
}

/** `pg_dump (PostgreSQL) 16.4 (Ubuntu 16.4-1.pgdg22.04+1)` → 16; `SHOW server_version_num` → 160004 → 16. */
export function toolMajorVersion(versionOutput: string) {
  const match = /\(PostgreSQL\)\s+(\d+)/.exec(versionOutput) ?? /(\d+)\.\d+/.exec(versionOutput);
  return match ? Number(match[1]) : null;
}

export function serverMajorVersion(serverVersionNum: number | string) {
  const value = Number(serverVersionNum);
  if (!Number.isInteger(value) || value <= 0) return null;
  // 10 and later: MMmmmm. Before 10: Mmmpp (9.6.24 → 90624).
  return value >= 100000 ? Math.floor(value / 10000) : Math.floor(value / 10000);
}

/** pg_dump refuses servers newer than itself, so the client major must be at least the server major. */
export function clientCanDumpServer(clientMajor: number | null, serverMajor: number | null) {
  if (clientMajor === null || serverMajor === null) return true;
  return clientMajor >= serverMajor;
}

/** Row counts in the live database and in the test restore, both taken from the same snapshot, so they must match exactly. */
export type RowCountComparison = {
  mismatched: { table: string; live: number; restored: number }[];
  matched: number;
};

export function compareRowCounts(live: Record<string, number>, restored: Record<string, number>): RowCountComparison {
  const comparison: RowCountComparison = { mismatched: [], matched: 0 };
  for (const table of Object.keys(live).sort()) {
    const restoredCount = restored[table] ?? 0;
    if (restoredCount !== live[table]) comparison.mismatched.push({ table, live: live[table], restored: restoredCount });
    else comparison.matched += 1;
  }
  return comparison;
}

/** How many stored values (API keys, previous versions, Google tokens) open with which master key. */
export type SecretsCheck = {
  total: number;
  /** Opened with the current master key. */
  current: number;
  /** Opened only with the previous key from a rotation still in progress. */
  previous: number;
};

export type BackupVerification =
  | { level: "archive"; tables: number }
  | { level: "restore"; tables: number; comparison: RowCountComparison; secrets: SecretsCheck | null };

/** Written beside each archive so a restore can tell what it holds and which master key it needs. */
export type BackupManifest = {
  archive: string;
  createdAt: string;
  sha256: string;
  sizeBytes: number;
  schema: string;
  appVersion: string;
  pgDumpVersion: string | null;
  serverVersion: string | null;
  /** Row counts at the moment of the dump. */
  rows: Record<string, number>;
  verification: BackupVerification["level"];
  /** Identity of the master key in force when the dump was taken, never the key itself. */
  keyFingerprint: string | null;
  previousKeyFingerprint: string | null;
};

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function describeSecretsCheck(secrets: SecretsCheck | null) {
  if (!secrets || secrets.total === 0) return null;
  const opened = secrets.current + secrets.previous;
  if (opened < secrets.total) return `${secrets.total - opened} of ${secrets.total} stored keys do not open with this master key`;
  if (secrets.previous > 0) return `${secrets.previous} of ${secrets.total} stored keys open only with the previous master key`;
  return `all ${secrets.total} stored keys open`;
}

/** One line for the heartbeat and the Settings page: which file, how big, and how far it was proven. */
export function describeBackup(input: { fileName: string; sizeBytes: number; verification: BackupVerification }) {
  const parts = [input.fileName, formatBytes(input.sizeBytes), `${input.verification.tables} tables`];
  if (input.verification.level === "archive") {
    parts.push("archive decoded; set BACKUP_VERIFY_DATABASE_URL to test restores");
  } else {
    parts.push("restore tested");
    const secrets = describeSecretsCheck(input.verification.secrets);
    if (secrets) parts.push(secrets);
  }
  return parts.join(" · ");
}

export type BackupHealth = {
  state: "never" | "running" | "failed" | "stale" | "healthy";
  label: string;
  healthy: boolean;
};

export function backupHealth(
  heartbeat: { status: string; startedAt: Date | null; lastSuccessAt: Date | null } | null,
  now = new Date(),
  staleHours = configuredPositiveInteger(BACKUP_STALE_HOURS_ENV, DEFAULT_BACKUP_STALE_HOURS)
): BackupHealth {
  const staleMs = staleHours * 60 * 60 * 1000;
  if (!heartbeat) return { state: "never", label: "Never run", healthy: false };
  if (heartbeat.status === "running") {
    // A script killed mid-run (reboot, out of memory) leaves "running" behind; past the run limit it is a failure, not a backup in progress.
    const runLimitMs = BACKUP_RUN_LIMIT_HOURS * 60 * 60 * 1000;
    if (heartbeat.startedAt && now.getTime() - heartbeat.startedAt.getTime() <= runLimitMs) return { state: "running", label: "Running", healthy: true };
    return { state: "failed", label: "Did not finish", healthy: false };
  }
  if (heartbeat.status === "failed") return { state: "failed", label: "Failed", healthy: false };
  if (!heartbeat.lastSuccessAt || now.getTime() - heartbeat.lastSuccessAt.getTime() > staleMs) return { state: "stale", label: "Stale", healthy: false };
  return { state: "healthy", label: "Healthy", healthy: true };
}
