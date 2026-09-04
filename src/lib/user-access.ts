import { envList } from "@/lib/env";
import type { AppRole } from "@/lib/roles";

export type AccessDecision = { allowed: boolean; role: AppRole };

export type ManagedUserRecord = { enabled: boolean; role: AppRole };

/**
 * Result of looking the user up in the managed access table. `unavailable` means the
 * lookup itself failed (for example the database was unreachable) and must fail closed.
 */
export type ManagedUserLookup =
  | { record: ManagedUserRecord | null }
  | { unavailable: true };

export function isBootstrapAdmin(email: string, env: Record<string, string | undefined> = process.env) {
  return envList("AUTH_ADMIN_EMAILS", env).includes(email.toLowerCase());
}

export function emailAllowedByEnvironment(email: string, env: Record<string, string | undefined> = process.env) {
  const normalized = email.toLowerCase();
  if (!normalized) return false;
  const domain = normalized.split("@")[1] ?? "";
  return envList("AUTH_ALLOWED_EMAILS", env).includes(normalized) || envList("AUTH_ALLOWED_DOMAINS", env).includes(domain);
}

/**
 * Decide whether a verified Google email may sign in and which role it receives.
 *
 * Precedence:
 * 1. Environment administrators always get in (emergency recovery path).
 * 2. A managed user record decides both access and role, including explicit revocation.
 * 3. If the managed lookup was unavailable, deny. A database outage must never widen access.
 * 4. Otherwise fall back to the environment allowlists for bootstrap access.
 */
export function decideUserAccess(
  email: string,
  lookup: ManagedUserLookup,
  env: Record<string, string | undefined> = process.env
): AccessDecision {
  const normalized = email.toLowerCase();
  if (!normalized) return { allowed: false, role: "team" };
  if (isBootstrapAdmin(normalized, env)) return { allowed: true, role: "admin" };
  if ("unavailable" in lookup) return { allowed: false, role: "team" };
  if (lookup.record) return { allowed: lookup.record.enabled, role: lookup.record.role };

  const role: AppRole = envList("AUTH_MANAGER_EMAILS", env).includes(normalized) ? "manager" : "team";
  return { allowed: emailAllowedByEnvironment(normalized, env), role };
}
