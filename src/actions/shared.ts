import { z } from "zod";
import { currentActor, requireAdmin, requireManager, type CurrentActor } from "@/lib/access";
import { writeRequestAudit } from "@/lib/audit";
import { enforceRateLimit, type RateLimitPolicy } from "@/lib/rate-limit";

export const optionalText = z.string().trim().optional().transform((value) => value || null);

export const SHARE_EXPIRY_DAYS = [7, 30, 90, 365] as const;

export function readForm(formData: FormData, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, stringFromForm(formData.get(key))]));
}

export function stringFromForm(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

export function stringListFromForm(formData: FormData, key: string) {
  return formData.getAll(key).filter((value): value is string => typeof value === "string");
}

export function uniqueValues<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function uniqueLines(value: string) {
  const unique = new Map<string, string>();
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => unique.set(normalizedKeyword(line), line));
  return Array.from(unique.values());
}

export function normalizedKeyword(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

export function shareExpiry(formData?: FormData) {
  const parsed = Number.parseInt(stringFromForm(formData?.get("shareExpiryDays") ?? null), 10);
  const days = (SHARE_EXPIRY_DAYS as readonly number[]).includes(parsed) ? parsed : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function describeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function guardedAdminAction(scope: string, policy: RateLimitPolicy) {
  const actor = await requireAdmin();
  await enforceRateLimit(scope, actor.email, policy);
  return actor;
}

export async function guardedManagerAction(scope: string, policy: RateLimitPolicy) {
  const actor = await requireManager();
  await enforceRateLimit(scope, actor.email, policy);
  return actor;
}

export async function guardedActorAction(scope: string, policy: RateLimitPolicy) {
  const actor = await currentActor();
  await enforceRateLimit(scope, actor.email, policy);
  return actor;
}

export async function auditAction(
  event: string,
  actor: CurrentActor,
  entityType: string,
  entityId: string | null,
  metadata?: Record<string, string | number | boolean | string[]>,
  outcome: "success" | "failure" = "success"
) {
  await writeRequestAudit({
    event,
    outcome,
    actorEmail: actor.email,
    actorRole: actor.role,
    entityType,
    entityId,
    ...(metadata ? { metadata } : {})
  });
}
