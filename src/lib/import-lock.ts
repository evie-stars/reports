import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Per-report import locks. One row in `SystemLock` per product and report stops a manual import,
 * a scheduled import, and a mapping change from interleaving. The lock is also the worker's signal
 * that an import which was marked "running" has actually died: an expired lock means nobody is
 * still working.
 */
export const IMPORT_LOCK_MINUTES = 10;

export class ImportLockHeldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportLockHeldError";
  }
}

export function isImportLockHeldError(error: unknown): error is ImportLockHeldError {
  return error instanceof ImportLockHeldError || (error instanceof Error && error.name === "ImportLockHeldError");
}

export function gscImportLockKey(projectId: string) {
  return `gsc-import:${projectId}`;
}

export function ga4ImportLockKey(projectId: string) {
  return `ga4-import:${projectId}`;
}

/** True while another process holds the lock (an import is genuinely in progress). */
export async function importLockHeld(key: string, now = new Date()) {
  const lock = await prisma.systemLock.findUnique({ where: { key } });
  return Boolean(lock && lock.lockedUntil > now);
}

export async function withImportLock<T>(key: string, busyMessage: string, work: () => Promise<T>, minutes = IMPORT_LOCK_MINUTES): Promise<T> {
  const owner = randomUUID();
  if (!(await acquireImportLock(key, owner, minutes))) throw new ImportLockHeldError(busyMessage);
  try {
    return await work();
  } finally {
    await releaseImportLock(key, owner);
  }
}

async function acquireImportLock(key: string, owner: string, minutes: number) {
  await prisma.systemLock.upsert({
    where: { key },
    create: { key, owner: null, lockedUntil: new Date(0) },
    update: {}
  });
  const claimed = await prisma.systemLock.updateMany({
    where: { key, lockedUntil: { lt: new Date() } },
    data: { owner, lockedUntil: new Date(Date.now() + minutes * 60 * 1000) }
  });
  return claimed.count === 1;
}

/** Best effort: a release that fails (the database went away, or a restore replaced the table) must not turn finished work into an error; the lock simply expires. */
async function releaseImportLock(key: string, owner: string) {
  try {
    await prisma.systemLock.updateMany({
      where: { key, owner },
      data: { owner: null, lockedUntil: new Date(0) }
    });
  } catch (error) {
    console.error(`[lock] ${key} could not be released; it expires on its own.`, error instanceof Error ? error.message : error);
  }
}
