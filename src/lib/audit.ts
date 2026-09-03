import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";

export type AuditEvent = {
  event: string;
  outcome?: "success" | "failure";
  actorEmail?: string | null;
  actorRole?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAuditLog(input: AuditEvent) {
  try {
    await prisma.auditLog.create({
      data: {
        event: input.event,
        outcome: input.outcome ?? "success",
        actorEmail: input.actorEmail ?? null,
        actorRole: input.actorRole ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        ipAddress: input.ipAddress ?? null,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata })
      }
    });
  } catch (error) {
    console.error("[audit] Unable to store audit event", input.event, error);
  }
}

export async function writeRequestAudit(input: Omit<AuditEvent, "ipAddress">) {
  return writeAuditLog({ ...input, ipAddress: await requestIpAddress() });
}

async function requestIpAddress() {
  try {
    const requestHeaders = await headers();
    return requestHeaders.get("x-real-ip") ??
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;
  } catch {
    return null;
  }
}
