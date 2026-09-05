import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { PrismaClient } from "@prisma/client";
import { BACKUP_PARTIAL_EXTENSION, redactSecrets, SCRATCH_MARKER_TABLE, type PostgresTarget } from "@/lib/backups";

/**
 * Thin wrappers around pg_dump and pg_restore for the backup and restore scripts. The database
 * password is handed to the tools through PGPASSWORD, never on the command line, and the tools'
 * output is redacted before it is stored or printed.
 */
export type PostgresTool = "pg_dump" | "pg_restore";

export type ToolOptions = { toolDirectory: string | null; password: string | null; timeoutMs: number };

/** Any Prisma client or interactive transaction. */
export type SqlClient = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;

const STDERR_LIMIT = 64 * 1024;
/** How long pg_dump waits for a table lock before giving up, so a deploy or stuck transaction cannot hang the task all night. */
const LOCK_WAIT_TIMEOUT_MS = 60_000;

export function toolCommand(tool: PostgresTool, toolDirectory: string | null) {
  return toolDirectory ? path.join(toolDirectory, tool) : tool;
}

/**
 * Custom format keeps the archive compressed, checkable with `pg_restore --list`, and restorable
 * table by table. With a snapshot name the dump sees exactly the data a concurrent transaction sees.
 */
export function pgDumpArguments(target: PostgresTarget, file: string, options: { snapshot?: string } = {}) {
  return [
    "--format=custom",
    "--compress=6",
    "--no-owner",
    "--no-privileges",
    `--lock-wait-timeout=${LOCK_WAIT_TIMEOUT_MS}`,
    `--schema=${target.schema}`,
    ...(options.snapshot ? [`--snapshot=${options.snapshot}`] : []),
    `--file=${file}`,
    `--dbname=${target.url}`
  ];
}

export function pgRestoreListArguments(file: string) {
  return ["--list", file];
}

/** Decode every data block into SQL text that is thrown away: proves the whole archive is intact without a database. */
export function pgRestoreDecodeArguments(file: string) {
  return ["--file=/dev/null", file];
}

/**
 * Restore into a schema that has just been emptied (see emptySchema). Ownership and grants are not
 * restored because the Plesk database user is not a superuser; everything simply belongs to the
 * connecting user. One transaction means a failure leaves the schema empty rather than half-filled.
 */
export function pgRestoreArguments(target: PostgresTarget, file: string) {
  return ["--no-owner", "--no-privileges", "--single-transaction", "--exit-on-error", `--schema=${target.schema}`, `--dbname=${target.url}`, file];
}

export async function runPostgresTool(tool: PostgresTool, args: string[], options: ToolOptions): Promise<{ stdout: string }> {
  const command = toolCommand(tool, options.toolDirectory);
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PGCONNECT_TIMEOUT: "30" };
    if (options.password !== null) env.PGPASSWORD = options.password;
    else delete env.PGPASSWORD;
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // pg_dump normally stops on SIGTERM; a process stuck in a lock wait or a dead connection may not.
      killer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      if (stderr.length < STDERR_LIMIT) stderr += chunk.slice(0, STDERR_LIMIT - stderr.length);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      clearTimeout(killer);
      if (error.code === "ENOENT") {
        reject(new Error(`${command} was not found. Install the PostgreSQL client tools on this server, or set BACKUP_PG_BIN to the directory that holds pg_dump and pg_restore (for example /usr/pgsql-16/bin or /usr/lib/postgresql/16/bin).`));
      } else {
        reject(new Error(`${tool} could not be started: ${redactSecrets(error.message, options.password)}`));
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killer);
      if (timedOut) {
        reject(new Error(`${tool} did not finish within ${Math.round(options.timeoutMs / 60000)} minutes and was stopped.`));
      } else if (code !== 0) {
        const detail = redactSecrets(stderr.trim(), options.password) || (signal ? `stopped by ${signal}` : "no error output");
        reject(new Error(`${tool} exited with code ${code ?? "unknown"}: ${detail}`));
      } else {
        resolve({ stdout });
      }
    });
  });
}

export async function toolVersion(tool: PostgresTool, options: ToolOptions) {
  const { stdout } = await runPostgresTool(tool, ["--version"], { ...options, password: null });
  return stdout.trim();
}

/**
 * Dump a database to `filePath`: written as a `.partial` file first, renamed only when pg_dump
 * succeeded, readable by the app user alone, with its SHA-256 returned for the checksum file.
 */
