import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveHeader,
  archiveTables,
  backupFileName,
  backupFileTime,
  backupHealth,
  backupSettings,
  backupsToPrune,
  clientCanDumpServer,
  companionFiles,
  compareRowCounts,
  describeBackup,
  describeSecretsCheck,
  formatBytes,
  missingTables,
  partialFilesToRemove,
  postgresTarget,
  preRestoreFileName,
  redactSecrets,
  requiredTables,
  scratchNameAcceptable,
  scratchTargetProblem,
  serverMajorVersion,
  tableForModel,
  toolMajorVersion
} from "../src/lib/backups";
import { pgDumpArguments, pgRestoreArguments, pgRestoreDecodeArguments, quoteIdentifier, toolCommand, withApplicationName } from "../src/lib/postgres-tools";

const LISTING = `;
; Archive created at 2026-09-05 12:05:53 BST
;     dbname: star_reports
;     Format: CUSTOM
;     Dumped from database version: 18.6 (Postgres.app)
;     Dumped by pg_dump version: 18.6 (Postgres.app)
;
4; 2615 2200 SCHEMA - public pg_database_owner
889; 1247 39004 TYPE public ApiDeliveryMethod evie
238; 1259 39438 TABLE public ApiRequest evie
241; 1259 39667 TABLE public AppSecret evie
225; 1259 39226 TABLE public GoogleSearchConsoleConnection evie
250; 1259 39900 TABLE public "Odd ""Name""" evie
251; 1259 39901 TABLE other Client evie
3966; 2606 39455 CONSTRAINT public ApiRequest ApiRequest_pkey evie
4100; 0 39438 TABLE DATA public ApiRequest evie
`;

test("backup settings have safe defaults and ignore nonsense", () => {
  assert.deepEqual(backupSettings({}), { directory: "backups", retentionDays: 30, keepMinimum: 7, toolDirectory: null, verifyDatabaseUrl: null, timeoutMinutes: 60 });
  const custom = backupSettings({ BACKUP_DIR: " /var/backups/star ", BACKUP_RETENTION_DAYS: "14", BACKUP_KEEP_MINIMUM: "0", BACKUP_PG_BIN: "/usr/pgsql-16/bin", BACKUP_VERIFY_DATABASE_URL: "postgresql://u@h/scratch", BACKUP_TIMEOUT_MINUTES: "-5" });
  assert.deepEqual(custom, { directory: "/var/backups/star", retentionDays: 14, keepMinimum: 7, toolDirectory: "/usr/pgsql-16/bin", verifyDatabaseUrl: "postgresql://u@h/scratch", timeoutMinutes: 60 });
});

test("the connection URL is split so the password travels in PGPASSWORD and Prisma-only parameters are dropped", () => {
  const target = postgresTarget("postgresql://star:p%40ss%2Fword@db.example.test:5433/star_reports?schema=app&connection_limit=5&pool_timeout=10&sslmode=require&pgbouncer=true");
  assert.equal(target.password, "p@ss/word");
  assert.equal(target.url, "postgresql://star@db.example.test:5433/star_reports?sslmode=require");
  assert.equal(target.schema, "app");
  assert.equal(target.database, "star_reports");
  assert.equal(target.host, "db.example.test:5433");
  assert.equal(target.label, "star_reports on db.example.test:5433");

  const plain = postgresTarget("postgres://evie@localhost:5432/star_reports");
  assert.equal(plain.password, null);
  assert.equal(plain.schema, "public");
  assert.equal(plain.url, "postgres://evie@localhost:5432/star_reports");

  const socket = postgresTarget("postgresql://evie@localhost/star_reports?host=/var/run/postgresql&schema=public");
  assert.equal(socket.url, "postgresql://evie@localhost/star_reports?host=%2Fvar%2Frun%2Fpostgresql");
  assert.equal(socket.host, "/var/run/postgresql");

  const ipv6 = postgresTarget("postgresql://evie:pw@[::1]:5432/star_reports");
  assert.equal(ipv6.host, "[::1]:5432");
  assert.equal(ipv6.url, "postgresql://evie@[::1]:5432/star_reports");

  assert.throws(() => postgresTarget(undefined), /not a valid PostgreSQL connection URL/);
  assert.throws(() => postgresTarget("mysql://a@b/c"), /must start with postgresql/);
  assert.throws(() => postgresTarget("postgresql://a@b/"), /does not name a database/);
  assert.throws(() => postgresTarget("nope", "BACKUP_VERIFY_DATABASE_URL"), /BACKUP_VERIFY_DATABASE_URL/);
});

