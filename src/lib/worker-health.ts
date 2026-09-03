import { prisma } from "@/lib/db";
import { configuredPositiveInteger } from "@/lib/rate-limit";

export const RANK_WORKER_KEY = "rank-worker";

export async function recordWorkerStart() {
  const now = new Date();
  await prisma.workerHeartbeat.upsert({
    where: { key: RANK_WORKER_KEY },
    create: { key: RANK_WORKER_KEY, status: "running", startedAt: now, message: null },
    update: { status: "running", startedAt: now, message: null }
  });
}

export async function recordWorkerSuccess(input: {
  scheduled: number;
  submitted: number;
  collected: number;
  metricsSubmitted: number;
  metricsCollected: number;
}) {
  const now = new Date();
  await prisma.workerHeartbeat.upsert({
    where: { key: RANK_WORKER_KEY },
    create: {
      key: RANK_WORKER_KEY,
      status: "healthy",
      startedAt: now,
      completedAt: now,
      lastSuccessAt: now,
      ...input
    },
    update: {
      status: "healthy",
      completedAt: now,
      lastSuccessAt: now,
      message: null,
      ...input
    }
  });
}

export async function recordWorkerFailure(error: unknown) {
  const now = new Date();
  const message = error instanceof Error ? error.message : "Unknown worker failure.";
  await prisma.workerHeartbeat.upsert({
    where: { key: RANK_WORKER_KEY },
    create: {
      key: RANK_WORKER_KEY,
      status: "failed",
      startedAt: now,
      completedAt: now,
      lastFailureAt: now,
      message
    },
    update: { status: "failed", completedAt: now, lastFailureAt: now, message }
  });
}

export function workerHealth(
  heartbeat: { status: string; startedAt: Date | null; lastSuccessAt: Date | null } | null,
  now = new Date()
) {
  if (!heartbeat) return { state: "never" as const, label: "Never run", healthy: false };
  if (heartbeat.status === "running") return { state: "running" as const, label: "Running", healthy: true };
  if (heartbeat.status === "failed") return { state: "failed" as const, label: "Failed", healthy: false };

  const staleMinutes = configuredPositiveInteger("RANK_WORKER_STALE_MINUTES", 15);
  const lastActivity = heartbeat.lastSuccessAt ?? heartbeat.startedAt;
  if (!lastActivity || now.getTime() - lastActivity.getTime() > staleMinutes * 60 * 1000) {
    return { state: "stale" as const, label: "Stale", healthy: false };
  }
  return { state: "healthy" as const, label: "Healthy", healthy: true };
}