export async function dumpDatabase(target: PostgresTarget, filePath: string, options: ToolOptions & { snapshot?: string }) {
  const partialPath = `${filePath}${BACKUP_PARTIAL_EXTENSION}`;
  try {
    await runPostgresTool("pg_dump", pgDumpArguments(target, partialPath, { snapshot: options.snapshot }), options);
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
  await rename(partialPath, filePath);
  // pg_dump writes with the default umask; the archive holds every client's data, so only the app user may read it.
  await chmod(filePath, 0o600);
  const sizeBytes = (await stat(filePath)).size;
  return { sizeBytes, sha256: await fileSha256(filePath) };
}

export async function fileSha256(filePath: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

export function quoteIdentifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Marks the scripts' own connections so a restore can tell them apart from the app's and the worker's. */
export const MAINTENANCE_APPLICATION_NAME = "star-reports-maintenance";

export function withApplicationName(databaseUrl: string, name = MAINTENANCE_APPLICATION_NAME) {
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", name);
  return url.toString();
}

/** A Prisma client for the backup and restore scripts, identified by application name (for the live database or the scratch one). */
export function databaseClient(databaseUrl: string) {
  return new PrismaClient({ datasourceUrl: withApplicationName(databaseUrl), log: ["error"] });
}

export type SchemaContents = { tables: string[]; views: string[]; sequences: string[]; enums: string[] };

export async function schemaContents(client: SqlClient, schema: string): Promise<SchemaContents> {
  const literal = quoteLiteral(schema);
  const [tables, views, sequences, enums] = await Promise.all([
    client.$queryRawUnsafe<{ name: string }[]>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = ${literal} ORDER BY 1`),
    client.$queryRawUnsafe<{ name: string }[]>(`SELECT viewname AS name FROM pg_views WHERE schemaname = ${literal} ORDER BY 1`),
    client.$queryRawUnsafe<{ name: string }[]>(`SELECT sequencename AS name FROM pg_sequences WHERE schemaname = ${literal} ORDER BY 1`),
    client.$queryRawUnsafe<{ name: string }[]>(
      `SELECT t.typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = ${literal} AND t.typtype = 'e' ORDER BY 1`
    )
  ]);
  const names = (rows: { name: string }[]) => rows.map((row) => row.name);
  return { tables: names(tables), views: names(views), sequences: names(sequences), enums: names(enums) };
}

/**
 * Drop everything in a schema (tables, views, sequences, enum types) without dropping the schema
 * itself, which on PostgreSQL before 15 belongs to the superuser rather than the Plesk database
 * user. Everything happens in one transaction on one connection: `lock_timeout` makes the drop fail
 * quickly, with a clear message, when another session (the app, the worker) still holds the tables,
 * and a failure rolls back so nothing is half-dropped.
 */
export async function emptySchema(client: PrismaClient, schema: string) {
  const qualified = (name: string) => `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
  try {
    return await client.$transaction(async (tx) => {
      const contents = await schemaContents(tx, schema);
      const statements = [
        ...contents.views.map((name) => `DROP VIEW IF EXISTS ${qualified(name)} CASCADE`),
        ...contents.tables.map((name) => `DROP TABLE IF EXISTS ${qualified(name)} CASCADE`),
        ...contents.sequences.map((name) => `DROP SEQUENCE IF EXISTS ${qualified(name)} CASCADE`),
        ...contents.enums.map((name) => `DROP TYPE IF EXISTS ${qualified(name)} CASCADE`)
      ];
      if (statements.length === 0) return contents;
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
      return contents;
    }, { maxWait: 10_000, timeout: 5 * 60 * 1000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/lock timeout|canceling statement/i.test(message)) {
      throw new Error(`Schema ${schema} is still in use by another session (the app or the worker). Stop them, then try again.`);
    }
    throw new Error(`Schema ${schema} could not be emptied: ${message}`);
  }
}

/**
 * Whether a database may be used as the scratch target: it holds no tables at all (first use), or it
 * carries the marker table this script created last time. A live database never qualifies.
 */
export async function scratchDatabaseUsable(client: SqlClient, schema: string) {
  const contents = await schemaContents(client, schema);
  return contents.tables.length === 0 || contents.tables.includes(SCRATCH_MARKER_TABLE);
}

export async function createScratchMarker(client: SqlClient, schema: string, note: string) {
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier(SCRATCH_MARKER_TABLE)}`;
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${table} ("note" text NOT NULL, "at" timestamptz NOT NULL DEFAULT now())`);
  await client.$executeRawUnsafe(`INSERT INTO ${table} ("note") VALUES (${quoteLiteral(note)})`);
}

export async function countRows(client: SqlClient, schema: string, tables: string[]): Promise<Record<string, number>> {
  if (tables.length === 0) return {};
  const sql = tables
    .map((table) => `SELECT ${quoteLiteral(table)} AS "table", (SELECT COUNT(*) FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}) AS "count"`)
    .join(" UNION ALL ");
  const rows = await client.$queryRawUnsafe<{ table: string; count: bigint }[]>(sql);
  return Object.fromEntries(rows.map((row) => [row.table, Number(row.count)]));
}

export async function serverVersion(client: SqlClient) {
  const [row] = await client.$queryRawUnsafe<{ num: string; text: string }[]>("SELECT current_setting('server_version_num') AS num, current_setting('server_version') AS text");
  return { num: Number(row?.num ?? 0), text: row?.text ?? null };
}

export async function databaseSizeBytes(client: SqlClient) {
  const [row] = await client.$queryRawUnsafe<{ size: bigint }[]>("SELECT pg_database_size(current_database()) AS size");
  return Number(row?.size ?? 0);
}

/** Connections to the current database other than the scripts' own, which a restore must not run under. */
export async function otherSessionCount(client: SqlClient) {
  const [row] = await client.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend' AND application_name <> ${quoteLiteral(MAINTENANCE_APPLICATION_NAME)}`
  );
  return Number(row?.count ?? 0);
}

/**
 * Rows restored from an archive describe the moment it was taken: locks held by runs that ended
 * long ago (the backup that produced the archive was itself holding one) and a backup heartbeat
 * frozen at "running". Releasing the locks stops the next backup or import from waiting; settling
 * the heartbeat stops the next backup from reporting a phantom unfinished run.
 */
export async function settleRestoredState(client: SqlClient, schema: string, note: string) {
  await client.$executeRawUnsafe(`UPDATE ${quoteIdentifier(schema)}."SystemLock" SET "owner" = NULL, "lockedUntil" = to_timestamp(0)`);
  await client.$executeRawUnsafe(
    `UPDATE ${quoteIdentifier(schema)}."WorkerHeartbeat" SET "status" = 'healthy', "message" = ${quoteLiteral(note)} WHERE "key" = 'database-backup' AND "status" = 'running'`
  );
}