test("a scratch database must have a different name; host spellings are not trusted to tell servers apart", () => {
  const live = postgresTarget("postgresql://star:pw@localhost:5432/star_reports?schema=public");
  assert.equal(scratchNameAcceptable(live, postgresTarget("postgresql://other:pw@127.0.0.1:5432/star_reports")), false);
  assert.equal(scratchNameAcceptable(live, postgresTarget("postgresql://star:pw@db.example.test:5433/star_reports")), false);
  assert.equal(scratchNameAcceptable(live, postgresTarget("postgresql://star:pw@localhost:5432/star_reports_verify")), true);
  assert.equal(scratchTargetProblem(live, postgresTarget("postgresql://star:pw@localhost:5432/star_reports_verify?schema=public")), null);
  assert.match(scratchTargetProblem(live, postgresTarget("postgresql://star:pw@127.0.0.1/star_reports")) ?? "", /names the live database \(star_reports\)/);
  assert.match(scratchTargetProblem(live, postgresTarget("postgresql://star:pw@localhost:5432/star_reports_verify?schema=other")) ?? "", /schema "other" but DATABASE_URL uses "public"/);
  assert.equal(withApplicationName("postgresql://star:pw@localhost:5432/star_reports?schema=public"), "postgresql://star:pw@localhost:5432/star_reports?schema=public&application_name=star-reports-maintenance");
});

test("secrets never reach stored or printed messages", () => {
  assert.equal(redactSecrets("connection to postgresql://star:hunter2@db/star failed", "hunter2"), "connection to postgresql://star:***@db/star failed");
  assert.equal(redactSecrets("password authentication failed; tried hunter2 twice", "hunter2"), "password authentication failed; tried *** twice");
  assert.equal(redactSecrets("postgres://a:b@c/d", null), "postgres://a:***@c/d");
  assert.equal(redactSecrets("nothing here", null), "nothing here");
});

test("backup files are named by UTC time and only those files are ever pruned, keeping a minimum", () => {
  const now = new Date("2026-09-05T02:00:00.000Z");
  assert.equal(backupFileName(now), "star-reports-20260905-020000.dump");
  assert.equal(preRestoreFileName("star_reports", now), "pre-restore-star_reports-20260905-020000.dump");
  assert.equal(preRestoreFileName("odd name/1", now), "pre-restore-odd_name_1-20260905-020000.dump");
  assert.deepEqual(companionFiles("a.dump"), ["a.dump.sha256", "a.dump.meta.json"]);
  assert.deepEqual(backupFileTime("star-reports-20260905-020000.dump"), now);
  assert.equal(backupFileTime("star-reports-20260905-020000.dump.sha256"), null);
  assert.equal(backupFileTime("pre-restore-star_reports-20260905-020000.dump"), null, "safety copies are never pruned");
  assert.equal(backupFileTime("notes.txt"), null);
  assert.equal(backupFileTime("star-reports-20261399-020000.dump"), null);

  const names = ["notes.txt", "manual-copy.dump", "pre-restore-star_reports-20260101-020000.dump"];
  for (let day = 1; day <= 40; day += 1) names.push(backupFileName(new Date(Date.UTC(2026, 7, day, 2))));
  const pruned = backupsToPrune(names, { retentionDays: 30, keepMinimum: 7, now: new Date("2026-09-10T02:00:00.000Z") });
  // Files from 1 to 10 August are older than 30 days on 10 September (the 11th is exactly 30 days and stays).
  assert.deepEqual([...pruned].sort(), Array.from({ length: 10 }, (_, index) => backupFileName(new Date(Date.UTC(2026, 7, index + 1, 2)))));
  assert.ok(!pruned.includes("manual-copy.dump"));
  assert.ok(!pruned.some((name) => name.startsWith("pre-restore-")));

  // When the task has been silent for months, the keep-minimum protects the newest files regardless of age.
  const old = Array.from({ length: 5 }, (_, index) => backupFileName(new Date(Date.UTC(2026, 0, index + 1, 2))));
  assert.deepEqual(backupsToPrune(old, { retentionDays: 30, keepMinimum: 3, now: new Date("2026-09-10T02:00:00.000Z") }).sort(), [old[0], old[1]]);
  assert.deepEqual(backupsToPrune(old, { retentionDays: 30, keepMinimum: 7, now: new Date("2026-09-10T02:00:00.000Z") }), []);
});

