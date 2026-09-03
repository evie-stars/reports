import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    const seconds = Math.max(1, retryAfterSeconds);
    super("Too many requests. Try again in " + seconds + " seconds.");
    this.name = "RateLimitError";
    this.retryAfterSeconds = seconds;
  }
}

export type RateLimitPolicy = {
  limit: number;
  windowSeconds: number;
};

export async function enforceRateLimit(scope: string, identifier: string, policy: RateLimitPolicy) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + policy.windowSeconds * 1000);
  const key = createHash("sha256").update(scope + ":" + identifier.toLowerCase()).digest("hex");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const bucket = await tx.rateLimitBucket.findUnique({ where: { key } });

        if (!bucket || bucket.expiresAt <= now) {
          await tx.rateLimitBucket.upsert({
            where: { key },
            create: { key, scope, count: 1, windowStartedAt: now, expiresAt },
            update: { scope, count: 1, windowStartedAt: now, expiresAt }
          });
          return;
        }

        const updated = await tx.rateLimitBucket.updateMany({
          where: { key, expiresAt: { gt: now }, count: { lt: policy.limit } },
          data: { count: { increment: 1 } }
        });

        if (updated.count === 0) {
          throw new RateLimitError(Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000));
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    } catch (error) {
      if (attempt < 2 && isTransactionConflict(error)) continue;
      throw error;
    }
  }
}

export function actionRateLimit(): RateLimitPolicy {
  return { limit: configuredPositiveInteger("RATE_LIMIT_ACTIONS_PER_MINUTE", 30), windowSeconds: 60 };
}

export function paidRunRateLimit(): RateLimitPolicy {
  return { limit: configuredPositiveInteger("RATE_LIMIT_PAID_RUNS_PER_HOUR", 10), windowSeconds: 60 * 60 };
}

export function shareRateLimit(): RateLimitPolicy {
  return { limit: configuredPositiveInteger("RATE_LIMIT_SHARE_CHANGES_PER_HOUR", 10), windowSeconds: 60 * 60 };
}

export function apiRateLimit(): RateLimitPolicy {
  return { limit: configuredPositiveInteger("RATE_LIMIT_API_REQUESTS_PER_MINUTE", 60), windowSeconds: 60 };
}

export function configuredPositiveInteger(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isTransactionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}