test("leftover partial files are removed only once the run that wrote them must have died", () => {
  const now = new Date("2026-09-05T04:00:00.000Z");
  const names = [
    "star-reports-20260905-020000.dump.partial",
    "star-reports-20260905-033000.dump.partial",
    "pre-restore-star_reports-20260904-020000.dump.partial",
    "star-reports-20260905-020000.dump",
    "unrelated.partial"
  ];
  assert.deepEqual(partialFilesToRemove(names, { timeoutMinutes: 60, now }), ["star-reports-20260905-020000.dump.partial", "pre-restore-star_reports-20260904-020000.dump.partial"]);
  assert.deepEqual(partialFilesToRemove(names, { timeoutMinutes: 600, now }), ["pre-restore-star_reports-20260904-020000.dump.partial"]);
});

test("archive listings are parsed per schema and checked against every Prisma model", () => {
  assert.deepEqual(archiveTables(LISTING), ["ApiRequest", "AppSecret", "GoogleSearchConsoleConnection", 'Odd "Name"']);
  assert.deepEqual(archiveTables(LISTING, "other"), ["Client"]);
  assert.deepEqual(archiveTables(""), []);
  assert.deepEqual(archiveHeader(LISTING), ["Archive created at 2026-09-05 12:05:53 BST", "Dumped from database version: 18.6 (Postgres.app)", "Dumped by pg_dump version: 18.6 (Postgres.app)"]);

  const required = requiredTables();
  assert.ok(required.length >= 20, `expected every model, got ${required.length}`);
  assert.ok(required.includes("GoogleSearchConsoleConnection"), "@@map names must be the database table");
  assert.ok(!required.includes("GoogleConnection"));
  assert.equal(tableForModel("GoogleConnection"), "GoogleSearchConsoleConnection");
  assert.equal(tableForModel("AppSecret"), "AppSecret");
  assert.throws(() => tableForModel("Nope"), /Unknown Prisma model/);

  assert.deepEqual(missingTables(required), []);
  assert.deepEqual(missingTables(required.filter((table) => table !== "Client" && table !== "AuditLog")), ["AuditLog", "Client"]);
  assert.deepEqual(missingTables(["Client"], ["Client", "Project"]), ["Project"]);
});

test("client tool versions must not be older than the server", () => {
  assert.equal(toolMajorVersion("pg_dump (PostgreSQL) 16.4 (Ubuntu 16.4-1.pgdg22.04+1)"), 16);
  assert.equal(toolMajorVersion("pg_dump (PostgreSQL) 18.6 (Postgres.app)"), 18);
  assert.equal(toolMajorVersion("pg_dump (PostgreSQL) 9.6.24"), 9);
  assert.equal(toolMajorVersion("garbage"), null);
  assert.equal(serverMajorVersion(160004), 16);
  assert.equal(serverMajorVersion("180006"), 18);
  assert.equal(serverMajorVersion(90624), 9);
  assert.equal(serverMajorVersion(0), null);
  assert.equal(clientCanDumpServer(16, 16), true);
  assert.equal(clientCanDumpServer(17, 16), true);
  assert.equal(clientCanDumpServer(15, 16), false);
  assert.equal(clientCanDumpServer(null, 16), true, "unknown versions are left to pg_dump to judge");
});

test("row counts from the same snapshot must match exactly", () => {
  const comparison = compareRowCounts({ Client: 10, AuditLog: 500, RankRun: 3 }, { Client: 10, AuditLog: 520, RankRun: 3 });
  assert.deepEqual(comparison.mismatched, [{ table: "AuditLog", live: 500, restored: 520 }]);
  assert.equal(comparison.matched, 2);
  assert.deepEqual(compareRowCounts({ Client: 1 }, {}).mismatched, [{ table: "Client", live: 1, restored: 0 }]);
  assert.deepEqual(compareRowCounts({ Client: 1 }, { Client: 1 }), { mismatched: [], matched: 1 });
});

test("the heartbeat message says how far the backup was proven and how the stored keys fared", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(71207), "69.5 KB");
  assert.equal(formatBytes(12.4 * 1024 * 1024), "12.4 MB");
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), "3.0 GB");
  assert.equal(formatBytes(250 * 1024 * 1024), "250 MB");

  assert.equal(describeSecretsCheck(null), null);
  assert.equal(describeSecretsCheck({ total: 0, current: 0, previous: 0 }), null);
  assert.equal(describeSecretsCheck({ total: 5, current: 5, previous: 0 }), "all 5 stored keys open");
  assert.equal(describeSecretsCheck({ total: 5, current: 3, previous: 2 }), "2 of 5 stored keys open only with the previous master key");
  assert.equal(describeSecretsCheck({ total: 5, current: 3, previous: 0 }), "2 of 5 stored keys do not open with this master key");

  const archiveOnly = describeBackup({ fileName: "star-reports-20260905-020000.dump", sizeBytes: 71207, verification: { level: "archive", tables: 23 } });
  assert.equal(archiveOnly, "star-reports-20260905-020000.dump · 69.5 KB · 23 tables · archive decoded; set BACKUP_VERIFY_DATABASE_URL to test restores");
  const tested = describeBackup({ fileName: "a.dump", sizeBytes: 1024, verification: { level: "restore", tables: 23, comparison: { mismatched: [], matched: 23 }, secrets: { total: 4, current: 4, previous: 0 } } });
  assert.equal(tested, "a.dump · 1.0 KB · 23 tables · restore tested · all 4 stored keys open");
  const nothingToOpen = describeBackup({ fileName: "a.dump", sizeBytes: 1024, verification: { level: "restore", tables: 23, comparison: { mismatched: [], matched: 23 }, secrets: null } });
  assert.equal(nothingToOpen, "a.dump · 1.0 KB · 23 tables · restore tested");
});

test("backup health reflects the daily task: fresh installs, failures, staleness, and a script that died mid-run", () => {
  const now = new Date("2026-09-05T12:00:00.000Z");
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
  assert.deepEqual(backupHealth(null, now, 26), { state: "never", label: "Never run", healthy: false });
  assert.deepEqual(backupHealth({ status: "healthy", startedAt: at(20), lastSuccessAt: at(20) }, now, 26), { state: "healthy", label: "Healthy", healthy: true });
  assert.deepEqual(backupHealth({ status: "healthy", startedAt: at(30), lastSuccessAt: at(30) }, now, 26), { state: "stale", label: "Stale", healthy: false });
  assert.equal(backupHealth({ status: "healthy", startedAt: at(30), lastSuccessAt: at(30) }, now, 48).state, "healthy");
  assert.deepEqual(backupHealth({ status: "failed", startedAt: at(1), lastSuccessAt: at(25) }, now, 26), { state: "failed", label: "Failed", healthy: false });
  assert.deepEqual(backupHealth({ status: "running", startedAt: at(1), lastSuccessAt: at(25) }, now, 26), { state: "running", label: "Running", healthy: true });
  assert.deepEqual(backupHealth({ status: "running", startedAt: at(5), lastSuccessAt: at(72) }, now, 26), { state: "failed", label: "Did not finish", healthy: false });
  assert.deepEqual(backupHealth({ status: "running", startedAt: at(5), lastSuccessAt: at(6) }, now, 48).state, "failed", "the run limit is fixed, not the staleness window");
  assert.equal(backupHealth({ status: "healthy", startedAt: null, lastSuccessAt: null }, now, 26).state, "stale");
});

test("pg_dump and pg_restore are invoked with the password out of the argument list", () => {
  const target = postgresTarget("postgresql://star:pw@localhost:5432/star_reports?schema=public");
  const dump = pgDumpArguments(target, "/backups/a.dump.partial", { snapshot: "00000003-0000001B-1" });
  assert.deepEqual(dump, [
    "--format=custom", "--compress=6", "--no-owner", "--no-privileges", "--lock-wait-timeout=60000", "--schema=public",
    "--snapshot=00000003-0000001B-1", "--file=/backups/a.dump.partial", "--dbname=postgresql://star@localhost:5432/star_reports"
  ]);
  assert.ok(!pgDumpArguments(target, "/backups/a.dump.partial").some((argument) => argument.startsWith("--snapshot")));
  assert.ok(dump.every((argument) => !argument.includes("pw@")));
  const restore = pgRestoreArguments(target, "/backups/a.dump");
  assert.ok(restore.includes("--single-transaction") && restore.includes("--exit-on-error") && restore.includes("--no-owner"));
  assert.equal(restore.at(-1), "/backups/a.dump");
  assert.ok(restore.every((argument) => !argument.includes("pw@")));
  assert.deepEqual(pgRestoreDecodeArguments("/backups/a.dump"), ["--file=/dev/null", "/backups/a.dump"]);
  assert.equal(toolCommand("pg_dump", null), "pg_dump");
  assert.equal(toolCommand("pg_restore", "/usr/pgsql-16/bin"), "/usr/pgsql-16/bin/pg_restore");
  assert.equal(quoteIdentifier('Odd "Name"'), '"Odd ""Name"""');
});
